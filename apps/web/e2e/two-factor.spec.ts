import { expect, test } from "@playwright/test";
import { invitationLink, waitForMail } from "./mail";
import { totp } from "./totp";

const anonymous = { cookies: [], origins: [] };

test("an owner sets up two-factor authentication and needs the code at the next login", async ({
  page,
  browser,
}) => {
  const suffix = Date.now().toString(36);
  const email = `zwei-faktor-${suffix}@e2e.test`;
  const password = "Ein-sicheres-Passwort-2";

  // The seeded admin creates a customer whose owner we then play.
  await page.goto("/partner");
  await page.getByLabel("Firmenname").fill(`E2E Sicherheit ${suffix}`);
  await page.getByLabel("E-Mail des Owners").fill(email);
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.locator("[role=status]")).toContainText(`E2E Sicherheit ${suffix}`);
  const link = await invitationLink(page, email);

  const context = await browser.newContext({ storageState: anonymous });
  const owner = await context.newPage();
  await owner.goto(link);
  await owner.getByLabel("Ihr Name").fill("Sabine Sicher");
  await owner.getByLabel("Passwort wählen").fill(password);
  await owner.getByLabel("Passwort wiederholen").fill(password);
  await owner.getByRole("button", { name: "Konto anlegen und beitreten" }).click();
  await expect(owner.getByRole("heading", { level: 1 })).toContainText("Sabine");

  // Set up 2FA.
  await owner.goto("/account");
  await expect(owner.getByText("Nicht aktiv")).toBeVisible();
  await owner.getByRole("button", { name: "Zwei-Faktor-Anmeldung einrichten" }).click();
  await owner.getByLabel("Zur Bestätigung: Ihr Passwort").fill(password);
  await owner.getByRole("button", { name: "Weiter" }).click();
  const secret = (await owner.getByTestId("totp-secret").textContent())!.trim();
  await expect(owner.getByRole("list", { name: "Backup-Codes" }).getByRole("listitem")).toHaveCount(
    10,
  );
  await owner.getByLabel("Code aus der App").fill(totp(secret));
  await owner.getByRole("button", { name: "Einrichtung abschließen" }).click();
  await expect(owner.getByText("Aktiv", { exact: true })).toBeVisible();

  // A new sign-in now needs the second factor.
  await context.clearCookies();
  await owner.goto("/login");
  await owner.getByLabel("E-Mail-Adresse").fill(email);
  await owner.getByLabel("Passwort", { exact: true }).fill(password);
  await owner.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(owner.getByRole("heading", { name: "Bestätigung" })).toBeVisible();

  await owner.getByLabel("Code", { exact: true }).fill("000000");
  await owner.getByRole("button", { name: "Bestätigen" }).click();
  await expect(owner.locator("p[role=alert]")).toHaveText("Der Code stimmt nicht.");

  await owner.getByLabel("Code", { exact: true }).fill(totp(secret));
  await owner.getByRole("button", { name: "Bestätigen" }).click();
  await expect(owner.getByRole("heading", { level: 1 })).toContainText("Sabine");

  // The e-mail link must not skip the second factor: the account gets a hint, not a link.
  await context.clearCookies();
  await owner.goto("/login");
  await owner.getByRole("button", { name: "Ohne Passwort per E-Mail-Link anmelden" }).click();
  await owner.getByLabel("E-Mail-Adresse").fill(email);
  await owner.getByRole("button", { name: "Anmeldelink senden" }).click();
  await expect(owner.getByText("Bitte prüfen Sie Ihr Postfach")).toBeVisible();
  const hint = await waitForMail(email, (m) => m.subject === "Anmeldung mit Passwort und Code");
  expect(hint.text).not.toContain("token=");
  await context.close();
});
