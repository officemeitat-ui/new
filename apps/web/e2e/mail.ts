import { expect, type Page } from "@playwright/test";

const API = `http://localhost:${process.env.E2E_MAIL_API_PORT ?? 2526}`;

export type SentMail = { to: string[]; subject: string; text: string };

/** Waits until the SMTP sink (e2e/smtp-sink.mjs) has received an e-mail to this address. */
export async function waitForMail(
  to: string,
  match: (mail: SentMail) => boolean = () => true,
): Promise<SentMail> {
  let found: SentMail | undefined;
  await expect
    .poll(
      async () => {
        const response = await fetch(`${API}/messages?to=${encodeURIComponent(to)}`);
        const list = (await response.json()) as SentMail[];
        found = list.findLast(match);
        return Boolean(found);
      },
      { timeout: 15_000, message: `no e-mail to ${to}` },
    )
    .toBe(true);
  return found!;
}

/**
 * The invitation link for a just-created invitation: shown in the UI when no mail server is
 * reachable, otherwise taken from the e-mail.
 */
export async function invitationLink(page: Page, email: string): Promise<string> {
  const shown = await page
    .locator("[role=status] code")
    .textContent({ timeout: 1_000 })
    .catch(() => null);
  if (shown) return shown;
  const mail = await waitForMail(email, (m) => m.subject.startsWith("Einladung"));
  const link = /https?:\/\/\S+\/invite\/\S+/.exec(mail.text)?.[0];
  expect(link, "invitation link in e-mail").toBeTruthy();
  return link!;
}
