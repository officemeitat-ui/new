// Mehrsprachigkeit für Mitarbeitende: Texte der Handy-Seite (mein-plan-texte.php), Sprache je Person,
// übersetzte Objektanweisungen mit „veraltet“, Link-Nachricht, Anfrage an die KI (core/sprachen.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { FOREIGN_LANGUAGES, LANGUAGES, LINK_TEXTS, langOf, linkMessage, objectInfo, parseTranslation, sourceKey, staleLanguages, translationRequest, translationRows, updateTranslations } from '../src/core/sprachen.js'
import { savePayload, staffWeek } from '../src/core/staffplan.js'
import { EMPLOYEE_TEMPLATE, importEmployees, languageSummary, parseLanguage } from '../src/core/importer.js'
import { PHP_KEYS, PLAN_TEXTS, planTexts } from '../src/export/wochenplan-texte.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (f) => readFileSync(`${root}${f}`, 'utf8')
const SRC = read('mein-plan-texte.php')

/** Das Array hinter „return [“ lesen (Strings in einfachen Anführungszeichen, Listen, Schlüssel => Wert). */
function phpArray(src) {
  let i = src.indexOf('return [') + 'return '.length
  const ws = () => {
    for (;;) {
      if (/\s/.test(src[i])) i++
      else if (src.startsWith('//', i)) i = src.indexOf('\n', i)
      else return
    }
  }
  const value = () => {
    ws()
    if (src[i] === "'") {
      let s = ''
      for (i++; src[i] !== "'"; i++) {
        if (src[i] === '\\' && (src[i + 1] === "'" || src[i + 1] === '\\')) i++
        s += src[i]
      }
      i++
      return s
    }
    if (src[i] !== '[') throw new Error(`Unerwartet bei ${i}: ${src.slice(i, i + 30)}`)
    i++
    const list = []
    const map = {}
    let isMap = false
    for (;;) {
      ws()
      if (src[i] === ']') {
        i++
        return isMap ? map : list
      }
      const v = value()
      ws()
      if (src.startsWith('=>', i)) {
        i += 2
        map[v] = value()
        isMap = true
      } else list.push(v)
      ws()
      if (src[i] === ',') i++
    }
  }
  return value()
}

const TEXTE = phpArray(SRC)
const DE = TEXTE.de
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

test('Texte: alle Sprachen der App, Deutsch zuerst', () => {
  assert.deepEqual(Object.keys(TEXTE), LANGUAGES.map((l) => l.id))
  for (const l of LANGUAGES) {
    assert.equal(TEXTE[l.id].sprache_name, l.own, `${l.id}: Name der Sprache wie in der App`)
    assert.equal(TEXTE[l.id].html_lang, l.html, `${l.id}: HTML-Sprache`)
  }
  assert.equal(TEXTE.bks.sprache_name, 'Bosanski/Hrvatski/Srpski')
  assert.ok(Object.keys(DE).length >= 150, `${Object.keys(DE).length} Texte`)
})

test('Texte: jede Sprache hat dieselben Schlüssel wie Deutsch, keine leeren Texte, gleiche Platzhalter', () => {
  for (const [lang, t] of Object.entries(TEXTE)) {
    assert.deepEqual(Object.keys(t), Object.keys(DE), `${lang}: Schlüssel (und Reihenfolge) wie Deutsch`)
    for (const [key, de] of Object.entries(DE)) {
      const v = t[key]
      if (Array.isArray(de)) {
        assert.ok(Array.isArray(v) && v.length === de.length, `${lang}.${key}: Liste mit ${de.length} Einträgen`)
        for (const x of v) assert.ok(typeof x === 'string' && x.trim(), `${lang}.${key}: leerer Eintrag`)
        continue
      }
      assert.equal(typeof v, 'string', `${lang}.${key}`)
      assert.ok(v.trim(), `${lang}.${key}: leer`)
      assert.equal(v, v.trim(), `${lang}.${key}: Leerzeichen am Rand`)
      assert.deepEqual(holes(v), holes(de), `${lang}.${key}: Platzhalter wie im Deutschen`)
      assert.ok(!/%[sd]/.test(v), `${lang}.${key}: Platzhalter nur als {name}`)
    }
  }
})

test('Texte: Wochentage und Datum je Sprache, nicht deutsch (außer Deutsch)', () => {
  for (const [lang, t] of Object.entries(TEXTE)) {
    assert.equal(t.tage.length, 7)
    assert.equal(new Set(t.tage).size, 7, `${lang}: Wochentage verschieden`)
    assert.equal(new Set(t.tage_lang).size, 7, `${lang}: lange Wochentage verschieden`)
    assert.deepEqual(holes(t.datum), ['d', 'm', 'tag'])
    if (lang !== 'de') assert.notDeepEqual(t.tage_lang, DE.tage_lang, `${lang}: eigene Wochentage`)
  }
  assert.deepEqual(TEXTE.tr.tage_lang, ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'])
  assert.deepEqual(TEXTE.ro.tage_lang, ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'])
  assert.equal(TEXTE.hu.datum, '{tag}, {m}.{d}.', 'Ungarisch: Monat vor Tag')
  assert.equal(TEXTE.en.dezimal, '.')
})

test('Texte: Übersetzungen unterscheiden sich vom Deutschen (keine vergessenen Kopien)', () => {
  // gleich wie Deutsch dürfen nur Namen, Zahlen und Platzhalter sein
  const same = new Set(['dezimal', 'feiertag', 'push_antrag', 'termin', 'art_material', 'push_material_abgelehnt', 'w_sand', 'ics_termin'])
  for (const [lang, t] of Object.entries(TEXTE)) {
    if (lang === 'de') continue
    const copies = Object.keys(DE).filter((k) => typeof DE[k] === 'string' && t[k] === DE[k] && !same.has(k) && /[a-zäöüß]{4}/i.test(DE[k]) && !/^(.{0,3}|[A-Z]+)$/.test(DE[k]))
    assert.deepEqual(copies, [], `${lang}: noch deutsch`)
  }
})

test('Texte: PHP liest dieselbe Datei (wenn PHP da ist)', (t) => {
  let out
  try {
    out = execFileSync('php', ['-r', 'echo json_encode(require "mein-plan-texte.php", JSON_UNESCAPED_UNICODE);'], { cwd: root, encoding: 'utf8' })
  } catch {
    return t.skip('PHP nicht installiert')
  }
  assert.deepEqual(JSON.parse(out), TEXTE)
})

// ---------------------------------------------------------------- Hinweise der App am Handy (mein-plan.php)

const PLAN = read('mein-plan.php')
const ABW = /const ABWESENHEITEN = '([^']+)'/.exec(PLAN)[1]
// Muster aus NOTIZ_MUSTER (PHP, einfache Anführungszeichen) als JavaScript-Ausdrücke
const BLOCK = PLAN.slice(PLAN.indexOf('const NOTIZ_MUSTER'), PLAN.indexOf('];', PLAN.indexOf('const NOTIZ_MUSTER')))
const MUSTER = [...BLOCK.matchAll(/^\s*'(.+)' => '(\w+)',$/gm)].map((m) => ({ re: new RegExp(m[1].replaceAll("' . ABWESENHEITEN . '", ABW).replace(/^\//, '').replace(/\/u$/, ''), 'u'), key: m[2] }))

test('Hinweise: jedes Muster hat einen Text, Deutsch ergibt wieder denselben Hinweis', () => {
  assert.ok(MUSTER.length >= 20, `${MUSTER.length} Muster`)
  const samples = ['danach 15 min Fahrt zu Bank Hallein', 'danach 20 min Fahrt zu nächstem Einsatz', 'danach 10 min Fahrt', 'Fahrt: über Autobahn', 'Vertretung für Anna, Bernd', 'Vertretung: Carla', 'verschoben von Mo 02.11. (Feiertag)', 'verschoben von Di 03.11.', 'verschoben auf Mi 04.11.', 'Zeit diese Woche geändert', 'entfällt diese Woche', 'entfällt: Allerheiligen', 'Feiertag angerechnet', 'nicht besetzt', '30 min Pause abgezogen', 'inkl. 100 % Feiertagszuschlag', 'inkl. 50 % Sonntagszuschlag', '100 % Feiertagszuschlag wird ausbezahlt', '50 % Sonntagszuschlag wird ausbezahlt', 'Zeitausgleich (aus dem Zeitkonto)', 'Feiertag (Urlaub) angerechnet', 'Feiertag (Krankenstand)', 'Urlaub angerechnet']
  for (const n of samples) {
    const hit = MUSTER.find((m) => m.re.test(n))
    assert.ok(hit, `kein Muster für „${n}“`)
    assert.ok(DE[hit.key], `${hit.key} fehlt in den Texten`)
    const groups = n.match(hit.re).groups || {}
    assert.equal(DE[hit.key].replace(/\{(\w+)\}/g, (_, k) => groups[k]), n, `${hit.key}: Deutsch passt zum Muster`)
  }
  for (const m of MUSTER) assert.ok(DE[m.key], m.key)
})

test('Hinweise: feste Antworten des Büros stehen so in der App (werden am Handy übersetzt)', () => {
  const app = read('src/ui/staffplan.js') + read('src/ui/views/material.js')
  for (const [key, de] of Object.entries(DE)) {
    if (!key.startsWith('antwort_')) continue
    const fixed = de.split('{name}')[0]
    assert.ok(app.includes(`'${de}'`) || (de.includes('{name}') && app.includes(fixed)), `${key}: „${de}“ kommt in der App nicht vor`)
  }
})

// ---------------------------------------------------------------- Sprache je Person, Objektanweisungen

test('Sprache je Person: Standard Deutsch, unbekannte Kennung zählt als Deutsch', () => {
  assert.equal(langOf({}), 'de')
  assert.equal(langOf({ lang: 'tr' }), 'tr')
  assert.equal(langOf({ lang: 'xx' }), 'de')
  assert.equal(FOREIGN_LANGUAGES.length, 5)
})

test('Objektanweisung: Übersetzung aktuell, nach Änderung des Deutschen veraltet, „Passt noch“ und neue Übersetzung', () => {
  const de1 = 'Zugang über den Hintereingang.\nBehandlungsräume mit Flächendesinfektion.'
  assert.equal(sourceKey(de1), sourceKey(`  ${de1.replace('\n', '  \n ')} `), 'Leerzeichen zählen nicht')
  assert.notEqual(sourceKey(de1), sourceKey('Zugang über den Haupteingang.'))
  const obj = { instructions: de1, instructionsI18n: updateTranslations({}, de1, { tr: 'Arka kapıdan giriş.', ro: '' }, { by: 'Eva Büro', at: '2026-11-06' }) }
  assert.deepEqual(Object.keys(obj.instructionsI18n), ['tr'])
  assert.deepEqual(staleLanguages(obj), [])
  assert.deepEqual(objectInfo(obj), { hinweis: de1, uebersetzt: { tr: { text: 'Arka kapıdan giriş.' } } })
  // deutscher Text geändert, Übersetzung unverändert gespeichert → veraltet
  const de2 = 'Zugang über den Haupteingang.'
  const changed = { ...obj, instructions: de2, instructionsI18n: updateTranslations(obj, de2, { tr: 'Arka kapıdan giriş.' }) }
  assert.deepEqual(staleLanguages(changed), ['tr'])
  assert.deepEqual(objectInfo(changed).uebersetzt.tr, { text: 'Arka kapıdan giriş.', veraltet: true })
  assert.equal(translationRows(changed).find((r) => r.id === 'tr').by, 'Eva Büro')
  // „Passt noch“: wieder aktuell, Text bleibt
  const ok = { ...changed, instructionsI18n: updateTranslations(changed, de2, { tr: 'Arka kapıdan giriş.' }, { confirmed: ['tr'], by: 'Max', at: '2026-11-07' }) }
  assert.deepEqual(staleLanguages(ok), [])
  assert.deepEqual([ok.instructionsI18n.tr.by, ok.instructionsI18n.tr.at], ['Max', '2026-11-07'])
  // neu übersetzt (mit der KI): aktuell, als KI markiert
  const ki = { ...changed, instructionsI18n: updateTranslations(changed, de2, { tr: 'Ana kapıdan giriş.' }, { ki: ['tr'] }) }
  assert.deepEqual(staleLanguages(ki), [])
  assert.equal(ki.instructionsI18n.tr.ki, true)
  // ohne deutschen Text keine Übersetzungen, kein Hinweis am Handy
  assert.equal(updateTranslations(ki, '  ', { tr: 'x' }), undefined)
  assert.equal(objectInfo({ instructionsI18n: { tr: { text: 'x' } } }), null)
})

test('Plan am Handy: Objektanweisung einmal je Objekt der Woche, Sprache der Person in der Übertragung', () => {
  const monday = '2026-11-02'
  const days = Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${2 + i}`, lines: [], holiday: null, absence: null }))
  const line = (key, objectId) => ({ kind: 'work', inst: { key, objectId, startTime: '08:00', label: 'Stiege' }, time: '08:00 - 10:00', text: '', travel: 0, notes: [] })
  days[0].lines.push(line('a', 'o1'), line('b', 'o2'))
  days[1].lines.push(line('c', 'o1'))
  const o1 = { id: 'o1', name: 'Praxis', instructions: 'Hintereingang benutzen.', instructionsI18n: { en: { text: 'Use the back door.', source: sourceKey('Hintereingang benutzen.') }, hu: { text: 'Régi szöveg', source: 'alt' } } }
  const w = staffWeek({ monday, days, totals: { ist: 0, soll: 0 } }, { objectsById: new Map([['o1', o1], ['o2', { id: 'o2', name: 'Lager' }]]) })
  assert.deepEqual(w.objektinfo, { o1: { hinweis: 'Hintereingang benutzen.', uebersetzt: { hu: { text: 'Régi szöveg', veraltet: true }, en: { text: 'Use the back door.' } } } })
  assert.equal(staffWeek({ monday, days: days.map((d) => ({ ...d, lines: [] })), totals: { ist: 0, soll: 0 } }).objektinfo, undefined)
  const p = savePayload([{ hash: 'h1', name: 'Elif', ntfy: '', sprache: 'tr', monday, week: w }, { hash: 'h2', name: 'Max', sprache: 'de', monday, week: w }])
  assert.deepEqual(p.personen.map((x) => x.sprache), ['tr', 'de'], 'auch Deutsch geht mit (Wechsel zurück auf Deutsch)')
})

// ---------------------------------------------------------------- Link-Nachricht

test('Link-Nachricht: alle Sprachen mit denselben Teilen und Platzhaltern, Deutsch wie bisher', () => {
  assert.deepEqual(Object.keys(LINK_TEXTS), LANGUAGES.map((l) => l.id))
  for (const [lang, t] of Object.entries(LINK_TEXTS)) {
    assert.deepEqual(Object.keys(t), Object.keys(LINK_TEXTS.de), lang)
    for (const k of Object.keys(t)) {
      assert.ok(t[k].trim(), `${lang}.${k}`)
      assert.deepEqual(holes(t[k]), holes(LINK_TEXTS.de[k]), `${lang}.${k}: Platzhalter`)
    }
  }
  const de = linkMessage('de', { name: 'Anna', product: 'Cleanos App', link: 'https://app.cleanos.at/mein-plan.php?p=X', topic: 'mp-1' })
  assert.equal(de.subject, 'Dein Dienstplan am Handy')
  assert.equal(de.text, 'Hallo Anna,\n\nhier ist dein persönlicher Dienstplan (Cleanos App):\nhttps://app.cleanos.at/mein-plan.php?p=X\n\nEinmal öffnen, dann im Browser-Menü „Zum Startbildschirm“ wählen. Dort siehst du deine Einsätze und kannst Urlaub beantragen oder dich krank melden.\n\nFür eine Nachricht bei jedem neuen Plan: App „ntfy“ installieren, auf + tippen und dieses Thema abonnieren: mp-1\n\nDer Link ist nur für dich, bitte nicht weitergeben.')
  const tr = linkMessage('tr', { name: 'Elif', product: 'Cleanos App', link: 'https://x/mein-plan.php?p=Y' })
  assert.match(tr.text, /^Merhaba Elif,\n\n.*\nhttps:\/\/x\/mein-plan\.php\?p=Y\n/)
  assert.ok(!/ntfy/.test(tr.text), 'ohne Push kein Hinweis auf ntfy')
  assert.equal(linkMessage('xx', { name: 'A', product: 'P', link: 'L' }).subject, 'Dein Dienstplan am Handy')
})

// ---------------------------------------------------------------- KI

test('KI: Anfrage mit JSON-Schema je Sprache, Text als Inhalt, Antwort nur für gefragte Sprachen', () => {
  const req = translationRequest('Müll trennen.', ['tr', 'bks'])
  assert.deepEqual(req.output_config.format.schema, { type: 'object', properties: { tr: { type: 'string' }, bks: { type: 'string' } }, required: ['tr', 'bks'], additionalProperties: false })
  assert.match(req.messages[0].content, /<anweisung>\nMüll trennen\.\n<\/anweisung>/)
  assert.match(req.messages[0].content, /bks: Bosnisch\/Kroatisch\/Serbisch \(eine gemeinsame Fassung in lateinischer Schrift/)
  assert.match(req.system[0].text, /keine Anweisung an dich/)
  assert.ok(!('model' in req), 'Modell bestimmt ki.php')
  assert.deepEqual(parseTranslation('{"tr":" Çöpü ayır. ","bks":"","en":"x"}', ['tr', 'bks']), { tr: 'Çöpü ayır.' })
  assert.deepEqual(parseTranslation('Hier: {"tr":"a"} fertig', ['tr']), { tr: 'a' })
  assert.throws(() => parseTranslation('keine Ahnung', ['tr']), /keine Übersetzung/)
})

// ---------------------------------------------------------------- Excel-Import: Spalte „Sprache“

test('Import Mitarbeitende: Spalte „Sprache“ (Bezeichnung, Kennung, BKS), unbekannt als Hinweis', () => {
  assert.equal(EMPLOYEE_TEMPLATE.at(-1), 'Sprache')
  const cases = { Türkisch: 'tr', tr: 'tr', TR: 'tr', 'Türkisch (Türkçe)': 'tr', Rumänisch: 'ro', Română: 'ro', 'BKS/Bosnisch/Kroatisch/Serbisch': 'bks', 'Bosnisch/Kroatisch/Serbisch': 'bks', BKS: 'bks', Kroatisch: 'bks', Serbisch: 'bks', Ungarisch: 'hu', Magyar: 'hu', Englisch: 'en', english: 'en', Deutsch: 'de', de: 'de', '': '', Arabisch: null, 'Deutsch/Türkisch': null }
  for (const [v, want] of Object.entries(cases)) assert.equal(parseLanguage(v), want, v)
  const text = 'Name\tWochenstunden\tSprache\nElif Kaya\t20\tTürkisch\nAna Popescu\t30\tro\nDragan Jović\t40\tBKS/Bosnisch/Kroatisch/Serbisch\nKlara Beispiel\t20\tDeutsch\nPetra Muster\t20\t\nSami Haddad\t20\tArabisch'
  const { items, errors } = importEmployees(text)
  assert.deepEqual(items.map((e) => [e.name, e.lang]), [['Elif Kaya', 'tr'], ['Ana Popescu', 'ro'], ['Dragan Jović', 'bks'], ['Klara Beispiel', ''], ['Petra Muster', undefined], ['Sami Haddad', undefined]])
  assert.ok(!('lang' in items[4]), 'leere Zelle: Sprache bleibt, wie sie ist')
  assert.deepEqual(errors, ['Zeile 7 (Sami Haddad): Sprache „Arabisch“ nicht erkannt, bleibt unverändert (möglich: Deutsch, Bosnisch/Kroatisch/Serbisch, Rumänisch, Türkisch, Ungarisch, Englisch)'])
  assert.equal(languageSummary(items), '1 × Deutsch, 1 × Bosnisch/Kroatisch/Serbisch, 1 × Rumänisch, 1 × Türkisch')
  // ohne Spalte: kein Hinweis, keine Sprache
  const plain = importEmployees('Name\tWochenstunden\nElif Kaya\t20')
  assert.deepEqual([plain.errors, 'lang' in plain.items[0]], [[], false])
  assert.equal(importEmployees('Mitarbeiter;Muttersprache\nA B;Ungarisch').items[0].lang, 'hu', 'Überschrift auch „Muttersprache“, CSV mit Semikolon')
})

// ---------------------------------------------------------------- Wochenplan als PDF in der Sprache der Person

test('Wochenplan-PDF: Wörterbuch mit denselben Schlüsseln und Platzhaltern in allen Sprachen, ohne leere Texte', () => {
  assert.deepEqual(Object.keys(PLAN_TEXTS), LANGUAGES.map((l) => l.id))
  const keys = Object.keys(PLAN_TEXTS.de)
  for (const [lang, t] of Object.entries(PLAN_TEXTS)) {
    assert.deepEqual(Object.keys(t), keys, `${lang}: Schlüssel (und Reihenfolge) wie Deutsch`)
    for (const k of keys) {
      if (Array.isArray(PLAN_TEXTS.de[k])) {
        assert.ok(Array.isArray(t[k]) && t[k].length === PLAN_TEXTS.de[k].length && t[k].every((x) => String(x).trim()), `${lang}.${k}`)
        continue
      }
      assert.ok(String(t[k]).trim(), `${lang}.${k} leer`)
      assert.deepEqual(holes(t[k]), holes(PLAN_TEXTS.de[k]), `${lang}.${k}: Platzhalter`)
    }
  }
})

test('Wochenplan-PDF: gleiche Begriffe wie am Handy (mein-plan-texte.php)', () => {
  let shared = 0
  for (const [lang, t] of Object.entries(PLAN_TEXTS)) {
    for (const [k, v] of Object.entries(t)) {
      if (k in TEXTE[lang]) {
        assert.deepEqual(v, TEXTE[lang][k], `${lang}.${k} lautet anders als am Handy`)
        shared++
      } else if (PHP_KEYS[k] && lang !== 'de') assert.deepEqual(v, TEXTE[lang][PHP_KEYS[k]], `${lang}.${k} wie ${PHP_KEYS[k]} am Handy`)
    }
  }
  assert.ok(shared >= 6 * 30, `${shared} geteilte Texte`)
  for (const k of Object.keys(DE).filter((x) => x.startsWith('notiz_') && x !== 'notiz_optional')) assert.ok(k in PLAN_TEXTS.de, `Hinweis ${k} fehlt im Wochenplan`)
})

test('Wochenplan-PDF: Hinweise zu Einsätzen, Datum, Stunden und Abwesenheit in der Sprache; Namen bleiben', () => {
  const tr = planTexts('tr')
  assert.equal(tr.note('Vertretung für Ana Muster'), 'Yerine çalışılan: Ana Muster')
  assert.equal(tr.note('verschoben von Mo 02.11. (Feiertag)'), 'taşındı, eski tarih: Pzt 02.11 (resmî tatil)')
  assert.equal(tr.note('Krankenstand angerechnet'), 'Hastalık izni sayıldı')
  assert.equal(tr.note('Glas innen und außen'), 'Glas innen und außen', 'eigene Notiz bleibt')
  assert.equal(tr.date('2026-10-26', { weekday: true }), 'Pazartesi 26.10')
  const en = planTexts('en')
  assert.equal(en.hours(90), '1.5')
  assert.equal(en.absence('Urlaub'), 'Annual leave')
  assert.equal(en.employment('Teilzeit'), 'Part-time')
  assert.equal(en.date('2026-11-01', { year: true }), '01/11/2026')
  assert.equal(planTexts('hu').date('2026-11-01', { year: true }), '2026.11.01.')
  const de = planTexts('')
  assert.equal(de.lang, 'de')
  assert.equal(de.date('2026-10-26', { weekday: true }), 'Montag 26.10.')
  assert.equal(de.note('Vertretung für Ana Muster'), 'Vertretung für Ana Muster')
  assert.equal(planTexts('xx').lang, 'de')
  // Objektanweisung: Übersetzung nur, solange sie zum deutschen Text passt
  const obj = { instructions: 'Müll trennen.', instructionsI18n: { tr: { text: 'Çöpü ayır.', source: sourceKey('Müll trennen.') }, en: { text: 'Old', source: 'xxxxxxxx' } } }
  assert.equal(tr.objectInfo(obj), 'Çöpü ayır.')
  assert.equal(en.objectInfo(obj), 'Müll trennen.', 'veraltet: deutscher Text')
  assert.equal(de.objectInfo(obj), 'Müll trennen.')
})
