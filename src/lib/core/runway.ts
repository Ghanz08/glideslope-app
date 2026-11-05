// Runway engine — Table 5.4-C. Pure: every input (including "today") is passed in.
import { addDays, addMonths, daysBetween, monthKey, monthStart, monthsBetween, type ISODate } from "./dates";

export type RunwayStatus =
  | "sesuai"
  | "perlu_perhatian"
  | "belum_cukup"
  | "data_belum_cukup"
  | "tanggal_lulus_kosong"
  | "tanggal_lulus_lewat";

export const STATUS_LABEL: Record<RunwayStatus, string> = {
  sesuai: "Sesuai rencana",
  perlu_perhatian: "Perlu diperhatikan",
  belum_cukup: "Belum cukup sampai lulus",
  data_belum_cukup: "Isi estimasi pengeluaran",
  tanggal_lulus_kosong: "Isi tanggal lulus",
  tanggal_lulus_lewat: "Perbarui tanggal lulus",
};

export interface PlannedExpense {
  id?: string;
  label: string;
  amount: number;
  due_on: ISODate;
  repeat_months: number | null;
  repeat_until: ISODate | null;
  paid_occurrences: ISODate[];
}

export interface Occurrence {
  planned_id?: string;
  label: string;
  date: ISODate;
  amount: number;
  paid: boolean;
}

/** F-06.2: every occurrence up to repeat_until or graduation + 24 months, whichever comes first. */
export function expandPlanned(items: PlannedExpense[], graduation: ISODate | null): Occurrence[] {
  const cap = graduation ? addMonths(graduation, 24) : "9999-12-31";
  const out: Occurrence[] = [];
  for (const p of items) {
    const until = p.repeat_until && p.repeat_until < cap ? p.repeat_until : cap;
    for (let i = 0; ; i++) {
      const date = p.repeat_months ? addMonths(p.due_on, i * p.repeat_months) : p.due_on;
      if (i > 0 && (!p.repeat_months || date > until)) break;
      out.push({ planned_id: p.id, label: p.label, date, amount: p.amount, paid: p.paid_occurrences.includes(date) });
      if (!p.repeat_months || i > 400) break;
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface SpendPoint {
  date: ISODate; // WIB date
  amount: number; // effective routine spend (expense + fee, not one-off, not ignored/deleted)
}

export type BurnSource = "bulan_penuh" | "harian" | "estimasi" | null;

/** B in Table 5.4-C. `dataStart` = first date covered by transaction data. */
export function computeBurn(
  spends: SpendPoint[],
  dataStart: ISODate | null,
  today: ISODate,
  override: number | null,
): { burn: number | null; source: BurnSource; months: string[] } {
  const covered = dataStart ? daysBetween(dataStart, today) : 0;
  if (dataStart && covered >= 30) {
    const fullMonths: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const start = addMonths(monthStart(today), -i);
      if (start >= dataStart) fullMonths.push(monthKey(start));
    }
    if (fullMonths.length) {
      const total = spends.filter((s) => fullMonths.includes(monthKey(s.date))).reduce((a, s) => a + s.amount, 0);
      return { burn: Math.round(total / fullMonths.length), source: "bulan_penuh", months: fullMonths };
    }
    const total = spends.filter((s) => s.date >= dataStart && s.date < today).reduce((a, s) => a + s.amount, 0);
    return { burn: Math.round((total / covered) * 30), source: "harian", months: [] };
  }
  if (override != null) return { burn: override, source: "estimasi", months: [] };
  return { burn: null, source: null, months: [] };
}

export interface RunwayInput {
  today: ISODate;
  graduation: ISODate | null;
  reserve: number;
  funds: number; // D0
  burn: number | null; // B
  planned: Occurrence[];
}

export interface SeriesPoint {
  date: ISODate;
  value: number;
}

export interface RunwayResult {
  status: RunwayStatus;
  label: string;
  funds: number;
  burn: number | null;
  plannedUntilGraduation: number;
  plannedCountUntilGraduation: number;
  leftoverAtGraduation: number | null;
  depletionDate: ISODate | null; // null = not depleted within horizon
  depletesWithinHorizon: boolean;
  safePerDay: number | null;
  chartEnd: ISODate | null;
  monthsBeyondGraduation: number | null; // set when depletion is > 24 months after graduation
  series: SeriesPoint[];
}

const HORIZON_MONTHS = 60;

export function computeRunway(input: RunwayInput): RunwayResult {
  const { today: T, graduation: G, reserve: R, funds: D0, burn: B } = input;
  const P = input.planned.filter((p) => !p.paid && p.date > T);
  const base: RunwayResult = {
    status: "data_belum_cukup",
    label: "",
    funds: D0,
    burn: B,
    plannedUntilGraduation: 0,
    plannedCountUntilGraduation: 0,
    leftoverAtGraduation: null,
    depletionDate: null,
    depletesWithinHorizon: false,
    safePerDay: null,
    chartEnd: null,
    monthsBeyondGraduation: null,
    series: [],
  };
  const done = (r: RunwayResult) => ({ ...r, label: STATUS_LABEL[r.status] });

  if (!G) return done({ ...base, status: "tanggal_lulus_kosong" });
  if (G <= T) return done({ ...base, status: "tanggal_lulus_lewat" });

  const plannedToG = P.filter((p) => p.date <= G);
  base.plannedUntilGraduation = plannedToG.reduce((a, p) => a + p.amount, 0);
  base.plannedCountUntilGraduation = plannedToG.length;
  const days = daysBetween(T, G);
  const safe = Math.floor(Math.max(0, D0 - base.plannedUntilGraduation - R) / days / 1000) * 1000;
  base.safePerDay = safe;

  if (B == null) return done({ ...base, status: "data_belum_cukup" });

  const plannedBy = (date: ISODate) => P.filter((p) => p.date <= date).reduce((a, p) => a + p.amount, 0);
  const valueAt = (date: ISODate) => D0 - monthsBetween(T, date) * B - plannedBy(date);

  const leftover = Math.round(valueAt(G));

  // depletion: smallest whole k with V(k) <= 0, interpolated linearly inside that month
  let depletion: ISODate | null = null;
  if (D0 <= 0) depletion = T;
  else {
    let prev = D0;
    for (let k = 1; k <= HORIZON_MONTHS; k++) {
      const date = addMonths(T, k);
      const v = valueAt(date);
      if (v <= 0) {
        const start = addMonths(T, k - 1);
        const frac = prev / (prev - v);
        depletion = addDays(start, Math.floor(frac * daysBetween(start, date)));
        break;
      }
      prev = v;
    }
  }

  const cap = addMonths(G, 24);
  let chartEnd = depletion && depletion <= cap ? depletion : cap;
  if (chartEnd < G) chartEnd = G;
  const monthsBeyond = !depletion || depletion > cap ? Math.floor(monthsBetween(G, depletion ?? addMonths(T, HORIZON_MONTHS))) : null;

  // chart series: monthly points plus a before/after pair at each planned step
  const dates = new Set<ISODate>([T, G, chartEnd]);
  for (let k = 1; addMonths(T, k) < chartEnd; k++) dates.add(addMonths(T, k));
  for (const p of P) if (p.date < chartEnd) dates.add(p.date);
  const clamp = (v: number) => Math.max(0, Math.round(v));
  const series: SeriesPoint[] = [];
  for (const d of [...dates].sort()) {
    const stepToday = P.filter((p) => p.date === d).reduce((a, p) => a + p.amount, 0);
    if (stepToday) series.push({ date: d, value: clamp(valueAt(d) + stepToday) });
    series.push({ date: d, value: clamp(valueAt(d)) });
  }

  let status: RunwayStatus;
  if (D0 <= 0 || leftover < 0) status = "belum_cukup";
  else if (leftover < R) status = "perlu_perhatian";
  else status = "sesuai";

  return done({
    ...base,
    status,
    leftoverAtGraduation: leftover,
    depletionDate: depletion,
    depletesWithinHorizon: depletion != null,
    chartEnd,
    monthsBeyondGraduation: monthsBeyond,
    series,
  });
}
