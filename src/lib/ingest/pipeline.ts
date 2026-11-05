// Automatic capture: email/webhook → parser or LLM → transaction scored by Table 5.4-A → Inbox.
// One DB transaction per message (NFR-5); the cursor only moves when every message of the run is saved.
// jsonb parameters are sent as text and cast in SQL (`$n::text::jsonb`): postgres.js would otherwise JSON-encode the string again.
import { asUser, type Db, type Q } from "./db";
import { bareAddress, getMail, GmailFailure, listIds, refreshAccessToken, type Mail } from "./gmail";
import {
  CATEGORY_PROMPT, CATEGORY_SCHEMA, chatJson, EMAIL_PROMPT, EMAIL_SCHEMA, LlmInvalid, LlmUnreachable, validateCategoryResult, validateEmailResult, type LlmConfig,
} from "./llm";
import { parseEmail, type ParsedTx, type ParserId } from "../core/parsers";
import { assessConfidence, normalizeMerchant, redact, repaymentScore, transferScore } from "../core/domain";
import { detectSubscription } from "../core/insights";
import { notifyOwner, type Vapid } from "./push";
import { addDays, todayWib, wibDate, wibStart } from "../core/dates";

export interface IngestEnv {
  googleClientId: string;
  googleClientSecret: string;
  llm: LlmConfig | null;
  fetchFn: typeof fetch;
  now: () => Date;
  vapid?: Vapid | null;
}

interface Settings {
  large_amount_threshold: number;
  llm_enabled: boolean;
  auto_link_transfers: boolean;
  redaction_terms: string[];
}

interface Ctx {
  q: Q;
  uid: string;
  s: Settings;
  now: Date;
}

const POLL_MAX = 100;
const OVERLAP_S = 600;

async function settingsOf(q: Q, uid: string): Promise<Settings> {
  const [r] = await q(`select large_amount_threshold, llm_enabled, auto_link_transfers, redaction_terms from app_settings where user_id = $1`, [uid]);
  return {
    large_amount_threshold: Number(r?.large_amount_threshold ?? 500000),
    llm_enabled: r?.llm_enabled ?? true,
    auto_link_transfers: r?.auto_link_transfers ?? false,
    redaction_terms: r?.redaction_terms ?? [],
  };
}

// ---------------------------------------------------------------- account + merchant resolution
interface Acc {
  id: string;
  name: string;
  last4: string | null;
  match_hints: string[];
  is_system: boolean;
}

export function matchAccount(accounts: Acc[], hints: (string | null | undefined)[]): string | null {
  const text = hints.filter(Boolean).join(" ").toLowerCase();
  if (!text.trim()) return null;
  let best: { id: string; score: number } | null = null;
  for (const a of accounts) {
    if (a.is_system) continue;
    let score = 0;
    if (a.last4 && text.includes(a.last4)) score += 3;
    if (text.includes(a.name.toLowerCase())) score += 2;
    for (const h of a.match_hints) if (h && text.includes(h.toLowerCase())) score += 1;
    if (score && (!best || score > best.score)) best = { id: a.id, score };
  }
  return best?.id ?? null;
}

async function resolveMerchant(q: Q, uid: string, name: string, create: boolean) {
  const key = normalizeMerchant(name);
  const [viaAlias] = await q(
    `select m.id, m.default_category_id, m.default_one_off, m.skip_review from merchant_aliases a join merchants m on m.id = a.merchant_id where a.user_id = $1 and a.alias_key = $2`,
    [uid, key],
  );
  if (viaAlias) return viaAlias;
  const [direct] = await q(`select id, default_category_id, default_one_off, skip_review from merchants where user_id = $1 and match_key = $2`, [uid, key]);
  if (direct || !create) return direct ?? null;
  const [ins] = await q(
    `insert into merchants (user_id, display_name, match_key) values ($1, $2, $3)
     on conflict (user_id, match_key) do update set display_name = merchants.display_name
     returning id, default_category_id, default_one_off, skip_review`,
    [uid, name.trim().slice(0, 80), key],
  );
  return ins;
}

// ---------------------------------------------------------------- transaction creation (Table 5.4-A)
export type CreateResult = "auto_confirmed" | "needs_review" | "linked" | "duplicate";

export async function createAutoTransaction(
  c: Ctx,
  p: { tx: Omit<ParsedTx, "dedupe_key" | "payment_method"> & { dedupe_key: string | null; payment_method?: string | null }; role: "email" | "webhook"; eventId: string; sourceId: string | null; defaultAccount: string | null; viaLlm: boolean },
): Promise<{ result: CreateResult; id: string }> {
  const { q, uid } = c;
  const t = p.tx;

  if (t.dedupe_key) {
    const [dup] = await q(`select id from transactions where user_id = $1 and dedupe_key = $2`, [uid, t.dedupe_key]);
    if (dup) {
      await q(
        `insert into transaction_evidence (transaction_id, role, ingest_event_id, parsed_amount) values ($1, $2, $3, $4) on conflict do nothing`,
        [dup.id, p.role, p.eventId, t.amount],
      );
      return { result: "duplicate", id: dup.id };
    }
  }

  const accounts = (await q(`select id, name, last4, match_hints, is_system from accounts where user_id = $1 and archived_at is null`, [uid])) as Acc[];
  const system = accounts.find((a) => a.is_system)!;
  const accountId = matchAccount(accounts, [t.account_hint, t.payment_method]) ?? p.defaultAccount ?? system.id;

  // cross-source match: same amount within 10 minutes from a different sender (F-04.2)
  const near = await q(
    `select t.id, t.account_id from transactions t
     where t.user_id = $1 and t.amount = $2 and t.deleted_at is null and t.status <> 'ignored'
       and abs(extract(epoch from (t.occurred_at - $3::timestamptz))) <= 600
       and not exists (select 1 from transaction_evidence e join ingest_events ev on ev.id = e.ingest_event_id
                       where e.transaction_id = t.id and ev.source_id is not distinct from $4::uuid)
     order by abs(extract(epoch from (t.occurred_at - $3::timestamptz))) limit 3`,
    [uid, t.amount, t.occurred_at, p.sourceId],
  );
  const sameAccount = near.find((n) => n.account_id === accountId);
  if (sameAccount) {
    await q(
      `insert into transaction_evidence (transaction_id, role, ingest_event_id, parsed_amount, match_score) values ($1, $2, $3, $4, 0.9) on conflict do nothing`,
      [sameAccount.id, p.role, p.eventId, t.amount],
    );
    return { result: "linked", id: sameAccount.id };
  }
  const dupOther = near.find((n) => n.account_id !== accountId);

  const unclear = t.kind_hint === "transfer_unknown";
  const merchant = t.merchant_raw && !unclear ? await resolveMerchant(q, uid, t.merchant_raw, true) : null;
  const kind = t.direction === "in" ? "income" : "expense";
  const verdict = assessConfidence({
    viaLlm: p.viaLlm,
    accountUnknown: accountId === system.id,
    amount: t.amount,
    threshold: c.s.large_amount_threshold,
    duplicateSuspect: !!dupOther,
    kindUnclear: unclear,
    receiptOnly: false,
    merchantHasDefaultCategory: !!merchant?.default_category_id && kind === "expense",
    merchantSkipReview: !!merchant?.skip_review,
    requiredFieldsComplete: !!t.amount && !!t.occurred_at && (kind !== "expense" || !!t.merchant_raw),
  });
  const [row] = await q(
    `insert into transactions (account_id, direction, amount, occurred_at, kind, category_id, merchant_id, merchant_raw,
       status, review_reason, confidence, source, is_one_off, dedupe_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
    [
      accountId, t.direction, t.amount, t.occurred_at, kind, kind === "expense" ? (merchant?.default_category_id ?? null) : null,
      merchant?.id ?? null, t.merchant_raw, verdict.status, verdict.reason, verdict.confidence, p.role,
      !!merchant?.default_one_off, t.dedupe_key,
    ],
  );
  await q(`insert into transaction_evidence (transaction_id, role, ingest_event_id, parsed_amount) values ($1, $2, $3, $4)`, [row.id, p.role, p.eventId, t.amount]);

  if (dupOther) {
    await q(
      `insert into match_proposals (type, transaction_id, other_transaction_id, score) values ('duplicate_suspect', $1, $2, 0.7) on conflict do nothing`,
      [row.id, dupOther.id],
    );
  } else {
    await proposeTransfer(c, row.id);
    if (t.direction === "in") await proposeRepayment(c, row.id);
  }
  return { result: verdict.status, id: row.id };
}

/** F-05.3: best opposite-direction partner; proposal ≥ 0.6, auto-link only when switched on and ≥ 0.9. */
export async function proposeTransfer(c: Ctx, txId: string) {
  const { q, uid } = c;
  const [me] = await q(`select id, account_id, direction, amount, occurred_at, coalesce(merchant_raw, '') || ' ' || coalesce(note, '') as text from transactions where id = $1`, [txId]);
  if (!me) return;
  const cands = await q(
    `select t.id, t.account_id, t.direction, t.amount, t.occurred_at, coalesce(t.merchant_raw, '') || ' ' || coalesce(t.note, '') as text,
       a.name as account_name, a.last4
     from transactions t join accounts a on a.id = t.account_id
     where t.user_id = $1 and t.id <> $2 and t.direction <> $3 and t.account_id <> $4 and t.deleted_at is null
       and t.status <> 'ignored' and t.kind <> 'transfer'
       and abs(extract(epoch from (t.occurred_at - $5::timestamptz))) <= 5 * 86400
       and not exists (select 1 from transfer_links l where t.id in (l.out_transaction_id, l.in_transaction_id))
       and not exists (select 1 from match_proposals p where p.status = 'open' and t.id in (p.transaction_id, p.other_transaction_id))`,
    [uid, me.id, me.direction, me.account_id, me.occurred_at],
  );
  const [myAcc] = await q(`select name, last4 from accounts where id = $1`, [me.account_id]);
  const scored = cands
    .map((o) => {
      const out = me.direction === "out" ? me : o;
      const inn = me.direction === "out" ? o : me;
      const lite = (x: typeof me) => ({ id: x.id, account_id: x.account_id, direction: x.direction, amount: Number(x.amount), occurred_at: new Date(x.occurred_at).toISOString(), text: x.text });
      const counterpart = me.direction === "out" ? { name: o.account_name, last4: o.last4 } : { name: myAcc.name, last4: myAcc.last4 };
      const s = transferScore(lite(out), lite(inn), counterpart);
      return s && { ...s, other: o.id, gap: Math.abs(Date.parse(o.occurred_at) - Date.parse(me.occurred_at)) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.score >= 0.6)
    .sort((a, b) => b.score - a.score || a.gap - b.gap);
  for (const best of scored) {
    const [rejected] = await q(
      `select 1 from match_proposals where type = 'transfer' and status = 'rejected'
       and ((transaction_id = $1 and other_transaction_id = $2) or (transaction_id = $2 and other_transaction_id = $1))`,
      [me.id, best.other],
    );
    if (rejected) continue;
    const [p] = await q(
      `insert into match_proposals (type, transaction_id, other_transaction_id, score, fee_amount) values ('transfer', $1, $2, $3, $4)
       on conflict do nothing returning id`,
      [me.id, best.other, best.score, best.fee],
    );
    if (p && c.s.auto_link_transfers && best.score >= 0.9) {
      await q(`select rpc_accept_proposal($1)`, [p.id]);
      await q(`update transfer_links set created_by = 'auto' where out_transaction_id in ($1, $2) or in_transaction_id in ($1, $2)`, [me.id, best.other]);
    }
    return;
  }
}

/** F-10.3: incoming money that matches an open receivable (shared ≤ 30 days ago). */
export async function proposeRepayment(c: Ctx, txId: string) {
  const { q, uid } = c;
  const [me] = await q(`select id, amount, occurred_at, coalesce(merchant_raw, '') || ' ' || coalesce(note, '') as text from transactions where id = $1`, [txId]);
  const recs = await q(
    `select r.id, r.remaining, r.person_name, sb.shared_at from receivables r
     join split_participants sp on sp.id = r.split_participant_id join split_bills sb on sb.id = sp.split_bill_id
     where r.user_id = $1 and r.status in ('open', 'partially_paid') and sb.shared_at is not null`,
    [uid],
  );
  for (const r of recs) {
    const score = repaymentScore(
      { amount: Number(me.amount), occurred_at: new Date(me.occurred_at).toISOString(), text: me.text },
      { remaining: Number(r.remaining), person_name: r.person_name, shared_at: new Date(r.shared_at).toISOString() },
    );
    if (score == null || score < 0.6) continue;
    const [rej] = await q(`select 1 from match_proposals where type = 'repayment' and status = 'rejected' and transaction_id = $1 and receivable_id = $2`, [me.id, r.id]);
    if (rej) continue;
    await q(`insert into match_proposals (type, transaction_id, receivable_id, score) values ('repayment', $1, $2, $3) on conflict do nothing`, [me.id, r.id, score]);
  }
}

// ---------------------------------------------------------------- one message
export interface MessageInput {
  channel: "gmail" | "webhook";
  externalId: string;
  sender: string;
  subject: string;
  text: string;
  receivedAt: string;
  parserId: ParserId | null;
  sourceId: string | null;
  defaultAccount: string | null;
}

export type MessageOutcome = "skipped" | "ignored" | "needs_llm" | "failed" | CreateResult;

export async function ingestMessage(c: Ctx, m: MessageInput): Promise<MessageOutcome[]> {
  const { q } = c;
  const redacted = redact(m.text, c.s.redaction_terms).slice(0, 20000);
  const [ev] = await q(
    `insert into ingest_events (channel, external_id, source_id, sender, subject, received_at, parser_id, raw_text_redacted)
     values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (user_id, channel, external_id) do nothing returning id`,
    [m.channel, m.externalId, m.sourceId, m.sender, m.subject.slice(0, 200), m.receivedAt, m.parserId, redacted],
  );
  if (!ev) return ["skipped"];
  if (m.sourceId) await q(`update email_sources set last_seen_at = greatest(coalesce(last_seen_at, $2::timestamptz), $2::timestamptz) where id = $1`, [m.sourceId, m.receivedAt]);

  let parseError: string | null = null;
  if (m.parserId) {
    const r = parseEmail(m.parserId, { from: m.sender, subject: m.subject, text: m.text, date: m.receivedAt });
    if (r.status === "ignored") {
      await q(`update ingest_events set parse_status = 'ignored', parse_error = $2 where id = $1`, [ev.id, r.reason]);
      return ["ignored"];
    }
    if (r.status === "parsed") {
      const out: MessageOutcome[] = [];
      for (const t of r.transactions) {
        const res = await createAutoTransaction(c, { tx: t, role: m.channel === "gmail" ? "email" : "webhook", eventId: ev.id, sourceId: m.sourceId, defaultAccount: m.defaultAccount, viaLlm: false });
        out.push(res.result);
      }
      await q(`update ingest_events set parse_status = 'parsed', parsed = $2::text::jsonb where id = $1`, [ev.id, JSON.stringify(r)]);
      return out;
    }
    parseError = r.reason;
  }
  if (c.s.llm_enabled) {
    await queueLlm(q, ev.id, m.sender, m.subject, m.receivedAt, redacted, m.defaultAccount);
    await q(`update ingest_events set parse_status = 'needs_llm', parse_error = $2 where id = $1`, [ev.id, parseError]);
    return ["needs_llm"];
  }
  await q(`update ingest_events set parse_status = $2, parse_error = $3 where id = $1`, [ev.id, m.parserId || m.channel === "webhook" ? "failed" : "unreadable", parseError ?? "tidak ada parser"]);
  return ["failed"];
}

export async function queueLlm(q: Q, eventId: string, sender: string, subject: string, date: string, redacted: string, defaultAccount: string | null) {
  await q(`insert into llm_jobs (kind, ref_id, payload) values ('parse_email', $1, $2::text::jsonb)`, [
    eventId,
    JSON.stringify({ sender, subject, date, text: redacted.slice(0, 6000), default_account_id: defaultAccount }),
  ]);
}

// ---------------------------------------------------------------- Gmail polling and 90-day import
export interface RunSummary {
  fetched: number;
  created: number;
  linked: number;
  needs_review: number;
  failed: number;
  remaining: number;
  skipped?: string;
  error?: string;
}

const empty = (): RunSummary => ({ fetched: 0, created: 0, linked: 0, needs_review: 0, failed: 0, remaining: 0 });

function tally(sum: RunSummary, outcomes: MessageOutcome[]) {
  for (const o of outcomes) {
    if (o === "auto_confirmed" || o === "needs_review") sum.created++;
    if (o === "needs_review") sum.needs_review++;
    if (o === "linked" || o === "duplicate") sum.linked++;
    if (o === "failed") sum.failed++;
  }
}

export async function runGmail(db: Db, env: IngestEnv, mode: "poll" | "backfill"): Promise<RunSummary> {
  const total = empty();
  const integrations = await db.q(
    `select user_id, cursor_internal_date_ms, backfill_state from integrations where provider = 'gmail' and status = 'terhubung'` +
      (mode === "backfill" ? ` and backfill_state ->> 'status' = 'running'` : ""),
  );
  for (const integ of integrations) {
    const r = await runGmailForUser(db, env, mode, integ);
    for (const k of ["fetched", "created", "linked", "needs_review", "failed", "remaining"] as const) total[k] += r[k];
    if (r.error) total.error = r.error;
    if (r.skipped) total.skipped = r.skipped;
  }
  return total;
}

async function runGmailForUser(db: Db, env: IngestEnv, mode: "poll" | "backfill", integ: Record<string, unknown>): Promise<RunSummary> {
  const uid = String(integ.user_id);
  const sum = empty();
  const sources = await db.q(`select id, sender_address, parser_id, default_account_id from email_sources where user_id = $1 and enabled`, [uid]);
  if (!sources.length) {
    await db.q(`update integrations set last_polled_at = now(), last_error = 'tidak ada pengirim' where user_id = $1 and provider = 'gmail'`, [uid]);
    return { ...sum, skipped: "tidak ada pengirim" };
  }
  try {
    const [secret] = await db.q(`select public.read_gmail_secret($1) as token`, [uid]);
    if (!secret?.token) throw new GmailFailure("invalid_grant");
    const token = await refreshAccessToken(env.fetchFn, env.googleClientId, env.googleClientSecret, secret.token);
    const query = (afterSec: number) => `from:(${sources.map((s) => s.sender_address).join(" OR ")}) after:${afterSec}`;

    let ids: string[];
    let state = (integ.backfill_state as { status: string; ids?: string[]; total?: number; processed?: number } | null) ?? null;
    if (mode === "backfill") {
      if (!state?.ids) {
        const after = Math.floor((env.now().getTime() - 90 * 86400_000) / 1000);
        const all = (await listIds(env.fetchFn, token, query(after))).reverse();
        state = { status: "running", ids: all, total: all.length, processed: 0 };
      }
      ids = state.ids!.slice(state.processed, state.processed! + POLL_MAX);
    } else {
      const cursor = Number(integ.cursor_internal_date_ms ?? env.now().getTime() - 86400_000);
      const all = (await listIds(env.fetchFn, token, query(Math.floor(cursor / 1000) - OVERLAP_S))).reverse();
      const known = new Set((await db.q(`select external_id from ingest_events where user_id = $1 and channel = 'gmail' and external_id = any($2)`, [uid, all])).map((r) => r.external_id));
      const fresh = all.filter((id) => !known.has(id));
      ids = fresh.slice(0, POLL_MAX);
      sum.remaining = fresh.length - ids.length;
    }

    const mails: Mail[] = [];
    for (const id of ids) mails.push(await getMail(env.fetchFn, token, id));
    mails.sort((a, b) => a.internalDateMs - b.internalDateMs);
    sum.fetched = mails.length;

    let allSaved = true;
    let maxDate = Number(integ.cursor_internal_date_ms ?? 0);
    for (const m of mails) {
      const src = sources.find((s) => s.sender_address === bareAddress(m.from));
      try {
        const outcomes = await asUser(db, uid, async (q) =>
          ingestMessage({ q, uid, s: await settingsOf(q, uid), now: env.now() }, {
            channel: "gmail", externalId: m.id, sender: m.from, subject: m.subject, text: m.text, receivedAt: m.dateIso,
            parserId: (src?.parser_id as ParserId) ?? null, sourceId: src?.id ?? null, defaultAccount: src?.default_account_id ?? null,
          }),
        );
        tally(sum, outcomes);
        maxDate = Math.max(maxDate, m.internalDateMs);
      } catch (e) {
        allSaved = false;
        sum.failed++;
        console.error("ingest message failed", m.id, (e as Error).name);
      }
    }

    if (sum.needs_review > 0) {
      const [{ n }] = await db.q(`select count(*)::int as n from transactions where user_id = $1 and status = 'needs_review' and deleted_at is null`, [uid]);
      await notifyOwner(db, uid, "inbox", `${n} transaksi perlu dicek.`, env.vapid ?? null, env.fetchFn).catch(() => 0);
    }
    if (mode === "backfill" && state) {
      const processed = Math.min(state.total!, state.processed! + ids.length);
      const done = processed >= state.total!;
      sum.remaining = state.total! - processed;
      await db.q(`update integrations set backfill_state = $2::text::jsonb, last_polled_at = now(), last_error = null where user_id = $1 and provider = 'gmail'`, [
        uid,
        JSON.stringify(done ? { status: "done", total: state.total, processed } : { ...state, processed }),
      ]);
    } else {
      await db.q(
        `update integrations set last_polled_at = now(), last_error = null` + (allSaved ? `, cursor_internal_date_ms = $2` : "") + ` where user_id = $1 and provider = 'gmail'`,
        allSaved ? [uid, maxDate || null] : [uid],
      );
    }
  } catch (e) {
    const kind = e instanceof GmailFailure ? e.kind : "server";
    if (kind === "invalid_grant") {
      await db.q(`update integrations set status = 'perlu_hubungkan_ulang', last_error = 'Google menolak token (invalid_grant)' where user_id = $1 and provider = 'gmail'`, [uid]);
      await notifyOwner(db, uid, "gmail", "Gmail perlu dihubungkan ulang.", env.vapid ?? null, env.fetchFn).catch(() => 0);
    } else {
      // status codes and error names only, never message content (NFR-9)
      const detail = e instanceof GmailFailure ? `Gmail ${kind}${e.status ? ` (HTTP ${e.status})` : ""}` : `Galat internal (${(e as Error).name})`;
      console.error("ingest-gmail", detail);
      await db.q(`update integrations set last_polled_at = now(), last_error = $2 where user_id = $1 and provider = 'gmail'`, [uid, detail]);
    }
    sum.error = kind;
  }
  return sum;
}

// ---------------------------------------------------------------- LLM queue (API-16)
/**
 * 8.3 `categorize`: one job per merchant that still has uncategorised expenses waiting in the Inbox.
 * Only the redacted merchant name is sent. The result is a suggestion shown in the Inbox; nothing is confirmed here.
 */
export async function enqueueCategorize(db: Db, limit = 200): Promise<number> {
  const rows = await db.q(
    `select m.id, m.user_id, m.display_name, s.redaction_terms from merchants m
     join app_settings s on s.user_id = m.user_id and s.llm_enabled
     where m.default_category_id is null
       and exists (select 1 from transactions t where t.merchant_id = m.id and t.status = 'needs_review' and t.kind = 'expense'
                   and t.category_id is null and t.deleted_at is null)
       and not exists (select 1 from llm_jobs j where j.ref_id = m.id and j.kind = 'categorize')
     limit $1`,
    [limit],
  );
  for (const r of rows) {
    await db.q(`insert into llm_jobs (user_id, kind, ref_id, payload) values ($1, 'categorize', $2, $3::text::jsonb)`, [
      r.user_id, r.id, JSON.stringify({ merchant: redact(String(r.display_name), (r.redaction_terms as string[]) ?? []).slice(0, 200) }),
    ]);
  }
  return rows.length;
}

async function categorizeJob(q: Q, uid: string, job: Record<string, unknown>, attempts: number, env: IngestEnv): Promise<"done" | "failed" | "pending"> {
  const now = env.now();
  const cats = (await q(`select id, name from categories where user_id = $1 and kind = 'expense' and archived_at is null order by name`, [uid])) as { id: string; name: string }[];
  const merchant = String((job.payload as { merchant: string }).merchant);
  const messages = [
    { role: "system", content: CATEGORY_PROMPT },
    { role: "user", content: `Kategori: ${cats.map((c) => c.name).join("; ")}\nMerchant: ${merchant}` },
  ];
  for (let tries = 0; tries < 2; tries++) {
    attempts++;
    try {
      if (!env.llm?.modelText) throw new LlmUnreachable("LLM belum dikonfigurasi");
      const result = validateCategoryResult(await chatJson(env.llm, env.llm.modelText, messages, CATEGORY_SCHEMA), cats);
      await q(`update llm_jobs set status = 'done', attempts = $2, result = $3::text::jsonb, model_used = $4, finished_at = now(), error = null where id = $1`, [
        job.id, attempts, JSON.stringify(result), env.llm.modelText,
      ]);
      return "done";
    } catch (e) {
      if (e instanceof LlmUnreachable) {
        if (attempts >= 5) break;
        await q(`update llm_jobs set status = 'pending', attempts = $2, error = $3, next_attempt_at = $4 where id = $1`, [
          job.id, attempts, e.message, new Date(now.getTime() + 10 * 60_000).toISOString(),
        ]);
        return "pending";
      }
      if (!(e instanceof LlmInvalid)) throw e;
    }
  }
  // no suggestion: the transactions simply stay in the Inbox as merchant_baru
  await q(`update llm_jobs set status = 'failed', attempts = $2, error = 'tanpa saran kategori', finished_at = now() where id = $1`, [job.id, attempts]);
  return "failed";
}

export async function processLlmJobs(db: Db, env: IngestEnv): Promise<{ done: number; failed: number; pending: number }> {
  const out = { done: 0, failed: 0, pending: 0 };
  // enqueue before reading the clock: new jobs get next_attempt_at = now() and must be due in this run
  if (env.llm) await enqueueCategorize(db);
  const now = env.now();
  const dayStart = wibStart(todayWib(now));
  // reading emails first: a categorize backlog must not delay new transactions
  const jobs = await db.q(
    `select id, user_id, kind, ref_id, payload, attempts from llm_jobs where status = 'pending' and kind in ('parse_email', 'categorize') and next_attempt_at <= $1
     order by kind = 'categorize', created_at limit 20`,
    [now.toISOString()],
  );
  for (const job of jobs) {
    const uid = String(job.user_id);
    await asUser(db, uid, async (q) => {
      const s = await settingsOf(q, uid);
      const [{ calls }] = await q(`select coalesce(sum(attempts), 0)::int as calls from llm_jobs where user_id = $1 and updated_at >= $2`, [uid, dayStart.toISOString()]);
      if (calls >= (env.llm?.dailyLimit ?? 200)) {
        const tomorrow = wibStart(addDays(todayWib(now), 1)).toISOString();
        await q(`update llm_jobs set next_attempt_at = $2, error = 'batas harian tercapai' where id = $1`, [job.id, tomorrow]);
        out.pending++;
        return;
      }
      let attempts = Number(job.attempts);
      const failJob = async (msg: string) => {
        await q(`update llm_jobs set status = 'failed', error = $2, attempts = $3, finished_at = now() where id = $1`, [job.id, msg, attempts]);
        await q(`update ingest_events set parse_status = 'failed', parse_error = $2 where id = $1`, [job.ref_id, msg]);
        out.failed++;
      };
      if (job.kind === "categorize") {
        const r = await categorizeJob(q, uid, job, attempts, env);
        out[r]++;
        return;
      }
      const payload = job.payload as { sender: string; subject: string; date: string; text: string; default_account_id: string | null };
      const messages = [
        { role: "system", content: EMAIL_PROMPT },
        { role: "user", content: `Pengirim: ${payload.sender}\nSubjek: ${payload.subject}\nTanggal email: ${payload.date}\n\n${payload.text}` },
      ];
      let result: ReturnType<typeof validateEmailResult> | null = null;
      for (let tries = 0; tries < 2 && !result; tries++) {
        attempts++;
        try {
          if (!env.llm?.modelText) throw new LlmUnreachable("LLM belum dikonfigurasi");
          const raw = await chatJson(env.llm, env.llm.modelText, messages, EMAIL_SCHEMA);
          result = validateEmailResult(raw, payload.text, now);
        } catch (e) {
          if (e instanceof LlmUnreachable) {
            if (attempts >= 5) return failJob("router tidak terjangkau setelah 5 percobaan");
            await q(`update llm_jobs set status = 'pending', attempts = $2, error = $3, next_attempt_at = $4 where id = $1`, [
              job.id, attempts, e.message, new Date(now.getTime() + 10 * 60_000).toISOString(),
            ]);
            out.pending++;
            return;
          }
          if (!(e instanceof LlmInvalid)) throw e;
          if (tries === 1) return failJob(`hasil LLM tidak valid: ${e.message}`);
        }
      }
      if (!result) return;
      if (result.ignored) {
        await q(`update ingest_events set parse_status = 'ignored' where id = $1`, [job.ref_id]);
      } else {
        const [ev] = await q(`select source_id from ingest_events where id = $1`, [job.ref_id]);
        for (const t of result.txs) {
          await createAutoTransaction({ q, uid, s, now }, {
            tx: { ...t, dedupe_key: null, payment_method: null },
            role: "email", eventId: job.ref_id, sourceId: ev?.source_id ?? null, defaultAccount: payload.default_account_id, viaLlm: true,
          });
        }
        await q(`update ingest_events set parse_status = 'parsed', parsed = $2::text::jsonb where id = $1`, [job.ref_id, JSON.stringify({ status: "parsed", via: "llm", transactions: result.txs })]);
      }
      await q(`update llm_jobs set status = 'done', attempts = $2, result = $3::text::jsonb, model_used = $4, finished_at = now(), error = null where id = $1`, [
        job.id, attempts, JSON.stringify(result), env.llm?.modelText ?? null,
      ]);
      out.done++;
    });
  }
  return out;
}

// ---------------------------------------------------------------- webhook (F-12.1)
const APP_PARSER: [RegExp, ParserId][] = [[/livin|mandiri/i, "mandiri"], [/grab/i, "grab"], [/shopee/i, "shopee"], [/play/i, "google_play"], [/gojek|gopay/i, "gojek"], [/esb/i, "esb"]];

export async function ingestWebhook(db: Db, uid: string, body: { source_app: string; text: string; posted_at: string }, externalId: string, now: Date) {
  const parserId = APP_PARSER.find(([re]) => re.test(body.source_app))?.[1] ?? null;
  return asUser(db, uid, async (q) =>
    ingestMessage({ q, uid, s: await settingsOf(q, uid), now }, {
      channel: "webhook", externalId, sender: body.source_app.slice(0, 80), subject: body.source_app.slice(0, 200), text: body.text,
      receivedAt: body.posted_at, parserId, sourceId: null, defaultAccount: null,
    }),
  );
}

// ---------------------------------------------------------------- daily maintenance (API-41)
export async function maintenance(db: Db, now: Date, vapid: Vapid | null = null, fetchFn: typeof fetch = fetch): Promise<{ purged: number; subscriptions_detected: number; push_sent: number; errors: string[] }> {
  const res = { purged: 0, subscriptions_detected: 0, push_sent: 0, errors: [] as string[] };
  try {
    const rows = await db.q(
      `update ingest_events set raw_text_redacted = null where raw_text_redacted is not null and received_at < $1 returning id`,
      [new Date(now.getTime() - 90 * 86400_000).toISOString()],
    );
    res.purged = rows.length;
  } catch {
    res.errors.push("purge");
  }
  try {
    res.subscriptions_detected = await detectSubscriptions(db);
  } catch {
    res.errors.push("subscriptions");
  }
  try {
    const due = await db.q(
      `select distinct user_id from assets where type = 'deposit' and archived_at is null and quantity > 0 and maturity_date between $1::date and $1::date + 7`,
      [todayWib(now)],
    );
    for (const d of due) res.push_sent += await notifyOwner(db, d.user_id, "deposito", "Ada deposito jatuh tempo minggu ini.", vapid, fetchFn);
  } catch {
    res.errors.push("push");
  }
  return res;
}

export async function detectSubscriptions(db: Db): Promise<number> {
  let n = 0;
  const groups = await db.q(
    `select user_id, merchant_id, array_agg(json_build_object('date', occurred_at, 'amount', amount) order by occurred_at) as txs
     from transactions where merchant_id is not null and kind = 'expense' and deleted_at is null and status <> 'ignored'
     group by user_id, merchant_id having count(*) >= 3`,
  );
  for (const g of groups) {
    const txs = (g.txs as { date: string; amount: number }[]).map((t) => ({ date: wibDate(t.date), amount: Number(t.amount) }));
    const s = detectSubscription(txs);
    const [existing] = await db.q(`select id, status from subscriptions where user_id = $1 and merchant_id = $2`, [g.user_id, g.merchant_id]);
    if (!s) continue;
    if (!existing) {
      await db.q(
        `insert into subscriptions (user_id, merchant_id, period, avg_amount, last_seen_on, next_expected_on, status) values ($1, $2, $3, $4, $5, $6, 'suggested')`,
        [g.user_id, g.merchant_id, s.period, s.avg_amount, s.last_seen_on, s.next_expected_on],
      );
      n++;
    } else if (existing.status === "active" || existing.status === "suggested") {
      await db.q(`update subscriptions set avg_amount = $2, last_seen_on = $3, next_expected_on = $4 where id = $1`, [existing.id, s.avg_amount, s.last_seen_on, s.next_expected_on]);
    }
  }
  return n;
}

