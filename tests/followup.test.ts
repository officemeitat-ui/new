import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Claude wird durch einen festen Entwurf ersetzt; geprüft wird die Auswahl der Verläufe und der Ablauf.
const drafts = vi.hoisted(() => ({ calls: [] as { subject: string; daysSince: number }[] }));
vi.mock("@/lib/mail/analyze", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mail/analyze")>()),
  draftFollowUp: async (thread: { subject: string; daysSince: number }) => {
    drafts.calls.push({ subject: thread.subject, daysSince: thread.daysSince });
    return { subject: `Re: ${thread.subject}`, body: "Grüß Gott, passt Ihnen noch ein Termin? Falls erledigt, einfach ignorieren." };
  },
}));

const sent: string[] = [];
const smtp = new SMTPServer({
  disabledCommands: ["STARTTLS", "AUTH"],
  onData(stream, _session, callback) {
    let raw = "";
    stream.on("data", (chunk) => (raw += chunk));
    stream.on("end", () => {
      sent.push(raw);
      callback();
    });
  },
});

let followup: typeof import("@/lib/followup");
let emails: typeof import("@/lib/emails");
let leads: typeof import("@/lib/leads");
let contacts: typeof import("@/lib/contacts");
let mail: typeof import("@/lib/mail/process");
let db: typeof import("@/lib/db");

beforeAll(async () => {
  await new Promise<void>((resolve) => smtp.listen(2529, "127.0.0.1", resolve));
  Object.assign(process.env, {
    DATABASE_URL: `file:${path.join(mkdtempSync(path.join(tmpdir(), "nachfass-")), "test.db")}`,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "2529",
    SMTP_FROM: "Autowerkstatt Muster <office@autowerkstatt-muster.example>",
  });
  followup = await import("@/lib/followup");
  emails = await import("@/lib/emails");
  leads = await import("@/lib/leads");
  contacts = await import("@/lib/contacts");
  mail = await import("@/lib/mail/process");
  db = await import("@/lib/db");
});
afterAll(() => new Promise<void>((resolve) => smtp.close(() => resolve())));

const now = new Date("2026-11-20T09:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

/** Anfrage eines Kunden, die wir vor `repliedDaysAgo` Tagen beantwortet haben. */
async function answeredThread(name: string, options: { repliedDaysAgo: number; category?: string }) {
  const address = `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`;
  const lead = await contacts.ensureContact("email", { name, email: address });
  const inbound = await emails.insertEmail({
    messageId: `<${name.replace(/\s+/g, "")}@example.com>`,
    fromAddress: address,
    fromName: name,
    subject: `Anfrage ${name}`,
    body: "Wann hätten Sie Zeit für ein Pickerl?",
    receivedAt: daysAgo(options.repliedDaysAgo + 1),
  });
  await emails.updateEmail(inbound!.id, {
    leadId: lead.id,
    category: (options.category ?? "terminanfrage") as never,
    status: "gesendet",
    replySubject: `Re: Anfrage ${name}`,
    replyBody: "Frei wären Montag 7:30 oder Dienstag 9:00.",
    sentAt: daysAgo(options.repliedDaysAgo).toISOString(),
  });
  return { lead, inbound: (await emails.getEmail(inbound!.id))! };
}

describe("Nachfass-Assistent", () => {
  it("fasst nur bei offenen, beantworteten Anfragen ohne Reaktion nach", async () => {
    const open = await answeredThread("Anna Offen", { repliedDaysAgo: 4 });
    await answeredThread("Bernd Frisch", { repliedDaysAgo: 1 }); // zu früh
    await answeredThread("Clara Alt", { repliedDaysAgo: 30 }); // zu alt
    await answeredThread("Dora Frage", { repliedDaysAgo: 5, category: "allgemeine_frage" }); // keine Terminanfrage

    const replied = await answeredThread("Emil Antwortet", { repliedDaysAgo: 5 }); // Kunde hat danach geschrieben
    await emails.insertEmail({
      messageId: "<emil-2@example.com>",
      fromAddress: replied.inbound.fromAddress,
      fromName: null,
      subject: "Re",
      body: "Passt Dienstag",
      receivedAt: daysAgo(4),
    });
    const client = await db.db();
    await client.execute({ sql: "UPDATE emails SET lead_id = ? WHERE message_id = '<emil-2@example.com>'", args: [replied.lead.id] });

    const booked = await answeredThread("Franz Gebucht", { repliedDaysAgo: 5 }); // hat inzwischen einen Termin
    await client.execute({
      sql: "INSERT INTO appointments (id, service_id, start_at, end_at, status, name, lead_id, source, created_at) VALUES ('t1', 'pickerl', ?, ?, 'gebucht', 'Franz', ?, 'telefon', ?)",
      args: [daysAgo(-2).toISOString(), daysAgo(-2).toISOString(), booked.lead.id, daysAgo(3).toISOString()],
    });

    const called = await answeredThread("Gerda Angerufen", { repliedDaysAgo: 5 }); // hat inzwischen angerufen
    await client.execute({
      sql: "INSERT INTO calls (id, lead_id, created_at) VALUES ('call-g', ?, ?)",
      args: [called.lead.id, daysAgo(2).toISOString()],
    });

    const closed = await answeredThread("Hans Erledigt", { repliedDaysAgo: 5 }); // in der Pipeline abgeschlossen
    await leads.setStage(closed.lead.id, "erledigt", "Stufe: erledigt");

    const candidates = await followup.followUpCandidates(now);
    expect(candidates.map((c) => c.fromName)).toEqual(["Anna Offen"]);

    expect(await followup.createFollowUps(now)).toEqual({ created: 1, failed: 0 });
    expect(drafts.calls).toEqual([{ subject: "Anfrage Anna Offen", daysSince: 4 }]);

    const [draft] = (await emails.listEmails(["entwurf"])).filter((e) => e.kind === "nachfass");
    expect(draft).toMatchObject({
      kind: "nachfass",
      leadId: open.lead.id,
      fromAddress: "anna.offen@example.com",
      threadMessageId: "<AnnaOffen@example.com>",
      replySubject: "Re: Anfrage Anna Offen",
      summary: "Keine Rückmeldung seit 4 Tagen auf unsere Antwort zu „Anfrage Anna Offen“",
    });

    // Kein zweiter Entwurf für denselben Verlauf
    expect(await followup.createFollowUps(now)).toEqual({ created: 0, failed: 0 });
  });

  it("versendet freigegebene Nachfass-E-Mails im ursprünglichen Verlauf", async () => {
    const [draft] = (await emails.listEmails(["entwurf"])).filter((e) => e.kind === "nachfass");
    await mail.sendReply(draft);
    expect(sent.at(-1)).toContain("In-Reply-To: <AnnaOffen@example.com>");
    expect(sent.at(-1)).toContain("To: anna.offen@example.com");
    const activities = await leads.listActivities(draft.leadId!);
    expect(activities.map((a) => a.text)).toContain("Nachfass-E-Mail gesendet: „Re: Anfrage Anna Offen“");
    // Annas Verlauf kommt auch später kein zweites Mal dran
    const later = await followup.followUpCandidates(new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000));
    expect(later.map((c) => c.fromName)).not.toContain("Anna Offen");
  });
});
