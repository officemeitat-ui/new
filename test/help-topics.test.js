// Hilfe-Themen (src/help/topics.js) für Cleo und die Anleitung: Aufbau, Verweise und dass jede
// Ansicht und jede Aktion wirklich in der App registriert ist. Die UI-Module brauchen einen
// Browser, deshalb werden registerView- und registerActions-Aufrufe aus dem Quelltext gelesen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GLOSSARY, TOPICS } from '../src/help/topics.js'

const UI = fileURLToPath(new URL('../src/ui', import.meta.url))
const SECTIONS = new Set(['start', 'planung', 'einsatz', 'objekte', 'betrieb', 'finanzen', 'verwaltung', 'allgemein'])
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function sources(dir = UI) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...sources(p))
    else if (p.endsWith('.js')) out.push([p, readFileSync(p, 'utf8')])
  }
  return out
}
const FILES = sources()

// ---------------------------------------------------------------- Quelltext lesen

/** Ende eines Strings, Template-Literals, Kommentars oder Regex ab i; sonst null. */
function skipToken(src, i, prev) {
  const c = src[i]
  if (c === "'" || c === '"') {
    for (i++; i < src.length; i++) {
      if (src[i] === '\\') i++
      else if (src[i] === c) return i + 1
    }
    return i
  }
  if (c === '`') {
    for (i++; i < src.length; i++) {
      if (src[i] === '\\') i++
      else if (src[i] === '`') return i + 1
      else if (src[i] === '$' && src[i + 1] === '{') i = matchClose(src, i + 2) - 1
    }
    return i
  }
  if (c === '/' && src[i + 1] === '/') {
    const end = src.indexOf('\n', i)
    return end < 0 ? src.length : end
  }
  if (c === '/' && src[i + 1] === '*') {
    const end = src.indexOf('*/', i + 2)
    return end < 0 ? src.length : end + 2
  }
  // Regex-Literal: steht dort, wo ein Ausdruck beginnt
  if (c === '/' && (!prev || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev))) {
    let cls = false
    for (i++; i < src.length && src[i] !== '\n'; i++) {
      if (src[i] === '\\') i++
      else if (src[i] === '[') cls = true
      else if (src[i] === ']') cls = false
      else if (src[i] === '/' && !cls) return i + 1
    }
    return i
  }
  return null
}

/** Index nach der schließenden Klammer zur bei i-1 geöffneten (Strings, Templates, Regex beachtet). */
function matchClose(src, i) {
  let depth = 0
  let prev = ''
  while (i < src.length) {
    const end = skipToken(src, i, prev)
    if (end !== null) {
      i = end
      prev = 'x'
      continue
    }
    const c = src[i]
    if ('{(['.includes(c)) depth++
    else if ('})]'.includes(c)) {
      if (depth === 0) return i + 1
      depth--
    }
    if (!/\s/.test(c)) prev = c
    i++
  }
  return i
}

/** Das Objekt-Literal ab der nächsten „{“ nach pos: [Text, Text nur der obersten Ebene]. */
function objectAfter(src, pos) {
  const start = src.indexOf('{', pos)
  const end = matchClose(src, start + 1)
  const body = src.slice(start + 1, end - 1)
  // oberste Ebene: alles in Klammern, Templates und Kommentaren ausblenden, Strings behalten
  let top = ''
  let i = 0
  let prev = ''
  while (i < body.length) {
    const c = body[i]
    if ('{(['.includes(c)) {
      const close = matchClose(body, i + 1)
      top += ' '.repeat(close - i)
      i = close
      prev = ')'
      continue
    }
    const end = skipToken(body, i, prev)
    if (end !== null) {
      top += c === "'" || c === '"' ? body.slice(i, end) : ' '.repeat(end - i)
      i = end
      prev = 'x'
      continue
    }
    top += c
    if (!/\s/.test(c)) prev = c
    i++
  }
  return [body, top]
}

/** Alle registrierten Ansichten: id aus registerView({ … }); id: tool.id über die Liste der Schleife. */
function registeredViews() {
  const ids = new Set()
  for (const [, src] of FILES) {
    for (const m of src.matchAll(/registerView\(\s*\{/g)) {
      const [, top] = objectAfter(src, m.index)
      const lit = /(?:^|[,\s])id:\s*'([^']+)'/.exec(top)
      if (lit) {
        ids.add(lit[1])
        continue
      }
      const ref = /(?:^|[,\s])id:\s*([A-Za-z_$][\w$]*)\.id\b/.exec(top)
      const loop = ref && new RegExp(`for\\s*\\(\\s*const\\s+${ref[1]}\\s+of\\s+([A-Za-z_$][\\w$]*)\\s*\\)`).exec(src)
      const list = loop && new RegExp(`(?:const|let)\\s+${loop[1]}\\s*=\\s*\\[`).exec(src)
      assert.ok(list, `registerView ohne erkennbare id in ${src.slice(m.index, m.index + 80)}`)
      const arr = src.slice(list.index, matchClose(src, src.indexOf('[', list.index) + 1))
      for (const x of arr.matchAll(/\{\s*id:\s*'([^']+)'/g)) ids.add(x[1])
    }
  }
  return ids
}

/** Alle registrierten Aktionen: Schlüssel in registerActions({ … }) und Object.assign(ACTIONS, …, { … }). */
function registeredActions() {
  const names = new Set()
  for (const [, src] of FILES) {
    for (const m of src.matchAll(/registerActions\(|Object\.assign\(\s*ACTIONS\s*,/g)) {
      const [, top] = objectAfter(src, m.index)
      for (const k of top.matchAll(/(?:^|[,{])\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/g)) names.add(k[1] || k[2] || k[3])
    }
    for (const k of src.matchAll(/ACTIONS(?:\.([A-Za-z_$][\w$]*)|\[\s*'([^']+)'\s*\])\s*=[^=]/g)) names.add(k[1] || k[2])
  }
  return names
}

const VIEWS = registeredViews()
const ACTIONS = registeredActions()
const IDS = new Set(TOPICS.map((t) => t.id))

// ---------------------------------------------------------------- Lesen des Quelltexts

test('Quelltext: Ansichten und Aktionen werden erkannt', () => {
  for (const id of ['home', 'week', 'zeiten', 'fakturierung', 'zaehler', 'kontrolle', 'objektmappe', 'matten', 'kennzahlen']) assert.ok(VIEWS.has(id), `Ansicht ${id}`)
  assert.ok(VIEWS.size >= 35, `nur ${VIEWS.size} Ansichten gefunden`)
  for (const a of ['plan', 'view', 'open-search', 'open-publish', 'fak-new', 'tc-edit-open', 'reload', 'sync-now']) assert.ok(ACTIONS.has(a), `Aktion ${a}`)
  assert.ok(ACTIONS.size >= 400, `nur ${ACTIONS.size} Aktionen gefunden`)
  assert.ok(!ACTIONS.has('type') && !ACTIONS.has('label'), 'keine Felder aus verschachtelten Objekten')
})

// ---------------------------------------------------------------- Themen

test('Themen: mindestens 120, ids eindeutig und kebab-case', () => {
  assert.ok(TOPICS.length >= 120, `nur ${TOPICS.length} Themen`)
  const seen = new Set()
  for (const t of TOPICS) {
    assert.match(t.id, KEBAB, t.id)
    assert.ok(!seen.has(t.id), `doppelte id ${t.id}`)
    seen.add(t.id)
  }
})

test('Themen: Bereich gültig, Titel und Antwort vorhanden', () => {
  for (const t of TOPICS) {
    assert.ok(SECTIONS.has(t.section), `${t.id}: Bereich ${t.section}`)
    assert.equal(typeof t.title, 'string', t.id)
    assert.ok(t.title.trim().length >= 3 && t.title.length <= 80, `${t.id}: Titel`)
    assert.equal(typeof t.answer, 'string', t.id)
    assert.ok(t.answer.length >= 20 && t.answer.length <= 400, `${t.id}: Antwort hat ${t.answer.length} Zeichen`)
  }
  for (const s of SECTIONS) assert.ok(TOPICS.some((t) => t.section === s), `kein Thema im Bereich ${s}`)
})

test('Themen: 3 bis 10 Fragen, klein geschrieben und ohne Doppel', () => {
  for (const t of TOPICS) {
    assert.ok(Array.isArray(t.q) && t.q.length >= 3 && t.q.length <= 10, `${t.id}: ${t.q?.length} Fragen`)
    assert.equal(new Set(t.q).size, t.q.length, `${t.id}: doppelte Frage`)
    for (const q of t.q) {
      assert.equal(typeof q, 'string', t.id)
      assert.ok(q.trim().length >= 2, `${t.id}: leere Frage`)
      assert.equal(q, q.toLowerCase(), `${t.id}: „${q}“ klein schreiben`)
    }
  }
})

test('Themen: Schritte 2 bis 7, Tipps als Text, Rollen als Text', () => {
  for (const t of TOPICS) {
    if (t.steps !== undefined) {
      assert.ok(Array.isArray(t.steps) && t.steps.length >= 2 && t.steps.length <= 7, `${t.id}: ${t.steps?.length} Schritte`)
      for (const s of t.steps) assert.ok(typeof s === 'string' && s.trim().length >= 5, `${t.id}: Schritt`)
    }
    if (t.tips !== undefined) {
      assert.ok(Array.isArray(t.tips) && t.tips.length >= 1, `${t.id}: Tipps`)
      for (const s of t.tips) assert.ok(typeof s === 'string' && s.trim().length >= 5, `${t.id}: Tipp`)
    }
    if (t.roles !== undefined) assert.ok(typeof t.roles === 'string' && t.roles.trim(), `${t.id}: Rollen`)
    const known = new Set(['id', 'section', 'view', 'title', 'q', 'answer', 'steps', 'tips', 'action', 'related', 'roles'])
    for (const k of Object.keys(t)) assert.ok(known.has(k), `${t.id}: unbekanntes Feld ${k}`)
  }
})

test('Themen: jede Ansicht ist registriert', () => {
  for (const t of TOPICS) if (t.view !== undefined) assert.ok(VIEWS.has(t.view), `${t.id}: Ansicht „${t.view}“ gibt es nicht`)
})

test('Themen: jede Aktion ist registriert, mit Beschriftung und Text-Daten', () => {
  for (const t of TOPICS) {
    if (t.action === undefined) continue
    const { action, label, data } = t.action
    assert.ok(ACTIONS.has(action), `${t.id}: Aktion „${action}“ gibt es nicht`)
    assert.ok(typeof label === 'string' && label.trim().length >= 3, `${t.id}: Beschriftung`)
    if (data !== undefined) for (const [k, v] of Object.entries(data)) {
      assert.match(k, /^[a-z][a-zA-Z0-9]*$/, `${t.id}: Datenfeld ${k}`)
      assert.equal(typeof v, 'string', `${t.id}: ${k} als Text`)
    }
    for (const k of Object.keys(t.action)) assert.ok(['action', 'label', 'data'].includes(k), `${t.id}: Feld ${k} in action`)
  }
})

// Aktionen, die Cleo auslösen darf: sie öffnen nur einen Dialog oder eine Ansicht, nichts wird
// gelöscht, gesendet oder festgeschrieben. Ausnahmen: „plan“ (besetzt nur freie Einsätze, mit
// Rückgängig) und „sync-now“ (Abgleich). Eine neue Aktion hier bewusst ergänzen.
const SAFE = new Set([
  'plan', 'sync-now', 'open-todo', 'open-publish', 'open-send', 'open-search', 'open-data', 'open-absence-new', 'quick-open', 'quick-keys', 'theme-open', 'bn-edit', 'ai-open', 'help-open',
  'appt-new', 'portal-open', 'tc-edit-open', 'wx-alarm-open', 'winterlog-add', 'complaint-new', 'key-move-open', 'key-edit-open',
  'mat-book-open', 'mat-inventory-open', 'mat-request-new', 'veh-edit-open', 'veh-propose-open', 'veh-ws-open',
  'fak-new', 'fak-rec-open', 'fak-proof-open', 'fak-export-open', 'fak-cust-open', 'fak-text-open', 'fak-terms-open', 'calc-settings', 'ot-send',
  'emp-edit', 'import-open', 'obj-edit', 'task-edit', 'tr-session-open', 'tr-types-open', 'anl-edit-open', 'anl-check-open', 'anl-types-open', 'gr-edit-open', 'gr-check-open', 'gr-types-open', 'gr-repair-open', 'mw-edit-open', 'mw-plan-open', 'mw-closures-open', 'mw-tp-depot-open', 'mw-tp-drivers-open', 'mw-ls-settings-open', 'mww-web-open', 'reg-new', 'qm-groups-open', 'qm-measure-open', 'qm-settings-open', 'kz-round-open', 'kz-settings-open', 'kz-links-open',
  'asch-stoff-open', 'asch-ba-open', 'asch-eval-open',
  'bew-edit-open', 'bew-settings-open', 'bew-start-open', 'bew-tpl-open',
  'mit-new',
  'mail-compose-open', 'mail-task-new', 'mail-reports-open', 'fak-import-open', 'fak-batch-open', 'fak-dunning-open', 'fak-erinnern-open', 'fak-sepa-open', 'mwr-open', 'mwg-open', 'fvt-open', 'fvt-kv-open',
  'ek-inv-new', 'ek-sup-open', 'ek-export-open', 'kasse-new', 'kasse-count-open', 'kasse-export-open',
  'vt-new',
  'pst-text-open',
])

test('Themen: Aktionen öffnen nur, nichts wird gelöscht oder gesendet', () => {
  for (const t of TOPICS) if (t.action) assert.ok(SAFE.has(t.action.action), `${t.id}: „${t.action.action}“ ist nicht als sicher bekannt`)
  for (const a of SAFE) assert.ok(ACTIONS.has(a), `sichere Aktion ${a} gibt es nicht mehr`)
  // neue Datensätze öffnen nur den leeren Dialog
  for (const t of TOPICS) if (['emp-edit', 'obj-edit', 'task-edit'].includes(t.action?.action)) assert.equal(t.action.data?.id, 'new', t.id)
})

test('Themen: verwandte Themen existieren, nicht doppelt, nicht sich selbst', () => {
  for (const t of TOPICS) {
    if (t.related === undefined) continue
    assert.ok(Array.isArray(t.related) && t.related.length, `${t.id}: related`)
    assert.equal(new Set(t.related).size, t.related.length, `${t.id}: doppelter Verweis`)
    for (const id of t.related) {
      assert.ok(IDS.has(id), `${t.id}: verweist auf unbekanntes Thema ${id}`)
      assert.notEqual(id, t.id, `${t.id}: verweist auf sich selbst`)
    }
  }
})

test('Themen: jede Ansicht des Menüs hat mindestens ein Thema', () => {
  const covered = new Set(TOPICS.map((t) => t.view).filter(Boolean))
  for (const id of VIEWS) assert.ok(covered.has(id), `kein Thema zur Ansicht ${id}`)
})

// ---------------------------------------------------------------- Schreibweise

const allText = (t) => [t.title, t.answer, ...(t.steps || []), ...(t.tips || []), t.roles || '', t.action?.label || '', ...t.q]
const ACRONYMS = new Set(['PDF', 'CSV', 'ZIP', 'IBAN', 'UID', 'AZG', 'ARG', 'KJBG', 'KFG', 'DOT', 'BMD', 'RZL', 'VPI', 'JSON', 'PHP', 'HTTPS', 'NFC', 'XML', 'GPS', 'SMS', 'ELBA', 'BAWAG', 'WKO', 'ASVG', 'DSGVO', 'API', 'EPC', 'URL', 'ODBC', 'SEPA', 'BAO', 'RKSV', 'BIC', 'UVA', 'AQL', 'GHS', 'ISO', 'SDB', 'ÖGK', 'NPS', 'AMS'])

test('Schreibweise: keine Wörter nur in Großbuchstaben (außer Abkürzungen), keine Emoji', () => {
  const texts = [...TOPICS.flatMap(allText), ...GLOSSARY.flatMap((g) => [g.term, g.text])]
  for (const s of texts) {
    assert.ok(!/\p{Extended_Pictographic}/u.test(s), `Emoji in „${s}“`)
    for (const [w] of s.matchAll(/(?<!\p{L})\p{Lu}{3,}(?!\p{L})/gu)) assert.ok(ACRONYMS.has(w), `„${w}“ in „${s}“`)
  }
})

test('Schreibweise: keine Modellnamen', () => {
  const texts = [...TOPICS.flatMap(allText), ...GLOSSARY.flatMap((g) => [g.term, g.text])]
  for (const s of texts) assert.ok(!/claude|opus|sonnet|haiku|gpt/i.test(s), s)
})

// ---------------------------------------------------------------- Begriffe

test('Begriffe: 25 bis 45, eindeutig, mit Erklärung', () => {
  assert.ok(GLOSSARY.length >= 25 && GLOSSARY.length <= 45, `${GLOSSARY.length} Begriffe`)
  const terms = new Set()
  for (const g of GLOSSARY) {
    assert.ok(typeof g.term === 'string' && g.term.trim(), 'Begriff')
    assert.ok(typeof g.text === 'string' && g.text.length >= 20 && g.text.length <= 300, `${g.term}: Erklärung`)
    assert.deepEqual(Object.keys(g).sort(), ['term', 'text'], g.term)
    const key = g.term.toLowerCase()
    assert.ok(!terms.has(key), `doppelter Begriff ${g.term}`)
    terms.add(key)
  }
  for (const must of ['Stammkraft', 'Fixobjekt', 'Vertretung', 'Zeitausgleich', 'Mehrarbeit', 'Durchrechnung', 'Pickerl', 'Reverse Charge', 'Leistungsnachweis', 'Winterdienst']) assert.ok(terms.has(must.toLowerCase()), `Begriff ${must} fehlt`)
})
