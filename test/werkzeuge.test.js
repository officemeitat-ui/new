import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { mitBruecke, WERKZEUGE } from '../scripts/werkzeuge.js'

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
    wasserzaehler: { version: '1.13', muss: [/function pdfsNachreichen\(/, /pdfOffenSetzen\(doc\.id, doc\.aktiv, true\)/] },
    // 2.8 rief graphFotosAblegen auf, ohne sie zu enthalten
    objektkontrolle: { version: '2.9', muss: [/async function graphFotosAblegen\(/, /function ablageNachholen\(/, /addEventListener\("online"/] },
    objektdoku: { version: '2.1', muss: [/id="kAbschluss"/, /async function abschliessen\(/, /function ablageNachholen\(/] },
    mattenwechsel: { version: '2.4', muss: [/function ablageAnstossen\(/, /addEventListener\("online", ablageAnstossen\)/] },
  }
  for (const [name, { version, muss }] of Object.entries(erwartet)) {
    const html = datei(name)
    const v = fassung(html)
    assert.ok(v && mind(v, version), `${name}: Fassung ${v} – mindestens ${version} nötig`)
    for (const re of muss) assert.match(html, re, `${name}: ${re}`)
  }
})
