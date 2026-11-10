// Aushang (QR) im Objekt: je Objekt ein QR-Code zum Aushängen (Stiegenhaus, Büro des Kunden). Wer ihn scannt –
// Hausbewohner, Hausverwaltung, Mitarbeitende des Kunden –, meldet ohne Anmeldung ein Problem: Kategorie, Ort im Objekt,
// Text, freiwillig ein Foto und Kontaktdaten, „Rückmeldung gewünscht“. Seite am Webspace: kunden.php?q=CODE (eigener
// Code je Objekt, nicht der des Kundenbereichs; der Webspace kennt nur den Hashwert). Den Stand sieht die meldende
// Person über einen eigenen Folge-Code (kunden.php?s=CODE, erzeugt der Webspace beim Senden): eingegangen, in Arbeit,
// erledigt und eine öffentliche Antwort, sonst nichts.
//
// Die Meldungen liegen am Webspace bei denen des Kundenbereichs (gleiche Abholung, gleiche Grenzen und Fristen) und
// werden in der App zu Reklamationen des Objekts mit Eingang „Aushang (QR)“; die Kategorie wird zur Art.
// Gespeichert in kundenbereich/kundenbereich.json → aushang: [{ id, objectId, title, token, active, createdAt,
// createdBy, changedAt, changedBy, renewedAt, publishedAt, error }]. Rein rechnend, ohne Netz testbar.

import { dayOf, defaultDue } from './complaints.js'

export const AUSHANG_SOURCE = 'Aushang (QR)'
export const POSTER_ID_PATTERN = /^ah[a-f0-9]{10}$/

/**
 * Kategorien der Seite (gleiche Schlüssel in kunden.php und aushang-texte.php) und die Art der Reklamation dazu.
 * Müll zählt zur Reinigung (Müllraum, Müllplatz; kurze Frist), nicht erledigte Reinigung und Winterdienst als nicht
 * erbrachte Leistung. Die Kategorie selbst steht in der ersten Zeile der Beschreibung.
 */
export const CATEGORIES = {
  reinigung: { label: 'Reinigung nicht erledigt', kind: 'Leistung nicht erbracht' },
  verschmutzung: { label: 'Verschmutzung', kind: 'Reinigung mangelhaft' },
  schaden: { label: 'Schaden/Defekt', kind: 'Schaden' },
  muell: { label: 'Müll', kind: 'Reinigung mangelhaft' },
  winterdienst: { label: 'Winterdienst', kind: 'Leistung nicht erbracht' },
  sonstiges: { label: 'Sonstiges', kind: 'Sonstiges' },
}
export const categoryLabel = (key) => (CATEGORIES[key] || CATEGORIES.sonstiges).label
export const kindOfCategory = (key) => (CATEGORIES[key] || CATEGORIES.sonstiges).kind

/** Link im QR-Code. Im Link steht nur der Code, nichts über das Objekt. */
export const posterLink = (address, token) => `${String(address).replace(/\/?$/, '/')}kunden.php?q=${encodeURIComponent(token)}`

/** Kennung eines Aushangs am Webspace, z. B. „ah3f9a1c07d2“. */
export function newPosterId(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return `ah${[...random(5)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** Bezeichnung auf der Seite und am Aushang: frei wählbar, Vorschlag ist der Name des Objekts. */
export const defaultPosterTitle = (object = {}) => String(object.name || '').trim().slice(0, 120)

/** Ein Aushang gilt (Code am Webspace), wenn er eingeschaltet ist und einen Code hat. */
export const posterActive = (p) => !!p && !!p.active && !!p.token

/** Aushang eines Objekts (je Objekt höchstens einer). */
export const posterOf = (posters = [], objectId) => (posters || []).find((p) => p?.objectId === objectId) || null

/** Was der Webspace je Aushang speichert (aktion=aushang): Kennung, Hashwert des Codes, Bezeichnung, Objekt. */
export function posterPayload(poster, hash) {
  return { id: poster.id, hash, titel: String(poster.title || '').trim().slice(0, 120), objektId: String(poster.objectId || '').slice(0, 60) }
}

/**
 * Kurzer Stand eines Aushangs für die Liste in der App. „aus-offen“: ausgeschaltet, aber am Webspace gilt der Code noch
 * (nach dem Ausschalten noch nicht übertragen).
 */
export function posterState(p) {
  const pending = !!p?.error || !p?.publishedAt || (!!p.changedAt && p.changedAt > p.publishedAt)
  if (!p?.active) return pending && p?.publishedAt ? { key: 'aus-offen', label: 'aus, am Webspace noch nicht entfernt' } : { key: 'aus', label: 'aus' }
  if (p.error) return { key: 'fehler', label: 'nicht übertragen' }
  if (pending) return { key: 'neu', label: 'noch nicht übertragen' }
  return { key: 'aktiv', label: 'aktiv' }
}

/** Kommt eine Meldung des Webspace vom Aushang (nicht vom Link eines Kunden)? */
export const isPosterReport = (m) => m?.quelle === 'aushang'
/** Reklamation aus einem Aushang? */
export const isPosterComplaint = (c) => !!c?.portal?.aushang

/**
 * Meldung vom Aushang → Reklamation des Objekts (Eingang „Aushang (QR)“). Kategorie → Art, Kategorie und Ort in der
 * ersten Zeile der Beschreibung, Kontakt nur, wenn angegeben. Die Kennung folgt aus der Meldung (wie beim
 * Kundenbereich), damit zwei Geräte, die gleichzeitig übernehmen, dieselbe Reklamation anlegen.
 */
export function complaintFromPosterReport(m, { now = new Date().toISOString() } = {}) {
  const kind = kindOfCategory(m.kategorie)
  const received = Number(m.erstellt) ? new Date(Number(m.erstellt) * 1000).toISOString() : now
  // Tag des Eingangs in Wien (0:20 Uhr ist schon der neue Tag, nicht der UTC-Vortag)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(m.datum || '') ? m.datum : dayOf(received)
  const ort = String(m.ort || '').trim()
  const head = [categoryLabel(m.kategorie), ort && `Ort: ${ort}`].filter(Boolean).join(' · ')
  const k = m.kontakt || {}
  const contact = [k.name, k.telefon, k.email].map((x) => String(x || '').trim()).filter(Boolean).join(', ')
  const callback = !!m.rueckmeldung
  return {
    id: `rk${String(m.id).replace(/[^a-f0-9]/g, '')}`,
    objectId: String(m.objektId || ''),
    date: day,
    received,
    source: AUSHANG_SOURCE,
    kind,
    text: `${head}\n${String(m.text || '').trim()}`.slice(0, 2000),
    contact: callback && contact ? `${contact} (Rückmeldung gewünscht)` : contact,
    employees: [],
    measure: '',
    due: defaultDue(kind, dayOf(received)),
    status: 'offen',
    result: '',
    publicReply: '',
    informed: false,
    by: AUSHANG_SOURCE,
    history: [{ at: received, by: AUSHANG_SOURCE, text: `gemeldet über den Aushang (QR)${m.titel ? ` „${m.titel}“` : ''}${callback ? ', Rückmeldung gewünscht' : ''}` }],
    portal: { id: String(m.id), link: '', aushang: String(m.aushang || ''), sent: 'eingegangen|' },
  }
}

/** Öffentliche Antwort für den Statuslink (sieht jede Person mit dem Link): nur, was ausdrücklich dort eingetragen ist. */
export const publicReplyOf = (c) => String(c?.publicReply || '').trim().slice(0, 1000)

