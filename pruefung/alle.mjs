// Alle Browser-Prüfungen nacheinander (jede in einem eigenen Prozess): je Prüfung „OK“ bzw. „FEHLER“ mit Dauer und
// den Fehlerzeilen, am Ende die Summe. Aufruf: `npm run pruefung` oder `node pruefung/alle.mjs [Teil des Namens …]`.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('.', import.meta.url))
const only = process.argv.slice(2)
const tests = readdirSync(dir)
  .filter((f) => f.endsWith('.mjs') && !['ablauf-lib.mjs', 'alle.mjs'].includes(f))
  .filter((f) => !only.length || only.some((x) => f.includes(x)))
  .sort()
let bad = 0
for (const f of tests) {
  const start = Date.now()
  const r = spawnSync(process.execPath, [join(dir, f)], { encoding: 'utf8', timeout: 15 * 60e3, maxBuffer: 64 * 1024 * 1024 })
  const sec = Math.round((Date.now() - start) / 1000)
  const ok = r.status === 0
  console.log(`${ok ? 'OK    ' : 'FEHLER'} ${f.replace(/\.mjs$/, '')} (${sec}s)`)
  if (!ok) {
    bad++
    const lines = `${r.stdout || ''}\n${r.stderr || ''}`.split('\n').filter((l) => /^FEHLER|^Fehler:|Error/.test(l))
    for (const l of lines.slice(0, 8)) console.log(`        ${l.slice(0, 600)}`)
    if (r.error) console.log(`        ${String(r.error.message).slice(0, 300)}`)
  }
}
console.log(bad ? `${bad} von ${tests.length} Prüfungen mit Fehlern` : `Alle ${tests.length} Prüfungen ohne Fehler`)
process.exit(bad ? 1 : 0)
