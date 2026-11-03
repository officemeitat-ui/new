import { expect, test } from "@playwright/test";

// Runs against the mock Claude API (e2e/mock-anthropic.mjs) through web → queue → worker → SSE.
test("the assistant answers live, uses a tool and keeps the conversation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.getByRole("link", { name: "Chat" }).first().click();
  await expect(page.getByRole("heading", { name: "Womit kann ich helfen?" })).toBeVisible();

  await page.getByRole("button", { name: /Berechne 20 % Umsatzsteuer/ }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  // While the agent works, the live status comes in over Server-Sent Events.
  await expect(page.getByText(/Denkt nach|Verwendet Rechner/).first()).toBeVisible();

  const answer = page.getByText("Die Umsatzsteuer beträgt");
  await expect(answer).toBeVisible({ timeout: 20_000 });
  await expect(answer).toContainText("696,00 €");
  await expect(page.getByText("Rechner", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Claude Opus 5\.5 · 2 Schritte/)).toBeVisible();

  await page.getByLabel("Nachricht an den Assistenten").fill("Danke");
  await page.getByLabel("Nachricht an den Assistenten").press("Enter");
  await expect(page.getByText("Grüß Gott! Sie schrieben: „Danke“")).toBeVisible({
    timeout: 20_000,
  });

  // The conversation is in the history and survives a reload.
  await page.reload();
  await expect(page.getByText("Die Umsatzsteuer beträgt")).toBeVisible();
  await expect(page.getByText("Grüß Gott! Sie schrieben: „Danke“")).toBeVisible();
});
