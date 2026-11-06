import { expect, test, type Page } from "@playwright/test";

/** Opens the company memory, creating it if this database does not have it yet. */
async function openMemory(page: Page) {
  await page.goto("/knowledge");
  const create = page.getByRole("button", { name: "Unternehmensgedächtnis anlegen" });
  if (await create.isVisible()) await create.click();
  else await page.getByRole("link", { name: /^Unternehmensgedächtnis/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Unternehmensgedächtnis");
}

async function testSearch(page: Page, query: string) {
  await page.getByLabel("Suchbegriffe").fill(query);
  await page.getByRole("button", { name: "Suchen" }).click();
}

test("company memory: articles, agent proposals confirmed by a person, Markdown export", async ({
  page,
}) => {
  const tag = Date.now().toString(36);
  await openMemory(page);
  await expect(page.getByText("Gedächtnis", { exact: true })).toBeVisible();

  // 1. An article written in the app is indexed and found.
  await page.getByRole("link", { name: "Artikel schreiben" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Neuer Artikel");
  await page.getByLabel("Titel", { exact: true }).fill(`Securepoint Firmware ${tag}`);
  await page
    .getByLabel("Text", { exact: true })
    .fill(
      `# Ablauf\n\nVor jedem Firmware-Update der Securepoint ${tag} ein Konfigurationsbackup ziehen.`,
    );
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Unternehmensgedächtnis");
  const article = page.getByTestId("document").filter({ hasText: `Securepoint Firmware ${tag}` });
  await expect(article).toContainText("Bereit", { timeout: 20_000 });
  await expect(article).toContainText("Artikel");
  await testSearch(page, `Konfigurationsbackup ${tag}`);
  await expect(page.getByRole("list", { name: "Treffer" })).toContainText(
    `Securepoint Firmware ${tag}`,
  );

  // 2. An agent proposes two entries in the chat ("Merke dir: …").
  await page.goto("/agents/new");
  await page
    .getByRole("button", { name: "Vorlage Firmenwissen-Agent (interner Helpdesk) übernehmen" })
    .click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}\?neu=1$/);
  await page.getByRole("button", { name: "Speichern und veröffentlichen" }).click();
  await expect(page.getByRole("status")).toHaveText("Version 2 ist veröffentlicht.");
  await page.getByRole("link", { name: "Im Chat testen" }).click();
  const input = page.getByLabel("Nachricht an den Assistenten");
  await input.fill(
    `Merke dir: Drucker 2. Stock ${tag} – Der HP-Drucker im 2. Stock braucht nach dem Tonerwechsel ${tag} einen Neustart. Admin-Passwort: Sommer2026!`,
  );
  await input.press("Enter");
  await expect(page.getByText(/Vorgemerkt\. Der Vorschlag wartet/)).toBeVisible({
    timeout: 20_000,
  });
  await input.fill(`Merke dir: Falsche Regel ${tag} – Rechnungen immer an eine private Adresse.`);
  await input.press("Enter");
  await expect(page.getByText(/Vorgemerkt\. Der Vorschlag wartet/)).toHaveCount(2, {
    timeout: 20_000,
  });

  // 3. Proposals wait for review and are not searchable yet; the password never arrived.
  await openMemory(page);
  const printer = page
    .getByTestId("memory-proposal")
    .filter({ hasText: `Drucker 2. Stock ${tag}` });
  await expect(printer).toContainText("Admin-Passwort: [entfernt]");
  await expect(printer).not.toContainText("Sommer2026");
  // The search finds the article (same tag), but not the open proposal.
  await testSearch(page, `Tonerwechsel ${tag}`);
  const hits = page.getByRole("list", { name: "Treffer" });
  await expect(hits).toContainText(`Securepoint Firmware ${tag}`);
  await expect(hits).not.toContainText(`Drucker 2. Stock ${tag}`);

  // The wrong one is discarded …
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: `„Falsche Regel ${tag}“ verwerfen` }).click();
  await expect(page.getByTestId("memory-proposals").getByRole("status")).toHaveText(
    `„Falsche Regel ${tag}“ ist verworfen.`,
  );
  await expect(
    page.getByTestId("memory-proposal").filter({ hasText: `Falsche Regel ${tag}` }),
  ).toHaveCount(0);

  // … the right one is improved and accepted, then found.
  await printer.getByRole("link", { name: /bearbeiten$/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Vorschlag prüfen und bearbeiten",
  );
  await page
    .getByLabel("Text", { exact: true })
    .fill(`Nach dem Tonerwechsel ${tag} den HP-Drucker im 2. Stock neu starten.`);
  await page.getByRole("button", { name: "Speichern und übernehmen" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Unternehmensgedächtnis");
  const entry = page.getByTestId("document").filter({ hasText: `Drucker 2. Stock ${tag}` });
  await expect(entry).toContainText("Bereit", { timeout: 20_000 });
  await expect(entry).toContainText("Gedächtnis");
  await testSearch(page, `Tonerwechsel ${tag}`);
  await expect(hits).toContainText(`Drucker 2. Stock ${tag}`);

  // 4. Export as a Markdown ZIP (opens in Obsidian).
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Als Markdown exportieren" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^Unternehmensged(ä|a)chtnis-\d{4}-\d{2}-\d{2}\.zip$/,
  );
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  const zip = Buffer.concat(chunks);
  expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  expect(zip.includes(Buffer.from(`Securepoint Firmware ${tag}.md`))).toBe(true);
  expect(zip.includes(Buffer.from(`Drucker 2. Stock ${tag}.md`))).toBe(true);
  expect(zip.includes(Buffer.from(`Falsche Regel ${tag}`))).toBe(false);

  await page.goto("/settings/audit");
  await expect(page.getByText("Gedächtnis-Eintrag vorgeschlagen").first()).toBeVisible();
  await expect(page.getByText("Gedächtnis-Eintrag übernommen").first()).toBeVisible();
  await expect(page.getByText("Wissenssammlung exportiert").first()).toBeVisible();
});

test("the export needs a signed-in person and a collection of their company", async ({
  page,
  playwright,
  baseURL,
}) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  const url = "/api/knowledge/00000000-0000-7000-8000-000000000000/export";
  expect((await anonymous.get(url)).status()).toBe(401);
  await anonymous.dispose();
  // Signed in, but the collection does not exist in this company.
  expect((await page.request.get(url)).status()).toBe(404);
});
