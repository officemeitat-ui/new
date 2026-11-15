import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailAnalysis } from "@/lib/mail/analyze";

process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "email-")), "test.db")}`;
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "2526";
process.env.SMTP_FROM = "Autowerkstatt Muster <office@autowerkstatt-muster.example>";

// Claude wird in diesen Tests durch feste Auswertungen ersetzt.
const analysis = vi.hoisted(() => ({ next: null as EmailAnalysis | Error | null, calls: 0 }));
vi.mock("@/lib/mail/analyze", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mail/analyze")>()),
  analyzeEmail: async () => {
    analysis.calls++;
    if (analysis.next instanceof Error) throw analysis.next;
    return analysis.next!;
  },
}));

const terminanfrage: EmailAnalysis = {
  category: "terminanfrage",
  summary: "Möchte ein Pickerl für seinen Golf",
  senderName: "Peter Berger",
  phone: "0676 555 12 34",
  urgent: false,
  needsReply: true,
  replySubject: "Re: Pickerl",
  replyBody: "Sehr geehrter Herr Berger,\n\nwir hätten Montag 10:00 oder Dienstag 9:00 frei.\n\nMit freundlichen Grüßen",
};

const sent: { to: string; raw: string }[] = [];
const smtp = new SMTPServer({
  disabledCommands: ["STARTTLS", "AUTH"],
  onData(stream, session, callback) {
    let raw = "";
    stream.on("data", (chunk) => (raw += chunk));
    stream.on("end", () => {
      sent.push({ to: session.envelope.rcptTo.map((r) => r.address).join(","), raw });
      callback();
    });
  },
});

let mail: typeof import("@/lib/mail/process");
let imap: typeof import("@/lib/mail/imap");
let emails: typeof import("@/lib/emails");
let leads: typeof import("@/lib/leads");
let config: typeof import("@/config/business");

beforeAll(async () => {
  await new Promise<void>((resolve) => smtp.listen(2526, "127.0.0.1", resolve));
  mail = await import("@/lib/mail/process");
  imap = await import("@/lib/mail/imap");
  emails = await import("@/lib/emails");
  leads = await import("@/lib/leads");
  config = await import("@/config/business");
});
afterAll(() => new Promise<void>((resolve) => smtp.close(() => resolve())));
beforeEach(() => {
  analysis.next = terminanfrage;
  analysis.calls = 0;
  config.business.emailAssistant.mode = "entwurf";
});

let counter = 0;
const incoming = (overrides: Partial<import("@/lib/emails").IncomingEmail> = {}) => ({
  messageId: `<test-${++counter}@example.com>`,
  fromAddress: "peter.berger@example.com",
  fromName: "Peter Berger",
  subject: "Pickerl",
  body: "Hallo, wann hätten Sie Zeit für ein Pickerl? LG Peter Berger, 0676 5551234",
  receivedAt: new Date("2026-11-16T07:00:00Z"),
  ...overrides,
});

describe("parseRawEmail", () => {
  const raw = (headers: string) =>
    `From: "Peter Berger" <peter.berger@example.com>\r\nTo: office@autowerkstatt-muster.example\r\nSubject: Pickerl\r\nDate: Mon, 16 Nov 2026 08:00:00 +0100\r\n${headers}Content-Type: text/plain; charset=utf-8\r\n\r\nHallo, wann haben Sie Zeit?\r\n`;

  it("liest Absender, Betreff und Text", async () => {
    const parsed = await imap.parseRawEmail(raw("Message-ID: <abc@example.com>\r\n"));
    expect(parsed).toMatchObject({
      messageId: "<abc@example.com>",
      fromAddress: "peter.berger@example.com",
      fromName: "Peter Berger",
      subject: "Pickerl",
      body: "Hallo, wann haben Sie Zeit?",
      autoSubmitted: false,
    });
  });

  it("bildet ohne Message-ID eine stabile Ersatz-ID und erkennt automatische E-Mails", async () => {
    const a = await imap.parseRawEmail(raw(""));
    const b = await imap.parseRawEmail(raw(""));
    expect(a!.messageId).toMatch(/@ersatz>$/);
    expect(a!.messageId).toBe(b!.messageId);
    expect((await imap.parseRawEmail(raw("Auto-Submitted: auto-replied\r\n")))!.autoSubmitted).toBe(true);
  });
});

describe("processIncomingEmail", () => {
  it("legt einen Entwurf zur Freigabe an und ordnet den Kontakt zu", async () => {
    const result = await mail.processIncomingEmail(incoming());
    expect(result!.email).toMatchObject({ status: "entwurf", category: "terminanfrage", replySubject: "Re: Pickerl" });
    const lead = await leads.findLeadByContact({ email: "Peter.Berger@example.com" });
    expect(lead).toMatchObject({ name: "Peter Berger", phone: "+436765551234", funnel: "email" });
    expect(result!.events[0]).toMatchObject({ event: "email.received", category: "terminanfrage", urgent: false });
    expect(sent).toHaveLength(0);
  });

  it("verarbeitet dieselbe E-Mail nur einmal", async () => {
    const mailOnce = incoming();
    expect(await mail.processIncomingEmail(mailOnce)).not.toBeNull();
    expect(await mail.processIncomingEmail(mailOnce)).toBeNull();
    expect(analysis.calls).toBe(1);
  });

  it("antwortet nie auf automatische Absender oder die eigene Adresse", async () => {
    for (const overrides of [
      { fromAddress: "no-reply@shop.example" },
      { fromAddress: "office@autowerkstatt-muster.example" },
      { autoSubmitted: true },
    ]) {
      const result = await mail.processIncomingEmail(incoming(overrides));
      expect(result!.email.status).toBe("erledigt");
    }
    expect(analysis.calls).toBe(0);
  });

  it("legt für Werbung keinen Kontakt an", async () => {
    analysis.next = { ...terminanfrage, category: "werbung_spam", needsReply: false, replyBody: "" };
    const result = await mail.processIncomingEmail(incoming({ fromAddress: "angebot@werbung.example" }));
    expect(result!.email).toMatchObject({ status: "erledigt", leadId: null });
    expect(result!.events).toHaveLength(0);
    expect(await leads.findLeadByContact({ email: "angebot@werbung.example" })).toBeNull();
  });

  it("merkt sich KI-Fehler und kann erneut auswerten", async () => {
    const { AiError } = await import("@/lib/ai");
    analysis.next = new AiError("KI nicht verfügbar");
    const failed = await mail.processIncomingEmail(incoming());
    expect(failed!.email).toMatchObject({ status: "fehler", error: "KI nicht verfügbar" });
    analysis.next = terminanfrage;
    const retried = await mail.analyzeAndRoute(failed!.email);
    expect(retried.email).toMatchObject({ status: "entwurf", error: null });
  });
});

describe("Versand", () => {
  it("sendet im autonomen Modus Routineanfragen direkt – als Antwort im selben Verlauf", async () => {
    config.business.emailAssistant.mode = "autonom";
    const before = sent.length;
    const result = await mail.processIncomingEmail(incoming({ messageId: "<thread-1@example.com>" }));
    expect(result!.email.status).toBe("gesendet");
    expect(sent).toHaveLength(before + 1);
    expect(sent.at(-1)!.to).toBe("peter.berger@example.com");
    expect(sent.at(-1)!.raw).toContain("In-Reply-To: <thread-1@example.com>");
  });

  it("dringende Anfragen bleiben auch im autonomen Modus Entwurf", async () => {
    config.business.emailAssistant.mode = "autonom";
    analysis.next = { ...terminanfrage, urgent: true };
    expect((await mail.processIncomingEmail(incoming()))!.email.status).toBe("entwurf");
  });

  it("sendet einen freigegebenen, bearbeiteten Entwurf", async () => {
    const result = await mail.processIncomingEmail(incoming());
    await mail.sendReply(result!.email, { subject: "Re: Pickerl – Terminvorschlag", body: "Bearbeiteter Text" });
    const stored = await emails.getEmail(result!.email.id);
    expect(stored).toMatchObject({ status: "gesendet", replySubject: "Re: Pickerl – Terminvorschlag", replyBody: "Bearbeiteter Text" });
    expect(sent.at(-1)!.raw).toContain("Bearbeiteter Text");
    const activities = await leads.listActivities(stored!.leadId!);
    expect(activities.some((a) => a.text === "Antwort gesendet: „Re: Pickerl – Terminvorschlag“")).toBe(true);
  });
});
