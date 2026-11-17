// Feldvorlagen für die Kunden-Dokumentation (wie „Asset Layouts“ in Hudu bzw. IT Glue).
// Eigene Felder oder ganze Bereiche lassen sich hier ergänzen – Formular, Liste, Suche und Fristen passen sich an.
// Passwörter, Lizenzschlüssel und PINs gehören NICHT hierher, sondern in Keeper.

export type FieldType = "text" | "textarea" | "email" | "phone" | "url" | "date" | "number" | "select" | "boolean";

export type RecordField = {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  placeholder?: string;
  required?: boolean;
  /** über die ganze Breite (lange Texte) */
  wide?: boolean;
  /** in der Liste als Spalte zeigen */
  list?: boolean;
};

export type RecordLayout = {
  kind: string;
  label: string;
  plural: string;
  /** kurzer Hinweis über der Liste */
  hint: string;
  titleField: string;
  fields: RecordField[];
  /** Frist für Erinnerungen (z. B. Ablauf, Kündigung, nächster Wiederherstellungstest) */
  due?: { label: string; compute: (data: Record<string, string>) => string | null };
  /** Feld, das automatisch geprüft wird (Domain) */
  checkField?: string;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const date = (value: string | undefined) => (value && ISO.test(value) ? value : null);

function shiftMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** „3 Monate“, „6 Wochen“, „30 Tage“ → Tage (ungefähr); sonst null. */
export function noticeDays(text: string | undefined): number | null {
  const match = text?.match(/(\d+)\s*(monat|woche|tag)/i);
  if (!match) return null;
  const n = Number(match[1]);
  return /monat/i.test(match[2]) ? n * 30 : /woche/i.test(match[2]) ? n * 7 : n;
}

/** Spätester Kündigungstermin: Ende minus Kündigungsfrist (sonst das Ende selbst). */
function cancelBy(end: string | null, notice: string | undefined): string | null {
  if (!end) return null;
  const days = noticeDays(notice);
  if (!days) return end;
  const d = new Date(`${end}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const notes: RecordField = {
  key: "notizen",
  label: "Notizen",
  type: "textarea",
  wide: true,
  placeholder: "Keine Passwörter – die liegen in Keeper",
};

export const RECORD_LAYOUTS: RecordLayout[] = [
  {
    kind: "kontakt",
    label: "Ansprechpartner",
    plural: "Ansprechpartner",
    hint: "Wer entscheidet, wer ist IT-Ansprechpartner, wer darf Änderungen freigeben?",
    titleField: "name",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, list: true },
      {
        key: "rolle",
        label: "Rolle",
        type: "select",
        options: ["Geschäftsführung", "IT-Ansprechpartner", "Buchhaltung", "Assistenz / Empfang", "Mitarbeiter/in", "Extern"],
        list: true,
      },
      { key: "telefon", label: "Telefon", type: "phone", list: true },
      { key: "mobil", label: "Mobil", type: "phone" },
      { key: "email", label: "E-Mail", type: "email", list: true },
      { key: "standort", label: "Standort", type: "text" },
      { key: "freigabe", label: "Darf Aufträge und Änderungen freigeben", type: "boolean" },
      { key: "vip", label: "VIP (bevorzugt behandeln)", type: "boolean" },
      notes,
    ],
  },
  {
    kind: "standort",
    label: "Standort",
    plural: "Standorte",
    hint: "Adresse, Zutritt und was man vor Ort wissen muss.",
    titleField: "name",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, list: true, placeholder: "z. B. Zentrale Linz" },
      { key: "adresse", label: "Adresse", type: "text", required: true, list: true },
      { key: "oeffnungszeiten", label: "Öffnungszeiten", type: "text" },
      { key: "technikraum", label: "Technikraum / Serverschrank", type: "text", placeholder: "z. B. Keller, Raum -1.04" },
      {
        key: "zutritt",
        label: "Zutritt",
        type: "textarea",
        wide: true,
        placeholder: "Schlüssel, Alarmanlage (Codes in Keeper), Anmeldung beim Empfang",
      },
      { key: "parken", label: "Parken", type: "text" },
      notes,
    ],
  },
  {
    kind: "geraet",
    label: "Gerät",
    plural: "Inventar",
    hint: "Alle Geräte mit Seriennummer, Benutzer und Garantie – die Garantie wird überwacht.",
    titleField: "name",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, list: true, placeholder: "z. B. PC-EMPFANG-01" },
      {
        key: "art",
        label: "Art",
        type: "select",
        options: [
          "PC",
          "Notebook",
          "Server",
          "Firewall",
          "Switch",
          "Access Point",
          "Drucker",
          "NAS",
          "USV",
          "Telefon",
          "Handy / Tablet",
          "Monitor",
          "Sonstiges",
        ],
        list: true,
      },
      { key: "hersteller", label: "Hersteller", type: "text", list: true },
      { key: "modell", label: "Modell", type: "text", list: true },
      { key: "seriennummer", label: "Seriennummer", type: "text" },
      { key: "inventarnummer", label: "Inventarnummer", type: "text" },
      { key: "benutzer", label: "Benutzer/in", type: "text", list: true },
      { key: "standort", label: "Standort", type: "text" },
      { key: "betriebssystem", label: "Betriebssystem", type: "text", placeholder: "z. B. Windows 11 Pro 24H2" },
      { key: "ip", label: "IP-Adresse", type: "text" },
      { key: "mac", label: "MAC-Adresse", type: "text" },
      { key: "gekauft", label: "Gekauft am", type: "date" },
      { key: "lieferant", label: "Lieferant", type: "text", placeholder: "z. B. Wortmann, TD SYNNEX" },
      { key: "garantie", label: "Garantie bis", type: "date", list: true },
      { key: "status", label: "Status", type: "select", options: ["in Betrieb", "Lager", "Reparatur", "ausgemustert"] },
      notes,
    ],
    due: { label: "Garantie endet", compute: (d) => (d.status === "ausgemustert" ? null : date(d.garantie)) },
  },
  {
    kind: "wlan",
    label: "WLAN",
    plural: "WLAN",
    hint: "Funknetze mit VLAN und Verschlüsselung. Das Kennwort liegt in Keeper.",
    titleField: "ssid",
    fields: [
      { key: "ssid", label: "SSID", type: "text", required: true, list: true },
      { key: "vlan", label: "VLAN / Netz", type: "text", list: true, placeholder: "z. B. 20 Clients" },
      {
        key: "sicherheit",
        label: "Verschlüsselung",
        type: "select",
        options: ["WPA3", "WPA2/WPA3", "WPA2", "WPA2/WPA3 Enterprise (RADIUS)", "offen (Portal)"],
        list: true,
      },
      { key: "gast", label: "Gastnetz (vom Firmennetz getrennt)", type: "boolean" },
      { key: "access_points", label: "Access Points", type: "text", placeholder: "z. B. AP-Büro, AP-Lager" },
      { key: "kennwort_ort", label: "Kennwort liegt in", type: "text", placeholder: "Keeper › Huber › WLAN" },
      notes,
    ],
  },
  {
    kind: "domain",
    label: "Domain",
    plural: "Domains & E-Mail",
    hint: "Domains werden täglich geprüft: SPF, DMARC, DKIM, Mailserver und das Zertifikat der Website.",
    titleField: "domain",
    checkField: "domain",
    fields: [
      { key: "domain", label: "Domain", type: "text", required: true, list: true, placeholder: "huber-stb.at" },
      { key: "registrar", label: "Registrar", type: "text", list: true, placeholder: "z. B. World4You, easyname" },
      { key: "dns", label: "DNS bei", type: "text" },
      {
        key: "mail",
        label: "E-Mail bei",
        type: "select",
        options: ["Microsoft 365", "Google Workspace", "eigener Server", "Hoster", "keine"],
        list: true,
      },
      { key: "website", label: "Website bei", type: "text" },
      { key: "ablauf", label: "Bezahlt bis", type: "date" },
      notes,
    ],
    due: { label: "Domain läuft ab", compute: (d) => date(d.ablauf) },
  },
  {
    kind: "m365",
    label: "Microsoft-365-Mandant",
    plural: "Microsoft 365",
    hint: "Mandant, Lizenzen und Sicherheitsstand – die Basis für den M365-Check.",
    titleField: "mandant",
    fields: [
      { key: "mandant", label: "Mandant", type: "text", required: true, list: true, placeholder: "huberstb.onmicrosoft.com" },
      { key: "mandant_id", label: "Mandanten-ID", type: "text" },
      { key: "lizenzen", label: "Lizenzen", type: "text", list: true, placeholder: "z. B. 12× Business Premium" },
      { key: "mfa", label: "MFA", type: "select", options: ["alle Konten", "teilweise", "keine"], list: true },
      { key: "conditional_access", label: "Conditional Access aktiv", type: "boolean" },
      { key: "legacy_auth", label: "Legacy-Authentifizierung blockiert", type: "boolean" },
      { key: "notfallkonto", label: "Notfallkonto (Break-Glass) vorhanden", type: "boolean" },
      { key: "gdap", label: "Partnerzugriff (GDAP) eingerichtet", type: "boolean" },
      { key: "backup", label: "M365 wird gesichert", type: "boolean" },
      notes,
    ],
  },
  {
    kind: "lizenz",
    label: "Lizenz",
    plural: "Lizenzen",
    hint: "Abos und Wartungen – rechtzeitig verlängern statt Ausfall. Lizenzschlüssel in Keeper.",
    titleField: "produkt",
    fields: [
      { key: "produkt", label: "Produkt", type: "text", required: true, list: true, placeholder: "z. B. Securepoint UTM Lizenz" },
      { key: "hersteller", label: "Hersteller", type: "text" },
      {
        key: "art",
        label: "Art",
        type: "select",
        options: ["Abo jährlich", "Abo monatlich", "Wartung / Software Assurance", "Kauf (unbefristet)"],
        list: true,
      },
      { key: "anzahl", label: "Anzahl", type: "number", list: true },
      { key: "bezug", label: "Bezogen über", type: "text", placeholder: "z. B. Securepoint Partnerportal, Pax8" },
      { key: "ablauf", label: "Läuft ab", type: "date", list: true },
      { key: "kosten", label: "Kosten pro Jahr (€)", type: "number" },
      { key: "automatisch", label: "Verlängert sich automatisch", type: "boolean" },
      notes,
    ],
    due: { label: "Lizenz läuft ab", compute: (d) => date(d.ablauf) },
  },
  {
    kind: "vertrag",
    label: "Vertrag",
    plural: "Verträge",
    hint: "Wartung, Internet, Telefonie, Leasing – mit Kündigungsfrist. Erinnert wird vor dem letzten Kündigungstag.",
    titleField: "titel",
    fields: [
      { key: "titel", label: "Titel", type: "text", required: true, list: true },
      {
        key: "art",
        label: "Art",
        type: "select",
        options: ["Wartungsvertrag", "Managed Service", "Internet / Provider", "Telefonie", "Leasing", "Hosting", "Software", "Sonstiges"],
        list: true,
      },
      { key: "partner", label: "Vertragspartner", type: "text", list: true },
      { key: "vertragsnummer", label: "Vertrags-/Kundennummer", type: "text" },
      { key: "beginn", label: "Beginn", type: "date" },
      { key: "ende", label: "Ende / nächste Verlängerung", type: "date", list: true },
      { key: "kuendigungsfrist", label: "Kündigungsfrist", type: "text", placeholder: "z. B. 3 Monate" },
      { key: "betrag", label: "Betrag pro Monat (€)", type: "number" },
      { key: "sla", label: "Reaktionszeit / SLA", type: "text" },
      notes,
    ],
    due: { label: "Kündigen bis", compute: (d) => cancelBy(date(d.ende), d.kuendigungsfrist) },
  },
  {
    kind: "anwendung",
    label: "Anwendung",
    plural: "Anwendungen",
    hint: "Branchensoftware und Dienste – mit Support-Kontakt des Herstellers.",
    titleField: "name",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, list: true, placeholder: "z. B. BMD NTCS" },
      { key: "hersteller", label: "Hersteller", type: "text", list: true },
      { key: "version", label: "Version", type: "text", list: true },
      { key: "einsatz", label: "Wofür", type: "text" },
      { key: "server", label: "Läuft auf", type: "text", placeholder: "z. B. SRV-APP01, Cloud" },
      { key: "support", label: "Support (Hersteller)", type: "text", placeholder: "Telefon, Portal" },
      { key: "updates", label: "Updates", type: "text", placeholder: "z. B. quartalsweise durch Hersteller" },
      notes,
    ],
  },
  {
    kind: "backup",
    label: "Datensicherung",
    plural: "Backup",
    hint: "Was wird wohin gesichert – und wann wurde zuletzt eine Wiederherstellung getestet? Fällig alle 6 Monate.",
    titleField: "name",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, list: true, placeholder: "z. B. Server täglich" },
      { key: "software", label: "Software", type: "text", list: true, placeholder: "z. B. Veeam B&R, Synology Hyper Backup" },
      { key: "quelle", label: "Was", type: "text" },
      { key: "ziel", label: "Wohin", type: "text", list: true },
      { key: "zeitplan", label: "Zeitplan", type: "text" },
      { key: "aufbewahrung", label: "Aufbewahrung", type: "text" },
      { key: "offline", label: "Offline- bzw. unveränderliche Kopie", type: "boolean" },
      { key: "letzter_test", label: "Letzter Wiederherstellungstest", type: "date", list: true },
      notes,
    ],
    due: {
      label: "Wiederherstellung testen",
      compute: (d) => (date(d.letzter_test) ? shiftMonths(d.letzter_test, 6) : null),
    },
  },
];

export const findLayout = (kind: string) => RECORD_LAYOUTS.find((l) => l.kind === kind) ?? null;
