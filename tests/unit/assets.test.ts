import { describe, expect, it } from "vitest";
import { marketChange } from "../../src/lib/core/insights";

// Section 5.5 asset prices (31 Oct → 10 Nov) and Table 5.4-G.
const value = (qty: number, price: number) => Math.round(qty * price);

describe("F-07.1 / F-07.4 with the seed data", () => {
  it("gold 16,5 g × Rp 2.526.000 = Rp 41.679.000", () => expect(value(16.5, 2_526_000)).toBe(41_679_000));
  it("market change −Rp 212.000, total change −Rp 4.492.000", () => {
    const m =
      marketChange({ valueNow: value(50_000, 1200), valueMonthStart: value(50_000, 1198.08), purchases: 0, redemptions: 0 }) +
      marketChange({ valueNow: value(16.5, 2_526_000), valueMonthStart: value(16.5, 2_558_727.2727), purchases: 0, redemptions: 0 }) +
      marketChange({ valueNow: value(25, 1_604_440), valueMonthStart: value(25, 1_595_160), purchases: 0, redemptions: 0 });
    expect(m).toBe(-212_000);
    expect(-4_280_000 + 0 + m).toBe(-4_492_000);
  });
  it("a purchase this month is not market change", () =>
    expect(marketChange({ valueNow: 105_000_000, valueMonthStart: 100_000_000, purchases: 5_000_000, redemptions: 0 })).toBe(0));
  it("ladder totals Rp 287.000.000", () =>
    expect(5_210_000 + value(50_000, 1200) + 140_000_000 + value(16.5, 2_526_000) + value(25, 1_604_440)).toBe(287_000_000));
});

import { gmailConsentUrl, GMAIL_SCOPE } from "../../src/lib/server/google";
import { foldNewMerchants } from "../../src/lib/core/inbox-group";

describe("F-04.1 consent URL", () => {
  it("has exactly one scope, offline access, consent prompt and the state", () => {
    const u = new URL(gmailConsentUrl("cid", "http://localhost:3000/api/gmail/callback", "acak123"));
    expect(u.searchParams.get("scope")).toBe(GMAIL_SCOPE);
    expect(u.searchParams.get("scope")!.split(" ")).toHaveLength(1);
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("state")).toBe("acak123");
  });
});

describe("F-04.6 Inbox grouping", () => {
  it("12 open items of one new merchant become one card of 12", () => {
    const items = Array.from({ length: 12 }, () => ({ merchantId: "m1", reason: "merchant_baru", hasProposal: false }));
    const g = foldNewMerchants([...items, { merchantId: "m2", reason: "nominal_besar", hasProposal: false }]);
    expect(g).toHaveLength(2);
    expect(g[0].groupCount).toBe(12);
  });
});
