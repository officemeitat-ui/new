import "server-only";
import { z } from "zod";
import { business, getService } from "@/config/business";
import { bookAppointment } from "@/lib/appointments";
import { TOOL_NAMES } from "@/lib/assistant/tool-names";
import { offerSlots, SEARCH_DAYS } from "@/lib/availability";
import { formatSlot, localDate } from "@/lib/calendar";
import { CalendarSyncError } from "@/lib/calendar-sync";
import { ensureContact, markAppointmentStage } from "@/lib/contacts";
import { addActivity, normalizePhone } from "@/lib/leads";
import type { WebhookEvent } from "@/lib/webhook";

// Werkzeuge der KI-Mitarbeiter (Telefon und Chat): freie Termine, Buchung, Rückrufwunsch.
// Die Ergebnisse sind Texte für das Sprachmodell; Fehler werden als verständliche Hinweise zurückgegeben.

export type ToolChannel = "telefon" | "whatsapp";

export type ToolContext = {
  now: Date;
  channel: ToolChannel;
  /** Telefonnummer des Kunden (Anrufer bzw. WhatsApp-Nummer), falls bekannt. */
  contactPhone?: string;
  events: WebhookEvent[];
};

const channelLabel: Record<ToolChannel, string> = { telefon: "per Telefon", whatsapp: "per WhatsApp" };

export const AvailabilityArgs = z.object({
  leistung: z.string().describe("ID der Leistung"),
  ab_datum: z.string().optional().describe("Frühestes gewünschtes Datum im Format JJJJ-MM-TT; leer = ab heute"),
});
export const BookArgs = z.object({
  leistung: z.string().describe("ID der Leistung"),
  start: z.string().describe("Startzeit genau wie von termin_verfuegbarkeit geliefert"),
  name: z.string().min(1).describe("Vor- und Nachname des Kunden"),
  telefon: z.string().optional().describe("Nur angeben, wenn eine andere Nummer als die bekannte gewünscht ist"),
  notiz: z.string().optional().describe("Fahrzeug, Kennzeichen oder Wünsche, falls genannt"),
});
export const CallbackArgs = z.object({
  name: z.string().min(1),
  anliegen: z.string().min(1).describe("Worum es geht, in ein bis zwei Sätzen"),
  dringend: z.boolean(),
  telefon: z.string().optional().describe("Nur angeben, wenn eine andere Nummer als die bekannte gewünscht ist"),
});

const unknownService = () => `Unbekannte Leistung. Möglich sind: ${business.services.map((s) => `${s.id} (${s.name})`).join(", ")}.`;

export async function checkAvailability(args: z.infer<typeof AvailabilityArgs>, ctx: ToolContext): Promise<string> {
  const result = await offerSlots(args.leistung, args.ab_datum ?? "", ctx.now);
  if (!result) return unknownService();
  if (result.slots.length === 0) {
    return `In den nächsten ${SEARCH_DAYS} Tagen ist für ${result.service.name} kein Termin frei. Biete einen Rückruf an.`;
  }
  return JSON.stringify({ leistung: result.service.name, dauer_minuten: result.service.durationMinutes, termine: result.slots });
}

export async function book(args: z.infer<typeof BookArgs>, ctx: ToolContext): Promise<string> {
  const service = getService(args.leistung);
  if (!service) return unknownService();
  const start = new Date(args.start);
  if (Number.isNaN(start.getTime())) {
    return "Ungültige Startzeit. Bitte zuerst termin_verfuegbarkeit aufrufen und deren start-Wert verwenden.";
  }
  const phone = args.telefon || ctx.contactPhone;
  if (!phone) return "Für die Buchung fehlt eine Telefonnummer. Frag den Kunden danach.";

  const lead = await ensureContact(ctx.channel, { name: args.name, phone });
  const result = await bookAppointment(
    { serviceId: service.id, start, name: args.name, phone, notes: args.notiz, leadId: lead.id, source: ctx.channel },
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

  const when = formatSlot(start, business);
  await markAppointmentStage(
    lead,
    `Termin ${channelLabel[ctx.channel]} gebucht: ${service.name}, ${when}${args.notiz ? ` – ${args.notiz}` : ""}`,
  );
  ctx.events.push({
    event: "appointment.booked",
    appointmentId: result.appointment.id,
    leadId: lead.id,
    service: service.name,
    start: start.toISOString(),
    name: args.name,
  });
  return `Gebucht: ${service.name} am ${when}. Bestätige das dem Kunden und frag, ob du sonst noch helfen kannst.`;
}

export async function requestCallback(args: z.infer<typeof CallbackArgs>, ctx: ToolContext): Promise<string> {
  const phone = args.telefon || ctx.contactPhone;
  if (!phone) return "Es ist keine Rückrufnummer bekannt. Frag zuerst nach einer Telefonnummer.";
  const lead = await ensureContact(ctx.channel, { name: args.name, phone });
  await addActivity(
    lead.id,
    "callback",
    `Rückrufwunsch${args.dringend ? " (DRINGEND)" : ""} ${channelLabel[ctx.channel]}: ${args.anliegen} – Tel. ${normalizePhone(phone)}`,
  );
  ctx.events.push({
    event: "callback.requested",
    leadId: lead.id,
    name: args.name,
    phone: normalizePhone(phone),
    concern: args.anliegen,
    urgent: args.dringend,
  });
  return "Rückruf notiert. Sag dem Kunden, dass sich das Team während der Öffnungszeiten meldet.";
}

const tools: Record<string, { schema: z.ZodType; run: (args: never, ctx: ToolContext) => Promise<string> }> = {
  [TOOL_NAMES.availability]: { schema: AvailabilityArgs, run: checkAvailability },
  [TOOL_NAMES.book]: { schema: BookArgs, run: book },
  [TOOL_NAMES.callback]: { schema: CallbackArgs, run: requestCallback },
};

/** Fängt Fehler ab und formuliert sie so, dass das Modell dem Kunden eine Alternative anbietet. */
export async function safely(name: string, task: () => Promise<string>): Promise<{ result?: string; error?: string }> {
  try {
    return { result: await task() };
  } catch (error) {
    console.error(`Werkzeug ${name} fehlgeschlagen:`, error);
    if (error instanceof CalendarSyncError) return { error: "Der Kalender ist gerade nicht erreichbar. Biete einen Rückruf an." };
    return { error: "Interner Fehler. Biete einen Rückruf an." };
  }
}

/** Führt ein Werkzeug mit unvalidierten Argumenten aus (z. B. aus dem Vapi-Webhook). */
export async function runTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<{ result?: string; error?: string }> {
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
  if (!parsed.success) {
    return { error: `Ungültige Angaben: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }
  return safely(name, () => tool.run(parsed.data as never, ctx));
}
