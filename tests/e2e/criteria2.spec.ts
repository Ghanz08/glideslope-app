// More PRD criteria on the running stack; state is arranged with SQL, then checked in the UI.
import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { login } from "./helpers";

const sql = (q: string) => execSync(`docker exec -i supabase_db_glideslope psql -U postgres -At`, { input: q }).toString().trim();
const reseed = () => execSync("npm run seed -- --reset", { stdio: "ignore" });
const desktop = (page: Page) => test.skip((page.viewportSize()?.width ?? 0) < 1024, "desktop layout");
const mobile = (page: Page) => test.skip((page.viewportSize()?.width ?? 0) >= 1024, "mobile layout");

test.beforeEach(reseed);

test("F-06.4 / F-07.1 / F-13.2: deposit, stale price and backup banners (max 2, priority order)", async ({ page }) => {
  desktop(page);
  sql(`update assets set maturity_date = '2026-11-19' where name = 'Deposito A';
       delete from asset_prices where asset_id = (select id from assets where name = 'Emas') and as_of = '2026-11-10';
       update asset_prices set as_of = '2026-10-30' where asset_id = (select id from assets where name = 'Emas');
       update app_settings set last_export_at = '2026-11-06T00:00:00Z';`);
  await login(page);
  await expect(page.getByText("Deposito A jatuh tempo 19 Nov 2026")).toBeVisible();
  await expect(page.getByText(/Harga Emas belum diperbarui/)).toBeVisible();
  await expect(page.getByText("Data belum dicadangkan lebih dari 7 hari.")).toHaveCount(0); // third banner → S-20 only
  await page.goto("/pengaturan");
  await expect(page.getByText("Data belum dicadangkan lebih dari 7 hari.")).toBeVisible();
  await page.goto("/aset");
  await expect(page.getByText("Harga lama").first()).toBeVisible();
});

test("F-13.2: recent export → no backup banner; 8 days → banner", async ({ page }) => {
  desktop(page);
  await login(page);
  await expect(page.getByText(/Data belum dicadangkan/)).toHaveCount(0); // seed export 12 Nov
  sql(`update app_settings set last_export_at = '2026-11-06T00:00:00Z';`);
  await page.reload();
  await expect(page.getByText("Data belum dicadangkan lebih dari 7 hari.")).toBeVisible();
});

test("F-07.3: with 4 deposits only the 3 nearest are listed", async ({ page }) => {
  desktop(page);
  sql(`insert into assets (user_id, name, type, quantity, maturity_date) select user_id, 'Deposito D', 'deposit', 1, '2028-01-01' from app_settings;
       insert into asset_prices (user_id, asset_id, as_of, unit_price) select user_id, id, '2026-10-01', 10000000 from assets where name = 'Deposito D';`);
  await login(page);
  await page.goto("/aset");
  const card = page.locator("aside").getByRole("heading", { name: "Jatuh tempo berikutnya" }).locator("..");
  await expect(card.getByRole("listitem")).toHaveCount(3);
  await expect(card.getByText("Deposito D")).toHaveCount(0);
});

test("F-06.4: no open Inbox items → no Perlu dicek card", async ({ page }) => {
  desktop(page);
  sql(`update transactions set status = 'ignored', review_reason = null where status = 'needs_review'; update match_proposals set status = 'closed';`);
  await login(page);
  await expect(page.getByRole("heading", { name: /Perlu dicek/ })).toHaveCount(0);
  await page.goto("/inbox");
  await expect(page.getByText("Semua sudah ditinjau")).toBeVisible();
});

test("F-04.5: unreadable list with three actions, manual prefill, quiet sender", async ({ page }) => {
  desktop(page);
  sql(`insert into ingest_events (user_id, channel, external_id, sender, subject, received_at, parse_status, raw_text_redacted)
         select user_id, 'gmail', 'uji-' || g, 'kampus@uni.example', 'Tagihan UKT ' || g, '2026-11-10T03:00:00Z', 'failed', 'teks' from app_settings, generate_series(1, 2) g;
       update email_sources set last_seen_at = '2026-09-13T00:00:00Z' where label = 'Shopee';`);
  await login(page);
  await page.goto("/sumber");
  const items = page.getByRole("heading", { name: "Tidak terbaca" }).locator("..").getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.first().getByRole("button", { name: "Coba baca dengan LLM" })).toBeVisible();
  await expect(items.first().getByRole("button", { name: "Abaikan" })).toBeVisible();
  await expect(items.first().getByRole("link", { name: "Jadikan transaksi manual" })).toBeVisible();
  await expect(page.locator("li").filter({ hasText: /^Shopee/ }).getByText("Sunyi")).toBeVisible();
  await items.first().getByRole("link", { name: "Jadikan transaksi manual" }).click();
  await expect(page.getByLabel("Tanggal")).toHaveValue("2026-11-10");
  await expect(page.getByLabel("Merchant atau keterangan")).toHaveValue(/Tagihan UKT/);
});

test("F-01.3: unfinished onboarding blocks S-04; past graduation date refused; skipping Gmail shows the prompt", async ({ page }) => {
  desktop(page);
  sql(`update app_settings set onboarding_step = 1;`);
  await login(page).catch(() => undefined); // login lands on /mulai, not /
  await page.goto("/");
  await expect(page).toHaveURL(/\/mulai/);
  await page.getByLabel("Tanggal perkiraan lulus").fill("2026-11-13");
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByText("Tanggal lulus harus setelah hari ini.")).toBeVisible();
  await expect(page.getByLabel("Tanggal perkiraan lulus")).toHaveValue("2026-11-13");
  await page.getByLabel("Tanggal perkiraan lulus").fill("2028-07-14");
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.getByRole("button", { name: "Lanjut" }).click(); // reserve step
  await page.getByRole("button", { name: "Lanjut" }).click(); // accounts exist already
  await page.getByRole("button", { name: "Lewati dulu" }).click();
  await page.waitForURL("/");
  await expect(page.getByText("Transaksi dari email bisa masuk sendiri.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tutup" }).first()).toBeVisible();
});

test("F-11.2: approved subscription shows next date and monthly total", async ({ page }) => {
  desktop(page);
  await login(page);
  await page.goto("/langganan");
  await page.getByRole("button", { name: "Periksa sekarang" }).click();
  const row = page.locator("li").filter({ hasText: "Langganan musik" });
  await row.getByRole("button", { name: "Setujui" }).click();
  await expect(page.locator("li").filter({ hasText: "Langganan musik" }).getByText(/Berikutnya \d+ Des 2026/)).toBeVisible();
  await expect(page.getByText(/Total per bulan: Rp 54\.990/)).toBeVisible();
});

test("F-07.1: a new price for today is used and history shows two entries", async ({ page }) => {
  desktop(page);
  await login(page);
  await page.goto("/aset");
  await page.getByRole("link", { name: "Emas" }).click();
  await page.getByLabel("Harga per gram (Rp)").fill("2600000");
  await page.getByRole("button", { name: "Simpan harga" }).click();
  await expect(page.getByText("Harga tersimpan.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Rp 42.900.000").first()).toBeVisible(); // 16,5 × 2.600.000
  await expect(page.getByRole("heading", { name: "Riwayat harga" }).locator("..").locator("tbody tr")).toHaveCount(3); // 31 Okt, 10 Nov, 14 Nov
});

test("F-02.1: archiving an account with 10 transactions keeps them in S-08", async ({ page }) => {
  desktop(page);
  const n = Number(sql(`select count(*) from transactions where account_id = (select id from accounts where name = 'Mandiri') and deleted_at is null;`));
  expect(n).toBeGreaterThanOrEqual(10);
  await login(page);
  await page.goto("/akun");
  await page.locator("li").filter({ hasText: /^Mandiri/ }).getByRole("button", { name: "Arsipkan" }).click();
  await expect(page.getByText("Akun diarsipkan.")).toBeVisible();
  await page.goto("/");
  await expect(page.locator("aside").getByText("Mandiri", { exact: true })).toHaveCount(0);
  const id = sql(`select id from accounts where name = 'Mandiri';`);
  await page.goto(`/transaksi?akun=${id}`);
  await expect(page.locator("table tbody tr")).toHaveCount(n);
  await expect(page.locator("table tbody tr").first()).toContainText("Mandiri");
});

test("F-03.4: editing an email amount keeps the email evidence and warns", async ({ page }) => {
  desktop(page);
  const id = sql(`select id from transactions where merchant_raw = 'Toko Obat Sehat';`);
  await login(page);
  await page.goto(`/transaksi/${id}`);
  await page.getByRole("button", { name: "Ubah" }).click();
  await page.getByLabel("Jumlah (Rp)").fill("65000");
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(page.getByText("Jumlah berbeda dari email.")).toBeVisible();
  await expect(page.getByText("Rp 63.500").first()).toBeVisible();
});

test("F-05.2: Enter confirms and selects the next item", async ({ page }) => {
  desktop(page);
  await login(page);
  await page.goto("/inbox?filter=merchant_baru");
  const list = page.getByRole("list", { name: "Item perlu dicek" });
  const first = await list.getByRole("button").first().innerText();
  await page.getByRole("button", { name: /Makan & minum/ }).first().click();
  await page.locator("body").press("Enter");
  await expect(page.getByText(/dikonfirmasi/i).first()).toBeVisible();
  await expect(list.getByRole("button").first()).not.toHaveText(first);
  await expect(list.getByRole("button").first()).toHaveAttribute("aria-current", "true");
});

test("F-05.2: swipe right 80 px confirms, left 80 px skips (mobile)", async ({ page }) => {
  mobile(page);
  await login(page);
  await page.goto("/inbox");
  const counter = page.getByText(/^\d+ dari \d+$/);
  const card = page.locator(".touch-pan-y").first();
  const title = async () => (await card.getByRole("heading", { level: 2 }).innerText()).trim();
  const swipe = async (dx: number) => {
    const b = (await card.boundingBox())!;
    const y = b.y + 40;
    await page.mouse.move(b.x + b.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx, y, { steps: 8 });
    await page.mouse.up();
  };
  const before = await title();
  await swipe(-90); // skip
  await expect.poll(title).not.toBe(before);
  await expect(counter).toHaveText(/^1 dari 7$/);
  // pick a category where needed, then swipe right
  const cat = page.getByLabel("Kategori", { exact: true });
  if (await cat.isVisible()) await cat.selectOption({ index: 1 });
  const open = Number(sql(`select count(*) from transactions where status = 'needs_review';`));
  await swipe(90);
  await expect.poll(() => Number(sql(`select count(*) from transactions where status = 'needs_review';`))).toBeLessThan(open);
});

test("F-06.3: Per bulan shows bars and an average line; Dana restores the runway", async ({ page }) => {
  desktop(page);
  await login(page);
  await page.getByRole("link", { name: "Per bulan" }).click();
  await expect(page).toHaveURL(/tampil=bulan/);
  await expect(page.getByText(/rata-rata Rp 8,4 jt/)).toBeVisible();
  await expect(page.locator("table.sr-only tbody tr")).toHaveCount(5); // Aug–Nov (seed has 4 months) + average
  await page.getByRole("link", { name: "Dana", exact: true }).click();
  await expect(page.getByRole("img", { name: /Grafik runway/ }).first()).toBeVisible();
});

test("F-06.2: a new planned expense adds a step to the runway series", async ({ page }) => {
  desktop(page);
  await login(page);
  const steps = async () => (await page.getByRole("img", { name: /Grafik runway/ }).first().locator("path").nth(1).getAttribute("d"))!;
  const before = await steps();
  await page.goto("/rencana");
  await page.getByLabel("Label").fill("Laptop");
  await page.getByLabel("Jumlah (Rp)").fill("12000000");
  await page.getByLabel("Jatuh tempo").fill("2027-05-01");
  await page.getByRole("button", { name: "Simpan rencana" }).click();
  await expect(page.getByText("Rencana tersimpan.")).toBeVisible();
  await page.goto("/");
  const after = await steps();
  expect(after).not.toBe(before);
  expect(after.split("L").length).toBe(before.split("L").length + 2); // before/after point pair on 1 May 2027
});

test("F-02.1 / F-02.3: a new account shows on the S-04 card row; zero active accounts show the prompt", async ({ page }) => {
  mobile(page);
  await login(page);
  await page.goto("/akun?baru=1");
  await page.getByLabel("Nama akun").fill("Jago");
  await page.getByLabel("Saldo awal", { exact: true }).fill("2350000");
  await page.getByRole("button", { name: "Simpan akun" }).click();
  await expect(page.getByText("Akun tersimpan.")).toBeVisible();
  await page.goto("/");
  const card = page.getByRole("list", { name: "Akun" }).getByRole("listitem").filter({ hasText: "Jago" });
  await expect(card).toContainText("Rp 2.350.000");
  sql(`update accounts set archived_at = now() where not is_system;`);
  await page.reload();
  await expect(page.getByRole("link", { name: "Tambah akun pertama" })).toBeVisible();
});

test("F-03.4: 120 transactions → 50 rows, the next 50 load at the bottom", async ({ page }) => {
  desktop(page);
  sql(`update transactions set deleted_at = now();
       insert into transactions (user_id, account_id, direction, amount, occurred_at, kind, category_id, status, source, merchant_raw)
       select a.user_id, a.id, 'out', 1000 + g, '2026-11-14T00:00:00Z'::timestamptz - make_interval(hours => g), 'expense',
              (select id from categories where name = 'Lainnya' and kind = 'expense'), 'confirmed', 'manual', 'Uji ' || g
       from accounts a, generate_series(1, 120) g where a.name = 'Mandiri';`);
  await login(page);
  await page.goto("/transaksi");
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(50);
  await page.getByRole("button", { name: /Muat lagi|Memuat/ }).scrollIntoViewIfNeeded();
  await expect(rows).toHaveCount(100);
});

test("F-03.5 / F-12.1: a remembered category applies to the next automatic transaction (webhook → 202)", async ({ page }) => {
  desktop(page);
  await login(page);
  await page.goto("/inbox?filter=merchant_baru");
  await page.getByRole("list", { name: "Item perlu dicek" }).getByRole("button", { name: /Toko Obat Sehat/ }).click();
  await page.getByRole("button", { name: /Kesehatan/ }).click();
  await expect(page.getByLabel(/Ingat kategori ini untuk Toko Obat Sehat/)).toBeChecked();
  await page.getByRole("button", { name: "Konfirmasi", exact: true }).click();
  await expect(page.getByText(/dikonfirmasi/i).first()).toBeVisible();
  const r = await page.request.post("/api/ingest/webhook", {
    headers: { "x-webhook-secret": process.env.WEBHOOK_SECRET! },
    data: { source_app: "Livin by Mandiri", posted_at: "2026-11-14T08:00:00Z", text: "Jenis Transaksi : Pembayaran QRIS\nPenerima : Toko Obat Sehat\nNominal : Rp 21.000,00\nTanggal : 14 Nov 2026\nWaktu : 15:00:00\nNo. Referensi : 99000111222\nSumber Dana : Mandiri ****4821" },
  });
  expect(r.status()).toBe(202);
  expect(sql(`select c.name || '|' || t.status from transactions t join categories c on c.id = t.category_id where t.amount = 21000;`)).toBe("Kesehatan|auto_confirmed");
  const bad = await page.request.post("/api/ingest/webhook", { headers: { "x-webhook-secret": "salah" }, data: { source_app: "x", text: "y" } });
  expect(bad.status()).toBe(401);
});
