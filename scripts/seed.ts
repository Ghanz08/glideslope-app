// Section 5.5 sample data (dev/test only — all numbers are examples). Pin APP_TODAY=2026-11-14 for the golden screens.
// Usage: npm run seed            (fails if the owner already has transactions)
//        npm run seed -- --reset (clears the owner's rows first; local development only)
import { createClient } from "@supabase/supabase-js";
import { normalizeMerchant } from "../src/lib/core/domain";
import { wibToUtcIso } from "../src/lib/core/dates";
import { mandiriQris } from "../tests/fixtures/emails";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const reset = process.argv.includes("--reset");
if (process.env.NODE_ENV === "production" || /supabase\.co/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
  console.error("Seed hanya untuk Supabase lokal.");
  process.exit(1);
}

const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};

async function main() {
  const list = await admin.auth.admin.listUsers();
  if (list.error) throw new Error(`listUsers: ${list.error.message}`);
  const users = list.data;
  // SEED_EMAIL picks a separate test account (e.g. one made with allow_extra_user) instead of the owner
  const owner = process.env.SEED_EMAIL
    ? users.users.find((u) => u.email === process.env.SEED_EMAIL)
    : (users.users.find((u) => !u.app_metadata?.allow_extra_user) ?? users.users[0]);
  if (!owner) throw new Error("Belum ada pemilik. Jalankan `npm run create-owner -- <email> <sandi>` dulu.");
  const uid = owner.id;

  const tables = [
    "receivable_payments", "receivables", "split_assignments", "split_participants", "split_bills", "match_proposals",
    "transaction_evidence", "transfer_links", "asset_events", "asset_prices", "assets", "receipt_items", "receipts",
    "subscriptions", "planned_expenses", "account_checkpoints", "llm_jobs", "ingest_events", "email_sources", "transactions",
    "merchant_aliases", "merchants", "accounts", "categories", "integrations",
  ];
  const existing = await admin.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", uid);
  if ((existing.count ?? 0) > 0 && !reset) throw new Error("Pemilik sudah punya transaksi. Pakai --reset untuk mengosongkan dulu (lokal saja).");
  // never wipe a real owner: --reset only for test accounts unless explicitly forced
  const testOwner = /@contoh\.test$|\.example$/i.test(owner.email ?? "");
  if (reset && !testOwner && process.env.SEED_FORCE_RESET !== "1") {
    throw new Error(`Menolak --reset: ${owner.email} bukan akun uji. Data asli tidak akan dihapus. (Paksa dengan SEED_FORCE_RESET=1 bila memang disengaja.)`);
  }
  if (reset) for (const t of tables) must(await admin.from(t).delete().eq("user_id", uid).select("id").limit(1), `reset ${t}`);

  must(await admin.rpc("bootstrap_user", { p_uid: uid }), "bootstrap");
  must(
    await admin.from("app_settings").update({
      graduation_date: "2028-07-14", emergency_reserve: 30_000_000, large_amount_threshold: 500_000, onboarding_step: 5,
      last_export_at: "2026-11-12T03:00:00Z",
    }).eq("user_id", uid),
    "settings",
  );

  const cats = must(await admin.from("categories").select("id, name, kind").eq("user_id", uid), "categories") as { id: string; name: string; kind: string }[];
  const cat = (n: string, kind = "expense") => cats.find((c) => c.name === n && c.kind === kind)!.id;

  const acct = async (name: string, kind: string, last4: string | null, hints: string[], order: number) =>
    must(await admin.from("accounts").insert({ user_id: uid, name, kind, last4, match_hints: hints, opening_balance: 0, opening_date: "2026-07-01", sort_order: order }).select("id").single(), name) as { id: string };
  const A = {
    Mandiri: (await acct("Mandiri", "bank", "4821", ["mandiri", "livin", "qris"], 0)).id,
    BNI: (await acct("BNI", "bank", "7733", ["bni"], 1)).id,
    OVO: (await acct("OVO", "ewallet", null, ["ovo"], 2)).id,
    DANA: (await acct("DANA", "ewallet", null, ["dana", "gopay"], 3)).id,
    Tunai: (await acct("Tunai", "cash", null, ["tunai", "cash"], 4)).id,
  };
  const target = { Mandiri: 2_350_000, BNI: 1_420_000, OVO: 640_000, DANA: 520_000, Tunai: 280_000 };

  const merchants = new Map<string, string>();
  const merchant = async (name: string, category: string | null, skip = false) => {
    if (merchants.has(name)) return merchants.get(name)!;
    const m = must(await admin.from("merchants").insert({ user_id: uid, display_name: name, match_key: normalizeMerchant(name), default_category_id: category ? cat(category) : null, skip_review: skip }).select("id").single(), name) as { id: string };
    merchants.set(name, m.id);
    return m.id;
  };

  type Tx = { name: string; amount: number; category?: string; account: keyof typeof A; date: string; time?: string; kind?: string; status?: string; reason?: string; source?: string; oneOff?: boolean; dir?: "in" | "out"; known?: boolean };
  const insertTx = async (t: Tx) => {
    const kind = t.kind ?? "expense";
    const status = t.status ?? "confirmed";
    const mId = kind === "expense" ? await merchant(t.name, t.known === false ? null : (t.category ?? null)) : null;
    return (must(
      await admin.from("transactions").insert({
        user_id: uid, account_id: A[t.account], amount: t.amount, kind, direction: t.dir ?? (["income", "repayment"].includes(kind) ? "in" : "out"),
        occurred_at: wibToUtcIso(t.date, t.time ?? "12:00:00"), category_id: t.category && status !== "needs_review" ? cat(t.category, kind === "income" ? "income" : "expense") : t.category ? cat(t.category) : null,
        merchant_id: mId, merchant_raw: t.name, status, review_reason: t.reason ?? null, source: t.source ?? "manual", is_one_off: !!t.oneOff,
        confidence: t.source && t.source !== "manual" ? (status === "needs_review" ? 0.7 : 0.95) : null,
      }).select("id").single(),
      t.name,
    ) as { id: string }).id;
  };

  // Aug–Oct: 8 routine rows of exactly Rp 8.400.000 per month; Aug also has a one-off semester fee.
  const monthly: [string, number, string, keyof typeof A, number][] = [
    ["Kos Melati", 2_500_000, "Rumah tangga", "BNI", 1], ["Warung makan langganan", 1_850_000, "Makan & minum", "Tunai", 5],
    ["Belanja bulanan", 1_200_000, "Belanja", "Mandiri", 8], ["GoRide & Grab", 900_000, "Transportasi", "OVO", 10],
    ["Langganan musik", 54_990, "Hiburan", "OVO", 13], ["Kedai Kopi Senja", 650_000, "Makan & minum", "Mandiri", 15],
    ["Pulsa & internet", 345_010, "Tagihan & langganan", "DANA", 20], ["Apotek Sehat", 900_000, "Kesehatan", "Mandiri", 25],
  ];
  for (const m of ["2026-08", "2026-09", "2026-10"])
    for (const [name, amount, category, account, day] of monthly)
      await insertTx({ name, amount, category, account, date: `${m}-${String(day).padStart(2, "0")}` });
  await insertTx({ name: "Biaya semester", amount: 9_000_000, category: "Pendidikan", account: "Mandiri", date: "2026-08-14", oneOff: true });

  // November up to the 14th: Rp 4.280.000 including the open Inbox items.
  for (const [name, amount, category, account, date] of [
    ["Kos Melati", 2_500_000, "Rumah tangga", "BNI", "2026-11-01"], ["Belanja bulanan", 900_000, "Belanja", "Mandiri", "2026-11-05"],
    ["Pulsa & internet", 345_010, "Tagihan & langganan", "DANA", "2026-11-07"], ["GoRide & Grab", 91_500, "Transportasi", "OVO", "2026-11-09"],
  ] as const) await insertTx({ name, amount, category, account, date });
  await insertTx({ name: "Langganan musik", amount: 54_990, category: "Hiburan", account: "OVO", date: "2026-11-13", time: "10:00:00", source: "email", status: "auto_confirmed" });
  await merchant("Laundry Mawar", "Rumah tangga", true);
  const kopi = await insertTx({ name: "Kedai Kopi Senja", amount: 28_000, category: "Makan & minum", account: "Mandiri", date: "2026-11-14", time: "19:00:00", source: "email", status: "auto_confirmed" });
  await insertTx({ name: "Laundry Mawar", amount: 35_000, category: "Rumah tangga", account: "Mandiri", date: "2026-11-14", time: "16:00:00" });
  await insertTx({ name: "Ayam Geprek Pak Eko", amount: 22_000, category: "Makan & minum", account: "Tunai", date: "2026-11-14", time: "12:30:00" });

  // Email + receipt evidence helpers
  const sources = must(await admin.from("email_sources").insert([
    ["noreply@livin.mandiri.example", "Mandiri", "mandiri", A.Mandiri], ["no-reply@grab.example", "Grab", "grab", A.OVO],
    ["info@shopee.example", "Shopee", "shopee", null], ["googleplay-noreply@google.example", "Google Play", "google_play", A.OVO],
    ["receipt@esb.example", "ESB", "esb", null], ["no-reply@gojek.example", "Gojek", "gojek", A.DANA],
  ].map(([sender_address, label, parser_id, default_account_id]) => ({ user_id: uid, sender_address, label, parser_id, default_account_id, last_seen_at: "2026-11-14T10:57:10Z" }))).select("id, parser_id"), "sources") as { id: string; parser_id: string }[];
  const src = (p: string) => sources.find((s) => s.parser_id === p)!.id;
  let n = 0;
  const email = async (tx: string, parser: string, amount: number, at: string, subject: string) => {
    const ev = must(await admin.from("ingest_events").insert({ user_id: uid, channel: "gmail", external_id: `seed-${++n}`, source_id: src(parser), sender: `${parser}@seed.example`, subject, received_at: at, parser_id: parser, parse_status: "parsed", parsed: { amount } }).select("id").single(), "event") as { id: string };
    must(await admin.from("transaction_evidence").insert({ user_id: uid, transaction_id: tx, role: "email", ingest_event_id: ev.id, parsed_amount: amount }), "evidence");
  };
  const receipt = async (name: string, at: string, items: [string, number][], tax = 0, status = "confirmed") => {
    const subtotal = items.reduce((a, [, v]) => a + v, 0);
    const r = must(await admin.from("receipts").insert({ user_id: uid, status, merchant_name: name, occurred_at: at, subtotal, tax_amount: tax, tax_rate_pct: tax ? 10 : null, total: subtotal + tax, validation_ok: true }).select("id").single(), "receipt") as { id: string };
    must(await admin.from("receipt_items").insert(items.map(([iname, v], i) => ({ user_id: uid, receipt_id: r.id, position: i + 1, name: iname, quantity: 1, unit_price: v, line_total: v }))), "items");
    return r.id;
  };
  const link = async (tx: string, rid: string, amount: number) => {
    must(await admin.from("transaction_evidence").insert({ user_id: uid, transaction_id: tx, role: "receipt", receipt_id: rid, parsed_amount: amount, match_score: 0.95 }), "receipt evidence");
    must(await admin.from("receipts").update({ linked_transaction_id: tx }).eq("id", rid), "link");
  };
  await email(kopi, "mandiri", 28_000, wibToUtcIso("2026-11-14", "19:00:00"), "Bukti Transaksi QRIS");
  await link(kopi, await receipt("Kedai Kopi Senja", wibToUtcIso("2026-11-14", "19:00:00"), [["Kopi susu", 28_000]]), 28_000);

  // Inbox: 7 open items
  const mie = await insertTx({ name: "PT Solusi Kasir Digital", amount: 40_000, account: "Mandiri", date: "2026-11-14", time: "17:57:04", source: "email", status: "needs_review", reason: "merchant_baru", known: false });
  await email(mie, "mandiri", 40_000, wibToUtcIso("2026-11-14", "17:57:04"), mandiriQris().subject);
  const nota = await receipt("Warung Mie Pak Dani", wibToUtcIso("2026-11-14", "17:57:00"), [["Mie ayam spesial", 12_727], ["Pangsit goreng", 9_091], ["Es jeruk", 8_182], ["Es teh", 6_364]], 3_636);
  must(await admin.from("match_proposals").insert({ user_id: uid, type: "receipt_link", transaction_id: mie, receipt_id: nota, score: 0.85 }), "proposal");
  const obat = await insertTx({ name: "Toko Obat Sehat", amount: 63_500, account: "DANA", date: "2026-11-14", time: "14:10:00", source: "email", status: "needs_review", reason: "merchant_baru", known: false });
  await email(obat, "gojek", 63_500, wibToUtcIso("2026-11-14", "14:10:00"), "Struk GoMart");
  const rina = await insertTx({ name: "RINA AYU", amount: 150_000, account: "BNI", date: "2026-11-14", time: "08:00:00", kind: "income", source: "email", status: "needs_review", reason: "transfer_tidak_jelas" });
  await email(rina, "mandiri", 150_000, wibToUtcIso("2026-11-14", "08:00:00"), "Transfer Masuk");
  const jus = await insertTx({ name: "Kedai Jus Taman", amount: 15_000, account: "Tunai", date: "2026-11-14", time: "15:00:00", source: "receipt", status: "needs_review", reason: "hanya_nota", known: false });
  await link(jus, await receipt("Kedai Jus Taman", wibToUtcIso("2026-11-14", "15:00:00"), [["Jus alpukat", 15_000]]), 15_000);
  for (const [name, amount, account, time, parser] of [["Ayam Bakar Bu Sri", 48_000, "OVO", "12:30:00", "grab"], ["Es Teh Solo", 12_000, "Tunai", "11:00:00", "esb"]] as const) {
    const id = await insertTx({ name, amount, account, date: "2026-11-14", time, source: "email", status: "needs_review", reason: "merchant_baru", known: false });
    await email(id, parser, amount, wibToUtcIso("2026-11-14", time), "Struk");
    await link(id, await receipt(name, wibToUtcIso("2026-11-14", time), [[name, amount]]), amount);
  }
  const bangunan = await insertTx({ name: "Toko Bangunan Jaya", amount: 125_000, account: "Mandiri", date: "2026-11-14", time: "10:30:00", source: "receipt", status: "needs_review", reason: "hanya_nota", known: false });
  await link(bangunan, await receipt("Toko Bangunan Jaya", wibToUtcIso("2026-11-14", "10:30:00"), [["Cat tembok 1 kg", 125_000]]), 125_000);

  // Receivables: Rina 640.000 and Budi 1.000.000 open (Budi already paid 105.000 today)
  for (const [person, total, paid] of [["Rina", 640_000, 0], ["Budi", 1_105_000, 105_000]] as const) {
    const rid = await receipt(`Makan bersama ${person}`, wibToUtcIso("2026-11-02", "19:00:00"), [["Paket makan", total * 2]], 0, "confirmed");
    const sb = must(await admin.from("split_bills").insert({ user_id: uid, receipt_id: rid, title: `Makan bersama ${person}`, occurred_on: "2026-11-02", total: total * 2, status: "shared", shared_at: "2026-11-02T12:00:00Z" }).select("id").single(), "split") as { id: string };
    const parts = must(await admin.from("split_participants").insert([
      { user_id: uid, split_bill_id: sb.id, name: "Aku", is_owner: true, share_amount: total, position: 1 },
      { user_id: uid, split_bill_id: sb.id, name: person, is_owner: false, share_amount: total, position: 2, phone_digits: person === "Budi" ? "6281234567890" : null },
    ]).select("id, is_owner"), "participants") as { id: string; is_owner: boolean }[];
    const rec = must(await admin.from("receivables").insert({ user_id: uid, split_participant_id: parts.find((p) => !p.is_owner)!.id, person_name: person, amount: total, remaining: total - paid, status: paid ? "partially_paid" : "open" }).select("id").single(), "receivable") as { id: string };
    if (paid) {
      const tx = await insertTx({ name: "Budi · pelunasan split bill", amount: paid, account: "BNI", date: "2026-11-14", time: "09:00:00", kind: "repayment" });
      must(await admin.from("receivable_payments").insert({ user_id: uid, receivable_id: rec.id, transaction_id: tx, amount: paid }), "payment");
    }
  }

  // Assets (prices on 31 Oct give the −Rp 212.000 market change of Table 5.4-G)
  const asset = async (name: string, type: string, quantity: number, prices: [string, number][], extra: Record<string, unknown> = {}) => {
    const a = must(await admin.from("assets").insert({ user_id: uid, name, type, quantity, ...extra }).select("id").single(), name) as { id: string };
    must(await admin.from("asset_prices").insert(prices.map(([as_of, unit_price]) => ({ user_id: uid, asset_id: a.id, as_of, unit_price }))), `${name} prices`);
  };
  await asset("Reksa dana pasar uang", "money_market_fund", 50_000, [["2026-10-31", 1198.08], ["2026-11-10", 1200]]);
  await asset("Deposito A", "deposit", 1, [["2026-10-01", 50_000_000]], { maturity_date: "2027-02-14", destination_account_id: A.Mandiri, interest_rate_pa: 4.5 });
  await asset("Deposito B", "deposit", 1, [["2026-10-01", 50_000_000]], { maturity_date: "2027-06-14", destination_account_id: A.Mandiri, interest_rate_pa: 4.5 });
  await asset("Deposito C", "deposit", 1, [["2026-10-01", 40_000_000]], { maturity_date: "2027-11-14", destination_account_id: A.BNI, interest_rate_pa: 4.25 });
  await asset("Emas", "gold", 16.5, [["2026-10-31", 2_558_727.2727], ["2026-11-10", 2_526_000]]);
  await asset("Reksa dana saham & campuran", "equity_fund", 25, [["2026-10-31", 1_595_160], ["2026-11-10", 1_604_440]]);

  must(await admin.from("planned_expenses").insert({ user_id: uid, label: "Biaya semester", amount: 9_000_000, due_on: "2027-02-14", repeat_months: 6, repeat_until: "2028-02-14", category_id: cat("Pendidikan") }), "planned");

  // opening balances so that today's computed balance equals the target
  for (const [name, id] of Object.entries(A)) {
    const net = Number(must(await admin.rpc("account_balance_at", { p_account: id, p_as_of: "2026-11-14" }), "balance"));
    must(await admin.from("accounts").update({ opening_balance: target[name as keyof typeof target] - net }).eq("id", id), "opening");
  }
  console.log("Seed selesai untuk", owner.email, "— jalankan app dengan APP_TODAY=2026-11-14.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
