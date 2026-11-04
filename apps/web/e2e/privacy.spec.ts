import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@me-it.local";

test("every page is served with a strict CSP that our own code passes", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });

  const response = await page.goto("/");
  const csp = response!.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  // The theme script ran under the nonce: next-themes set a theme class.
  await expect(page.locator("html")).toHaveClass(/light|dark/);

  for (const path of [
    "/chat",
    "/agents",
    "/knowledge",
    "/approvals",
    "/devices",
    "/reports",
    "/partner/agents",
    "/settings/privacy",
    "/account",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
  }
  expect(violations).toEqual([]);
});

test("retention, data export, processing register and audit export work for admins", async ({
  page,
}) => {
  await page.goto("/settings/privacy");
  await page.getByLabel("Gespräche mit Agenten").selectOption("90");
  await page.getByRole("button", { name: "Fristen speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Aufbewahrungsfristen sind gespeichert");
  await page.reload();
  await expect(page.getByLabel("Gespräche mit Agenten")).toHaveValue("90");

  // Art. 15/20: the own data as a file.
  await page.goto("/account");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Meine Daten herunterladen" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^datenauskunft-.+\.json$/);
  const data = JSON.parse(await readFile((await download.path())!, "utf8")) as {
    person: { email: string };
    gespraeche: unknown[];
  };
  expect(data.person.email).toBe(ADMIN_EMAIL);
  expect(Array.isArray(data.gespraeche)).toBe(true);

  // Art. 30: the register lists the platform's activities and the subprocessors.
  await page.goto("/settings/privacy/register");
  await expect(
    page.getByRole("heading", { name: "Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO)" }),
  ).toBeVisible();
  await expect(page.getByText("1. Benutzerkonten und Zugriffsverwaltung")).toBeVisible();
  await expect(page.getByText("90 Tage").first()).toBeVisible();

  // Audit log as CSV, including the new entries.
  await page.goto("/settings/audit");
  await expect(page.getByText("Datenauskunft erstellt").first()).toBeVisible();
  const [csv] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Als CSV exportieren" }).click(),
  ]);
  const content = await readFile((await csv.path())!, "utf8");
  expect(content.split("\r\n")[0]).toContain("seq,zeit,akteur_typ,akteur_id");
  expect(content).toContain("privacy.retention_changed");

  // Back to the default, so other tests see an unchanged tenant.
  await page.goto("/settings/privacy");
  await page.getByLabel("Gespräche mit Agenten").selectOption("none");
  await page.getByRole("button", { name: "Fristen speichern" }).click();
  await expect(page.getByRole("status")).toBeVisible();
});

test("every agent has a profile (EU AI Act) generated from its configuration", async ({ page }) => {
  await page.goto("/agents/new");
  await page.getByRole("button", { name: "Vorlage Posteingangs-Manager übernehmen" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}\?neu=1$/);
  await page.getByRole("link", { name: "Steckbrief" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Posteingangs-Manager");
  await expect(page.getByText("Agenten-Steckbrief (EU-KI-Verordnung)")).toBeVisible();
  const tools = page.locator("section").filter({ hasText: "Werkzeuge und Freigaberegeln" });
  await expect(tools.getByRole("listitem").filter({ hasText: "E-Mail senden" })).toContainText(
    "Freigabe nötig",
  );
  await expect(page.getByText(/Vor diesen Aktionen entscheidet eine Person/)).toContainText(
    "E-Mail senden",
  );
  await expect(page.getByRole("button", { name: "Drucken / als PDF" })).toBeVisible();
});
