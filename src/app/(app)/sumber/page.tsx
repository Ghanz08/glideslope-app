import type { Metadata } from "next";
import { CircleCheck, Mail, TriangleAlert } from "lucide-react";
import { requireOwner } from "@/lib/server/owner";
import { getAccounts } from "@/lib/server/queries";
import { cancelBackfill, ignoreUnreadable, retryUnreadable, startBackfill, toggleEmailSource } from "@/app/actions/sources";
import { ActButton } from "@/components/act-button";
import { Banner, ButtonLink, Card, EmptyState, PageTitle } from "@/components/ui";
import { addDays, daysBetween, formatDate, formatTime, todayWib, now, wibDate, wibStart } from "@/lib/core/dates";
import { AddSourceForm, DisconnectButton } from "./source-forms";

export const metadata: Metadata = { title: "Sumber email" };

const STATUS = { terhubung: "Terhubung", perlu_hubungkan_ulang: "Perlu hubungkan ulang", terputus: "Terputus" } as const;
const PARSER_LABEL: Record<string, string> = { mandiri: "Mandiri", grab: "Grab", shopee: "Shopee", google_play: "Google Play", esb: "ESB", gojek: "Gojek" };

export default async function SumberPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const { gmail } = await searchParams;
  const s = gate.supabase;
  const t = todayWib(now());
  const since = wibStart(addDays(t, -30)).toISOString();
  const [integ, sources, events, unreadable, pending, accounts] = await Promise.all([
    s.from("integrations").select("status, account_email, last_polled_at, last_error, backfill_state").eq("provider", "gmail").maybeSingle(),
    s.from("email_sources").select("id, sender_address, label, parser_id, enabled, verified_with_real_email, last_seen_at, created_at").order("label"),
    s.from("ingest_events").select("source_id, parse_status").gte("received_at", since),
    s.from("ingest_events").select("id, sender, subject, received_at, parse_error").in("parse_status", ["failed", "unreadable"]).order("received_at", { ascending: false }).limit(50),
    s.from("llm_jobs").select("id, error, next_attempt_at").eq("status", "pending"),
    getAccounts(s),
  ]);
  const i = integ.data;
  const status = (i?.status ?? "terputus") as keyof typeof STATUS;
  const backfill = (i?.backfill_state ?? null) as { status: string; total?: number; processed?: number } | null;
  const counts = new Map<string, { ok: number; fail: number }>();
  for (const e of events.data ?? []) {
    const c = counts.get(e.source_id) ?? { ok: 0, fail: 0 };
    if (e.parse_status === "parsed" || e.parse_status === "ignored") c.ok++;
    if (e.parse_status === "failed" || e.parse_status === "unreadable") c.fail++;
    counts.set(e.source_id, c);
  }
  const limitHit = (pending.data ?? []).some((j) => j.error === "batas harian tercapai");

  return (
    <>
      <PageTitle title="Sumber email" subtitle="Gmail dibaca hanya-baca, hanya untuk pengirim di bawah." />
      {gmail === "ditolak" && <div className="mb-4"><Banner tone="perhatian">Gmail belum terhubung. Kamu bisa mencoba lagi kapan saja.</Banner></div>}
      {gmail === "terhubung" && <div className="mb-4"><Banner>Gmail terhubung. Email baru diperiksa tiap 5 menit.</Banner></div>}
      {status === "perlu_hubungkan_ulang" && <div className="mb-4"><Banner tone="perhatian">Gmail perlu dihubungkan ulang. Google menolak akses lama, jadi transaksi email berhenti masuk.</Banner></div>}
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-[16px] font-bold">
                  {status === "terhubung" ? <CircleCheck size={18} className="text-aksen" aria-hidden /> : <TriangleAlert size={18} className="text-peringatan" aria-hidden />}
                  Gmail: {STATUS[status]}
                </h2>
                {i?.account_email && <p className="text-[14px] text-teks-redup">{i.account_email}</p>}
                <p className="text-[13px] text-teks-pelan">
                  Polling terakhir: {i?.last_polled_at ? `${formatDate(i.last_polled_at)} ${formatTime(i.last_polled_at)}` : "belum pernah"}
                  {i?.last_error ? ` · ${i.last_error}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {status !== "terhubung" && <ButtonLink href="/api/gmail/connect" prefetch={false}>{status === "perlu_hubungkan_ulang" ? "Hubungkan ulang" : "Hubungkan Gmail"}</ButtonLink>}
                {status !== "terputus" && <DisconnectButton />}
              </div>
            </div>
          </Card>

          <Card className="p-0">
            <h2 className="px-5 pt-5 text-[16px] font-bold">Pengirim</h2>
            {(sources.data ?? []).length === 0 ? <EmptyState icon={Mail} title="Belum ada pengirim" body="Tambahkan alamat email bank atau merchant yang boleh dibaca." /> : (
              <ul>
                {(sources.data ?? []).map((src) => {
                  const c = counts.get(src.id) ?? { ok: 0, fail: 0 };
                  const quiet = src.last_seen_at ? daysBetween(wibDate(src.last_seen_at), t) > 60 : daysBetween(wibDate(src.created_at), t) > 60;
                  return (
                    <li key={src.id} className="flex flex-wrap items-center gap-3 border-b border-garis px-5 py-3 last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{src.label} {quiet && <span className="ml-1 rounded-full bg-isian px-2 py-0.5 text-[12px] text-teks-redup">Sunyi</span>}</p>
                        <p className="truncate text-[13px] text-teks-redup">{src.sender_address} · {src.parser_id ? `parser ${PARSER_LABEL[src.parser_id]}` : "dibaca LLM"}</p>
                        <p className="text-[13px] text-teks-redup">30 hari: {c.ok} berhasil · {c.fail} gagal · terakhir {src.last_seen_at ? formatDate(src.last_seen_at) : "—"}</p>
                        {src.parser_id && !src.verified_with_real_email && <p className="text-[12px] text-peringatan">Parser belum diverifikasi dengan email asli</p>}
                      </div>
                      <ActButton variant="teks" action={toggleEmailSource.bind(null, src.id, !src.enabled)}>{src.enabled ? "Matikan" : "Aktifkan"}</ActButton>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="p-0">
            <h2 className="px-5 pt-5 text-[16px] font-bold">Tidak terbaca</h2>
            {(unreadable.data ?? []).length === 0 ? <EmptyState title="Semua email terbaca" /> : (
              <ul>
                {(unreadable.data ?? []).map((e) => (
                  <li key={e.id} className="flex flex-col gap-2 border-b border-garis px-5 py-3 last:border-0">
                    <div>
                      <p className="font-semibold">{e.subject || "(tanpa subjek)"}</p>
                      <p className="text-[13px] text-teks-redup">{e.sender} · {formatDate(e.received_at)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ActButton variant="lembut" action={retryUnreadable.bind(null, e.id)} done="Masuk antrean baca.">Coba baca dengan LLM</ActButton>
                      <ActButton variant="sekunder" action={ignoreUnreadable.bind(null, e.id)} done="Diabaikan.">Abaikan</ActButton>
                      <ButtonLink variant="sekunder" href={`/tambah/pengeluaran?tanggal=${wibDate(e.received_at)}&merchant=${encodeURIComponent((e.subject ?? "").slice(0, 80))}`}>Jadikan transaksi manual</ButtonLink>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <h2 className="mb-2 text-[16px] font-bold">Impor 90 hari terakhir</h2>
            {backfill && (backfill.status === "running" || backfill.status === "done" || backfill.status === "cancelled") && backfill.total != null && (
              <div className="mb-3">
                <p className="tabular text-[14px]" aria-live="polite">{backfill.processed ?? 0} dari {backfill.total} diproses{backfill.status === "cancelled" ? " · dibatalkan" : backfill.status === "done" ? " · selesai" : ""}</p>
                <div className="mt-2 h-2 rounded-full bg-isian"><div className="h-2 rounded-full bg-aksen" style={{ width: `${backfill.total ? ((backfill.processed ?? 0) / backfill.total) * 100 : 0}%` }} /></div>
              </div>
            )}
            {backfill?.status === "running" ? (
              <ActButton variant="sekunder" action={cancelBackfill} done="Impor dibatalkan.">Batalkan impor</ActButton>
            ) : (
              <>
                <ActButton variant="lembut" action={startBackfill} done="Impor dimulai. Diproses 100 email tiap 5 menit.">Impor 90 hari terakhir</ActButton>
                {status !== "terhubung" && <p className="mt-2 text-[13px] text-teks-redup">Hubungkan Gmail dulu untuk mengimpor riwayat.</p>}
              </>
            )}
          </Card>
          <Card>
            <h2 className="mb-2 text-[16px] font-bold">Menunggu dibaca</h2>
            <p className="text-[14px] text-teks-redup">
              {(pending.data ?? []).length} email menunggu dibaca LLM.
              {limitHit ? " Batas 200 panggilan per hari tercapai; dilanjutkan besok." : (pending.data ?? []).length ? " Router LLM belum terjangkau atau sedang antre." : ""}
            </p>
          </Card>
          <Card>
            <h2 className="mb-4 text-[16px] font-bold">Tambah pengirim</h2>
            <AddSourceForm accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} />
          </Card>
        </div>
      </div>
    </>
  );
}
