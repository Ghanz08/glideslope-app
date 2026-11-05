// Rupiah helpers. Money is always an integer number of rupiah.

export const MAX_TX_AMOUNT = 999_999_999;

/** Table 5.4-E: parse rupiah text into an integer, or null when it is not a valid positive amount. */
export function parseRupiah(input: string): number | null {
  let s = input.replace(/rp\.?|idr/gi, "").replace(/[\s ]/g, "");
  if (!/^[0-9.,]+$/.test(s)) return null;
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;

  if (dots && commas) {
    // Both separators: the last one is decimal and must be followed by exactly "00".
    const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    const dec = s.slice(last + 1);
    if (dec !== "00") return null;
    s = s.slice(0, last);
    const thousands = s.includes(".") ? "." : ",";
    if (!validGroups(s, thousands)) return null;
    s = s.split(thousands).join("");
  } else if (dots || commas) {
    const sep = dots ? "." : ",";
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    if (parts.length === 2 && tail === "00") {
      s = parts[0]; // "17201,00" style decimal
    } else if (parts.slice(1).every((p) => p.length === 3) && parts[0].length >= 1 && parts[0].length <= 3) {
      s = parts.join(""); // separator followed by exactly 3 digits = thousands
    } else {
      return null; // e.g. "12.5"
    }
  }
  if (!/^[0-9]+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function validGroups(s: string, sep: string): boolean {
  const parts = s.split(sep);
  return parts[0].length >= 1 && parts[0].length <= 3 && parts.slice(1).every((p) => p.length === 3 && /^[0-9]+$/.test(p));
}

const grouping = (n: number) => Math.abs(Math.trunc(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** "Rp 1.250.000"; negative values use the real minus sign. */
export function formatRupiah(n: number): string {
  return `${n < 0 ? "−" : ""}Rp ${grouping(n)}`;
}

/** Always shows "+" or "−" (meaning is never colour-only, section 4.9). Zero gets no sign. */
export function formatSigned(n: number): string {
  if (n === 0) return "Rp 0";
  return `${n > 0 ? "+" : "−"}Rp ${grouping(n)}`;
}

export function formatThousands(n: number): string {
  return `${n < 0 ? "−" : ""}${grouping(n)}`;
}

/** Compact millions for charts only: "8,4 jt". */
export function formatJt(n: number): string {
  const jt = n / 1_000_000;
  const s = Math.abs(jt) >= 100 ? Math.round(jt).toString() : (Math.round(jt * 10) / 10).toString().replace(".", ",");
  return `${s} jt`;
}

/** Percent with one decimal and comma: "20,9%". */
export function formatPct(p: number): string {
  return `${p.toFixed(1).replace(".", ",")}%`;
}

/** Digits typed on the numpad / money input → integer (ignores everything that is not a digit). */
export function digitsToAmount(text: string): number {
  const d = text.replace(/\D/g, "").replace(/^0+/, "");
  return d ? Number(d) : 0;
}

/** Strict validation for user-entered whole-rupiah strings ("1.5" is rejected). */
export function isWholeRupiah(text: string): boolean {
  return /^\s*[0-9][0-9.]*\s*$/.test(text) && !/\.\d{1,2}$/.test(text.trim());
}
