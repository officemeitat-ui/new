"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { business, getService } from "@/config/business";
import { bookAppointment, cancelAppointment, getAppointment, pushToCalendar } from "@/lib/appointments";
import { requireAdmin } from "@/lib/auth";
import { formatSlot, localDate } from "@/lib/calendar";
import { calendarProvider, CalendarSyncError } from "@/lib/calendar-sync";
import { ensureContact, markAppointmentStage } from "@/lib/contacts";
import { getEmail, updateEmail } from "@/lib/emails";
import { addActivity } from "@/lib/leads";
import { smtpConfigured } from "@/lib/mail/smtp";
import { analyzeAndRoute, processIncomingEmail, sendReply } from "@/lib/mail/process";
import { dispatchEvents } from "@/lib/notify";

export type ActionState = { error?: string; ok?: boolean; message?: string };

function refreshCockpit() {
  revalidatePath("/admin", "layout");
}

export async function handleEmailDraft(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const email = await getEmail(String(formData.get("emailId")));
  if (!email) return { error: "E-Mail nicht gefunden" };
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  switch (formData.get("intent")) {
    case "send":
      if (!smtpConfigured()) {
        return { error: "Versand ist nicht eingerichtet (SMTP fehlt). Text kopieren, selbst senden und dann „Erledigt“ wählen." };
      }
      if (!subject || !body) return { error: "Betreff und Text dürfen nicht leer sein." };
      try {
        await sendReply(email, { subject, body });
      } catch (error) {
        console.error("Versand fehlgeschlagen:", error);
        return { error: "Versand fehlgeschlagen. Bitte SMTP-Zugangsdaten prüfen." };
      }
      break;
    case "done":
      await updateEmail(email.id, { status: "erledigt", replySubject: subject || null, replyBody: body || null });
      if (email.leadId) await addActivity(email.leadId, "email", `E-Mail „${email.subject}“ manuell erledigt`);
      break;
    case "discard":
      await updateEmail(email.id, { status: "verworfen" });
      break;
    default:
      return { error: "Unbekannte Aktion" };
  }
  refreshCockpit();
  return { ok: true };
}

export async function retryEmail(formData: FormData) {
  await requireAdmin();
  const email = await getEmail(String(formData.get("emailId")));
  if (!email) return;
  const { events } = await analyzeAndRoute(email);
  if (events.length > 0) after(() => dispatchEvents(events));
  refreshCockpit();
}

const SimulatedEmail = z.object({
  fromName: z.string().trim().max(200),
  fromAddress: z.email("Bitte gültige Absender-Adresse angeben"),
  subject: z.string().trim().min(1, "Betreff fehlt").max(500),
  body: z.string().trim().min(5, "Text fehlt").max(20_000),
});

/** Spielt eine Test-E-Mail durch den Assistenten – für Vorführungen ohne echtes Postfach. */
export async function simulateEmail(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = SimulatedEmail.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const result = await processIncomingEmail({
    ...parsed.data,
    fromName: parsed.data.fromName || null,
    messageId: `<simulation-${randomUUID()}@cockpit>`,
    receivedAt: new Date(),
  });
  if (!result) return { error: "E-Mail wurde bereits verarbeitet" };
  if (result.events.length > 0) after(() => dispatchEvents(result.events));
  refreshCockpit();
  if (result.email.status === "fehler") return { error: result.email.error ?? "Auswertung fehlgeschlagen" };
  return { ok: true, message: `Ausgewertet – Status: ${result.email.status}` };
}

export async function bookManually(formData: FormData) {
  await requireAdmin();
  const service = getService(String(formData.get("serviceId")));
  const start = new Date(String(formData.get("start")));
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || undefined;
  const email = String(formData.get("email") ?? "").trim() || undefined;
  const date = Number.isNaN(start.getTime()) ? "" : localDate(start, business.timeZone);
  const back = (params: string) => redirect(`/admin/termine?leistung=${service?.id ?? ""}&datum=${date}&${params}`);
  if (!service || Number.isNaN(start.getTime()) || !name) back("fehler=angaben");

  const lead = phone || email ? await ensureContact("telefon", { name, phone, email }) : null;
  const result = await bookAppointment({ serviceId: service!.id, start, name, phone, email, leadId: lead?.id, source: "manuell" });
  if (!result.ok) back(result.reason === "kalender_nicht_erreichbar" ? "fehler=kalender" : "fehler=belegt");
  if (lead) await markAppointmentStage(lead, `Termin manuell eingetragen: ${service!.name}, ${formatSlot(start, business)}`);
  refreshCockpit();
  back("gebucht=1");
}

export async function cancelAppointmentAction(formData: FormData) {
  await requireAdmin();
  const appointment = await cancelAppointment(String(formData.get("appointmentId")));
  if (appointment?.leadId) {
    await addActivity(
      appointment.leadId,
      "appointment",
      `Termin storniert: ${getService(appointment.serviceId)?.name ?? appointment.serviceId}, ${formatSlot(appointment.start, business)}`,
    );
  }
  refreshCockpit();
}

export async function retryCalendarSync(formData: FormData) {
  await requireAdmin();
  const appointment = await getAppointment(String(formData.get("appointmentId")));
  if (appointment) await pushToCalendar(appointment);
  refreshCockpit();
}

/** Prüft die Verbindung zum externen Kalender, indem die belegten Zeiten der nächsten 7 Tage gelesen werden. */
export async function testCalendarConnection(): Promise<ActionState> {
  await requireAdmin();
  try {
    const calendar = calendarProvider();
    if (!calendar) return { error: "Kein externer Kalender gewählt (CALENDAR_PROVIDER)." };
    const now = new Date();
    const busy = await calendar.listBusy(now, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
    return {
      ok: true,
      message: `Verbunden mit ${calendar.label}: ${busy.length === 1 ? "1 belegter Eintrag" : `${busy.length} belegte Einträge`} in den nächsten 7 Tagen.`,
    };
  } catch (error) {
    if (!(error instanceof CalendarSyncError)) throw error;
    return { error: error.message };
  }
}
