import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const pdf = {
  name: "preisliste.pdf",
  mimeType: "application/pdf",
  buffer: readFileSync(
    new URL("../../../packages/knowledge/test/fixtures/preisliste.pdf", import.meta.url),
  ),
};

test("documents are uploaded, indexed and cited by an agent in the chat", async ({ page }) => {
  const collection = `Handbuch ${Date.now().toString(36)}`;

  await page.goto("/knowledge");
  await page.getByLabel("Name der Sammlung").fill(collection);
  await page.getByRole("button", { name: "Sammlung anlegen" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(collection);

  // A PDF and a Markdown file at once; the list shows the progress until both are ready.
  await page.getByLabel("Dateien auswählen").setInputFiles([
    pdf,
    {
      name: "Urlaubsregelung.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Urlaub\n\nUrlaub beantragen Sie im Personalportal mindestens 14 Tage im Voraus.",
      ),
    },
  ]);
  await page.getByRole("button", { name: "Hochladen" }).click();
  await expect(page.getByRole("status")).toHaveText("2 Dateien werden verarbeitet.");
  const priceList = page.getByTestId("document").filter({ hasText: "preisliste" });
  await expect(priceList).toContainText("Bereit", { timeout: 20_000 });
  await expect(priceList).toContainText("2 Seiten");
  await expect(page.getByTestId("document").filter({ hasText: "Urlaubsregelung" })).toContainText(
    "Bereit",
    { timeout: 20_000 },
  );

  // A file that only pretends to be a PDF is refused.
  await page.getByLabel("Dateien auswählen").setInputFiles({
    name: "rechnung.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("kein echtes PDF"),
  });
  await page.getByRole("button", { name: "Hochladen" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "rechnung.pdf" })).toContainText(
    "„rechnung.pdf“ wird nicht unterstützt",
  );

  // The test search shows what agents find, with page numbers.
  await page.getByLabel("Suchbegriffe").fill("Skonto");
  await page.getByRole("button", { name: "Suchen" }).click();
  const hits = page.getByRole("list", { name: "Treffer" });
  await expect(hits).toContainText("preisliste · Seite 2");
  await expect(hits.locator("mark").first()).toHaveText("Skonto");

  // An agent restricted to this collection answers with the source.
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
  await input.fill("Laut Wissen: Urlaub beantragen");
  await input.press("Enter");
  await expect(page.getByText("Urlaub beantragen Sie im Personalportal")).toBeVisible({
    timeout: 20_000,
  });
  const source = page.getByRole("link", { name: "Urlaubsregelung" });
  await expect(source).toBeVisible();
  await source.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Urlaubsregelung");
  await expect(page.getByText("mindestens 14 Tage im Voraus")).toBeVisible();

  await page.goto("/settings/audit");
  await expect(page.getByText("Dokument hochgeladen").first()).toBeVisible();
});
