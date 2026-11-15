import "server-only";
import { business, getService } from "@/config/business";
import { appointmentsDueForReminder, getAppointment, recordNotification, type Appointment } from "@/lib/appointments";
import { formatSlot } from "@/lib/calendar";
import { addActivity } from "@/lib/leads";
import { sendMail, smtpConfigured } from "@/lib/mail/smtp";
import { isMobileNumber, sendSms, smsConfigured } from "@/lib/sms";

// Terminbestätigung direkt nach der Buchung und Erinnerung vor dem Termin – per SMS oder E-Mail.

export type NotificationKind = "bestaetigung" | "erinnerung";
type Channel = "sms" | "email";

const HOUR = 60 * 60 * 1000;
/** Termine, die erst kurz vorher gebucht wurden, brauchen keine Erinnerung – die Bestätigung ist dann noch frisch. */
const MIN_HOURS_BETWEEN_BOOKING_AND_START = 12;

function shortSlot(start: Date): string {
  const day = new Intl.DateTimeFormat("de-AT", { timeZone: business.timeZone, weekday: "short", day: "numeric", month: "numeric" }).format(
    start,
  );
  const time = new Intl.DateTimeFormat("de-AT", { timeZone: business.timeZone, hour: "numeric", minute: "2-digit" }).format(start);
  return `${day}, ${time} Uhr`;
}

export function appointmentMessage(appointment: Appointment, kind: NotificationKind): { sms: string; subject: string; email: string } {
  const service = getService(appointment.serviceId)?.name ?? "Termin";
  const when = formatSlot(appointment.start, business);
  const confirmed = kind === "bestaetigung";
  return {
    sms: confirmed
      ? `${business.name}: Ihr Termin (${service}) am ${shortSlot(appointment.start)} ist bestätigt. ${business.address}. Änderungen bitte unter ${business.phone}.`
      : `Erinnerung von ${business.name}: ${service} am ${shortSlot(appointment.start)}, ${business.address}. Verhindert? Bitte kurz unter ${business.phone} absagen.`,
    subject: confirmed ? `Terminbestätigung: ${service} am ${when}` : `Erinnerung: Ihr Termin am ${when}`,
    email: [
      `Guten Tag ${appointment.name},`,
      "",
      confirmed
        ? "vielen Dank für Ihre Buchung. Ihr Termin ist bestätigt:"
        : "wir freuen uns auf Ihren Besuch und erinnern Sie an Ihren Termin:",
      "",
      `${service}`,
      `${when}`,
      `${business.name}, ${business.address}`,
      "",
      `Falls Sie den Termin nicht wahrnehmen können, rufen Sie uns bitte unter ${business.phone} an oder antworten Sie auf diese E-Mail.`,
      "",
      business.emailAssistant.signature,
    ].join("\n"),
  };
}

/** Verfügbare Kanäle für diesen Termin, in der eingestellten Reihenfolge. */
function channelsFor(appointment: Appointment): Channel[] {
  return business.reminders.channels.filter((channel) =>
    channel === "sms"
      ? Boolean(appointment.phone && isMobileNumber(appointment.phone) && smsConfigured())
      : Boolean(appointment.email && smtpConfigured()),
  );
}

/**
 * Benachrichtigt den Kunden über den ersten funktionierenden Kanal und vermerkt das Ergebnis am Termin.
 * Liefert den verwendeten Kanal oder null (kein Kanal verfügbar bzw. alle fehlgeschlagen).
 */
export async function notifyCustomer(appointment: Appointment, kind: NotificationKind): Promise<Channel | null> {
  const message = appointmentMessage(appointment, kind);
  const errors: string[] = [];
  for (const channel of channelsFor(appointment)) {
    try {
      if (channel === "sms") await sendSms(appointment.phone!, message.sms);
      else await sendMail({ to: appointment.email!, subject: message.subject, text: message.email });
      await recordNotification(appointment.id, kind, channel, errors.length ? errors.join("; ") : null);
      if (appointment.leadId) {
        await addActivity(
          appointment.leadId,
          "appointment",
          `${kind === "bestaetigung" ? "Terminbestätigung" : "Terminerinnerung"} per ${channel === "sms" ? "SMS" : "E-Mail"} gesendet`,
        );
      }
      return channel;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  await recordNotification(
    appointment.id,
    kind,
    null,
    errors.length ? errors.join("; ") : "Keine Mobilnummer oder E-Mail-Adresse bzw. Versand nicht eingerichtet",
  );
  return null;
}

/** Bestätigung nach einer Buchung (falls eingeschaltet). Fehler werden nur vermerkt, die Buchung bleibt gültig. */
export async function confirmAppointment(appointmentId: string): Promise<void> {
  if (!business.reminders.confirmation) return;
  const appointment = await getAppointment(appointmentId);
  if (!appointment || appointment.status !== "gebucht" || appointment.confirmationSentAt) return;
  try {
    await notifyCustomer(appointment, "bestaetigung");
  } catch (error) {
    console.error("Terminbestätigung fehlgeschlagen:", error);
  }
}

function localHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: business.timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
}

/**
 * Verschickt fällige Erinnerungen (stündlich aufrufen). Außerhalb des Versandfensters passiert nichts –
 * die Erinnerungen gehen dann beim ersten Lauf am Morgen raus.
 */
export async function sendDueReminders(now = new Date()): Promise<{ quiet: boolean; sent: number; undeliverable: number }> {
  const { hoursBefore, sendBetween } = business.reminders;
  if (hoursBefore <= 0) return { quiet: false, sent: 0, undeliverable: 0 };
  const hour = localHour(now);
  if (hour < sendBetween[0] || hour >= sendBetween[1]) return { quiet: true, sent: 0, undeliverable: 0 };

  const due = await appointmentsDueForReminder(
    new Date(now.getTime() + HOUR),
    new Date(now.getTime() + hoursBefore * HOUR),
    // Nur erinnern, wenn vor Beginn des Erinnerungsfensters gebucht wurde – sonst kämen Bestätigung und Erinnerung kurz hintereinander.
    (start) => new Date(start.getTime() - Math.max(hoursBefore, MIN_HOURS_BETWEEN_BOOKING_AND_START) * HOUR),
  );
  let sent = 0;
  let undeliverable = 0;
  for (const appointment of due) {
    if (await notifyCustomer(appointment, "erinnerung")) sent++;
    else undeliverable++;
  }
  return { quiet: false, sent, undeliverable };
}
