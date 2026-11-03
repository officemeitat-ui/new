// Cleos Verständnis: findet zu einer Frage in Alltagssprache die passenden Hilfe-Themen
// (src/help/topics.js), ganz ohne KI und ohne Netz. Umlaute und Groß/klein egal, Tippfehler und
// Wortendungen werden toleriert („urlaube“, „krankmeldung“, „rechnungen“), Synonyme aus dem
// Betrieb („Dienstplan“ = Woche planen, „Schnee“ = Winterdienst). Reine Funktionen, getestet in
// test/help.test.js.

const STOP = new Set(
  'a ab aber alle allem als also am an auch auf aus bei bin bis bitte da damit dann das dass dein deine dem den der des die dies diese dir doch du durch ein eine einem einen einer es etwas fuer gibt geht hab habe hallo hat hier ich ihr im in ist ja jetzt kann kannst man mein meine mich mir mit muss nach nicht noch nur ob oder sich sie sind so soll um und uns von vom was welche wenn wer wie wieso wird wo zu zum zur ueber mal gerne bitte cleo hey hi'.split(' '),
)

/** Gleiche Bedeutung im Betrieb: Wort → zusätzliche Suchwörter. */
export const SYNONYMS = {
  urlaub: ['abwesenheit', 'urlaubsantrag'],
  krank: ['krankenstand', 'abwesenheit', 'krankmeldung'],
  krankmeldung: ['krankenstand'],
  dienstplan: ['woche', 'planen', 'wochenuebersicht'],
  plan: ['woche', 'planen'],
  schicht: ['einsatz', 'dienst'],
  dienst: ['einsatz'],
  schnee: ['winterdienst', 'schneealarm'],
  glatteis: ['winterdienst', 'streuen'],
  streuen: ['winterdienst'],
  wetter: ['winterdienst', 'radar', 'vorhersage'],
  regen: ['radar', 'nowcast', 'wetter'],
  stempeln: ['zeiterfassung', 'qr'],
  stunden: ['zeiterfassung', 'wochenzettel', 'ueberstunden'],
  rechnung: ['fakturierung', 'beleg'],
  faktura: ['fakturierung'],
  mahnung: ['mahnwesen', 'zahlungserinnerung', 'offene'],
  zahlung: ['offene', 'posten', 'bank'],
  angebot: ['fakturierung', 'kalkulation'],
  kunde: ['kunden', 'objekt'],
  wasser: ['wasserzaehler', 'zaehler'],
  zaehlerstand: ['wasserzaehler'],
  ablesen: ['wasserzaehler', 'zaehler'],
  doku: ['objektdoku', 'objektmappe'],
  mappe: ['objektmappe', 'objektdoku'],
  matte: ['mattenwechsel'],
  matten: ['mattenwechsel'],
  schluessel: ['schluesselbuch'],
  auto: ['fahrzeug', 'fahrzeuge'],
  reifen: ['reifenwechsel', 'fahrzeuge'],
  pickerl: ['service', 'fahrzeuge'],
  lager: ['material'],
  bestellen: ['bestellung', 'material'],
  handy: ['mobil', 'plan am handy', 'portal'],
  app: ['installieren'],
  lohn: ['lohnverrechnung', 'lohnexport', 'auszahlung'],
  gehalt: ['lohn', 'auszahlung'],
  ki: ['assistent'],
  chatbot: ['assistent', 'cleo'],
  passwort: ['anmeldung', 'microsoft'],
  login: ['anmeldung'],
  einloggen: ['anmeldung'],
  rechte: ['berechtigungen', 'rollen'],
  dunkel: ['darstellung', 'dunkelmodus'],
  farbe: ['darstellung', 'farbschema'],
  schrift: ['darstellung', 'schriftgroesse'],
  offline: ['abgleich', 'ohne netz'],
  sync: ['abgleich'],
  tauschen: ['einsatzboerse', 'dienst abgeben'],
  einspringen: ['vertretung', 'vertretungen'],
  vertreten: ['vertretung'],
  beschwerde: ['reklamation'],
  mangel: ['reklamation'],
  schulung: ['unterweisung', 'unterweisungen'],
  frist: ['fristen', 'unterweisungen'],
  muell: ['muellplan', 'tonnen'],
  tonne: ['muellplan'],
  termin: ['termine', 'kalender', 'outlook'],
  besprechung: ['termin'],
  outlook: ['termine', 'kalender'],
  kosten: ['kalkulation', 'controlling'],
  umsatz: ['kennzahlen', 'fakturierung'],
  kennzahl: ['kennzahlen'],
}

/** Kleinbuchstaben, Umlaute ausgeschrieben, nur Buchstaben/Ziffern. */
export function normalize(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Wortstamm grob: häufige deutsche Endungen ab (nur bei längeren Wörtern). */
export function stem(word) {
  let w = word
  for (const end of ['ungen', 'ung', 'innen', 'heiten', 'heit', 'keiten', 'keit', 'en', 'er', 'es', 'e', 'n', 's']) {
    if (w.length - end.length >= 4 && w.endsWith(end)) {
      w = w.slice(0, -end.length)
      break
    }
  }
  return w
}

/** Suchwörter einer Frage (ohne Füllwörter), gestemmt, mit Synonymen. */
export function terms(text, { synonyms = true } = {}) {
  const words = normalize(text)
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w))
  const out = new Set()
  for (const w of words) {
    out.add(stem(w))
    if (!synonyms) continue
    for (const [key, extra] of Object.entries(SYNONYMS)) {
      if (w === key || stem(w) === stem(key) || (w.length > 5 && w.startsWith(key))) for (const x of extra) for (const part of normalize(x).split(' ')) out.add(stem(part))
    }
  }
  return [...out]
}

/** Ähnlich genug? gleich, gemeinsamer Anfang (≥ 4 Zeichen) oder ein Tippfehler bei längeren Wörtern. */
const fold = (s) => s.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u') // Stand/Stände, Zahl/Zähler

export function similar(a, b) {
  if (a === b) return 1
  if (a.length >= 4 && fold(a) === fold(b)) return 1
  const short = a.length < b.length ? a : b
  const long = a.length < b.length ? b : a
  if (short.length >= 4 && long.startsWith(short)) return 0.85
  if (short.length >= 5 && long.includes(short)) return 0.6
  if (short.length >= 6 && Math.abs(a.length - b.length) <= 1 && distance(a, b) <= 1) return 0.75
  return 0
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[b.length]
}

const cache = new WeakMap()
/** Gewichtete Wörter eines Themas: Fragen 3, Titel 2.5, Antwort 1, Schritte und Tipps 0.5. */
function index(topic) {
  if (cache.has(topic)) return cache.get(topic)
  const map = new Map()
  const add = (text, weight) => {
    for (const t of terms(text, { synonyms: false })) map.set(t, Math.max(map.get(t) || 0, weight))
  }
  for (const q of topic.q || []) add(q, 3)
  add(topic.title, 2.5)
  add(topic.answer, 1)
  for (const s of [...(topic.steps || []), ...(topic.tips || [])]) add(s, 0.5)
  const phrases = (topic.q || []).map(normalize).filter((p) => p.includes(' '))
  const entry = { map, phrases, title: normalize(topic.title) }
  cache.set(topic, entry)
  return entry
}

const hasTerm = (topic, q) => {
  for (const t of index(topic).map.keys()) if (similar(q, t) >= 0.85) return true
  return false
}

/**
 * Seltene Wörter zählen mehr („wasserzaehler“ mehr als „eintragen“): Gewicht je Suchwort aus der
 * Zahl der Themen, in denen es vorkommt (0,4 … 1).
 */
export function rarity(topics, qs) {
  const n = topics.length
  const max = Math.log((n + 1) / 0.5)
  return Object.fromEntries(qs.map((q) => [q, 0.4 + (0.6 * Math.log((n + 1) / (topics.filter((t) => hasTerm(t, q)).length + 0.5))) / max]))
}

/** Wie gut passt ein Thema zur Frage? (0 = gar nicht). weights: aus rarity() */
export function score(topic, query, weights = null) {
  const qs = terms(query)
  if (!qs.length) return 0
  const { map, phrases, title } = index(topic)
  let sum = 0
  for (const q of qs) {
    let best = 0
    for (const [t, w] of map) {
      const s = similar(q, t)
      if (s) best = Math.max(best, s * w)
      if (best >= 3) break
    }
    // lange Wörter (meist zusammengesetzte Hauptwörter wie „Zählerstand“) sagen mehr als kurze Zeitwörter
    const specific = 1 + Math.max(0, Math.min(q.length, 14) - 7) * 0.05
    sum += best * specific * (weights?.[q] ?? 1)
  }
  const n = normalize(query)
  if (phrases.some((p) => n.includes(p))) sum += 4
  if (title && n.includes(title)) sum += 3
  return sum / Math.sqrt(qs.length)
}

/**
 * Beste Themen zur Frage. visible: Ansicht sichtbar? (Rolle) – Themen ohne Ansicht gelten immer.
 * Ergebnis: [{ topic, score }] absteigend, nur mit Treffer.
 */
export function search(topics, query, { limit = 3, visible = () => true, view = '' } = {}) {
  const weights = topics.length > 8 ? rarity(topics, terms(query)) : null
  return topics
    .filter((t) => !t.view || visible(t.view))
    .map((topic) => ({ topic, score: score(topic, query, weights) + (view && topic.view === view ? 0.4 : 0) }))
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** Ab hier ist Cleo sich sicher. */
export const SURE = 3

/** Begriff aus dem Glossar („Was ist eine Stammkraft?“). */
export function glossary(entries, query) {
  const n = normalize(query)
  const m = /(?:was (?:ist|sind|heisst|bedeutet)|erklaer\w*|bedeutung von)\s+(?:ein |eine |einen |der |die |das )?(.+)$/.exec(n)
  const want = m ? m[1] : n
  const words = terms(want, { synonyms: false })
  if (!words.length) return null
  let best = null
  for (const e of entries) {
    const t = terms(e.term, { synonyms: false })
    const s = t.length && words.length <= t.length + 1 ? t.reduce((sum, x) => sum + Math.max(0, ...words.map((w) => similar(w, x))), 0) / t.length : 0
    if (s >= 0.8 && (!best || s > best.s)) best = { entry: e, s }
  }
  return best?.entry || null
}

/** Plaudern: Gruß, Dank, Wer bist du … → Antwort und Stimmung, sonst null. */
export function smalltalk(query) {
  const n = ` ${normalize(query)} `
  if (/ (hallo|hi|hey|servus|gruess gott|guten (morgen|tag|abend)|moin|griass di) /.test(n) && n.trim().split(' ').length <= 4) return { mood: 'hallo', text: 'Servus! Cleo, Sauberheld, zu Diensten. Sag mir, was du vorhast – zum Beispiel „Urlaub eintragen“ oder „Wie schreibe ich eine Rechnung?“ – und ich flieg dich hin.' }
  if (/ (danke|dankeschoen|merci|super|passt|top|perfekt) /.test(n)) return { mood: 'fertig', text: 'Gern geschehen – sauber gelöst! Wenn du mich wieder brauchst: Ich häng hier unten rechts ab.' }
  if (/ wer bist du | was bist du | wie heisst du /.test(n)) return { mood: 'froh', text: 'Ich bin Cleo, der Sauberheld der Cleanos App! Meine Superkräfte: Ich kenne jede Funktion, zeige dir, wo sie ist, und erkläre sie Schritt für Schritt. Kein Internet nötig, nichts wird gespeichert – und Fenster putze ich nebenbei auch.' }
  if (/ (witz|lustig|superkraft|superkraefte|held) /.test(n) && n.trim().split(' ').length <= 6) return { mood: 'froh', text: 'Warum putzen Superhelden so gern Fenster? Damit sie den Durchblick behalten! Und jetzt: Womit kann ich dir helfen?' }
  if (/ (was kannst du|hilfe|help|anleitung) /.test(n) && n.trim().split(' ').length <= 4) return { mood: 'zeigt', text: 'Mein Revier ist die ganze App: Planung, Zeiterfassung, Wetter und Winterdienst, Objekte, Material, Fahrzeuge, Fakturierung und Verwaltung. Tipp eine Frage oder wähle unten ein Thema. Zum Schmökern gibt es die „Anleitung“.' }
  return null
}
