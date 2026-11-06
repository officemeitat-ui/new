// Stildateien: jede geöffnete Klammer wird geschlossen. Eine verlorene „}“ (z. B. beim Zusammenführen)
// schiebt sonst alle folgenden Regeln stillschweigend in einen @media-Block – am PC fehlen sie dann.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const files = [
  ...readdirSync(new URL('../src/ui/', import.meta.url)).filter((f) => f.endsWith('.css')).map((f) => new URL(`../src/ui/${f}`, import.meta.url)),
  ...readdirSync(new URL('../themes/', import.meta.url)).filter((f) => f.endsWith('.css')).map((f) => new URL(`../themes/${f}`, import.meta.url)),
]

test('Stildateien: Klammern gehen auf (keine Regeln versehentlich in @media)', () => {
  assert.ok(files.length >= 2)
  for (const file of files) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
    let depth = 0
    let line = 1
    const open = []
    for (const ch of css) {
      if (ch === '\n') line++
      else if (ch === '{') open.push(line), depth++
      else if (ch === '}') {
        assert.ok(depth > 0, `${file.pathname.split('/').slice(-2).join('/')}: „}“ zu viel in Zeile ${line}`)
        open.pop(), depth--
      }
    }
    assert.equal(depth, 0, `${file.pathname.split('/').slice(-2).join('/')}: „{“ aus Zeile ${open.at(-1)} wird nie geschlossen`)
  }
})
