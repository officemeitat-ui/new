import { expect, test, type Page } from "@playwright/test";
import { waitForMail } from "./mail";

/** Creates an agent that may send e-mails only after approval and opens its chat. */
async function chatWithMailAgent(page: Page) {
  await page.goto("/agents/new");
  await page.getByRole("button", { name: "Vorlage Posteingangs-Manager übernehmen" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}\?neu=1$/);
  await expect(page.getByLabel("E-Mail senden")).toHaveValue("approve");
  await page.getByRole("link", { name: "Im Chat testen" }).click();
  await expect(page.getByLabel("Agent:").locator("option:checked")).toHaveText(
    "Posteingangs-Manager",
  );
}

async function ask(page: Page, text: string) {
  const input = page.getByLabel("Nachricht an den Assistenten");
  await input.fill(text);
  await input.press("Enter");
}

test("an e-mail drafted by an agent goes out only after approval – edited by a person", async ({
  page,
}) => {
  const to = `kunde-${Date.now().toString(36)}@example.at`;
  await chatWithMailAgent(page);
  await ask(page, `Schreib eine E-Mail an ${to} und bestätige den Termin.`);

  // The run pauses; nothing has been sent and the chat waits.
  await expect(page.getByText("Der Agent wartet auf eine Freigabe.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByLabel("Nachricht an den Assistenten")).toHaveAttribute(
    "placeholder",
    "Der Agent wartet auf eine Freigabe …",
  );
  await expect(
    page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", {
      name: /Freigaben/,
    }),
  ).toContainText(/[1-9]/);

  await page.getByRole("link", { name: "Zur Freigabe" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Freigaben");
  const card = page.getByTestId("approval").filter({ hasText: to });
  await expect(card).toContainText("Posteingangs-Manager möchte: E-Mail senden");
  await expect(card).toContainText("Terminbestätigung");

  await card.getByRole("button", { name: "Bearbeiten" }).click();
  // In edit mode the address sits in an input, so find the card by its edit button.
  const editing = page
    .getByTestId("approval")
    .filter({ has: page.getByRole("button", { name: "Geändert freigeben" }) });
  await editing.getByLabel("Betreff").fill("Ihr Termin am Dienstag");
  await editing.getByRole("button", { name: "Geändert freigeben" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Freigegeben" })).toHaveText(
    "Freigegeben – der Agent arbeitet weiter.",
  );

  // The edited e-mail arrives, labelled as AI-assisted (EU AI Act, Art. 50).
  const mail = await waitForMail(to);
  expect(mail.subject).toBe("Ihr Termin am Dienstag");
  expect(mail.text).toContain("wir bestätigen Ihren Termin");
  expect(mail.text).toContain("mit KI-Unterstützung erstellt");

  // The agent continues and reports back in the conversation.
  await page.goBack();
  await expect(page.getByText(`Die E-Mail an ${to} ist versendet.`)).toBeVisible({
    timeout: 20_000,
  });

  await page.goto("/approvals");
  await expect(page.getByText("Geändert freigegeben").first()).toBeVisible();
  await page.goto("/settings/audit");
  await expect(page.getByText("Aktion freigegeben").first()).toBeVisible();
});

test("a rejected e-mail is not sent and the agent learns the reason", async ({ page }) => {
  const to = `abgelehnt-${Date.now().toString(36)}@example.at`;
  await chatWithMailAgent(page);
  await ask(page, `Schreib eine E-Mail an ${to} und bestätige den Termin.`);
  await expect(page.getByText("Der Agent wartet auf eine Freigabe.")).toBeVisible({
    timeout: 20_000,
  });
  const conversation = page.url();

  await page.goto("/approvals");
  const card = page.getByTestId("approval").filter({ hasText: to });
  await card.getByRole("button", { name: "Ablehnen" }).click();
  await card.getByLabel("Begründung (optional)").fill("Termin ist noch nicht fix");
  await card.getByRole("button", { name: "Ablehnen bestätigen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Abgelehnt" })).toHaveText(
    "Abgelehnt – der Agent wird informiert.",
  );

  await page.goto(conversation);
  await expect(page.getByText(/Verstanden, ich sende die E-Mail nicht\./)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/Termin ist noch nicht fix/)).toBeVisible();

  const response = await fetch(
    `http://localhost:${process.env.E2E_MAIL_API_PORT ?? 2526}/messages?to=${to}`,
  );
  expect(await response.json()).toEqual([]);
});
