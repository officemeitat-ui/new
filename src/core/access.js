// Module und Rollen: Ein Tool für mehrere Aufgaben (Dienstplan, Lohn,
// Wasserzähler, Objektkontrolle …). Jede Rolle sieht bestimmte Module und darf
// in bestimmten Modulen ändern. Rollen kommen aus Entra ID: App-Rollen (auch
// über Gruppen zugewiesen) oder Mitgliedschaft in Microsoft-Gruppen
// (config.json → access.groups), dazu E-Mail-Listen in config.json.
//
// Echte Trennung der Daten: Jedes Modul speichert in eigenen Ordnern
// (data-service.js, dataRights). Die App liest nur die Ordner, die die Rolle
// braucht; die Rechte in SharePoint sichern das zusätzlich ab.
//
// zaehler, kontrolle, objektmappe und matten sind die eigenen Werkzeuge
// (werkzeuge/, src/ui/views/tools.js): Sie speichern selbst in ihren Ordnern
// der Bibliothek; die Rolle entscheidet, wer sie in der App sieht.

export const MODULES = {
  planung: 'Einsatzplanung',
  auswertung: 'Auswertung & Lohn',
  stammdaten: 'Stammdaten',
  zaehler: 'Wasserzähler-Ablesung',
  kontrolle: 'Objektkontrolle',
  objektmappe: 'Objektdoku',
  matten: 'Mattenwechsel',
  fahrzeuge: 'Fahrzeuge & Reifen',
  reklamationen: 'Reklamationen',
  material: 'Material & Lager',
  schluessel: 'Schlüsselbuch',
  unterweisungen: 'Unterweisungen & Fristen',
  anlagen: 'Anlagen & Prüffristen',
  regie: 'Regieberichte',
  termine: 'Termine',
  fakturierung: 'Fakturierung',
  einkauf: 'Einkauf & Kasse',
}

/** Modul einer Ansicht, wenn sie keines angibt: nach ihrer Gruppe im Register. */
export const GROUP_MODULE = { plan: 'planung', auswertung: 'auswertung', stamm: 'stammdaten', service: 'kontrolle', fuhrpark: 'fahrzeuge', lager: 'material' }

// Rollen-IDs = App-Rollen in Entra ID (Wert z. B. „Dienstplan.Ableser“ oder „ableser“)
export const DEFAULT_ROLES = {
  disposition: { label: 'Vollzugriff (Büro, IT)', modules: '*', edit: '*' },
  objektmanagement: { label: 'Objektmanagement', modules: ['planung', 'kontrolle', 'objektmappe', 'reklamationen', 'material', 'schluessel', 'termine', 'anlagen', 'regie'], edit: ['kontrolle', 'objektmappe', 'reklamationen', 'material', 'schluessel', 'termine', 'anlagen', 'regie'] },
  vorarbeiter: { label: 'Vorarbeiter/in', modules: ['zaehler'], edit: ['zaehler'] },
  // eigene Microsoft-Gruppe für den Mattenwechsel (Fahrer:innen, Disposition der Touren)
  mattenwechsel: { label: 'Mattenwechsel', modules: ['matten'], edit: ['matten'] },
  lohnverrechnung: { label: 'Lohnverrechnung', modules: ['auswertung'], edit: ['auswertung'] },
  objektleitung: { label: 'Objektleitung', modules: ['planung', 'zaehler', 'kontrolle', 'objektmappe', 'reklamationen', 'material', 'schluessel', 'unterweisungen', 'termine', 'anlagen', 'regie'], edit: ['zaehler', 'kontrolle', 'objektmappe', 'reklamationen', 'material', 'schluessel', 'unterweisungen', 'termine', 'anlagen', 'regie'] },
  // Anlagen & Prüffristen: Objektservice (Hausbetreuung) prüft vor Ort und trägt die Prüfungen ein;
  // Regieberichte: erfasst Sonderleistungen vor Ort und lässt sie am Handy unterschreiben
  objektservice: { label: 'Objektservice', modules: ['zaehler', 'kontrolle', 'objektmappe', 'reklamationen', 'material', 'schluessel', 'anlagen', 'regie'], edit: ['zaehler', 'kontrolle', 'reklamationen', 'material', 'anlagen', 'regie'] },
  // Lager und Einkauf: Bestand, Bestellungen, Ausgabe an die Objekte
  lager: { label: 'Lager & Einkauf', modules: ['material'], edit: ['material'] },
  ableser: { label: 'Ableser', modules: ['zaehler'], edit: ['zaehler'] },
  pruefer: { label: 'Prüfer/in', modules: ['kontrolle', 'objektmappe'], edit: ['kontrolle'] },
  fuhrpark: { label: 'Fuhrpark', modules: ['fahrzeuge'], edit: ['fahrzeuge'] },
  // Angebote, Rechnungen, Zahlungseingänge, Mahnungen (Fakturierung); Lieferanten, Eingangsrechnungen, Kassenbuch (Einkauf & Kasse)
  buchhaltung: { label: 'Buchhaltung', modules: ['fakturierung', 'einkauf'], edit: ['fakturierung', 'einkauf'] },
  lesen: { label: 'Nur lesen', modules: ['planung'], edit: [] },
}

const lower = (s) => String(s || '').trim().toLowerCase()
const includes = (list, m) => list === '*' || (Array.isArray(list) && list.includes(m))

/** Rolle aus einem Token-Wert: „disposition“, „Dienstplan.Disposition“ … */
function roleIdOf(claim, roles) {
  const c = lower(claim)
  return Object.keys(roles).find((id) => c === id || c.endsWith(`.${id}`)) || null
}

/** Gruppen-IDs je Rolle aus config.json → access.groups { rolle: [Gruppen-ID, …] } (auch einzelne ID als Text). */
const groupList = (v) => (Array.isArray(v) ? v : [v]).map(lower).filter(Boolean)

/**
 * Zugriff der angemeldeten Person.
 *  roleClaims:  App-Rollen aus dem Entra-Token (Claim „roles“)
 *  groupClaims: Objekt-IDs der Microsoft-Gruppen aus dem Token (Claim „groups“)
 *  email:       Anmeldename
 *  access:      config.json → access { planners[], members{ rolle: [E-Mails] }, groups{ rolle: [Gruppen-IDs] }, roles{ eigene Rollen } }
 *  preview:     Rolle zur Vorschau (nur Browser-Modus)
 *  strict:      ohne Rolle kein Zugriff (Betrieb mit SharePoint); sonst wie bisher
 */
export function resolveAccess({ roleClaims = [], groupClaims = [], email = '', access = {}, preview = null, strict = false } = {}) {
  const roles = { ...DEFAULT_ROLES, ...(access.roles || {}) }
  const found = new Set()
  if (preview && roles[preview]) found.add(preview)
  else {
    for (const claim of roleClaims) {
      const id = roleIdOf(claim, roles)
      if (id) found.add(id)
    }
    const groups = new Set(groupClaims.map(lower))
    for (const [id, list] of Object.entries(access.groups || {})) if (roles[id] && groupList(list).some((g) => groups.has(g))) found.add(id)
    for (const [id, list] of Object.entries(access.members || {})) if (roles[id] && (list || []).map(lower).includes(lower(email))) found.add(id)
    const planners = (access.planners || []).map(lower)
    if (planners.includes(lower(email))) found.add('disposition')
    const configured = planners.length || Object.keys(access.members || {}).length || Object.keys(access.groups || {}).length || roleClaims.length
    // Betrieb: wer keiner Gruppe zugeordnet ist, sieht nichts. Sonst wie bisher (Probe, Browser-Modus).
    if (!found.size && !strict) found.add(configured ? 'lesen' : 'disposition')
  }
  const list = [...found].map((id) => ({ id, ...roles[id] }))
  const sees = (m) => list.some((r) => includes(r.modules, m))
  const canEdit = (m) => list.some((r) => includes(r.edit, m)) && sees(m)
  return {
    roles: list.map((r) => r.id),
    label: list.map((r) => r.label).join(', ') || 'Keine Berechtigung',
    all: list.some((r) => r.modules === '*' && r.edit === '*'),
    sees,
    canEdit,
  }
}

export const roleOptions = (access = {}) => Object.entries({ ...DEFAULT_ROLES, ...(access.roles || {}) }).map(([id, r]) => [id, r.label])
