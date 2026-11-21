// Zweistufige Bestätigung (confirmStep): Nach dem ersten Klick muss man SEHEN, dass ein zweiter nötig ist –
// entweder ändert der Knopf seine Beschriftung (die Ansicht fragt app.ui.confirm mit demselben Schlüssel ab)
// oder die Aktion sagt es per Hinweis (toast) in derselben Zeile. Sonst wirkt der Knopf, als ginge er nicht.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const ROOT = new URL('../src/ui', import.meta.url).pathname
const files = []
const walk = (dir) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p) } }
walk(ROOT)
const sources = files.map((f) => ({ f: f.slice(ROOT.length + 1), lines: readFileSync(f, 'utf8').split('\n') }))
// Zeilen, die den Zustand abfragen (nicht der Aufruf selbst)
const askLines = sources.flatMap((s) => s.lines.filter((l) => /confirm/i.test(l) && !/confirmStep\(/.test(l)))
const prefixOf = (key) => key.split(/[:$]/)[0]

test('confirmStep: jeder Aufruf mit festem Schlüssel hat eine sichtbare Rückmeldung nach dem ersten Klick', () => {
  const calls = []
  for (const s of sources) s.lines.forEach((line, i) => { for (const m of line.matchAll(/confirmStep\(\s*([`'])(.*?)\1/g)) calls.push({ where: `${s.f}:${i + 1}`, key: m[2], line }) })
  assert.ok(calls.length >= 80, `nur ${calls.length} Aufrufe gefunden – stimmt das Muster noch?`)
  const silent = calls.filter((c) => {
    if (/toast\(/.test(c.line)) return false
    const p = prefixOf(c.key)
    return !askLines.some((l) => l.includes(`'${p}`) || l.includes(`\`${p}`))
  })
  assert.deepEqual(silent.map((c) => `${c.where} ${c.key}`), [], 'ohne sichtbare Rückmeldung (Beschriftung ändern oder Hinweis zeigen)')
})

test('confirmStep: die vier Knöpfe, die stumm waren, fragen jetzt den Zustand ab', () => {
  const all = sources.flatMap((s) => s.lines).join('\n')
  for (const key of ['kasse-close:${ym}', 'fak-pdel:${p.id}', 'ek-sepa-book:${r.id}', 'ek-bank-undo:${p.bank}']) assert.ok(all.includes(`app.ui.confirm === \`${key}\``), key)
})
