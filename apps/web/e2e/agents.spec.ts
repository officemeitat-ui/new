import { expect, test } from "@playwright/test";

test("an agent is created from a template, customised, versioned and used in the chat", async ({
  page,
}) => {
  await page.goto("/agents/new");
  await page.getByRole("button", { name: "Steuerberatung" }).click();
  await expect(page.getByText("Belegprüfer (Eingangsrechnungen)")).toBeVisible();
  await expect(page.getByText("Angebots-Assistent")).toHaveCount(0);

  await page
    .getByRole("button", { name: "Vorlage Firmenwissen-Agent (interner Helpdesk) übernehmen" })
    .click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}\?neu=1$/);
  const agentId = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Firmenwissen-Agent");
  await expect(page.getByRole("note")).toContainText("2 Platzhalter sind noch offen");

  // Fill the placeholders, choose the fast model, publish.
  const instructions = page.getByLabel("Anweisungen");
  const text = (await instructions.inputValue())
    .replace("{{zustaendigkeiten}}", "Büro: Frau Huber, Technik: Herr Gruber")
    .replace("{{hr_kontakt}}", "personal@huber.example");
  await instructions.fill(text);
  await expect(page.getByRole("note")).toHaveCount(0);
  await page.getByText("Schnell", { exact: true }).click();
  await page.getByRole("button", { name: "Speichern und veröffentlichen" }).click();
  await expect(page.getByRole("status")).toHaveText("Version 2 ist veröffentlicht.");

  // Roll back to version 1.
  await page.reload();
  await page.getByRole("button", { name: "Wiederherstellen" }).click();
  await expect(page.getByText("Wiederhergestellt als Version 3.")).toBeVisible();

  // Use it in the chat.
  await page.getByRole("link", { name: "Im Chat testen" }).click();
  await expect(page.getByLabel("Agent:")).toHaveValue(/.+/);
  await expect(page.getByLabel("Agent:").locator("option:checked")).toHaveText(
    "Firmenwissen-Agent (interner Helpdesk)",
  );
  await page.getByLabel("Nachricht an den Assistenten").fill("Wie beantrage ich Urlaub?");
  await page.getByLabel("Nachricht an den Assistenten").press("Enter");
  await expect(page.getByText("Grüß Gott! Sie schrieben: „Wie beantrage ich Urlaub?“")).toBeVisible(
    { timeout: 20_000 },
  );
  await page.reload();
  await expect(page.getByText("Gespräch mit Firmenwissen-Agent (interner Helpdesk)")).toBeVisible();

  await page.goto("/agents");
  await expect(page.getByTestId(`agent-${agentId}`).getByText("1 Lauf in 30 Tagen")).toBeVisible();
  await page.goto("/settings/audit");
  await expect(page.getByText("Agent veröffentlicht").first()).toBeVisible();
});
