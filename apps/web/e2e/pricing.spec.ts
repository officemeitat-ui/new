import { expect, test } from "@playwright/test";

test("the partner sets a USD→EUR rate and customers see costs in euros", async ({ page }) => {
  await page.goto("/partner");
  await expect(page.getByRole("cell", { name: "Claude Opus 5.5" })).toBeVisible();

  await page.getByLabel("Euro je US-Dollar").fill("0,9");
  await page.getByRole("button", { name: "Kurs speichern" }).click();
  await expect(page.getByRole("status").last()).toHaveText("Der Kurs ist gespeichert.");

  await page.goto("/chat");
  // Type only after hydration; before it, React would reset the controlled input.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nachricht an den Assistenten").fill("Hallo");
  await page.getByLabel("Nachricht an den Assistenten").press("Enter");
  await expect(page.getByText("Grüß Gott! Sie schrieben: „Hallo“")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/Claude Opus 5\.5 · 1 Schritt · .*€\s0,0\d+/)).toBeVisible();

  // Back to dollars, so other tests see the default.
  await page.goto("/partner");
  await page.getByLabel("Euro je US-Dollar").fill("");
  await page.getByRole("button", { name: "Kurs speichern" }).click();
  await expect(page.getByRole("status").last()).toHaveText(
    "Kosten werden wieder in US-Dollar angezeigt.",
  );
});
