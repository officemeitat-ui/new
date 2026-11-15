import "server-only";
import { z } from "zod";
import { business, getService } from "@/config/business";
import { bookAppointment } from "@/lib/appointments";
import { offerSlots, SEARCH_DAYS } from "@/lib/availability";
import { formatSlot, localDate } from "@/lib/calendar";
import { CalendarSyncError } from "@/lib/calendar-sync";
import { saveCall } from "@/lib/calls";
import { ensureContact, markAppointmentStage } from "@/lib/contacts";
import { addActivity, findLeadByContact, normalizePhone } from "@/lib/leads";
import type { WebhookEvent } from "@/lib/webhook";
import { buildAssistant, TOOL_NAMES } from "@/lib/voice/assistant";

// Verarbeitet die Server-Nachrichten von Vapi. Rückgabe: Antwort an Vapi und Ereignisse,
// die die Route nach der Antwort verschickt (Webhook, Benachrichtigungen).

export type HandlerResult = { response: Record<string, unknown>; events: WebhookEvent[] };
type Context = { now: Date; callerNumber?: string; events: WebhookEvent[] };

const Message = z
  .object({
    type: z.string(),
    call: z
      .object({ id: z.string().optional(), customer: z.object({ number: z.string().optional() }).optional() })
      .passthrough()
      .optional(),
    customer: z.object({ number: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const ToolCalls = z.object({
  toolCallList: z.array(
    z.object({
      id: z.string(),
      function: z.object({ name: z.string(), arguments: z.union([z.string(), z.record(z.string(), z.unknown())]) }),
    }),
  ),
});

const EndOfCallReport = z.object({
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  endedReason: z.string().optional(),
  cost: z.number().optional(),
  analysis: z.object({ summary: z.string().optional() }).passthrough().optional(),
  artifact: z.object({ transcript: z.string().optional(), recordingUrl: z.string().optional() }).passthrough().optional(),
});

const AvailabilityArgs = z.object({ leistung: z.string(), ab_datum: z.string().optional() });
const BookArgs = z.object({
  leistung: z.string(),
  start: z.string(),
  name: z.string().min(1),
  telefon: z.string().optional(),
  notiz: z.string().optional(),
});
const CallbackArgs = z.object({
  name: z.string().min(1),
  anliegen: z.string().min(1),
  dringend: z.boolean(),
  telefon: z.string().optional(),
});

const unknownService = () => `Unbekannte Leistung. Möglich sind: ${business.services.map((s) => `${s.id} (${s.name})`).join(", ")}.`;

async function checkAvailability(args: z.infer<typeof AvailabilityArgs>, ctx: Context): Promise<string> {
  const result = await offerSlots(args.leistung, args.ab_datum ?? "", ctx.now);
  if (!result) return unknownService();
  if (result.slots.length === 0) {
    return `In den nächsten ${SEARCH_DAYS} Tagen ist für ${result.service.name} kein Termin frei. Biete einen Rückruf an.`;
  }
  return JSON.stringify({ leistung: result.service.name, dauer_minuten: result.service.durationMinutes, termine: result.slots });
}

async function book(args: z.infer<typeof BookArgs>, ctx: Context): Promise<string> {
  const service = getService(args.leistung);
  if (!service) return unknownService();
  const start = new Date(args.start);
  if (Number.isNaN(start.getTime()))
    return "Ungültige Startzeit. Bitte zuerst termin_verfuegbarkeit aufrufen und deren start-Wert verwenden.";
  const phone = args.telefon || ctx.callerNumber;

  const lead = await ensureContact("telefon", { name: args.name, phone });
  const result = await bookAppointment(
    { serviceId: service.id, start, name: args.name, phone, notes: args.notiz, leadId: lead.id, source: "telefon" },
    ctx.now,
  );
  if (!result.ok && result.reason === "kalender_nicht_erreichbar") {
    return "Der Kalender ist gerade nicht erreichbar, der Termin wurde NICHT gebucht. Biete einen Rückruf an.";
  }
  if (!result.ok) {
    const alternatives = await offerSlots(service.id, localDate(start, business.timeZone), ctx.now);
    return JSON.stringify({
      gebucht: false,
      hinweis: "Dieser Termin ist nicht (mehr) frei. Biete eine der Alternativen an.",
      alternativen: alternatives?.slots ?? [],
    });
  }

  const spoken = formatSlot(start, business);
  await markAppointmentStage(lead, `Termin per Telefon gebucht: ${service.name}, ${spoken}${args.notiz ? ` – ${args.notiz}` : ""}`);
  ctx.events.push({
    event: "appointment.booked",
    appointmentId: result.appointment.id,
    leadId: lead.id,
    service: service.name,
    start: start.toISOString(),
    name: args.name,
  });
  return `Gebucht: ${service.name} am ${spoken}. Bestätige das dem Anrufer und frag, ob du sonst noch helfen kannst.`;
}

async function requestCallback(args: z.infer<typeof CallbackArgs>, ctx: Context): Promise<string> {
  const phone = args.telefon || ctx.callerNumber;
  if (!phone) return "Es ist keine Rückrufnummer bekannt. Frag zuerst nach einer Telefonnummer.";
  const lead = await ensureContact("telefon", { name: args.name, phone });
  await addActivity(
    lead.id,
    "callback",
    `Rückrufwunsch${args.dringend ? " (DRINGEND)" : ""}: ${args.anliegen} – Tel. ${normalizePhone(phone)}`,
  );
  ctx.events.push({
    event: "callback.requested",
    leadId: lead.id,
    name: args.name,
    phone: normalizePhone(phone),
    concern: args.anliegen,
    urgent: args.dringend,
  });
  return "Rückruf notiert. Sag dem Anrufer, dass sich das Team während der Öffnungszeiten meldet.";
}

const tools: Record<string, { schema: z.ZodType; run: (args: never, ctx: Context) => Promise<string> }> = {
  [TOOL_NAMES.availability]: { schema: AvailabilityArgs, run: checkAvailability },
  [TOOL_NAMES.book]: { schema: BookArgs, run: book },
  [TOOL_NAMES.callback]: { schema: CallbackArgs, run: requestCallback },
};

async function runTool(name: string, rawArgs: unknown, ctx: Context): Promise<{ result?: string; error?: string }> {
  const tool = tools[name];
  if (!tool) return { error: `Unbekanntes Werkzeug: ${name}` };
  let args: unknown = rawArgs;
  if (typeof rawArgs === "string") {
    try {
      args = JSON.parse(rawArgs || "{}");
    } catch {
      return { error: "Argumente sind kein gültiges JSON." };
    }
  }
  const parsed = tool.schema.safeParse(args);
  if (!parsed.success)
    return { error: `Ungültige Angaben: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  try {
    return { result: await tool.run(parsed.data as never, ctx) };
  } catch (error) {
    console.error(`Werkzeug ${name} fehlgeschlagen:`, error);
    if (error instanceof CalendarSyncError) return { error: "Der Kalender ist gerade nicht erreichbar. Biete einen Rückruf an." };
    return { error: "Interner Fehler. Biete einen Rückruf an." };
  }
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Dauer unbekannt";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} Min.`;
}

async function storeCallReport(message: z.infer<typeof Message>, ctx: Context): Promise<void> {
  const report = EndOfCallReport.parse(message);
  const callId = message.call?.id;
  if (!callId) return;
  const phone = ctx.callerNumber ? normalizePhone(ctx.callerNumber) : null;
  const lead = phone ? ((await findLeadByContact({ phone })) ?? (await ensureContact("telefon", { phone }))) : null;
  const started = report.startedAt ? Date.parse(report.startedAt) : NaN;
  const ended = report.endedAt ? Date.parse(report.endedAt) : NaN;
  const durationSeconds = Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : null;
  const summary = report.analysis?.summary ?? null;

  const inserted = await saveCall({
    id: callId,
    leadId: lead?.id ?? null,
    phone,
    startedAt: report.startedAt ?? null,
    endedAt: report.endedAt ?? null,
    durationSeconds,
    endedReason: report.endedReason ?? null,
    summary,
    transcript: report.artifact?.transcript ?? null,
    recordingUrl: report.artifact?.recordingUrl ?? null,
    cost: report.cost ?? null,
  });
  if (!inserted) return;
  if (lead) await addActivity(lead.id, "call", `Anruf (${formatDuration(durationSeconds)}): ${summary ?? "ohne Zusammenfassung"}`);
  ctx.events.push({ event: "call.ended", callId, leadId: lead?.id ?? null, phone, summary });
}

export async function handleVapiMessage(
  rawMessage: unknown,
  options: { serverUrl: string; secret: string; now?: Date },
): Promise<HandlerResult> {
  const message = Message.parse(rawMessage);
  const ctx: Context = {
    now: options.now ?? new Date(),
    callerNumber: message.call?.customer?.number ?? message.customer?.number,
    events: [],
  };

  switch (message.type) {
    case "assistant-request":
      return {
        response: {
          assistant: buildAssistant({ serverUrl: options.serverUrl, secret: options.secret, now: ctx.now, callerNumber: ctx.callerNumber }),
        },
        events: [],
      };

    case "tool-calls": {
      const { toolCallList } = ToolCalls.parse(message);
      const results = [];
      for (const call of toolCallList) {
        results.push({
          name: call.function.name,
          toolCallId: call.id,
          ...(await runTool(call.function.name, call.function.arguments, ctx)),
        });
      }
      return { response: { results }, events: ctx.events };
    }

    case "end-of-call-report":
      await storeCallReport(message, ctx);
      return { response: {}, events: ctx.events };

    default:
      return { response: {}, events: [] };
  }
}
