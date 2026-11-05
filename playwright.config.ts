import { defineConfig, devices } from "@playwright/test";

// Needs: `supabase start`, seeded owner (npm run seed), APP_TODAY=2026-11-14, and E2E_EMAIL / E2E_PASSWORD / E2E_TOTP_SECRET.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  // the suite mutates the seeded owner, so it runs in order and reseeds per project
  workers: 1,
  fullyParallel: false,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run dev", url: "http://localhost:3000/masuk", reuseExistingServer: true, timeout: 120_000 },
});
