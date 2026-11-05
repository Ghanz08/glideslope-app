// PRD acceptance criteria checked against the running stack (seed 5.5, APP_TODAY=2026-11-14).
// Read-only checks first, then the ones that change data. Each test names its criterion.
import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { login } from "./helpers";

const sql = (q: string) => execSync(`docker exec -i supabase_db_glideslope psql -U postgres -At`, { input: q }).toString().trim();
const balance = (name: string) => Number(sql(`select account_balance_at(id, '2026-11-14') from accounts where name = '${name}' and archived_at is null;`));
const spendNov = () => Number(sql(`select coalesce(sum(amount),0) from transactions where kind in ('expense','fee') and status <> 'ignored' and deleted_at is null and occurred_at >= '2026-10-31T17:00Z';`));

test.beforeAll(() => {
  execSync("npm run seed -- --reset", { stdio: "ignore" });
});

async function desktopOnly(page: Page) {
  test.skip((page.viewportSize()?.width ?? 0) < 1024, "desktop layout");
}
async function mobileOnly(page: Page) {
  test.skip((page.viewportSize()?.width ?? 0) >= 1024, "mobile layout");
}

test("F-02.3 / F-06.4: account cards, review card, verified icon, badge", async ({ page }) => {
  await login(page);
  const wide = (page.viewportSize()?.width ?? 0) >= 1280;
  if (wide) {
    await expect(page.getByText("Rp 281.790.000")).toBeVisible(); // "Aset lain"
  } else {
    const cards = page.getByRole("list", { name: "Akun" }).getByRole("listitem");
    await expect(cards).toHaveCount(6);
    const second = await cards.nth(1).boundingBox();
    const vw = page.viewportSize()!.width;
    expect(second!.x).toBeLessThan(vw);
    expect(second!.x + second!.width).toBeGreaterThan(vw); // peeks at the right edge
    const mandiri = cards.filter({ hasText: "Mandiri" });
    await expect(mandiri.getByText("Dari email")).toBeVisible();
    await expect(mandiri.locator("svg").last()).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: /Perlu dicek/ }).first()).toBeVisible();
  await expect(page.getByLabel("7 item perlu dicek").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: "Terverifikasi dari email dan nota" }).first()).toBeAttached();
});

test("F-06.3: runway alt text names funds, leftover and depletion month", async ({ page }) => {
  await login(page);
  const alt = await page.getByRole("img", { name: /Grafik runway/ }).first().getAttribute("aria-label");
  expect(alt).toContain("Dana sekarang Rp 287.000.000");
  expect(alt).toContain("Sisa saat lulus");
  expect(alt).toContain("Jun 2029");
});

test("F-07.2: liquidity ladder rows and total", async ({ page }) => {
  await login(page);
  await page.goto("/aset");
  for (const v of ["Rp 5.210.000", "Rp 60.000.000", "Rp 140.000.000", "Rp 41.679.000", "Rp 40.111.000"]) await expect(page.getByText(v, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("287.000.000").first()).toBeVisible();
});

test("F-08.1: 6 bars, average Rp 8,4 jt, unfinished month marked, data table, bar opens that month", async ({ page }) => {
  await login(page);
  await page.goto("/analitik");
  await expect(page.locator("table.sr-only tbody tr")).toHaveCount(7); // 6 months + average row
  await expect(page.getByText("rata-rata Rp 8,4 jt")).toBeVisible();
  await expect(page.getByText("belum selesai").first()).toBeVisible();
  await expect(page.locator(".pola-diagonal").first()).toBeAttached();
  await page.getByRole("link", { name: /^Agu/ }).first().click();
  await expect(page).toHaveURL(/bulan=2026-08/);
  await expect(page.getByText("Agustus 2026")).toBeVisible();
  const dates = await page.locator("table tbody td:first-child").allInnerTexts();
  for (const d of dates.filter(Boolean)) expect(d).toMatch(/Agu/);
});

test("F-08.2: a month before the first transaction is empty", async ({ page }) => {
  await login(page);
  await page.goto("/analitik?rentang=6&bulan=2026-06");
  await expect(page.getByText("Belum ada data bulan ini.")).toBeVisible();
});

test("F-05.1: Merchant baru filter and nav badge", async ({ page }) => {
  await desktopOnly(page);
  await login(page);
  await page.goto("/inbox?filter=merchant_baru");
  const list = page.getByRole("list", { name: "Item perlu dicek" });
  await expect(list.getByText("Toko Obat Sehat")).toBeVisible();
  await expect(list.getByText("Toko Bangunan Jaya")).toHaveCount(0); // hanya_nota
  await expect(list.getByText(/Transfer masuk/)).toHaveCount(0);
});

test("F-04.5: six senders with 30-day counts", async ({ page }) => {
  await login(page);
  await page.goto("/sumber");
  await expect(page.getByText(/^30 hari:/)).toHaveCount(6);
});

test("F-04.1: callback with a wrong state → 400, nothing stored", async ({ page }) => {
  await login(page);
  const before = sql(`select count(*) from vault.secrets;`);
  const r = await page.request.get("/api/gmail/callback?state=salah&code=x", { maxRedirects: 0 });
  expect(r.status()).toBe(400);
  expect(sql(`select count(*) from vault.secrets;`)).toBe(before);
  expect(sql(`select status from integrations;`)).toBe("terputus");
});

test("F-13.1: export without re-verification → 403", async ({ page }) => {
  await login(page);
  const r = await page.request.post("/api/export", { data: {} });
  expect(r.status()).toBe(403);
});

test("F-03.2: Tambah menu has exactly 5 rows", async ({ page }) => {
  await mobileOnly(page);
  await login(page);
  await page.getByRole("button", { name: "Tambah transaksi" }).click();
  const sheet = page.getByRole("dialog", { name: "Tambah" });
  await expect(sheet.getByRole("listitem")).toHaveCount(5);
  for (const t of ["Belanja, makan, atau tagihan", "Uang saku, honor, atau transfer masuk", "Pindah saldo, bukan pemasukan", "Foto nota, dicocokkan dengan email", "Pecah nota untuk beberapa teman"])
    await expect(sheet.getByText(t)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

// ---------------------------------------------------------------- mutating checks
test("F-03.1: amount 0 disables Simpan; a double click saves once; Mandiri −28.000", async ({ page }) => {
  await desktopOnly(page);
  await login(page);
  const before = balance("Mandiri");
  await page.goto("/tambah/pengeluaran");
  await expect(page.getByRole("button", { name: "Simpan transaksi" })).toBeDisabled();
  await page.getByLabel("Jumlah (ketik angka)").fill("28000");
  await page.getByRole("button", { name: /Makan & minum/ }).click();
  await page.getByRole("group", { name: "Akun" }).getByRole("button", { name: "Mandiri" }).click();
  await page.getByLabel("Catatan").fill("e2e-dobel");
  await page.getByRole("button", { name: "Simpan transaksi" }).dblclick();
  await expect(page.getByText("Transaksi tersimpan.")).toBeVisible();
  expect(sql(`select count(*) from transactions where note = 'e2e-dobel';`)).toBe("1");
  expect(balance("Mandiri")).toBe(before - 28000);
});

test("F-03.2 / F-07.4: income Rp 1.500.000 to BNI raises BNI, not spending, and shows on S-11", async ({ page }) => {
  await desktopOnly(page);
  await login(page);
  const [bni, spend] = [balance("BNI"), spendNov()];
  await page.goto("/tambah/pemasukan");
  await page.getByLabel("Jumlah (ketik angka)").fill("1500000");
  await page.getByRole("button", { name: /Uang saku/ }).click();
  await page.getByRole("group", { name: "Akun" }).getByRole("button", { name: "BNI" }).click();
  await page.getByRole("button", { name: "Simpan transaksi" }).click();
  await expect(page.getByText("Transaksi tersimpan.")).toBeVisible();
  expect(balance("BNI")).toBe(bni + 1_500_000);
  expect(spendNov()).toBe(spend);
  // Table 5.4-G: every income row this month (the seed already has Rina's Rp 150.000)
  const income = Number(sql(`select sum(amount) from transactions where kind = 'income' and status <> 'ignored' and deleted_at is null and occurred_at >= '2026-10-31T17:00Z';`));
  expect(income).toBe(1_650_000);
  await page.goto("/aset");
  await expect(page.getByText("+Rp 1.650.000").filter({ visible: true }).first()).toBeVisible();
});

test("F-03.3: same account refused; transfer list shows two Transfer rows and a fee", async ({ page }) => {
  await desktopOnly(page);
  await login(page);
  await page.goto("/tambah/transfer");
  await page.getByRole("group", { name: "Dari akun" }).getByRole("button", { name: "OVO" }).click();
  await page.getByRole("group", { name: "Ke akun" }).getByRole("button", { name: "OVO" }).click();
  await expect(page.getByText("Akun asal dan tujuan harus berbeda.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Simpan transaksi" })).toBeDisabled();
  await page.getByRole("group", { name: "Dari akun" }).getByRole("button", { name: "Mandiri" }).click();
  await page.getByLabel("Jumlah (ketik angka)").fill("100000");
  await page.getByLabel("Biaya admin (Rp)").fill("1000");
  await page.getByRole("button", { name: "Simpan transaksi" }).click();
  await expect(page.getByText(/tersimpan/)).toBeVisible();
  await page.goto("/transaksi?jenis=transfer");
  await expect(page.locator("table tbody tr").filter({ hasText: "Rp 100.000" })).toHaveCount(2);
  await page.goto("/transaksi?q=Biaya%20admin");
  await expect(page.locator("table tbody tr").filter({ hasText: "Rp 1.000" })).toHaveCount(1);
});

test("F-03.4: search, delete + undo", async ({ page }) => {
  await desktopOnly(page);
  await login(page);
  await page.goto("/transaksi");
  await page.getByLabel("Cari merchant atau catatan").fill("kopi");
  await expect(page).toHaveURL(/q=kopi/);
  const rows = page.locator("table tbody tr");
  await expect(rows.first()).toBeVisible();
  for (const t of await rows.allInnerTexts()) expect(t.toLowerCase()).toContain("kopi");
  const before = balance("Mandiri");
  await rows.first().getByRole("link").click();
  await page.getByRole("button", { name: "Hapus", exact: true }).click();
  await page.getByRole("button", { name: "Hapus transaksi" }).click();
  await page.getByRole("button", { name: "Urungkan" }).click();
  await expect.poll(() => balance("Mandiri")).toBe(before);
});

test("F-02.1: add account, duplicate name, decimal opening balance", async ({ page }) => {
  await desktopOnly(page);
  await login(page);
  await page.goto("/akun?baru=1");
  const form = page.locator("form").filter({ has: page.getByLabel("Nama akun") });
  await form.getByLabel("Nama akun").fill("mandiri");
  await form.getByLabel("Saldo awal", { exact: true }).fill("1000");
  await form.getByRole("button", { name: "Simpan akun" }).click();
  await expect(page.getByText("Nama akun sudah dipakai.")).toBeVisible();
  await form.getByLabel("Nama akun").fill("Jago");
  await form.getByLabel("Saldo awal", { exact: true }).fill("1.5");
  await form.getByRole("button", { name: "Simpan akun" }).click();
  await expect(page.getByText("Saldo harus bilangan bulat rupiah.")).toBeVisible();
  await form.getByLabel("Saldo awal", { exact: true }).fill("2350000");
  await form.getByRole("button", { name: "Simpan akun" }).click();
  await expect(page.getByRole("link", { name: /^Jago/ })).toBeVisible();
  await expect(page.getByText("Rp 2.350.000").first()).toBeVisible();
});

test("F-11.1: checkpoint difference and future date", async ({ page }) => {
  await desktopOnly(page);
  await login(page);
  await page.goto("/akun");
  await page.getByRole("link", { name: /^Mandiri/ }).click();
  const cp = page.locator("form").filter({ has: page.getByLabel("Saldo menurut bank") });
  const computed = balance("Mandiri");
  await cp.getByLabel("Saldo menurut bank").fill(String(computed + 12000));
  await cp.getByRole("button", { name: "Simpan titik cek" }).click();
  await expect(page.getByText("Selisih Rp 12.000").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Tambah transaksi yang terlewat" })).toBeVisible();
  // React resets uncontrolled fields when the action's transition ends; wait for it before typing
  await expect(cp.getByRole("button", { name: "Simpan titik cek" })).toBeEnabled();
  await page.waitForLoadState("networkidle");
  await cp.getByLabel("Tanggal saldo").fill("2026-12-31");
  await expect(cp.getByLabel("Tanggal saldo")).toHaveValue("2026-12-31");
  await cp.getByRole("button", { name: "Simpan titik cek" }).click();
  await expect(page.getByText("Tanggal tidak boleh di masa depan.")).toBeVisible();
});

test("F-05.4 / F-06.2 / F-01.3 / F-03.5: settings validation and persistence, used category cannot be deleted", async ({ page }) => {
  await desktopOnly(page);
  await login(page);
  await page.goto("/pengaturan");
  await page.getByLabel("Ambang nominal besar (Rp)").fill("5000");
  await page.getByRole("button", { name: "Simpan pengaturan" }).click();
  await expect(page.getByText("Ambang minimal Rp 10.000.")).toBeVisible();
  await page.getByLabel("Ambang nominal besar (Rp)").fill("600000");
  await page.getByLabel("Instruksi pembayaran di pesan penagihan").fill("Transfer ke BNI a.n. Pemilik");
  await page.getByRole("button", { name: "Simpan pengaturan" }).click();
  await expect(page.getByText("Pengaturan tersimpan.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Ambang nominal besar (Rp)")).toHaveValue("600.000");
  await expect(page.getByLabel("Instruksi pembayaran di pesan penagihan")).toHaveValue("Transfer ke BNI a.n. Pemilik");
  const used = page.locator("li").filter({ hasText: /^Makan & minum/ });
  await expect(used.getByRole("button", { name: "Arsipkan" })).toBeVisible();
  await expect(used.getByRole("button", { name: "Hapus" })).toHaveCount(0);
  await page.goto("/rencana");
  await page.getByLabel("Label").fill("Uji nol");
  await page.getByLabel("Jatuh tempo").fill("2027-01-10");
  await page.getByRole("button", { name: "Simpan rencana" }).click();
  await expect(page.getByText("Jumlah harus lebih dari 0.")).toBeVisible();
});

test("F-01.1: 6th failed login within 15 minutes is blocked with the remaining time", async ({ page }) => {
  await page.goto("/masuk");
  for (let i = 0; i < 6; i++) {
    await page.getByLabel("Email").fill("bukan-pemilik@contoh.test");
    await page.getByLabel("Kata sandi").fill(`salah-${i}`);
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page.getByText(/salah|Terlalu banyak/).first()).toBeVisible();
  }
  await expect(page.getByText(/Terlalu banyak percobaan\. Coba lagi dalam \d+ menit\./)).toBeVisible();
});

test("F-01.2: idle lock hides money, correct PIN restores, 5 wrong PINs end the session", async ({ page }) => {
  await desktopOnly(page);
  test.setTimeout(180_000);
  await login(page);
  await page.goto("/pengaturan");
  await page.getByLabel("Batas idle kunci aplikasi").selectOption("1");
  await page.getByRole("button", { name: "Simpan pengaturan" }).click();
  await expect(page.getByText("Pengaturan tersimpan.")).toBeVisible();
  await page.getByLabel(/PIN \(6 angka\)/).fill("123456");
  await page.getByRole("button", { name: "Simpan PIN" }).click();
  await expect(page.getByText("PIN tersimpan.")).toBeVisible();
  expect(sql(`select pin_hash is not null and pin_salt is not null and pin_iterations >= 210000 from app_settings;`)).toBe("t");
  await page.goto("/");
  await expect(page.getByText("Dana tersisa")).toBeVisible();
  await page.waitForTimeout(62_000);
  await expect(page.getByRole("heading", { name: "Masukkan PIN" })).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/Rp\s?\d/);
  const pin = page.getByLabel("PIN 6 angka");
  const started = Date.now();
  await pin.fill("123456");
  await expect(page.getByText("Dana tersisa")).toBeVisible({ timeout: 1000 });
  expect(Date.now() - started).toBeLessThanOrEqual(1000);
  // lock again and fail five times
  await page.request.post("/api/pin/lock");
  await page.reload();
  for (let i = 0; i < 5; i++) {
    await page.getByLabel("PIN 6 angka").fill("000000");
    if (i < 4) await expect(page.getByText(/PIN salah\. Sisa/)).toBeVisible();
  }
  await page.waitForURL(/\/masuk/);
  sql(`update app_settings set pin_hash = null, pin_salt = null, pin_iterations = null, idle_timeout_minutes = 5;`);
});
