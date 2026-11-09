// Verbindet die App-Daten mit einer Ablage (Browser oder SharePoint).
//
// Aufteilung in Dateien, damit mehrere Personen gleichzeitig arbeiten können
// und jede Datei klein und lesbar bleibt. Ein Ordner je Berechtigung:
//   objekte/objekte.json              Objekte (Name, Adresse, Revier) – alle Gruppen lesen
//   daten/stammdaten.json             Mitarbeitende, Leistungen, Regeln (ohne Lohn)
//   plaene/2026/2026-10-26.json       Einteilungen einer Woche + Änderungsprotokoll
//   personal/abwesenheiten.json       Urlaub, Krankenstand, … (Gesundheitsdaten)
//   lohn/zeitkonto.json               veröffentlichte Wochen mit Salden, Löhne, Monatsabschlüsse
//   fahrzeuge/fahrzeuge.json          Fahrzeuge, Reifen, Service, Pickerl
//   reklamationen/reklamationen.json  Reklamationen je Objekt
//   kalkulation/kalkulation.json      Objektkalkulation (Flächen, Leistungswerte, Zuschläge)
//   material/material.json            Material & Lager (Artikel, Buchungen, Bestellungen, Anforderungen)
//   schluessel/schluessel.json        Schlüsselbuch (Schlüssel je Objekt, Ausgabe, Rückgabe, Verlust)
//   nachweise/versand.json            Leistungsnachweis: Einstellungen und Versand-Vermerke
//   unterweisungen/unterweisungen.json  Unterweisungen & Fristen je Person
//   anlagen/anlagen.json              Anlagen & Prüffristen je Objekt (Fotos und Prüfberichte unter anlagen/nachweise/)
//   regie/regie.json                  Regieberichte (Sonderleistungen mit Unterschrift; Fotos und PDF unter regie/nachweise/)
//   qualitaet/qualitaet.json          Qualitätsmessung je Objekt (Fotos und Berichte unter qualitaet/nachweise/)
//   arbeitsschutz/arbeitsschutz.json  Arbeitsschutz: Betriebsanweisungen, Evaluierung (PDFs und Sicherheitsdatenblätter
//                                     unter arbeitsschutz/dokumente/; die Angaben zu Arbeitsstoffen stehen am Artikel)
//   zufriedenheit/zufriedenheit.json  Kundenzufriedenheit: Umfrage-Runden, Antworten aus dem Kundenbereich, Einstellungen
//   termine/termine.json              Termine (mit Outlook-Termin der anlegenden Person)
//   assistenz/entscheidungen.json     Digitale Mitarbeiter: Vorschläge später/abgelehnt/erledigt
//   fakturierung/fakturierung.json    Fakturierung (Kunden, Artikel, Angebote, Rechnungen, Daueraufträge)
//   einkauf/einkauf.json              Einkauf: Lieferanten, Eingangsrechnungen, Zahlungen (Belege unter einkauf/belege/)
//   einkauf/kassenbuch.json           Kassenbuch (Einträge, Kassenstürze, Monatsabschlüsse)
//   kundenbereich/kundenbereich.json  Kundenbereich: Links für Kunden und Angebote (mit Code), Einstellungen
//   bewerbung/bewerbung.json          Bewerbungen (Unterlagen unter bewerbung/unterlagen/) – eng: Personalverwaltung
//   eintritt/eintritt.json            Eintritts- und Austritts-Checklisten, Vorlagen
//   matten/matten.json                Mattenwechsel-Modul: Liegeplätze je Kunde → Objekt, Gebiete, Einstellungen
//                                     (Büro; Betriebshof, Fahrer). Touren je Datei unter matten/touren/<Jahr>/<TourId>.json
//                                     – nicht über den DataService, sondern storage/matten-touren.js (Büro und Fahrer);
//                                     Fotos unter matten/fotos/<Jahr>/<Liegeplatz>/
//   matten/einsaetze-2026.json        Mattenwechsel: Einsätze je Liegeplatz und Solltermin, eine Datei je Jahr des
//                                     Solltermins (YEAR_DOCS; wie die Wochenpläne: geladen werden die nötigen Jahre)
//
// Wasserzähler-Ablesung, Objektkontrolle, Objektdoku und Mattenwechsel sind
// eigene Werkzeuge (werkzeuge/): Sie speichern selbst in ihren Ordnern der
// Bibliothek (TOOL_FOLDERS), nicht hier. Das Mattenwechsel-Modul der App
// (matten/) liest den Werkzeug-Ordner Mattenwechsel/ nur bei der Übernahme
// und schreibt dort nur die Sicherung (Mattenwechsel/_Sicherung/<Datum>/).
//
// Rechte: dataRights() sagt je Rolle, welche Dateien die App überhaupt liest
// und schreibt; andere Dateien fragt sie gar nicht erst an. In SharePoint
// bekommt jeder Ordner dieselben Rechte für die passende Microsoft-Gruppe
// (FOLDERS, folderRights). Antwortet SharePoint trotzdem mit 403, bleibt der
// Bereich leer und wird nie gespeichert – die App läuft weiter.
//
// Gespeichert wird automatisch (verzögert), nur geänderte Dateien. Bei einem
// Konflikt werden die Änderungen beider Seiten zusammengeführt (merge.js).
// Ohne Netz (Ablage meldet OfflineError) bleiben die Änderungen im Gerät
// (`local`, siehe offline.js) und werden beim nächsten Start bzw. sobald
// wieder Netz da ist gespeichert.

import { mondayOf, todayISO } from '../core/dates.js'
import { MODULES } from '../core/access.js'
import { emptyAppointments } from '../core/appointments.js'
import { emptyInvoicing } from '../core/invoicing.js'
import { emptyKeys } from '../core/keys.js'
import { emptyMaterial } from '../core/material.js'
import { emptyTrainings } from '../core/trainings.js'
import { mergeDoc } from '../core/merge.js'
import { ConflictError } from './docstore-local.js'
import { isNetworkError } from './offline.js'

export const DOC = {
  master: 'daten/stammdaten.json',
  objects: 'objekte/objekte.json',
  absences: 'personal/abwesenheiten.json',
  // wer wann fehlt – ohne Art und Notiz (Krankenstand ist ein Gesundheitsdatum): für alle, die den Plan sehen
  absent: 'daten/abwesend.json',
  account: 'lohn/zeitkonto.json',
}
/** Frühere Ablage (alles unter daten/): wird beim ersten Speichern in die eigenen Ordner verschoben. */
export const OLD_PATHS = { [DOC.absences]: 'daten/abwesenheiten.json', [DOC.account]: 'daten/zeitkonto.json' }
export const weekPath = (monday) => `plaene/${monday.slice(0, 4)}/${monday}.json`
const isWeekPath = (path) => path.startsWith('plaene/') || path.startsWith('daten/plaene/')
/** Früherer Pfad einer Datei (Umzug), sonst null. */
export const oldPathOf = (path) => OLD_PATHS[path] || (path.startsWith('plaene/') ? `daten/${path}` : null)

/** Dateien der Module: app.data[key] ist der Inhalt der Datei. */
export const MODULE_DOCS = {
  fahrzeuge: { path: 'fahrzeuge/fahrzeuge.json', empty: () => ({ vehicles: [], workshops: [], changes: [], settings: {} }) },
  reklamationen: { path: 'reklamationen/reklamationen.json', empty: () => ({ items: [] }) },
  kalkulation: { path: 'kalkulation/kalkulation.json', empty: () => ({ settings: {}, objects: {} }) },
  material: { path: 'material/material.json', empty: emptyMaterial },
  schluessel: { path: 'schluessel/schluessel.json', empty: emptyKeys },
  nachweise: { path: 'nachweise/versand.json', empty: () => ({ sent: {}, settings: {} }) },
  unterweisungen: { path: 'unterweisungen/unterweisungen.json', empty: emptyTrainings },
  // Anlagen & Prüffristen: leerer Inhalt wie emptyAnlagen (core/anlagen.js; test/anlagen.test.js vergleicht)
  anlagen: { path: 'anlagen/anlagen.json', empty: () => ({ types: [], items: [], checks: [], settings: {} }) },
  // Regieberichte: leerer Inhalt wie emptyRegie (core/regie.js; test/regie.test.js vergleicht)
  regie: { path: 'regie/regie.json', empty: () => ({ reports: [], settings: {} }) },
  // Qualitätsmessung: leerer Inhalt wie emptyQualitaet (core/qualitaet.js; test/qualitaet.test.js vergleicht)
  qualitaet: { path: 'qualitaet/qualitaet.json', empty: () => ({ settings: {}, objects: [], measurements: [] }) },
  // Arbeitsschutz: leerer Inhalt wie emptyArbeitsschutz (core/arbeitsschutz.js; test/arbeitsschutz.test.js vergleicht)
  arbeitsschutz: { path: 'arbeitsschutz/arbeitsschutz.json', empty: () => ({ instructions: [], evaluations: [], settings: {} }) },
  // Kundenzufriedenheit: leerer Inhalt wie emptyZufriedenheit (core/zufriedenheit.js; test/zufriedenheit.test.js vergleicht)
  zufriedenheit: { path: 'zufriedenheit/zufriedenheit.json', empty: () => ({ settings: {}, links: {}, rounds: [], answers: [] }) },
  termine: { path: 'termine/termine.json', empty: emptyAppointments },
  fakturierung: { path: 'fakturierung/fakturierung.json', empty: emptyInvoicing },
  // Einkauf & Kasse: Lieferanten und Eingangsrechnungen; das Kassenbuch in einer eigenen Datei (kleiner, seltener gleichzeitig).
  // Leere Inhalte wie emptyPurchase/emptyCashbook (core/purchase.js, core/cashbook.js; test/storage.test.js vergleicht),
  // hier ausgeschrieben, damit die Rechenkerne nicht in den Start der App wandern
  einkauf: { path: 'einkauf/einkauf.json', empty: () => ({ suppliers: [], invoices: [], bankIgnored: {}, sepaRuns: [], settings: {} }) },
  kasse: { path: 'einkauf/kassenbuch.json', empty: () => ({ entries: [], counts: [], closings: [], settings: {} }) },
  assistenz: { path: 'assistenz/entscheidungen.json', empty: () => ({ decided: {} }) },
  // Berichte automatisch per E-Mail: Abos (Empfänger, Rhythmus, zuletzt gesendet) – nur Vollzugriff
  berichte: { path: 'berichte/abos.json', empty: () => ({ abos: [] }) },
  kundenbereich: { path: 'kundenbereich/kundenbereich.json', empty: () => ({ links: [], settings: {} }) },
  // Bewerbungen und Checklisten: leere Inhalte wie emptyBewerbung/emptyEintritt (core/bewerber.js; test/bewerber.test.js vergleicht)
  bewerbung: { path: 'bewerbung/bewerbung.json', empty: () => ({ applicants: [], settings: {} }) },
  eintritt: { path: 'eintritt/eintritt.json', empty: () => ({ lists: [], templates: {}, settings: {} }) },
  // Mattenwechsel-Modul: leerer Inhalt wie emptyMatten (core/matten.js; test/matten.test.js vergleicht)
  matten: { path: 'matten/matten.json', empty: () => ({ schema: 1, settings: {}, placements: [], areas: [] }) },
}
const MODULE_BY_PATH = Object.fromEntries(Object.entries(MODULE_DOCS).map(([key, m]) => [m.path, { key, ...m }]))

/**
 * Dateien je Jahr (wie die Wochenpläne je Woche, nur nach Jahr): app.data[key] ist die Liste aller geladenen Einträge,
 * yearOf sagt je Eintrag das Jahr und damit die Datei <prefix><Jahr>.json. Beim Start lädt die App das Vorjahr, das
 * laufende und das nächste Jahr (yearsAround), weitere Jahre ensureYears (z. B. beim Blättern im Kalender). Gespeichert,
 * zusammengeführt und offline vorgehalten wird wie jede andere Datei; Einträge tragen eine id (Zusammenführen je Eintrag,
 * merge.js). order: Reihenfolge in der Datei (gleichbleibend, damit unveränderte Jahre nicht neu gespeichert werden).
 */
export const YEAR_DOCS = {
  // Mattenwechsel: Einsätze je Liegeplatz und Solltermin (core/matten-einsaetze.js); ein verschobener Einsatz bleibt in
  // der Datei des Jahres seines Solltermins
  mattenJobs: {
    prefix: 'matten/einsaetze-',
    list: 'jobs',
    yearOf: (x) => String(x?.due || '').slice(0, 4),
    order: (a, b) => String(a.due).localeCompare(String(b.due)) || String(a.key).localeCompare(String(b.key)),
    empty: () => ({ schema: 1, jobs: [] }),
  },
}
export const yearPath = (key, year) => `${YEAR_DOCS[key].prefix}${year}.json`
/** Datei je Jahr: { key, year, …YEAR_DOCS[key] } oder null. */
export function yearDocOf(path) {
  for (const [key, m] of Object.entries(YEAR_DOCS)) {
    const year = path.startsWith(m.prefix) && /^(\d{4})\.json$/.exec(path.slice(m.prefix.length))?.[1]
    if (year) return { key, year, ...m }
  }
  return null
}
/** Jahre, die beim Start geladen werden: Vorjahr (Überfälliges vom Dezember), laufendes und nächstes Jahr. */
export const yearsAround = (today = todayISO()) => [-1, 0, 1].map((d) => String(Number(today.slice(0, 4)) + d))
const startYearPaths = (today) => Object.keys(YEAR_DOCS).flatMap((key) => yearsAround(today).map((y) => yearPath(key, y)))

// ---------------------------------------------------------------- Rechte je Rolle

const any = (list, fn) => list.some(fn)
/**
 * Welche Dateien die App für diese Person liest und schreibt. access: aus
 * resolveAccess (sees, canEdit, all). Ohne access (Browser-Modus): alles.
 */
export function dataRights(access) {
  if (!access || access.all) return { read: () => true, write: () => true }
  const sees = (...m) => any(m, (x) => access.sees(x))
  const edits = (...m) => any(m, (x) => access.canEdit(x))
  const rules = [
    [DOC.objects, () => sees('planung', 'auswertung', 'stammdaten', 'fahrzeuge', 'reklamationen', 'material', 'schluessel', 'unterweisungen', 'termine', 'fakturierung', 'einkauf', 'anlagen', 'regie', 'qualitaet', 'arbeitsschutz', 'bewerber', 'zufriedenheit', 'eintritt', 'matten'), () => edits('stammdaten', 'planung')],
    // Stammdaten: auch der Arbeitsschutz (wer in welchem Objekt arbeitet, für „noch nicht unterwiesen“)
    [DOC.master, () => sees('planung', 'auswertung', 'stammdaten', 'fahrzeuge', 'reklamationen', 'material', 'schluessel', 'unterweisungen', 'termine', 'arbeitsschutz', 'bewerber', 'eintritt'), () => edits('stammdaten', 'planung')],
    ['plaene/', () => sees('planung', 'auswertung'), () => edits('planung')],
    [DOC.absences, () => edits('planung') || sees('stammdaten', 'auswertung'), () => edits('planung', 'stammdaten')],
    // „abwesend von–bis“ ohne Grund: geschrieben, wo die Abwesenheiten gepflegt werden
    [DOC.absent, () => sees('planung', 'auswertung', 'stammdaten'), () => edits('planung', 'stammdaten')],
    [DOC.account, () => edits('planung') || sees('auswertung'), () => edits('planung', 'auswertung')],
    // Fuhrpark: auch der Mattenwechsel liest ihn (Fahrzeug je Tour in der Tourenplanung), schreiben nur der Fuhrpark
    [MODULE_DOCS.fahrzeuge.path, () => sees('fahrzeuge', 'matten'), () => edits('fahrzeuge')],
    [MODULE_DOCS.reklamationen.path, () => sees('reklamationen'), () => edits('reklamationen')],
    // Material: auch der Arbeitsschutz liest die Artikel (Arbeitsstoffverzeichnis); die Angaben zu Arbeitsstoffen am
    // Artikel speichert, wer Arbeitsstoffe bearbeitet (Lager, Vollzugriff)
    [MODULE_DOCS.material.path, () => sees('material', 'arbeitsschutz', 'arbeitsstoffe'), () => edits('material', 'arbeitsstoffe')],
    // Schlüsselbuch: auch wer plant, liest es (Prüfregel „Schlüsselübergabe nötig“)
    [MODULE_DOCS.schluessel.path, () => sees('schluessel') || edits('planung'), () => edits('schluessel')],
    // Leistungsnachweis: wer den Plan sieht, darf Nachweise ansehen; senden und vermerken nur mit
    // irgendeinem Schreibrecht (Objektleitung, Objektmanagement …), nicht „Nur lesen“
    [MODULE_DOCS.nachweise.path, () => sees('planung'), () => sees('planung') && Object.keys(MODULES).some((m) => edits(m))],
    // Fristen: auch wer plant, liest sie (Prüfregel „Fristen je Person“)
    [MODULE_DOCS.unterweisungen.path, () => sees('unterweisungen') || edits('planung'), () => edits('unterweisungen')],
    // Anlagen & Prüffristen: Datei, Fotos und Prüfberichte (anlagen/nachweise/…) im selben Ordner
    ['anlagen/', () => sees('anlagen'), () => edits('anlagen')],
    // Regieberichte: Datei, Fotos und PDFs (regie/nachweise/…) im selben Ordner. Die Buchhaltung braucht ihn nicht:
    // der Rechnungsentwurf trägt den Bericht eingefroren als Beilage (source.beilage in fakturierung.json)
    ['regie/', () => sees('regie'), () => edits('regie')],
    // Qualitätsmessung: Datei, Fotos der Mängel und Berichte (qualitaet/nachweise/…); lesen auch ohne Schreibrecht
    ['qualitaet/', () => sees('qualitaet'), () => edits('qualitaet')],
    // Arbeitsschutz: Sicherheitsdatenblätter lädt auch das Lager hoch (Arbeitsstoffe), eigener Unterordner zuerst;
    // Datei, Betriebsanweisungen und Evaluierung (mit PDFs unter arbeitsschutz/dokumente/) nur mit Recht auf den Arbeitsschutz
    ['arbeitsschutz/dokumente/sdb/', () => sees('arbeitsschutz', 'arbeitsstoffe'), () => edits('arbeitsschutz', 'arbeitsstoffe')],
    ['arbeitsschutz/', () => sees('arbeitsschutz'), () => edits('arbeitsschutz')],
    // Kundenzufriedenheit: Runden und Antworten; lesen auch ohne Schreibrecht (Objektmanagement, Objektleitung)
    ['zufriedenheit/', () => sees('zufriedenheit'), () => edits('zufriedenheit')],
    // Termine: wer plant, sieht sie (Zeitlinie, Konflikte mit Einsätzen); eintragen nur mit Recht auf Termine
    [MODULE_DOCS.termine.path, () => sees('termine', 'planung'), () => edits('termine')],
    // Digitale Mitarbeiter: Entscheidungen (später/abgelehnt) für alle, die in einem der Bereiche arbeiten
    [MODULE_DOCS.assistenz.path, () => sees('planung', 'fakturierung', 'einkauf', 'material', 'unterweisungen', 'fahrzeuge', 'reklamationen', 'anlagen', 'regie', 'qualitaet', 'arbeitsschutz', 'bewerber', 'zufriedenheit', 'eintritt', 'matten'), () => edits('planung', 'fakturierung', 'einkauf', 'material', 'unterweisungen', 'fahrzeuge', 'reklamationen', 'anlagen', 'regie', 'qualitaet', 'arbeitsschutz', 'bewerber', 'zufriedenheit', 'eintritt', 'matten')],
    // Kalkulation (Löhne, Margen): nur Vollzugriff – keine Regel, also nur mit access.all
    // Rechnungen, Kunden, Zahlungen: nur Fakturierung (Buchhaltung, Vollzugriff)
    [MODULE_DOCS.fakturierung.path, () => sees('fakturierung'), () => edits('fakturierung')],
    // Lieferanten (mit Bankverbindung), Eingangsrechnungen, Kassenbuch: nur Einkauf & Kasse (Buchhaltung, Vollzugriff)
    ['einkauf/', () => sees('einkauf'), () => edits('einkauf')],
    // Kundenbereich: Links mit Code wirken wie Passwörter, nur wer Reklamationen oder die Planung bearbeitet
    [MODULE_DOCS.kundenbereich.path, () => edits('reklamationen', 'planung'), () => edits('reklamationen', 'planung')],
    // Bewerbungen mit Lebenslauf und Unterlagen (bewerbung/unterlagen/…): personenbezogen, nur wer Bewerbungen bearbeitet
    // (Personalverwaltung, Vollzugriff); nicht die Lohnverrechnung, nicht die Objektleitung
    ['bewerbung/', () => sees('bewerber'), () => edits('bewerber')],
    // Eintritts- und Austritts-Checklisten: Personalverwaltung und Lohnverrechnung. Die Objektleitung sieht die
    // Einschulung als Termin (termine/), nicht die Checkliste
    ['eintritt/', () => sees('eintritt'), () => edits('eintritt')],
    // Mattenwechsel: Touren der Fahrer (eigener Unterordner zuerst; Fahrer sehen nur die eigenen, SharePoint trennt
    // nach Ordner, nicht nach Datensatz). Liegeplätze, Gebiete, Einstellungen (matten/matten.json) und Einsätze
    // (matten/einsaetze-<Jahr>.json) nur das Büro:
    // Fahrer lesen sie nicht, die Tour trägt eine eingefrorene Kopie (Kunde, Adresse, Liegeplatz, Matte, ohne Preis)
    ['matten/touren/', () => sees('matten', 'mattentour'), () => edits('matten', 'mattentour')],
    // Fotos der Fahrer je Liegeplatz (matten/fotos/<Jahr>/<Liegeplatz>/…): Fahrer und Büro bearbeiten
    ['matten/fotos/', () => sees('matten', 'mattentour'), () => edits('matten', 'mattentour')],
    ['matten/', () => sees('matten'), () => edits('matten')],
  ]
  const rule = (path) => rules.find(([p]) => (p.endsWith('/') ? path.startsWith(p) : path === p))
  return { read: (path) => !!rule(path)?.[1](), write: (path) => !!rule(path)?.[2]() }
}

/** Ordner im App-Ordner der SharePoint-Bibliothek: wer welche Rechte braucht (für die Einrichtung). */
export const FOLDERS = [
  ['objekte', 'Objekte (Name, Adresse, Revier)', DOC.objects],
  ['daten', 'Mitarbeitende, Leistungen, Regeln', DOC.master],
  ['plaene', 'Wochenpläne (Einteilungen)', weekPath('2026-01-05')],
  ['personal', 'Urlaub und Krankenstände', DOC.absences],
  ['lohn', 'Zeitkonto, Löhne, Monatsabschlüsse', DOC.account],
  ['fahrzeuge', 'Fahrzeuge, Reifen, Service', MODULE_DOCS.fahrzeuge.path],
  ['reklamationen', 'Reklamationen je Objekt', MODULE_DOCS.reklamationen.path],
  ['material', 'Material, Lager, Bestellungen', MODULE_DOCS.material.path],
  ['schluessel', 'Schlüsselbuch', MODULE_DOCS.schluessel.path],
  ['nachweise', 'Leistungsnachweis: Versand-Vermerke', MODULE_DOCS.nachweise.path],
  ['unterweisungen', 'Unterweisungen & Fristen je Person', MODULE_DOCS.unterweisungen.path],
  ['anlagen', 'Anlagen & Prüffristen je Objekt (mit Fotos und Prüfberichten)', MODULE_DOCS.anlagen.path],
  ['regie', 'Regieberichte: Sonderleistungen mit Unterschrift, Fotos und PDF', MODULE_DOCS.regie.path],
  ['qualitaet', 'Qualitätsmessung je Objekt (Raumgruppen, Messungen, Fotos der Mängel, Berichte als PDF)', MODULE_DOCS.qualitaet.path],
  ['arbeitsschutz', 'Arbeitsschutz: Betriebsanweisungen, Evaluierung, PDFs unter dokumente/', MODULE_DOCS.arbeitsschutz.path],
  ['arbeitsschutz/dokumente/sdb', 'Sicherheitsdatenblätter (auch das Lager lädt sie hoch)', 'arbeitsschutz/dokumente/sdb/sdb.pdf'],
  ['zufriedenheit', 'Kundenzufriedenheit: Umfrage-Runden, Antworten aus dem Kundenbereich, Auswertung', MODULE_DOCS.zufriedenheit.path],
  ['termine', 'Termine (Kunden, Begehungen, Schulungen)', MODULE_DOCS.termine.path],
  ['kalkulation', 'Objektkalkulation (Leistungswerte, Zuschläge, Preise)', MODULE_DOCS.kalkulation.path],
  ['fakturierung', 'Fakturierung: Kunden, Angebote, Rechnungen, Zahlungen, Belege als PDF', MODULE_DOCS.fakturierung.path],
  ['einkauf', 'Einkauf & Kasse: Lieferanten, Eingangsrechnungen mit Belegen, Kassenbuch', MODULE_DOCS.einkauf.path],
  ['assistenz', 'Digitale Mitarbeiter: Entscheidungen zu Vorschlägen', MODULE_DOCS.assistenz.path],
  ['berichte', 'Berichte automatisch per E-Mail (Empfänger, Zeitplan)', MODULE_DOCS.berichte.path],
  ['kundenbereich', 'Kundenbereich: Links für Kunden und Angebote zur Online-Annahme (wirken wie Passwörter)', MODULE_DOCS.kundenbereich.path],
  ['bewerbung', 'Bewerbungen mit Lebenslauf und Unterlagen (personenbezogen, eng berechtigen)', MODULE_DOCS.bewerbung.path],
  ['eintritt', 'Eintritts- und Austritts-Checklisten (Anmeldung, Unterweisung, Schlüssel, Abmeldung)', MODULE_DOCS.eintritt.path],
  ['matten', 'Mattenwechsel: Liegeplätze je Kunde und Objekt, Gebiete, Einsätze je Jahr (Büro)', MODULE_DOCS.matten.path],
  ['matten/touren', 'Mattenwechsel: Touren je Datei (Büro plant und gibt frei; Fahrer: Bestätigung je Liegeplatz, Unterschrift je Stopp)', 'matten/touren/2026/tour.json'],
  ['matten/fotos', 'Mattenwechsel: Fotos der Fahrer je Liegeplatz', 'matten/fotos/2026/liegeplatz/foto.jpg'],
]

/**
 * Ordner der eigenen Werkzeuge in derselben Bibliothek (neben dem Ordner der
 * App): [Ordner, Inhalt, Modul]. Die Werkzeuge lesen und schreiben dort mit
 * den SharePoint-Rechten der angemeldeten Person; ohne Modul = Kundenstamm,
 * den alle Werkzeuge lesen.
 */
export const TOOL_FOLDERS = [
  ['Wasserzähler - Ablesung', 'Wasserzähler-Ablesung: Listen, Fotos und Berichte je Standort', 'zaehler'],
  ['Objektpruefprotokolle', 'Objektkontrolle: Protokolle, Fotos, Unterschriften, Objektliste (auch die Objektdoku liest sie)', 'kontrolle'],
  ['Objektdoku', 'Objektdoku: Akten, Leistungsverzeichnis, Objektblätter, Vorlagen', 'objektmappe'],
  ['Mattenwechsel', 'Mattenwechsel (Werkzeug): Touren, Lieferscheine, Liegeplätze (Standorte.json), Sicherung der Übernahme', 'matten'],
  ['Stammdaten', 'Kundenstamm (Kunden.json): von allen Werkzeugen gelesen, vom Mattenwechsel beim Abschließen gepflegt', null],
]

// Werkzeuge mit Ordnern je Revier (core/reviere.js): geschrieben wird dort im Revier-Ordner
const REVIER_SPLIT = ['zaehler', 'kontrolle', 'objektmappe']

/**
 * Vorschlag je Rolle für die Werkzeug-Ordner: 'Bearbeiten', 'Lesen' oder ''.
 * reviere: Ordner je Revier eingerichtet (config.json → access.reviere) – dann haben die Rollen auf den
 * Grundordnern von Wasserzähler, Objektkontrolle und Objektdoku nur „Lesen“ (zum Finden der Revier-Ordner);
 * „Bearbeiten“ kommt über die Gruppe des Reviers auf dessen Ordner.
 */
export function toolFolderRights(access, { reviere = false } = {}) {
  const sees = (m) => !access || access.all || access.sees(m)
  const edits = (m) => !access || access.all || access.canEdit(m)
  const anyTool = TOOL_FOLDERS.some(([, , m]) => m && sees(m))
  return TOOL_FOLDERS.map(([folder, label, m]) => {
    // die Objektdoku liest die Objektliste der Objektkontrolle; der Mattenwechsel schreibt den gemeinsamen Kundenstamm
    let right = m ? (edits(m) ? 'Bearbeiten' : sees(m) || (m === 'kontrolle' && sees('objektmappe')) ? 'Lesen' : '') : access?.all || !access || edits('matten') ? 'Bearbeiten' : anyTool ? 'Lesen' : ''
    if (reviere && access && !access.all && REVIER_SPLIT.includes(m) && right === 'Bearbeiten') right = 'Lesen'
    return [folder, label, right]
  })
}

/** Rechte einer Rolle je Ordner: 'Bearbeiten', 'Lesen' oder ''. Exporte (PDF/Excel) und Übernahme nur mit Vollzugriff. */
export function folderRights(access) {
  const r = dataRights(access)
  const rows = FOLDERS.map(([folder, label, path]) => [folder, label, r.write(path) ? 'Bearbeiten' : r.read(path) ? 'Lesen' : ''])
  rows.push(['exporte', 'Excel- und PDF-Wochenpläne', access?.all ? 'Bearbeiten' : ''])
  return rows
}

// Objekte stehen seit der Trennung in objekte/objekte.json; ältere Stammdaten enthalten sie noch
const MASTER_KEYS = ['version', 'employees', 'tasks', 'skills', 'rules', 'extraFreeDays', 'travel', 'settings']
// Lohndaten je Person: nicht in den Stammdaten (die auch Ableser und Prüfer lesen), sondern im Zeitkonto
const PAY_FIELDS = ['hourlyWage', 'wageGroup']
const payOf = (e) => Object.fromEntries(PAY_FIELDS.filter((f) => e[f] !== undefined).map((f) => [f, e[f]]))
const withoutPay = (e) => Object.fromEntries(Object.entries(e).filter(([k]) => !PAY_FIELDS.includes(k)))
// Felder je Woche; Schlüssel beginnen mit dem Datum des Einsatzes (trips = geplante Fahrten)
// winter: angelegte Winterdienst-Einsätze „Datum|Objekt“ → { reason, by, at }
// winterlog: Winterdienst-Protokoll „Datum|Objekt|Eintrag“ → { person, at, geraeumt, gestreut, … }
// stamps: Zeiterfassung im Objekt „Datum|zID“ → { empId, objectId, instKey, in, out, … }
const WEEK_FIELDS = ['assignments', 'overrides', 'trips', 'winter', 'winterlog', 'stamps']
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const weekOfKey = (key) => mondayOf(key.slice(0, 10))

/** Art einer Abwesenheit, wenn nur „abwesend“ bekannt ist (ohne Recht auf personal/). */
export const ABSENT = 'Abwesend'

/**
 * Wer wann fehlt, ohne Art und Notiz. Aus den vollständigen Abwesenheiten; wer nur die Liste kennt,
 * gibt sie unverändert weiter (schreibt sie ohnehin nicht).
 */
export function absentList(data) {
  if (!data.absencesFull && data.absentOnly) return data.absentOnly
  return (data.absences || []).filter((a) => !a.limited && a.employeeId && a.from).map((a) => ({ id: a.id, employeeId: a.employeeId, from: a.from, to: a.to || a.from }))
}

/**
 * App-Daten → Dateien. Nur Wochen in `weeks` werden erzeugt. Dateien je Jahr (YEAR_DOCS): die Jahre in `years`
 * (geladene Pfade, auch leer) und jedes Jahr, zu dem es Einträge gibt.
 */
export function splitData(data, weeks, years = []) {
  const master = Object.fromEntries(MASTER_KEYS.map((k) => [k, data[k]]).filter(([, v]) => v !== undefined))
  if (master.employees) master.employees = master.employees.map(withoutPay)
  const known = new Set((data.employees || []).map((e) => e.id))
  // Löhne von Personen, die dieses Gerät (noch) nicht kennt, nicht verlieren
  const pay = {
    ...Object.fromEntries(Object.entries(data.payOther || {}).filter(([id]) => !known.has(id))),
    ...Object.fromEntries((data.employees || []).map((e) => [e.id, payOf(e)]).filter(([, p]) => Object.keys(p).length)),
  }
  const docs = {
    [DOC.master]: master,
    [DOC.objects]: { objects: data.objects || [] },
    [DOC.absences]: { absences: data.absences || [] },
    [DOC.absent]: { absent: absentList(data) },
    // pay immer schreiben (auch leer): ein gelöschter Lohn muss bei anderen Geräten ankommen
    [DOC.account]: { weeks: data.published || {}, ...(data.payroll ? { payroll: data.payroll } : {}), ...(data.payrollExport ? { export: data.payrollExport } : {}), pay },
  }
  for (const [key, m] of Object.entries(MODULE_DOCS)) docs[m.path] = data[key] ?? m.empty()
  for (const [key, m] of Object.entries(YEAR_DOCS)) {
    const byYear = new Map()
    for (const path of years) {
      const y = yearDocOf(path)
      if (y?.key === key) byYear.set(y.year, [])
    }
    for (const x of data[key] || []) {
      const y = m.yearOf(x)
      if (!/^\d{4}$/.test(y)) continue
      if (!byYear.has(y)) byYear.set(y, [])
      byYear.get(y).push(x)
    }
    for (const [y, list] of byYear) docs[yearPath(key, y)] = { ...m.empty(), [m.list]: [...list].sort(m.order) }
  }
  for (const monday of weeks) docs[weekPath(monday)] = { monday, assignments: {}, overrides: {}, log: data.logs?.[monday] || [] }
  for (const field of WEEK_FIELDS) {
    for (const [key, value] of Object.entries(data[field] || {})) {
      const doc = docs[weekPath(weekOfKey(key))]
      if (!doc) continue
      doc[field] = doc[field] || {}
      doc[field][key] = value
    }
  }
  return docs
}

/** Eine Datei in die App-Daten übernehmen. */
export function applyDoc(data, path, doc) {
  if (path === DOC.master) {
    // Lohndaten bleiben erhalten (stehen im Zeitkonto, auch für Personen, die erst jetzt dazukommen);
    // ältere Stammdaten mit Lohn darin gelten weiter
    const pay = new Map([...Object.entries(data.payOther || {}), ...(data.employees || []).map((e) => [e.id, payOf(e)])])
    for (const k of MASTER_KEYS) if (doc[k] !== undefined) data[k] = doc[k]
    if (doc.employees) {
      data.employees = doc.employees.map((e) => ({ ...(pay.get(e.id) || {}), ...e }))
      const known = new Set(doc.employees.map((e) => e.id))
      if (data.payOther) data.payOther = Object.fromEntries(Object.entries(data.payOther).filter(([id]) => !known.has(id)))
    }
    // ältere Stammdaten mit Objekten: nur solange es objekte/objekte.json noch nicht gibt
    if (doc.objects && !data.objects?.length) data.objects = doc.objects
  } else if (path === DOC.objects) {
    data.objects = doc.objects || []
  } else if (path === DOC.absences) {
    data.absences = doc.absences || []
    data.absencesFull = true
  } else if (path === DOC.absent) {
    data.absentOnly = doc.absent || []
    // ohne Leserecht auf personal/ (Gesundheitsdaten): nur „abwesend“, für Plan, Prüfregeln und Vertretung
    if (!data.absencesFull) data.absences = data.absentOnly.map((a) => ({ ...a, type: ABSENT, limited: true }))
  } else if (path === DOC.account) {
    data.published = doc.weeks || {}
    if (doc.payroll) data.payroll = doc.payroll
    else delete data.payroll
    // Export für die Lohnverrechnung: Lohnarten und Dateiformat
    if (doc.export) data.payrollExport = doc.export
    else delete data.payrollExport
    // mit pay (auch leer) gilt nur, was dort steht; ältere Dateien ohne pay lassen Löhne aus den Stammdaten stehen
    if (doc.pay) {
      const known = new Set((data.employees || []).map((e) => e.id))
      data.employees = (data.employees || []).map((e) => ({ ...withoutPay(e), ...(doc.pay[e.id] || {}) }))
      data.payOther = Object.fromEntries(Object.entries(doc.pay).filter(([id]) => !known.has(id)))
    }
  } else if (MODULE_BY_PATH[path]) {
    const m = MODULE_BY_PATH[path]
    data[m.key] = { ...m.empty(), ...doc }
  } else if (yearDocOf(path)) {
    // Datei je Jahr: die Einträge dieses Jahres ersetzen, die der anderen Jahre bleiben
    const y = yearDocOf(path)
    data[y.key] = [...(data[y.key] || []).filter((x) => y.yearOf(x) !== y.year), ...(doc?.[y.list] || [])]
  } else {
    const monday = doc.monday
    for (const field of WEEK_FIELDS) {
      data[field] = data[field] || {}
      for (const key of Object.keys(data[field])) if (weekOfKey(key) === monday) delete data[field][key]
      Object.assign(data[field], doc[field] || {})
    }
    data.logs = data.logs || {}
    data.logs[monday] = doc.log || []
  }
}

export class DataService {
  /**
   * rights:  dataRights(access) – welche Dateien gelesen/geschrieben werden (Standard: alle).
   * blank:   Grunddaten (leere Listen, Regeln) für Personen ohne Zugriff auf die Stammdaten.
   * session: Kennung dieses Fensters (ungespeicherte Änderungen anderer Fenster bleiben unberührt).
   */
  constructor(store, { onStatus = () => {}, onRemoteChange = () => {}, debounceMs = 800, local = null, rights = null, blank = () => ({}), session = Math.random().toString(36).slice(2), quickStart = false, onSaved = () => {}, onUploaded = null, onUploads = null } = {}) {
    this.onSaved = onSaved // nach erfolgreichem Speichern: Pfade (z. B. andere Fenster benachrichtigen)
    this.onUploaded = onUploaded // (path, webUrl) → true/false: nachgeholte Datei im Modul vermerkt (ui/context.js: uploadDone)
    this.onUploads = onUploads // ({ done, left, failed }) nach jedem Nachholen: Stand der Warteschlange
    this.quickStart = quickStart // Start mit dem Stand im Gerät, Abgleich im Hintergrund (SharePoint)
    this.store = store
    this.local = local // Gerätespeicher für ungespeicherte Änderungen (offline.js)
    this.rights = rights || { read: () => true, write: () => true }
    this.blank = blank
    this.session = session
    this.moved = new Map() // neuer Pfad → alter Pfad (Umzug in die eigenen Ordner)
    this.mustWrite = new Set() // neu anzulegen, auch wenn der Inhalt der Basis entspricht (Umzug)
    this.onStatus = onStatus
    this.onRemoteChange = onRemoteChange
    this.debounceMs = debounceMs
    this.base = new Map() // Pfad → zuletzt gespeicherter/geladener Stand
    this.etags = new Map()
    this.weeks = new Set()
    this.years = new Set() // geladene Dateien je Jahr (YEAR_DOCS), auch die noch nicht angelegten
    this.loadingWeeks = new Map() // Woche → laufender Ladevorgang
    this.unavailable = new Set() // Wochen ohne Netz und ohne Kopie im Gerät: nicht bearbeiten
    this.denied = new Set() // Dateien ohne Leserecht: werden nie gespeichert
    this.broken = new Set() // Dateien mit kaputtem Inhalt (kein JSON): Bereich bleibt leer, Hinweis
    this.missing = new Set() // lesbar laut Rolle, aber nicht gefunden (fehlt noch oder SharePoint-Recht fehlt: Graph meldet dann 404)
    this.failed = new Map() // Pfad → letzte Fehlermeldung beim Speichern
    this.timer = null
    this.saving = null
    this.status = 'idle'
    this.data = null
    this.loadedAt = ''
    this.version = 0 // steigt bei jedem geladenen/zusammengeführten Dokument (für Rechen-Caches)
  }

  #setStatus(status, detail = '') {
    this.status = status
    this.onStatus(status, detail)
  }

  /** Datei lesen; ohne Leserecht (403) als gesperrt merken statt abzubrechen. Ohne Netz und ohne Kopie im Gerät: undefined. */
  async #read(path) {
    if (!this.rights.read(path)) {
      // nicht für diese Rolle: gar nicht erst anfragen
      this.denied.add(path)
      return null
    }
    try {
      return await this.store.read(path)
    } catch (err) {
      return this.#readError(path, err)
    }
  }

  #readError(path, err) {
    if (isNetworkError(err)) return undefined
    if (err.name === 'SyntaxError') {
      // abgeschnittene oder von Hand kaputt gemachte Datei: Bereich sperren statt die App nicht zu starten
      this.denied.add(path)
      this.broken.add(path)
      return null
    }
    if (err.status !== 403) throw err
    this.denied.add(path)
    return null
  }

  /** Mehrere Dateien lesen, gebündelt, wenn die Ablage das kann (SharePoint: eine Anfrage je 20 Dateien). Ergebnis je Pfad wie #read. */
  async #readAll(paths) {
    const allowed = paths.filter((p) => this.rights.read(p))
    if (!this.store.readMany || allowed.length < 2) return Promise.all(paths.map((p) => this.#read(p)))
    let res
    try {
      res = await this.store.readMany(allowed)
    } catch (err) {
      if (!isNetworkError(err)) throw err
      res = new Map()
    }
    return paths.map((p) => {
      if (!this.rights.read(p)) {
        this.denied.add(p)
        return null
      }
      const r = res.get(p)
      if (!r) return undefined
      return r.error ? this.#readError(p, r.error) : r.doc
    })
  }

  /** Frühere Ablage lesen (Umzug); Fehler zählen als „gibt es nicht“. */
  async #readOld(path) {
    try {
      return await this.store.read(path)
    } catch {
      return null
    }
  }

  /** Aktueller Inhalt einer Datei aus den App-Daten. */
  #live(path) {
    return splitData(this.data, new Set([...this.weeks, ...this.#touchedWeeks()]), this.years)[path]
  }

  /** Datei je Jahr gelesen (auch: gibt es noch nicht): gilt als geladen, wird ab jetzt mit gespeichert. */
  #yearLoaded(path) {
    if (yearDocOf(path) && !this.denied.has(path)) this.years.add(path)
  }

  /** Ungespeicherte Änderungen im Gerät festhalten (übersteht Neustart ohne Netz). */
  async #savePending(snaps) {
    if (!this.local) return
    const at = new Date().toISOString()
    for (const [path, doc] of snaps) await this.local.put('pending', path, { doc, base: clone(this.base.get(path)), etag: this.etags.get(path) ?? null, at, owner: this.session })
  }

  /** Gespeichert: eigenen Eintrag (und beim Start übernommene) aus dem Gerät nehmen, fremde neuere stehen lassen. */
  async #dropPending(path) {
    if (!this.local) return
    const entry = await this.local.get('pending', path)
    if (entry && (entry.owner === this.session || !entry.at || entry.at <= this.loadedAt)) await this.local.del('pending', path)
  }

  /** Anzahl der Dateien mit ungespeicherten Änderungen. */
  pendingCount() {
    return this.data ? this.#dirty().length : 0
  }

  /** Darf diese Datei gespeichert werden? */
  writable(path) {
    return !this.denied.has(path) && this.rights.write(path)
  }

  /** Woche ohne Netz nicht verfügbar (nicht im Gerät): nicht bearbeiten. */
  weekUnavailable(monday) {
    return this.unavailable.has(monday) && !this.weeks.has(monday)
  }

  /**
   * Wochen mit Einträgen im Speicher, die nie geladen wurden (z. B. ohne Netz
   * bearbeitet oder per Abwesenheit in einer späteren Woche ausgetragen).
   * Sie werden mit unbekannter Basis gespeichert: gibt es die Datei schon,
   * führt das Speichern zusammen statt zu überschreiben.
   */
  #touchedWeeks() {
    const out = new Set()
    for (const field of WEEK_FIELDS) for (const key of Object.keys(this.data[field] || {})) out.add(weekOfKey(key))
    for (const [monday, log] of Object.entries(this.data.logs || {})) if (log?.length) out.add(monday)
    for (const m of this.weeks) out.delete(m)
    return out
  }

  /** Splitten ohne gesperrte Dateien. */
  #docs() {
    return Object.entries(splitData(this.data, new Set([...this.weeks, ...this.#touchedWeeks()]), this.years)).filter(([path]) => !this.denied.has(path))
  }

  /** Geänderte Dateien, die diese Person speichern darf. */
  #dirty() {
    return this.#docs().filter(([path, doc]) => this.rights.write(path) && (this.mustWrite.has(path) || !same(doc, this.base.get(path) ?? emptyDoc(path))))
  }

  /** Lädt Stammdaten, Abwesenheiten, Zeitkonto und die Modul-Dateien. `seed()` liefert Startdaten, falls noch nichts existiert. */
  async load(seed) {
    this.#setStatus('loading')
    this.oldWeeksGone = (await this.local?.get('meta', 'wochen-alt')) === 'leer'
    // DOC.absent nach DOC.absences: wer die vollständigen Abwesenheiten liest, behält sie
    const paths = [DOC.master, DOC.objects, DOC.absences, DOC.absent, DOC.account, ...Object.values(MODULE_DOCS).map((m) => m.path), ...startYearPaths(todayISO())]
    // Schnellstart: mit dem letzten Stand im Gerät sofort loslegen, SharePoint im Hintergrund abgleichen
    if (this.quickStart && this.store.cached) {
      const data = await this.#loadCached(paths)
      if (data) return data
    }
    const docs = await this.#readAll(paths)
    const needsMaster = this.rights.read(DOC.master)
    if (needsMaster && this.broken.has(DOC.master)) throw new Error('Die Datei daten/stammdaten.json ist beschädigt (kein gültiges JSON). In SharePoint im Versionsverlauf eine frühere Fassung wiederherstellen.')
    if (needsMaster && this.denied.has(DOC.master)) throw new Error('Kein Leserecht auf die Stammdaten (daten/stammdaten.json). Bitte in SharePoint freigeben lassen.')
    if (docs[needsMaster ? 0 : 1] === undefined) throw Object.assign(new Error('Keine Verbindung, und auf diesem Gerät liegt noch kein Stand. Bitte einmal mit Netz öffnen.'), { offline: true })
    // Erststart nur, wer die Stammdaten anlegen darf (SharePoint meldet unsichtbare Dateien als „gibt es nicht“)
    const fresh = needsMaster && !docs[0] && this.rights.write(DOC.master)
    // Frühere Ablage unter daten/: lesen, im eigenen Ordner neu anlegen; der alte Inhalt ist die Basis zum Zusammenführen
    const cleanup = []
    for (const [i, path] of paths.entries()) {
      const old = OLD_PATHS[path]
      if (!old || this.denied.has(path) || fresh) continue
      if (docs[i]) {
        // neue Datei gibt es schon: liegt die alte noch (Löschen ist früher gescheitert), nochmals entfernen
        if (this.rights.write(path)) cleanup.push(old)
        continue
      }
      if (docs[i] !== null) continue
      const doc = await this.#readOld(old)
      if (doc) {
        docs[i] = { data: doc.data, etag: null }
        this.moved.set(path, old)
        this.mustWrite.add(path)
      }
    }
    for (const path of [DOC.master, DOC.objects]) if (docs[paths.indexOf(path)] === null && !this.denied.has(path) && this.rights.read(path) && !this.rights.write(path)) this.missing.add(path)
    // absencesFull: darf die vollständigen Abwesenheiten lesen (auch wenn die Datei noch fehlt)
    const data = { assignments: {}, overrides: {}, trips: {}, logs: {}, absences: [], published: {}, absencesFull: this.rights.read(DOC.absences) }
    this.data = data
    if (fresh) {
      Object.assign(data, await seed())
      this.firstRun = true
      for (const [i, path] of paths.entries()) if (docs[i] !== undefined) this.#yearLoaded(path)
    } else {
      // Grunddaten zuerst: Dateien, die es (noch) nicht gibt bzw. die die Rolle nicht liest, lassen leere Listen
      Object.assign(data, await this.blank())
      for (const [i, path] of paths.entries()) {
        const doc = docs[i]
        if (doc !== undefined) this.#yearLoaded(path)
        if (!doc) continue
        applyDoc(data, path, doc.data)
        this.version++
        this.base.set(path, clone(doc.data))
        if (doc.etag) this.etags.set(path, doc.etag)
      }
    }
    data.objects ||= []
    // Objekte aus älteren Stammdaten: neu anlegen; Basis ist der alte Stand (für eine gleichzeitige Anlage auf einem anderen Gerät)
    if (!fresh && !this.base.has(DOC.objects) && data.objects.length && this.writable(DOC.objects)) {
      this.base.set(DOC.objects, { objects: clone(data.objects) })
      this.mustWrite.add(DOC.objects)
    }
    const migrate = this.mustWrite.size > 0
    if (!migrate && !docs.includes(undefined)) await this.local?.put('meta', 'ablage', 2)
    await this.#restorePending(data)
    this.loadedAt = new Date().toISOString()
    this.#setStatus('saved')
    for (const old of cleanup) this.store.remove?.(old).catch(() => {})
    if (this.firstRun) {
      // Startdaten enthalten ggf. schon Einteilungen: deren Wochen gelten als geladen
      for (const key of Object.keys(data.assignments)) this.weeks.add(weekOfKey(key))
      await this.flush()
    } else if (migrate) {
      await this.flush().catch(() => {})
    }
    return data
  }

  /**
   * Start aus dem Gerät: nur, wenn die Kernliste (Stammdaten bzw. Objekte) dort liegt und kein Umzug
   * aus der früheren Ablage ansteht. Liefert die Daten oder null (dann normal laden).
   */
  async #loadCached(paths) {
    const core = this.rights.read(DOC.master) ? DOC.master : DOC.objects
    const cached = await Promise.all(paths.map((p) => (this.rights.read(p) ? this.store.cached(p) : null)))
    if (!cached[paths.indexOf(core)]) return null
    // erst, wenn ein normaler Start gezeigt hat, dass nichts mehr aus der früheren Ablage umzuziehen ist
    if ((await this.local?.get('meta', 'ablage')) !== 2) return null
    // absencesFull: darf die vollständigen Abwesenheiten lesen (auch wenn die Datei noch fehlt)
    const data = { assignments: {}, overrides: {}, trips: {}, logs: {}, absences: [], published: {}, absencesFull: this.rights.read(DOC.absences) }
    this.data = data
    Object.assign(data, await this.blank())
    for (const [i, path] of paths.entries()) {
      if (!this.rights.read(path)) {
        this.denied.add(path)
        continue
      }
      // Jahr ohne Kopie im Gerät: gilt als geladen (leer); der Abgleich im Hintergrund holt es
      this.#yearLoaded(path)
      const doc = cached[i]
      if (!doc) continue
      applyDoc(data, path, doc.data)
      this.version++
      this.base.set(path, clone(doc.data))
      if (doc.etag) this.etags.set(path, doc.etag)
    }
    data.objects ||= []
    await this.#restorePending(data)
    this.loadedAt = new Date().toISOString()
    this.fromCache = true
    this.#setStatus('syncing')
    this.syncing = this.#revalidate(paths, { verify: true }).finally(() => {
      this.syncing = null
      if (this.status === 'syncing') this.#setStatus('saved')
    })
    this.syncing.catch(() => {})
    return data
  }

  /**
   * Abgleich nach dem Schnellstart bzw. nach Wochen aus dem Gerät: SharePoint lesen und Neueres
   * übernehmen. Wurde hier inzwischen geändert, wird zusammengeführt und gespeichert.
   */
  async #revalidate(paths, { verify = false, fromDevice = false } = {}) {
    if (verify && this.store.verified) {
      try {
        await this.store.verified
      } catch (err) {
        this.#setStatus('error', err.message)
        throw err
      }
    }
    const before = new Map(paths.map((p) => [p, this.etags.get(p)]))
    const docs = fromDevice ? await Promise.all(paths.map(async (p) => (await this.store.cached(p)) ?? undefined)) : await this.#readAll(paths)
    const changed = []
    let merged = false
    for (const [i, path] of paths.entries()) {
      const doc = docs[i]
      // inzwischen hier gespeichert: das Gelesene ist älter
      if (doc === undefined || this.etags.get(path) !== before.get(path)) continue
      if (doc === null) {
        if (this.denied.has(path) && this.base.has(path)) {
          // kein Leserecht mehr (z. B. Rolle geändert): Bereich leeren
          applyDoc(this.data, path, emptyDoc(path) ?? {})
          this.base.delete(path)
          this.etags.delete(path)
          this.version++
          changed.push({ path, by: null })
        } else this.etags.delete(path)
        continue
      }
      if (doc.etag && doc.etag === this.etags.get(path)) continue
      const base = this.base.get(path)
      const live = this.#live(path)
      const local = live !== undefined && !same(live, base ?? emptyDoc(path))
      applyDoc(this.data, path, clone(local ? mergeDoc(base, live, doc.data) : doc.data))
      this.#yearLoaded(path)
      this.version++
      this.base.set(path, clone(doc.data))
      if (doc.etag) this.etags.set(path, doc.etag)
      changed.push({ path, by: doc.modifiedBy })
      merged ||= local
    }
    if (merged && this.status !== 'offline') this.schedule()
    if (changed.length) this.onRemoteChange('loaded', changed)
    return changed
  }

  /** Abgleich läuft (Schnellstart): darauf warten, z. B. vor einer Auswertung. */
  async synced() {
    await this.syncing?.catch(() => {})
  }

  /**
   * Änderungen, die zuletzt ohne Netz gemacht wurden: wieder übernehmen (beim Speichern zusammengeführt).
   * Einträge ohne Schreibrecht (anderes Konto, andere Rolle) bleiben unangetastet im Gerät.
   */
  async #restorePending(data) {
    const pending = this.local ? await this.local.all('pending') : []
    let restored = 0
    for (const [path, p] of pending) {
      if (this.denied.has(path) || !this.rights.write(path)) continue
      if (isWeekPath(path)) this.weeks.add(p.doc.monday)
      this.#yearLoaded(path)
      applyDoc(data, path, clone(p.doc))
      this.version++
      restored++
      if (p.base === undefined) this.base.delete(path)
      else this.base.set(path, clone(p.base))
      if (p.etag) this.etags.set(path, p.etag)
      else this.etags.delete(path)
    }
    this.restored = restored
  }

  /**
   * Lädt fehlende Wochen-Dateien nach (beim Blättern). Ohne Netz und ohne Kopie bleibt eine Woche ungeladen.
   * Mit Schnellstart gilt zuerst die Kopie im Gerät; SharePoint wird im Hintergrund abgeglichen.
   */
  async ensureWeeks(mondays) {
    const missing = [...new Set(mondays)].filter((m) => !this.weeks.has(m))
    if (!missing.length) return false
    let fetch = missing
    if (this.quickStart && this.store.cached) {
      const fromDevice = []
      fetch = []
      for (const m of missing) {
        if (this.loadingWeeks.has(m)) fetch.push(m)
        else if (await this.#useCachedWeek(m)) fromDevice.push(m)
        else fetch.push(m)
      }
      if (fromDevice.length) {
        const check = this.#revalidate(fromDevice.map(weekPath)).catch(() => [])
        this.syncing = this.syncing ? Promise.all([this.syncing, check]) : check
      }
    }
    await this.#loadWeeks(fetch)
    return true
  }

  /**
   * Dateien je Jahr nachladen (YEAR_DOCS, z. B. Einsätze eines anderen Jahres im Kalender). Schon hier Geändertes desselben
   * Jahres wird zusammengeführt. Ohne Netz und ohne Kopie bleibt ein Jahr ungeladen (nächster Versuch beim nächsten Aufruf).
   * true, wenn etwas neu geladen wurde.
   */
  async ensureYears(key, years) {
    const paths = [...new Set(years.map(String))].map((y) => yearPath(key, y)).filter((p) => !this.years.has(p))
    const readable = paths.filter((p) => this.rights.read(p) && !this.denied.has(p))
    if (!readable.length) return false
    const docs = await this.#readAll(readable)
    let loaded = false
    for (const [i, path] of readable.entries()) {
      const doc = docs[i]
      if (doc === undefined || this.years.has(path)) continue
      const live = doc ? this.#live(path) : undefined
      this.#yearLoaded(path)
      loaded = true
      if (!doc) continue
      applyDoc(this.data, path, clone(live ? mergeDoc(this.base.get(path), live, doc.data) : doc.data))
      this.version++
      this.base.set(path, clone(doc.data))
      if (doc.etag) this.etags.set(path, doc.etag)
      if (live && this.writable(path)) this.schedule()
    }
    return loaded
  }

  /** Datei je Jahr geladen (oder gibt es noch nicht)? */
  yearLoaded(key, year) {
    return this.years.has(yearPath(key, String(year)))
  }

  /** Wochen im Hintergrund vorladen (z. B. die nächste und vorige), ohne Fehler zu melden. */
  prefetchWeeks(mondays) {
    return this.ensureWeeks(mondays).catch(() => false)
  }

  /** Woche aus dem Gerät übernehmen (Schnellstart); false, wenn dort keine liegt. */
  async #useCachedWeek(monday) {
    const path = weekPath(monday)
    if (!this.rights.read(path) || this.weeks.has(monday)) return false
    const doc = await this.store.cached(path)
    if (!doc || this.weeks.has(monday)) return false
    const local = this.#touchedWeeks().has(monday) ? this.#live(path) : null
    this.weeks.add(monday)
    this.unavailable.delete(monday)
    applyDoc(this.data, path, clone(local ? mergeDoc(this.base.get(path), local, doc.data) : doc.data))
    this.version++
    this.base.set(path, clone(doc.data))
    if (doc.etag) this.etags.set(path, doc.etag)
    if (local && this.writable(path)) this.schedule()
    return true
  }

  /** Wochen gebündelt laden; laufende Ladevorgänge (schnelles Blättern) abwarten statt doppelt anzufragen. */
  async #loadWeeks(mondays) {
    const todo = mondays.filter((m) => !this.loadingWeeks.has(m) && !this.weeks.has(m))
    if (todo.length) {
      const batch = this.#readAll(todo.map(weekPath))
      todo.forEach((m, i) =>
        this.loadingWeeks.set(
          m,
          batch.then((docs) => this.#fetchWeek(m, docs[i])).finally(() => this.loadingWeeks.delete(m)),
        ),
      )
    }
    await Promise.all(mondays.map((m) => this.loadingWeeks.get(m)))
  }

  /** Eine Woche laden; läuft der Ladevorgang schon (schnelles Blättern), darauf warten. */
  #loadWeek(monday) {
    if (!this.loadingWeeks.has(monday)) this.loadingWeeks.set(monday, this.#fetchWeek(monday).finally(() => this.loadingWeeks.delete(monday)))
    return this.loadingWeeks.get(monday)
  }

  /** preread: schon gebündelt gelesen (sonst einzeln lesen). */
  async #fetchWeek(monday, preread) {
    const path = weekPath(monday)
    let doc = preread === undefined && arguments.length < 2 ? await this.#read(path) : preread
    let moved = false
    if (doc === null && !this.denied.has(path) && !this.oldWeeksGone) {
      // frühere Ablage daten/plaene/… (nur solange dort noch Wochen liegen könnten)
      const old = await this.#readOld(oldPathOf(path))
      if (old) {
        doc = { data: old.data, etag: null }
        moved = true
      }
    }
    if (doc === undefined) {
      this.unavailable.add(monday)
      return
    }
    if (this.weeks.has(monday)) return
    this.unavailable.delete(monday)
    // schon bearbeitet, bevor die Woche geladen war: nicht überschreiben, sondern zusammenführen
    const local = this.#touchedWeeks().has(monday) ? this.#live(path) : null
    this.weeks.add(monday)
    if (!doc) {
      if (local) this.schedule()
      return
    }
    applyDoc(this.data, path, clone(local ? mergeDoc(this.base.get(path), local, doc.data) : doc.data))
    this.version++
    this.base.set(path, clone(doc.data))
    if (doc.etag) this.etags.set(path, doc.etag)
    if (local && this.writable(path)) this.schedule()
    if (moved && this.writable(path)) {
      this.moved.set(path, oldPathOf(path))
      this.mustWrite.add(path)
      this.schedule()
    }
  }

  /**
   * Alle Wochenpläne der früheren Ablage daten/plaene/ nach plaene/ umziehen
   * (nicht nur die geöffneten), damit unter daten/ nur noch die Stammdaten
   * liegen. Nur mit Schreibrecht auf die Pläne; liefert die Anzahl.
   */
  async migrateOldWeeks() {
    if (this.oldWeeksGone || !this.store.listDocs || !this.writable(weekPath('2026-01-05'))) return 0
    let moved = 0
    let list
    try {
      list = await this.store.listDocs('daten/plaene/')
    } catch {
      return 0
    }
    if (!list.length) {
      if (this.store.offline) return 0 // ohne Netz weiß man es nicht
      // nichts mehr umzuziehen: künftig weder suchen noch beim Laden je Woche nachsehen
      this.oldWeeksGone = true
      await this.local?.put('meta', 'wochen-alt', 'leer')
      return 0
    }
    for (const old of list) {
      const monday = old.match(/(\d{4}-\d{2}-\d{2})\.json$/)?.[1]
      if (!monday || this.weeks.has(monday) || this.loadingWeeks.has(monday)) continue
      const path = weekPath(monday)
      try {
        const doc = await this.store.read(old)
        if (doc) {
          try {
            await this.store.write(path, doc.data, null)
          } catch (err) {
            if (!(err instanceof ConflictError)) throw err // gibt es schon (früherer Umzug): alte Datei nur noch löschen
          }
        }
        await this.store.remove(old)
        moved++
      } catch {
        /* nächster Start versucht es wieder */
      }
    }
    return moved
  }

  /** Änderungen vormerken; gespeichert wird nach kurzer Pause. */
  schedule() {
    clearTimeout(this.timer)
    this.#setStatus('pending')
    this.timer = setTimeout(() => this.flush().catch(() => {}), this.debounceMs)
    // Änderungen gleich im Gerät sichern: wird die App vor dem Speichern geschlossen (Handy: App gewechselt),
    // holt der nächste Start sie nach
    if (this.local && !this.pendingTimer)
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null
        if (!this.timer || this.saving) return
        this.#savePending(this.#dirty().map(([path, doc]) => [path, clone(doc)])).catch(() => {})
      }, 250)
  }

  /** Sofort speichern (z. B. wenn die App in den Hintergrund geht). */
  flushNow() {
    if (!this.timer && !this.hasPendingChanges()) return Promise.resolve()
    return this.flush().catch(() => {})
  }

  /**
   * Stand aus dem Gerät übernehmen, den ein anderes Fenster gerade gespeichert hat (gleicher Browser):
   * ohne Anfrage an SharePoint. Hier Ungespeichertes wird zusammengeführt.
   */
  async adoptSaved(paths) {
    if (!this.data) return []
    if (!this.store.cached) return this.refresh() // Browser-Ablage: gemeinsamer Speicher, normal abgleichen
    // Wochen nur, wenn sie hier geladen sind; sonst jede Datei, die diese Rolle liest (auch neu angelegte)
    const known = paths.filter((p) => (isWeekPath(p) ? this.weeks.has(p.split('/').pop().replace('.json', '')) : yearDocOf(p) ? this.years.has(p) : this.rights.read(p) && !this.denied.has(p)))
    if (!known.length) return []
    return this.#revalidate(known, { fromDevice: true })
  }

  hasPendingChanges() {
    return this.#dirty().length > 0
  }

  async flush() {
    clearTimeout(this.timer)
    this.timer = null
    if (this.saving) {
      await this.saving.catch(() => {})
      return this.flush()
    }
    this.saving = this.#flush().finally(() => (this.saving = null))
    return this.saving
  }

  async #flush() {
    // Neues zuerst anlegen (Objekte, umgezogene Dateien), erst danach z. B. die Stammdaten ohne Objekte
    const first = (path) => (this.mustWrite.has(path) ? 0 : 1)
    // fester Stand je Datei: was während des Speicherns geändert wird, gilt danach als ungespeichert
    const snaps = this.#dirty()
      .sort(([a], [b]) => first(a) - first(b))
      .map(([path, doc]) => [path, clone(doc)])
    if (!snaps.length) {
      this.#setStatus('saved')
      return
    }
    this.#setStatus('saving')
    await this.#savePending(snaps)
    let merged = false
    let offline = false
    const errors = []
    const saved = []
    const saveOne = async ([path, doc]) => {
      // Stammdaten ohne Objekte erst, wenn objekte/objekte.json sicher liegt
      if (offline || (path === DOC.master && this.mustWrite.has(DOC.objects))) return
      try {
        merged = (await this.#save(path, doc)) || merged
        await this.#dropPending(path)
        saved.push(path)
      } catch (err) {
        if (isNetworkError(err)) {
          // ohne Netz: Änderungen bleiben im Gerät, gespeichert wird beim nächsten Versuch
          offline = true
          return
        }
        // eine Datei, die nicht geht, hält die anderen nicht auf
        this.failed.set(path, err.message)
        errors.push(err)
      }
    }
    // Neues (Umzug, Objekte) der Reihe nach, der Rest gleichzeitig (höchstens 4 auf einmal)
    const ordered = snaps.filter(([path]) => this.mustWrite.has(path))
    const rest = snaps.filter(([path]) => !this.mustWrite.has(path))
    for (const snap of ordered) await saveOne(snap)
    for (let i = 0; i < rest.length; i += 4) await Promise.all(rest.slice(i, i + 4).map(saveOne))
    if (saved.length) this.onSaved(saved)
    if (offline) {
      this.#setStatus('offline', String(this.pendingCount()))
      return
    }
    if (errors.length) {
      this.#setStatus('error', errors[0].message)
      throw errors[0]
    }
    this.#setStatus(this.hasPendingChanges() ? 'pending' : 'saved')
    if (merged) this.onRemoteChange('merged')
  }

  async #save(path, doc, retry = true) {
    try {
      const etag = await this.store.write(path, doc, this.etags.get(path))
      this.etags.set(path, etag)
      this.base.set(path, clone(doc))
      this.mustWrite.delete(path)
      this.failed.delete(path)
      // Umzug fertig: die alte Datei (z. B. Krankenstände unter daten/) entfernen; scheitert das, versucht es der nächste Start
      const old = this.moved.get(path)
      if (old) {
        try {
          await this.store.remove?.(old)
          this.moved.delete(path)
        } catch {
          /* bleibt vorgemerkt */
        }
      }
      return false
    } catch (err) {
      if (!(err instanceof ConflictError) || !retry) throw err
      const remote = await this.store.read(path)
      // mit dem aktuellen Stand zusammenführen (inkl. Änderungen während des Speicherns)
      const live = this.#live(path) ?? doc
      // ohne bekannte Basis (nie geladen) gilt bei Einträgen, die beide haben, der gespeicherte Stand
      const mergedDoc = remote ? mergeDoc(this.base.get(path), live, remote.data) : live
      if (remote) {
        this.etags.set(path, remote.etag)
        this.base.set(path, clone(remote.data))
      } else {
        this.etags.delete(path)
      }
      applyDoc(this.data, path, clone(mergedDoc))
      this.version++
      await this.#save(path, clone(mergedDoc), false)
      return true
    }
  }

  /**
   * Wartende Uploads (ohne Netz aufgenommene Fotos und Dateien) hochladen – nur mit der SharePoint-Ablage
   * (offline.js), die Browser-Ablage hat keine Warteschlange. Läuft nie doppelt; liefert die Zahl der noch
   * wartenden. onUploaded(path, webUrl) vermerkt jede hochgeladene Datei im Modul (false: kein Modul kennt
   * sie, die Ablage meldet sie später noch einmal), onUploads({ done, left, failed }) danach den Stand.
   * retryFailed: Dateien mit echtem Fehler gleich noch einmal (sonst frühestens nach 10 Minuten).
   */
  async flushQueuedUploads({ retryFailed = false } = {}) {
    if (this.uploading || !this.store.flushUploads) return 0
    this.uploading = true
    let done = 0
    try {
      const left = await this.store.flushUploads((path, url) => {
        done++
        return this.onUploaded ? this.onUploaded(path, url) : undefined
      }, { retryFailed })
      if (this.onUploads) this.onUploads({ done, left, failed: left ? (await this.store.failedUploads?.()) || [] : [] })
      return left
    } finally {
      this.uploading = false
    }
  }

  /**
   * Prüft, ob andere Personen inzwischen gespeichert haben, und lädt deren
   * Stand nach, sofern hier nichts Ungespeichertes ansteht.
   */
  async refresh() {
    if (this.saving || this.syncing || (this.timer && this.status === 'pending')) return []
    // zuerst nachholen, was ohne Netz liegen geblieben ist
    if (this.status === 'offline' || this.restored) {
      this.restored = 0
      await this.flush()
      if (this.status === 'offline') return []
    }
    // Fotos und Dateien, die ohne Netz aufgenommen wurden (Regiebericht, Anlagen, Qualitätsmessung, Touren …),
    // im Hintergrund nachholen – für alle Module, nicht nur für das gerade geöffnete
    this.flushQueuedUploads().catch(() => {})
    // Wochen, die ohne Netz nicht geladen werden konnten, jetzt nachladen
    if (this.unavailable.size) {
      const retry = [...this.unavailable]
      await Promise.all(retry.map((m) => this.#loadWeek(m)))
      const loaded = retry.filter((m) => this.weeks.has(m)).map((m) => ({ path: weekPath(m), by: null }))
      if (loaded.length) this.onRemoteChange('loaded', loaded)
    }
    const changed = []
    const docs = this.#docs()
    // SharePoint: alle eTags in einer Anfrage (je 20 Dateien) statt einer Anfrage je Datei
    const etags = this.store.etagsOf ? await this.store.etagsOf(docs.map(([path]) => path)) : null
    for (const [path, doc] of docs) {
      const etag = etags ? etags.get(path) : await this.store.etagOf(path)
      if (!etag || etag === this.etags.get(path)) continue
      if (!same(doc, this.base.get(path) ?? emptyDoc(path))) continue
      const remote = await this.store.read(path)
      if (!remote) continue
      // inzwischen hier geändert oder Speichern begonnen: nicht überschreiben, das Speichern führt zusammen
      if (this.saving || this.timer || !same(this.#live(path), this.base.get(path) ?? emptyDoc(path))) continue
      applyDoc(this.data, path, remote.data)
      this.version++
      this.base.set(path, clone(remote.data))
      this.etags.set(path, remote.etag)
      changed.push({ path, by: remote.modifiedBy })
    }
    if (changed.length) this.onRemoteChange('refreshed', changed)
    return changed
  }
}

function emptyDoc(path) {
  if (MODULE_BY_PATH[path]) return MODULE_BY_PATH[path].empty()
  if (yearDocOf(path)) return yearDocOf(path).empty()
  if (path === DOC.objects) return { objects: [] }
  if (path === DOC.absences) return { absences: [] }
  if (path === DOC.absent) return { absent: [] }
  if (path === DOC.account) return { weeks: {}, pay: {} }
  if (isWeekPath(path)) {
    const monday = path.split('/').pop().replace('.json', '')
    return { monday, assignments: {}, overrides: {}, log: [] }
  }
  return undefined
}
