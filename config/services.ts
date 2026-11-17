// Leistungskatalog, Pakete und SLA-Zusagen – übernommen aus dem ME-IT Cockpit.
// Preise sind Beispielwerte (netto, EUR). Beim ersten Start landen sie in der Datenbank und lassen sich unter
// „Leistungen & Preise“ anpassen; spätere Änderungen hier betreffen nur neue Leistungen.

export type ServiceDefault = {
  code: string;
  name: string;
  description: string;
  unit: string;
  price: number;
  recurring: boolean;
  keywords: string;
};

export const DEFAULT_SERVICES: ServiceDefault[] = [
  {
    code: "MW",
    name: "Managed Workplace",
    description: "Support-Flatrate, Wartung, Patch-Management und Monitoring je Benutzer",
    unit: "User/Monat",
    price: 39,
    recurring: true,
    keywords: "arbeitsplatz pc support wartung managed flatrate benutzer helpdesk",
  },
  {
    code: "MS",
    name: "Managed Server",
    description: "Überwachung, Updates und Betreuung je Server (physisch/virtuell)",
    unit: "Server/Monat",
    price: 149,
    recurring: true,
    keywords: "server wartung hyper-v vmware ueberwachung",
  },
  {
    code: "MON",
    name: "Monitoring & Patch-Management",
    description: "Proaktive Überwachung und automatische Updates je Gerät",
    unit: "Gerät/Monat",
    price: 6,
    recurring: true,
    keywords: "monitoring patch updates rmm ueberwachung",
  },
  {
    code: "SEC",
    name: "Security-Paket (EDR/MDR, Mail-Security)",
    description: "Endpoint Detection & Response, 24/7-Überwachung, Mailfilter",
    unit: "User/Monat",
    price: 12,
    recurring: true,
    keywords: "virus sicherheit edr mdr antivirus phishing ransomware security malware",
  },
  {
    code: "AWR",
    name: "Security-Awareness-Training",
    description: "Online-Schulungen mit Nachweis, Monatsimpulse, Phishing-Übungen",
    unit: "User/Monat",
    price: 4,
    recurring: true,
    keywords: "schulung phishing awareness mitarbeiter training",
  },
  {
    code: "BCK",
    name: "Backup & Recovery",
    description: "Unveränderbares Offsite-Backup inkl. vierteljährlichem Restore-Test",
    unit: "Monat",
    price: 89,
    recurring: true,
    keywords: "backup sicherung restore datenverlust wiederherstellung nas",
  },
  {
    code: "M365B",
    name: "Microsoft-365-Backup",
    description: "Sicherung von Exchange Online, OneDrive, SharePoint und Teams",
    unit: "User/Monat",
    price: 3,
    recurring: true,
    keywords: "m365 backup onedrive sharepoint exchange sicherung",
  },
  {
    code: "MFW",
    name: "Managed Firewall",
    description: "Next-Gen-Firewall inkl. VPN, Updates und Überwachung",
    unit: "Monat",
    price: 59,
    recurring: true,
    keywords: "firewall vpn netzwerk router sicherheit",
  },
  {
    code: "NIS2GAP",
    name: "NIS2/NISG-2026 Gap-Analyse",
    description: "Betroffenheitsprüfung, Ist-Analyse, Maßnahmenplan, Registrierung",
    unit: "Pauschal",
    price: 1900,
    recurring: false,
    keywords: "nis2 nisg compliance audit risiko registrierung gesetz",
  },
  {
    code: "VCISO",
    name: "Informationssicherheit as a Service (vCISO)",
    description: "Laufende ISMS-Betreuung, Richtlinien, Nachweise, Meldeprozesse",
    unit: "Monat",
    price: 490,
    recurring: true,
    keywords: "nis2 isms iso 27001 sicherheitsbeauftragter richtlinie compliance",
  },
  {
    code: "WIN11",
    name: "Windows-11-Migration",
    description: "Upgrade bzw. Neuinstallation inkl. Datenübernahme je Gerät",
    unit: "Gerät",
    price: 180,
    recurring: false,
    keywords: "windows 10 windows 11 migration upgrade esu",
  },
  {
    code: "NEWPC",
    name: "Neugerät einrichten",
    description: "Beschaffung, Image, Software, Datenübernahme und Übergabe je Gerät",
    unit: "Gerät",
    price: 150,
    recurring: false,
    keywords: "neuer pc laptop notebook hardware tausch austausch rechner",
  },
  {
    code: "SRVMOD",
    name: "Server-Modernisierung (Cloud/Hybrid)",
    description: "Ablöse veralteter Server (z. B. Windows Server 2016, Exchange)",
    unit: "Pauschal",
    price: 3500,
    recurring: false,
    keywords: "server migration cloud azure exchange hybrid ablöse modernisierung",
  },
  {
    code: "M365MIG",
    name: "Microsoft-365-Einführung",
    description: "Migration E-Mail/Dateien, Teams, Intune-Basis je Benutzer",
    unit: "User",
    price: 95,
    recurring: false,
    keywords: "m365 office 365 exchange teams sharepoint email migration intune",
  },
  {
    code: "NET",
    name: "Netzwerk/WLAN-Modernisierung",
    description: "Planung und Umsetzung Switches, Access Points, VLANs",
    unit: "Pauschal",
    price: 2400,
    recurring: false,
    keywords: "wlan wifi netzwerk switch access point vlan langsam",
  },
  {
    code: "MAILSEC",
    name: "E-Mail-Absicherung (SPF, DKIM, DMARC)",
    description: "Einrichtung und Überwachung von SPF, DKIM und DMARC bis p=reject",
    unit: "Domain",
    price: 290,
    recurring: false,
    keywords: "spf dkim dmarc mail sicherheit domain spoofing",
  },
  {
    code: "KIWS",
    name: "KI-Workshop & AI-Act-Kompetenzschulung",
    description: "Halbtag: sichere KI-Nutzung, Richtlinie, Use-Cases (Art. 4 AI Act)",
    unit: "Pauschal",
    price: 1200,
    recurring: false,
    keywords: "ki ai chatgpt copilot schulung ai act workshop kuenstliche intelligenz",
  },
  {
    code: "KIBOX",
    name: "Private KI-Box – Einrichtung",
    description: "Lokaler KI-Server (DSGVO-konform) mit Dokumentensuche, ohne Cloud",
    unit: "Pauschal",
    price: 4900,
    recurring: false,
    keywords: "ki lokal offline dsgvo ki-server chatbot dokumente datenschutz private",
  },
  {
    code: "KIBOXM",
    name: "Private KI-Box – Betreuung",
    description: "Updates, neue Modelle, Monitoring und Support der KI-Box",
    unit: "Monat",
    price: 149,
    recurring: true,
    keywords: "ki box betreuung wartung modell",
  },
  {
    code: "KIAGENT",
    name: "KI-Agenten-Automatisierung",
    description: "Analyse und Automatisierung eines Geschäftsprozesses mit KI-Agenten",
    unit: "Pauschal",
    price: 2900,
    recurring: false,
    keywords: "automatisierung agent workflow prozess ki effizienz",
  },
  {
    code: "KIMA-POT",
    name: "KI-Mitarbeiter Potenzialanalyse",
    description: "Vor Ort: Abläufe aufnehmen, Einsparpotenzial und ROI berechnen (wird bei Beauftragung angerechnet)",
    unit: "Pauschal",
    price: 490,
    recurring: false,
    keywords: "ki mitarbeiter potenzialanalyse automatisierung prozesse workshop roi",
  },
  {
    code: "KIMA",
    name: "KI-Mitarbeiter Einrichtung",
    description: "Individueller KI-Mitarbeiter: Posteingang sortieren, Anfragen ins CRM, Antwortentwürfe, Belege, Nachfassen",
    unit: "Pauschal",
    price: 3900,
    recurring: false,
    keywords: "ki mitarbeiter assistent automatisierung email posteingang anfragen crm belege kundenanfragen",
  },
  {
    code: "KIMAM",
    name: "KI-Mitarbeiter Betrieb & Optimierung",
    description: "Monitoring, Anpassungen, neue Abläufe, monatlicher Wirkungsbericht",
    unit: "Monat",
    price: 249,
    recurring: true,
    keywords: "ki mitarbeiter betrieb wartung optimierung",
  },
  {
    code: "STD",
    name: "Technikerstunde",
    description: "Arbeitszeit vor Ort oder remote",
    unit: "Stunde",
    price: 110,
    recurring: false,
    keywords: "stunde techniker vor ort remote einsatz",
  },
];

export type PackageId = "keins" | "basis" | "pro" | "premium";
export const PACKAGES: Record<PackageId, string> = { keins: "kein Vertrag (auf Zuruf)", basis: "Basis", pro: "Pro", premium: "Premium" };

export const INDUSTRIES = [
  "Steuerberatung",
  "Rechtsanwalt / Notar",
  "Gesundheit / Ordination",
  "Handwerk",
  "Handel",
  "Gastronomie / Tourismus",
  "Industrie / Maschinenbau",
  "Logistik / Transport",
  "Immobilien",
  "Dienstleistung",
  "Öffentlicher Bereich",
  "Sonstiges",
];

export type SlaPriority = "kritisch" | "hoch" | "normal" | "niedrig";

/** SLA-Zusagen in Geschäftsstunden: [Reaktion, Lösung] je Paket und Priorität; null = keine Zusage. */
export const SLA = {
  businessHours: { start: 8, end: 17, days: [1, 2, 3, 4, 5] as number[] },
  packages: {
    premium: { kritisch: [1, 4], hoch: [2, 8], normal: [4, 16], niedrig: [8, 40] },
    pro: { kritisch: [2, 8], hoch: [4, 16], normal: [8, 24], niedrig: [16, 72] },
    basis: { kritisch: [4, 16], hoch: [8, 24], normal: [16, 40], niedrig: [24, 80] },
    keins: { kritisch: [8, null], hoch: [16, null], normal: [null, null], niedrig: [null, null] },
  } as Record<PackageId, Record<SlaPriority, [number | null, number | null]>>,
};
