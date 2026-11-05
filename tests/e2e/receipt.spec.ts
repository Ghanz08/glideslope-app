// F-09 on the running stack. No LLM router is running, so extraction fails and the manual form opens (F-09.1).
import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { login } from "./helpers";

const sql = (q: string) => execSync(`docker exec -i supabase_db_glideslope psql -U postgres -At`, { input: q }).toString().trim();

test.beforeAll(() => {
  execSync("npm run seed -- --reset", { stdio: "ignore" });
});

/** JPEG dimensions from the SOF marker. */
function jpegSize(b: Buffer) {
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

test("F-09.1/F-09.2/F-09.3: resize, private bucket, 60 s link, PDF refused, manual form, mismatch blocks confirm, receipt-only Inbox item", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1024, "desktop layout");
  test.setTimeout(120_000);
  await login(page);
  await page.goto("/nota/baru");

  // PDF is refused inline
  await page.locator('input[type=file]:not([capture])').setInputFiles({ name: "nota.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  await expect(page.getByText("Pilih foto JPEG, PNG, atau WebP.")).toBeVisible();

  // a 4032 × 3024 noisy photo bigger than 5 MB, made in the browser
  const original = await page.evaluate(async () => {
    const c = Object.assign(document.createElement("canvas"), { width: 4032, height: 3024 });
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(4032, 3024);
    for (let i = 0; i < img.data.length; i++) img.data[i] = (Math.random() * 256) | 0;
    ctx.putImageData(img, 0, 0);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.95));
    const input = document.querySelector<HTMLInputElement>("input[type=file]:not([capture])")!;
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "foto.jpg", { type: "image/jpeg" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return blob.size;
  });
  expect(original).toBeGreaterThan(5 * 1024 * 1024);
  await page.waitForURL(/\/nota\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const id = page.url().split("/").pop()!;

  // stored image: longest side 1568, < 5 MB, in a private bucket
  const [path, size] = sql(`select name, (metadata->>'size') from storage.objects where bucket_id = 'receipts' and name like '%${id}%';`).split("|");
  expect(Number(size)).toBeLessThan(5 * 1024 * 1024);
  expect(sql(`select public from storage.buckets where id = 'receipts';`)).toBe("f");
  const redirect = await page.request.get(`/api/receipts/${id}/image`, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  const signed = new URL(redirect.headers()["location"]);
  const claims = JSON.parse(Buffer.from(signed.searchParams.get("token")!.split(".")[1], "base64url").toString());
  expect(claims.exp - claims.iat).toBe(60);
  const img = Buffer.from(await (await page.request.get(signed.toString())).body());
  expect(Math.max(...Object.values(jpegSize(img)!))).toBe(1568);
  expect(path).toContain(id);

  // no router: status gagal, manual form with the image next to it
  await expect(page.getByText("Nota belum terbaca otomatis.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Foto nota" })).toBeVisible();

  // numbers that do not add up cannot be confirmed
  await page.getByLabel("Merchant").fill("Toko Uji Tanpa Email");
  await page.getByRole("button", { name: "Tambah item" }).click();
  await page.getByLabel("Nama item 1").fill("Barang");
  await page.getByLabel("Harga satuan item 1").fill("50000");
  await page.getByLabel("Total baris item 1").fill("50000");
  await page.getByLabel("Subtotal").fill("50000");
  await page.getByLabel("Total", { exact: true }).fill("55000");
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(page.getByText("Hitungan belum cocok: periksa bidang yang ditandai.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Konfirmasi nota" })).toBeDisabled();

  // fix the total → flag clears, confirm enabled
  await page.getByLabel("Total", { exact: true }).fill("50000");
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(page.getByText("Hitungan cocok.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Konfirmasi nota" })).toBeEnabled();
  await page.getByRole("button", { name: "Konfirmasi nota" }).click();
  await expect(page.getByText(/nota tanpa email/i).first()).toBeVisible();

  // no matching transaction → "Nota tanpa email" in the Inbox
  await page.goto("/inbox");
  const item = page.getByRole("list", { name: "Item perlu dicek" }).getByRole("button", { name: /Toko Uji Tanpa Email/ });
  await expect(item).toContainText("Nota tanpa email");
});
