import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Arbeitsplatz: Aufgaben, Microsoft To Do, Outlook und der KI-Assistent – gegen nachgebaute Graph- und Claude-API.

// ── Graph ──
const graphCalls: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
const graph: Server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url!, "http://graph");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname.endsWith("/token")) return json(200, { access_token: "t", expires_in: 3600 });
    const p = decodeURIComponent(url.pathname).replace("/v1.0/users/office@it-muster.example", "");
    graphCalls.push({ method: req.method!, path: p, body: raw ? JSON.parse(raw) : null });
    if (p === "/todo/lists") {
      return json(200, {
        value: [
          { id: "L1", displayName: "Aufgaben", wellknownListName: "defaultList" },
          { id: "L2", displayName: "Projekte" },
        ],
      });
    }
    if (p === "/todo/lists/L1/tasks") {
      expect(url.searchParams.get("$filter")).toBe("status ne 'completed'");
      return json(200, {
        value: [
          {
            id: "T1",
            title: "Firewall-Lizenz verlängern",
            importance: "high",
            dueDateTime: { dateTime: "2026-11-20T00:00:00.0000000", timeZone: "UTC" },
          },
          { id: "T2", title: "Rechnung an Kunde 3", importance: "normal", body: { content: "Stunden aus Atera" } },
        ],
      });
    }
    if (p === "/todo/lists/L2/tasks") return json(200, { value: [{ id: "T3", title: "M365-Migration Huber planen", importance: "low" }] });
    if (p === "/calendar/events" && req.method === "POST")
      return json(201, { id: "evt-1", webLink: "https://outlook.office.com/calendar/item/evt-1" });
    if (p === "/calendar/calendarView") {
      return json(200, {
        value: [
          {
            id: "e1",
            subject: "Jour fixe",
            start: { dateTime: "2026-11-17T08:00:00.0000000" },
            end: { dateTime: "2026-11-17T08:30:00.0000000" },
            isAllDay: false,
          },
        ],
      });
    }
    if (p === "/messages" && req.method === "POST")
      return json(201, { id: "draft-1", webLink: "https://outlook.office.com/mail/drafts/draft-1" });
    json(404, { error: { message: `unbekannt ${p}` } });
  });
});

// ── Claude: spielt den Assistenten durch ──
type Block = Record<string, unknown>;
type Body = { system: string; messages: { role: string; content: string | Block[] }[]; tools: { name: string }[]; [key: string]: unknown };
const claudeRequests: Body[] = [];
let toolCounter = 0;
const toolUse = (...calls: [string, Record<string, unknown>][]) => ({
  content: calls.map(([name, input]) => ({ type: "tool_use", id: `toolu_${++toolCounter}`, name, input })),
  stop_reason: "tool_use",
});
const say = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn" });

function respond(body: Body) {
  const last = body.messages.at(-1)!;
  if (Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result")) {
    const results = last.content.filter((b) => b.type === "tool_result").map((b) => String(b.content));
    return say(`OK: ${results.join(" | ")}`);
  }
  const text = String(last.content);
  if (text.includes("Backup-Kontrolle")) {
    return toolUse([
      "aufgabe_anlegen",
      { titel: "Backup-Kontrolle Huber", faellig_am: "2026-11-18", uhrzeit: "09:00", kunde: "Huber", wiederholung: "monatlich" },
    ]);
  }
  if (text.includes("Server-Tausch")) {
    return toolUse(["termin_anlegen", { titel: "Server-Tausch bei Huber", start: "2026-11-19T14:00", dauer_minuten: 120, kunde: "Huber" }]);
  }
  if (text.includes("Schreib Maria")) {
    return toolUse([
      "email_entwurf",
      {
        an: "Huber",
        betreff: "Server-Tausch am Donnerstag",
        text: "Sehr geehrte Frau Huber,\n\nwir kommen Donnerstag um 14 Uhr.\n\nLG Max",
      },
    ]);
  }
  if (text.includes("heute an"))
    return toolUse(["aufgaben_anzeigen", { ansicht: "heute" }], ["termine_anzeigen", { von: "2026-11-17", bis: "2026-11-17" }]);
  if (text.includes("Erledige")) return toolUse(["aufgabe_erledigen", { suchbegriff: "Backup" }]);
  if (text.includes("gekauft"))
    return toolUse(["stunden_gutschreiben", { kunde: "Huber", stunden: 10, betrag_euro: 950, rechnung: "RE 2026-118" }]);
  if (text.includes("Stunden bei Huber"))
    return toolUse(["zeit_buchen", { kunde: "Huber", minuten: 90, taetigkeit: "Drucker eingerichtet", ticket_id: "#101" }]);
  if (text.includes("noch")) return toolUse(["stundenkonto", { kunde: "Huber" }]);
  if (text.includes("Passwort")) return say("Zugangsdaten verwalte ich nicht – schau in Keeper beim Kunden.");
  return say("Wie kann ich helfen?");
}

const claude: Server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw) as Body;
    claudeRequests.push(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: `msg_${claudeRequests.length}`,
        type: "message",
        role: "assistant",
        model: body.model,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        ...respond(body),
      }),
    );
  });
});

let tasks: typeof import("@/lib/workspace/tasks");
let customers: typeof import("@/lib/workspace/customers");
let outlook: typeof import("@/lib/workspace/outlook");
let assistant: typeof import("@/lib/workspace/assistant");
const MS_ENV = { MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s", MS_MAILBOX: "office@it-muster.example" };

beforeAll(async () => {
  await new Promise<void>((resolve) => graph.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => claude.listen(0, "127.0.0.1", resolve));
  const graphUrl = `http://127.0.0.1:${(graph.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    DATABASE_URL: `file:${path.join(mkdtempSync(path.join(tmpdir(), "workspace-")), "test.db")}`,
    MS_LOGIN_URL: graphUrl,
    MS_GRAPH_URL: `${graphUrl}/v1.0`,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${(claude.address() as AddressInfo).port}`,
    ANTHROPIC_API_KEY: "test",
    ...MS_ENV,
  });
  tasks = await import("@/lib/workspace/tasks");
  customers = await import("@/lib/workspace/customers");
  outlook = await import("@/lib/workspace/outlook");
  assistant = await import("@/lib/workspace/assistant");
  const huber = await customers.createCustomer({ name: "Huber Steuerberatung" });
  await customers.updateCustomer(huber.id, { email: "maria.huber@huber-stb.example", address: "Hauptplatz 1, 4020 Linz" });
});
afterAll(async () => {
  await new Promise<void>((resolve) => graph.close(() => resolve()));
  await new Promise<void>((resolve) => claude.close(() => resolve()));
});

const now = new Date("2026-11-17T07:00:00Z"); // Dienstag, 8:00 Uhr in Wien
const today = "2026-11-17";

describe("Aufgaben", () => {
  it("zeigt Überfälliges und Heutiges zuerst, Dringendes ohne Datum auch", async () => {
    await tasks.createTask({ title: "Später", dueDate: "2026-11-25", source: "manuell" }, now);
    await tasks.createTask({ title: "Überfällig", dueDate: "2026-11-15", source: "manuell" }, now);
    await tasks.createTask({ title: "Heute 10 Uhr", dueDate: today, dueTime: "10:00", source: "manuell" }, now);
    await tasks.createTask({ title: "Dringend ohne Datum", priority: "hoch", source: "manuell" }, now);
    await tasks.createTask({ title: "Irgendwann", source: "manuell" }, now);
    expect((await tasks.listTasks("heute", today)).map((t) => t.title)).toEqual(["Überfällig", "Heute 10 Uhr", "Dringend ohne Datum"]);
    expect((await tasks.listTasks("demnaechst", today)).map((t) => t.title)).toEqual(["Später"]);
    expect(await tasks.taskCounts(today)).toEqual({ open: 5, today: 1, overdue: 1 });
  });

  it("legt bei wiederkehrenden Aufgaben die nächste an – auch über das Monatsende", async () => {
    expect(tasks.nextDueDate("2026-01-31", "monatlich")).toBe("2026-02-28");
    expect(tasks.nextDueDate("2026-12-15", "monatlich")).toBe("2027-01-15");
    expect(tasks.nextDueDate("2026-11-17", "woechentlich")).toBe("2026-11-24");
    const backup = await tasks.createTask(
      { title: "Backup prüfen", dueDate: "2026-09-10", recurrence: "monatlich", source: "manuell" },
      now,
    );
    const next = await tasks.completeTask(backup.id, today, now);
    // Liegen gebliebene Wiederholungen werden nicht nachgeholt: nächster Termin nach heute
    expect(next).toMatchObject({ title: "Backup prüfen", dueDate: "2026-12-10", recurrence: "monatlich", status: "offen" });
    expect((await tasks.getTask(backup.id))!.status).toBe("erledigt");
  });

  it("übernimmt offene Aufgaben aus Microsoft To Do nur einmal", async () => {
    expect(await outlook.importTodoTasks(now)).toEqual({ lists: 2, imported: 3 });
    expect(await outlook.importTodoTasks(now)).toEqual({ lists: 2, imported: 0 });
    const all = await tasks.listTasks("alle", today);
    expect(all.find((t) => t.title === "Firewall-Lizenz verlängern")).toMatchObject({
      priority: "hoch",
      dueDate: "2026-11-20",
      listName: "Allgemein",
      source: "todo",
    });
    expect(all.find((t) => t.title === "Rechnung an Kunde 3")).toMatchObject({ notes: "Stunden aus Atera" });
    expect(all.find((t) => t.title === "M365-Migration Huber planen")).toMatchObject({ listName: "Projekte", priority: "niedrig" });
  });
});

describe("KI-Assistent", () => {
  const ask = (text: string) => assistant.runAssistant([{ role: "user", text }], now);

  it("legt Aufgaben mit Kunde, Uhrzeit und Wiederholung an", async () => {
    const reply = await ask("Erinnere mich morgen um 9 an die Backup-Kontrolle bei Huber, jeden Monat");
    expect(reply.actions).toEqual([expect.objectContaining({ kind: "aufgabe", title: "Backup-Kontrolle Huber", href: "/app/aufgaben" })]);
    const task = (await tasks.findOpenTasks("Backup-Kontrolle"))[0];
    expect(task).toMatchObject({
      dueDate: "2026-11-18",
      dueTime: "09:00",
      customerName: "Huber Steuerberatung",
      recurrence: "monatlich",
      source: "assistent",
    });

    // Prompt: Datumstabelle, Kunden, Werkzeuge, kein serverseitiger Gesprächszustand
    const request = claudeRequests.at(-2)!;
    expect(request.system).toContain("Dienstag = 2026-11-17");
    expect(request.system).toContain("Donnerstag = 2026-11-19");
    expect(request.system).toContain("Kunden: Huber Steuerberatung");
    expect(request.system).toContain("nie");
    expect(request.tools.map((t) => t.name)).toEqual([
      "aufgabe_anlegen",
      "aufgaben_anzeigen",
      "aufgabe_erledigen",
      "termin_anlegen",
      "termine_anzeigen",
      "email_entwurf",
      "kunde_info",
      "tickets_anzeigen",
      "ticket_details",
      "zeit_buchen",
      "stundenkonto",
      "stunden_gutschreiben",
    ]);
    expect(request.output_config).toEqual({ effort: "low" });
    expect(request.thread).toBeUndefined();
  });

  it("trägt Termine in Outlook ein – in Wiener Zeit, mit Kundenadresse, ohne Einladungen", async () => {
    const reply = await ask("Trag Donnerstag 14 Uhr Server-Tausch bei Huber ein, 2 Stunden");
    const event = graphCalls.find((c) => c.path === "/calendar/events")!;
    expect(event.body).toMatchObject({
      subject: "Server-Tausch bei Huber",
      start: { dateTime: "2026-11-19T13:00:00", timeZone: "UTC" },
      end: { dateTime: "2026-11-19T15:00:00", timeZone: "UTC" },
      location: { displayName: "Hauptplatz 1, 4020 Linz" },
    });
    expect(event.body).not.toHaveProperty("attendees");
    expect(reply.actions[0]).toMatchObject({ kind: "termin", detail: "Donnerstag, 19.11.2026, 14:00–16:00 · Hauptplatz 1, 4020 Linz" });
  });

  it("schreibt E-Mails nur als Entwurf an die Adresse des Kunden", async () => {
    const reply = await ask("Schreib Maria Huber, dass wir Donnerstag kommen");
    const draft = graphCalls.find((c) => c.path === "/messages")!;
    expect(draft.body).toMatchObject({
      subject: "Server-Tausch am Donnerstag",
      toRecipients: [{ emailAddress: { address: "maria.huber@huber-stb.example" } }],
      body: { contentType: "text" },
    });
    expect(graphCalls.some((c) => /send/i.test(c.path))).toBe(false);
    expect(reply.actions[0]).toMatchObject({ kind: "entwurf", href: "https://outlook.office.com/mail/drafts/draft-1" });
  });

  it("beantwortet „Was steht heute an?“ mit Aufgaben und Kalender aus parallelen Abfragen", async () => {
    const reply = await ask("Was steht heute an?");
    expect(reply.text).toContain("Überfällig");
    expect(reply.text).toContain("Jour fixe");
    expect(reply.text).toContain("09:00–09:30"); // 8:00 UTC = 9:00 Wien
  });

  it("hakt Aufgaben per Suchbegriff ab und fragt bei mehreren Treffern nach", async () => {
    const reply = await ask("Erledige die Backup-Sache");
    // „Backup“ passt auf zwei offene Aufgaben → Rückfrage statt Raten
    expect(reply.text).toContain("Mehrere Treffer");
    expect(reply.actions).toEqual([]);
  });

  it("schreibt Stundenpakete gut, bucht Zeit davon ab und nennt den Reststand", async () => {
    const paket = await ask("Huber hat 10 Stunden gekauft, Rechnung RE 2026-118 über 950 Euro");
    expect(paket.actions[0]).toMatchObject({ kind: "stunden", title: "+10 h für Huber Steuerberatung", detail: "Reststand jetzt 10 h" });
    const zeit = await ask("Buch 1,5 Stunden bei Huber: Drucker eingerichtet");
    expect(zeit.actions[0]).toMatchObject({
      kind: "zeit",
      title: "1,5 h bei Huber Steuerberatung",
      detail: "Drucker eingerichtet · vom Stundenpaket · Reststand 8,5 h",
    });
    const stand = await ask("Wie viele Stunden hat Huber noch?");
    expect(stand.text).toContain("8,5 h übrig (gekauft 10 h, verbraucht 1,5 h)");
    expect(stand.text).toContain("1,5 h Drucker eingerichtet (vom Stundenpaket)");
  });

  it("ohne Outlook: Termin wird Aufgabe, E-Mail ein Link zum Mailprogramm", async () => {
    for (const key of Object.keys(MS_ENV)) delete process.env[key];
    try {
      const termin = await ask("Trag Donnerstag 14 Uhr Server-Tausch bei Huber ein, 2 Stunden");
      expect(termin.actions[0]).toMatchObject({ kind: "aufgabe", detail: expect.stringContaining("Outlook nicht verbunden") });
      const mail = await ask("Schreib Maria Huber, dass wir Donnerstag kommen");
      expect(mail.actions[0].href).toMatch(/^mailto:maria\.huber@huber-stb\.example\?subject=Server-Tausch%20am%20Donnerstag&body=/);
    } finally {
      Object.assign(process.env, MS_ENV);
    }
  });
});
