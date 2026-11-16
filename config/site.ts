// Zentrale Konfiguration: Marke, Texte, Funnels und Pipelines.
// Für ein neues Projekt (eigenes Angebot oder Kundenprojekt) wird in der Regel nur diese Datei angepasst.
// Alle Inhalte sind Beispieltexte; Einträge mit `placeholder: true` müssen vor dem Livegang ersetzt werden.

import type { Funnel } from "@/lib/funnel";
import type { Pipeline } from "@/lib/pipeline";

export const site = {
  locale: "de-AT",
  timeZone: "Europe/Vienna",
  brand: {
    name: "Musterfirma",
    claim: "KI-Mitarbeiter für Betriebe in Österreich",
    /** Primärfarbe (CSS-Farbwert), wird als --brand gesetzt. */
    color: "#4f46e5",
  },

  legal: {
    company: "Musterfirma GmbH",
    address: "Musterstraße 1, 1010 Wien, Österreich",
    email: "office@example.com",
    phone: "+43 1 000 00 00",
    register: "FN 000000x, Handelsgericht Wien",
    vatId: "ATU00000000",
    placeholder: true,
  },

  hero: {
    eyebrow: "Für Betriebe, die Telefon und Postfach nicht mehr bremsen sollen",
    title: "Ihr KI-Mitarbeiter nimmt Anrufe an, beantwortet E-Mails und vereinbart Termine",
    subtitle:
      "Rund um die Uhr erreichbar, ohne zusätzliches Personal. Wir richten den KI-Mitarbeiter mit Ihrem Wissen, Ihren Öffnungszeiten und Ihrem Kalender ein – Sie behalten die Kontrolle und sehen jeden Monat, was er erledigt hat.",
    cta: "Kostenlose Potentialanalyse sichern",
    ctaHint: "60 Sekunden Fragebogen · unverbindlich",
    bullets: [
      "Kein verpasster Anruf mehr – auch abends und am Wochenende",
      "Antwortentwürfe, die Sie mit einem Klick freigeben",
      "Eingerichtet und betreut von uns – kein Technik-Projekt für Sie",
    ],
  },

  problems: {
    title: "Wo Ihrem Betrieb jeden Tag Zeit und Aufträge verloren gehen",
    items: [
      {
        title: "Das Telefon läutet im falschen Moment",
        text: "Mitten in der Arbeit, in der Mittagspause oder nach Feierabend. Wer nicht durchkommt, ruft beim Mitbewerb an.",
      },
      {
        title: "Das Postfach frisst den Vormittag",
        text: "Immer gleiche Fragen zu Preisen, Öffnungszeiten und Terminen – jede einzeln beantwortet, oft erst Tage später.",
      },
      {
        title: "Terminvereinbarung als Pingpong",
        text: "Drei E-Mails und zwei Rückrufe für einen Termin. Angebote, bei denen niemand nachfasst, versanden.",
      },
    ],
  },

  process: {
    title: "In drei Schritten zum eigenen KI-Mitarbeiter",
    steps: [
      {
        title: "Potentialanalyse",
        text: "Wir schauen uns an, wo Anrufe, E-Mails und Termine bei Ihnen Zeit kosten, und rechnen gemeinsam durch, was ein KI-Mitarbeiter einspart.",
      },
      {
        title: "Einrichtung bei Ihnen",
        text: "Wir richten Telefon- und E-Mail-Assistent mit Ihren Leistungen, Öffnungszeiten und Ihrem Kalender ein. Zum Start schreibt er Entwürfe, die Sie freigeben.",
      },
      {
        title: "Betreuung & Ausbau",
        text: "Jeden Monat ein Bericht: angenommene Anrufe, gebuchte Termine, gesparte Stunden. Läuft alles rund, übernimmt der KI-Mitarbeiter weitere Aufgaben.",
      },
    ],
  },

  testimonials: {
    title: "Was Kunden sagen",
    items: [
      {
        quote: "Hier steht ein echtes Kundenzitat mit einem konkreten, belegbaren Ergebnis, z. B. verpasste Anrufe vorher und nachher.",
        name: "Vorname Nachname",
        role: "Inhaber, Beispiel Kfz-Werkstatt",
        placeholder: true,
      },
      {
        quote: "Zweites Kundenzitat – idealerweise mit Zahlen: gebuchte Termine pro Monat, eingesparte Stunden.",
        name: "Vorname Nachname",
        role: "Geschäftsführung, Beispiel Installateur GmbH",
        placeholder: true,
      },
      {
        quote: "Drittes Kundenzitat, z. B. zur Einrichtung vor Ort oder zur laufenden Betreuung.",
        name: "Vorname Nachname",
        role: "Praxismanagement, Beispiel Physiotherapie",
        placeholder: true,
      },
    ],
  },

  faq: {
    title: "Häufige Fragen",
    items: [
      {
        q: "Merken Anrufer, dass sie mit einer KI sprechen?",
        a: "Ja. Der Assistent stellt sich als KI vor – das ist gesetzlich vorgeschrieben und schafft Vertrauen. Er spricht natürlich, versteht österreichisches Deutsch und hält sich kurz.",
      },
      {
        q: "Was passiert, wenn die KI etwas nicht weiß?",
        a: "Sie erfindet nichts. Bei Fragen außerhalb ihres Wissens, Reklamationen oder dringenden Fällen notiert sie einen Rückruf und informiert Ihr Team sofort – oder verbindet direkt weiter.",
      },
      {
        q: "Ersetzt der KI-Mitarbeiter mein Team?",
        a: "Er nimmt Ihrem Team die wiederkehrende Routine ab, damit es sich auf Kunden und Aufträge konzentrieren kann. Was er erledigt, sehen Sie jederzeit im Cockpit.",
      },
      {
        q: "Funktioniert das mit meinem Telefon und Postfach?",
        a: "Ja. Ihre bestehende Nummer leitet auf den Assistenten weiter, Ihr E-Mail-Postfach wird angebunden. Termine landen in einem Kalender, neue Kontakte auf Wunsch auch in Ihrem CRM.",
      },
      {
        q: "Was kostet das?",
        a: "Eine einmalige Einrichtung und eine monatliche Pauschale, abhängig davon, welche Aufgaben der KI-Mitarbeiter übernimmt. In der Potentialanalyse rechnen wir durch, ob es sich für Sie lohnt.",
      },
      {
        q: "Was passiert mit meinen Daten und denen meiner Kunden?",
        a: "Wir schließen einen Auftragsverarbeitungsvertrag ab und legen alle eingesetzten Dienstleister offen. Details finden Sie in der Datenschutzerklärung.",
      },
    ],
  },

  finalCta: {
    title: "Wie viel Zeit könnte Ihr Betrieb sparen?",
    text: "Beantworten Sie fünf kurze Fragen und sichern Sie sich eine kostenlose Potentialanalyse.",
  },

  recruiting: {
    jobTitle: "Softwareentwickler:in (m/w/d)",
    company: "Beispiel IT GmbH",
    location: "Wien oder remote",
    salary: "ab € 4.000 brutto/Monat (14×), Überzahlung je nach Erfahrung",
    benefits: ["4-Tage-Woche möglich", "Remote-first", "Weiterbildungsbudget", "Moderne Projekte"],
    placeholder: true,
  },
};

export const pipelines: Record<string, Pipeline> = {
  anfragen: {
    id: "anfragen",
    label: "Anfragen",
    itemLabel: "Anfrage",
    trackValue: false,
    defaultValue: 0,
    stages: [
      { id: "neu", label: "Neu", probability: 10 },
      { id: "in_bearbeitung", label: "In Bearbeitung", probability: 30 },
      { id: "termin", label: "Termin vereinbart", probability: 70 },
      { id: "erledigt", label: "Erledigt", probability: 100, closed: "won" },
      { id: "kein_bedarf", label: "Kein Bedarf", probability: 0, closed: "lost" },
    ],
  },
  vertrieb: {
    id: "vertrieb",
    label: "Vertrieb",
    itemLabel: "Lead",
    trackValue: true,
    defaultValue: 10000,
    stages: [
      { id: "neu", label: "Neu", probability: 5 },
      { id: "qualifiziert", label: "Qualifiziert", probability: 15 },
      { id: "termin", label: "Erstgespräch", probability: 30 },
      { id: "angebot", label: "Angebot", probability: 60 },
      { id: "gewonnen", label: "Gewonnen", probability: 100, closed: "won" },
      { id: "verloren", label: "Verloren", probability: 0, closed: "lost" },
    ],
  },
  recruiting: {
    id: "recruiting",
    label: "Recruiting",
    itemLabel: "Bewerbung",
    trackValue: false,
    defaultValue: 0,
    stages: [
      { id: "neu", label: "Neu", probability: 5 },
      { id: "screening", label: "Screening", probability: 20 },
      { id: "interview", label: "Interview", probability: 40 },
      { id: "angebot", label: "Angebot", probability: 75 },
      { id: "eingestellt", label: "Eingestellt", probability: 100, closed: "won" },
      { id: "abgesagt", label: "Abgesagt", probability: 0, closed: "lost" },
    ],
  },
};

export const funnels: Record<string, Funnel> = {
  potentialanalyse: {
    id: "potentialanalyse",
    pipelineId: "vertrieb",
    title: "Kostenlose Potentialanalyse",
    intro: "Fünf kurze Fragen, damit wir das Gespräch auf Ihren Betrieb zuschneiden können.",
    threshold: 9,
    stageQualified: "qualifiziert",
    stageNotQualified: "neu",
    showBooking: true,
    questions: [
      {
        id: "branche",
        title: "In welcher Branche ist Ihr Betrieb tätig?",
        options: [
          { id: "handwerk", label: "Handwerk / Bau / Installation", points: 3 },
          { id: "kfz", label: "Kfz-Werkstatt / Autohandel", points: 3 },
          { id: "gesundheit", label: "Praxis / Therapie / Gesundheit", points: 2 },
          { id: "dienstleistung", label: "Büro / Dienstleistung / Beratung", points: 2 },
          { id: "andere", label: "Andere Branche", points: 1 },
        ],
      },
      {
        id: "groesse",
        title: "Wie viele Personen arbeiten in Ihrem Betrieb?",
        options: [
          { id: "1", label: "Nur ich", points: 1 },
          { id: "2-9", label: "2–9", points: 3 },
          { id: "10-49", label: "10–49", points: 3 },
          { id: "50+", label: "50 oder mehr", points: 2 },
        ],
      },
      {
        id: "zeitfresser",
        title: "Was kostet Sie und Ihr Team am meisten Zeit?",
        options: [
          { id: "telefon", label: "Telefon und Erreichbarkeit", points: 3 },
          { id: "emails", label: "E-Mails und Anfragen", points: 3 },
          { id: "termine", label: "Terminvereinbarung", points: 3 },
          { id: "nachfassen", label: "Angebote nachfassen", points: 2 },
          { id: "buero", label: "Belege und Büroarbeit", points: 1 },
        ],
      },
      {
        id: "anrufe",
        title: "Wie viele Anrufe bekommen Sie ungefähr pro Tag?",
        options: [
          { id: "unter10", label: "Unter 10", points: 1 },
          { id: "10-30", label: "10–30", points: 3 },
          { id: "ueber30", label: "Mehr als 30", points: 3 },
        ],
      },
      {
        id: "timing",
        title: "Wann möchten Sie starten?",
        options: [
          { id: "sofort", label: "So bald wie möglich", points: 3 },
          { id: "quartal", label: "In den nächsten 3 Monaten", points: 2 },
          { id: "spaeter", label: "Später / nur informieren", points: 0 },
        ],
      },
    ],
    contactFields: [
      { id: "name", label: "Vor- und Nachname", type: "text", required: true },
      { id: "email", label: "E-Mail", type: "email", required: true },
      { id: "company", label: "Betrieb", type: "text", required: true },
      { id: "phone", label: "Telefon", type: "tel", required: false },
    ],
    outcome: {
      qualified: {
        title: "Ihr Betrieb hat Potenzial – wählen Sie jetzt Ihren Termin.",
        text: "Im Gespräch rechnen wir gemeinsam durch, wo ein KI-Mitarbeiter Ihnen die meiste Zeit spart.",
      },
      notQualified: {
        title: "Danke für Ihre Angaben!",
        text: "Wir sehen uns Ihre Situation an und melden uns per E-Mail mit einer ehrlichen Einschätzung, ob sich ein KI-Mitarbeiter für Sie lohnt.",
      },
    },
  },

  bewerbung: {
    id: "bewerbung",
    pipelineId: "recruiting",
    title: "Bewerbung in 60 Sekunden",
    intro: "Kein Anschreiben, kein Lebenslauf nötig – ein paar Fragen und Ihre Kontaktdaten genügen.",
    threshold: 6,
    stageQualified: "screening",
    stageNotQualified: "neu",
    showBooking: false,
    questions: [
      {
        id: "erfahrung",
        title: "Wie viel Berufserfahrung haben Sie in der Softwareentwicklung?",
        options: [
          { id: "0-1", label: "Unter 1 Jahr", points: 0 },
          { id: "1-3", label: "1–3 Jahre", points: 2 },
          { id: "3-6", label: "3–6 Jahre", points: 3 },
          { id: "6+", label: "Mehr als 6 Jahre", points: 3 },
        ],
      },
      {
        id: "stack",
        title: "Mit welchem Stack arbeiten Sie am liebsten?",
        options: [
          { id: "ts", label: "TypeScript / Node.js", points: 3 },
          { id: "dotnet", label: "C# / .NET", points: 2 },
          { id: "java", label: "Java / Kotlin", points: 2 },
          { id: "anderer", label: "Anderer", points: 1 },
        ],
      },
      {
        id: "deutsch",
        title: "Wie gut ist Ihr Deutsch?",
        options: [
          { id: "muttersprache", label: "Muttersprache / fließend", points: 2 },
          { id: "gut", label: "Gut (B2)", points: 1 },
          { id: "basis", label: "Grundkenntnisse", points: 0, disqualify: true },
        ],
      },
      {
        id: "start",
        title: "Wann könnten Sie starten?",
        options: [
          { id: "sofort", label: "Sofort", points: 2 },
          { id: "1-3", label: "In 1–3 Monaten", points: 2 },
          { id: "3+", label: "In mehr als 3 Monaten", points: 0 },
        ],
      },
    ],
    contactFields: [
      { id: "name", label: "Vor- und Nachname", type: "text", required: true },
      { id: "email", label: "E-Mail", type: "email", required: true },
      { id: "phone", label: "Telefon", type: "tel", required: true },
      { id: "link", label: "LinkedIn, GitHub oder Lebenslauf (Link)", type: "url", required: false },
    ],
    outcome: {
      qualified: {
        title: "Vielen Dank für Ihre Bewerbung!",
        text: "Ihr Profil klingt spannend. Wir melden uns innerhalb von 48 Stunden telefonisch bei Ihnen.",
      },
      notQualified: {
        title: "Vielen Dank für Ihre Bewerbung!",
        text: "Wir sehen uns Ihre Angaben in Ruhe an und melden uns per E-Mail bei Ihnen.",
      },
    },
  },
};

/** Kanäle der KI-Mitarbeiter: Kontakte aus Anrufen und E-Mails landen in der angegebenen Pipeline. */
export type Channel = { id: string; label: string; pipelineId: string; initialStage: string };

export const channels: Record<string, Channel> = {
  telefon: { id: "telefon", label: "Telefon-Assistent", pipelineId: "anfragen", initialStage: "neu" },
  email: { id: "email", label: "E-Mail-Assistent", pipelineId: "anfragen", initialStage: "neu" },
  whatsapp: { id: "whatsapp", label: "WhatsApp-Assistent", pipelineId: "anfragen", initialStage: "neu" },
};

/** Herkunft eines Eintrags: Funnel (mit Fragen und Bewertung) oder Kanal eines KI-Mitarbeiters. */
export function resolveSource(id: string): { label: string; pipeline: Pipeline | undefined; funnel?: Funnel } | undefined {
  const funnel = getFunnel(id);
  if (funnel) return { label: funnel.title, pipeline: getPipeline(funnel.pipelineId), funnel };
  const channel = Object.hasOwn(channels, id) ? channels[id] : undefined;
  if (channel) return { label: channel.label, pipeline: getPipeline(channel.pipelineId) };
  return undefined;
}

export function getFunnel(id: string): Funnel | undefined {
  return Object.hasOwn(funnels, id) ? funnels[id] : undefined;
}

export function getPipeline(id: string): Pipeline | undefined {
  return Object.hasOwn(pipelines, id) ? pipelines[id] : undefined;
}
