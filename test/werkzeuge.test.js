import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { APP_FARBEN, fuerApp, mitBruecke, WERKZEUGE } from '../scripts/werkzeuge.js'

const datei = (name) => readFileSync(new URL(`../werkzeuge/${name}/index.html`, import.meta.url), 'utf8')

test('Werkzeuge: alle vier passen zur Anmeldebrücke, sie wird als erstes Skript eingesetzt', () => {
  assert.deepEqual(
    WERKZEUGE.map((w) => w.name),
    ['wasserzaehler', 'objektkontrolle', 'objektdoku', 'mattenwechsel'],
  )
  for (const { name } of WERKZEUGE) {
    const html = datei(name)
    const out = mitBruecke(html, name)
    const brueckeAt = out.indexOf('<script src="../bruecke.js"></script>')
    const ersteSkript = out.indexOf('<script', brueckeAt + 10)
    assert.ok(brueckeAt > 0 && brueckeAt < out.indexOf('</head>'), `${name}: Brücke im Kopf`)
    assert.ok(brueckeAt < ersteSkript, `${name}: vor allen Skripten des Werkzeugs`)
    assert.ok(out.indexOf('<meta charset') < brueckeAt, `${name}: Zeichensatz bleibt vorn`)
    // sonst unverändert
    assert.equal(out.replace('\n<script src="../bruecke.js"></script>', ''), html, `${name}: Datei sonst unverändert`)
  }
})

test('Werkzeuge: in der App mit den Cleanos-Farben, sonst unverändert', () => {
  const ohneFarben = (t) => t.replace(/#[0-9a-f]{6}(?![0-9a-f])/gi, '#')
  for (const { name } of WERKZEUGE) {
    const html = readFileSync(new URL(`../werkzeuge/${name}/index.html`, import.meta.url), 'utf8')
    const out = fuerApp(html, name)
    for (const alt of Object.keys(APP_FARBEN)) assert.ok(!out.toLowerCase().includes(alt), `${name}: ${alt} noch drin`)
    assert.ok(out.includes('#0c6cb4'), `${name}: Cleanos-Blau`)
    assert.equal(ohneFarben(out), ohneFarben(mitBruecke(html, name)), `${name}: nur Farben geändert`)
    assert.ok(/#0f70b7/i.test(html), `${name}: Quelle selbst bleibt unverändert`)
  }
})

test('Werkzeuge: unpassende Datei bricht den Bau mit Erklärung ab', () => {
  assert.throws(() => mitBruecke('<!DOCTYPE html><html><head><title>x</title></head><body></body></html>', 'neu'), /passt nicht zur Brücke.*Token-Abruf/)
  const html = datei('objektdoku')
  assert.throws(() => mitBruecke(mitBruecke(html, 'objektdoku'), 'objektdoku'), /schon eingesetzt/)
})

test('Werkzeuge: keine Kundendaten in den Dateien (Repository ist öffentlich)', () => {
  for (const { name } of WERKZEUGE) {
    const html = datei(name)
    assert.ok(!/const EINGEBAUT = \{/.test(html), `${name}: keine eingebauten Ablese-Listen`)
    assert.ok(!/const STAMM_VORGABE = \[\s*\{/.test(html), `${name}: keine eingebauten Standorte`)
  }
})

test('Werkzeuge: „Abschließen“ legt alles in SharePoint ab und holt Offenes nach (keine ältere Fassung einspielen)', () => {
  const fassung = (html) => (html.match(/const VERSION\s*=\s*"([\d.]+)"/) || [])[1]
  const mind = (v, soll) => v.split('.').map(Number).reduce((r, x, i) => r || x - (soll.split('.').map(Number)[i] || 0), 0) >= 0
  const erwartet = {
    // 1.14 / 2.10 / 2.2: Ablage je Revier (Ordner „Revier <Name>“, core/reviere.js)
    wasserzaehler: { version: '1.15', muss: [/function heute\(\)\{[^}]*getDate\(\)/, /function pdfsNachreichen\(/, /pdfOffenSetzen\(doc\.id, doc\.aktiv, true\)/, /function revierName\(/] },
    // 2.8 rief graphFotosAblegen auf, ohne sie zu enthalten
    objektkontrolle: { version: '2.11', muss: [/function heute\(\)\{[^}]*getDate\(\)/, /async function graphFotosAblegen\(/, /function ablageNachholen\(/, /addEventListener\("online"/, /function revierName\(/] },
    // 2.3: Hilfe schließt per Knopf, „geändert“ nur bei echter Änderung (Abgleich ohne falsche Konflikte),
    // Bilder vom anderen Gerät werden nachgeladen
    objektdoku: { version: '2.3', muss: [/id="kAbschluss"/, /async function abschliessen\(/, /function ablageNachholen\(/, /function revierName\(/, /\$\("kHilfeZu"\)\.addEventListener\("click"/, /function objektFingerabdruck\(/, /function bilderNachholen\(/] },
    mattenwechsel: { version: '2.5', muss: [/function heute\(\)\{[^}]*getDate\(\)/, /function ablageAnstossen\(/, /addEventListener\("online", ablageAnstossen\)/] },
  }
  for (const [name, { version, muss }] of Object.entries(erwartet)) {
    const html = datei(name)
    const v = fassung(html)
    assert.ok(v && mind(v, version), `${name}: Fassung ${v} – mindestens ${version} nötig`)
    for (const re of muss) assert.match(html, re, `${name}: ${re}`)
  }
})

test('Werkzeuge: Revier-Ordner heißen überall gleich (revierName wie in der App, core/reviere.js)', async () => {
  const { revierName } = await import('../src/core/reviere.js')
  const proben = ['Salzburg Stadt', '  Flachgau / Nord ', 'Pongau: Süd?', 'Tennengau', 'Salzburg-Stadt', 'Außenbezirk  Ost', '']
  for (const name of ['wasserzaehler', 'objektkontrolle', 'objektdoku']) {
    const html = datei(name)
    const start = html.indexOf('function revierName(')
    assert.ok(start >= 0, `${name}: revierName fehlt`)
    // Funktion samt Rumpf herauslösen (Klammern zählen) und ausführen
    let i = html.indexOf('{', start)
    let tiefe = 0
    for (; i < html.length; i++) {
      if (html[i] === '{') tiefe++
      else if (html[i] === '}' && --tiefe === 0) break
    }
    const fn = new Function(`${html.slice(start, i + 1)}; return revierName`)()
    for (const p of proben) assert.equal(fn(p), revierName(p), `${name}: revierName(${JSON.stringify(p)})`)
  }
})
