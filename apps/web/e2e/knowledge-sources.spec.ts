import { expect, test, type Page } from "@playwright/test";

const MOCK = "http://localhost:4030";

async function newCollection(page: Page, name: string) {
  await page.goto("/knowledge");
  await page.getByLabel("Name der Sammlung").fill(name);
  await page.getByRole("button", { name: "Sammlung anlegen" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  return page.getByTestId("knowledge-source");
}

test("own BookStack documentation is synced into a collection", async ({ page }) => {
  const panel = await newCollection(page, `Doku ${Date.now().toString(36)}`);
  await panel.getByRole("button", { name: "Mit BookStack verbinden" }).click();
  await panel.getByLabel("Adresse Ihrer BookStack-Instanz").fill(`${MOCK}/bookstack`);
  await panel.getByLabel("Token-ID").fill("nexus-token");

  // A wrong secret is refused before anything is saved.
  await panel.getByLabel("Token-Secret").fill("falsch");
  await panel.getByRole("button", { name: "Prüfen und verbinden" }).click();
  await expect(panel.getByText("BookStack hat die Zugangsdaten abgelehnt.")).toBeVisible();

  await panel.getByLabel("Token-Secret").fill("nexus-secret");
  await panel.getByRole("button", { name: "Prüfen und verbinden" }).click();
  await expect(panel.getByRole("status")).toContainText("Der erste Abgleich läuft im Hintergrund");
  await expect(panel.getByRole("heading", { name: /BookStack-Abgleich/ })).toBeVisible();
  await expect(panel).toContainText(/Aktuell/, { timeout: 30_000 });
  await expect(panel).toContainText(/2 neu oder geändert/);

  const page1 = page
    .getByTestId("document")
    .filter({ hasText: "Clients – Lenovo Docking Station" });
  await expect(page1).toContainText("Bereit", { timeout: 30_000 });
  await expect(page1).toContainText("BookStack");
  await expect(page1.getByRole("link", { name: "Original öffnen" })).toHaveAttribute(
    "href",
    `${MOCK}/bookstack/books/clients/page/lenovo-docking-station`,
  );
  // Drafts stay out.
  await expect(page.getByTestId("document").filter({ hasText: "Entwurf" })).toHaveCount(0);
});

test("solved Atera tickets become knowledge an agent answers from", async ({ page }) => {
  const collection = `Tickets ${Date.now().toString(36)}`;
  const panel = await newCollection(page, collection);
  await panel.getByRole("button", { name: "Mit Atera verbinden" }).click();
  await panel.getByLabel("API-Schlüssel").fill("mock-atera-key");
  await panel.getByLabel("Zeitraum").selectOption("12");
  await panel.getByRole("button", { name: "Prüfen und verbinden" }).click();
  await expect(panel.getByRole("status")).toContainText("Der erste Abgleich läuft im Hintergrund");
  await expect(panel).toContainText("Tickets der letzten 12 Monate");
  await expect(panel).toContainText(/2 neu oder geändert/, { timeout: 30_000 });

  const ticket = page
    .getByTestId("document")
    .filter({ hasText: "Ticket 1042: HP-Drucker druckt nur leere Seiten" });
  await expect(ticket).toContainText("Bereit", { timeout: 30_000 });
  await expect(ticket).toContainText("Atera");
  // The open ticket is not knowledge yet.
  await expect(page.getByTestId("document").filter({ hasText: "Neuer Laptop" })).toHaveCount(0);

  // The helpdesk agent finds how the case was solved – without the caller's contact data.
  await page.goto("/agents/new");
  await page
    .getByRole("button", { name: "Vorlage Firmenwissen-Agent (interner Helpdesk) übernehmen" })
    .click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}\?neu=1$/);
  await page.getByRole("checkbox", { name: new RegExp(collection) }).check();
  await page.getByRole("button", { name: "Speichern und veröffentlichen" }).click();
  await expect(page.getByRole("status")).toHaveText("Version 2 ist veröffentlicht.");
  await page.getByRole("link", { name: "Im Chat testen" }).click();
  const input = page.getByLabel("Nachricht an den Assistenten");
  await input.fill("Laut Wissen: Drucker druckt nur leere Seiten");
  await input.press("Enter");
  const answer = page.getByText(/Schutzstreifen am neuen Toner/);
  await expect(answer).toBeVisible({ timeout: 20_000 });
  await expect(answer).not.toContainText("anna.muster");
  await expect(page.getByRole("link", { name: /Ticket 1042/ }).first()).toBeVisible();
});
