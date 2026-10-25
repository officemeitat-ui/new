// Module und Rollen: Ein Tool für mehrere Aufgaben (Dienstplan, Lohn,
// Objektkontrolle, Zählerstände …). Jede Rolle sieht bestimmte Module und darf
// in bestimmten Modulen ändern. Rollen kommen aus Entra ID (App-Rollen, auch
// über Gruppen zugewiesen) oder aus E-Mail-Listen in config.json.
//
// Echte Trennung der Daten: Jedes Modul speichert in eigenen Dateien
// (data-service.js). Fehlt in SharePoint das Leserecht auf eine Datei, bleibt
// das Modul leer, statt dass die App abbricht.

export const MODULES = {
  planung: 'Dienstplan',
  auswertung: 'Auswertung & Lohn',
  stammdaten: 'Stammdaten',
  zaehler: 'Zählerstände',
  kontrolle: 'Objektkontrolle',
  objektmappe: 'Objektmappe',
  fahrzeuge: 'Fahrzeuge & Reifen',
}

/** Modul einer Ansicht, wenn sie keines angibt: nach ihrer Gruppe im Register. */
export const GROUP_MODULE = { plan: 'planung', auswertung: 'auswertung', stamm: 'stammdaten', service: 'kontrolle' }

// Rollen-IDs = App-Rollen in Entra ID (Wert z. B. „Dienstplan.Ableser“ oder „ableser“)
export const DEFAULT_ROLES = {
  disposition: { label: 'Disposition / Büro', modules: '*', edit: '*' },
  lohnverrechnung: { label: 'Lohnverrechnung', modules: ['auswertung'], edit: ['auswertung'] },
  objektleitung: { label: 'Objektleitung', modules: ['planung', 'zaehler', 'kontrolle', 'objektmappe'], edit: ['zaehler', 'kontrolle', 'objektmappe'] },
  objektservice: { label: 'Objektservice', modules: ['zaehler', 'kontrolle', 'objektmappe'], edit: ['zaehler', 'kontrolle'] },
  ableser: { label: 'Ableser', modules: ['zaehler'], edit: ['zaehler'] },
  pruefer: { label: 'Prüfer/in', modules: ['kontrolle', 'objektmappe'], edit: ['kontrolle'] },
  fuhrpark: { label: 'Fuhrpark', modules: ['fahrzeuge'], edit: ['fahrzeuge'] },
  lesen: { label: 'Nur lesen', modules: ['planung'], edit: [] },
}

const lower = (s) => String(s || '').trim().toLowerCase()
const includes = (list, m) => list === '*' || (Array.isArray(list) && list.includes(m))

/** Rolle aus einem Token-Wert: „disposition“, „Dienstplan.Disposition“ … */
function roleIdOf(claim, roles) {
  const c = lower(claim)
  return Object.keys(roles).find((id) => c === id || c.endsWith(`.${id}`)) || null
}

/**
 * Zugriff der angemeldeten Person.
 *  roleClaims: App-Rollen aus dem Entra-Token (Claim „roles“)
 *  email:      Anmeldename
 *  access:     config.json → access { planners[], members{ rolle: [E-Mails] }, roles{ eigene Rollen } }
 *  preview:    Rolle zur Vorschau (nur Browser-Modus)
 */
export function resolveAccess({ roleClaims = [], email = '', access = {}, preview = null } = {}) {
  const roles = { ...DEFAULT_ROLES, ...(access.roles || {}) }
  const found = new Set()
  if (preview && roles[preview]) found.add(preview)
  else {
    for (const claim of roleClaims) {
      const id = roleIdOf(claim, roles)
      if (id) found.add(id)
    }
    for (const [id, list] of Object.entries(access.members || {})) if (roles[id] && (list || []).map(lower).includes(lower(email))) found.add(id)
    const planners = (access.planners || []).map(lower)
    if (planners.includes(lower(email))) found.add('disposition')
    const configured = planners.length || Object.keys(access.members || {}).length || roleClaims.length
    if (!found.size) found.add(configured ? 'lesen' : 'disposition') // nichts eingerichtet: alle wie bisher
  }
  const list = [...found].map((id) => ({ id, ...roles[id] }))
  const sees = (m) => list.some((r) => includes(r.modules, m))
  const canEdit = (m) => list.some((r) => includes(r.edit, m)) && sees(m)
  return {
    roles: list.map((r) => r.id),
    label: list.map((r) => r.label).join(', '),
    all: list.some((r) => r.modules === '*' && r.edit === '*'),
    sees,
    canEdit,
  }
}

export const roleOptions = (access = {}) => Object.entries({ ...DEFAULT_ROLES, ...(access.roles || {}) }).map(([id, r]) => [id, r.label])
