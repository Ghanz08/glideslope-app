// F-01.1: first sign-in enrols TOTP through the UI. The QR shown must stay valid after the
// page re-renders (regression: rendering /masuk used to replace the factor).
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { totp } from "./helpers";

// local test DB only: the single-owner trigger is paused while the throwaway user is created
const psql = (q: string) => execFileSync("docker", ["exec", "supabase_db_glideslope", "psql", "-U", "supabase_admin", "-d", "postgres", "-Atc", q]);

const email = "pendaftaran-uji@contoh.test";
const password = "sandi-pendaftaran-uji-1";
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

test("first sign-in: password → QR → code → onboarding", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1024, "runs once");
  psql("alter table auth.users disable trigger reject_extra_users");
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true }).finally(() => psql("alter table auth.users enable trigger reject_extra_users"));
  expect(error).toBeNull();
  try {
    await page.goto("/masuk");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Kata sandi").fill(password);
    await page.getByRole("button", { name: "Masuk" }).click();
    const secret = (await page.locator("code").innerText()).trim();
    await page.waitForTimeout(1500); // let the post-action re-render of /masuk happen, as in the owner's report
    // a wrong code keeps the same QR on screen
    await page.getByLabel("Kode 6 angka dari autentikator").fill("000000");
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page.getByText("Kode salah. Periksa jam di ponselmu lalu coba lagi.")).toBeVisible();
    await expect(page.locator("code")).toHaveText(secret);
    // the code from the QR that was scanned works
    await page.getByLabel("Kode 6 angka dari autentikator").fill(totp(secret));
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForURL(/\/mulai/);
  } finally {
    await admin().auth.admin.deleteUser(data!.user!.id);
  }
});
