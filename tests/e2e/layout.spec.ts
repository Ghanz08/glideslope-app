// Section 4.13 / 4.6: no horizontal page scroll at 360, 768, 1280 px; primary action above the fold at 360 × 780.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("S-04, S-05, S-08, S-11 at 360 / 768 / 1280 px", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1024, "runs once, resizes itself");
  test.setTimeout(240_000);
  await login(page);
  for (const [w, h] of [[360, 780], [768, 1024], [1280, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const path of ["/", "/inbox", "/transaksi", "/aset"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow, `${w}px ${path}`).toBe(false);
    }
  }
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/");
  await expect(page.getByText("Sesuai rencana").first()).toBeInViewport();
  await expect(page.getByRole("button", { name: "Tambah transaksi" })).toBeInViewport();
  await page.goto("/inbox");
  await expect(page.getByRole("button", { name: "Konfirmasi" }).first()).toBeInViewport({ ratio: 1 });
});
