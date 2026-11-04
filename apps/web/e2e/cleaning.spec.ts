import { expect, test, type Page } from "@playwright/test";
import { waitForMail } from "./mail";

async function ask(page: Page, text: string) {
  const input = page.getByLabel("Nachricht an den Assistenten");
  await input.fill(text);
  await input.press("Enter");
}

async function chatWithTemplate(page: Page, template: string) {
  await page.goto("/agents/new");
  await page.getByRole("button", { name: `Vorlage ${template} übernehmen` }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}\?neu=1$/);
  await page.getByRole("link", { name: "Im Chat testen" }).click();
  await expect(page.getByLabel("Nachricht an den Assistenten")).toBeVisible();
}

test("a QR code report goes from the public page to the team, the agent and back to the reporter", async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  const name = `Bürohaus Ring ${stamp}`;
  const manager = `objekt-${stamp}@huber.example`;
  const guest = `gast-${stamp}@example.at`;

  // The company sets up the object and prints its QR notice.
  await page.goto("/reports/objects");
  await page.getByLabel("Name des Objekts").fill(name);
  await page.getByLabel("Adresse (optional)").fill("Ring 12, 1010 Wien");
  await page.getByLabel("E-Mail der Objektleitung").fill(manager);
  await page.getByRole("button", { name: "Objekt anlegen" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Das Objekt ist angelegt. Drucken Sie jetzt den QR-Aushang.",
  );
  const row = page.getByTestId("facility").filter({ hasText: name });
  await expect(row).toContainText(`Meldungen an ${manager}`);
  await row.getByRole("link", { name: "QR-Aushang" }).click();
  await expect(page.getByRole("heading", { name: "Etwas nicht in Ordnung?" })).toBeVisible();
  await expect(page.getByTestId("qr").locator("svg")).toBeVisible();
  const url = (await page.getByText(/\/m\/[\w-]{20,40}$/).textContent())!.trim();
  const reportPath = new URL(url).pathname;

  // Someone in the building scans it – no account, no login.
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const phone = await visitor.newPage();
  await phone.goto(reportPath);
  await expect(phone.getByRole("heading", { name: `Mangel melden: ${name}` })).toBeVisible();
  await phone.getByLabel("Nachfüllen (Seife, Papier …)").check();
  await phone.getByLabel("Wo genau? (optional)").fill("WC Damen 2. OG");
  await phone.getByLabel("Beschreibung").fill("Seifenspender ist leer");
  await phone.getByLabel("E-Mail für eine Rückmeldung (optional)").fill(guest);
  await phone.getByRole("button", { name: "Meldung senden" }).click();
  await expect(phone.getByRole("status")).toContainText("Danke! Ihre Meldung ist angekommen");

  // The object manager is notified at once …
  const alert = await waitForMail(manager, (m) => m.subject === `Neue Meldung: ${name}`);
  expect(alert.text).toContain("WC Damen 2. OG");
  expect(alert.text).toContain("Seifenspender ist leer");

  // … and the report is waiting in the app, without showing the reporter's address.
  await page.goto("/reports");
  const report = page.getByTestId("report").filter({ hasText: name });
  await expect(report).toContainText("Offen");
  await expect(report).toContainText("Nachfüllen (Seife, Papier …)");
  await expect(report).toContainText("Rückmeldung gewünscht");
  await expect(report).not.toContainText(guest);
  await expect(page.getByRole("link", { name: /^Meldungen\s*\d+/ })).toBeVisible();

  // The complaints agent sees it as data.
  await chatWithTemplate(page, "Reklamations-Manager (QR-Meldungen)");
  await ask(page, "Offene Meldungen?");
  await expect(page.getByText(`${name} – WC Damen 2. OG: Seifenspender ist leer`)).toBeVisible({
    timeout: 20_000,
  });

  // The team works on it and closes it; the reporter gets a thank-you note.
  await page.goto("/reports");
  await report.getByRole("button", { name: "In Arbeit" }).click();
  await expect(page.getByRole("status")).toHaveText("Gespeichert.");
  await expect(report).toContainText("In Arbeit");
  page.once("dialog", (dialog) => void dialog.accept("Seife aufgefüllt"));
  await report.getByRole("button", { name: "Erledigt" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Erledigt – die meldende Person wurde benachrichtigt.",
  );
  await expect(report).toHaveCount(0);
  const thanks = await waitForMail(guest);
  expect(thanks.subject).toBe(`Ihre Meldung ist erledigt: ${name}`);
  expect(thanks.text).toContain("Seife aufgefüllt");
  await page.goto("/reports?status=done");
  await expect(report).toContainText("Erledigt");
  await expect(report).toContainText("Seife aufgefüllt");
  // The address was only needed for that one message.
  await expect(report).not.toContainText("Rückmeldung gewünscht");

  // A deactivated object's QR code stops working.
  await page.goto("/reports/objects");
  await row.getByRole("button", { name: "Deaktivieren" }).click();
  await expect(row).toContainText("deaktiviert");
  await phone.goto(reportPath);
  await expect(
    phone.getByRole("heading", { name: "Dieser QR-Code ist nicht mehr gültig" }),
  ).toBeVisible();
  await visitor.close();
});

test("the cleaning offer agent calculates with exact figures and warns about maximum values", async ({
  page,
}) => {
  await chatWithTemplate(page, "Angebotskalkulator Gebäudereinigung");
  await ask(page, "Kalkuliere das Bürohaus mit unseren Werten");
  const answer = page.getByText(/^Verrechnungssatz 27,95 € pro Stunde/);
  await expect(answer).toBeVisible({ timeout: 20_000 });
  // 664 hours a year: 400 m² at 200 m²/h plus 40 m² at 60 m²/h, 249 cleanings each.
  await expect(answer).toContainText("55.33 Stunden pro Monat");
  await expect(answer).toContainText(/Monatspreis 1\s591,57 € netto \(1\s909,88 € brutto\)/);
  await expect(answer).toContainText("liegt über dem Höchstwert 180 m²/h");
  await expect(page.getByText("Reinigung kalkulieren")).toBeVisible();
});
