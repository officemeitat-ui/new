import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { fuerApp, inAppFarben, mitBruecke, WERKZEUGE, werkzeugeBauen } from '../scripts/werkzeuge.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = '<script src="../bruecke.js"></script>'

// Kleines Werkzeug mit allem, was die Brücke braucht (erfunden, nicht aus werkzeuge/)
const LOGIN = 'const KEY="cleanos.probe.graph.tok"; fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token",{body:"grant_type=refresh_token&refresh_token="+r})'
const tool = ({ head = '<meta charset="utf-8">', script = LOGIN, before = '<!DOCTYPE html>\n<html lang="de">', headTag = '<head>' } = {}) => `${before}${headTag}${head}<title>Probe</title><script>${script}</script></head><body><template><head></head></template></body></html>`

// ---------------------------------------------------------------- Bau: Brücke einsetzen (scripts/werkzeuge.js)

test('Werkzeug-Bau: Brücke direkt nach <meta charset>, sonst direkt nach <head>', () => {
  const withCharset = mitBruecke(tool(), 'probe')
  assert.ok(withCharset.includes(`<head><meta charset="utf-8">\n${SCRIPT}<title>`))
  const without = mitBruecke(tool({ head: '' }), 'probe')
  assert.ok(without.includes(`<head>\n${SCRIPT}<title>`))
  assert.equal(without.split(SCRIPT).length, 2, 'genau einmal, nicht in der späteren <head>-Vorlage')
})

test('Werkzeug-Bau: Kleinbuchstaben, Leerzeichen vorn und Attribute am <head> sind in Ordnung', () => {
  const out = mitBruecke(tool({ before: '  \n<!doctype html><html>', headTag: '<head data-x="1">' }), 'probe')
  assert.ok(out.includes(`<head data-x="1"><meta charset="utf-8">\n${SCRIPT}`))
})

test('Werkzeug-Bau: alle fehlenden Teile in einer Meldung', () => {
  assert.throws(
    () => mitBruecke('<html><body>kein Kopf</body></html>', 'kaputt'),
    (err) => ['Werkzeug „kaputt“', 'beginnt nicht mit', 'oauth2/v2.0/token', 'refresh_token', 'cleanos.<werkzeug>.graph.tok', 'LIESMICH.md'].every((part) => err.message.includes(part)),
  )
  assert.throws(() => mitBruecke(tool({ script: LOGIN.replace('cleanos.probe.graph.tok', 'andere.tok') }), 'probe'), /Speicherschlüssel/)
})

test('Werkzeug-Bau: eigene CSP muss Skripte von „self“ erlauben', () => {
  const csp = (policy) => tool({ head: `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">` })
  assert.throws(() => mitBruecke(csp("default-src 'self'; script-src 'unsafe-inline'"), 'probe'), /CSP erlaubt kein Skript von 'self'/)
  assert.ok(mitBruecke(csp("script-src 'self' 'unsafe-inline'; img-src *"), 'probe').includes(SCRIPT))
})

test('Werkzeug-Farben: Groß/klein egal, längere Farbwerte (mit Alpha) und fremde Farben bleiben', () => {
  assert.equal(inAppFarben('color:#0F70B7; border:#0f70b7cc; x:#a1c855; y:#123456'), 'color:#0c6cb4; border:#0f70b7cc; x:#9cc654; y:#123456')
  assert.equal(inAppFarben('#2b2b2b #595959'), '#13232f #4b5b67')
  assert.equal(fuerApp(tool({ head: '<meta charset="utf-8"><style>a{color:#0b5a94}</style>' }), 'probe').includes('#0a5a96'), true)
})

test('Werkzeug-Bau: alle vier Werkzeuge nach dist/, Brücke unverändert kopiert, Quellen bleiben gleich', async () => {
  const dist = await mkdtemp(join(tmpdir(), 'cleanos-werkzeuge-'))
  try {
    const before = WERKZEUGE.map(({ name }) => readFileSync(join(ROOT, 'werkzeuge', name, 'index.html'), 'utf8'))
    const paths = await werkzeugeBauen(ROOT, dist)
    assert.deepEqual(paths, WERKZEUGE.map(({ name }) => `werkzeuge/${name}/index.html`))
    assert.equal(await readFile(join(dist, 'werkzeuge', 'bruecke.js'), 'utf8'), readFileSync(join(ROOT, 'werkzeuge', 'bruecke.js'), 'utf8'))
    for (const [i, { name }] of WERKZEUGE.entries()) {
      const built = await readFile(join(dist, 'werkzeuge', name, 'index.html'), 'utf8')
      assert.equal(built, fuerApp(before[i], name), name)
      assert.equal(readFileSync(join(ROOT, 'werkzeuge', name, 'index.html'), 'utf8'), before[i], `${name}: Quelle unverändert`)
    }
  } finally {
    await rm(dist, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------- Anmeldebrücke im Werkzeug (werkzeuge/bruecke.js)

const BRIDGE = readFileSync(join(ROOT, 'werkzeuge', 'bruecke.js'), 'utf8')
const TOKEN_URL = 'https://login.microsoftonline.com/tenant-beispiel/oauth2/v2.0/token'

/** Fenster des Werkzeugs nachgebaut; parent: Fenster der App (oder Funktion, die wirft = fremder Ursprung). */
function runBridge(parent) {
  class Storage {
    constructor() {
      this.map = new Map()
    }
    getItem(k) {
      return this.map.has(k) ? this.map.get(k) : null
    }
    setItem(k, v) {
      this.map.set(k, String(v))
    }
    removeItem(k) {
      this.map.delete(k)
    }
    key(i) {
      return [...this.map.keys()][i] ?? null
    }
    get length() {
      return this.map.size
    }
    clear() {
      this.map.clear()
    }
  }
  const calls = []
  const classes = []
  const w = { Storage, Response, URLSearchParams, document: { documentElement: { classList: { add: (c) => classes.push(c) } } } }
  w.localStorage = new Storage()
  w.sessionStorage = new Storage()
  w.fetch = async (input, init) => {
    calls.push({ input, init })
    return 'vom Netz'
  }
  w.window = w
  if (typeof parent === 'function') Object.defineProperty(w, 'parent', { get: parent })
  else w.parent = parent || w
  vm.createContext(w)
  vm.runInContext(BRIDGE, w)
  return { w, calls, classes }
}
const appWindow = (over = {}) => {
  const asked = []
  return { asked, werkzeugBruecke: { bruecke: 1, angemeldet: true, token: async (scope) => (asked.push(scope), { accessToken: 'AT-123', expiresIn: 3599, scope: 'Sites.ReadWrite.All' }), anmelden() {}, ...over } }
}

test('Brücke: allein geöffnet tut sie nichts', async () => {
  const { w, calls, classes } = runBridge()
  assert.equal(w.CLEANOS_APP, null)
  w.localStorage.setItem('cleanos.wasserzaehler.graph.tok', '{"refresh":"eigen"}')
  assert.equal(w.localStorage.getItem('cleanos.wasserzaehler.graph.tok'), '{"refresh":"eigen"}')
  assert.equal(await w.fetch(TOKEN_URL, { body: 'refresh_token=cleanos-app' }), 'vom Netz')
  assert.equal(calls.length, 1)
  assert.deepEqual(classes, [])
})

test('Brücke: fremder Rahmen (kein Zugriff) oder andere Fassung der App – Werkzeug läuft für sich', () => {
  assert.equal(runBridge(() => { throw new Error('SecurityError') }).w.CLEANOS_APP, null)
  assert.equal(runBridge({ werkzeugBruecke: { bruecke: 2 } }).w.CLEANOS_APP, null)
  assert.equal(runBridge({}).w.CLEANOS_APP, null)
})

test('Brücke in der App: Werkzeug gilt als angemeldet, eigene Anmeldung wird weder gespeichert noch gelöscht', () => {
  const { w, classes } = runBridge(appWindow())
  assert.deepEqual(classes, ['in-cleanos-app'])
  assert.equal(w.localStorage.getItem('cleanos.objektkontrolle.graph.tok'), '{"refresh":"cleanos-app"}')
  w.localStorage.setItem('cleanos.objektkontrolle.graph.tok', '{"refresh":"echt"}')
  w.localStorage.removeItem('cleanos.objektkontrolle.graph.tok')
  assert.equal(w.localStorage.map.size, 0, 'nichts gespeichert')
  // andere Schlüssel und der sessionStorage bleiben normal
  w.localStorage.setItem('cleanos.objektkontrolle.liste', '[1]')
  assert.equal(w.localStorage.getItem('cleanos.objektkontrolle.liste'), '[1]')
  w.sessionStorage.setItem('cleanos.objektkontrolle.graph.tok', 'x')
  assert.equal(w.sessionStorage.getItem('cleanos.objektkontrolle.graph.tok'), 'x')
  assert.equal(w.localStorage.getItem('cleanos.Objekt-Doku.graph.tok'), null, 'nur Kleinbuchstaben und Ziffern im Namen')
})

test('Brücke in der App: Token-Abruf mit der Marke beantwortet die App (auch als Request-Objekt)', async () => {
  const app = appWindow()
  const { w, calls } = runBridge(app)
  const res = await w.fetch(TOKEN_URL, { method: 'POST', body: 'grant_type=refresh_token&refresh_token=cleanos-app&scope=Sites.ReadWrite.All%20offline_access' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { token_type: 'Bearer', scope: 'Sites.ReadWrite.All', expires_in: 3599, ext_expires_in: 3599, access_token: 'AT-123', refresh_token: 'cleanos-app' })
  assert.deepEqual(app.asked, ['Sites.ReadWrite.All offline_access'])
  const viaRequest = await w.fetch({ url: `${TOKEN_URL}?x=1` }, { body: 'refresh_token=cleanos-app' })
  assert.equal(viaRequest.status, 200)
  assert.deepEqual(app.asked.at(-1), '', 'ohne scope: leer')
  assert.equal(calls.length, 0, 'nichts ging ins Netz')
})

test('Brücke in der App: eigene Anmeldung des Werkzeugs, andere Adressen und Abrufe ohne Inhalt gehen ins Netz', async () => {
  const { w, calls } = runBridge(appWindow())
  assert.equal(await w.fetch(TOKEN_URL, { body: 'refresh_token=echtes-token' }), 'vom Netz')
  assert.equal(await w.fetch('https://graph.microsoft.com/v1.0/sites/root', { headers: {} }), 'vom Netz')
  assert.equal(await w.fetch(TOKEN_URL), 'vom Netz')
  assert.equal(await w.fetch('https://login.microsoftonline.com/x/oauth2/v2.0/tokenX', { body: 'refresh_token=cleanos-app' }), 'vom Netz')
  assert.equal(calls.length, 4)
})

test('Brücke in der App: App kann gerade kein Token liefern – Fehler wie „kein Netz“ mit Grund', async () => {
  const { w } = runBridge(appWindow({ token: async () => Promise.reject(new Error('neu anmelden')) }))
  await assert.rejects(w.fetch(TOKEN_URL, { body: 'refresh_token=cleanos-app' }), { name: 'TypeError', message: 'Anmeldung über die Cleanos App gerade nicht möglich: neu anmelden' })
})

test('Brücke im Browser-Modus der App (ohne Microsoft): kennt die App, lässt die Anmeldung aber dem Werkzeug', () => {
  const { w, classes } = runBridge(appWindow({ angemeldet: false }))
  assert.equal(w.CLEANOS_APP.bruecke, 1)
  assert.deepEqual(classes, ['in-cleanos-app'])
  assert.equal(w.localStorage.getItem('cleanos.mattenwechsel.graph.tok'), null, 'Speicher nicht umgebogen')
})

// ---------------------------------------------------------------- clear() im Rahmen: nur die Schlüssel des Werkzeugs

/** Speicher, wie er auf app.cleanos.at liegt: App (MSAL, Einstellungen), ein anderes Werkzeug, dazu das Werkzeug selbst. */
const APP_KEYS = {
  'msal.account.keys': '["abc.tenant-login.windows.net-tenant"]',
  'abc.tenant-login.windows.net-tenant': '{"homeAccountId":"abc.tenant"}',
  'abc.tenant-login.windows.net-accesstoken-client-tenant-sites.readwrite.all--': '{"secret":"AT"}',
  'einsatzplaner.prefs.v2': '{"view":"matten"}',
  'einsatzplaner:doc:Stammdaten/Kunden.json': '{"etag":"1","data":[]}',
  'cleanos-cleo-gesehen': '1',
  'cleanos.wasser.graph.cfg': '{"tenant":"t"}', // anderes Werkzeug, in diesem Fenster nie angefasst
  'cleanos.wasserablesung.v1': '{"listen":[]}',
}
const fuellen = (store, keys) => Object.entries(keys).forEach(([k, v]) => store.map.set(k, v))
const sperren = (w) => {
  // wie „Gerät sperren (Konto vergessen)“ im Mattenwechsel 2.4: Konto-Marke und Token weg, dann alles
  w.localStorage.removeItem('cleanos.matten.konto')
  w.localStorage.removeItem('cleanos.matten.graph.tok')
  w.localStorage.clear()
  w.sessionStorage.clear()
}

test('Brücke in der App: „Gerät sperren“ (clear) löscht nur die Schlüssel des Werkzeugs, Anmeldung und Einstellungen der App bleiben', () => {
  const { w } = runBridge(appWindow())
  fuellen(w.localStorage, APP_KEYS)
  w.localStorage.map.set('cleanos.matten.graph.tok', '{"refresh":"aus-eigenem-fenster"}') // Anmeldung aus „Eigenes Fenster“
  w.sessionStorage.map.set('cleanos-reauth', '1700000000000') // App: Neuanmeldung läuft
  // das Werkzeug arbeitet wie beim Start: Modus lesen, Einstellungen lesen, Marke schreiben, Touren-Fallback ohne IndexedDB
  w.localStorage.getItem('cleanos.matten.modus')
  w.localStorage.getItem('cleanos.matten.graph.cfg')
  w.localStorage.setItem('cleanos.matten.konto', '{"name":"n"}')
  w.localStorage.setItem('cleanos.matten', '{"touren":[1]}')
  w.sessionStorage.setItem('cleanos.matten.pkce', '{"verifier":"v"}')
  sperren(w)
  assert.deepEqual([...w.localStorage.map.keys()], [...Object.keys(APP_KEYS), 'cleanos.matten.graph.tok'], 'App, anderes Werkzeug und Anmeldung bleiben')
  assert.deepEqual([...w.sessionStorage.map.keys()], ['cleanos-reauth'])
  // danach gilt das Werkzeug weiter als angemeldet (über die App), wie vor dem Sperren
  assert.equal(w.localStorage.getItem('cleanos.matten.graph.tok'), '{"refresh":"cleanos-app"}')
})

test('Brücke in der App: clear() löscht nur, was das Werkzeug in diesem Fenster angefasst hat; nur Namen aus Kleinbuchstaben und Ziffern', () => {
  const { w } = runBridge(appWindow())
  fuellen(w.localStorage, APP_KEYS)
  w.localStorage.map.set('cleanos.matten.modus', 'buero')
  w.localStorage.map.set('cleanos.Matten.x', '1')
  w.localStorage.map.set('cleanos.mattenwechsel', '1')
  w.localStorage.clear()
  assert.equal(w.localStorage.map.size, Object.keys(APP_KEYS).length + 3, 'nichts gemerkt: nichts gelöscht')
  w.localStorage.removeItem('cleanos.matten.gibt-es-nicht') // schon das Löschen eines Schlüssels merkt den Namen
  w.localStorage.clear()
  assert.deepEqual([...w.localStorage.map.keys()].filter((k) => /^cleanos\./.test(k)), ['cleanos.wasser.graph.cfg', 'cleanos.wasserablesung.v1', 'cleanos.Matten.x', 'cleanos.mattenwechsel'])
})

test('Brücke im Browser-Modus der App: clear() bleibt beim Werkzeug, die eigene Anmeldung gehört dann dem Werkzeug und geht mit', () => {
  const { w } = runBridge(appWindow({ angemeldet: false }))
  fuellen(w.localStorage, APP_KEYS)
  w.localStorage.setItem('cleanos.matten.graph.tok', '{"refresh":"eigen"}')
  w.localStorage.setItem('cleanos.matten.konto', '{"name":"n"}')
  sperren(w)
  assert.deepEqual([...w.localStorage.map.keys()], Object.keys(APP_KEYS))
})

test('Brücke: allein geöffnet löscht clear() wie bisher alles', () => {
  const { w } = runBridge()
  fuellen(w.localStorage, APP_KEYS)
  w.localStorage.setItem('cleanos.matten.konto', '{"name":"n"}')
  w.sessionStorage.setItem('cleanos.matten.pkce', '{"verifier":"v"}')
  sperren(w)
  assert.equal(w.localStorage.map.size, 0)
  assert.equal(w.sessionStorage.map.size, 0)
})
