import "server-only";
import { createHash } from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { IncomingEmail } from "@/lib/emails";

export function imapConfigured(): boolean {
  return Boolean(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD);
}

/** Wandelt eine Roh-E-Mail (RFC 822) in die Felder um, mit denen der Assistent arbeitet. */
export async function parseRawEmail(source: Buffer | string): Promise<IncomingEmail | null> {
  const parsed = await simpleParser(source);
  const from = parsed.from?.value[0];
  if (!from?.address) return null;
  const date = parsed.date ?? new Date();
  // Ohne Message-ID eine stabile ersatzweise bilden, damit die E-Mail nicht bei jedem Abruf erneut verarbeitet wird.
  const fingerprint = [from.address, parsed.subject, parsed.date?.toISOString() ?? "", (parsed.text ?? "").slice(0, 500)].join("|");
  const fallbackId = `<${createHash("sha256").update(fingerprint).digest("hex")}@ersatz>`;
  const autoSubmitted = String(parsed.headers.get("auto-submitted") ?? "no").toLowerCase();
  return {
    messageId: parsed.messageId ?? fallbackId,
    fromAddress: from.address,
    fromName: from.name || null,
    subject: parsed.subject ?? "(ohne Betreff)",
    body: (parsed.text ?? "").trim(),
    receivedAt: date,
    autoSubmitted: autoSubmitted !== "no",
  };
}

/**
 * Holt die E-Mails der letzten Tage aus dem Posteingang. Flags (gelesen/ungelesen) werden nicht verändert;
 * bereits verarbeitete E-Mails werden später über die Message-ID übersprungen.
 */
export async function fetchRecentEmails(lookbackDays = Number(process.env.IMAP_LOOKBACK_DAYS || 2)): Promise<IncomingEmail[]> {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT || 993),
    secure: (process.env.IMAP_PORT || "993") === "993",
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    logger: false,
  });
  await client.connect();
  const emails: IncomingEmail[] = [];
  try {
    const lock = await client.getMailboxLock(process.env.IMAP_MAILBOX || "INBOX");
    try {
      const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
      const uids = await client.search({ since }, { uid: true });
      if (uids && uids.length > 0) {
        for await (const message of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
          if (!message.source) continue;
          const email = await parseRawEmail(message.source);
          if (email) emails.push(email);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return emails;
}
