import { expect, test } from "@playwright/test";

test("ME-IT prepares an agent once, rolls it out to a customer and updates it centrally", async ({
  page,
}) => {
  const name = `Angebote ${Date.now().toString(36)}`;

  await page.goto("/partner");
  await page.getByRole("link", { name: "Agenten-Pakete" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Agenten-Pakete");

  // A package from the library template (newest package first).
  await page.getByLabel("Vorlage").selectOption({ label: "Angebots-Assistent" });
  await page.getByRole("button", { name: "Paket anlegen" }).click();
  await expect(page.getByRole("status").first()).toContainText("ist angelegt");
  const card = page.getByTestId("agent-package").first();
  await card.getByLabel("Name", { exact: true }).fill(name);
  await card.getByRole("button", { name: "Speichern" }).click();
  await expect(card.getByRole("status")).toHaveText("Gespeichert.");
  const pkg = page.getByTestId("agent-package").filter({ hasText: name });
  await expect(pkg).toContainText("Version 1");

  // Roll it out to the demo customer.
  const huber = pkg.getByTestId("rollout-tenant").filter({ hasText: "Huber Haustechnik GmbH" });
  await expect(huber).toContainText("Nicht ausgerollt");
  await pkg.getByLabel("Firma suchen").fill("Huber");
  await huber.getByRole("checkbox").check();
  await pkg.getByRole("button", { name: "An 1 Firma ausrollen" }).click();
  await expect(pkg.getByRole("status").filter({ hasText: "Firma neu" })).toHaveText("1 Firma neu");
  await expect(huber).toContainText("Aktuell (Version 1)");

  // The customer sees it as centrally managed, with the company name filled in.
  await page.goto("/agents");
  const agentCard = page
    .locator("[data-testid^='agent-']")
    .filter({ has: page.getByText(name, { exact: true }) });
  await expect(agentCard).toHaveCount(1);
  await expect(agentCard.getByText("Zentral gepflegt")).toBeVisible();
  await expect(agentCard.getByText("Version 1")).toBeVisible();

  // A central improvement reaches the customer.
  await page.goto("/partner/agents");
  const instructions = pkg.getByLabel("Anweisungen");
  await instructions.fill(
    `${await instructions.inputValue()}\nNennen Sie immer, wie lange das Angebot gültig ist.`,
  );
  await pkg.getByRole("button", { name: "Speichern" }).click();
  await expect(pkg.getByRole("status").filter({ hasText: "Version 2" })).toHaveText(
    "Gespeichert als Version 2. Rollen Sie die Änderung jetzt aus.",
  );
  await expect(huber).toContainText("Version 1 – Update verfügbar");
  // One click selects every company with a pending update.
  await pkg.getByRole("button", { name: "1 mit Update auswählen" }).click();
  await expect(huber.getByRole("checkbox")).toBeChecked();
  await pkg.getByRole("button", { name: "An 1 Firma ausrollen" }).click();
  await expect(pkg.getByRole("status").filter({ hasText: "aktualisiert" })).toHaveText(
    "1 aktualisiert",
  );
  await expect(huber).toContainText("Aktuell (Version 2)");

  await page.goto("/settings/audit");
  await expect(page.getByText("Agent vom IT-Partner aktualisiert").first()).toBeVisible();
});
