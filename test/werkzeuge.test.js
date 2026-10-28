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
