import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Nachgebautes Microsoft 365 (Graph) und nachgebaute Claude-API: der Büro-Assistent einmal komplett durchgespielt.

type Message = Record<string, unknown> & { id: string; conversationId?: string };
const addr = (name: string, address: string) => ({ emailAddress: { name, address } });
const MAILBOX = "office@it-muster.example";

const inbox: Message[] = [
  {
    id: "msg-kunde",
    internetMessageId: "<kunde-1@firma.example>",
    subject: "Re: Angebot Notebooks",
    from: addr("Maria Huber", "maria.huber@firma.example"),
    receivedDateTime: "2026-11-17T08:00:00Z",
    body: { contentType: "text", content: "Danke für das Angebot. Können Sie statt 5 auch 7 Geräte liefern?" },
    hasAttachments: false,
    conversationId: "conv-1",
    sensitivity: "normal",
    internetMessageHeaders: [],
  },
  {
    id: "msg-rechnung",
    internetMessageId: "<re-1@distributor.example>",
    subject: "Ihre Rechnung 2026-4711",
    from: addr("Distributor Muster GmbH", "noreply@distributor.example"),
    receivedDateTime: "2026-11-17T08:05:00Z",
    body: { contentType: "text", content: "Im Anhang finden Sie Ihre Rechnung." },
    hasAttachments: true,
    conversationId: "conv-2",
    sensitivity: "normal",
  },
  {
    id: "msg-link",
    internetMessageId: "<link-1@telko.example>",
    subject: "Ihre Rechnung November ist online",
    from: addr("Telko AG", "rechnung@telko.example"),
    receivedDateTime: "2026-11-17T08:10:00Z",
    body: { contentType: "text", content: "Ihre Rechnung steht im Kundenportal bereit: https://portal.telko.example" },
    hasAttachments: false,
    conversationId: "conv-3",
  },
  {
    id: "msg-news",
    internetMessageId: "<news-1@shop.example>",
    subject: "Neuigkeiten im November",
    from: addr("Shop", "no-reply@shop.example"),
    receivedDateTime: "2026-11-17T08:15:00Z",
    body: { contentType: "text", content: "Unsere Angebote" },
    hasAttachments: false,
    conversationId: "conv-4",
  },
  {
    id: "msg-vertraulich",
    internetMessageId: "<v-1@kunde.example>",
    subject: "Gehaltsliste",
    from: addr("Geschäftsführung Kunde", "gf@kunde.example"),
    receivedDateTime: "2026-11-17T08:20:00Z",
    body: { contentType: "text", content: "Vertraulich" },
    sensitivity: "confidential",
    conversationId: "conv-5",
  },
  {
    id: "msg-kanzlei",
    internetMessageId: "<k-1@kanzlei.example>",
    subject: "Jahresabschluss",
    from: addr("Kanzlei", "info@kanzlei.example"),
    receivedDateTime: "2026-11-17T08:25:00Z",
    body: { contentType: "text", content: "Bitte Unterlagen schicken" },
    conversationId: "conv-6",
  },
];
const earlierSent: Message = {
  id: "sent-0",
  from: addr("IT Muster", MAILBOX),
  receivedDateTime: "2026-11-14T10:00:00Z",
  sentDateTime: "2026-11-14T10:00:00Z",
  body: { contentType: "text", content: "Anbei unser Angebot über 5 Notebooks." },
  conversationId: "conv-1",
  isDraft: false,
};
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF`).toString("base64");
const attachments: Record<string, unknown[]> = {
  "msg-rechnung": [
    {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: "Rechnung_2026-4711.pdf",
      contentType: "application/pdf",
      contentBytes: pdf("Rechnung"),
    },
    {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: "AGB.pdf",
      contentType: "application/octet-stream",
      contentBytes: pdf("AGB"),
    },
    { "@odata.type": "#microsoft.graph.fileAttachment", name: "logo.png", contentType: "image/png", isInline: true, contentBytes: "iVBO" },
  ],
};

const graph = {
  categories: { "msg-kunde": ["Wichtig"] } as Record<string, string[]>,
  folders: [{ id: "f-buchhaltung", parent: "msgfolderroot", displayName: "Buchhaltung" }],
  drafts: {} as Record<string, { isDraft: boolean; body: { contentType: string; content: string } }>,
  sentItems: [] as Message[],
  moves: [] as { id: string; destinationId: string }[],
  createReplies: [] as string[],
  failMove: false,
  requests: [] as string[],
};

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const graphServer: Server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url!, "http://graph");
    const parts = url.pathname.split("/").map(decodeURIComponent).filter(Boolean);
    if (parts.at(-1) === "token") return json(res, 200, { access_token: "graph-token", expires_in: 3600 });
    const body = raw ? JSON.parse(raw) : {};
    const filter = url.searchParams.get("$filter") ?? "";
    graph.requests.push(`${req.method} ${parts.slice(3).join("/")}`);

    if (req.headers.authorization !== "Bearer graph-token") return json(res, 401, { error: { message: "unauthorized" } });
    // parts: v1.0, users, <mailbox>, …
    if (parts[2] !== MAILBOX) return json(res, 403, { error: { message: "Kein Zugriff auf dieses Postfach" } });
    const rest = parts.slice(3);
    const conversationFilter = filter.match(/conversationId eq '(.+)'/)?.[1];

    if (rest.join("/") === "mailFolders/inbox/messages") return json(res, 200, { value: inbox });
    if (rest.join("/") === "mailFolders/sentitems/messages") {
      return json(res, 200, { value: graph.sentItems.filter((m) => m.conversationId === conversationFilter) });
    }
    if (rest.join("/") === "messages" && conversationFilter) {
      return json(res, 200, { value: [earlierSent, ...inbox].filter((m) => m.conversationId === conversationFilter) });
    }
    if (rest[0] === "mailFolders" && rest[2] === "childFolders") {
      const parent = rest[1];
      if (req.method === "POST") {
        const folder = { id: `f-${body.displayName.toLowerCase()}`, parent, displayName: body.displayName };
        graph.folders.push(folder);
        return json(res, 201, folder);
      }
      const name = filter.match(/displayName eq '(.+)'/)?.[1];
      return json(res, 200, { value: graph.folders.filter((f) => f.parent === parent && f.displayName === name) });
    }
    if (rest[0] === "messages" && rest[1]) {
      const id = rest[1];
      if (rest[2] === "attachments") return json(res, 200, { value: attachments[id] ?? [] });
      if (rest[2] === "createReply") {
        graph.createReplies.push(id);
        const draftId = `draft-${id}`;
        graph.drafts[draftId] = {
          isDraft: true,
          body: {
            contentType: "html",
            content: '<html><head></head><body dir="ltr"><div>Von: Maria Huber</div><p>Original</p></body></html>',
          },
        };
        return json(res, 201, { id: draftId, ...graph.drafts[draftId] });
      }
      if (rest[2] === "move") {
        if (graph.failMove) return json(res, 500, { error: { message: "Interner Fehler" } });
        graph.moves.push({ id, destinationId: body.destinationId });
        return json(res, 201, { id });
      }
      if (req.method === "PATCH") {
        if (body.categories) graph.categories[id] = body.categories;
        if (body.body && graph.drafts[id]) graph.drafts[id].body = body.body;
        return json(res, 200, { id });
      }
      if (req.method === "GET") {
        if (id.startsWith("draft-")) {
          const draft = graph.drafts[id];
          return draft ? json(res, 200, { id, isDraft: draft.isDraft }) : json(res, 404, { error: { message: "Not found" } });
        }
        return json(res, 200, { id, categories: graph.categories[id] ?? [] });
      }
    }
    json(res, 404, { error: { message: `Unbekannt: ${req.method} ${url.pathname}` } });
  });
});

// Nachgebaute Claude-API: Auswertung der E-Mails und Auslesen der Belege
const claudeRequests: { system: string; text: string }[] = [];
const analysis = (overrides: Record<string, unknown>) => ({
  category: "sonstiges",
  summary: "",
  senderName: "",
  phone: "",
  urgent: false,
  needsReply: false,
  replySubject: "",
  replyBody: "",
  ...overrides,
});
const claudeServer: Server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const request = JSON.parse(raw);
    const content = request.messages[0].content;
    const text = typeof content === "string" ? content : content.map((b: { text?: string }) => b.text ?? "").join("\n");
    const system = typeof request.system === "string" ? request.system : JSON.stringify(request.system);
    claudeRequests.push({ system, text });
    let result: Record<string, unknown>;
    if (system.includes("Du liest Belege")) {
      result = text.includes("AGB.pdf")
        ? {
            dokumentart: "kein_beleg",
            lieferant: "",
            rechnungsnummer: "",
            rechnungsdatum: "",
            faelligAm: "",
            brutto: null,
            netto: null,
            ust: null,
            waehrung: "EUR",
            bezahlt: "unbekannt",
            beschreibung: "",
            unsicher: false,
          }
        : {
            dokumentart: "rechnung",
            lieferant: "Distributor Muster GmbH",
            rechnungsnummer: "2026-4711",
            rechnungsdatum: "2026-11-16",
            faelligAm: "2026-11-30",
            brutto: 1234.56,
            netto: 1028.8,
            ust: 205.76,
            waehrung: "EUR",
            bezahlt: "nein",
            beschreibung: "5 Notebooks für Kunde Huber",
            unsicher: false,
          };
    } else if (text.includes("Angebot Notebooks")) {
      result = analysis({
        category: "angebotsanfrage",
        summary: "Möchte 7 statt 5 Notebooks",
        senderName: "Maria Huber",
        needsReply: true,
        replySubject: "Re: Angebot Notebooks",
        replyBody:
          "Sehr geehrte Frau Huber,\n\n7 Geräte sind möglich, den Liefertermin schicke ich Ihnen morgen.\n\nMit freundlichen Grüßen",
      });
    } else if (text.includes("Rechnung")) {
      result = analysis({ category: "rechnung_beleg", summary: "Rechnung", needsReply: true, replySubject: "Re", replyBody: "Danke" });
    } else {
      result = analysis({ summary: "Sonstiges" });
    }
    json(res, 200, {
      id: `msg_${claudeRequests.length}`,
      type: "message",
      role: "assistant",
      model: request.model,
      content: [{ type: "text", text: JSON.stringify(result) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  });
});

let mail: typeof import("@/lib/mail/process");
let mailboxes: typeof import("@/lib/mail/mailbox");
let microsoft: typeof import("@/lib/mail/microsoft");
let emails: typeof import("@/lib/emails");
let receipts: typeof import("@/lib/receipts/store");
let leads: typeof import("@/lib/leads");
let config: typeof import("@/config/business");

beforeAll(async () => {
  await new Promise<void>((resolve) => graphServer.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => claudeServer.listen(0, "127.0.0.1", resolve));
  const graphUrl = `http://127.0.0.1:${(graphServer.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    DATABASE_URL: `file:${path.join(mkdtempSync(path.join(tmpdir(), "outlook-")), "test.db")}`,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${(claudeServer.address() as AddressInfo).port}`,
    ANTHROPIC_API_KEY: "test-key",
    MS_LOGIN_URL: graphUrl,
    MS_GRAPH_URL: `${graphUrl}/v1.0`,
    MS_TENANT_ID: "tenant",
    MS_CLIENT_ID: "client",
    MS_CLIENT_SECRET: "secret",
    MS_MAILBOX: MAILBOX,
    MS_MAIL_LOOKBACK_DAYS: "3",
  });
  config = await import("@/config/business");
  config.business.emailAssistant.excludeSenders = ["@kanzlei.example"];
  mail = await import("@/lib/mail/process");
  mailboxes = await import("@/lib/mail/mailbox");
  microsoft = await import("@/lib/mail/microsoft");
  emails = await import("@/lib/emails");
  receipts = await import("@/lib/receipts/store");
  leads = await import("@/lib/leads");
});
afterAll(async () => {
  await new Promise<void>((resolve) => graphServer.close(() => resolve()));
  await new Promise<void>((resolve) => claudeServer.close(() => resolve()));
});

const now = new Date("2026-11-17T09:00:00Z");
const byMessageId = async (messageId: string) =>
  (await emails.listEmails()).find((e) => e.messageId === messageId) ?? expect.unreachable(`E-Mail ${messageId} fehlt`);

describe("Büro-Assistent mit Microsoft 365", () => {
  it("wertet das Postfach aus: Entwurf in Outlook, Belege abgelegt, Vertrauliches ausgelassen", async () => {
    const mailbox = mailboxes.activeMailbox()!;
    expect(mailbox.kind).toBe("microsoft");
    const result = await mail.pollMailbox(mailbox, now);
    expect(result).toMatchObject({ fetched: 6, processed: 6 });

    // Kunde: Verlauf als Kontext, Antwort als Entwurf direkt im Outlook-Verlauf, Kategorie ergänzt, bleibt im Posteingang
    const kunde = await byMessageId("<kunde-1@firma.example>");
    expect(kunde).toMatchObject({ status: "entwurf", category: "angebotsanfrage", draftId: "draft-msg-kunde", filedTo: null, error: null });
    const kundeRequest = claudeRequests.find((r) => r.text.includes("Angebot Notebooks"))!;
    expect(kundeRequest.text).toContain("<verlauf>");
    expect(kundeRequest.text).toContain("Anbei unser Angebot über 5 Notebooks.");
    const draft = graph.drafts["draft-msg-kunde"].body;
    expect(draft.contentType).toBe("html");
    expect(draft.content).toContain(
      '<body dir="ltr"><div>Sehr geehrte Frau Huber,<br><br>7 Geräte sind möglich, den Liefertermin schicke ich Ihnen morgen.<br><br>Mit freundlichen Grüßen</div><br><div>Von: Maria Huber</div>',
    );
    expect(graph.categories["msg-kunde"]).toEqual(["Wichtig", "KI: Angebotsanfrage"]);
    expect(graph.moves.find((m) => m.id === "msg-kunde")).toBeUndefined();
    expect(await leads.findLeadByContact({ email: "maria.huber@firma.example" })).toMatchObject({ name: "Maria Huber" });
    expect(result.events.map((e) => e.event)).toEqual(["email.received"]);

    // Rechnung von „noreply“: ausgewertet, aber nie beantwortet; AGB nicht als Beleg; abgelegt in Buchhaltung/Eingangsrechnungen
    const rechnung = await byMessageId("<re-1@distributor.example>");
    expect(rechnung).toMatchObject({ status: "erledigt", category: "rechnung_beleg", draftId: null, leadId: null });
    expect(rechnung.filedTo).toBe("Buchhaltung/Eingangsrechnungen");
    expect(graph.folders.map((f) => `${f.parent}>${f.displayName}`)).toEqual([
      "msgfolderroot>Buchhaltung",
      "f-buchhaltung>Eingangsrechnungen",
    ]);
    expect(graph.moves).toContainEqual({ id: "msg-rechnung", destinationId: "f-eingangsrechnungen" });
    expect(graph.categories["msg-rechnung"]).toEqual(["KI: Rechnung / Beleg"]);
    expect(graph.createReplies).toEqual(["msg-kunde"]);

    const november = await receipts.listReceipts("2026-11");
    const stored = november.find((r) => r.emailId === rechnung.id)!;
    expect(stored).toMatchObject({
      status: "neu",
      supplier: "Distributor Muster GmbH",
      invoiceNumber: "2026-4711",
      invoiceDate: "2026-11-16",
      grossCents: 123456,
      netCents: 102880,
      vatCents: 20576,
      paid: false,
      hasFile: true,
      fileName: "Rechnung_2026-4711.pdf",
      contentType: "application/pdf",
    });
    expect(november.filter((r) => r.emailId === rechnung.id)).toHaveLength(1);

    // Rechnung nur als Link: als fehlend vermerkt
    const link = await byMessageId("<link-1@telko.example>");
    expect(november.find((r) => r.emailId === link.id)).toMatchObject({ status: "fehlt", supplier: "Telko AG", hasFile: false });

    // Newsletter, vertraulich markierte E-Mail und Absender auf der Ausnahmeliste gehen nie an die KI
    for (const id of ["<news-1@shop.example>", "<v-1@kunde.example>", "<k-1@kanzlei.example>"]) {
      expect((await byMessageId(id)).status).toBe("erledigt");
    }
    const allText = claudeRequests.map((r) => r.text).join("\n");
    expect(allText).not.toContain("Gehaltsliste");
    expect(allText).not.toContain("Jahresabschluss");
    expect(allText).not.toContain("Neuigkeiten");
    // 3 Auswertungen + 2 Anhänge (Rechnung, AGB) – das Inline-Logo wird nicht ausgelesen
    expect(claudeRequests).toHaveLength(5);

    // Der Assistent versendet nie selbst
    expect(graph.requests.some((r) => /send|sendMail/.test(r))).toBe(false);
  });

  it("erkennt beim nächsten Abruf, dass der Entwurf in Outlook gesendet wurde", async () => {
    const before = claudeRequests.length;
    graph.drafts["draft-msg-kunde"].isDraft = false;
    const result = await mail.pollMailbox(mailboxes.activeMailbox()!, now);
    expect(result).toMatchObject({ processed: 0, draftsSent: 1 });
    expect(claudeRequests).toHaveLength(before);
    const kunde = await byMessageId("<kunde-1@firma.example>");
    expect(kunde.status).toBe("gesendet");
    const activities = await leads.listActivities(kunde.leadId!);
    expect(activities.some((a) => a.text.startsWith("Antwort in Outlook gesendet"))).toBe(true);
  });

  it("unterscheidet gesendete und gelöschte Entwürfe, wenn der Entwurf verschwunden ist", async () => {
    const mailbox = mailboxes.activeMailbox()!;
    const make = async (id: string, conversationId: string) => {
      const stored = (await emails.insertEmail({
        messageId: `<${id}@test>`,
        fromAddress: "kunde@test.example",
        fromName: null,
        subject: id,
        body: "…",
        receivedAt: new Date("2026-11-17T07:00:00Z"),
        externalId: id,
        conversationId,
      }))!;
      await emails.updateEmail(stored.id, {
        status: "entwurf",
        replyBody: "Antwort",
        draftId: `draft-weg-${id}`,
        draftCreatedAt: "2026-11-17T07:30:00Z",
      });
      return stored.id;
    };
    const sentId = await make("gesendet", "conv-g");
    const deletedId = await make("geloescht", "conv-l");
    graph.sentItems.push({ id: "sent-1", conversationId: "conv-g", sentDateTime: "2026-11-17T08:00:00Z", isDraft: false });
    graph.sentItems.push({ id: "sent-old", conversationId: "conv-l", sentDateTime: "2026-11-16T08:00:00Z", isDraft: false });
    expect(await mail.syncMailboxDrafts(mailbox, now)).toEqual({ sent: 1, discarded: 1 });
    expect((await emails.getEmail(sentId))!.status).toBe("gesendet");
    expect((await emails.getEmail(deletedId))!.status).toBe("verworfen");
  });

  it("vermerkt Probleme in Outlook, ohne die Auswertung zu verlieren", async () => {
    graph.failMove = true;
    inbox.push({
      id: "msg-rechnung-2",
      internetMessageId: "<re-2@distributor.example>",
      subject: "Ihre Rechnung 2026-4712",
      from: addr("Distributor Muster GmbH", "noreply@distributor.example"),
      receivedDateTime: "2026-11-17T08:30:00Z",
      body: { contentType: "text", content: "Rechnung anbei" },
      hasAttachments: false,
      conversationId: "conv-7",
    });
    await mail.pollMailbox(mailboxes.activeMailbox()!, now);
    const email = await byMessageId("<re-2@distributor.example>");
    expect(email).toMatchObject({ status: "erledigt", category: "rechnung_beleg", filedTo: null });
    expect(email.error).toContain("Ablage in Outlook fehlgeschlagen: Microsoft 365: HTTP 500 – Interner Fehler");
  });
});

describe("Entwurfstext über dem Zitat", () => {
  it("setzt den Text bei Nur-Text-E-Mails vor den Verlauf und maskiert HTML", () => {
    expect(microsoft.prependReply({ contentType: "text", content: "> alt" }, "Hallo")).toEqual({
      contentType: "text",
      content: "Hallo\n\n> alt",
    });
    expect(microsoft.prependReply({ contentType: "html", content: "<p>alt</p>" }, "a < b & c")).toEqual({
      contentType: "html",
      content: "<div>a &lt; b &amp; c</div><br><p>alt</p>",
    });
  });
});
