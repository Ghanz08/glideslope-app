import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseOcrReceipt, receiptAmount, type OcrLine } from "./receipt-ocr";
import { validateReceipt } from "./domain";

// real output of the OCR service (RapidOCR, PP-OCR models) on three tilted, noisy receipt photos
const fixture = (n: string) => JSON.parse(readFileSync(path.resolve(__dirname, `../../../tests/fixtures/ocr/${n}.json`), "utf8")) as { width: number; lines: OcrLine[] };
const parse = (n: string) => {
  const f = fixture(n);
  return parseOcrReceipt(f.lines, f.width);
};

describe("receiptAmount", () => {
  it("reads Indonesian amounts and signs", () => {
    expect(receiptAmount("56.000")).toBe(56000);
    expect(receiptAmount("95,000")).toBe(95000);
    expect(receiptAmount("-9.600")).toBe(-9600);
    expect(receiptAmount("(5.000)")).toBe(-5000);
    expect(receiptAmount("Rp 12.500")).toBe(12500);
    expect(receiptAmount("-40")).toBe(-40);
    expect(receiptAmount("110.880,00")).toBe(110880);
    expect(receiptAmount("600ML")).toBeNull();
    expect(receiptAmount("10%")).toBeNull();
  });
});

describe("parseOcrReceipt (F-09.1)", () => {
  it("restaurant: qty lines under names, service 5% and PB1 10%, QRIS", () => {
    const r = parse("restoran");
    expect(r.merchant_name).toBe("WARUNG SAMBAL BU TINI");
    expect(r.occurred_at).toBe("2026-11-14T12:42:00.000Z");
    expect(r.items).toEqual([
      { name: "Ayam Bakar Madu", quantity: 2, unit_price: 28000, line_total: 56000 },
      { name: "Nasi Putih", quantity: 2, unit_price: 5000, line_total: 10000 },
      { name: "Es Teh Manis", quantity: 3, unit_price: 6000, line_total: 18000 },
      { name: "Tempe Mendoan", quantity: 1, unit_price: 12000, line_total: 12000 },
    ]);
    expect(r).toMatchObject({ subtotal: 96000, service_charge: 4800, tax_amount: 10080, tax_rate_pct: 10, total: 110880, payment_method: "QRIS" });
    expect(validateReceipt(r).ok).toBe(true);
  });

  it("minimarket: 'HARGA JUAL' as subtotal, cash and change are not totals", () => {
    const r = parse("minimarket");
    expect(r.items.map((i) => [i.quantity, i.line_total])).toEqual([[2, 11000], [1, 17500], [5, 15500], [1, 19900]]);
    expect(r).toMatchObject({ subtotal: 63900, total: 63900, tax_amount: 0, payment_method: "TUNAI" });
    expect(r.occurred_at).toBe("2026-11-14T01:15:00.000Z");
    expect(validateReceipt(r).ok).toBe(true);
  });

  it("coffee shop: leading quantities, member discount, tax and negative rounding", () => {
    const r = parse("kopi");
    expect(r.merchant_name).toBe("KOPI SENJA");
    expect(r.items).toEqual([
      { name: "Kopi Susu Aren", quantity: 1, unit_price: 24000, line_total: 24000 },
      { name: "Croissant Butter", quantity: 1, unit_price: 28000, line_total: 28000 },
      { name: "Americano Ice", quantity: 2, unit_price: 22000, line_total: 44000 },
    ]);
    expect(r).toMatchObject({ subtotal: 96000, discount: 9600, tax_amount: 8640, rounding: -40, total: 95000, payment_method: "Debit BCA" });
    expect(r.occurred_at).toBe("2026-11-14T09:05:00.000Z");
    expect(validateReceipt(r).ok).toBe(true);
  });
});
