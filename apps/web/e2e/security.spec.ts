import { expect, test } from "@playwright/test";

test("an invited address cannot be registered without the invitation link", async ({
  page,
  request,
}) => {
  const email = `vorab-${Date.now().toString(36)}@e2e.test`;
  await page.goto("/settings/members");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByRole("button", { name: "Einladen" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  // Someone who only knows the address tries to register it first (security review, finding 2).
  const withoutLink = await request.post("/api/auth/sign-up/email", {
    data: { email, password: "Angreifer-Passwort-1", name: "Fremd" },
    headers: { origin: "http://localhost:3000" },
  });
  expect(withoutLink.status()).toBe(403);
  const withWrongToken = await request.post("/api/auth/sign-up/email", {
    data: { email, password: "Angreifer-Passwort-1", name: "Fremd" },
    headers: { origin: "http://localhost:3000", "x-invite-token": "x".repeat(40) },
  });
  expect(withWrongToken.status()).toBe(403);
});

test("the login never redirects to another site", async ({ page }) => {
  // Browsers drop tabs while parsing URLs: "/\t/evil.example" would become "//evil.example".
  await page.goto("/login?next=%2F%09%2Fevil.example");
  await expect(page).toHaveURL(/^http:\/\/localhost:3000\//);
  await page.goto("/login?next=%2F%5Cevil.example");
  await expect(page).toHaveURL(/^http:\/\/localhost:3000\//);
});
