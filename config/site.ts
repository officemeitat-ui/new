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
    claim: "Vertriebssysteme für B2B-Dienstleister",
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
    eyebrow: "Für B2B-Dienstleister mit 5–100 Mitarbeitenden",
    title: "Planbar neue Kunden gewinnen – statt auf Empfehlungen zu hoffen",
    subtitle:
      "Wir bauen mit Ihnen ein Vertriebssystem aus klarer Zielkunden-Definition, Kampagnen und einem sauberen Pipeline-Prozess. Sie sprechen nur noch mit Interessenten, die wirklich passen.",
    cta: "Kostenloses Erstgespräch sichern",
    ctaHint: "60 Sekunden Vorqualifizierung · unverbindlich",
    bullets: [
      "Vorqualifizierte Termine statt Kaltakquise",
      "Ein System, das Ihr Team selbst weiterführen kann",
      "KI-Unterstützung für Gesprächsvorbereitung und Follow-ups",
    ],
  },

  problems: {
    title: "Kommt Ihnen das bekannt vor?",
    items: [
      {
        title: "Wachstum hängt an Empfehlungen",
        text: "Gute Monate und leere Monate wechseln sich ab – planbar ist der Umsatz nicht.",
      },
      {
        title: "Vertrieb passiert nebenbei",
        text: "Geschäftsführung und Fachleute verkaufen zwischen zwei Projekten. Follow-ups bleiben liegen.",
      },
      {
        title: "Falsche Gespräche",
        text: "Viele Erstgespräche, wenige Abschlüsse – weil Budget, Bedarf oder Timing nicht passen.",
      },
    ],
  },

  process: {
    title: "In drei Phasen zum planbaren Vertrieb",
    steps: [
      {
        title: "Zielkunden & Angebot schärfen",
        text: "Wir definieren Ihr Ideal Customer Profile, das Kernproblem Ihrer Kunden und ein Angebot, das sich klar abhebt.",
      },
      {
        title: "Kampagnen & Vorqualifizierung",
        text: "Gezielte Ansprache über LinkedIn und Anzeigen, ein Funnel mit Vorqualifizierung und automatischer Terminbuchung.",
      },
      {
        title: "Pipeline, Forecast & Coaching",
        text: "Ein klarer Prozess vom Erstgespräch bis zum Abschluss – mit Forecast, Gesprächsleitfäden und KI-Follow-ups.",
      },
    ],
  },

  testimonials: {
    title: "Was Kunden sagen",
    items: [
      {
        quote: "Hier steht ein echtes Kundenzitat mit einem konkreten, belegbaren Ergebnis.",
        name: "Vorname Nachname",
        role: "Geschäftsführung, Beispiel IT GmbH",
        placeholder: true,
      },
      {
        quote: "Zweites Kundenzitat – idealerweise mit Zahlen: Zeitraum, Anzahl Termine, Abschlüsse.",
        name: "Vorname Nachname",
        role: "Head of Sales, Beispiel Software GmbH",
        placeholder: true,
      },
      {
        quote: "Drittes Kundenzitat, z. B. zur Zusammenarbeit oder zum Recruiting-Funnel.",
        name: "Vorname Nachname",
        role: "CEO, Beispiel Consulting GmbH",
        placeholder: true,
      },
    ],
  },

  faq: {
    title: "Häufige Fragen",
    items: [
      {
        q: "Für wen ist das Angebot gedacht?",
        a: "Für B2B-Dienstleister und Softwarefirmen mit etwa 5 bis 100 Mitarbeitenden, die ihren Vertrieb unabhängiger von Empfehlungen machen wollen.",
      },
      {
        q: "Wie läuft das Erstgespräch ab?",
        a: "Nach einer kurzen Vorqualifizierung buchen Sie direkt einen Termin. Im Gespräch analysieren wir Ihre aktuelle Neukundengewinnung und zeigen konkrete nächste Schritte – unverbindlich.",
      },
      {
        q: "Machen Sie Kaltakquise per E-Mail?",
        a: "Nein. Unaufgeforderte Werbe-E-Mails sind in Österreich und Deutschland auch im B2B-Bereich grundsätzlich unzulässig. Wir setzen auf LinkedIn, Anzeigen und Inbound.",
      },
      {
        q: "Wie schnell sehen wir Ergebnisse?",
        a: "Das hängt von Markt, Angebot und Ausgangslage ab. Im Erstgespräch geben wir eine ehrliche Einschätzung.",
      },
      {
        q: "Was passiert mit meinen Daten?",
        a: "Ihre Angaben werden ausschließlich zur Bearbeitung Ihrer Anfrage verwendet. Details finden Sie in der Datenschutzerklärung.",
      },
    ],
  },

  finalCta: {
    title: "Bereit für planbares Wachstum?",
    text: "Beantworten Sie fünf kurze Fragen und sichern Sie sich ein kostenloses Erstgespräch.",
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
  erstgespraech: {
    id: "erstgespraech",
    pipelineId: "vertrieb",
    title: "Kostenloses Erstgespräch",
    intro: "Fünf kurze Fragen, damit wir das Gespräch optimal vorbereiten können.",
    threshold: 7,
    stageQualified: "qualifiziert",
    stageNotQualified: "neu",
    showBooking: true,
    questions: [
      {
        id: "branche",
        title: "Was beschreibt Ihr Unternehmen am besten?",
        options: [
          { id: "it", label: "IT-Dienstleister / Systemhaus", points: 3 },
          { id: "saas", label: "Software / SaaS", points: 3 },
          { id: "agentur", label: "Agentur / Beratung", points: 2 },
          { id: "andere", label: "Andere Branche", points: 0 },
        ],
      },
      {
        id: "groesse",
        title: "Wie viele Mitarbeitende hat Ihr Unternehmen?",
        options: [
          { id: "1", label: "Nur ich", points: 0, disqualify: true },
          { id: "2-4", label: "2–4", points: 1 },
          { id: "5-20", label: "5–20", points: 3 },
          { id: "21-100", label: "21–100", points: 3 },
          { id: "100+", label: "Mehr als 100", points: 1 },
        ],
      },
      {
        id: "akquise",
        title: "Woher kommen Ihre Neukunden heute hauptsächlich?",
        options: [
          { id: "empfehlung", label: "Fast nur Empfehlungen", points: 3 },
          { id: "mix", label: "Mix aus Empfehlungen und eigenem Vertrieb", points: 2 },
          { id: "vertrieb", label: "Eigenes Vertriebsteam", points: 1 },
          { id: "keine", label: "Bisher kaum Neukunden", points: 1 },
        ],
      },
      {
        id: "timing",
        title: "Wann möchten Sie das Thema angehen?",
        options: [
          { id: "sofort", label: "Sofort", points: 3 },
          { id: "quartal", label: "In den nächsten 3 Monaten", points: 2 },
          { id: "spaeter", label: "Später / nur informieren", points: 0 },
        ],
      },
      {
        id: "budget",
        title: "Ist ein Budget für Vertrieb und Marketing vorgesehen?",
        hint: "Hilft uns, realistische Vorschläge zu machen.",
        options: [
          { id: "ja", label: "Ja, Budget ist eingeplant", points: 3 },
          { id: "klaeren", label: "Muss noch geklärt werden", points: 1 },
          { id: "nein", label: "Nein", points: 0, disqualify: true },
        ],
      },
    ],
    contactFields: [
      { id: "name", label: "Vor- und Nachname", type: "text", required: true },
      { id: "email", label: "Geschäftliche E-Mail", type: "email", required: true },
      { id: "company", label: "Unternehmen", type: "text", required: true },
      { id: "phone", label: "Telefon", type: "tel", required: false },
    ],
    outcome: {
      qualified: {
        title: "Passt! Wählen Sie jetzt Ihren Termin.",
        text: "Basierend auf Ihren Angaben können wir Ihnen im Erstgespräch konkret weiterhelfen.",
      },
      notQualified: {
        title: "Danke für Ihre Angaben!",
        text: "Aktuell passt unser Angebot vermutlich noch nicht optimal zu Ihrer Situation. Wir sehen uns Ihre Anfrage trotzdem an und melden uns, falls wir helfen können.",
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

export function getFunnel(id: string): Funnel | undefined {
  return Object.hasOwn(funnels, id) ? funnels[id] : undefined;
}

export function getPipeline(id: string): Pipeline | undefined {
  return Object.hasOwn(pipelines, id) ? pipelines[id] : undefined;
}
