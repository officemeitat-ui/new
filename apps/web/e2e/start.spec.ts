import { expect, test } from "@playwright/test";

test("the start page shows real figures after the agents worked", async ({ page }) => {
  await page.goto("/chat");
  // Type only after hydration; before it, React would reset the controlled input.
  await page.waitForLoadState("networkidle");
  await page
    .getByLabel("Nachricht an den Assistenten")
    .fill("Berechne 20 % Umsatzsteuer auf 3.480 € netto.");
  await page.getByLabel("Nachricht an den Assistenten").press("Enter");
  await expect(page.getByText("Die Umsatzsteuer beträgt").first()).toBeVisible({ timeout: 20_000 });

  await page.goto("/");
  const figures = page.getByRole("region", { name: "Kennzahlen" });
  await expect(figures.getByText("Agentenläufe heute")).toBeVisible();
  await expect(figures.getByText(/\d+ abgeschlossen/)).toBeVisible();
  await expect(figures.getByText(/≈ €\s\d+ bei €\s45\/Std\./)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agentenläufe der letzten 7 Tage" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Letzte Aktivitäten" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Assistent.*erledigt/ }).first()).toBeVisible();

  // The hourly rate is a company setting.
  await page.getByRole("link", { name: "ändern" }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByLabel("Interner Stundensatz (€)")).toHaveValue("45");
});
