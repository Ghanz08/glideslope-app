// F-08.3 on the seed data (APP_TODAY=2026-11-14): the Rp 9.000.000 semester fee is the large expense.
import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { login } from "./helpers";

const sql = (q: string) => execSync(`docker exec -i supabase_db_glideslope psql -U postgres -At`, { input: q }).toString().trim();

test.beforeAll(() => execSync("npm run seed -- --reset", { stdio: "ignore" }));

test("F-08.3: large expenses list, threshold edge, one-off toggle lowers the average", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1024, "desktop layout");
  sql(`update transactions set is_one_off = false where merchant_raw = 'Biaya semester';
       insert into transactions (user_id, account_id, direction, amount, occurred_at, kind, category_id, status, source, merchant_raw)
       select user_id, id, 'out', 499999, '2026-10-20T05:00:00Z', 'expense', (select id from categories where name = 'Lainnya' and kind = 'expense'), 'confirmed', 'manual', 'Hampir besar'
       from accounts where name = 'Mandiri';`);
  await login(page);
  await page.goto("/analitik?rentang=6");
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Pengeluaran besar" }) });
  const row = card.locator("li").filter({ hasText: "Biaya semester" });
  await expect(row).toContainText("Rp 9.000.000");
  const toggle = row.getByRole("switch", { name: "Sekali-jalan: Biaya semester" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(card.getByText("Hampir besar")).toHaveCount(0);
  const avgBefore = await page.getByText(/^rata-rata Rp/).innerText();
  await toggle.click();
  await expect(page.getByText("Biaya semester ditandai sekali-jalan.")).toBeVisible();
  await page.reload();
  await expect(card.getByRole("switch", { name: "Sekali-jalan: Biaya semester" })).toHaveAttribute("aria-checked", "true");
  expect(await page.getByText(/^rata-rata Rp/).innerText()).not.toBe(avgBefore);
});
