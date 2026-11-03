import { expect, test } from "@playwright/test";
import { invitationLink } from "./mail";

const anonymous = { cookies: [], origins: [] };

test("a customer grants ME-IT support access; the session is visible and logged", async ({
  page,
  browser,
}) => {
  const suffix = Date.now().toString(36);
  const tenantName = `E2E Support ${suffix}`;

  // Partner creates the customer, the owner joins.
  await page.goto("/partner");
  await page.getByLabel("Firmenname").fill(tenantName);
  const ownerEmail = `support-${suffix}@e2e.test`;
  await page.getByLabel("E-Mail des Owners").fill(ownerEmail);
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.locator("[role=status]")).toContainText(tenantName);
  const link = await invitationLink(page, ownerEmail);

  const owner = await (await browser.newContext({ storageState: anonymous })).newPage();
  await owner.goto(link);
  await owner.getByLabel("Ihr Name").fill("Otto Owner");
  await owner.getByLabel("Passwort wählen").fill("Ein-sicheres-Passwort-3");
  await owner.getByLabel("Passwort wiederholen").fill("Ein-sicheres-Passwort-3");
  await owner.getByRole("button", { name: "Konto anlegen und beitreten" }).click();
  await expect(owner.getByRole("heading", { level: 1 })).toContainText("Otto");

  // Without a grant there is nothing to open.
  await page.goto("/partner");
  const row = page.getByRole("listitem").filter({ hasText: tenantName });
  await expect(row.getByRole("button", { name: "Öffnen" })).toHaveCount(0);

  // The owner grants access.
  await owner.goto("/settings/support");
  await owner.getByLabel("Anlass").fill("Angebots-Agent einrichten");
  await owner.getByRole("button", { name: "Zugriff freigeben" }).click();
  await expect(owner.getByRole("status")).toHaveText("Der Support-Zugriff ist freigegeben.");

  // Partner staff open the tenant and see the banner.
  await page.reload();
  await expect(row.getByText(/Support bis/)).toBeVisible();
  await row.getByRole("button", { name: "Öffnen" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "ME-IT-Support arbeitet in" }),
  ).toContainText(tenantName);

  // Support may look, but not manage people or support access itself.
  await page.goto("/settings/members");
  await expect(page.getByText("Otto Owner")).toBeVisible();
  await expect(page.getByRole("button", { name: "Einladen" })).toHaveCount(0);
  await page.goto("/settings/support");
  await expect(page.getByText("Den Support-Zugriff vergeben nur Owner.")).toBeVisible();

  await page.getByRole("button", { name: "Sitzung beenden" }).click();
  await expect(page).toHaveURL(/\/partner$/);

  // Everything is in the customer's audit log.
  await owner.goto("/settings/audit");
  await expect(owner.getByText("Support-Zugriff freigegeben")).toBeVisible();
  await expect(owner.getByText("Support-Sitzung gestartet")).toBeVisible();
  await expect(owner.getByText("Support-Sitzung beendet")).toBeVisible();
  await expect(owner.getByText(/Kette geprüft/)).toBeVisible();
});
