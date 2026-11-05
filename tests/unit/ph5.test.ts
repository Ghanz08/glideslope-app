import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { categoryBreakdown, monthDelta } from "../../src/lib/core/insights";
import { crc32, csvCell, zip } from "../../src/lib/core/zip";
import { formatPct, formatSigned } from "../../src/lib/core/money";

describe("F-08.2", () => {
  it("4 categories sorted descending, shares add to 100,0", () => {
    const b = categoryBreakdown([
      { category_id: "a", effective: 1000 }, { category_id: "b", effective: 5000 }, { category_id: "c", effective: 3333 }, { category_id: "d", effective: 1 }, { category_id: "b", effective: 10 },
    ]);
    expect(b.map((x) => x.category_id)).toEqual(["b", "c", "a", "d"]);
    expect(Math.round(b.reduce((a, x) => a + x.share_pct, 0) * 10)).toBe(1000);
  });
  it("8.100.000 vs 8.400.000 → −Rp 300.000 (−3,6%)", () => {
    const d = monthDelta(8_100_000, 8_400_000);
    expect(`${formatSigned(d.diff)} (${d.pct! < 0 ? "−" : "+"}${formatPct(Math.abs(d.pct!))})`).toBe("−Rp 300.000 (−3,6%)");
  });
  it("previous month 0 → no percent", () => expect(monthDelta(5, 0).pct).toBeNull());
});

describe("F-13.1 zip", () => {
  it("crc32 of 'hello' matches the reference", () => expect(crc32(new TextEncoder().encode("hello")).toString(16)).toBe("3610a686"));
  it("unzip reads back the files", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gs-zip-"));
    const file = path.join(dir, "a.zip");
    writeFileSync(file, zip([{ name: "a.json", data: new TextEncoder().encode('{"x":1}') }, { name: "transactions.csv", data: new TextEncoder().encode("id,amount\n1,2\n") }]));
    execFileSync("unzip", ["-o", "-q", file, "-d", dir]);
    expect(readFileSync(path.join(dir, "a.json"), "utf8")).toBe('{"x":1}');
    expect(readFileSync(path.join(dir, "transactions.csv"), "utf8")).toContain("1,2");
  });
  it("csv escapes quotes and commas", () => expect(csvCell('Kopi, "susu"')).toBe('"Kopi, ""susu"""'));
});

import { buildExport, EXPORT_TABLES } from "../../src/lib/core/export";

describe("F-13.1 export content", () => {
  const out = buildExport(
    {
      app_settings: [{ user_id: "u", pin_hash: "HASH", pin_salt: "SALT", graduation_date: "2028-07-14" }],
      integrations: [{ provider: "gmail", vault_secret_id: "abc", status: "terhubung" }],
      accounts: [{ id: "a1", name: "Mandiri" }],
      transactions: [{ id: "t1", amount: 28000, account_id: "a1", deleted_at: null }, { id: "t2", amount: 5, account_id: "a1", deleted_at: "2026-01-01" }],
    },
    "glideslope",
    "2026-11-14",
  );
  const text = new TextDecoder("latin1").decode(out.bytes);
  it("names the file {slug}-export-YYYYMMDD", () => expect(out.filename).toBe("glideslope-export-20261114.zip"));
  it("has a JSON per section-5 table and the CSV", () => {
    for (const t of EXPORT_TABLES) expect(text).toContain(`${t}.json`);
    expect(text).toContain("transactions.csv");
  });
  it("contains no refresh_token or pin_hash", () => {
    expect(text).not.toContain("refresh_token");
    expect(text).not.toContain("pin_hash");
    expect(text).not.toContain("HASH");
  });
  it("CSV lists non-deleted transactions only", () => {
    expect(text).toContain("t1,");
    expect(text).not.toMatch(/\nt2,/);
  });
});

import { effectiveAmount } from "../../src/lib/core/split";

describe("Table 5.4-D effective spending", () => {
  const split = (status: string) => [{ status, participants: [{ is_owner: true, share_amount: 20000 }, { is_owner: false, share_amount: 20000 }] }];
  it("Rp 40.000 split with one friend (shared) counts Rp 20.000", () => expect(effectiveAmount(40000, split("shared"))).toBe(20000));
  it("a draft split does not change spending", () => expect(effectiveAmount(40000, split("draft"))).toBe(40000));
  it("settled still counts only the owner's part", () => expect(effectiveAmount(40000, split("settled"))).toBe(20000));
});

import { validateParticipants } from "../../src/lib/core/split";
describe("F-10.1 participants", () => {
  const p = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, phone_digits: null, is_owner: i === 0 }));
  it("13th participant is refused", () => expect(validateParticipants(p(13)).participants).toBe("Maksimal 12 peserta."));
  it("12 is fine", () => expect(validateParticipants(p(12))).toEqual({}));
  it("phone must be 8–15 digits", () => expect(validateParticipants([{ name: "A", phone_digits: "0812", is_owner: true }])["phone.0"]).toBeTruthy());
});
