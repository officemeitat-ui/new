import "server-only";
import { channels } from "@/config/site";
import { addActivity, completeContact, createLead, findLeadByContact, setStage, type Lead } from "@/lib/leads";

/**
 * Findet den Kontakt zu Telefonnummer bzw. E-Mail-Adresse oder legt ihn im Kanal des KI-Mitarbeiters an.
 * So landen alle Anrufe und E-Mails einer Person beim selben Eintrag.
 */
export async function ensureContact(
  channelId: keyof typeof channels,
  data: { name?: string; phone?: string; email?: string },
): Promise<Lead> {
  const existing = await findLeadByContact(data);
  if (existing) {
    await completeContact(existing, data);
    return existing;
  }
  const channel = channels[channelId];
  return createLead(
    {
      funnel: channel.id,
      stage: channel.initialStage,
      name: data.name?.trim() || `Unbekannt (${data.phone ?? data.email ?? "ohne Kontakt"})`,
      phone: data.phone,
      email: data.email,
    },
    `Neuer Kontakt über ${channel.label}`,
  );
}

/** Setzt Kontakte aus Kanälen nach einer Terminbuchung auf „Termin vereinbart“, sofern sie noch am Anfang stehen. */
export async function markAppointmentStage(lead: Lead, appointmentText: string): Promise<void> {
  await addActivity(lead.id, "appointment", appointmentText);
  if (Object.hasOwn(channels, lead.funnel) && ["neu", "in_bearbeitung"].includes(lead.stage)) {
    await setStage(lead.id, "termin", "Stufe: → Termin vereinbart (automatisch)");
  }
}
