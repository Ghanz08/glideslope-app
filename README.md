# Glideslope

Pencatat keuangan pribadi untuk satu pemilik: runway dana sampai lulus, tangkapan email otomatis, aset, scan nota, dan bagi tagihan. Spesifikasi lengkap ada di [`PRD.md`](PRD.md); aturan kerja agent di [`AGENTS.md`](AGENTS.md).

Tumpukan: Next.js 16 (App Router, TypeScript ketat, Tailwind v4) · Supabase (Postgres + RLS aal2, Auth TOTP, Storage, Vault, Edge Functions, pg_cron, pg_net) · router LLM kompatibel OpenAI (9router) · Vercel Hobby.

## 1. Prasyarat
- Node.js ≥ 20.9 (diuji dengan Node 26), npm
- Docker Desktop (untuk Supabase lokal) dengan **ruang disk kosong ±6 GB** untuk image Supabase
- Supabase CLI dipasang sebagai devDependency (`npx supabase …`)
- Opsional: 9router berjalan di komputer, dengan satu model teks dan satu model vision

## 2. Supabase lokal dan migrasi
```bash
npm install
npx supabase start            # mencetak API URL, publishable key, service_role key, DB URL
npx supabase db reset         # menerapkan semua berkas supabase/migrations/*.sql
```
Migrasi membuat seluruh tabel bagian 5 dengan RLS `user_id = auth.uid()` **dan** sesi aal2, RPC atomik, bucket privat `receipts`, fungsi Vault untuk token Gmail, dan jadwal pg_cron (bila ekstensi tersedia).

**Proyek Supabase hosted.** Buat proyek di dasbor Supabase, lalu `npx supabase link --project-ref <ref>` dan `npx supabase db push`. Aktifkan TOTP di *Authentication → Multi-factor*. Setelah akun pemilik dibuat, matikan *Allow new users to sign up* (trigger basis data juga menolak akun kedua).

## 3. Variabel lingkungan (bagian 8.1)
Salin `.env.example` ke `.env.local` lalu isi. Jangan pernah mengawali kunci layanan dengan `NEXT_PUBLIC_`.

| Nama | Isi |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | dari `supabase start` / dasbor |
| `SUPABASE_SERVICE_ROLE_KEY` | kunci service role (server saja) |
| `SUPABASE_DB_URL` | string koneksi Postgres (lokal: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`); dipakai webhook dan pekerja LLM lokal |
| `APP_NAME`, `APP_BASE_URL` | default `Glideslope`, `http://localhost:3000` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | lihat bagian 5 |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_TEXT`, `LLM_MODEL_VISION`, `LLM_MODEL_VISION_FALLBACK`, `LLM_DAILY_LIMIT` | router LLM (default `http://localhost:20128/v1`, batas 200/hari) |
| `LLM_BASE_URL_FROM_DOCKER` | alamat router dari Edge Function lokal: `http://host.docker.internal:20128/v1` |
| `CRON_SECRET`, `WEBHOOK_SECRET` | string acak ≥ 32 karakter (`openssl rand -base64 36`) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `node scripts/vapid-keys.mjs`; subject `mailto:<email kamu>` |
| `APP_TODAY` | khusus dev/tes: kunci "hari ini" (mis. `2026-11-14` untuk data seed) |

## 4. Akun pemilik, TOTP, dan menjalankan app
```bash
npm run create-owner -- email@kamu.id 'kata-sandi-minimal-10-karakter'
npm run dev                      # http://localhost:3000/masuk
```
Masuk pertama kali meminta pendaftaran TOTP: pindai kode QR dengan Google Authenticator/1Password (atau ketik kode manual), lalu masukkan kode 6 angka. Onboarding 4 langkah menyusul. PIN kunci aplikasi diatur di *Pengaturan → Keamanan*.

**Perangkat TOTP hilang.** Tidak ada pemulihan lewat email. Hapus faktor MFA lewat dasbor Supabase (*Authentication → Users → pilih pengguna → hapus faktor*), atau SQL: `delete from auth.mfa_factors where user_id = '<uuid>';` lalu masuk lagi dan daftarkan TOTP baru. Lupa PIN: masuk ulang dengan TOTP lalu atur PIN baru.

**Data contoh (dev saja).** `npm run seed` mengisi data bagian 5.5 untuk akun pemilik; jalankan app dengan `APP_TODAY=2026-11-14 npm run dev` untuk melihat angka golden (Dana tersisa Rp 287.000.000, aman per hari Rp 378.000).

## 5. Gmail (OAuth, hanya-baca)
1. Google Cloud Console → buat proyek → *APIs & Services → Library* → aktifkan **Gmail API**.
2. *OAuth consent screen*: tipe External, tambahkan scope `https://www.googleapis.com/auth/gmail.readonly`, lalu **Publish app** ke status *In production* (status Testing membuat token kedaluwarsa tiap 7 hari).
3. *Credentials → Create OAuth client ID → Web application*; *Authorized redirect URI* = `GOOGLE_REDIRECT_URI` (lokal `http://localhost:3000/api/gmail/callback`; produksi `https://<domain>/api/gmail/callback`). Satu URI per lingkungan.
4. Di app: *Sumber email → Hubungkan Gmail*. Google akan menampilkan **"Google hasn't verified this app"** — ini wajar untuk aplikasi pribadi: klik **Advanced/Lanjutan → Go to … (unsafe)/Buka … (tidak aman)** lalu setujui. Ini bukan galat.
5. Tambahkan alamat pengirim asli di *Sumber email* (parser tersedia: Mandiri, Grab, Shopee, Google Play, ESB, Gojek). Parser dibangun dari contoh sintetis, jadi tandanya "Parser belum diverifikasi dengan email asli" sampai diuji dengan email sungguhan (OQ-2).

Token refresh hanya disimpan di Supabase Vault; tabel `integrations` hanya menyimpan id rahasianya.

## 6. Pekerjaan terjadwal dan Edge Functions
Edge runtime Supabase memakai postgres.js v3 build Deno (`deno.land/x/postgresjs`); v4 dari npm belum didukung runtime itu.
```bash
npm run build:functions          # membundel src/lib/core + src/lib/ingest ke supabase/functions/_shared/core.js
npx supabase functions serve --env-file .env.local   # lokal
npx supabase functions deploy ingest-gmail process-llm-jobs maintenance   # hosted
```
pg_cron memanggil `ingest-gmail` dan `process-llm-jobs` tiap 5 menit dan `maintenance` pukul 03:00 WIB. Jadwal membaca dua rahasia dari Vault — isi sekali lewat SQL editor (nilai milikmu, jangan di-commit):
```sql
select vault.create_secret('http://supabase_kong_glideslope:8000', 'project_url');   -- lokal (jaringan Docker); hosted: https://<ref>.supabase.co
select vault.create_secret('<CRON_SECRET yang sama>', 'cron_secret');
```
Vercel Cron (`vercel.json`) memanggil `/api/cron/keepalive` sekali sehari agar proyek gratis tidak dijeda.

## 7. Router LLM lokal dan pekerja lokal
Jalankan 9router di komputer (default `http://localhost:20128/v1`). Bila Supabase hosted tidak bisa menjangkau router itu (OQ-3), email tanpa parser antre di `llm_jobs`; proses antrean dari komputermu:
```bash
npm run llm-worker               # loop tiap 60 detik; --once untuk sekali jalan
```
Sakelar LLM di *Pengaturan* mematikan semua panggilan. **Scan nota (F-09) ikut mati saat sakelar LLM mati**, karena foto nota tidak bisa diredaksi sebelum dikirim; nota tetap bisa diisi manual.

## 8. Notifikasi HP dan PWA
- Webhook penerus notifikasi: `POST /api/ingest/webhook` dengan header `x-webhook-secret: <WEBHOOK_SECRET>` dan JSON `{ "source_app", "text", "posted_at" }` (≤ 8 KB, 60/menit).
- Pasang PWA dari Chrome Android untuk menu *Bagikan → Glideslope* (gambar nota). Di iPhone, pasang ke layar utama dulu sebelum menyalakan notifikasi.
- Ikon `public/icon-*.png` adalah **placeholder** monogram (`node scripts/make-icons.mjs`); ganti dengan logo bila ada (OQ-1).

## 9. Deploy ke Vercel
1. Hubungkan repositori di Vercel (paket Hobby, pemakaian pribadi non-komersial).
2. Isi semua variabel bagian 3 di *Project Settings → Environment Variables* (tanpa `APP_TODAY`).
3. Deploy; perbarui `APP_BASE_URL` dan `GOOGLE_REDIRECT_URI` ke domain `*.vercel.app` (OQ-9).

## 10. Ekspor dan cadangan
Paket gratis Supabase tidak punya cadangan otomatis. *Pengaturan → Data milikmu → Ekspor data* (verifikasi ulang PIN atau kode TOTP) mengunduh `glideslope-export-YYYYMMDD.zip` berisi JSON tiap tabel dan `transactions.csv`, tanpa hash PIN, token, atau gambar nota. Beranda mengingatkan bila ekspor terakhir lebih dari 7 hari.

## 11. Tes
```bash
npm run lint && npm run typecheck && npm test        # 200 tes: logika domain + DB/RLS (PGlite) + pipeline dengan Gmail/LLM tiruan
npm run e2e:setup -- <email> '<sandi>'               # sekali: daftarkan TOTP pemilik uji, tulis E2E_* ke .env.local
npx playwright install chromium
set -a; . ./.env.local; set +a; npm run test:e2e    # stack lokal + APP_TODAY=2026-11-14; tiap spesifikasi men-seed ulang data contoh
```
**Peringatan:** setiap spesifikasi e2e men-seed ulang data pemilik. Jalankan hanya pada stack dengan akun uji (`*@contoh.test`); `npm run seed -- --reset` menolak akun lain kecuali `SEED_FORCE_RESET=1`.

Suite e2e (`tests/e2e/`) memetakan langsung ke kriteria PRD, termasuk axe di S-01/S-04/S-05/S-07/S-08/S-11 dan pemeriksaan tanpa gulir horizontal di 360/768/1280 px.
Tes DB memakai PGlite (Postgres in-process) dengan pengganti minimal skema `auth` dan Vault, jadi bisa jalan tanpa Docker.
