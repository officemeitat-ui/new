import type { Vapi } from "@vapi-ai/server-sdk";
import { business } from "@/config/business";
import { describeOpeningHours } from "@/lib/calendar";

// Konfiguration des Telefon-Assistenten für Vapi. Sie wird bei jedem Anruf frisch erzeugt
// (Vapi fragt per „assistant-request“ an), damit Datum und Betriebsprofil immer aktuell sind.

export const TOOL_NAMES = {
  availability: "termin_verfuegbarkeit",
  book: "termin_buchen",
  callback: "rueckruf_notieren",
} as const;

const serviceIds = business.services.map((s) => s.id);

function functionTool(
  server: Vapi.Server,
  name: string,
  description: string,
  properties: Record<string, Vapi.JsonSchema>,
  required: string[],
  waitMessage: string,
): Vapi.AnthropicModelToolsItem {
  return {
    type: "function",
    server,
    messages: [{ type: "request-start", content: waitMessage }],
    function: { name, description, parameters: { type: "object", properties, required } },
  };
}

export function systemPrompt(now: Date, callerNumber: string | undefined): string {
  const today = new Intl.DateTimeFormat("de-AT", {
    timeZone: business.timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);

  return [
    `Du bist ${business.assistant.name}, die KI-Telefonassistentin von ${business.name} (${business.industry}). Du nimmst Anrufe entgegen, beantwortest Fragen, vereinbarst Termine und notierst Rückrufwünsche.`,
    `Heute ist ${today} (Zeitzone ${business.timeZone}).`,
    callerNumber ? `Der Anruf kommt von der Nummer ${callerNumber}.` : "Die Nummer des Anrufers ist unterdrückt.",
    "",
    "## Gesprächsregeln",
    "- Sprich Hochdeutsch mit österreichischem Einschlag, freundlich und per Sie. Kurze Sätze, immer nur eine Frage auf einmal.",
    "- Du bist eine KI. Sag das ehrlich, wenn jemand fragt, und gib dich nie als Mensch aus.",
    "- Erfinde nichts: keine Preise, Diagnosen, Zusagen oder Termine, die nicht aus den Werkzeugen oder diesem Profil stammen. Wenn du etwas nicht weißt, biete einen Rückruf an.",
    "- Lies Termine natürlich vor („Montag, den 23. November, um halb acht“), nie im technischen Format.",
    "- Wiederhole vor dem Buchen kurz Leistung, Datum, Uhrzeit und Namen und lass dir das bestätigen.",
    business.assistant.instructions && `- ${business.assistant.instructions}`,
    "",
    "## Termine",
    `- Erst die gewünschte Leistung klären, dann mit ${TOOL_NAMES.availability} freie Zeiten holen und höchstens zwei bis drei davon anbieten.`,
    `- Zum Buchen ${TOOL_NAMES.book} mit genau dem Wert „start“ aus der Verfügbarkeitsabfrage aufrufen. Name ist Pflicht; die Telefonnummer des Anrufers wird automatisch übernommen, außer er nennt eine andere.`,
    `- Bei Beschwerden, Unfällen, dringenden Fällen oder allem, was du nicht lösen kannst: mit ${TOOL_NAMES.callback} einen Rückruf notieren.`,
    business.assistant.transferNumber
      ? "- Wenn der Anrufer ausdrücklich einen Menschen sprechen will, verbinde während der Öffnungszeiten weiter."
      : "- Weiterverbinden ist nicht möglich; biete stattdessen einen Rückruf an.",
    "- Beende das Gespräch höflich, wenn alles erledigt ist.",
    "",
    "## Betrieb",
    `Name: ${business.name}`,
    `Adresse: ${business.address}`,
    `Telefon: ${business.phone} · E-Mail: ${business.email} · Web: ${business.website}`,
    `Öffnungszeiten: ${describeOpeningHours(business)}`,
    business.closedDates.length > 0 && `Geschlossen an: ${business.closedDates.join(", ")}`,
    "",
    "## Leistungen",
    ...business.services.map((s) => `- ${s.name} (ID ${s.id}, Dauer ${s.durationMinutes} Min.): ${s.info}`),
    "",
    "## Häufige Fragen",
    ...business.faq.map((f) => `- ${f.q} ${f.a}`),
  ]
    .filter((line) => line !== false && line !== undefined)
    .join("\n");
}

export type AssistantOptions = {
  serverUrl: string;
  secret: string;
  now: Date;
  callerNumber?: string;
};

export function buildAssistant({ serverUrl, secret, now, callerNumber }: AssistantOptions): Vapi.CreateAssistantDto {
  const server: Vapi.Server = { url: serverUrl, headers: { "x-webhook-secret": secret }, timeoutSeconds: 20 };

  const tools: Vapi.AnthropicModelToolsItem[] = [
    functionTool(
      server,
      TOOL_NAMES.availability,
      "Liefert freie Termine für eine Leistung ab einem Datum.",
      {
        leistung: { type: "string", enum: serviceIds, description: "ID der Leistung" },
        ab_datum: { type: "string", description: "Frühestes gewünschtes Datum im Format JJJJ-MM-TT; leer = ab heute" },
      },
      ["leistung"],
      "Einen Moment, ich schaue im Kalender nach.",
    ),
    functionTool(
      server,
      TOOL_NAMES.book,
      "Bucht einen Termin. Nur mit einem „start“-Wert aus der Verfügbarkeitsabfrage aufrufen.",
      {
        leistung: { type: "string", enum: serviceIds },
        start: { type: "string", description: "Startzeit genau wie von termin_verfuegbarkeit geliefert" },
        name: { type: "string", description: "Vor- und Nachname des Kunden" },
        telefon: { type: "string", description: "Nur angeben, wenn eine andere Nummer als die des Anrufers gewünscht ist" },
        notiz: { type: "string", description: "Fahrzeug, Kennzeichen oder Wünsche, falls genannt" },
      },
      ["leistung", "start", "name"],
      "Ich trage den Termin ein.",
    ),
    functionTool(
      server,
      TOOL_NAMES.callback,
      "Notiert einen Rückrufwunsch für das Team.",
      {
        name: { type: "string" },
        anliegen: { type: "string", description: "Worum es geht, in ein bis zwei Sätzen" },
        dringend: { type: "boolean" },
        telefon: { type: "string", description: "Nur angeben, wenn eine andere Nummer als die des Anrufers gewünscht ist" },
      },
      ["name", "anliegen", "dringend"],
      "Ich notiere das für das Team.",
    ),
    { type: "endCall" },
  ];
  if (business.assistant.transferNumber) {
    tools.push({
      type: "transferCall",
      destinations: [
        {
          type: "number",
          number: business.assistant.transferNumber,
          message: "Ich verbinde Sie jetzt mit einer Kollegin oder einem Kollegen.",
        },
      ],
    });
  }

  return {
    name: `${business.name} – Telefon`.slice(0, 40),
    firstMessage: `Grüß Gott bei ${business.name}, hier spricht ${business.assistant.name}, die KI-Assistentin. Wie kann ich Ihnen helfen?`,
    model: {
      provider: "anthropic",
      model: (process.env.VAPI_LLM_MODEL || "claude-sonnet-5") as Vapi.AnthropicModelModel,
      messages: [{ role: "system", content: systemPrompt(now, callerNumber) }],
      tools,
    },
    voice: { provider: "azure", voiceId: process.env.VAPI_VOICE_ID || "de-AT-IngridNeural" },
    transcriber: { provider: "azure", language: "de-AT" },
    server,
    serverMessages: ["tool-calls", "end-of-call-report"],
    endCallMessage: "Danke für Ihren Anruf. Auf Wiederhören!",
    maxDurationSeconds: 600,
    analysisPlan: {
      summaryPlan: {
        messages: [
          {
            role: "system",
            content:
              "Fasse das Telefonat auf Deutsch in zwei bis drei Sätzen zusammen: Anliegen, Ergebnis (z. B. gebuchter Termin) und offene Punkte. Gib nur die Zusammenfassung aus.",
          },
          { role: "user", content: "Transkript:\n\n{{transcript}}\n\nGrund für das Gesprächsende: {{endedReason}}" },
        ],
      },
    },
    metadata: { source: "ki-mitarbeiter-cockpit" },
  };
}
