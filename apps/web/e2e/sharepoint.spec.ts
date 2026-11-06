import { expect, test, type Page } from "@playwright/test";

/** The devices test may have connected Microsoft 365 already; otherwise connect here. */
async function ensureMicrosoft(page: Page) {
  await page.goto("/integrations");
  const card = page.getByTestId("integration-microsoft365");
  // The page streams in after a loading state: look only once the card is there.
  await expect(card.getByRole("heading")).toBeVisible();
  if (await card.getByText("Nicht verbunden").isVisible()) {
    await page.getByRole("link", { name: "Mit Microsoft 365 verbinden" }).click();
    await expect(page.getByRole("status")).toContainText("Microsoft 365 ist verbunden");
  }
}

test("a SharePoint library is synced into a collection in the background", async ({ page }) => {
  await ensureMicrosoft(page);
  const collection = `Objektmappe ${Date.now().toString(36)}`;
  await page.goto("/knowledge");
  await page.getByLabel("Name der Sammlung").fill(collection);
  await page.getByRole("button", { name: "Sammlung anlegen" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(collection);

  const panel = page.getByTestId("knowledge-source");
  await panel.getByRole("button", { name: "Mit SharePoint verbinden" }).click();
  await panel.getByLabel("SharePoint-Website suchen").fill("Team");
  await panel.getByRole("button", { name: "Suchen" }).click();
  await panel
    .getByRole("list", { name: "Gefundene Websites" })
    .getByRole("button", { name: "Auswählen" })
    .click();
  await panel
    .getByRole("list", { name: "Dokumentbibliotheken" })
    .getByRole("button", { name: "Verbinden" })
    .click();
  await expect(panel.getByRole("status")).toContainText("Der erste Abgleich läuft im Hintergrund");

  // The page never waits for the sync; it shows progress and then the result.
  await expect(panel).toContainText("Aktuell", { timeout: 30_000 });
  await expect(panel).toContainText(/2 neu oder geändert, 2 übersprungen/);
  const plan = page.getByTestId("document").filter({ hasText: "Reinigungsplan Büro" });
  await expect(plan).toContainText("Bereit", { timeout: 30_000 });
  await expect(plan).toContainText("SharePoint");
  await expect(plan.getByRole("link", { name: "Original öffnen" })).toHaveAttribute(
    "href",
    /contoso\.sharepoint\.com/,
  );

  // A second sync only asks for changes – nothing new.
  await panel.getByRole("button", { name: "Jetzt abgleichen" }).click();
  await expect(panel.getByRole("status")).toHaveText("Abgleich gestartet.");
  await expect(panel).toContainText(/0 neu oder geändert/, { timeout: 30_000 });

  await page.goto("/settings/audit");
  await expect(page.getByText("Wissensquelle verbunden").first()).toBeVisible();
});
