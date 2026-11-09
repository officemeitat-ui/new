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
    Request: class { constructor(url) { this.url = url } },
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
