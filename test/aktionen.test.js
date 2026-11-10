// Knöpfe und Aktionen, statisch aus den Quellen gelesen: Jeder Name in data-action="…", data-change="…",
// data-input="…" (app.js verteilt alle drei über ACTIONS) und data-of="…" (Anhang per E-Mail, mailer.js),
// jede Angabe action: '…' (Menüs, Reiter, Hilfe-Themen, Schnellzugriff, Cleo, Suche) und jeder Aufruf
// ACTIONS['…'] braucht eine registrierte Aktion. Sonst ist der Knopf tot: Klick ohne Wirkung, ohne Hinweis.
//
// Registriert wird mit registerActions({ … }), Object.assign(ACTIONS, { … }) und ACTIONS.name = …. Die
// Platzhalter der später geladenen Module (views/lazy.js) prüft test/lazy.test.js gegen die Module; hier
// dienen sie als Probe für diesen Leser: Jeder Platzhalter muss auch als Registrierung gefunden werden.
// Zusammengesetzte Namen (data-action="${x}", ACTIONS[x]) stehen in DYNAMISCH mit der Stelle, die ihre
// Namen liefert. Eine neue solche Stelle lässt den Test scheitern, bis sie dort eingetragen ist.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

// ---------------------------------------------------------------- Quelltext lesen
// Je Zeichen: Art (Code, Kommentar, Text in '…', Text in `…`, regulärer Ausdruck, ${ und }) und Ebene
// (Code in ${…} einer Vorlage liegt eine Ebene tiefer). Gesucht wird mit regulären Ausdrücken, gezählt
// werden Klammern nur im Code der eigenen Ebene. Das genügt für Namen und ist schnell.

const CODE = 0
const COMMENT = 1
const STR = 2
const TEXT = 3
const RE = 4
const OPEN = 5
const kindAt = (m, i) => m[i] & 7

const isIdStart = (c) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c === 36 || c > 127
const isIdPart = (c) => isIdStart(c) || (c >= 48 && c <= 57)
// Nach diesen Wörtern beginnt mit „/“ ein regulärer Ausdruck, nach anderen Wörtern ist es eine Division
const WORD_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await'])

/** Art und Ebene je Zeichen (m), Ende jedes ${…} (exprEnd: Position von $ → Position von }), offene Klammern. */
function scan(src) {
  const n = src.length
  const m = new Uint8Array(n)
  const exprEnd = new Map()
  const stack = []
  let depth = 0
  let level = 0
  let last = 'op' // davor: 'op' (Zeichen), 'word' (Wort ab wordAt) oder 'value' (Zahl, Text, Klammer zu)
  let wordAt = 0
  let wordEnd = 0
  // Text einer Vorlage ab j bis ` oder ${
  const text = (j) => {
    const v = TEXT | (level << 3)
    let k = j
    for (; k < n; k++) {
      const d = src.charCodeAt(k)
      if (d === 92) k++
      else if (d === 96) break
      else if (d === 36 && src.charCodeAt(k + 1) === 123) {
        m.fill(v, j, k)
        m[k] = m[k + 1] = OPEN | (level << 3)
        stack.push({ depth, at: k })
        level++
        depth = 0
        last = 'op'
        return k + 2
      }
    }
    m.fill(v, j, k + 1)
    last = 'value'
    return k + 1
  }
  let i = 0
  while (i < n) {
    const c = src.charCodeAt(i)
    const code = level << 3
    if (c === 47 && src.charCodeAt(i + 1) === 47) {
      const e = src.indexOf('\n', i)
      const end = e < 0 ? n : e
      m.fill(COMMENT | code, i, end)
      i = end
    } else if (c === 47 && src.charCodeAt(i + 1) === 42) {
      const e = src.indexOf('*/', i + 2)
      const end = e < 0 ? n : e + 2
      m.fill(COMMENT | code, i, end)
      i = end
    } else if (c === 34 || c === 39) {
      let j = i + 1
      while (j < n && src.charCodeAt(j) !== c) j += src.charCodeAt(j) === 92 ? 2 : 1
      m.fill(STR | code, i, j + 1)
      i = j + 1
      last = 'value'
    } else if (c === 96) {
      m[i] = TEXT | code
      i = text(i + 1)
    } else if (c === 47 && (last === 'op' || (last === 'word' && WORD_BEFORE_REGEX.has(src.slice(wordAt, wordEnd))))) {
      let j = i + 1
      let inClass = false
      for (; j < n; j++) {
        const d = src.charCodeAt(j)
        if (d === 92) j++
        else if (d === 91) inClass = true
        else if (d === 93) inClass = false
        else if ((d === 47 && !inClass) || d === 10) break
      }
      j++
      while (j < n && isIdPart(src.charCodeAt(j))) j++
      m.fill(RE | code, i, j)
      i = j
      last = 'value'
    } else if (isIdStart(c) || (c >= 48 && c <= 57)) {
      let j = i + 1
      while (j < n && (isIdPart(src.charCodeAt(j)) || (c >= 48 && c <= 57 && src.charCodeAt(j) === 46))) j++
      if (code) m.fill(code, i, j)
      if (isIdStart(c)) {
        last = 'word'
        wordAt = i
        wordEnd = j
      } else last = 'value'
      i = j
    } else {
      if (c === 125 && depth === 0 && stack.length) {
        // } schließt ${…}: weiter im Text der Vorlage
        const open = stack.pop()
        level--
        depth = open.depth
        m[i] = OPEN | (level << 3)
        exprEnd.set(open.at, i)
        i = text(i + 1)
        continue
      }
      m[i] = code
      if (c === 40 || c === 91 || c === 123) depth++
      else if (c === 41 || c === 93 || c === 125) depth--
      if (c !== 32 && c !== 10 && c !== 9 && c !== 13) last = c === 41 || c === 93 ? 'value' : 'op'
      i++
    }
  }
  return { m, exprEnd, depth: depth + stack.length }
}

const LINES = new Map()
function lineOf(src, pos) {
  if (!LINES.has(src)) {
    const starts = [0]
    for (let i = src.indexOf('\n'); i >= 0; i = src.indexOf('\n', i + 1)) starts.push(i + 1)
    LINES.set(src, starts)
  }
  const starts = LINES.get(src)
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

const isSpace = (c) => c === 32 || c === 10 || c === 9 || c === 13
/** Nächstes Zeichen ab i, das kein Leerraum und kein Kommentar ist. */
function skip(f, i) {
  while (i < f.src.length && (isSpace(f.src.charCodeAt(i)) || kindAt(f.m, i) === COMMENT)) i++
  return i
}
/** Letztes Zeichen vor i, das kein Leerraum und kein Kommentar ist. */
function skipBack(f, i) {
  i--
  while (i >= 0 && (isSpace(f.src.charCodeAt(i)) || kindAt(f.m, i) === COMMENT)) i--
  return i
}
/** Ende des Textes (oder regulären Ausdrucks), der bei i beginnt. */
function endOf(f, i) {
  let j = i + 1
  while (j < f.src.length && f.m[j] === f.m[i]) j++
  return j
}
const unescape = (text) => (text.includes('\\') ? text.replace(/\\(.)/gs, '$1') : text)
/** Wort ab i. */
function wordAt(f, i) {
  let j = i
  while (j < f.src.length && isIdPart(f.src.charCodeAt(j))) j++
  return f.src.slice(i, j)
}

/** Ende des Ausdrucks ab i: Position von , oder der schließenden Klammer auf gleicher Ebene. */
function exprEndAt(f, i) {
  const { src, m } = f
  const code = m[skip(f, i)] & ~7
  let depth = 0
  for (; i < src.length; i++) {
    if (m[i] !== code) {
      if (kindAt(m, i) === OPEN && m[i] >> 3 < code >> 3) return i
      continue
    }
    const c = src.charCodeAt(i)
    if (c === 40 || c === 91 || c === 123) depth++
    else if (c === 41 || c === 93 || c === 125) {
      if (depth === 0) return i
      depth--
    } else if (c === 44 && depth === 0) return i
  }
  return i
}

/** Ausdruck a…b als Text, Leerraum zusammengezogen (Schlüssel in DYNAMISCH). */
const textOf = (f, a, b) => f.src.slice(a, b).trim().replace(/\s+/g, ' ')

/**
 * Feste Namen des Ausdrucks a…b: 'a', `a` oder Bedingung ? 'a' : 'b' (auch verschachtelt, auch in Klammern).
 * Sonst null (Variable, Vorlage mit ${…}, Aufruf …).
 */
function literalNames(f, a, b) {
  const { src, m } = f
  a = skip(f, a)
  b = skipBack(f, b) + 1
  if (a >= b) return null
  const code = m[a] & ~7
  if ((kindAt(m, a) === STR || kindAt(m, a) === TEXT) && endOf(f, a) === b) return [unescape(src.slice(a + 1, b - 1))]
  let depth = 0
  let q = -1
  let nested = 0
  for (let i = a; i < b; i++) {
    if (m[i] !== code) continue
    const c = src[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && c === '?' && src[i + 1] !== '.' && src[i + 1] !== '?' && src[i - 1] !== '?') {
      if (q < 0) q = i
      else nested++
    } else if (depth === 0 && c === ':' && q >= 0) {
      if (nested) nested--
      else {
        const x = literalNames(f, q + 1, i)
        const y = literalNames(f, i + 1, b)
        return x && y ? [...x, ...y] : null
      }
    }
  }
  if (q < 0 && src[a] === '(' && exprEndAt(f, a + 1) === b - 1) return literalNames(f, a + 1, b - 1)
  return null
}

/** Schlüssel des Objekts bei p ({): [{ name, at } | { computed, at } | { spread, at }]. */
function objectKeys(f, p) {
  const { src, m } = f
  const keys = []
  let i = p + 1
  for (;;) {
    i = skip(f, i)
    if (i >= src.length || src[i] === '}') break
    if (src.startsWith('...', i)) keys.push({ spread: true, at: i })
    else if (src[i] === '[') keys.push({ computed: true, at: i })
    else if (kindAt(m, i) === STR) keys.push({ name: unescape(src.slice(i + 1, endOf(f, i) - 1)), at: i })
    else if (isIdPart(src.charCodeAt(i))) {
      let word = wordAt(f, i)
      let at = i
      // async name() {}, get name() {}
      const next = skip(f, i + word.length)
      if (['async', 'get', 'set'].includes(word) && (isIdStart(src.charCodeAt(next)) || kindAt(m, next) === STR)) {
        at = next
        word = kindAt(m, next) === STR ? unescape(src.slice(next + 1, endOf(f, next) - 1)) : wordAt(f, next)
      }
      keys.push({ name: word, at })
    } else keys.push({ computed: true, at: i })
    const e = exprEndAt(f, i)
    if (src[e] !== ',') break
    i = e + 1
  }
  return keys
}

/** Argumente des Aufrufs, dessen ( bei p steht: [[Anfang, Ende]]. */
function callArgs(f, p) {
  const args = []
  let i = p + 1
  while (i < f.src.length) {
    if (f.src[skip(f, i)] === ')') break
    const e = exprEndAt(f, i)
    args.push([i, e])
    if (f.src[e] !== ',') break
    i = e + 1
  }
  return args
}

/** Fundstellen von re im Code (nicht in Texten oder Kommentaren). */
function* inCode(f, re) {
  for (const hit of f.src.matchAll(re)) if (kindAt(f.m, hit.index) === CODE) yield hit
}

// ---------------------------------------------------------------- Namen sammeln

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const ATTR = /data-(action|change|input|of)="/g
// action: '…' zählt nur in der Oberfläche (im Rechenkern heißt action etwas anderes, z. B. bei der Müllabfuhr)
const ACTION_PROP_DIRS = ['src/ui/', 'src/help/', 'src/ai/']

function sourceFiles(dir = join(ROOT, 'src'), out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(path, out)
    else if (entry.name.endsWith('.js')) out.push(path)
  }
  return out
}

function read() {
  const files = {}
  for (const path of sourceFiles()) {
    const src = readFileSync(path, 'utf8')
    const name = relative(ROOT, path).split('\\').join('/')
    files[name] = { name, src, ...scan(src) }
  }
  return files
}

/**
 * Registrierte Namen, Verweise und dynamische Stellen aller Dateien.
 * defs: Name → [Stelle]; refs: [{ name, kind, at }]; dynamic: [{ file, kind, expr, at }]; odd: Unlesbares.
 */
function analyse(files) {
  const defs = new Map()
  const refs = []
  const dynamic = []
  const odd = []
  const at = (f, pos) => `${f.name}:${lineOf(f.src, pos)}`
  const def = (f, name, pos, how) => {
    if (!defs.has(name)) defs.set(name, [])
    defs.get(name).push({ at: at(f, pos), how })
  }
  const defKeys = (f, p, how) => {
    for (const key of objectKeys(f, p)) key.name !== undefined ? def(f, key.name, key.at, how) : odd.push(`${at(f, key.at)}: Name in ${how} nicht fest (${key.spread ? '…' : '[…]'})`)
  }
  // export function name(…) { return { … } }: Aktionen, die erst beim Start gesetzt werden (Einrichtung)
  const returnedKeys = (fn) => {
    for (const f of Object.values(files))
      for (const hit of inCode(f, new RegExp(`function ${fn}\\(`, 'g'))) {
        const ret = /\breturn\s*\{/g
        ret.lastIndex = hit.index
        const r = ret.exec(f.src)
        if (r) return defKeys(f, r.index + r[0].length - 1, `${fn}()`)
      }
    odd.push(`${fn}() liefert kein Objekt`)
  }

  for (const f of Object.values(files)) {
    const { src, m } = f
    // registerActions({ … }, { edit })
    for (const hit of inCode(f, /(?<![\w$.])registerActions\s*\(/g)) {
      if (src.slice(Math.max(0, hit.index - 9), hit.index) === 'function ') continue
      const p = skip(f, hit.index + hit[0].length)
      if (src[p] === '{') defKeys(f, p, 'registerActions')
      else odd.push(`${at(f, hit.index)}: registerActions ohne Objekt`)
    }
    // Object.assign(ACTIONS, { … }, setupActions(…))
    for (const hit of inCode(f, /Object\.assign\(\s*ACTIONS\s*,/g)) {
      const open = hit.index + 'Object.assign'.length
      for (const [a] of callArgs(f, open).slice(1)) {
        const p = skip(f, a)
        if (src[p] === '{') defKeys(f, p, 'Object.assign')
        else if (isIdStart(src.charCodeAt(p)) && src[skip(f, p + wordAt(f, p).length)] === '(') returnedKeys(wordAt(f, p))
        else odd.push(`${at(f, p)}: Object.assign(ACTIONS, …) nicht lesbar`)
      }
    }
    // ACTIONS.name, ACTIONS['name'], ACTIONS[x] (aufgerufen oder gesetzt)
    for (const hit of inCode(f, /(?<![\w$.])ACTIONS\b/g)) {
      let p = skip(f, hit.index + 7)
      const optional = src.startsWith('?.', p)
      if (optional) p = skip(f, p + 2)
      const assigned = (q) => src[q] === '=' && src[q + 1] !== '=' && src[q + 1] !== '>'
      if (src[p] === '.' || (optional && isIdStart(src.charCodeAt(p)))) {
        const q = src[p] === '.' ? skip(f, p + 1) : p
        const name = wordAt(f, q)
        if (assigned(skip(f, q + name.length))) def(f, name, q, 'ACTIONS.x =')
        else refs.push({ name, kind: 'ACTIONS.x', at: at(f, hit.index) })
      } else if (src[p] === '[') {
        const close = exprEndAt(f, p + 1)
        const names = literalNames(f, p + 1, close)
        if (names && assigned(skip(f, close + 1))) for (const name of names) def(f, name, p, 'ACTIONS[x] =')
        else if (names) for (const name of names) refs.push({ name, kind: 'ACTIONS[…]', at: at(f, hit.index) })
        else dynamic.push({ file: f.name, kind: 'ACTIONS[…]', expr: textOf(f, p + 1, close), at: at(f, hit.index) })
      }
    }
    // action: '…' (Menüeintrag, Reiter, Hilfe-Thema, Schnellzugriff …); nicht Bedingung ? action : …
    if (ACTION_PROP_DIRS.some((d) => f.name.startsWith(d)))
      for (const hit of inCode(f, /(?<![\w$.])action\s*:/g)) {
        if (src[skipBack(f, hit.index)] === '?') continue
        const p = skip(f, hit.index + hit[0].length)
        if (kindAt(m, p) !== STR) continue
        const name = unescape(src.slice(p + 1, endOf(f, p) - 1))
        if (name) refs.push({ name, kind: 'action:', at: at(f, hit.index) })
      }
    // data-action="…" in Texten und Vorlagen
    for (const hit of src.matchAll(ATTR)) {
      const k = kindAt(m, hit.index)
      if (k !== STR && k !== TEXT) continue
      const kind = `data-${hit[1]}`
      const from = hit.index + hit[0].length
      let j = from
      while (j < src.length && m[j] === m[hit.index] && src[j] !== '"') j++
      if (src[j] === '"' && m[j] === m[hit.index]) refs.push({ name: src.slice(from, j), kind, at: at(f, hit.index) })
      else if (kindAt(m, j) === OPEN && f.exprEnd.has(j)) {
        const end = f.exprEnd.get(j)
        const whole = j === from && src[end + 1] === '"'
        const names = whole ? literalNames(f, j + 2, end) : null
        if (names) for (const name of names) refs.push({ name, kind, at: at(f, hit.index) })
        else dynamic.push({ file: f.name, kind, expr: `${src.slice(from, j)}\${${textOf(f, j + 2, end)}}`, at: at(f, hit.index) })
      } else odd.push(`${at(f, hit.index)}: ${kind}="…" nicht lesbar`)
    }
  }
  return { defs, refs, dynamic, odd }
}

/** Feste Argumente an Stelle arg in Aufrufen von fn(…) in den Dateien in (props: erlaubte Ausdrücke). */
function helperNames(files, { fn, arg, in: names, props = [] }) {
  const found = []
  const loose = []
  let calls = 0
  for (const name of names) {
    const f = files[name]
    for (const hit of inCode(f, new RegExp(`(?<![\\w$.])${fn}\\(`, 'g'))) {
      if (/(function|const|let) $/.test(f.src.slice(Math.max(0, hit.index - 9), hit.index))) continue
      const args = callArgs(f, hit.index + fn.length)
      if (args.length <= arg) continue // Vorgabe der Funktion
      calls++
      const [a, b] = args[arg]
      const list = literalNames(f, a, b)
      const where = `${f.name}:${lineOf(f.src, hit.index)}`
      if (list) found.push(...list.map((x) => ({ name: x, at: where })))
      else if (!props.includes(textOf(f, a, b))) loose.push(`${where} ${fn}(…): ${textOf(f, a, b)}`)
    }
  }
  return { names: found, loose, calls }
}

/** Erstes Element der Einträge in const name = [[…], …] (Aktionen im Handy-Menü). */
function tupleNames(files, { file, array }) {
  const f = files[file]
  const hit = [...inCode(f, new RegExp(`const ${array} = \\[`, 'g'))][0]
  if (!hit) return { names: [], loose: [`${file}: const ${array} = [ fehlt`], calls: 0 }
  const open = hit.index + hit[0].length - 1
  let end = open
  do end = exprEndAt(f, end + 1)
  while (f.src[end] === ',')
  const code = f.m[open]
  const names = []
  let depth = 0
  for (let i = open + 1; i < end; i++) {
    if (f.m[i] !== code) continue
    if (f.src[i] === '[' && depth === 0) {
      const p = skip(f, i + 1)
      if (kindAt(f.m, p) === STR) names.push({ name: f.src.slice(p + 1, endOf(f, p) - 1), at: `${file}:${lineOf(f.src, i)}` })
    }
    if ('([{'.includes(f.src[i])) depth++
    else if (')]}'.includes(f.src[i])) depth--
  }
  return { names, loose: [], calls: names.length }
}

/** Namen der Platzhalter in views/lazy.js (actions: '…' je Modul). */
function lazyNames(files) {
  const f = files['src/ui/views/lazy.js']
  const names = []
  for (const hit of inCode(f, /(?<![\w$.])actions\s*:/g)) {
    const p = skip(f, hit.index + hit[0].length)
    const end = endOf(f, p)
    assert.ok([STR, TEXT].includes(kindAt(f.m, p)) && f.src[end - 1] === f.src[p], `${f.name}:${lineOf(f.src, p)}: actions als fester Text`)
    names.push(...f.src.slice(p + 1, end - 1).split(/\s+/).filter(Boolean))
  }
  return names
}

// ---------------------------------------------------------------- Bewusst zusammengesetzte Namen

const ALL = (files) => Object.keys(files)
/**
 * Stellen, an denen der Name der Aktion erst beim Zeichnen feststeht: Datei, Art, Ausdruck (wie im Quelltext,
 * Leerraum zusammengezogen) und woher die Namen kommen. props: aus data-…="…" oder action: '…' (oben schon
 * geprüft); helper: feste Argumente in Aufrufen dieser Funktion (skip: kein Name, prefix: davor);
 * tuples: erste Einträge einer Liste; names: feste Namen; keine: ruft keine Aktion auf.
 */
const DYNAMISCH = [
  // Verteiler: rufen auf, was andere Stellen als Namen angeben
  { file: 'src/ui/app.js', kind: 'ACTIONS[…]', expr: 'el.dataset.action', why: 'Klick: Name aus data-action', props: true },
  { file: 'src/ui/app.js', kind: 'ACTIONS[…]', expr: 'e.target.dataset.change', why: 'Änderung: Name aus data-change', props: true },
  { file: 'src/ui/app.js', kind: 'ACTIONS[…]', expr: 'e.target.dataset.input', why: 'Tippen: Name aus data-input', props: true },
  { file: 'src/ui/context.js', kind: 'ACTIONS[…]', expr: 'name', why: 'Registrierung (registerActions, registerLazy)', props: true },
  { file: 'src/ui/context.js', kind: 'ACTIONS[…]', expr: 'name', why: 'ensureAction(name): Modul laden, dann aufrufen', helper: { fn: 'ensureAction', arg: 0, in: ALL, props: ['name', 'a.action'] } },
  { file: 'src/ui/context.js', kind: 'ACTIONS[…]', expr: 'name', why: 'Posteingang: run(name, …) über ensureAction', helper: { fn: 'run', arg: 0, in: ['src/ui/views/posteingang.js'] } },
  { file: 'src/ui/help.js', kind: 'ACTIONS[…]', expr: 't.action.action', why: 'Knopf eines Hilfe-Themas: action: { action: … } in help/topics.js', props: true },
  { file: 'src/ui/help.js', kind: 'data-action', expr: '${t.action.action}', why: 'Auswahl [data-action="…"] zum Hervorheben, Name aus dem Hilfe-Thema', props: true },
  { file: 'src/ui/help.js', kind: 'ACTIONS[…]', expr: 'run', why: 'Cleo-Antwort: data-run aus help/brain.js; goto-day erledigt help-run selbst', helper: { fn: 'btn', arg: 1, in: ['src/help/brain.js'], skip: ['goto-day'] } },
  { file: 'src/ui/help.js', kind: 'ACTIONS[…]', expr: 'run', why: 'Cleo-Antwort: Zeile mit data-run aus help/brain.js; leer: Zeile ohne Knopf', helper: { fn: 'row', arg: 1, in: ['src/help/brain.js'], skip: [''] } },
  { file: 'src/ui/kix.js', kind: 'ACTIONS[…]', expr: 's.retry.action', why: 'Erneut versuchen: retry: { action: … }', props: true },
  { file: 'src/ui/mailer.js', kind: 'ACTIONS[…]', expr: 'action', why: 'captureExport(of): Export als Anhang, Name aus data-of', props: true },
  { file: 'src/ui/mailer.js', kind: 'ACTIONS[…]', expr: 'of', why: 'Anhang per E-Mail: Name aus data-of', props: true },
  { file: 'src/ui/quick.js', kind: 'ACTIONS[…]', expr: 'q.action', why: 'Schnellzugriff „Neu anlegen“: action: … in QUICK', props: true },
  { file: 'src/ui/search.js', kind: 'ACTIONS[…]', expr: 'r.action', why: 'Treffer der Suche: action: …', props: true },
  { file: 'src/ui/views/disponent.js', kind: 'ACTIONS[…]', expr: 'action', why: 'Disponent: dispatch(name, …); p.run/p.open sind { action: … }', helper: { fn: 'dispatch', arg: 0, in: ['src/ui/views/disponent.js'], props: ['p.run.action', 'p.open.action'] } },
  { file: 'src/ui/views/matten-uebersicht.js', kind: 'ACTIONS[…]', expr: 'name', why: 'Kacheln der Übersicht: call(name, …)', helper: { fn: 'call', arg: 0, in: ['src/ui/views/matten-uebersicht.js'] } },
  // Knöpfe aus Helfern
  { file: 'src/ui/flow.js', kind: 'data-action', expr: '${s.action}', why: 'Schritte der Woche: action: …', props: true },
  { file: 'src/ui/flow.js', kind: 'data-action', expr: '${next.action}', why: 'nächster Schritt der Woche: action: …', props: true },
  { file: 'src/ui/shared.js', kind: 'data-action', expr: '${esc(x.action)}', why: 'Menüeinträge: action: …', props: true },
  { file: 'src/ui/shared.js', kind: 'data-action', expr: '${action}', why: 'Reiter (tabBar): action: …', props: true },
  { file: 'src/ui/views/home.js', kind: 'data-action', expr: '${tip.action}', why: 'Tipp von Cleo: action: … (leer: ohne Knopf)', props: true },
  { file: 'src/ui/views/home.js', kind: 'data-action', expr: '${action}', why: 'Kacheln der Startseite: stat(n, text, name)', helper: { fn: 'stat', arg: 2, in: ['src/ui/views/home.js'] } },
  { file: 'src/ui/mobile.js', kind: 'data-action', expr: '${action}', why: 'Aktionen im Handy-Menü: [name, Text, Klasse]', tuples: { file: 'src/ui/mobile.js', array: 'actions' } },
  { file: 'src/ui/theme.js', kind: 'data-action', expr: 'theme-${name}', why: 'Darstellung: seg(name, …) → theme-name', helper: { fn: 'seg', arg: 0, in: ['src/ui/theme.js'], prefix: 'theme-' } },
  { file: 'src/ui/views/einkauf-shared.js', kind: 'data-action', expr: '${action}', why: 'Beleg öffnen: belegChip(beleg, name)', helper: { fn: 'belegChip', arg: 1, in: ALL } },
  { file: 'src/ui/views/eintritt.js', kind: 'data-action', expr: '${action}', why: 'Knöpfe der Eintritts-Aufgaben: btn(name, …)', helper: { fn: 'btn', arg: 0, in: ['src/ui/views/eintritt.js'] } },
  { file: 'src/ui/views/invoicing-abrechnung.js', kind: 'data-action', expr: '${action}', why: 'Umschalter: seg(name, …)', helper: { fn: 'seg', arg: 0, in: ['src/ui/views/invoicing-abrechnung.js'] } },
  { file: 'src/ui/views/invoicing-laeufe.js', kind: 'data-change', expr: '${action}', why: 'Häkchen im Rechnungslauf: pick(…, name)', helper: { fn: 'pick', arg: 3, in: ['src/ui/views/invoicing-laeufe.js'] } },
  { file: 'src/ui/views/purchase.js', kind: 'data-action', expr: "${tab === 'kassenbuch' ? 'view\" data-view=\"kassenbuch' : `ek-tab\" data-v=\"${tab}`}", why: 'Kacheln im Einkauf: Kassenbuch öffnet die Ansicht, sonst den Reiter', names: ['view', 'ek-tab'] },
  // data-change trägt an diesen Knöpfen die Kennung des Wechsels (Knöpfe lösen kein change aus)
  { file: 'src/ui/views/vehicles.js', kind: 'data-change', expr: '${esc(c.id)}', why: 'Kennung des Wechsels am Knopf', keine: true },
  { file: 'src/ui/views/vehicles.js', kind: 'data-change', expr: '${esc(change.id)}', why: 'Kennung des Wechsels am Knopf', keine: true },
  { file: 'src/ui/views/vehicles.js', kind: 'data-change', expr: '${esc(it.change.id)}', why: 'Kennung des Wechsels am Knopf', keine: true },
]

// ---------------------------------------------------------------- Prüfungen

const files = read()
const { defs, refs, dynamic, odd } = analyse(files)
const lazy = lazyNames(files)

/** Namen aus den Helfern und festen Listen in DYNAMISCH, dazu Unlesbares und veraltete Einträge. */
function helperRefs() {
  const out = []
  const loose = []
  const empty = []
  for (const d of DYNAMISCH) {
    if (d.names) out.push(...d.names.map((name) => ({ name, kind: 'DYNAMISCH', at: d.file })))
    if (!d.helper && !d.tuples) continue
    const spec = d.helper && { ...d.helper, in: typeof d.helper.in === 'function' ? d.helper.in(files) : d.helper.in }
    const found = spec ? helperNames(files, spec) : tupleNames(files, d.tuples)
    if (!found.calls) empty.push(`${d.file}: ${spec ? `kein Aufruf von ${spec.fn}(…)` : `Liste ${d.tuples.array} leer`}`)
    out.push(...found.names.filter((x) => !spec?.skip?.includes(x.name)).map((x) => ({ ...x, name: `${spec?.prefix || ''}${x.name}`, kind: spec ? `${spec.fn}(…)` : d.tuples.array })))
    loose.push(...found.loose)
  }
  return { refs: out, loose, empty }
}
const helpers = helperRefs()

test('Aktionen: der Leser findet alle Registrierungen (Probe mit den Platzhaltern aus views/lazy.js)', () => {
  for (const f of Object.values(files)) assert.equal(f.depth, 0, `${f.name}: Klammern gehen nicht auf (Leser im Test verlesen?)`)
  assert.deepEqual(odd, [], 'Stellen, die der Leser nicht versteht (Name erst zur Laufzeit?): Leser erweitern oder festen Namen verwenden')
  assert.ok(lazy.length > 500 && defs.size > 1000, `zu wenig gefunden: ${lazy.length} Platzhalter, ${defs.size} Aktionen`)
  assert.deepEqual(lazy.filter((name) => !defs.has(name)), [], 'Platzhalter ohne gefundene Registrierung: Leser im Test erweitern oder Platzhalter streichen')
})

test('Aktionen: jeder Knopf, jedes Feld und jeder Verweis hat eine Aktion (keine toten Knöpfe)', () => {
  const known = new Set([...defs.keys(), ...lazy])
  const dead = [...refs, ...helpers.refs].filter((r) => !known.has(r.name)).map((r) => `${r.at} ${r.kind} „${r.name}“`)
  assert.deepEqual(dead, [], 'Name ohne registrierte Aktion: Klick ohne Wirkung')
  assert.deepEqual(helpers.loose, [], 'Helfer mit Namen, die erst zur Laufzeit feststehen: fest angeben oder in DYNAMISCH eigens eintragen')
  assert.deepEqual(helpers.empty, [], 'DYNAMISCH veraltet: Helfer ohne Aufruf')
  const bad = [...refs, ...helpers.refs].filter((r) => !NAME.test(r.name)).map((r) => `${r.at} „${r.name}“`)
  assert.deepEqual(bad, [], 'Namen von Aktionen: klein, mit Bindestrich')
})

test('Aktionen: zusammengesetzte Namen stehen in DYNAMISCH (und DYNAMISCH ist aktuell)', () => {
  const key = (d) => `${d.file} ${d.kind} ${d.expr}`
  const listed = new Set(DYNAMISCH.map(key))
  const found = new Set(dynamic.map(key))
  assert.deepEqual(dynamic.filter((d) => !listed.has(key(d))).map((d) => `${d.at} ${d.kind} ${d.expr}`), [], 'neue Stelle mit zusammengesetztem Namen: in DYNAMISCH eintragen, mit Herkunft der Namen')
  assert.deepEqual([...listed].filter((k) => !found.has(k)), [], 'DYNAMISCH: Stelle gibt es nicht mehr')
  for (const d of DYNAMISCH) assert.ok(d.why && [d.props, d.helper, d.tuples, d.names, d.keine].filter(Boolean).length === 1, `${key(d)}: Herkunft der Namen und Begründung angeben`)
})
