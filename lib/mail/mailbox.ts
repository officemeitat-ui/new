import "server-only";
import type { Email, IncomingEmail, MailAttachment } from "@/lib/emails";
import { graphCredentials } from "@/lib/graph";
import { imapConfigured, imapMailbox } from "@/lib/mail/imap";
import { microsoftMailbox } from "@/lib/mail/microsoft";

/** Was mit einem Antwortentwurf im Postfach passiert ist. */
export type DraftState = "offen" | "gesendet" | "verworfen";

/**
 * Das Postfach, das der E-Mail-Assistent liest. IMAP kann nur lesen (Versand über SMTP);
 * Microsoft 365 legt Entwürfe direkt in Outlook an, vergibt Kategorien und legt E-Mails in Ordnern ab.
 */
export interface Mailbox {
  kind: "imap" | "microsoft";
  label: string;
  fetchRecent(): Promise<IncomingEmail[]>;
  attachments?(externalId: string): Promise<MailAttachment[]>;
  /** Bisheriger Verlauf zu dieser E-Mail (ohne sie selbst) als Text – Kontext für die Antwort. */
  thread?(email: Email): Promise<string | null>;
  /** Legt den Antwortentwurf im Verlauf der E-Mail an (Ordner „Entwürfe“) und liefert seine ID. Versendet nichts. */
  createReplyDraft?(email: Email, text: string): Promise<string>;
  /** Ergänzt Kategorien und verschiebt die E-Mail optional in einen Ordner („Buchhaltung/Eingangsrechnungen“). */
  file?(email: Email, categories: string[], folder: string | null): Promise<void>;
  draftState?(email: Email): Promise<DraftState>;
}

let cached: { key: string; mailbox: Mailbox } | undefined;

/** Microsoft 365, wenn MS_MAILBOX und die App-Zugangsdaten gesetzt sind, sonst IMAP – oder null. */
export function activeMailbox(): Mailbox | null {
  const credentials = graphCredentials();
  const user = process.env.MS_MAILBOX;
  if (credentials && user) {
    const key = `ms:${credentials.tenantId}:${credentials.clientId}:${user}`;
    if (cached?.key !== key) cached = { key, mailbox: microsoftMailbox(credentials, user) };
    return cached.mailbox;
  }
  return imapConfigured() ? imapMailbox() : null;
}
