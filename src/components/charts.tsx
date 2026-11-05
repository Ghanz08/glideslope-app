// Dependency-free SVG charts. Every chart carries a text alternative (and the bar chart a data table).
import Link from "next/link";
import type { SeriesPoint } from "@/lib/core/runway";
import { daysBetween, formatMonthLong, formatMonthYear, type ISODate } from "@/lib/core/dates";
import { formatJt, formatRupiah } from "@/lib/core/money";
import { cx } from "./ui";

export function RunwayChart({
  series, today, graduation, end, leftover, depletion, alt, gridlines = false,
}: {
  series: SeriesPoint[];
  today: ISODate;
  graduation: ISODate;
  end: ISODate;
  leftover: number;
  depletion: ISODate | null;
  alt: string;
  gridlines?: boolean;
}) {
  // mobile draws in a narrower viewBox so SVG text stays ~13 px when scaled to a phone width
  const W = gridlines ? 640 : 340;
  const H = gridlines ? 260 : 220;
  const padL = gridlines ? 48 : 4;
  const padR = 12;
  const padT = 40;
  const padB = 8;
  const span = Math.max(1, daysBetween(today, end));
  const max = Math.max(...series.map((p) => p.value), 1);
  const niceMax = Math.ceil(max / 100_000_000) * 100_000_000 || max;
  const x = (d: ISODate) => padL + ((W - padL - padR) * daysBetween(today, d)) / span;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / niceMax);
  const before = series.filter((p) => p.date <= graduation);
  const after = series.filter((p) => p.date >= graduation);
  const path = (pts: SeriesPoint[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = before.length ? `${path(before)} L${x(graduation).toFixed(1)},${y(0)} L${x(today).toFixed(1)},${y(0)} Z` : "";
  const gx = x(graduation);
  const gy = y(Math.max(0, leftover));
  const endPoint = series[series.length - 1];
  const ticks = [0, niceMax / 3, (2 * niceMax) / 3, niceMax].map((v) => Math.round(v / 1_000_000) * 1_000_000);

  return (
    <figure className="m-0">
      {/* aria-label only: an SVG <title> shows as a hover tooltip and would reveal the balance in privacy mode */}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={alt} className="h-auto w-full overflow-visible">
        {gridlines &&
          ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="stroke-garis" strokeWidth={1} />
              <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="rahasia-svg fill-teks-pelan text-[11px]">{t ? formatJt(t) : "0"}</text>
            </g>
          ))}
        {!gridlines && <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} className="stroke-garis" strokeWidth={1.5} />}
        <path d={area} className="fill-aksen-lembut" />
        <path d={path(before)} fill="none" className="stroke-aksen" strokeWidth={3} strokeLinejoin="round" />
        <path d={path(after)} fill="none" className="stroke-aksen" strokeWidth={3} strokeDasharray="6 7" strokeLinecap="round" />
        <line x1={gx} x2={gx} y1={padT - 6} y2={y(0)} className="stroke-garis-kontrol" strokeWidth={1.5} strokeDasharray="4 4" />
        <circle cx={x(today)} cy={y(series[0]?.value ?? 0)} r={6} className="fill-aksen" />
        <circle cx={gx} cy={gy} r={6} className="fill-aksen stroke-permukaan" strokeWidth={2} />
        {endPoint && depletion && <circle cx={x(endPoint.date)} cy={y(endPoint.value)} r={7} className="fill-permukaan stroke-aksen" strokeWidth={3} />}
        <g transform={`translate(${Math.min(Math.max(gx, gridlines ? 150 : 112), W - (gridlines ? 150 : 112))}, 16)`}>
          <rect x={gridlines ? -140 : -110} y={-14} width={gridlines ? 280 : 220} height={28} rx={14} className="fill-aksen-lembut" />
          <text textAnchor="middle" y={5} className="fill-aksen text-[13px] font-semibold">
            Lulus {formatMonthYear(graduation)} · sisa <tspan className="rahasia-svg">Rp {formatJt(leftover)}</tspan><tspan className="saat-privasi">Rp ••</tspan>
          </text>
        </g>
      </svg>
      <figcaption className="mt-2 flex justify-between text-[13px] text-teks-redup" aria-hidden>
        <span>Sekarang</span>
        <span className="font-semibold text-teks">{formatMonthYear(graduation)}</span>
        <span>{formatMonthYear(end)}</span>
      </figcaption>
    </figure>
  );
}

export interface MonthBar {
  month: ISODate;
  routine: number;
  oneOff: number;
  total: number;
  current: boolean;
}

export function MonthlyBars({ bars, average, link = true }: { bars: MonthBar[]; average: number | null; link?: boolean }) {
  const max = Math.max(...bars.map((b) => b.total), average ?? 0, 1);
  const pct = (v: number) => `${(v / max) * 100}%`;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return (
    <div>
      <div className="relative flex h-48 items-end gap-2 border-b border-garis" aria-hidden>
        {average != null && (
          <div className="absolute inset-x-0 z-[1] border-t-2 border-dashed border-teks-redup" style={{ bottom: pct(average) }}>
            <span className="absolute -top-5 right-0 bg-permukaan px-1 text-[12px] text-teks-redup">rata-rata Rp {formatJt(average)}</span>
          </div>
        )}
        {bars.map((b) => {
          const inner = (
            <div className="flex h-full w-full flex-col justify-end">
              <span className="tabular mb-1 text-center text-[11px] text-teks-redup">{b.total ? formatJt(b.total) : "Rp 0"}</span>
              {b.oneOff > 0 && <div className="w-full rounded-t-petak-kecil bg-aksen-tinggi" style={{ height: pct(b.oneOff) }} />}
              <div
                className={cx("w-full", b.oneOff ? "" : "rounded-t-petak-kecil", b.current ? "pola-diagonal" : "bg-aksen")}
                style={{ height: b.routine ? pct(b.routine) : 0 }}
              />
            </div>
          );
          return link ? (
            <Link key={b.month} href={`/transaksi?bulan=${b.month.slice(0, 7)}`} tabIndex={-1} className="flex h-full flex-1 hover:opacity-80">
              {inner}
            </Link>
          ) : (
            <div key={b.month} className="flex h-full flex-1">{inner}</div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2">
        {bars.map((b) => (
          <span key={b.month} className="flex-1 text-center text-[12px] text-teks-redup">
            {link ? (
              <Link href={`/transaksi?bulan=${b.month.slice(0, 7)}`} className="inline-flex min-h-11 flex-col items-center justify-center hover:text-aksen">
                {MONTHS[Number(b.month.slice(5, 7)) - 1]}
                {b.current && <span className="text-[11px]">belum selesai</span>}
              </Link>
            ) : (
              <>
                {MONTHS[Number(b.month.slice(5, 7)) - 1]}
                {b.current && <span className="block text-[11px]">belum selesai</span>}
              </>
            )}
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-teks-redup" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] bg-aksen" />Rutin</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] bg-aksen-tinggi" />Sekali-jalan</span>
        <span className="flex items-center gap-1.5"><span className="pola-diagonal h-3 w-3 rounded-[3px]" />Bulan berjalan</span>
      </div>
      {/* tables ignore width/overflow, so the visually hidden wrapper is a div, not the table itself */}
      <div className="sr-only"><table>
        <caption>Pengeluaran per bulan</caption>
        <thead>
          <tr><th scope="col">Bulan</th><th scope="col">Rutin</th><th scope="col">Sekali-jalan</th><th scope="col">Total</th></tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.month}>
              <th scope="row">{formatMonthLong(b.month)}{b.current ? " (belum selesai)" : ""}</th>
              <td>{formatRupiah(b.routine)}</td>
              <td>{formatRupiah(b.oneOff)}</td>
              <td>{formatRupiah(b.total)}</td>
            </tr>
          ))}
          {average != null && <tr><th scope="row">Rata-rata rutin</th><td colSpan={3}>{formatRupiah(average)}</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
