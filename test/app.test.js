import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

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
  const root = fileURLToPath(new URL('../src', import.meta.url))
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

/**
 * Führt den erzeugten Service Worker in einer Attrappe aus (Speicher, Netz) und
 * spielt Seitenaufrufe durch. `scope`: Ordner, in dem die App liegt.
 */
function serviceWorkerAttrappe(scope = 'https://app.example.at/') {
  const listeners = {}
  const speicher = new Map() // Name → Map(URL → Antwort)
  const schluessel = (key) => new URL(typeof key === 'string' ? key : key.url, new URL('sw.js', scope)).href
  const cacheVon = (name) => {
    if (!speicher.has(name)) speicher.set(name, new Map())
    const eintraege = speicher.get(name)
    return {
      put: async (key, response) => void eintraege.set(schluessel(key), response),
      match: async (key) => eintraege.get(schluessel(key)),
      addAll: async (keys) => keys.forEach((k) => eintraege.set(schluessel(k), antwort(`vorgehalten ${k}`))),
    }
  }
  const antwort = (text) => ({ ok: true, type: 'basic', status: 200, text, clone() { return this } })
  const netz = { online: true, aufrufe: [], seiten: {} }
  const sandbox = {
    URL,
    Request: class { constructor(input, init = {}) { this.url = typeof input === 'string' ? input : input.url; Object.assign(this, init) } },
    self: {
      addEventListener: (type, fn) => (listeners[type] = fn),
      registration: { scope },
      location: { origin: new URL(scope).origin },
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
    },
    caches: {
      open: async (name) => cacheVon(name),
      match: async (key) => {
        for (const name of speicher.keys()) { const hit = await cacheVon(name).match(key); if (hit) return hit }
      },
      keys: async () => [...speicher.keys()],
      delete: async (name) => speicher.delete(name),
    },
    fetch: async (request) => {
      netz.aufrufe.push(request.url)
      if (!netz.online) throw new TypeError('Failed to fetch')
      return antwort(netz.seiten[new URL(request.url).pathname] ?? `Netz ${request.url}`)
    },
  }
  vm.createContext(sandbox)
  new vm.Script(serviceWorkerSource({ version: 'v1', precache: ['./index.html'] })).runInContext(sandbox)
  /** Seitenaufruf (Navigation); gibt die Antwort des Service Workers zurück, `null` = nicht abgefangen. */
  const navigieren = async (pfad, mode = 'navigate') => {
    let antwortVersprechen = null
    listeners.fetch({ request: { url: new URL(pfad, scope).href, method: 'GET', mode }, respondWith: (p) => (antwortVersprechen = p) })
    return antwortVersprechen && (await antwortVersprechen)
  }
  const gespeichert = (name, pfad) => speicher.get(name)?.get(new URL(pfad, scope).href)
  return { navigieren, gespeichert, netz }
}

test('App-Installation: Service Worker fängt PHP-Seiten am Webspace nicht ab und speichert nur die App als index.html', async () => {
  const sw = serviceWorkerAttrappe()
  sw.netz.seiten['/'] = 'App'
  sw.netz.seiten['/index.html'] = 'App'
  // App-Seite: zuerst aus dem Netz, dann als index.html im Speicher
  assert.equal((await sw.navigieren('/')).text, 'App')
  assert.equal(sw.gespeichert('dienstplan-v1', './index.html').text, 'App')
  assert.equal((await sw.navigieren('/index.html?ansicht=woche#wochenplan')).text, 'App')

  // Seiten am Webspace: kein respondWith, kein Abruf durch den Service Worker, nichts im Speicher
  for (const seite of ['/mein-plan.php?k=abc', '/kunden.php?k=XYZ', '/wetter-alarm.php', '/mattentour.php', '/ki.php', '/unterordner/', '/logout']) {
    sw.netz.aufrufe.length = 0
    assert.equal(await sw.navigieren(seite), null, seite)
    assert.deepEqual(sw.netz.aufrufe, [], seite)
    assert.equal(sw.gespeichert('dienstplan-v1', './index.html').text, 'App', seite)
  }

  // Ohne Netz startet die App weiter mit der App-Seite, nicht mit der zuletzt geöffneten PHP-Seite
  sw.netz.online = false
  assert.equal((await sw.navigieren('/')).text, 'App')
  assert.equal(await sw.navigieren('/mein-plan.php?k=abc'), null)

  // Werkzeuge im Rahmen der App (Navigation im iframe) weiter über den eigenen Speicher, nicht als index.html
  sw.netz.online = true
  sw.netz.seiten['/werkzeuge/wasserzaehler/index.html'] = 'Wasserzähler'
  assert.equal((await sw.navigieren('/werkzeuge/wasserzaehler/index.html')).text, 'Wasserzähler')
  assert.equal(sw.gespeichert('werkzeuge-1', '/werkzeuge/wasserzaehler/index.html').text, 'Wasserzähler')
  assert.equal(sw.gespeichert('dienstplan-v1', './index.html').text, 'App')
})

test('App-Installation: App in einem Unterordner – nur dieser Ordner ist die App-Seite', async () => {
  const sw = serviceWorkerAttrappe('https://www.example.at/dienstplan/')
  sw.netz.seiten['/dienstplan/'] = 'App'
  assert.equal((await sw.navigieren('/dienstplan/')).text, 'App')
  assert.equal(sw.gespeichert('dienstplan-v1', './index.html').text, 'App')
  assert.equal(await sw.navigieren('/dienstplan/mein-plan.php?k=abc'), null)
  assert.equal(await sw.navigieren('/dienstplan/kunden.php'), null)
  assert.equal(sw.gespeichert('dienstplan-v1', './index.html').text, 'App')
})
