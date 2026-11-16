import type { Metadata } from "next";
import { site } from "@/config/site";
import { PlaceholderBadge, Section } from "@/components/ui";

export const metadata: Metadata = { title: "Datenschutz" };

// Vorlage – ersetzt keine Rechtsberatung. Vor dem Livegang an die tatsächlich eingesetzten Dienste anpassen.
export default function DatenschutzPage() {
  const { legal } = site;
  return (
    <Section>
      <div className="max-w-2xl space-y-6 text-slate-700">
        <h1 className="text-3xl font-bold text-slate-900">
          Datenschutzerklärung
          <PlaceholderBadge />
        </h1>
        <p>
          Verantwortlich für die Datenverarbeitung ist {legal.company}, {legal.address}, {legal.email}.
        </p>
        <h2 className="text-xl font-semibold text-slate-900">Anfragen und Bewerbungen über unsere Formulare</h2>
        <p>
          Wenn Sie unsere Formulare nutzen, verarbeiten wir Ihre Antworten und Kontaktdaten, um Ihre Anfrage bzw. Bewerbung zu bearbeiten
          (Art. 6 Abs. 1 lit. a und b DSGVO). Zusätzlich speichern wir, über welche Kampagne Sie zu uns gekommen sind (UTM-Parameter).
        </p>
        <h2 className="text-xl font-semibold text-slate-900">Eingesetzte Dienstleister</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Hosting und Datenbank: [Anbieter eintragen]</li>
          <li>Terminbuchung: [z. B. Cal.com oder Calendly]</li>
          <li>CRM / Automatisierung: [z. B. HubSpot, Pipedrive, n8n]</li>
          <li>
            KI-gestützte Gesprächsvorbereitung und -nachbereitung sowie E-Mail-Assistent: Anthropic (Claude API). Ihre Angaben werden dafür
            an Anthropic übermittelt.
          </li>
          <li>
            Telefon-Assistent: [z. B. Vapi, Telefonie-Anbieter, Sprachdienst]. Anrufe werden zur Bearbeitung transkribiert und
            zusammengefasst.
          </li>
          <li>Terminbestätigungen und -erinnerungen per SMS: [z. B. Twilio].</li>
          <li>WhatsApp-Assistent: WhatsApp Business Platform (Meta). Nachrichten werden von einer KI (Anthropic) beantwortet.</li>
        </ul>
        <h2 className="text-xl font-semibold text-slate-900">Speicherdauer und Ihre Rechte</h2>
        <p>
          Wir speichern Ihre Daten, solange es für die Bearbeitung erforderlich ist, Bewerbungsdaten höchstens sieben Monate nach Abschluss
          des Verfahrens. Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch
          sowie auf Widerruf Ihrer Einwilligung. Beschwerden können Sie bei der Datenschutzbehörde einbringen.
        </p>
      </div>
    </Section>
  );
}
