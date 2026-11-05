import { describe, expect, it } from "vitest";
import { formatRupiah, formatSigned, isWholeRupiah, parseRupiah } from "./money";
import { addMonths, formatDate, monthsBetween, wibDate, wibToUtcIso } from "./dates";
import {
  displayName, monogram, toneFor, topUpTarget,
  assessConfidence, balanceLabel, largestRemainder, normalizeMerchant, percentages, receiptScore, redact,
  repaymentScore, transferScore, validateReceipt,
} from "./domain";
import { parseEmail, parseIdDateTime, PARSER_IDS } from "./parsers";
import { allocateSplit, billMessage, waLink } from "./split";
import { detectSubscription, labelSummary, ladderRows, marketChange, monthlyCoupon, parseQuickAdd } from "./insights";
import { FIXTURES, mandiriQris } from "../../../tests/fixtures/emails";

describe("parseRupiah — Table 5.4-E", () => {
  it.each([
    ["Rp 17.201,00", 17201],
    ["Rp 19800", 19800],
    ["IDR 255.190,00", 255190],
    ["Rp 819,376", 819376],
    ["Rp517,500", 517500],
    ["Rp 1,250,000.00", 1250000],
    ["Rp 2.350.000", 2350000],
  ])("%s → %d", (s, n) => expect(parseRupiah(s)).toBe(n));
  it.each(["Rp 12.5", "Rp 0", "abc", "Rp 1.2345", "Rp 1,250,000.50"])("%s → null", (s) => expect(parseRupiah(s)).toBeNull());
});

describe("format", () => {
  it("formats rupiah", () => {
    expect(formatRupiah(1250000)).toBe("Rp 1.250.000");
    expect(formatRupiah(-12000)).toBe("−Rp 12.000");
    expect(formatSigned(105000)).toBe("+Rp 105.000");
    expect(formatSigned(-4492000)).toBe("−Rp 4.492.000");
  });
  it("rejects decimal opening balances", () => {
    expect(isWholeRupiah("1.5")).toBe(false);
    expect(isWholeRupiah("2.350.000")).toBe(true);
  });
  it("dates in WIB", () => {
    expect(wibDate("2026-11-14T17:30:00Z")).toBe("2026-11-15");
    expect(wibToUtcIso("2026-11-14", "17:57:04")).toBe("2026-11-14T10:57:04.000Z");
    expect(formatDate("2026-11-14")).toBe("14 Nov 2026");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(monthsBetween("2026-11-14", "2028-07-14")).toBe(20);
  });
});

describe("normalizeMerchant (F-03.5)", () => {
  it("drops legal forms and punctuation", () => {
    expect(normalizeMerchant("PT Solusi Kasir Digital")).toBe(normalizeMerchant("Solusi Kasir Digital"));
    expect(normalizeMerchant("Toko Obat, Sehat Tbk.")).toBe("toko obat sehat");
  });
  it("keeps digits-only names as-is", () => expect(normalizeMerchant("12345")).toBe("12345"));
});

describe("assessConfidence — Table 5.4-A", () => {
  const base = {
    viaLlm: false, accountUnknown: false, amount: 28000, threshold: 500000, duplicateSuspect: false, kindUnclear: false,
    receiptOnly: false, merchantHasDefaultCategory: true, merchantSkipReview: false, requiredFieldsComplete: true,
  };
  it("known merchant, small amount → auto_confirmed", () => expect(assessConfidence(base).status).toBe("auto_confirmed"));
  it("new merchant → merchant_baru", () =>
    expect(assessConfidence({ ...base, merchantHasDefaultCategory: false }).reason).toBe("merchant_baru"));
  it("LLM never auto-confirms, confidence ≤ 0.6", () => {
    const r = assessConfidence({ ...base, viaLlm: true, merchantSkipReview: true });
    expect(r).toMatchObject({ status: "needs_review", reason: "llm_parsed" });
    expect(r.confidence).toBeLessThanOrEqual(0.6);
  });
  it("amount ≥ threshold beats skip_review", () =>
    expect(assessConfidence({ ...base, amount: 500000, merchantSkipReview: true }).reason).toBe("nominal_besar"));
  it("skip_review bypasses transfer_tidak_jelas", () =>
    expect(assessConfidence({ ...base, kindUnclear: true, merchantSkipReview: true }).status).toBe("auto_confirmed"));
  it("priority: account unknown before large amount", () =>
    expect(assessConfidence({ ...base, accountUnknown: true, amount: 9e6 }).reason).toBe("akun_tidak_dikenal"));
});

describe("matching scores — Table 5.4-F", () => {
  const out = { id: "a", account_id: "mandiri", direction: "out" as const, amount: 101000, occurred_at: "2026-11-14T05:00:00Z" };
  const inn = { id: "b", account_id: "ovo", direction: "in" as const, amount: 100000, occurred_at: "2026-11-14T05:05:00Z" };
  it("transfer with Rp 1.000 fee within 5 minutes", () => expect(transferScore(out, inn)).toEqual({ score: 0.8, fee: 1000 }));
  it("fee outside list is not a candidate", () => expect(transferScore({ ...out, amount: 103000 }, inn)).toBeNull());
  it("same account is not a candidate", () => expect(transferScore(out, { ...inn, account_id: "mandiri" })).toBeNull());
  it("receipt 10 s apart → ≥ 0.85 even with different names", () => {
    const s = receiptScore(
      { total: 40000, occurred_at: "2026-11-14T10:57:00Z", merchant: "Warung Mie Pak Dani" },
      { amount: 40000, occurred_at: "2026-11-14T10:57:04Z", merchant: "PT Solusi Kasir Digital" },
    );
    expect(s).toBeGreaterThanOrEqual(0.85);
  });
  it("receipt without time scores 0 for time", () =>
    expect(receiptScore({ total: 1, occurred_at: null, merchant: null }, { amount: 1, occurred_at: "2026-01-01", merchant: null })).toBe(0.6));
  it("repayment exact with name", () =>
    expect(repaymentScore({ amount: 105000, occurred_at: "2026-11-14T00:00:00Z", text: "Transfer dari BUDI" },
      { remaining: 105000, person_name: "Budi", shared_at: "2026-11-10T00:00:00Z" })).toBe(0.9));
  it("repayment older than 30 days is ignored", () =>
    expect(repaymentScore({ amount: 1, occurred_at: "2026-12-30T00:00:00Z", text: "" },
      { remaining: 5, person_name: "x", shared_at: "2026-11-01T00:00:00Z" })).toBeNull());
});

describe("largest remainder", () => {
  it("100.000 / 3 → 33.334, 33.333, 33.333", () => expect(largestRemainder(100000, [1, 1, 1])).toEqual([33334, 33333, 33333]));
  it("ladder percentages add to 100,0", () => {
    const p = percentages([5210000, 60000000, 140000000, 41679000, 40111000]);
    expect(p).toEqual([1.8, 20.9, 48.8, 14.5, 14]);
    expect(Math.round(p.reduce((a, b) => a + b, 0) * 10)).toBe(1000);
  });
  it("ladder hides empty asset types and keeps order", () => {
    const l = ladderRows({ cash: 10, deposit: 10 });
    expect(l.rows.map((r) => r.key)).toEqual(["cash", "deposit"]);
  });
});

describe("balanceLabel — Table 5.4-H", () => {
  it("match", () =>
    expect(balanceLabel({ today: "2026-11-14", checkpoint: { as_of: "2026-10-31", balance: 5, computed: 5 }, hasAutoSource30d: true }).text)
      .toBe("Cocok statement Okt"));
  it("difference", () =>
    expect(balanceLabel({ today: "2026-11-14", checkpoint: { as_of: "2026-11-10", balance: 2362000, computed: 2350000 }, hasAutoSource30d: false }).text)
      .toBe("Selisih Rp 12.000"));
  it("old checkpoint ignored → email", () =>
    expect(balanceLabel({ today: "2026-11-14", checkpoint: { as_of: "2026-01-01", balance: 1, computed: 2 }, hasAutoSource30d: true }).kind).toBe("email"));
  it("manual", () => expect(balanceLabel({ today: "2026-11-14", checkpoint: null, hasAutoSource30d: false }).text).toBe("Diisi manual"));
});

describe("validateReceipt — Table 5.4-I", () => {
  const items = [12727, 9091, 8182, 6364].map((p) => ({ quantity: 1, unit_price: p, line_total: p }));
  const seed = { items, subtotal: 36364, service_charge: 0, tax_amount: 3636, discount: 0, rounding: 0, total: 40000 };
  it("seed receipt passes", () => expect(validateReceipt(seed).ok).toBe(true));
  it("total off by 5.000 fails on total", () => expect(validateReceipt({ ...seed, total: 45000 }).problems).toContain("total"));
  it("negative rounding allowed", () => expect(validateReceipt({ ...seed, rounding: -50, total: 39950 }).ok).toBe(true));
});

describe("redact (8.3)", () => {
  it("masks long digit runs, emails, phones and terms", () => {
    const s = redact("Rek 1234567890123 a@b.co 081234567890 Budi Santoso", ["Budi Santoso"]);
    expect(s).toContain("••••0123");
    expect(s).toContain("[email]");
    expect(s).toContain("[telepon]");
    expect(s).toContain("[nama]");
    expect(s).not.toMatch(/\d{8,}/);
  });
});

describe("parsers — every fixture (F-04.3)", () => {
  for (const id of PARSER_IDS) {
    it(`${id} has ≥ 5 fixtures`, () => expect(FIXTURES[id].length).toBeGreaterThanOrEqual(5));
    for (const f of FIXTURES[id]) {
      it(`${id}: ${f.name} → ${f.expect}`, () => {
        const r = parseEmail(id, f.email);
        expect(r.status).toBe(f.expect);
        if (f.amounts) {
          expect(r.transactions.map((t) => t.amount)).toEqual(f.amounts);
          for (const t of r.transactions) {
            expect(t.dedupe_key.startsWith(`${id}:`)).toBe(true);
            expect(Date.parse(t.occurred_at)).not.toBeNaN();
            expect(["in", "out"]).toContain(t.direction);
            if (t.kind_hint === "expense") expect(t.merchant_raw).toBeTruthy();
          }
        }
      });
    }
  }
  it("Mandiri QRIS: amount, direction, dedupe ref, merchant", () => {
    const t = parseEmail("mandiri", mandiriQris()).transactions[0];
    expect(t).toMatchObject({ amount: 40000, direction: "out", merchant_raw: "PT Solusi Kasir Digital" });
    expect(t.dedupe_key).toContain("123456787890");
    expect(t.occurred_at).toBe("2026-11-14T10:57:04.000Z");
  });
  it("random text never throws", () => {
    for (const id of PARSER_IDS) expect(parseEmail(id, { from: "", subject: "", text: "%%%\u0000", date: "" }).status).toBe("failed");
  });
  it("dates without zone are WIB", () => expect(parseIdDateTime("14 Nov 2026", "17:57")).toBe("2026-11-14T10:57:00.000Z"));
});

describe("split allocation — Table 5.4-D", () => {
  const people = [
    { id: "me", name: "Aku", is_owner: true },
    { id: "b", name: "Budi", is_owner: false },
  ];
  it("seed receipt split between two people sums to 40.000", () => {
    const items = [12727, 9091, 8182, 6364].map((v, i) => ({ id: `i${i}`, name: `x${i}`, line_total: v }));
    const as = items.map((it, i) => ({ item_id: it.id, participant_id: i < 2 ? "me" : "b", weight: 1 }));
    const r = allocateSplit({ total: 40000, service_charge: 0, tax_amount: 3636, discount: 0, rounding: 0, tax_base: "items_plus_service" }, items, people, as);
    expect(r.shares.me + r.shares.b).toBe(40000);
    expect(r.sumOk).toBe(true);
  });
  it("service charge is proportional, not per person", () => {
    const items = [{ id: "a", name: "a", line_total: 30000 }, { id: "b", name: "b", line_total: 10000 }];
    const r = allocateSplit({ total: 42000, service_charge: 2000, tax_amount: 0, discount: 0, rounding: 0, tax_base: "items" }, items, people,
      [{ item_id: "a", participant_id: "me", weight: 1 }, { item_id: "b", participant_id: "b", weight: 1 }]);
    expect(r.shares).toEqual({ me: 31500, b: 10500 });
  });
  it("unassigned items block sharing", () => {
    const r = allocateSplit({ total: 10, service_charge: 0, tax_amount: 0, discount: 0, rounding: 0, tax_base: "items" },
      [{ id: "a", name: "a", line_total: 10 }], people, []);
    expect(r.unassigned).toEqual(["a"]);
    expect(r.sumOk).toBe(false);
  });
  it("20 random cases incl. 10% and 11% tax always sum to the receipt total", () => {
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    for (let c = 0; c < 24; c++) {
      const n = 2 + rnd(5);
      const ps = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `p${i}`, is_owner: i === 0 }));
      const items = Array.from({ length: 1 + rnd(8) }, (_, i) => ({ id: `i${i}`, name: `i${i}`, line_total: 1000 + rnd(90000) }));
      const sub = items.reduce((a, i) => a + i.line_total, 0);
      const service = c % 3 === 0 ? Math.round(sub * 0.05) : 0;
      const discount = c % 4 === 0 ? Math.min(sub, 5000) : 0;
      const tax = Math.round((sub + service - discount) * (c % 2 ? 0.11 : 0.1));
      const total = sub + service - discount + tax;
      const as = items.flatMap((it) => ps.filter(() => rnd(2)).map((p) => ({ item_id: it.id, participant_id: p.id, weight: 1 + rnd(3) })));
      for (const it of items) if (!as.some((a) => a.item_id === it.id)) as.push({ item_id: it.id, participant_id: "p0", weight: 1 });
      const r = allocateSplit({ total, service_charge: service, tax_amount: tax, discount, rounding: 0, tax_base: "items_plus_service" }, items, ps, as);
      expect(Object.values(r.shares).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe("WhatsApp (F-10.2)", () => {
  const msg = billMessage({ name: "Budi", title: "Makan malam", date: "14 Nov 2026", items: [{ name: "Mie", amount: 105000 }], share: 105000, paymentInstructions: null });
  it("link with number", () => expect(waLink("6281234567890", msg)).toMatch(/^https:\/\/wa\.me\/6281234567890\?text=/));
  it("link without number", () => expect(waLink(null, msg)).toMatch(/^https:\/\/wa\.me\/\?text=/));
  it("contains the share and no account number", () => {
    expect(msg).toContain("Rp 105.000");
    expect(msg).not.toMatch(/\d{8,}/);
  });
  it("long messages are cut to ≤ 1.500 chars", () => {
    const long = billMessage({ name: "B", title: "t", date: "d", items: Array.from({ length: 200 }, (_, i) => ({ name: `Item ${i}`, amount: 1000 })), share: 1, paymentInstructions: null });
    expect(long.length).toBeLessThanOrEqual(1500);
    expect(long).toContain("…lihat rincian dari pemilik");
  });
});

describe("quick add (F-12.4)", () => {
  it("kopi 28rb ovo", () => expect(parseQuickAdd("kopi 28rb ovo", ["Mandiri", "OVO"])).toMatchObject({ amount: 28000, merchant: "kopi", account: "OVO" }));
  it("laptop 12,5jt", () => expect(parseQuickAdd("laptop 12,5jt", []).amount).toBe(12500000));
  it("no number", () => expect(parseQuickAdd("makan siang", []).amount).toBeNull());
  it("two plain numbers are ambiguous", () => expect(parseQuickAdd("beli 2 kopi 30000", []).candidates).toEqual([2, 30000]));
});

describe("subscriptions (F-11.2)", () => {
  it("3 monthly payments → suggestion", () => {
    const s = detectSubscription([{ date: "2026-09-13", amount: 54990 }, { date: "2026-10-13", amount: 54990 }, { date: "2026-11-12", amount: 54990 }]);
    expect(s).toMatchObject({ period: "monthly", avg_amount: 54990 });
  });
  it("2 payments → none", () => expect(detectSubscription([{ date: "2026-10-13", amount: 1 }, { date: "2026-11-12", amount: 1 }])).toBeNull());
  it("price jump > 10% breaks the run", () =>
    expect(detectSubscription([{ date: "2026-09-13", amount: 50000 }, { date: "2026-10-13", amount: 50000 }, { date: "2026-11-12", amount: 70000 }])).toBeNull());
});

describe("market change (5.4-G)", () => {
  it("excludes purchases", () => expect(marketChange({ valueNow: 105, valueMonthStart: 100, purchases: 5, redemptions: 0 })).toBe(0));
  it("no start price → 0", () => expect(marketChange({ valueNow: 5, valueMonthStart: null, purchases: 0, redemptions: 0 })).toBe(0));
});

import { LIVIN_REAL } from "../../../tests/fixtures/emails";
describe("Mandiri parser on real Livin layouts", () => {
  for (const f of LIVIN_REAL) {
    it(f.name, () => {
      const r = parseEmail("mandiri", f.email);
      expect(r.status).toBe("parsed");
      expect(r.transactions.map((t) => t.amount)).toEqual(f.amounts);
      expect(r.transactions.map((t) => t.kind_hint)).toEqual(f.kinds);
      expect(r.transactions[0].merchant_raw).toBe(f.merchant);
      expect(r.transactions[0].account_hint).toContain("0706");
      expect(new Set(r.transactions.map((t) => t.dedupe_key)).size).toBe(r.transactions.length);
    });
  }
  it("QR payment time is WIB", () => expect(parseEmail("mandiri", LIVIN_REAL[0].email).transactions[0].occurred_at).toBe("2026-09-17T10:58:38.000Z"));
});

describe("merchant display", () => {
  it("title-cases shouted names but keeps short acronyms", () => {
    expect(displayName("SITI NUR AISYAH")).toBe("Siti Nur Aisyah");
    expect(displayName("PT SOLUSI KASIR DIGITAL")).toBe("PT Solusi Kasir Digital");
    expect(displayName("Kedai Kopi Senja")).toBe("Kedai Kopi Senja");
    expect(displayName("TOKO ABC BNI")).toBe("Toko ABC BNI");
    expect(displayName("Transfer masuk · RINA AYU")).toBe("Transfer masuk · Rina Ayu");
  });
  it("monogram skips legal prefixes", () => {
    expect(monogram("PT Solusi Kasir Digital")).toBe("SK");
    expect(monogram("Indomaret")).toBe("IN");
    expect(monogram("OVO ****1234")).toBe("OV");
    expect(monogram("")).toBe("?");
  });
  it("tone is stable per merchant", () => {
    expect(toneFor("Toko Obat Sehat")).toBe(toneFor("TOKO OBAT SEHAT"));
  });
});

describe("labelSummary (F-08.4)", () => {
  const rows = [
    { amount: 15_040_000, kind: "expense", status: "needs_review" },
    { amount: 2_500_000, kind: "expense", status: "confirmed" },
    { amount: 6_500, kind: "fee", status: "confirmed" },
    { amount: 1_000_000, kind: "expense", status: "ignored" },
    { amount: 500_000, kind: "income", status: "confirmed" },
    { amount: 700_000, kind: "expense", status: "confirmed", deleted_at: "2026-11-01T00:00:00Z" },
  ];
  it("counts expense and fee only, skipping ignored and deleted", () => {
    expect(labelSummary(rows, null)).toEqual({ spent: 17_546_500, count: 3, remaining: null, pct: null });
  });
  it("remaining and percent against a target, capped at 100", () => {
    expect(labelSummary(rows, 35_000_000)).toMatchObject({ remaining: 17_453_500, pct: 50.1 });
    expect(labelSummary(rows, 10_000_000)).toMatchObject({ remaining: 0, pct: 100 });
  });
});

describe("monthlyCoupon (F-07.1 bonds)", () => {
  it("ORI: Rp 50 jt at 6,9% → Rp 258.750 net per month after 10% tax", () => {
    expect(monthlyCoupon(50_000_000, 6.9)).toBe(258_750);
  });
  it("gross when tax is 0", () => {
    expect(monthlyCoupon(50_000_000, 6.9, 0)).toBe(287_500);
  });
});

describe("topUpTarget (F-03.3)", () => {
  const wallets = [
    { id: "ovo", name: "OVO", match_hints: ["ovo"] },
    { id: "gopay", name: "GoPay", match_hints: ["gopay"] },
    { id: "dana", name: "DANA", match_hints: ["dana"] },
    { id: "bisnis", name: "DANA Bisnis", match_hints: [] },
  ];
  it("matches the wallet named in a Livin' top-up recipient", () => {
    expect(topUpTarget("OVO", wallets)?.id).toBe("ovo");
    expect(topUpTarget("GoPay Customer", wallets)?.id).toBe("gopay");
  });
  it("a different wallet number is someone else's wallet", () => {
    const own = [{ id: "sp", name: "ShopeePay", match_hints: ["shopeepay"], last4: "1234" }];
    expect(topUpTarget("ShopeePay ****1234", own)?.id).toBe("sp");
    expect(topUpTarget("ShopeePay ****5678", own)).toBeUndefined();
  });
  it("no wallet named means no target", () => {
    expect(topUpTarget("ROHMAN GHOZALI", wallets)).toBeUndefined();
    expect(topUpTarget(null, wallets)).toBeUndefined();
  });
});
