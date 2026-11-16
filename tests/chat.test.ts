import { mkdtempSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zonedToUtc } from "@/lib/calendar";

// Nachgebaute Claude-API: spielt ein Gespräch mit Werkzeugaufrufen durch, wie das echte Modell es täte.
type Block = Record<string, unknown>;
type Body = { system: string; messages: { role: string; content: string | Block[] }[]; tools: { name: string }[]; [key: string]: unknown };
const requests: { body: Body; headers: IncomingHttpHeaders }[] = [];

function lastToolResult(body: Body): { name: string; text: string } | null {
  const last = body.messages.at(-1)!;
  if (typeof last.content === "string") return null;
  const result = last.content.find((b) => b.type === "tool_result");
  if (!result) return null;
  const previous = body.messages.at(-2)!.content as Block[];
  const call = previous.find((b) => b.type === "tool_use" && b.id === result.tool_use_id)!;
  const content = result.content;
  const text = typeof content === "string" ? content : (content as Block[]).map((c) => String(c.text ?? "")).join("");
  return { name: String(call.name), text };
}

function lastCustomerText(body: Body): string {
  const last = [...body.messages].reverse().find((m) => m.role === "user" && typeof m.content === "string");
  return String(last?.content ?? "");
}

let toolCounter = 0;
const toolUse = (name: string, input: Record<string, unknown>) => ({
  content: [{ type: "tool_use", id: `toolu_${++toolCounter}`, name, input }],
  stop_reason: "tool_use",
});
const say = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn" });

function respond(body: Body) {
  const result = lastToolResult(body);
  if (result?.name === "termin_verfuegbarkeit") {
    const { termine } = JSON.parse(result.text);
    return toolUse("termin_buchen", { leistung: "pickerl", start: termine[0].start, name: "Peter Berger" });
  }
  if (result?.name === "termin_buchen") return say(`Erledigt! ${result.text.split(" Bestätige")[0]}`);
  if (result?.name === "an_mitarbeiter_uebergeben") return say("Ich gebe Sie an eine Kollegin weiter, sie meldet sich hier im Chat.");
  const text = lastCustomerText(body);
  if (text.includes("Pickerl")) return toolUse("termin_verfuegbarkeit", { leistung: "pickerl" });
  if (text.includes("Mensch")) return toolUse("an_mitarbeiter_uebergeben", { grund: "Kunde möchte mit einem Menschen sprechen" });
  return say("Grüß Gott, hier ist Lena, die KI-Assistentin. Wie kann ich helfen?");
}

const api: Server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw) as Body;
    requests.push({ body, headers: req.headers });
    if (lastCustomerText(body).includes("Fehler")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "kaputt" } }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: `msg_${requests.length}`,
        type: "message",
        role: "assistant",
        model: body.model,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
        ...respond(body),
      }),
    );
  });
});

let chat: typeof import("@/lib/chat/handle");
let agent: typeof import("@/lib/chat/agent");
let conversations: typeof import("@/lib/conversations");
let leads: typeof import("@/lib/leads");
let appointments: typeof import("@/lib/appointments");

beforeAll(async () => {
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  Object.assign(process.env, {
    DATABASE_URL: `file:${path.join(mkdtempSync(path.join(tmpdir(), "chat-")), "test.db")}`,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}`,
    ANTHROPIC_API_KEY: "test-key",
  });
  chat = await import("@/lib/chat/handle");
  agent = await import("@/lib/chat/agent");
  conversations = await import("@/lib/conversations");
  leads = await import("@/lib/leads");
  appointments = await import("@/lib/appointments");
});
afterAll(() => new Promise<void>((resolve) => api.close(() => resolve())));

// Montag, 16.11.2026, 8:00 Uhr Wiener Zeit
const now = zonedToUtc("2026-11-16", "08:00", "Europe/Vienna");
const outbox: { contact: string; text: string }[] = [];
const sender = async (conversation: { contact: string }, text: string) => {
  outbox.push({ contact: conversation.contact, text });
  return `wamid.out.${outbox.length}`;
};
const whatsapp = (contact: string, text: string, id: string, name = "Peter Berger") => ({
  channel: "whatsapp" as const,
  contact,
  contactName: name,
  contactPhone: `+${contact}`,
  text,
  externalId: id,
});

describe("Chat-Assistent über WhatsApp", () => {
  it("bucht per Werkzeug-Schleife einen Termin und antwortet", async () => {
    const { reply, events } = await chat.handleIncomingChat(
      whatsapp("436641112233", "Grüß Gott, hätten Sie Zeit für ein Pickerl?", "wamid.1"),
      sender,
      now,
    );

    expect(reply?.text).toBe("Erledigt! Gebucht: §57a-Überprüfung (Pickerl) am Montag, 16. November, 10:00 Uhr.");
    expect(outbox.at(-1)).toEqual({ contact: "436641112233", text: reply!.text });
    expect(reply?.externalId).toBe("wamid.out.1");
    expect(events.map((e) => e.event)).toEqual(["appointment.booked"]);

    // Drei Modellaufrufe: Verfügbarkeit, Buchung, Antwort – mit Prompt, Werkzeugen und Ersatzmodell-Einstellung
    expect(requests).toHaveLength(3);
    const first = requests[0];
    expect(first.body.model).toBe("claude-opus-5-5");
    expect(first.body.system).toContain("KI-Assistentin von Autowerkstatt Muster");
    expect(first.body.system).toContain("Die Telefonnummer des Kunden ist +436641112233");
    expect(first.body.tools.map((t) => t.name)).toEqual([
      "termin_verfuegbarkeit",
      "termin_buchen",
      "rueckruf_notieren",
      "an_mitarbeiter_uebergeben",
    ]);
    expect(first.body.fallbacks).toBe("default");
    expect(first.body.output_config).toEqual({ effort: "low" });
    expect(String(first.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");

    const lead = await leads.findLeadByContact({ phone: "+436641112233" });
    expect(lead).toMatchObject({ funnel: "whatsapp", name: "Peter Berger", stage: "termin" });
    const booked = await appointments.listAppointments(
      zonedToUtc("2026-11-16", "00:00", "Europe/Vienna"),
      zonedToUtc("2026-11-17", "00:00", "Europe/Vienna"),
    );
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({ source: "whatsapp", leadId: lead!.id });
  });

  it("verarbeitet doppelt zugestellte Webhooks nur einmal", async () => {
    const before = requests.length;
    const again = await chat.handleIncomingChat(
      whatsapp("436641112233", "Grüß Gott, hätten Sie Zeit für ein Pickerl?", "wamid.1"),
      sender,
      now,
    );
    expect(again).toEqual({ reply: null, events: [] });
    expect(requests).toHaveLength(before);
  });

  it("übergibt an das Team und schweigt danach", async () => {
    const { reply, events } = await chat.handleIncomingChat(
      whatsapp("436769998877", "Ich möchte bitte mit einem Menschen sprechen", "wamid.2", "Karl Steiner"),
      sender,
      now,
    );
    expect(reply?.text).toContain("Kollegin");
    expect(events).toEqual([
      expect.objectContaining({ event: "chat.handoff", contact: "Karl Steiner", reason: "Kunde möchte mit einem Menschen sprechen" }),
    ]);
    const { conversation } = await conversations.openConversation("whatsapp", "436769998877", null);
    expect(conversation.mode).toBe("team");

    const before = requests.length;
    const later = await chat.handleIncomingChat(whatsapp("436769998877", "Hallo?", "wamid.3", "Karl Steiner"), sender, now);
    expect(later.reply).toBeNull();
    expect(requests).toHaveLength(before);
  });

  it("Team-Antworten gehen nur innerhalb von 24 Stunden nach der letzten Kundennachricht", async () => {
    const { conversation } = await conversations.openConversation("whatsapp", "436769998877", null);
    const sent = await chat.sendTeamMessage(conversation.id, "Grüß Gott, hier ist Maria aus der Werkstatt.", sender, new Date());
    expect(sent).toMatchObject({ author: "team", deliveryError: null });
    await expect(chat.sendTeamMessage(conversation.id, "Zu spät", sender, new Date(Date.now() + 25 * 60 * 60 * 1000))).rejects.toThrow(
      "24 Stunden",
    );
  });

  it("antwortet bei Bildern oder Sprachnachrichten ohne KI und bei KI-Fehlern mit Übergabe", async () => {
    const before = requests.length;
    const image = await chat.handleIncomingChat({ ...whatsapp("436601234567", "[image]", "wamid.4"), unsupported: true }, sender, now);
    expect(image.reply?.text).toBe(chat.UNSUPPORTED_REPLY);
    expect(requests).toHaveLength(before);

    const broken = await chat.handleIncomingChat(whatsapp("436601234567", "Fehler bitte", "wamid.5"), sender, now);
    expect(broken.reply?.text).toContain("technisches Problem");
    expect(broken.events[0]).toMatchObject({ event: "chat.handoff", reason: "Technisches Problem beim KI-Assistenten" });
  });

  it("merkt sich Zustellfehler, ohne die Antwort zu verlieren", async () => {
    const failing = async () => {
      throw new Error("WhatsApp-Versand fehlgeschlagen (HTTP 400)");
    };
    const { reply } = await chat.handleIncomingChat(whatsapp("436605555555", "Hallo", "wamid.6"), failing, now);
    expect(reply).toMatchObject({ author: "ki", deliveryError: "WhatsApp-Versand fehlgeschlagen (HTTP 400)" });
  });
});

describe("Gesprächsverlauf für Claude", () => {
  it("beginnt beim Kunden und kennzeichnet Team-Nachrichten", () => {
    const base = { conversationId: "c", externalId: null, deliveryError: null, createdAt: "" };
    const params = agent.toMessageParams([
      { ...base, id: "1", author: "team", text: "Willkommen" },
      { ...base, id: "2", author: "kunde", text: "Hallo" },
      { ...base, id: "3", author: "team", text: "Gerne" },
    ]);
    expect(params).toEqual([
      { role: "user", content: "Hallo" },
      { role: "assistant", content: "[Nachricht von einem Mitarbeiter] Gerne" },
    ]);
  });
});
