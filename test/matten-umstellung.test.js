// Mattenwechsel P16: Umstellung vom Werkzeug auf das Modul. #matten führt danach ins Modul, das Werkzeug heißt
// „Mattenwechsel (alt)“ und schreibt nichts mehr nach SharePoint (werkzeuge/bruecke.js), zurücknehmbar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const noop = () => {}
const el = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop }, append: noop, setAttribute: noop, addEventListener: noop })
globalThis.window ??= globalThis
globalThis.addEventListener ??= noop
globalThis.localStorage ??= { getItem: () => null, setItem: noop, removeItem: noop }
globalThis.document ??= { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: el, head: el(), body: el(), documentElement: el() }
globalThis.history ??= { replaceState: noop }

const ctx = await import('../src/ui/context.js')
const tools = await import('../src/ui/views/tools.js')
const { readiness } = await import('../src/ui/views/matten-umstellung.js')

const ids = ['matten', 'mw-liegeplaetze', 'week']
function setup(cutover) {
  ctx.app.config = {}
  ctx.app.access = null
  ctx.app.data = { matten: { schema: 1, settings: cutover ? { cutover: { at: '2026-11-20T08:00:00.000Z', by: 'Petra Leitner' } } : {}, placements: [], areas: [] } }
  // die Ansichten des Moduls sind sichtbar (Platzhalter aus views/lazy.js reichen hier nicht: eigene Liste)
  ctx.registerView({ id: 'mw-liegeplaetze', label: 'Matten-Liegeplätze', module: 'matten', render: () => '' })
}

test('Umstellung: Adresse #matten führt danach ins Modul, #matten-alt und das Menü ins Werkzeug (nur lesend)', () => {
  assert.equal(ctx.hashKey('#Matten-Alt'), 'matten-alt')
  assert.equal(ctx.hashKey('#%E0'), '')
  assert.equal(ctx.viewFromHash('#matten-alt', ids), 'matten')
  assert.equal(ctx.viewFromHash('#mattenwechsel', ids), 'matten')

  // vor der Umstellung: Werkzeug wie bisher
  setup(false)
  ctx.app.ui.view = 'matten'
  ctx.app.ui.linked = 'matten'
  assert.equal(ctx.applyRedirect(), false)
  assert.equal(ctx.app.ui.view, 'matten')
  assert.equal(ctx.hashOfView('matten'), 'matten')
  const view = ctx.VIEWS.find((v) => v.id === 'matten')
  assert.equal(view.label, 'Mattenwechsel (Werkzeug)')
  assert.equal(window.werkzeugBruecke.nurLesen('/werkzeuge/mattenwechsel/index.html'), false)

  // nach der Umstellung
  setup(true)
  assert.equal(tools.mattenAlt(), true)
  assert.equal(view.label, 'Mattenwechsel (alt)')
  assert.match(view.text, /nur lesend/)
  ctx.app.ui.view = 'matten'
  ctx.app.ui.linked = 'matten'
  assert.equal(ctx.applyRedirect(), true)
  assert.equal(ctx.app.ui.view, 'mw-liegeplaetze')
  assert.equal(ctx.app.ui.linked, null)
  // Lesezeichen des alten Werkzeugs und Wechsel über das Menü: bleibt im Werkzeug, Adresse #matten-alt
  ctx.app.ui.view = 'matten'
  ctx.app.ui.linked = 'matten-alt'
  assert.equal(ctx.applyRedirect(), false)
  assert.equal(ctx.app.ui.view, 'matten')
  ctx.app.ui.linked = null
  assert.equal(ctx.applyRedirect(), false)
  assert.equal(ctx.hashOfView('matten'), 'matten-alt')
  // andere Ansichten aus der Adresse: unverändert
  ctx.app.ui.view = 'week'
  ctx.app.ui.linked = 'week'
  assert.equal(ctx.applyRedirect(), false)
  assert.equal(ctx.app.ui.view, 'week')
  // die Brücke sperrt nur den Mattenwechsel
  assert.equal(window.werkzeugBruecke.nurLesen('/werkzeuge/mattenwechsel/index.html'), true)
  assert.equal(window.werkzeugBruecke.nurLesen('/werkzeuge/wasserzaehler/index.html'), false)
  // Hinweis über dem Werkzeug mit Weg ins Modul, ohne „Eigenes Fenster“
  const html = view.render()
  assert.match(html, /Mattenwechsel \(alt\): nur zum Nachschlagen/)
  assert.match(html, /data-view="mw-liegeplaetze"/)
  assert.doesNotMatch(view.actions(), /Eigenes Fenster/)
})

test('Umstellung: Stand vor dem Umstellen (Liegeplätze, Übernahme, Fahrer, Betriebshof, Büro-E-Mail)', () => {
  const leer = readiness({ settings: {}, placements: [] })
  assert.deepEqual(leer.map((r) => r.ok), [false, false, false, false, false])
  const voll = readiness({
    settings: { drivers: [{ id: 'd1', name: 'Fahrer' }], depot: { name: 'Betriebshof', lat: 47.8, lon: 13 }, officeEmail: 'buero@firma.example' },
    placements: [{ id: 'p1', active: true, legacyId: 'L-0001' }, { id: 'p2', active: true }, { id: 'p3', active: false }],
  })
  assert.deepEqual(voll.map((r) => r.ok), [true, true, true, true, true])
  assert.match(voll[0].text, /^2 Liegeplätze/)
  assert.match(voll[1].text, /1 Liegeplätze übernommen/)
})

/** Brücke in einer Attrappe ausführen: Rahmen der App (app) oder eigenes Fenster (ohne app, gemerkte Umstellung). */
function bridge({ path, app = null, stored = null }) {
  const calls = []
  const body = { firstChild: null, insertBefore(node) { this.inserted = node } }
  const win = {
    location: { pathname: path },
    localStorage: { getItem: (k) => (k === 'cleanos-app.matten-alt' ? stored : null), setItem: noop, removeItem: noop, clear: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop, clear: noop },
    fetch: (input, init) => {
      calls.push([typeof input === 'string' ? input : input.url, (init && init.method) || 'GET'])
      return Promise.resolve({ ok: true, status: 200 })
    },
  }
  win.window = win
  win.parent = app ? { werkzeugBruecke: app } : win
  win.Storage = function () {}
  win.Storage.prototype = { getItem: noop, setItem: noop, removeItem: noop, clear: noop, key: noop }
  const sandbox = {
    window: win,
    location: win.location,
    localStorage: win.localStorage,
    sessionStorage: win.sessionStorage,
    Storage: win.Storage,
    document: { readyState: 'complete', documentElement: { classList: { add: noop } }, body, getElementById: () => null, createElement: () => ({ style: {}, setAttribute: noop }), addEventListener: noop },
    Response: globalThis.Response,
    URLSearchParams,
    Promise,
    JSON,
    String,
    TypeError,
  }
  vm.runInNewContext(readFileSync(new URL('../werkzeuge/bruecke.js', import.meta.url), 'utf8'), sandbox)
  return { fetch: (...a) => win.fetch(...a), calls, body }
}

test('Umstellung: die Brücke sperrt im alten Mattenwechsel das Schreiben nach SharePoint (Rahmen und eigenes Fenster)', async () => {
  const G = 'https://graph.microsoft.com/v1.0/drives/d1/root:/Mattenwechsel/Touren/t1.json:/content'
  // im Rahmen, umgestellt
  let alt = true
  const app = { bruecke: 1, angemeldet: true, nurLesen: (p) => alt && /\/werkzeuge\/mattenwechsel\//.test(p) }
  const r = bridge({ path: '/werkzeuge/mattenwechsel/index.html', app })
  const put = await r.fetch(G, { method: 'PUT', body: '{}' })
  assert.equal(put.status, 403)
  assert.equal((await put.json()).error.code, 'nurLesen')
  assert.equal((await r.fetch('https://graph.microsoft.com/v1.0/me/sendMail', { method: 'POST', body: '{}' })).status, 403)
  assert.equal((await r.fetch(G, { method: 'DELETE' })).status, 403)
  // Lesen geht weiter
  await r.fetch(G)
  await r.fetch(G, { method: 'GET' })
  assert.deepEqual(r.calls.map((c) => c[1]), ['GET', 'GET'])
  // im Rahmen zeigt die App den Hinweis, nicht das Werkzeug
  assert.equal(r.body.inserted, undefined)
  // zurückgenommen: Schreiben geht wieder
  alt = false
  await r.fetch(G, { method: 'PUT', body: '{}' })
  assert.deepEqual(r.calls.at(-1), [G, 'PUT'])

  // andere Werkzeuge im Rahmen: nie gesperrt
  const w = bridge({ path: '/werkzeuge/wasserzaehler/index.html', app: { bruecke: 1, nurLesen: () => true } })
  await w.fetch(G, { method: 'PUT', body: '{}' })
  assert.deepEqual(w.calls, [[G, 'PUT']])

  // eigenes Fenster nach der Umstellung (auf diesem Gerät gemerkt): gesperrt, Hinweis oben im Werkzeug
  const s = bridge({ path: '/werkzeuge/mattenwechsel/index.html', stored: '2026-11-20T08:00:00.000Z' })
  assert.equal((await s.fetch(G, { method: 'PUT', body: '{}' })).status, 403)
  await s.fetch(G)
  assert.deepEqual(s.calls, [[G, 'GET']])
  assert.match(s.body.inserted.textContent, /Mattenwechsel \(alt\): nur zum Nachschlagen/)
  // eigenes Fenster ohne Umstellung: unverändert
  const f = bridge({ path: '/werkzeuge/mattenwechsel/index.html' })
  await f.fetch(G, { method: 'PUT', body: '{}' })
  assert.deepEqual(f.calls, [[G, 'PUT']])
  assert.equal(f.body.inserted, undefined)
})
