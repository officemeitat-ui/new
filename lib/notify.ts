import "server-only";
import { business } from "@/config/business";
import { formatSlot } from "@/lib/calendar";
import { notifyTeam } from "@/lib/mail/smtp";
import { confirmAppointment } from "@/lib/reminders";
import { sendWebhook, type WebhookEvent } from "@/lib/webhook";

function cockpitLink(leadId: string | null): string {
  return leadId && process.env.PUBLIC_URL
    ? `\n\nIm Cockpit öffnen: ${process.env.PUBLIC_URL.replace(/\/$/, "")}/admin/leads/${leadId}`
    : "";
}

/** Was das Team zusätzlich per E-Mail erfährt (nur Dinge, die eine Reaktion brauchen). */
function teamNotification(event: WebhookEvent): { subject: string; text: string } | null {
  switch (event.event) {
    case "callback.requested":
      return {
        subject: `${event.urgent ? "DRINGEND: " : ""}Rückrufwunsch von ${event.name}`,
        text: `${event.name} (${event.phone}) bittet um Rückruf:\n\n${event.concern}${cockpitLink(event.leadId)}`,
      };
    case "appointment.booked":
      return {
        subject: `Neuer Termin: ${event.service}`,
        text: `${event.name} hat einen Termin gebucht: ${event.service}, ${formatSlot(new Date(event.start), business)}.${cockpitLink(event.leadId)}`,
      };
    case "chat.handoff":
      return {
        subject: `Chat-Übergabe: ${event.contact} wartet auf eine Antwort`,
        text: `Der KI-Assistent hat ein Chat-Gespräch an das Team übergeben.\nGrund: ${event.reason}${
          process.env.PUBLIC_URL ? `\n\nZum Gespräch: ${process.env.PUBLIC_URL.replace(/\/$/, "")}/admin/chats/${event.conversationId}` : ""
        }`,
      };
    case "email.received":
      return event.urgent ? { subject: "Dringende E-Mail eingegangen", text: `${event.summary}${cockpitLink(event.leadId)}` } : null;
    default:
      return null;
  }
}

/** Verschickt Ereignisse an den Webhook, bestätigt gebuchte Termine beim Kunden und benachrichtigt bei Bedarf das Team. */
export async function dispatchEvents(events: WebhookEvent[]): Promise<void> {
  await Promise.all(
    events.map(async (event) => {
      await sendWebhook(event);
      if (event.event === "appointment.booked") await confirmAppointment(event.appointmentId);
      const notification = teamNotification(event);
      if (notification) await notifyTeam(notification.subject, notification.text);
    }),
  );
}
