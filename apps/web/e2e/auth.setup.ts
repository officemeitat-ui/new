import { expect, test as setup } from "@playwright/test";

export const ADMIN_STATE = "e2e/.auth/admin.json";

// Sign in once and reuse the session: the login endpoint is rate-limited on purpose.
setup("sign in as the seeded ME-IT admin", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(process.env.SEED_ADMIN_EMAIL ?? "admin@me-it.local");
  await page
    .getByLabel("Passwort", { exact: true })
    .fill(process.env.SEED_ADMIN_PASSWORD ?? "Demo-Passwort-2026");
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.context().storageState({ path: ADMIN_STATE });
});
