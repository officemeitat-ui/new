import { expect, test } from "@playwright/test";

test("a tenant applies its own brand colour and can return to the partner colour", async ({
  page,
}) => {
  const primary = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
    );

  await page.goto("/settings/branding");
  await page.getByRole("button", { name: "#15803d" }).click();
  await expect(page.getByText(/Kontrast der Schaltflächen|Für gute Lesbarkeit/)).toBeVisible();
  await page.getByRole("button", { name: "Farbe speichern" }).click();
  await expect(page.getByRole("status")).toHaveText("Die Farbe ist gespeichert.");

  await page.reload();
  expect(await primary()).toBe("#15803d");

  await page.getByRole("button", { name: /Partner-Farbe verwenden/ }).click();
  await expect(page.getByRole("status")).toHaveText("Die Partner-Farbe gilt wieder.");
  await page.reload();
  expect(await primary()).toBe("#2454d6");

  await page.goto("/settings/audit");
  await expect(page.getByText("Branding geändert").first()).toBeVisible();
});
