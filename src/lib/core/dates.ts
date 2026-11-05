// Date helpers. Stored times are UTC; the UI and every calendar boundary use WIB (UTC+7, no DST).

export const WIB_OFFSET_MS = 7 * 3600_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTHS_LONG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

/** A calendar date as "YYYY-MM-DD". */
export type ISODate = string;

/** Injectable clock: APP_TODAY (dev/tests only) pins "today" to a WIB date at 12:00. */
export function now(): Date {
  const pinned = typeof process !== "undefined" ? process.env?.APP_TODAY : undefined;
  if (pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned)) {
    const real = new Date();
    // keep the real time-of-day so ordering of newly created rows still works
    const wib = new Date(real.getTime() + WIB_OFFSET_MS);
    const [y, m, d] = pinned.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, wib.getUTCHours(), wib.getUTCMinutes(), wib.getUTCSeconds()) - WIB_OFFSET_MS);
  }
  return new Date();
}

export function wibDate(t: Date | string): ISODate {
  const d = typeof t === "string" ? new Date(t) : t;
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

export function todayWib(clock: Date = now()): ISODate {
  return wibDate(clock);
}

/** WIB midnight of a calendar date, as a UTC instant. */
export function wibStart(date: ISODate): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - WIB_OFFSET_MS);
}

/** Combine WIB date and "HH:MM[:SS]" into a UTC ISO string. */
export function wibToUtcIso(date: ISODate, time = "00:00:00"): string {
  const t = time.length === 5 ? `${time}:00` : time;
  return new Date(Date.parse(`${date}T${t}Z`) - WIB_OFFSET_MS).toISOString();
}

const parts = (d: ISODate) => d.split("-").map(Number) as [number, number, number];
const fmt = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Add calendar months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: ISODate, n: number): ISODate {
  const [y, m, d] = parts(date);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addDays(date: ISODate, n: number): ISODate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
}

/** Months from a to b as whole months plus the fraction of the following month. */
export function monthsBetween(a: ISODate, b: ISODate): number {
  if (b < a) return -monthsBetween(b, a);
  let k = 0;
  while (addMonths(a, k + 1) <= b) k++;
  const start = addMonths(a, k);
  const next = addMonths(a, k + 1);
  return k + daysBetween(start, b) / daysBetween(start, next);
}

export function monthStart(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}

export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

/** "14 Nov 2026" */
export function formatDate(t: Date | string): string {
  const d = typeof t === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : wibDate(t);
  const [y, m, dd] = parts(d);
  return `${dd} ${MONTHS[m - 1]} ${y}`;
}

/** "14 Nov" */
export function formatDayMonth(t: Date | string): string {
  return formatDate(t).split(" ").slice(0, 2).join(" ");
}

/** "Jun 2029" */
export function formatMonthYear(date: ISODate): string {
  const [y, m] = parts(date);
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatMonthLong(date: ISODate): string {
  const [y, m] = parts(date);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** "Sabtu, 14 November 2026" */
export function formatLongDate(t: Date | string): string {
  const d = typeof t === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : wibDate(t);
  const [y, m, dd] = parts(d);
  const dow = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  return `${DAYS[dow]}, ${dd} ${MONTHS_LONG[m - 1]} ${y}`;
}

/** "17:57 WIB" */
export function formatTime(t: Date | string, withSeconds = false): string {
  const d = new Date(new Date(t).getTime() + WIB_OFFSET_MS).toISOString();
  return `${d.slice(11, withSeconds ? 19 : 16)} WIB`;
}
