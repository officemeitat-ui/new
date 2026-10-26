import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { manifestFor, serviceWorkerSource } from '../scripts/pwa.js'

const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'))

test('App-Installation: Manifest aus der Marke, mit Symbolen für Startbildschirm', () => {
  const m = manifestFor(config)
  assert.equal(m.name, 'Cleanos App')
  assert.equal(m.short_name, 'Cleanos App')
  assert.equal(m.display, 'standalone')
  assert.equal(m.theme_color, '#0c6cb4')
  assert.deepEqual(m.icons.map((i) => i.sizes), ['192x192', '512x512', '512x512'])
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'))
  for (const icon of m.icons) assert.ok(readFileSync(new URL(`../${icon.src}`, import.meta.url)).length > 1000)
  assert.equal(manifestFor({}).short_name, 'Dienstplan')
})

test('App-Installation: Service Worker ist gültiges JavaScript und lässt die Anmeldung durch', () => {
  const src = serviceWorkerSource({ version: 'abc123', precache: ['./index.html', './app/app-X.js'] })
  assert.doesNotThrow(() => new vm.Script(src))
  assert.match(src, /const CACHE = 'dienstplan-abc123'/)
  assert.match(src, /"\.\/app\/app-X\.js"/)
  assert.match(src, /startsWith\('\/\.auth\/'\)\) return/)
  assert.match(src, /request\.mode === 'navigate'/)
})

test('Quelltext: alle Module der Oberfläche sind gültiges JavaScript', async () => {
  const { readdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { execFileSync } = await import('node:child_process')
  const root = new URL('../src', import.meta.url).pathname
  const files = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name))
      else if (e.name.endsWith('.js')) files.push(join(dir, e.name))
    }
  }
  walk(root)
  assert.ok(files.length > 50)
  for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })
})
