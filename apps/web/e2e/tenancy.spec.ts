import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@me-it.local";
const anonymous = { cookies: [], origins: [] };

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
}

test.describe("anonymous visitors", () => {
  test.use({ storageState: anonymous });

  test("unauthenticated visitors are sent to the login and back", async ({ page }) => {
    await page.goto("/settings/members");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fmembers/);
  });

  test("wrong password shows a neutral message", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, "definitiv-falsch");
    await expect(page.locator("p[role=alert]")).toHaveText(
      "E-Mail-Adresse oder Passwort stimmen nicht.",
    );
  });
});

test("partner provisions a tenant, the owner joins and the audit chain holds", async ({
  page,
  browser,
}) => {
  const suffix = Date.now().toString(36);
  const ownerEmail = `owner-${suffix}@e2e.test`;

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Guten (Morgen|Tag|Abend)/);

  await page.goto("/partner");
  await page.getByLabel("Firmenname").fill(`E2E Tischlerei ${suffix}`);
  await page.getByLabel("E-Mail des Owners").fill(ownerEmail);
  await page.getByRole("button", { name: "Anlegen" }).click();
  const status = page.locator("[role=status]");
  await expect(status).toContainText(`E2E Tischlerei ${suffix}`);

  // Locally and in CI there may be no SMTP server: then the invitation link is shown instead.
  const link = await status
    .locator("code")
    .textContent({ timeout: 2_000 })
    .catch(() => null);
  test.skip(!link, "Invitation e-mail was delivered; link not shown in the UI.");

  // A fresh browser without the admin session, as the invited person would have.
  const owner = await (await browser.newContext({ storageState: anonymous })).newPage();
  await owner.goto(link!);
  await expect(owner.getByRole("heading", { name: /Einladung zu E2E Tischlerei/ })).toBeVisible();
  await owner.getByLabel("Ihr Name").fill("Olga Owner");
  await owner.getByLabel("Passwort wählen").fill("Ein-sicheres-Passwort-1");
  await owner.getByLabel("Passwort wiederholen").fill("Ein-sicheres-Passwort-1");
  await owner.getByRole("button", { name: "Konto anlegen und beitreten" }).click();
  await expect(owner.getByRole("heading", { level: 1 })).toContainText("Olga");

  await owner.goto("/settings/audit");
  await expect(owner.getByText(/Kette geprüft · 3 Einträge/)).toBeVisible();

  // Customers never see the partner console.
  await owner.goto("/partner");
  await expect(owner).toHaveURL(/\/$/);

  // The link cannot be used twice.
  await owner.goto(link!);
  await expect(owner.getByText("Einladung nicht gültig")).toBeVisible();
});

test("accounts cannot be created without an invitation", async ({ request }) => {
  const response = await request.post("/api/auth/sign-up/email", {
    data: { email: "niemand@e2e.test", password: "Irgendwas-12345", name: "Niemand" },
    headers: { origin: "http://localhost:3000" },
  });
  expect(response.status()).toBe(403);
});
