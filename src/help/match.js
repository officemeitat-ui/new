// Cleos Verständnis: findet zu einer Frage in Alltagssprache die passenden Hilfe-Themen
// (src/help/topics.js), ganz ohne KI und ohne Netz. Umlaute und Groß/klein egal, Tippfehler und
// Wortendungen werden toleriert („urlaube“, „krankmeldung“, „rechnungen“), Synonyme aus dem
// Betrieb („Dienstplan“ = Woche planen, „Schnee“ = Winterdienst). Reine Funktionen, getestet in
// test/help.test.js.

const STOP = new Set(
  'a ab aber alle allem als also am an auch auf aus bei bin bis bitte da damit dann das dass dein deine dem den der des die dies diese dir doch du durch ein eine einem einen einer es etwas fuer gibt geht hab habe hallo hat hier ich ihr im in ist ja jetzt kann kannst man mein meine mich mir mit muss nach nicht noch nur ob oder sich sie sind so soll um und uns von vom was welche wenn wer wie wieso wird wo zu zum zur ueber mal gerne bitte hey hi mache machen macht tun tue geht gehts gehen funktioniert funktionieren brauche brauchen will moechte moechten sagen sag erklaer erklaere erklaeren ganz schnell einfach richtig meinen meinem meiner meines deinen deinem deiner unser unsere unseren unserem euer eure euren ihren ihrem seine seinen seinem einen einem einer eines denn dort heute nun also'.split(' '),
)

/** Allgemeine Tätigkeiten (Stämme): zählen in längeren Fragen weniger als das, worum es geht. */
const VERBS = new Set(['erstell', 'anleg', 'schreib', 'eintrag', 'erfass', 'schick', 'send', 'oeffn', 'find', 'such', 'seh', 'aender', 'loesch', 'bearbeit', 'wechsel', 'mitarbeit', 'arbeit', 'neu', 'neue'])

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
  schneit: ['winterdienst', 'schnee'],
  schneefall: ['winterdienst', 'schnee'],
  frost: ['winterdienst', 'glatteis'],
  eis: ['winterdienst', 'glatteis'],
  schicken: ['versenden', 'senden'],
  verschicken: ['versenden'],
  erstellen: ['anlegen', 'neu'],
  machen: ['anlegen'],
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

/** „Cleo, wie …“ / „Hey Cleo …“: Anrede vorne weg (sonst zöge sie das Thema „Cleo“ an). */
const unaddress = (text) => normalize(text).replace(/^(?:(?:hey|hallo|hi|servus|liebe|lieber)\s+)?cleo\s+(?=\S)/, '')

/**
 * Suchwörter je Wort der Frage: { main: Stamm, alts: Synonym-Stämme }. Füllwörter fallen weg
 * (außer die Frage besteht nur daraus).
 */
export function wordGroups(text) {
  const all = unaddress(text)
    .split(' ')
    .filter((w) => w.length > 1)
  const content = all.filter((w) => !STOP.has(w))
  const words = content.length ? content : all
  // trennbare Verben: „Wie trage ich Urlaub ein?“ → auch „eintrag…“
  const particle = ['ein', 'an', 'aus', 'ab', 'zu', 'auf', 'vor', 'nach', 'um', 'weg', 'fest', 'frei', 'zurueck', 'los'].find((p) => all.at(-1) === p && all.length > 1)
  const groups = []
  for (const w of words) {
    if (particle && w === particle) continue
    const main = stem(w)
    if (groups.some((g) => g.main === main)) continue
    const alts = new Set()
    if (particle) alts.add(stem(particle + w))
    for (const [key, extra] of Object.entries(SYNONYMS)) {
      if (w === key || main === stem(key) || (w.length > 5 && w.startsWith(key))) for (const x of extra) for (const part of normalize(x).split(' ')) if (stem(part) !== main) alts.add(stem(part))
    }
    groups.push({ main, alts: [...alts] })
  }
  return groups
}

/** Suchwörter einer Frage (ohne Füllwörter), gestemmt, mit Synonymen. */
export function terms(text, { synonyms = true } = {}) {
  const all = (synonyms ? unaddress(text) : normalize(text))
    .split(' ')
    .filter((w) => w.length > 1)
  // nur Füllwörter (z. B. „Cleo?“): dann doch diese Wörter
  const content = all.filter((w) => !STOP.has(w))
  const words = content.length ? content : all
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
  // ganze Fragen zählen extra – aber nur mit einem Inhaltswort („wo finde ich“ allein sagt nichts)
  const phrases = (topic.q || []).map(normalize).filter((p) => p.includes(' ') && terms(p, { synonyms: false }).some((t) => !VERBS.has(t)))
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
  return Object.fromEntries(
    qs.map((q) => {
      const r = Math.log((n + 1) / (topics.filter((t) => hasTerm(t, q)).length + 0.5)) / max
      // Tätigkeitswörter („erstellen“, „schicken“) sagen weniger als Hauptwörter („Angebot“, „Stempeln“)
      return [q, (0.15 + 0.85 * r ** 1.3) * (VERBS.has(q) ? 0.55 : 1)]
    }),
  )
}

/** Wie gut passt ein Thema zur Frage? (0 = gar nicht). weights: aus rarity() je Hauptwort */
export function score(topic, query, weights = null) {
  const groups = wordGroups(query)
  if (!groups.length) return 0
  const { map, phrases, title } = index(topic)
  const hit = (q) => {
    let best = 0
    for (const [t, w] of map) {
      const s = similar(q, t)
      if (s) best = Math.max(best, s * w)
      if (best >= 3) break
    }
    return best
  }
  let sum = 0
  for (const { main, alts } of groups) {
    // Synonyme sind Alternativen zum Wort (etwas schwächer), keine zusätzlichen Wörter
    const best = Math.max(hit(main), ...alts.map((a) => hit(a) * 0.85))
    // lange Wörter (meist zusammengesetzte Hauptwörter wie „Zählerstand“) sagen mehr als kurze Zeitwörter
    const specific = 1 + Math.max(0, Math.min(main.length, 14) - 7) * 0.05
    sum += best * specific * (weights?.[main] ?? 1)
  }
  const qs = groups
  const n = normalize(query)
  if (phrases.some((p) => n.includes(p))) sum += 4
  if (title && n.includes(title)) sum += 3
  // ein Wort zählt voll; mehrere: nach ihrer Seltenheit gewichtet (häufige Wörter verwässern weniger)
  const norm = Math.sqrt(groups.reduce((n, g) => n + (weights?.[g.main] ?? 1) ** 2, 0))
  return sum / norm
}

/**
 * Beste Themen zur Frage. visible: Ansicht sichtbar? (Rolle) – Themen ohne Ansicht gelten immer.
 * Ergebnis: [{ topic, score }] absteigend, nur mit Treffer.
 */
/** Heißt das Thema genau so (Kennung oder Titel)? „pickerl“ → Thema „pickerl“, „kalkulation“ → „Kalkulation“. */
function nameBonus(topic, query, qs) {
  const n = normalize(query)
  const id = topic.id.replace(/-/g, ' ')
  if (n && (n === normalize(topic.title) || n === id)) return 2
  const parts = new Set(topic.id.split('-').map(stem))
  return qs.some((q) => parts.has(q)) ? 0.6 : 0
}

export function search(topics, query, { limit = 3, visible = () => true, view = '' } = {}) {
  const qs = wordGroups(query).map((g) => g.main)
  // Seltenheit nur, wenn mehrere Wörter zusammen gewichtet werden; ein einzelnes Wort zählt voll
  const weights = topics.length > 8 && qs.length > 1 ? rarity(topics, qs) : null
  return topics
    .filter((t) => !t.view || visible(t.view))
    .map((topic) => {
      const base = score(topic, query, weights)
      return { topic, score: base ? base + nameBonus(topic, query, qs) + (view && topic.view === view ? 0.4 : 0) : 0 }
    })
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
  if (/ (danke|dankeschoen|merci|super|passt|top|perfekt) /.test(n)) return { mood: 'herz', text: 'Gern geschehen – sauber gelöst! Wenn du mich wieder brauchst: Ich häng hier ab – am PC unten rechts, am Handy oben neben der Glocke.' }
  const words = n.trim().split(' ').length
  // Jahreszeiten-Kostüme (nur kurze Fragen oder an Cleo gerichtet, nicht „Ist Ostermontag ein Feiertag?“)
  const season = / (halloween|advent|adventzeit|weihnachten|weihnacht|christkind|nikolaus|silvester|neujahr|fasching|krapfen|ostern|osterhase|fruehjahrsputz|saison|kostuem|kostuems|verkleidung|verkleidet) /.exec(n)
  if (season && !/ (feiertag|feiertage|zuschlag|zuschlaege|urlaub|dienst|plan|frei|offen) /.test(n) && (words <= 3 || / (du|dich|dein|deine|cleo|deko|kostuem|hut|muetze) /.test(n))) {
    const w = season[1]
    const mood = /hallo/.test(w) ? 'kuerbis' : /advent|weihn|christ|nikol/.test(w) ? 'geschenk' : /silv|neuj/.test(w) ? 'feiert' : /fasch|krapf/.test(w) ? 'krapfen' : /oster/.test(w) ? 'korb' : /fruehj/.test(w) ? 'wedel' : 'froh'
    return { mood, text: 'Je nach Jahreszeit zieh ich mich um: Hexenhut zu Halloween, Nikolausmütze im Advent, Partyhut zu Silvester, Narrenkappe und Krapfen im Fasching, Hasenohren zu Ostern und Kopftuch zum Frühjahrsputz – dazu ein bisschen Deko auf der Übersicht. Ausschalten oder vorab ansehen: Darstellung → Saison-Deko.' }
  }
  // Reinigungsbereiche: Cleo hat für alles das passende Werkzeug
  // nur Wörter ohne eigenes Hilfe-Thema (Fenster, Tiefgarage, Grundreinigung … beantworten die Themen)
  const service = / (tatortreinigung|tatort|graffiti|graffitientfernung|photovoltaik|pv anlage|solaranlage|bauendreinigung|veranstaltungsreinigung|eventreinigung|firmenevent|desinfektion|teppichreinigung|gruenpflege|rasenmaehen|hausbetreuung|muellraum) /.exec(n)
  const what = / was (reinigt|putzt|macht) (ihr|cleanos|du) | was kann cleanos | (welche|alle) (reinigungsarten|reinigungsbereiche|bereiche reinigt) /.test(n)
  if ((service && words <= 4) || what) {
    const w = service?.[1] || ''
    const mood = /tatort/.test(w) ? 'tatort' : /graffiti/.test(w) ? 'graffiti' : /photo|pv|solar/.test(w) ? 'pv' : /bau/.test(w) ? 'bau' : /veranstalt|event/.test(w) ? 'event' : /desinf/.test(w) ? 'desinfektion' : /teppich/.test(w) ? 'teppich' : /gruen|rasen/.test(w) ? 'gruen' : /hausbetr/.test(w) ? 'haus' : /muell/.test(w) ? 'muell' : 'stark'
    return { mood, text: 'Für jede Reinigung hab ich das passende Werkzeug: Unterhalts- und Büroreinigung, Glas und Fenster, Fassade, Sanitär, Teppich und Polster, Stiegenhaus, Grund- und Bauendreinigung, Desinfektion, Hausbetreuung, Grünpflege, Laub und Dachrinne, Winterdienst, Müllraum, Graffiti, Photovoltaik, Tiefgarage, Tatortreinigung und Veranstaltungen. In der App planst du das alles als Leistungen im Reinigungsplan der Objekte – frag mich z. B. „Leistung anlegen“.' }
  }
  if (/ wer bist du | was bist du | wie heisst du /.test(n)) return { mood: 'froh', text: 'Ich bin Cleo, der Sauberheld der Cleanos App! Meine Superkräfte: Ich kenne jede Funktion, zeige dir, wo sie ist, und erkläre sie Schritt für Schritt. Kein Internet nötig, nichts wird gespeichert – und Fenster putze ich nebenbei auch.' }
  if (/ (witz|lustig|superkraft|superkraefte|held) /.test(n) && n.trim().split(' ').length <= 6) return { mood: 'froh', text: 'Warum putzen Superhelden so gern Fenster? Damit sie den Durchblick behalten! Und jetzt: Womit kann ich dir helfen?' }
  if (/ (was kannst du|hilfe|help|anleitung) /.test(n) && n.trim().split(' ').length <= 4) return { mood: 'zeigt', text: 'Mein Revier ist die ganze App: Planung, Zeiterfassung, Wetter und Winterdienst, Objekte, Material, Fahrzeuge, Fakturierung und Verwaltung. Tipp eine Frage oder wähle unten ein Thema. Zum Schmökern gibt es die „Anleitung“.' }
  return null
}
