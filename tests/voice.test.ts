import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { zonedToUtc } from "@/lib/calendar";

process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "telefon-")), "test.db")}`;

let voice: typeof import("@/lib/voice/handler");
let leads: typeof import("@/lib/leads");
let calls: typeof import("@/lib/calls");
beforeAll(async () => {
  voice = await import("@/lib/voice/handler");
  leads = await import("@/lib/leads");
  calls = await import("@/lib/calls");
});

// Montag, 16.11.2026, 8:00 Uhr Wiener Zeit
const now = zonedToUtc("2026-11-16", "08:00", "Europe/Vienna");
const options = { serverUrl: "https://cockpit.example/api/voice/vapi", secret: "geheim", now };
const caller = { call: { id: "call-1", customer: { number: "+436641112233" } } };

function toolCall(name: string, args: Record<string, unknown>, id = "tc-1") {
  return { type: "tool-calls", ...caller, toolCallList: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] };
}

async function runTool(name: string, args: Record<string, unknown>) {
  const { response, events } = await voice.handleVapiMessage(toolCall(name, args), options);
  const [result] = response.results as { result?: string; error?: string }[];
  return { result, events };
}

describe("assistant-request", () => {
  it("liefert einen deutschsprachigen Assistenten mit KI-Hinweis, aktuellem Datum und Werkzeugen", async () => {
    const { response } = await voice.handleVapiMessage({ type: "assistant-request", ...caller }, options);
    const assistant = response.assistant as {
      firstMessage: string;
      model: { messages: { content: string }[]; tools: { type: string; function?: { name: string } }[] };
      server: { url: string; headers: Record<string, string> };
      transcriber: { language: string };
    };
    expect(assistant.firstMessage).toContain("KI-Assistentin");
    expect(assistant.model.messages[0].content).toContain("Heute ist Montag, 16. November 2026");
    expect(assistant.model.messages[0].content).toContain("+436641112233");
    expect(assistant.model.tools.map((t) => t.function?.name ?? t.type)).toEqual([
      "termin_verfuegbarkeit",
      "termin_buchen",
      "rueckruf_notieren",
      "endCall",
    ]);
    expect(assistant.server).toMatchObject({ url: options.serverUrl, headers: { "x-webhook-secret": "geheim" } });
    expect(assistant.transcriber.language).toBe("de-AT");
  });
});

describe("Werkzeuge", () => {
  let firstSlot: string;

  it("termin_verfuegbarkeit liefert vorlesbare Termine mit Startzeit", async () => {
    const { result } = await runTool("termin_verfuegbarkeit", { leistung: "pickerl" });
    const data = JSON.parse(result.result!);
    expect(data.leistung).toContain("Pickerl");
    expect(data.termine).toHaveLength(4);
    expect(data.termine[0].vorlesen).toBe("Montag, 16. November, 10:00 Uhr"); // 2 Stunden Vorlauf ab 8:00
    firstSlot = data.termine[0].start;
  });

  it("termin_buchen bucht, legt den Kontakt an und meldet das Ereignis", async () => {
    const { result, events } = await runTool("termin_buchen", {
      leistung: "pickerl",
      start: firstSlot,
      name: "Maria Huber",
      notiz: "VW Golf",
    });
    expect(result.result).toContain("Gebucht: §57a-Überprüfung (Pickerl) am Montag, 16. November, 10:00 Uhr");
    expect(events[0]).toMatchObject({ event: "appointment.booked", name: "Maria Huber" });
    const lead = await leads.findLeadByContact({ phone: "0664 111 22 33" });
    expect(lead).toMatchObject({ name: "Maria Huber", funnel: "telefon", stage: "termin" });
  });

  it("bei vollem Termin gibt termin_buchen Alternativen statt einer Buchung", async () => {
    await runTool("termin_buchen", { leistung: "pickerl", start: firstSlot, name: "Zweite Buchung" });
    const { result } = await runTool("termin_buchen", { leistung: "pickerl", start: firstSlot, name: "Dritte Buchung" });
    const data = JSON.parse(result.result!);
    expect(data.gebucht).toBe(false);
    expect(data.alternativen.length).toBeGreaterThan(0);
    expect(data.alternativen.map((a: { start: string }) => a.start)).not.toContain(firstSlot);
  });

  it("meldet ungültige Angaben als Fehler", async () => {
    expect((await runTool("termin_buchen", { leistung: "pickerl" })).result.error).toContain("Ungültige Angaben");
    expect((await runTool("termin_verfuegbarkeit", { leistung: "zauberei" })).result.result).toContain("Unbekannte Leistung");
    expect((await runTool("gibt_es_nicht", {})).result.error).toContain("Unbekanntes Werkzeug");
  });

  it("rueckruf_notieren braucht eine Nummer und hängt den Wunsch an den Kontakt", async () => {
    const anonymous = await voice.handleVapiMessage(
      {
        type: "tool-calls",
        call: { id: "call-2" },
        toolCallList: [
          { id: "x", function: { name: "rueckruf_notieren", arguments: { name: "Anonym", anliegen: "Frage", dringend: false } } },
        ],
      },
      options,
    );
    expect((anonymous.response.results as { result: string }[])[0].result).toContain("keine Rückrufnummer");

    const { result, events } = await runTool("rueckruf_notieren", { name: "Maria Huber", anliegen: "Reklamation Bremsen", dringend: true });
    expect(result.result).toContain("Rückruf notiert");
    expect(events[0]).toMatchObject({ event: "callback.requested", urgent: true, phone: "+436641112233" });
    const lead = await leads.findLeadByContact({ phone: "+436641112233" });
    const activities = await leads.listActivities(lead!.id);
    expect(activities.some((a) => a.text.includes("DRINGEND") && a.text.includes("Reklamation Bremsen"))).toBe(true);
  });
});

describe("end-of-call-report", () => {
  const report = {
    type: "end-of-call-report",
    ...caller,
    startedAt: "2026-11-16T07:10:00.000Z",
    endedAt: "2026-11-16T07:12:13.000Z",
    endedReason: "customer-ended-call",
    analysis: { summary: "Kundin hat ein Pickerl für Montag gebucht." },
    artifact: { transcript: "AI: Grüß Gott ...", recordingUrl: "https://example.com/rec.wav" },
  };

  it("speichert das Gespräch einmalig und vermerkt es beim Kontakt", async () => {
    const first = await voice.handleVapiMessage(report, options);
    const second = await voice.handleVapiMessage(report, options);
    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(0);

    const [call] = await calls.listCalls();
    expect(call).toMatchObject({ id: "call-1", durationSeconds: 133, summary: report.analysis.summary });
    const lead = await leads.findLeadByContact({ phone: "+436641112233" });
    const activities = await leads.listActivities(lead!.id);
    expect(activities.filter((a) => a.text.startsWith("Anruf (2:13 Min.)"))).toHaveLength(1);
  });

  it("legt für unbekannte Anrufer einen Kontakt an", async () => {
    await voice.handleVapiMessage({ ...report, call: { id: "call-3", customer: { number: "+43122334455" } } }, options);
    expect(await leads.findLeadByContact({ phone: "+43122334455" })).toMatchObject({ name: "Unbekannt (+43122334455)" });
  });
});
