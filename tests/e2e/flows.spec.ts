// NFR-8: five end-to-end flows + axe on S-01, S-04, S-05, S-07, S-08, S-11 (seed data, APP_TODAY=2026-11-14).
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { login } from "./helpers";

test.beforeAll(() => {
  execSync("npm run seed -- --reset", { stdio: "ignore" });
});

const axe = async (page: import("@playwright/test").Page) => {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
};

test("S-01 has no serious axe violations; wrong code shows the clock hint", async ({ page }) => {
  await page.goto("/masuk");
  expect(await axe(page)).toEqual([]);
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Kata sandi").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.getByLabel("Kode 6 angka dari autentikator").fill("000000");
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Kode salah. Periksa jam di ponselmu lalu coba lagi.")).toBeVisible();
});

test("login with MFA → Beranda shows the golden runway above the fold", async ({ page }) => {
  await login(page);
  await expect(page.getByText("Dana tersisa")).toBeInViewport();
  await expect(page.getByText("287.000.000").first()).toBeInViewport();
  await expect(page.getByText("Sesuai rencana").first()).toBeInViewport();
  await expect(page.getByText("Rp 378.000").first()).toBeVisible();
  await expect(page.getByText("Pemasukan", { exact: true })).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("record an expense with the numpad (UF-2)", async ({ page, isMobile }) => {
  await login(page);
  await page.goto("/tambah/pengeluaran");
  expect(await axe(page)).toEqual([]);
  if (isMobile) {
    await page.getByRole("button", { name: "2", exact: true }).click();
    await page.getByRole("button", { name: "8", exact: true }).click();
    await page.getByRole("button", { name: "000", exact: true }).click();
  } else {
    await page.getByLabel("Jumlah (ketik angka)").fill("28000");
  }
  await expect(page.getByText("28.000").first()).toBeVisible();
  await page.getByRole("button", { name: /Makan & minum/ }).click();
  await page.getByRole("button", { name: "Simpan transaksi" }).click();
  await expect(page.getByText("Transaksi tersimpan.")).toBeVisible();
});

test("review the Inbox: confirm with the keyboard (UF-1)", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard shortcuts are desktop-only");
  await login(page);
  await page.goto("/inbox");
  expect(await axe(page)).toEqual([]);
  await page.getByRole("button", { name: /Makan & minum/ }).first().click();
  await page.locator("body").press("Enter");
  await expect(page.getByText(/Dikonfirmasi|dikonfirmasi/)).toBeVisible();
});

test("update an asset price (S-11 / S-12)", async ({ page }) => {
  await login(page);
  await page.goto("/aset");
  expect(await axe(page)).toEqual([]);
  // the expense test above already spent Rp 28.000, so check a row it cannot touch
  await expect(page.getByText("Rp 41.679.000").first()).toBeVisible();
  await page.getByRole("link", { name: "Emas" }).click();
  await page.getByLabel("Harga per gram (Rp)").fill("2530000");
  await page.getByRole("button", { name: "Simpan harga" }).click();
  await expect(page.getByText("Harga tersimpan.")).toBeVisible();
});

test("split a bill and open WhatsApp (UF-4)", async ({ page }) => {
  await login(page);
  await page.goto("/transaksi");
  expect(await axe(page)).toEqual([]);
  await page.getByRole("link", { name: /Kedai Kopi Senja/ }).first().click();
  await page.getByRole("link", { name: "Bagi tagihan" }).click();
  await page.getByRole("button", { name: "Tambah peserta" }).click();
  await page.getByRole("button", { name: "Bagi rata semua" }).click();
  await expect(page.getByText(/sama dengan total nota/)).toBeVisible();
  await page.getByRole("button", { name: "Bagikan" }).click();
  await expect(page.getByRole("link", { name: "Buka WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\//);
});
