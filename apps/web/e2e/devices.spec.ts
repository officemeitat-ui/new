import { expect, test, type Page } from "@playwright/test";

const MOCK = "http://localhost:4020";
const GRUBER = "a1f0c2d4-0000-4000-8000-000000000002";
const HUBER = "a1f0c2d4-0000-4000-8000-000000000001";

async function graphCalls(): Promise<{ method: string; path: string }[]> {
  return (await (await fetch(`${MOCK}/__calls`)).json()) as { method: string; path: string }[];
}

/** Earlier runs may have left the demo tenant connected. */
async function disconnectIfConnected(page: Page) {
  await page.goto("/integrations");
  // The page streams in after a loading state: look only once the card is there.
  const card = page.getByTestId("integration-microsoft365");
  await expect(card.getByRole("heading")).toBeVisible();
  const disconnect = card.getByRole("button", { name: "Trennen" });
  if (await disconnect.isVisible()) {
    page.once("dialog", (dialog) => void dialog.accept());
    await disconnect.click();
    await expect(page.getByTestId("integration-microsoft365")).toContainText("Nicht verbunden");
  }
}

async function ask(page: Page, text: string) {
  const input = page.getByLabel("Nachricht an den Assistenten");
  await input.fill(text);
  await input.press("Enter");
}

test("Microsoft Intune is connected by admin consent and devices are managed – by people and agents", async ({
  page,
}) => {
  await disconnectIfConnected(page);
  await page.goto("/devices");
  await expect(page.getByText("Noch keine Geräteverwaltung verbunden")).toBeVisible();

  // Admin consent round trip (the mock "administrator" agrees at once).
  await page.goto("/integrations");
  await page.getByRole("link", { name: "Mit Microsoft 365 verbinden" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Microsoft 365 ist verbunden: Contoso Test GmbH.",
  );

  // The MDM overview.
  await page.getByRole("link", { name: "Geräte ansehen" }).click();
  const overview = page.getByRole("region", { name: "Überblick" });
  await expect(overview).toContainText("Geräte gesamt4");
  await expect(overview).toContainText("Nicht konform1");
  await expect(overview).toContainText("Nicht verschlüsselt1");
  const gruber = page.getByTestId("device").filter({ hasText: "LAPTOP-GRUBER-07" });
  await expect(gruber).toContainText("Nicht konform");
  await expect(gruber).toContainText("Nicht verschlüsselt");

  await page.getByLabel("Nur mit Handlungsbedarf").check();
  await page.getByRole("button", { name: "Filtern" }).click();
  await expect(page.getByTestId("device")).toHaveCount(1);
  await page.getByLabel("Nur mit Handlungsbedarf").uncheck();
  await page.getByRole("button", { name: "Filtern" }).click();

  const huber = page.getByTestId("device").filter({ hasText: "LAPTOP-HUBER-01" });
  await huber.getByRole("button", { name: "Sync" }).click();
  await expect(huber.getByRole("status")).toHaveText(
    "Synchronisierung angefordert: LAPTOP-HUBER-01.",
  );
  expect(await graphCalls()).toContainEqual({
    method: "POST",
    path: `/deviceManagement/managedDevices/${HUBER}/syncDevice`,
  });

  // The IT support agent finds problems on its own …
  await page.goto("/agents/new");
  await page
    .getByRole("button", { name: "Vorlage IT-Support-Agent (1st Level) übernehmen" })
    .click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}\?neu=1$/);
  await expect(page.getByLabel("Gerät sperren (Intune)")).toHaveValue("approve");
  await expect(page.getByText("Microsoft 365 verbinden")).toHaveCount(0);
  await page.getByRole("link", { name: "Im Chat testen" }).click();
  await ask(page, "Welche Geräte brauchen Aufmerksamkeit?");
  await expect(page.getByText(/Handlungsbedarf bei: LAPTOP-GRUBER-07/)).toBeVisible({
    timeout: 20_000,
  });

  // The turn is finished once its usage line shows; only then does the chat accept more.
  await expect(page.getByText(/2 Schritte/)).toBeVisible();

  // … but locks a device only after a person approved it.
  await ask(page, "Sperre LAPTOP-GRUBER-07");
  await expect(page.getByText("Der Agent wartet auf eine Freigabe.")).toBeVisible({
    timeout: 20_000,
  });
  expect((await graphCalls()).some((c) => c.path.endsWith(`${GRUBER}/remoteLock`))).toBe(false);

  await page.getByRole("link", { name: "Zur Freigabe" }).click();
  const card = page.getByTestId("approval").filter({ hasText: "LAPTOP-GRUBER-07" }).first();
  await expect(card).toContainText("möchte: Gerät sperren (Intune)");
  await expect(card).toContainText("Gerät");
  await card.getByRole("button", { name: "Freigeben" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Freigegeben" }).first()).toBeVisible();

  await page.goBack();
  await expect(page.getByText("Das Gerät LAPTOP-GRUBER-07 ist gesperrt.")).toBeVisible({
    timeout: 20_000,
  });
  expect(await graphCalls()).toContainEqual({
    method: "POST",
    path: `/deviceManagement/managedDevices/${GRUBER}/remoteLock`,
  });

  await page.goto("/settings/audit");
  await expect(page.getByText("Gerät gesperrt").first()).toBeVisible();
  await expect(page.getByText("Integration verbunden").first()).toBeVisible();
});
