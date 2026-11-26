// Unterweisung am Handy („Plan am Handy“, mein-plan.php?aktion=unterweisung): Die Person liest die Unterweisung in ihrer
// Sprache (Abschnitte, optional ein Video), beantwortet Verständnisfragen und bestätigt mit ihrer Unterschrift. Fällig ist
// sie wie jede Art unter „Unterweisungen & Fristen“: beim Eintritt (fehlt) und nach Ablauf (z. B. jährlich). Der Webspace
// wertet die Fragen aus (die Lösung kommt nie auf die Seite), die App holt die Ergebnisse ab und trägt sie ein.
//
// An der Art (unterweisungen.json types[]):
//   online = { on, texts: { de: { title, content, quiz, decl }, bks: {…}, … }, pass (Prozent richtig), videoLink,
//              video: { name, size, type, version } | null (Datei am Webspace), covers: [Art-IDs, die mit erledigt sind],
//              changedAt, changedBy }
// Textformat (Editor der App, Vorlage core/unterweisung-vorlage.js):
//   content: Absätze; „## Überschrift“ beginnt einen Abschnitt; „- “ ist ein Punkt einer Liste
//   quiz:    „? Frage“, darunter Antworten: „+ “ richtig (genau eine), „- “ falsch
// Fassungen (Nachweis, was unterschrieben wurde): doc.versions[version] = { typeId, name, at, texts, answers, pass }
// Einträge vom Handy: record.source = 'handy', record.online = { resultId, version, lang, score, total, tries, at, opened, decl }
//
// Rechtliches (Stand 11/2026, docs/RECHTSPRUEFUNG.md Punkt 58): § 14 ASchG verlangt eine ausreichende, nachweisliche
// Unterweisung in der Arbeitszeit, vor Aufnahme der Tätigkeit, bei Änderungen und erforderlichenfalls regelmäßig, in
// verständlicher Form (bei Bedarf in der Muttersprache); der Arbeitgeber muss sich vergewissern, dass sie verstanden wurde.
// Elektronische Unterweisung gilt laut Erlass des Zentral-Arbeitsinspektorats (2010) als besondere Form der schriftlichen
// Unterweisung und ersetzt die persönliche Unterweisung am Arbeitsplatz in der Regel nicht, sondern ergänzt sie.

import { LANGUAGES, sourceKey } from './sprachen.js'
import { isRequired, statusOf, typesOf } from './trainings.js'

export const LANG_IDS = LANGUAGES.map((l) => l.id)
export const ONLINE_DEFAULTS = {
  on: false,
  texts: {},
  pass: 80,
  videoLink: '',
  video: null,
  covers: [],
}
export const DECL_DEFAULT = 'Ich bestätige: Ich habe die Unterweisung heute erhalten, gelesen und verstanden. Ich hatte die Möglichkeit, Fragen zu stellen.'
/** Zustände, in denen die Unterweisung am Handy offen ist (bald: kann schon erneuert werden). */
export const DUE_STATES = ['fehlt', 'abgelaufen', 'bald']
const MAX_SECTIONS = 60
const MAX_QUESTIONS = 40
const MAX_TEXT = 1200

export const onlineOf = (type) => ({
  ...ONLINE_DEFAULTS,
  ...(type?.online || {}),
  texts: { ...(type?.online?.texts || {}) },
})

const clean = (s, max = MAX_TEXT) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

/**
 * Inhalt im Textformat → { sections: [{ title, blocks: [{ p } | { list: [Text] }] }], errors }.
 * Text vor der ersten Überschrift wird ein Abschnitt ohne Überschrift (Einleitung).
 */
export function parseContent(text) {
  const sections = []
  const errors = []
  let cur = null
  let para = []
  const section = () => (cur ||= (sections.push({ title: '', blocks: [] }), sections.at(-1)))
  const flush = () => {
    if (para.length) section().blocks.push({ p: clean(para.join(' ')) })
    para = []
  }
  for (const raw of String(text ?? '')
    .replace(/\r/g, '')
    .split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const head = /^#{1,3}\s+(.+)$/.exec(line)
    if (head) {
      flush()
      sections.push({ title: clean(head[1], 160), blocks: [] })
      cur = sections.at(-1)
      continue
    }
    const item = /^[-•*]\s+(.+)$/.exec(line)
    if (item) {
      flush()
      const s = section()
      const last = s.blocks.at(-1)
      if (last?.list) last.list.push(clean(item[1]))
      else s.blocks.push({ list: [clean(item[1])] })
      continue
    }
    para.push(line)
  }
  flush()
  const out = sections.filter((s) => s.title || s.blocks.length)
  if (!out.length) errors.push('Kein Inhalt.')
  if (out.length > MAX_SECTIONS) errors.push(`Höchstens ${MAX_SECTIONS} Abschnitte.`)
  return { sections: out.slice(0, MAX_SECTIONS), errors }
}

/** Fragen im Textformat → { questions: [{ q, options: [Text], correct: Index }], errors }. */
export function parseQuiz(text) {
  const questions = []
  const errors = []
  let cur = null
  for (const raw of String(text ?? '')
    .replace(/\r/g, '')
    .split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const q = /^\?\s*(.+)$/.exec(line)
    const a = /^([+-])\s+(.+)$/.exec(line)
    if (q) {
      cur = { q: clean(q[1], 300), options: [], correct: -1, rights: 0 }
      questions.push(cur)
    } else if (a && cur) {
      if (a[1] === '+') {
        cur.rights++
        cur.correct = cur.options.length
      }
      cur.options.push(clean(a[2], 300))
    } else if (a) {
      errors.push(`Antwort ohne Frage: „${clean(a[2], 40)}“ (jede Frage beginnt mit „? “).`)
    } else if (cur && !cur.options.length) {
      cur.q = clean(`${cur.q} ${line}`, 300)
    } else {
      errors.push(`Zeile nicht erkannt: „${clean(line, 40)}“ (Frage „? “, Antwort „+ “ richtig bzw. „- “ falsch).`)
    }
  }
  questions.forEach((x, i) => {
    if (x.options.length < 2) errors.push(`Frage ${i + 1}: mindestens zwei Antworten.`)
    if (x.options.length > 6) errors.push(`Frage ${i + 1}: höchstens sechs Antworten.`)
    if (x.rights !== 1) errors.push(`Frage ${i + 1}: genau eine richtige Antwort mit „+ “ markieren.`)
  })
  if (questions.length > MAX_QUESTIONS) errors.push(`Höchstens ${MAX_QUESTIONS} Fragen.`)
  return {
    questions: questions.slice(0, MAX_QUESTIONS).map(({ q, options, correct }) => ({ q, options, correct })),
    errors,
  }
}

/** Haben zwei Fassungen der Fragen denselben Aufbau (Anzahl Fragen, Antworten je Frage, richtige Antwort)? */
export const sameShape = (a = [], b = []) => a.length === b.length && a.every((x, i) => x.options.length === b[i].options.length && x.correct === b[i].correct)

/** Wie viele Fragen müssen richtig sein? (aufgerundet, mindestens 1, wenn es Fragen gibt) */
export const passCount = (total, pass) => (total ? Math.min(total, Math.max(1, Math.ceil((total * Math.min(100, Math.max(0, Number(pass) || 0))) / 100))) : 0)

/**
 * Stand je Sprache für den Editor: { id, ok (nutzbar), errors, sections, questions, fallback (zeigt Deutsch) }.
 * Deutsch braucht Inhalt; eine andere Sprache ist nutzbar, wenn ihr Inhalt gültig ist und die Fragen denselben Aufbau
 * haben wie die deutschen (die Auswertung zählt nach Stellen).
 */
export function languageStatus(online) {
  const o = onlineOf({ online })
  const de = o.texts.de || {}
  const deQuiz = parseQuiz(de.quiz)
  return LANG_IDS.map((id) => {
    const t = o.texts[id] || {}
    if (id !== 'de' && !String(t.content || '').trim())
      return {
        id,
        ok: false,
        fallback: true,
        errors: [],
        sections: 0,
        questions: 0,
      }
    const c = parseContent(t.content)
    const q = parseQuiz(id === 'de' ? de.quiz : t.quiz)
    const errors = [...c.errors, ...q.errors]
    if (id !== 'de' && !q.errors.length && !sameShape(deQuiz.questions, q.questions)) errors.push('Fragen passen nicht zu den deutschen (gleiche Anzahl Fragen und Antworten, richtige Antwort an derselben Stelle).')
    return {
      id,
      ok: !errors.length,
      fallback: id !== 'de' && !!errors.length,
      errors,
      sections: c.sections.length,
      questions: q.questions.length,
    }
  })
}

/** Fassung (Kennwert) der Unterweisung: ändert sich mit Texten, Bestehensgrenze, Video und „erledigt auch“. */
export function onlineVersion(type) {
  const o = onlineOf(type)
  const texts = Object.fromEntries(LANG_IDS.filter((id) => o.texts[id]).map((id) => [id, [o.texts[id].title || '', o.texts[id].content || '', o.texts[id].quiz || '', o.texts[id].decl || '']]))
  return sourceKey(JSON.stringify([type?.name || '', texts, Number(o.pass) || 0, o.video?.version || '', o.videoLink || '', [...(o.covers || [])].sort()]))
}

/** Arten mit Unterweisung am Handy (aktiv, eingeschaltet, mit gültigem deutschen Inhalt). */
export function onlineTypes(doc) {
  return typesOf(doc).filter((t) => t.online?.on && (t.kind || 'unterweisung') !== 'dokument' && languageStatus(t.online)[0].ok)
}

/**
 * Definition einer Art für den Webspace: Texte je nutzbarer Sprache (Deutsch immer), Lösung getrennt (bleibt am Webspace,
 * nie auf der Seite), Bestehensgrenze, Video, Link, Gültigkeit. covers: Namen der Arten, die mit erledigt sind.
 */
export function webDefinition(type, { types = [] } = {}) {
  const o = onlineOf(type)
  const status = languageStatus(o)
  const de = parseQuiz(o.texts.de?.quiz)
  const texte = {}
  for (const s of status) {
    if (!s.ok) continue
    const t = o.texts[s.id] || {}
    const quiz = parseQuiz(s.id === 'de' ? o.texts.de?.quiz : t.quiz).questions
    texte[s.id] = {
      titel: clean(t.title || (s.id === 'de' ? type.name : o.texts.de?.title || type.name), 160),
      abschnitte: parseContent(t.content).sections.map((x) => ({
        titel: x.title,
        bloecke: x.blocks.map((b) => (b.list ? { liste: b.list } : { text: b.p })),
      })),
      fragen: quiz.map((x) => ({ frage: x.q, antworten: x.options })),
      erklaerung: clean(t.decl || (s.id === 'de' ? DECL_DEFAULT : o.texts.de?.decl || DECL_DEFAULT), 900),
    }
  }
  const covers = (o.covers || []).filter((id) => id !== type.id && types.some((t) => t.id === id))
  return {
    id: type.id,
    name: clean(type.name, 120),
    version: onlineVersion(type),
    monate: Math.max(0, Number(type.months) || 0),
    gesetz: clean(type.law || '', 60),
    bestehen: Math.min(100, Math.max(0, Number(o.pass) || 0)),
    loesung: de.questions.map((x) => x.correct),
    texte,
    video: o.video?.version ? { version: o.video.version, typ: o.video.type || 'video/mp4' } : null,
    videoLink: /^https:\/\/\S+$/i.test(o.videoLink || '') ? o.videoLink.trim().slice(0, 400) : '',
    deckt: covers,
  }
}

/** Fassung für den Nachweis (was die Person gelesen und unterschrieben hat): Texte aller Sprachen, Lösung, Grenze. */
export function snapshot(type, { at = '' } = {}) {
  const o = onlineOf(type)
  return {
    typeId: type.id,
    name: type.name,
    at,
    pass: o.pass,
    texts: structuredClone(o.texts),
    answers: parseQuiz(o.texts.de?.quiz).questions.map((x) => x.correct),
    covers: [...(o.covers || [])],
  }
}

/**
 * Wer welche Unterweisung am Handy sieht: { hash: [{ art, stand, bis, datum }] } für alle beschäftigten Personen mit Link
 * und jede Art am Handy, die für sie Pflicht ist oder die sie schon einmal gemacht hat. stand: fehlt | abgelaufen | bald | ok.
 */
export function webAssignments({ doc, employees = [], hashOf, today }) {
  const out = {}
  const types = onlineTypes(doc)
  for (const emp of employees) {
    if (emp.exitDate && emp.exitDate < today) continue
    const hash = hashOf(emp.id)
    if (!hash) continue
    const list = []
    for (const type of types) {
      const s = statusOf({ type, emp, records: doc?.records || [], today })
      if (s.state === 'na' && !isRequired(type, emp)) continue
      list.push({
        art: type.id,
        stand: s.state === 'na' ? 'fehlt' : s.state,
        bis: s.until || '',
        datum: s.record?.date || '',
      })
    }
    if (list.length) out[hash] = list
  }
  return out
}

/** Unterschrift vom Handy (Pfad „M12 30L14 31…“ im Feld 600 × 200) als SVG fürs PDF; ungültig: ''. */
export function signatureFromPath(path) {
  const d = String(path || '')
  if (!/^M[0-9 ML]{2,16000}$/.test(d)) return ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200" width="300" height="100"><path d="${d}" fill="none" stroke="#13232f" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

const viennaDate = (sec) =>
  new Date(sec * 1000).toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Vienna',
  })

/**
 * Ergebnisse vom Webspace als Einträge: je Ergebnis einer für die Art und je Art, die mit erledigt ist („covers“ der
 * Fassung). Schon eingetragene (gleiche resultId) kommen nicht doppelt. empOf(hash) → Person oder null.
 * Liefert { records, taken: [Ergebnis-IDs, die erledigt sind (eingetragen oder schon da)], unknown: [IDs ohne Person] }.
 */
export function resultRecords(doc, results = [], { empOf, newId, types = typesOf(doc) }) {
  const have = new Set((doc?.records || []).map((r) => r.online?.resultId).filter(Boolean))
  const records = []
  const taken = []
  const unknown = []
  for (const x of results) {
    if (!x || typeof x.id !== 'string') continue
    if (have.has(x.id)) {
      taken.push(x.id)
      continue
    }
    const emp = empOf(x.hash)
    const type = types.find((t) => t.id === x.art)
    if (!emp || !type) {
      unknown.push(x.id)
      continue
    }
    const date = viennaDate(Number(x.zeit) || 0)
    const online = {
      resultId: x.id,
      version: String(x.version || ''),
      lang: String(x.sprache || 'de'),
      score: Number(x.richtig) || 0,
      total: Number(x.gesamt) || 0,
      tries: Number(x.versuche) || 1,
      at: new Date((Number(x.zeit) || 0) * 1000).toISOString(),
      opened: x.geoeffnet ? new Date(Number(x.geoeffnet) * 1000).toISOString() : '',
      decl: String(x.erklaerung || '').slice(0, 900),
    }
    const signature = signatureFromPath(x.unterschrift)
    const note = `Am Handy: ${online.score} von ${online.total} Fragen richtig${online.tries > 1 ? ` (${online.tries}. Versuch)` : ''}`
    const at = online.at
    records.push({
      id: newId(),
      empId: emp.id,
      typeId: type.id,
      date,
      note,
      signature,
      by: 'Plan am Handy',
      at,
      source: 'handy',
      online,
    })
    const covered = doc?.versions?.[online.version]?.covers || onlineOf(type).covers || []
    for (const id of covered) {
      const other = types.find((t) => t.id === id)
      if (other && other.id !== type.id)
        records.push({
          id: newId(),
          empId: emp.id,
          typeId: other.id,
          date,
          note: `mit „${type.name}“ am Handy erledigt`,
          signature,
          by: 'Plan am Handy',
          at,
          source: 'handy',
          online: { ...online, coveredBy: type.id },
        })
    }
    have.add(x.id)
    taken.push(x.id)
  }
  return { records, taken, unknown }
}
