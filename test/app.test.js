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
  // Werkzeuge: eigener Speicher, den App-Updates nicht löschen (gelöscht wird nur 'dienstplan-…')
  assert.match(src, /const WERKZEUGE = 'werkzeuge-1'/)
  assert.ok(!'werkzeuge-1'.startsWith('dienstplan-'))
  assert.match(src, /'werkzeuge-vorhalten'/)
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

test('App-Installation: Webspace-Seiten (.php) fängt der Service Worker nicht ab, die Startseite der App bleibt im Speicher richtig', () => {
  const src = serviceWorkerSource({ version: 'abc123', precache: ['./index.html'] })
  const handlers = {}
  const self = { addEventListener: (type, fn) => (handlers[type] = fn), location: { origin: 'https://app.example' }, registration: { scope: 'https://app.example/' }, clients: { claim: () => {} }, skipWaiting: () => {} }
  const cache = { put: async () => {}, match: async () => null, addAll: async () => {} }
  const caches = { open: async () => cache, match: async () => null, keys: async () => [], delete: async () => true }
  vm.runInNewContext(src, { self, caches, fetch: async () => ({ ok: true, type: 'basic', clone() { return this } }), URL, Request: class {}, Promise, console })
  const answered = (path, mode = 'navigate') => {
    let called = false
    handlers.fetch({ request: { method: 'GET', url: `https://app.example${path}`, mode }, respondWith: (p) => { called = true; Promise.resolve(p).catch(() => {}) } })
    return called
  }
  for (const page of ['/mein-plan.php', '/kunden.php?l=abc', '/mattentour.php', '/wetter-alarm.php']) assert.equal(answered(page), false, page)
  assert.equal(answered('/'), true, 'die App selbst weiter über den Service Worker')
  assert.equal(answered('/index.html'), true)
})

test('App-Installation: Service Worker fragt Dateien ohne Hash beim Server nach und hält nur Ordner der App vor', async () => {
  const src = serviceWorkerSource({ version: 'abc123', precache: ['./index.html', './config.json', './app/app-ABCDEFGH.js', './vendor/msal-browser.min.js'] })
  const run = (scope) => {
    const handlers = {}
    const self = { addEventListener: (type, fn) => (handlers[type] = fn), location: { origin: 'https://example.at' }, registration: { scope }, clients: { claim: () => {} }, skipWaiting: () => {} }
    const added = []
    const fetched = []
    const cache = { put: async () => {}, match: async () => null, addAll: async (list) => added.push(...list) }
    const caches = { open: async () => cache, match: async () => null, keys: async () => [], delete: async () => true }
    class Request {
      constructor(input, init = {}) {
        if (input?.mode === 'navigate' && Object.keys(init).length) throw new TypeError('alter Browser')
        Object.assign(this, typeof input === 'string' ? { url: input } : input, init)
      }
    }
    const fetch = async (r) => (fetched.push(r), { ok: true, type: 'basic', clone() { return this } })
    vm.runInNewContext(src, { self, caches, fetch, URL, Request, Promise, console })
    const answered = (path, mode = 'no-cors') => {
      let called = false
      handlers.fetch({ request: { method: 'GET', url: `https://example.at${path}`, mode }, respondWith: (p) => { called = true; Promise.resolve(p).catch(() => {}) } })
      return called
    }
    return { handlers, added, fetched, answered }
  }
  // Vorhalten: gehashte Bündel wie bisher, alles andere mit Nachfrage beim Server (cache: no-cache)
  const a = run('https://example.at/')
  let waited
  a.handlers.install({ waitUntil: (p) => (waited = p) })
  await waited
  assert.equal(a.added[0].cache, 'no-cache')
  assert.equal(a.added[0].url, './index.html')
  assert.equal(a.added[1].cache, 'no-cache')
  assert.equal(a.added[2], './app/app-ABCDEFGH.js')
  assert.equal(a.added[3].cache, 'no-cache')
  // Seitenaufruf und config.json: beim Server nachfragen; ein alter Browser, der das bei Seitenaufrufen nicht kann,
  // fragt wie bisher an
  assert.equal(a.answered('/config.json', 'cors'), true)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(a.fetched.at(-1).cache, 'no-cache')
  assert.equal(a.answered('/', 'navigate'), true)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(a.fetched.at(-1).mode, 'navigate')
  // Nur Ordner der App aus dem Speicher: fremde Seiten derselben Adresse (z. B. WordPress-Themes) nicht
  assert.equal(a.answered('/themes/cleanos.css'), true)
  assert.equal(a.answered('/app/chunk-ABCDEFGH.js'), true)
  assert.equal(a.answered('/werkzeuge/wasserzaehler/index.html'), true)
  assert.equal(a.answered('/wp-content/themes/x/style.css'), false)
  assert.equal(a.answered('/wp-content/plugins/x/assets/a.js'), false)
  assert.equal(a.answered('/blog/werkzeuge/x.html'), false)
  // App in einem Unterordner: Regeln nur darunter
  const b = run('https://example.at/plan/')
  assert.equal(b.answered('/plan/app/chunk-ABCDEFGH.js'), true)
  assert.equal(b.answered('/app/chunk-ABCDEFGH.js'), false)
  assert.equal(b.answered('/plan/werkzeuge/objektdoku/index.html'), true)
})
