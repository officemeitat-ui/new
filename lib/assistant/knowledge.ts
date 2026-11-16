import { business } from "@/config/business";
import { describeOpeningHours } from "@/lib/calendar";

/** Aktuelles Datum mit Uhrzeit in der Zeitzone des Betriebs, für Prompts. */
export function todayForPrompt(now: Date): string {
  return new Intl.DateTimeFormat("de-AT", {
    timeZone: business.timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
}

/** Wissen über den Betrieb für Telefon- und Chat-Assistent: Kontaktdaten, Öffnungszeiten, Leistungen, häufige Fragen. */
export function businessKnowledge(): string[] {
  return [
    "## Betrieb",
    `Name: ${business.name}`,
    `Adresse: ${business.address}`,
    `Telefon: ${business.phone} · E-Mail: ${business.email} · Web: ${business.website}`,
    `Öffnungszeiten: ${describeOpeningHours(business)}`,
    ...(business.closedDates.length > 0 ? [`Geschlossen an: ${business.closedDates.join(", ")}`] : []),
    "",
    "## Leistungen",
    ...business.services.map((s) => `- ${s.name} (ID ${s.id}, Dauer ${s.durationMinutes} Min.): ${s.info}`),
    "",
    "## Häufige Fragen",
    ...business.faq.map((f) => `- ${f.q} ${f.a}`),
  ];
}
