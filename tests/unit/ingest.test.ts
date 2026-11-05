// PH-4 pipeline tests on PGlite with a fake Gmail mailbox and a fake LLM router (no real Google account).
import { beforeEach, describe, expect, it } from "vitest";
import { addUser, createDb, ingestDb, type Db as Pg } from "../db/harness";
import { maintenance, processLlmJobs, runGmail, type IngestEnv } from "../../src/lib/ingest/pipeline";
import type { Db } from "../../src/lib/ingest/db";
import { FIXTURES, mandiriQris, SENDERS } from "../fixtures/emails";
import type { EmailInput } from "../../src/lib/core/parsers";

const U = "00000000-0000-4000-8000-0000000000aa";

interface FakeMail { id: string; internalDate: number; from: string; subject: string; body: string }

function b64url(s: string) {
  return Buffer.from(s).toString("base64url");
}

function fakeFetch(box: FakeMail[], opts: { status?: number; invalidGrant?: boolean; llm?: (body: Record<string, unknown>) => Response | Promise<Response> } = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) {
      return opts.invalidGrant ? new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }) : Response.json({ access_token: "access" });
    }
    if (url.includes("/chat/completions")) {
      if (!opts.llm) throw new TypeError("fetch failed");
      return opts.llm(JSON.parse(String(init?.body)));
    }
    if (opts.status) return new Response("{}", { status: opts.status });
    const u = new URL(url);
    if (u.pathname.endsWith("/messages")) {
      const q = u.searchParams.get("q") ?? "";
      const after = Number(q.match(/after:(\d+)/)?.[1] ?? 0);
      const senders = (q.match(/from:\(([^)]*)\)/)?.[1] ?? "").split(" OR ");
      const hits = box.filter((m) => m.internalDate / 1000 > after && senders.includes(m.from)).sort((a, b) => b.internalDate - a.internalDate);
      const start = Number(u.searchParams.get("pageToken") ?? 0);
      const page = hits.slice(start, start + 50);
      return Response.json({ messages: page.map((m) => ({ id: m.id })), nextPageToken: start + 50 < hits.length ? String(start + 50) : undefined });
    }
    const id = u.pathname.split("/").pop();
    const m = box.find((x) => x.id === id)!;
    return Response.json({
      id: m.id,
      internalDate: String(m.internalDate),
      payload: { mimeType: "text/plain", headers: [{ name: "From", value: `Layanan <${m.from}>` }, { name: "Subject", value: m.subject }], body: { data: b64url(m.body) } },
    });
  }) as typeof fetch;
}

const mail = (id: string, e: EmailInput, at: string): FakeMail => ({ id, internalDate: Date.parse(at), from: e.from, subject: e.subject, body: e.text });

let pg: Pg;
let db: Db;
const env = (fetchFn: typeof fetch, now = "2026-11-14T12:00:00Z", llm = true): IngestEnv => ({
  googleClientId: "id",
  googleClientSecret: "secret",
  fetchFn,
  now: () => new Date(now),
  llm: llm ? { baseUrl: "http://llm.test/v1", modelText: "text-model", dailyLimit: 200, fetchFn } : null,
});
const count = async (table: string, where = "true") => Number((await db.q(`select count(*)::int n from ${table} where ${where}`))[0].n);

async function setup() {
  pg = await createDb();
  db = ingestDb(pg);
  await addUser(pg, U);
  await db.q(`select bootstrap_user($1)`, [U]);
  await db.q(`update app_settings set onboarding_step = 5 where user_id = $1`, [U]);
  await db.q(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: U })]);
  const acc = (name: string, last4: string | null, hints: string[]) =>
    db.q(`insert into accounts (user_id, name, kind, last4, match_hints, opening_balance, opening_date) values ($1,$2,'bank',$3,$4,0,'2026-01-01') returning id`, [U, name, last4, hints]);
  await acc("Mandiri", "4821", ["mandiri", "qris"]);
  await acc("OVO", null, ["ovo"]);
  await acc("BNI", "7733", ["bni"]);
  for (const [p, s] of Object.entries(SENDERS)) await db.q(`insert into email_sources (user_id, sender_address, label, parser_id) values ($1,$2,$3,$4)`, [U, s.address, s.label, p]);
  await db.q(`insert into email_sources (user_id, sender_address, label) values ($1, 'kampus@uni.example', 'Kampus')`, [U]);
  await db.q(`select store_gmail_secret($1, 'refresh-token', 'pemilik@gmail.example')`, [U]);
  await db.q(`update integrations set cursor_internal_date_ms = $2 where user_id = $1`, [U, Date.parse("2026-11-14T00:00:00Z")]);
  await db.q(`select set_config('request.jwt.claims', '', false)`);
}

beforeEach(setup, 60_000);

describe("F-04.2 polling, dedupe, cross-source", () => {
  it("polling twice adds nothing the second time", async () => {
    const box = [mail("m1", mandiriQris(), "2026-11-14T10:57:10Z"), mail("m2", FIXTURES.gojek[0].email, "2026-11-14T04:21:00Z")];
    await runGmail(db, env(fakeFetch(box)), "poll");
    const [ev, tx] = [await count("ingest_events"), await count("transactions")];
    expect(ev).toBe(2);
    await runGmail(db, env(fakeFetch(box)), "poll");
    expect(await count("ingest_events")).toBe(ev);
    expect(await count("transactions")).toBe(tx);
  });

  it("Mandiri QRIS 17:57:04 + restaurant receipt 17:57 on the same account → 1 transaction, 2 evidence rows", async () => {
    const box = [mail("q", mandiriQris(), "2026-11-14T10:57:10Z"), mail("r", FIXTURES.esb[0].email, "2026-11-14T10:57:20Z")];
    await runGmail(db, env(fakeFetch(box)), "poll");
    expect(await count("transactions", "amount = 40000")).toBe(1);
    expect(await count("transaction_evidence")).toBe(2);
  });

  it("Gmail 429: error recorded, cursor kept; next run processes the message once", async () => {
    const box = [mail("m1", mandiriQris(), "2026-11-14T10:57:10Z")];
    const r = await runGmail(db, env(fakeFetch(box, { status: 429 })), "poll");
    expect(r.error).toBe("rate");
    expect((await db.q(`select cursor_internal_date_ms c, last_error from integrations`))[0]).toMatchObject({ last_error: "Gmail rate (HTTP 429)" });
    await runGmail(db, env(fakeFetch(box)), "poll");
    await runGmail(db, env(fakeFetch(box)), "poll");
    expect(await count("transactions")).toBe(1);
  });

  it("130 new messages: 100 now, 30 on the next run", async () => {
    const box = Array.from({ length: 130 }, (_, i) =>
      mail(`b${i}`, mandiriQris(`Rp ${(1000 + i).toLocaleString("id-ID")},00`, `REF${1000 + i}`), new Date(Date.parse("2026-11-14T01:00:00Z") + i * 60_000).toISOString()),
    );
    const first = await runGmail(db, env(fakeFetch(box)), "poll");
    expect(first.fetched).toBe(100);
    expect(first.remaining).toBe(30);
    const second = await runGmail(db, env(fakeFetch(box)), "poll");
    expect(second.fetched).toBe(30);
    expect(await count("ingest_events")).toBe(130);
  });

  it("invalid_grant → perlu_hubungkan_ulang", async () => {
    await runGmail(db, env(fakeFetch([], { invalidGrant: true })), "poll");
    expect((await db.q(`select status from integrations`))[0].status).toBe("perlu_hubungkan_ulang");
  });

  it("no enabled senders → skipped without calling Gmail", async () => {
    await db.q(`update email_sources set enabled = false`);
    const r = await runGmail(db, env((() => { throw new Error("should not call"); }) as unknown as typeof fetch), "poll");
    expect(r.skipped).toBe("tidak ada pengirim");
  });
});

describe("F-05.1 / F-05.4 confidence", () => {
  it("new merchant → needs_review merchant_baru; known merchant with category → auto_confirmed", async () => {
    await db.q(`update email_sources set default_account_id = (select id from accounts where name = 'OVO') where parser_id = 'gojek'`);
    await runGmail(db, env(fakeFetch([mail("g1", FIXTURES.gojek[0].email, "2026-11-14T04:21:00Z")])), "poll");
    expect((await db.q(`select status, review_reason from transactions`))[0]).toMatchObject({ status: "needs_review", review_reason: "merchant_baru" });
    await db.q(`update merchants set default_category_id = (select id from categories where name = 'Makan & minum' and kind='expense')`);
    const second = { ...FIXTURES.gojek[0].email, text: FIXTURES.gojek[0].email.text.replace("RB-552211", "RB-9").replace("17.201,00", "28.000") };
    await runGmail(db, env(fakeFetch([mail("g2", second, "2026-11-14T06:00:00Z")]), "2026-11-14T12:00:00Z"), "poll");
    expect((await db.q(`select status from transactions where amount = 28000`))[0].status).toBe("auto_confirmed");
  });

  it("amount ≥ threshold stays needs_review nominal_besar even with skip_review", async () => {
    await db.q(`update email_sources set default_account_id = (select id from accounts where name = 'OVO') where parser_id = 'shopee'`);
    await db.q(`insert into merchants (user_id, display_name, match_key, skip_review, default_category_id) values ($1, 'Toko Bangunan Jaya', 'toko bangunan jaya', true, (select id from categories where name='Belanja' and kind='expense'))`, [U]);
    await runGmail(db, env(fakeFetch([mail("s1", FIXTURES.shopee[0].email, "2026-11-14T01:00:00Z")])), "poll");
    expect((await db.q(`select review_reason from transactions`))[0].review_reason).toBe("nominal_besar");
  });
});

describe("F-04.4 LLM fallback", () => {
  const kampus = (text: string): FakeMail => ({ id: "k1", internalDate: Date.parse("2026-11-14T03:00:00Z"), from: "kampus@uni.example", subject: "Pembayaran UKT", body: text });
  const llmOk = () => Response.json({ choices: [{ message: { content: JSON.stringify({ ignored: false, reason: "", transactions: [{ amount: 250000, direction: "out", occurred_at: "2026-11-14T03:00:00Z", merchant_raw: "Kampus", account_hint: "Mandiri", kind_hint: "expense" }] }) } }] });

  it("valid LLM JSON → needs_review llm_parsed with confidence ≤ 0.6; never auto_confirmed", async () => {
    const box = [kampus("Pembayaran UKT berhasil sebesar Rp 250.000 dari rekening 1234567890123")];
    await runGmail(db, env(fakeFetch(box)), "poll");
    const [job] = await db.q(`select payload from llm_jobs`);
    expect(job.payload.text).toContain("••••0123");
    expect(job.payload.text).not.toContain("1234567890123");
    await processLlmJobs(db, env(fakeFetch(box, { llm: llmOk })));
    const [t] = await db.q(`select status, review_reason, confidence from transactions`);
    expect(t).toMatchObject({ status: "needs_review", review_reason: "llm_parsed" });
    expect(Number(t.confidence)).toBeLessThanOrEqual(0.6);
    await db.q(`update merchants set default_category_id = (select id from categories where name='Pendidikan' and kind='expense'), skip_review = true`);
    expect(await count("transactions", "status = 'auto_confirmed'")).toBe(0);
  });

  it("an amount not present in the text is rejected", async () => {
    const box = [kampus("Pembayaran UKT berhasil sebesar Rp 999.000")];
    await runGmail(db, env(fakeFetch(box)), "poll");
    await processLlmJobs(db, env(fakeFetch(box, { llm: llmOk })));
    expect(await count("transactions")).toBe(0);
    expect((await db.q(`select parse_status from ingest_events`))[0].parse_status).toBe("failed");
  });

  it("invalid JSON twice → event failed (Tidak terbaca)", async () => {
    const box = [kampus("Rp 250.000")];
    await runGmail(db, env(fakeFetch(box)), "poll");
    await processLlmJobs(db, env(fakeFetch(box, { llm: () => Response.json({ choices: [{ message: { content: "bukan json" } }] }) })));
    expect((await db.q(`select parse_status from ingest_events`))[0].parse_status).toBe("failed");
    expect((await db.q(`select status, attempts from llm_jobs`))[0]).toMatchObject({ status: "failed", attempts: 2 });
  });

  it("router down → job stays pending with attempts + 1", async () => {
    const box = [kampus("Rp 250.000")];
    await runGmail(db, env(fakeFetch(box)), "poll");
    await processLlmJobs(db, env(fakeFetch(box)));
    expect((await db.q(`select status, attempts from llm_jobs`))[0]).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("LLM switched off → unreadable without a job", async () => {
    await db.q(`update app_settings set llm_enabled = false`);
    await runGmail(db, env(fakeFetch([kampus("Rp 250.000")])), "poll");
    expect(await count("llm_jobs")).toBe(0);
    expect((await db.q(`select parse_status from ingest_events`))[0].parse_status).toBe("unreadable");
  });
});

describe("8.3 categorize suggestions", () => {
  const reply = (o: unknown) => () => Response.json({ choices: [{ message: { content: JSON.stringify(o) } }] });
  const newMerchant = async () => {
    await db.q(`update email_sources set default_account_id = (select id from accounts where name = 'OVO') where parser_id = 'gojek'`);
    const box = [mail("g1", FIXTURES.gojek[0].email, "2026-11-14T04:21:00Z")];
    await runGmail(db, env(fakeFetch(box)), "poll");
    return box;
  };

  it("one job per waiting merchant; the suggestion is stored and the transaction stays needs_review", async () => {
    const box = await newMerchant();
    let sent = "";
    await processLlmJobs(db, env(fakeFetch(box, { llm: (b) => { sent = JSON.stringify(b); return reply({ category_name: "makan & minum", is_transfer: false, confidence: 0.9 })(); } })));
    expect(sent).toContain("Makan & minum");
    const [job] = await db.q(`select status, result from llm_jobs where kind = 'categorize'`);
    expect(job.status).toBe("done");
    expect(job.result).toMatchObject({ category_name: "Makan & minum", is_transfer: false, confidence: 0.9 });
    expect((await db.q(`select status, category_id from transactions`))[0]).toMatchObject({ status: "needs_review", category_id: null });
    await processLlmJobs(db, env(fakeFetch(box, { llm: reply({}) })));
    expect(await count("llm_jobs", "kind = 'categorize'")).toBe(1);
  });

  it("a name outside the owner's categories is no suggestion; LLM off enqueues nothing", async () => {
    const box = await newMerchant();
    await processLlmJobs(db, env(fakeFetch(box, { llm: reply({ category_name: "Kuliner", is_transfer: false, confidence: 0.99 }) })));
    expect((await db.q(`select result from llm_jobs where kind = 'categorize'`))[0].result).toMatchObject({ category_id: null, category_name: null });
    await db.q(`delete from llm_jobs`);
    await db.q(`update app_settings set llm_enabled = false`);
    await processLlmJobs(db, env(fakeFetch(box)));
    expect(await count("llm_jobs")).toBe(0);
  });
});

describe("F-05.3 transfer detection", () => {
  const out = (amount: string, ref: string) => ({ ...mandiriQris(), subject: "Bukti Top-up", text: `Jenis Transaksi : Top-up e-Wallet\nPenerima : OVO\nNominal : ${amount}\nTanggal : 14 Nov 2026\nWaktu : 12:00:00\nNo. Referensi : ${ref}\nSumber Dana : Mandiri ****4821` });

  it("Mandiri −101.000 and OVO +100.000 within 5 minutes → one proposal with Rp 1.000 fee", async () => {
    await runGmail(db, env(fakeFetch([mail("o1", out("Rp 101.000", "T1"), "2026-11-14T05:00:30Z")])), "poll");
    const [ovo] = await db.q(`select id from accounts where name = 'OVO'`);
    await db.q(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: U })]);
    const [t] = await db.q(`insert into transactions (account_id, direction, amount, occurred_at, kind, status, review_reason, source) values ($1,'in',100000,'2026-11-14T05:03:00Z','income','needs_review','transfer_tidak_jelas','webhook') returning id`, [ovo.id]);
    const { proposeTransfer } = await import("../../src/lib/ingest/pipeline");
    await db.tx((q) => proposeTransfer({ q, uid: U, s: { large_amount_threshold: 500000, llm_enabled: true, auto_link_transfers: false, redaction_terms: [] }, now: new Date() }, t.id));
    const props = await db.q(`select type, fee_amount, score from match_proposals where status = 'open'`);
    expect(props).toHaveLength(1);
    expect(props[0]).toMatchObject({ type: "transfer" });
    expect(Number(props[0].fee_amount)).toBe(1000);
  });

  it("a rejected pair is not proposed again; switch off means no auto link", async () => {
    await runGmail(db, env(fakeFetch([mail("o1", out("Rp 100.000", "T2"), "2026-11-14T05:00:30Z")])), "poll");
    const [ovo] = await db.q(`select id from accounts where name = 'OVO'`);
    await db.q(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: U })]);
    const [t] = await db.q(`insert into transactions (account_id, direction, amount, occurred_at, kind, status, review_reason, source, merchant_raw) values ($1,'in',100000,'2026-11-14T05:01:00Z','income','needs_review','transfer_tidak_jelas','webhook','dari Mandiri 4821') returning id`, [ovo.id]);
    const { proposeTransfer } = await import("../../src/lib/ingest/pipeline");
    const ctx = (q: Db["q"]) => ({ q, uid: U, s: { large_amount_threshold: 500000, llm_enabled: true, auto_link_transfers: false, redaction_terms: [] }, now: new Date() });
    await db.tx((q) => proposeTransfer(ctx(q), t.id));
    const [p] = await db.q(`select id, score from match_proposals`);
    expect(Number(p.score)).toBeGreaterThanOrEqual(0.9);
    expect(await count("transfer_links")).toBe(0);
    await db.q(`update match_proposals set status = 'rejected'`);
    await db.tx((q) => proposeTransfer(ctx(q), t.id));
    expect(await count("match_proposals", "status = 'open'")).toBe(0);
  });
});

describe("F-04.6 backfill + retention", () => {
  it("250 messages in 3 runs, progress 250/250, no duplicates on a second import", async () => {
    const box = Array.from({ length: 250 }, (_, i) =>
      mail(`h${i}`, mandiriQris(`Rp ${(2000 + i).toLocaleString("id-ID")},00`, `H${i}`), new Date(Date.parse("2026-09-01T00:00:00Z") + i * 3600_000).toISOString()),
    );
    await db.q(`update integrations set backfill_state = '{"status":"running"}'`);
    for (let i = 0; i < 3; i++) await runGmail(db, env(fakeFetch(box)), "backfill");
    expect((await db.q(`select backfill_state s from integrations`))[0].s).toMatchObject({ status: "done", total: 250, processed: 250 });
    await db.q(`update integrations set backfill_state = '{"status":"running"}'`);
    for (let i = 0; i < 3; i++) await runGmail(db, env(fakeFetch(box)), "backfill");
    expect(await count("transactions")).toBe(250);
  });

  it("maintenance clears raw_text_redacted older than 90 days (injected clock)", async () => {
    await runGmail(db, env(fakeFetch([mail("m1", mandiriQris(), "2026-11-14T10:57:10Z")])), "poll");
    expect((await maintenance(db, new Date("2027-01-01T00:00:00Z"))).purged).toBe(0);
    expect((await maintenance(db, new Date("2027-03-01T00:00:00Z"))).purged).toBe(1);
    expect(await count("ingest_events", "raw_text_redacted is null")).toBe(1);
  });
});

describe("F-04.1 Vault storage (Vault stand-in with the same API)", () => {
  it("integrations holds no token column; disconnect removes the secret and sets terputus", async () => {
    const cols = (await db.q(`select column_name from information_schema.columns where table_name = 'integrations'`)).map((r) => r.column_name);
    expect(cols.some((c: string) => /token/.test(c))).toBe(false);
    expect(await count("vault.secrets")).toBe(1);
    const [r] = await db.q(`select public.take_gmail_secret($1) as t`, [U]);
    expect(r.t).toBe("refresh-token");
    expect(await count("vault.secrets")).toBe(0);
    expect((await db.q(`select status, vault_secret_id from integrations`))[0]).toMatchObject({ status: "terputus", vault_secret_id: null });
  });
});
