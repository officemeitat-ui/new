// Betriebsprofil für die KI-Mitarbeiter (Telefon- und E-Mail-Assistent).
// Pro Kunde wird diese Datei ausgefüllt: Was der Assistent über den Betrieb weiß, wann Termine möglich sind
// und wie er auftritt. Die Inhalte unten beschreiben einen erfundenen Vorführbetrieb.

export type Weekday = "mo" | "di" | "mi" | "do" | "fr" | "sa" | "so";

/** Öffnungszeiten als Zeitfenster im Format "HH:MM", z. B. [["08:00", "12:00"], ["13:00", "17:00"]]. */
export type OpeningHours = Record<Weekday, [string, string][]>;

export type Service = {
  id: string;
  name: string;
  durationMinutes: number;
  /** Was der Assistent über die Leistung sagen darf (Ablauf, Preisrahmen, Mitzubringendes). */
  info: string;
};

export type BusinessProfile = {
  name: string;
  industry: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** Ländervorwahl ohne „+“, um lokale Telefonnummern zu vereinheitlichen. */
  countryCode: string;
  timeZone: string;
  openingHours: OpeningHours;
  /** Geschlossene Tage (Feiertage, Betriebsurlaub) im Format YYYY-MM-DD. */
  closedDates: string[];
  services: Service[];
  booking: {
    /** Raster, in dem Termine angeboten werden. */
    slotStepMinutes: number;
    /** Wie viele Termine gleichzeitig möglich sind (z. B. Anzahl Hebebühnen oder Mitarbeitende). */
    capacity: number;
    /** Frühester Termin: so viele Stunden ab jetzt. */
    minLeadHours: number;
    /** Spätester Termin: so viele Tage im Voraus. */
    maxDaysAhead: number;
    /**
     * Wie Einträge im externen Kalender (Google/Microsoft) zählen: „alles“ = blockieren den Zeitraum komplett
     * (z. B. Urlaub, Zahnarzt), „ein_platz“ = belegen nur einen von mehreren Plätzen (wenn pro Platz ein Eintrag geführt wird).
     */
    externalEvents: "alles" | "ein_platz";
  };
  faq: { q: string; a: string }[];
  assistant: {
    /** Vorname, mit dem sich der Assistent vorstellt. */
    name: string;
    /** Telefonnummer (E.164), an die bei Bedarf weiterverbunden wird; leer = keine Weiterleitung. */
    transferNumber: string;
    /** Zusätzliche Hinweise zu Tonfall und Grenzen. */
    instructions: string;
  };
  emailAssistant: {
    /** „entwurf“: alle Antworten warten auf Freigabe. „autonom“: Kategorien aus autoSendCategories gehen direkt raus. */
    mode: "entwurf" | "autonom";
    autoSendCategories: string[];
    signature: string;
  };
  /** Nachrichten an Kunden rund um gebuchte Termine (rein organisatorisch, keine Werbung). */
  reminders: {
    /** Bestätigung direkt nach der Buchung senden. */
    confirmation: boolean;
    /** Erinnerung so viele Stunden vor dem Termin; 0 = keine Erinnerung. */
    hoursBefore: number;
    /** Nur in diesem Zeitfenster (volle Stunden, Ortszeit) versenden, z. B. [8, 20]. */
    sendBetween: [number, number];
    /** Kanäle in bevorzugter Reihenfolge; SMS nur an Mobilnummern. */
    channels: ("sms" | "email")[];
  };
  /** Nachfass-Assistent: erinnert per E-Mail an offene Anfragen. Entwürfe gehen immer zur Freigabe, nie automatisch raus. */
  followUp: {
    enabled: boolean;
    /** Nach so vielen Tagen ohne Reaktion auf unsere Antwort nachfassen. */
    afterDays: number;
    /** Ältere Verläufe nicht mehr aufgreifen. */
    maxAgeDays: number;
    /** Nur bei diesen Arten von Anfragen (Kategorien des E-Mail-Assistenten). */
    categories: string[];
  };
  /** Annahmen für die geschätzte Zeitersparnis im Cockpit (Minuten, die ein Mensch pro Vorgang bräuchte). */
  impact: { minutesPerCall: number; minutesPerEmail: number; minutesPerAppointment: number };
  placeholder: boolean;
};

export const business: BusinessProfile = {
  name: "Autowerkstatt Muster",
  industry: "Kfz-Werkstatt (alle Marken)",
  address: "Musterstraße 12, 1210 Wien",
  phone: "+43 1 234 56 78",
  email: "office@autowerkstatt-muster.example",
  website: "https://autowerkstatt-muster.example",
  countryCode: "43",
  timeZone: "Europe/Vienna",
  openingHours: {
    mo: [
      ["07:30", "12:00"],
      ["13:00", "17:00"],
    ],
    di: [
      ["07:30", "12:00"],
      ["13:00", "17:00"],
    ],
    mi: [
      ["07:30", "12:00"],
      ["13:00", "17:00"],
    ],
    do: [
      ["07:30", "12:00"],
      ["13:00", "17:00"],
    ],
    fr: [["07:30", "13:00"]],
    sa: [],
    so: [],
  },
  closedDates: ["2026-12-08", "2026-12-24", "2026-12-25", "2026-12-26", "2026-12-31", "2027-01-01", "2027-01-06"],
  services: [
    {
      id: "pickerl",
      name: "§57a-Überprüfung (Pickerl)",
      durationMinutes: 60,
      info: "Begutachtung nach § 57a KFG. Bitte Zulassungsschein mitbringen. Preis laut Tarif, bei Mängeln Kostenvoranschlag vor Reparatur.",
    },
    {
      id: "service",
      name: "Jahresservice",
      durationMinutes: 120,
      info: "Service nach Herstellervorgabe inkl. Ölwechsel. Preis je nach Modell, Richtwert auf Anfrage. Das Serviceheft bitte mitbringen.",
    },
    {
      id: "reifen",
      name: "Reifenwechsel",
      durationMinutes: 30,
      info: "Räderwechsel inkl. Wuchten. Einlagerung möglich.",
    },
    {
      id: "diagnose",
      name: "Fehlerdiagnose",
      durationMinutes: 60,
      info: "Auslesen des Fehlerspeichers und Erstbefund. Bei Warnleuchten bitte den Hinweis im Display notieren.",
    },
  ],
  booking: { slotStepMinutes: 30, capacity: 2, minLeadHours: 2, maxDaysAhead: 30, externalEvents: "alles" },
  faq: [
    { q: "Gibt es ein Ersatzauto?", a: "Ja, nach Verfügbarkeit gegen eine kleine Gebühr. Bitte bei der Terminbuchung erwähnen." },
    { q: "Welche Marken?", a: "Alle Marken, Pkw und leichte Nutzfahrzeuge bis 3,5 Tonnen." },
    { q: "Zahlungsarten?", a: "Bar, Bankomat- und Kreditkarte." },
    {
      q: "Abschleppdienst?",
      a: "Wir organisieren einen Partner-Abschleppdienst. Bei Pannen bitte direkt während der Öffnungszeiten anrufen.",
    },
  ],
  assistant: {
    name: "Lena",
    transferNumber: "",
    instructions: "Keine verbindlichen Preise oder Diagnosen nennen. Bei Unfällen, Reklamationen oder Beschwerden einen Rückruf notieren.",
  },
  emailAssistant: {
    mode: "entwurf",
    autoSendCategories: ["terminanfrage", "allgemeine_frage"],
    signature: "Mit freundlichen Grüßen\nIhr Team der Autowerkstatt Muster\n+43 1 234 56 78",
  },
  reminders: { confirmation: true, hoursBefore: 24, sendBetween: [8, 20], channels: ["sms", "email"] },
  followUp: { enabled: true, afterDays: 3, maxAgeDays: 21, categories: ["terminanfrage", "angebotsanfrage"] },
  impact: { minutesPerCall: 4, minutesPerEmail: 6, minutesPerAppointment: 3 },
  placeholder: true,
};

export function getService(id: string): Service | undefined {
  return business.services.find((s) => s.id === id);
}
