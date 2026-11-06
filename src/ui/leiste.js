// Leiste unten am Handy: welche Plätze gelten. Reine Logik ohne DOM (Tests: test/leiste.test.js),
// gezeichnet und bearbeitet wird sie in mobile.js.
//
// Was gilt, in dieser Reihenfolge (das Spätere gewinnt):
//  1. Vorgabe der Rolle: mit Einsatzplanung wie bisher Woche, Vertretung, „+ Abwesend“, Zettel;
//     ohne Einsatzplanung nur die eigenen Bereiche (ROLE_DEFAULTS, für eigene Rollen die eigenen
//     Ansichten), keine allgemeinen wie Kennzahlen oder Anleitung (die stehen unter „Mehr“).
//  2. Vorgabe des Büros: config.json → access.roles.<rolle>.leiste
//  3. eigene Wahl („Leiste unten anpassen“), je Gerät und angemeldetem Konto gespeichert.
// Was die Person nicht (mehr) sehen darf, fällt still heraus; eine eigene Wahl wird dann mit der
// Vorgabe aufgefüllt. Höchstens 4 Plätze, „Mehr“ steht immer zusätzlich ganz rechts.
//
// Ein Platz ist
//  - eine Ansicht: ihre id, z. B. 'zaehler', 'fakturierung', 'home' (Übersicht),
//  - ein Bereich des Menüs: 'sec:<Abschnitt>', z. B. 'sec:finanzen' (öffnet ein Blatt mit seinen Ansichten),
//  - '+abwesend': der runde Knopf „+ Abwesend“ (nur mit Recht, in der Einsatzplanung zu ändern).
//
// Ansichten kommen als { id, module, section, mobile } in der Reihenfolge des Menüs
// (module: Rollen-Modul oder '*', section: Menü-Abschnitt, mobile: hat einen eigenen Handy-Eintrag).

export const MAX_SLOTS = 4
export const ABSENCE = '+abwesend'
export const SEC = 'sec:'

/** Vorgabe mit Einsatzplanung (wie bisher): Woche, Vertretung, „+ Abwesend“ in der Mitte, Zettel. */
export const PLAN_DEFAULT = ['week', 'coverage', ABSENCE, 'sheet']

/** Vorgabe je Rolle ohne Einsatzplanung: nur die eigenen Bereiche, das Wichtigste für unterwegs zuerst. */
export const ROLE_DEFAULTS = {
  ableser: ['zaehler'],
  vorarbeiter: ['zaehler'],
  mattenwechsel: ['matten'],
  pruefer: ['kontrolle', 'objektmappe'],
  buchhaltung: ['fakturierung', 'einkauf', 'kassenbuch', 'umsatzsteuer'],
  lager: ['material'],
  fuhrpark: ['fahrzeuge'],
  lohnverrechnung: ['payroll', 'overtime', 'controlling'],
  objektservice: ['zaehler', 'kontrolle', 'anlagen', 'regie'],
}

/** Allgemeine Ansicht (Übersicht, Kennzahlen, Anleitung, Digitale Mitarbeiter): nicht in der Vorgabe ohne Planung. */
export const isGeneral = (v) => v.module === '*' && v.section === 'start'

/** Gibt es den Platz für diese Person? */
export function validSlot(slot, { views = [], absence = false } = {}) {
  if (typeof slot !== 'string' || !slot) return false
  if (slot === ABSENCE) return !!absence
  if (slot.startsWith(SEC)) {
    const id = slot.slice(SEC.length)
    return id !== 'start' && views.some((v) => v.section === id)
  }
  return views.some((v) => v.id === slot)
}

/** Nur gültige Plätze, jeder einmal. */
const clean = (list, ctx) => [...new Set((Array.isArray(list) ? list : []).filter((s) => validSlot(s, ctx)))]

/** Eigene Ansichten (ohne allgemeine): die mit eigenem Handy-Eintrag zuerst, sonst wie im Menü. */
export function ownViews(views = []) {
  const own = views.filter((v) => !isGeneral(v))
  return [...own.filter((v) => v.mobile), ...own.filter((v) => !v.mobile)].map((v) => v.id)
}

/**
 * Vorgabe ohne eigene Wahl.
 * roles: Rollen der Person; roleConfig: config.json → access.roles (nur „leiste“ zählt hier);
 * absence: darf Abwesenheiten eintragen.
 */
export function defaultSlots({ views = [], roles = [], roleConfig = {}, absence = false } = {}) {
  const ctx = { views, absence }
  const office = clean(roles.flatMap((r) => (Array.isArray(roleConfig?.[r]?.leiste) ? roleConfig[r].leiste : [])), ctx)
  if (office.length) return office.slice(0, MAX_SLOTS)
  let list
  if (views.some((v) => v.id === 'week')) list = clean(PLAN_DEFAULT, ctx)
  else {
    const known = roles.flatMap((r) => ROLE_DEFAULTS[r] || [])
    // eigene Rollen aus config.json (ohne Eintrag oben): ihre eigenen Ansichten
    const generic = !roles.length || roles.some((r) => !ROLE_DEFAULTS[r]) ? ownViews(views) : []
    list = clean([...known, ...generic], ctx)
  }
  // nur allgemeine Ansichten sichtbar: wenigstens die Übersicht
  if (!list.length) list = clean([views.some((v) => v.id === 'home') ? 'home' : views[0]?.id], ctx)
  return list.slice(0, MAX_SLOTS)
}

/**
 * Plätze der Leiste: die eigene Wahl (choice), bereinigt und mit der Vorgabe auf ihre Länge
 * aufgefüllt, sonst die Vorgabe. Immer höchstens MAX_SLOTS.
 */
export function leisteSlots({ choice = null, ...input } = {}) {
  const base = defaultSlots(input)
  if (!Array.isArray(choice) || !choice.length) return base
  const want = Math.min(choice.length, MAX_SLOTS)
  const kept = clean(choice, { views: input.views || [], absence: input.absence }).slice(0, MAX_SLOTS)
  for (const s of base) if (kept.length < want && !kept.includes(s)) kept.push(s)
  return kept
}

// ---------------------------------------------------------------- Bearbeiten

/**
 * Platz pos (0 = ganz links) auf slot setzen; leer ('' oder null) nimmt ihn heraus, die übrigen rücken
 * nach links (die Leiste hat keine Lücken). Ein freier Platz rechts hängt an. Steht slot schon auf
 * einem anderen Platz, bleibt alles, wie es ist (keine doppelten Plätze).
 */
export function setSlot(list, pos, slot) {
  if (!Number.isInteger(pos) || pos < 0 || pos >= MAX_SLOTS) return list
  if (!slot) return pos < list.length ? list.filter((_, i) => i !== pos) : list
  const at = list.indexOf(slot)
  if (at >= 0) return list
  if (pos >= list.length) return list.length < MAX_SLOTS ? [...list, slot] : list
  return list.map((s, i) => (i === pos ? slot : s))
}

/** Platz um delta Stellen verschieben (−1 nach links, +1 nach rechts). */
export function moveSlot(list, slot, delta) {
  const i = list.indexOf(slot)
  const j = i + delta
  if (i < 0 || j < 0 || j >= list.length) return list
  const out = [...list]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

export const sameSlots = (a = [], b = []) => a.length === b.length && a.every((s, i) => s === b[i])

/**
 * Schlüssel der eigenen Wahl: je angemeldetem Konto (E-Mail, damit ein geteiltes Handy nichts
 * vermischt), im Browser-Modus ohne Anmeldung je Rolle der Vorschau („Ansicht als …“).
 */
export const accountKey = ({ email = '', previewRole = '' } = {}) => (email ? `konto:${String(email).trim().toLowerCase()}` : `vorschau:${previewRole || 'disposition'}`)

/** Eigene Wahl speichern: gleich der Vorgabe (oder leer) → Eintrag weg, dann gilt wieder die Vorgabe. */
export function storeChoice(store, key, list, defaults) {
  const out = { ...(store || {}) }
  if (!Array.isArray(list) || !list.length || sameSlots(list, defaults)) delete out[key]
  else out[key] = [...list]
  return out
}

// ---------------------------------------------------------------- Beschriftung

/**
 * Kurze Namen für die Leiste: gelten, wenn der volle Name auf dem Platz nicht passt (mobile.js misst
 * nach dem Zeichnen), damit bei 390 px Breite mit fünf Knöpfen nichts umbricht oder abgeschnitten wird.
 */
export const SHORT_LABELS = {
  week: 'Woche',
  coverage: 'Vertretung',
  sheet: 'Zettel',
  assistenz: 'Assistenz',
  due: 'Periodisch',
  zeiten: 'Zeiten',
  nachweis: 'Nachweis',
  controlling: 'Controlling',
  fakturierung: 'Rechnungen',
  kassenbuch: 'Kasse',
  umsatzsteuer: 'Steuer',
  payroll: 'Auswertung',
  zaehler: 'Zähler',
  reklamationen: 'Reklamation',
  kontrolle: 'Kontrolle',
  kundenbereich: 'Kunden',
  schluessel: 'Schlüssel',
  matten: 'Matten',
  qualitaet: 'Qualität',
  staff: 'Personal',
  absences: 'Abwesenheit',
  berechtigungen: 'Rechte',
  system: 'System',
  unterweisungen: 'Schulungen',
  zufriedenheit: 'Umfrage',
  bewerber: 'Bewerber',
  eintritt: 'Eintritt',
  arbeitsschutz: 'Schutz',
}
/** Diese behalten ihren kurzen Namen immer (so kennt man die Leiste seit jeher). */
const ALWAYS_SHORT = new Set(['week', 'coverage', 'sheet'])
export const SECTION_SHORT = { einsatz: 'Einsätze', objekte: 'Objekte', betrieb: 'Material', verwaltung: 'Verwaltung' }

const firstPart = (label) => String(label || '').split(/\s+(?:&|und|–)\s+|\s*\(/)[0]
const pair = (text, short) => ({ text, short: short && short !== text ? short : null })

/**
 * Beschriftung einer Ansicht in der Leiste: { text, short }. text steht da; passt er nicht auf den
 * Platz, gilt short (null: es gibt nichts Kürzeres, die Leiste kürzt dann mit „…“).
 */
export function viewLabels(v) {
  if (v.mobile?.label) return pair(v.mobile.label)
  const text = String(v.label || v.id)
  const short = SHORT_LABELS[v.id] || firstPart(text)
  return ALWAYS_SHORT.has(v.id) ? pair(short) : pair(text, short)
}

/** Beschriftung eines Bereichs in der Leiste: { text, short } wie bei viewLabels. */
export const sectionLabels = (id, label) => pair(String(label || id), SECTION_SHORT[id] || firstPart(label || id))
