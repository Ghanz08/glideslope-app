import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chooseReceiptMatch, extractReceipt, type OcrConfig } from "../../src/lib/ingest/receipt";
import type { LlmConfig } from "../../src/lib/ingest/llm";

// real OCR service output (RapidOCR / PP-OCR) for a restaurant receipt photo
const restoran = JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/ocr/restoran.json"), "utf8"));
const img = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });

const ocr = (body: unknown | "down"): OcrConfig => ({
  url: "http://ocr.test",
  fetchFn: (async () => {
    if (body === "down") throw new TypeError("fetch failed");
    return Response.json(body);
  }) as typeof fetch,
});

let llmCalls = 0;
const llm = (answer: unknown): LlmConfig => ({
  baseUrl: "http://llm.test/v1", modelText: "text-a", dailyLimit: 200,
  fetchFn: (async () => {
    llmCalls++;
    return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] });
  }) as typeof fetch,
});

// the restaurant photo with the TOTAL line misread, so the deterministic parse no longer adds up
const misread = { ...restoran, lines: restoran.lines.map((l: { text: string }) => (l.text === "TOTAL" ? { ...l, text: "TOTAI" } : l)) };
const fixedByLlm = {
  merchant_name: "WARUNG SAMBAL BU TINI", occurred_at: "2026-11-14T19:42:00+07:00",
  items: [
    { name: "Ayam Bakar Madu", quantity: 2, unit_price: 28000, line_total: 56000 },
    { name: "Nasi Putih", quantity: 2, unit_price: 5000, line_total: 10000 },
    { name: "Es Teh Manis", quantity: 3, unit_price: 6000, line_total: 18000 },
    { name: "Tempe Mendoan", quantity: 1, unit_price: 12000, line_total: 12000 },
  ],
  subtotal: 96000, service_charge: 4800, tax_amount: 10080, tax_rate_pct: 10, discount: 0, rounding: 0, total: 110880, payment_method: "QRIS", currency: "IDR",
};

describe("F-09.1 / F-09.2 extraction (OCR first, LLM only to restructure OCR text)", () => {
  it("OCR + parser alone: 4 items, subtotal 96.000, service 4.800, PB1 10.080, total 110.880 → extracted, no LLM call", async () => {
    llmCalls = 0;
    const r = await extractReceipt(ocr(restoran), img, { llm: llm(fixedByLlm), enabled: true, redactionTerms: [] });
    expect(r).toMatchObject({ status: "extracted", model_used: "ocr:rapidocr" });
    if (r.status === "gagal") throw new Error();
    expect(r.data.items).toHaveLength(4);
    expect(r.data).toMatchObject({ subtotal: 96000, service_charge: 4800, tax_amount: 10080, total: 110880 });
    expect(llmCalls).toBe(0);
  });
  it("parser fails, LLM restructures the OCR text with numbers that are on the receipt → extracted, model noted", async () => {
    const r = await extractReceipt(ocr(misread), img, { llm: llm(fixedByLlm), enabled: true, redactionTerms: [] });
    expect(r).toMatchObject({ status: "extracted", model_used: "ocr:rapidocr+llm:text-a" });
  });
  it("an LLM number that is not on the receipt is refused → perlu_koreksi with the OCR reading", async () => {
    const r = await extractReceipt(ocr(misread), img, { llm: llm({ ...fixedByLlm, total: 111000, rounding: 120 }), enabled: true, redactionTerms: [] });
    expect(r).toMatchObject({ status: "perlu_koreksi", model_used: "ocr:rapidocr" });
  });
  it("LLM switched off: OCR still works, nothing is sent to the LLM", async () => {
    llmCalls = 0;
    const r = await extractReceipt(ocr(misread), img, { llm: llm(fixedByLlm), enabled: false, redactionTerms: [] });
    expect(r.status).toBe("perlu_koreksi");
    if (r.status !== "perlu_koreksi") throw new Error();
    expect(r.problems).toContain("total");
    expect(llmCalls).toBe(0);
  });
  it("OCR service down → gagal (manual form opens)", async () => {
    expect((await extractReceipt(ocr("down"), img, { llm: null, enabled: false, redactionTerms: [] })).status).toBe("gagal");
  });
  it("no text on the photo → gagal", async () => {
    expect((await extractReceipt(ocr({ width: 800, height: 600, lines: [] }), img, { llm: null, enabled: false, redactionTerms: [] })).status).toBe("gagal");
  });
});

describe("F-09.3 one-to-one matching", () => {
  it("links the best candidate ≥ 0.75", () =>
    expect(chooseReceiptMatch([{ txId: "a", score: 0.85, gapMs: 4000, bestOtherScore: null }, { txId: "b", score: 0.65, gapMs: 1, bestOtherScore: null }])).toEqual({ txId: "a", score: 0.85 }));
  it("two receipts, one transaction: only the higher score keeps it", () => {
    expect(chooseReceiptMatch([{ txId: "a", score: 0.8, gapMs: 1, bestOtherScore: 0.85 }])).toBeNull();
    expect(chooseReceiptMatch([{ txId: "a", score: 0.9, gapMs: 1, bestOtherScore: 0.85 }])).toEqual({ txId: "a", score: 0.9 });
  });
});

import { fitSize } from "../../src/lib/client/image";
describe("F-09.1 resize", () => {
  it("4032 × 3024 → longest side 1568", () => expect(fitSize(4032, 3024)).toEqual({ w: 1568, h: 1176 }));
  it("small images are not enlarged", () => expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 }));
});
