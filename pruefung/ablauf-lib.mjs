// Bibliothek für die Browser-Prüfungen (Playwright, Chromium): startet den Entwicklungs-Server, öffnet die App im
// Browser-Modus (Beispieldaten) oder im SharePoint-Betrieb mit einer Attrappe für die Microsoft-Anmeldung und für
// Microsoft Graph (Laufwerk im Speicher, gesendete E-Mails werden gesammelt). Alle Daten in den Prüfungen sind
// erfunden. Aufruf einer Prüfung: `node pruefung/<name>.mjs` (Ergebnis je Zeile „OK …“ bzw. „FEHLER …“, Rückgabe 1
// bei Fehlern); alle nacheinander: `node pruefung/alle.mjs`. Bildschirmfotos und PDFs landen in .pruefung/ (nicht im
// Repository).
//
// Diese Datei und die Prüfungen liegen im Repository, seit ein Neustart der Arbeitsumgebung am 24.11.2026 den
// früheren, nur lokal gehaltenen Ordner .pruefung/ mit rund 165 Prüfungen gelöscht hat.

import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { addDays, mondayOf, todayISO } from '../src/core/dates.js'
import { createDevServer } from '../scripts/serve.js'

const require = createRequire(import.meta.url)
export const { chromium } = require('playwright')

export { addDays, mondayOf }
export const todayVienna = () => todayISO()
export const R = join(fileURLToPath(new URL('.', import.meta.url)), '..')
/** Ausgabeordner für Bildschirmfotos und PDFs (in .gitignore). */
export const P = join(R, '.pruefung')
mkdirSync(P, { recursive: true })

export const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- Ergebnis

const failed = []
export function check(name, ok, detail = '') {
  const more = detail === '' || detail === undefined || detail === null ? '' : ` – ${String(detail)}`
  console.log(`${ok ? 'OK    ' : 'FEHLER'} ${name}${more}`)
  if (!ok) failed.push(name)
  return !!ok
}
export const note = (text) => console.log(`       ${text}`)

/** Abschluss: Fehler der Konsole prüfen, Browser und Server schließen, Rückgabe 1 bei Fehlern. */
export async function finish(browser, servers = [], errors = []) {
  check('keine Fehler in der Konsole', !errors.length, errors.slice(0, 5).join(' | '))
  await browser?.close().catch(() => {})
  for (const s of servers) s?.close?.()
  console.log(failed.length ? `Fehler: ${failed.join('; ')}` : 'Fehler: keine')
  process.exit(failed.length ? 1 : 0)
}

// ---------------------------------------------------------------- Server und Seite

/** Entwicklungs-Server (liefert den Quellcode direkt aus) auf dem Port. */
export function startServer(port) {
  return createDevServer().listen(port)
}

const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }

/** Fehler der Seite sammeln: Ausnahmen und console.error (ohne Netzfehler gesperrter fremder Adressen). */
function watch(page, errors) {
  page.on('pageerror', (e) => errors.push(`Ausnahme: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/Failed to load resource|net::ERR_|ERR_FAILED|favicon/.test(t)) return
    errors.push(t)
  })
}

/** Fremde Adressen (Schriften, Wetter, Karten …) nicht ins Netz lassen: die Prüfung bleibt für sich. */
async function quiet(ctx) {
  await ctx.route(
    (url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname) && !/graph\.microsoft\.com$|download\.test$/.test(url.hostname) && url.protocol.startsWith('http'),
    (r) => (r.request().resourceType() === 'stylesheet' ? r.fulfill({ status: 200, contentType: 'text/css', body: '' }) : r.abort()),
  )
}

function helpers(page) {
  const waitFor = async (fn, timeout = 10000, step = 150) => {
    const end = Date.now() + timeout
    for (;;) {
      try {
        const v = await fn()
        if (v) return v
      } catch {
        /* noch nicht so weit */
      }
      if (Date.now() > end) return false
      await wait(step)
    }
  }
  /** Sichtbarer Text des ersten Treffers, Leerraum zusammengezogen ('' ohne Treffer). */
  const text = (sel = 'main') =>
    page
      .evaluate((s) => {
        const el = document.querySelector(s)
        return el ? el.innerText || el.textContent || '' : ''
      }, sel)
      .then((t) => String(t).replace(/\s+/g, ' ').trim())
      .catch(() => '')
  /** Aktion der App auslösen wie ein Klick auf einen Knopf mit data-action (Rechte-Prüfung der App inklusive). */
  const act = (action, data = {}) =>
    page.evaluate(
      ([a, d]) => {
        const b = document.createElement('button')
        b.dataset.action = a
        for (const [k, v] of Object.entries(d)) b.dataset[k] = String(v)
        b.hidden = true
        document.body.appendChild(b)
        b.click()
        b.remove()
      },
      [action, data],
    )
  const toastWait = (re, timeout = 10000) => waitFor(async () => re.test(await text('#toast')), timeout)
  const state = (fn, arg) => page.evaluate(fn, arg)
  const closeModals = async () => {
    await page.evaluate(async () => {
      const c = await import('/src/ui/context.js')
      for (let i = 0; i < 5 && c.app.ui.modal; i++) c.closeModal()
    })
    await wait(150)
  }
  const clickIn = (sel) => page.click(sel)
  const view = async (id) => {
    await page.evaluate(async (v) => {
      const c = await import('/src/ui/context.js')
      c.app.ui.modal = null
      c.app.ui.view = v
      await c.render()
    }, id)
    await wait(250)
  }
  return { page, act, text, toastWait, state, closeModals, clickIn, view, waitFor }
}

/**
 * Warten, bis die App gezeichnet hat (und im Browser-Modus die Vorgeschichte der Beispieldaten steht). „Zu erledigen“
 * öffnet sich nach dem Start von selbst, sobald es Neues gibt, und finge dann die Klicks der Prüfung ab: ohne
 * todo: true schließt ein Wächter in der Seite dieses eine Fenster (nur das von selbst geöffnete), sobald es kommt.
 */
async function ready(page, { demo = false, todo = false } = {}) {
  await page.waitForSelector('main', { timeout: 60000 })
  await page.waitForFunction(async () => !!(await import('/src/ui/context.js')).app.data, null, { timeout: 60000 })
  if (!todo) {
    await page.evaluate(async () => {
      const c = await import('/src/ui/context.js')
      const until = Date.now() + 30000
      const timer = setInterval(() => {
        if (c.app.ui.modal?.type === 'todo' && c.app.ui.modal.auto) {
          c.closeModal()
          clearInterval(timer)
        } else if (Date.now() > until) clearInterval(timer)
      }, 80)
    })
  }
  if (!demo) return
  // Beispieldaten: die Wochen davor werden nach dem ersten Zeichnen eingeteilt – warten, bis sich nichts mehr tut
  let last = -1
  for (let i = 0; i < 80; i++) {
    const n = await page.evaluate(async () => Object.keys((await import('/src/ui/context.js')).app.data.assignments || {}).length)
    if (n > 0 && n === last) return
    last = n
    await wait(400)
  }
}

/**
 * App im Browser-Modus öffnen (config.json des Repositorys: Speicher im Browser, Beispieldaten). clock: feste Uhrzeit
 * (ISO), init: Skripte vor dem Start, mobile: Handy 390 × 844. Liefert { ctx, page, act, text, toastWait, state,
 * closeModals, clickIn, view, waitFor }.
 */
export async function openApp(browser, port, { clock = process.env.PRUEF_UHR || null, viewport = { width: 1400, height: 950 }, mobile = false, hash = '', errors = [], init = [], todo = false } = {}) {
  const ctx = await browser.newContext({ ...(mobile ? MOBILE : { viewport }), serviceWorkers: 'block' })
  if (clock) await ctx.clock.install({ time: new Date(clock) })
  await quiet(ctx)
  for (const s of init) await ctx.addInitScript(s)
  const page = await ctx.newPage()
  watch(page, errors)
  await page.goto(`http://localhost:${port}/${hash}`)
  await ready(page, { demo: true, todo })
  return { ctx, ...helpers(page) }
}

// ---------------------------------------------------------------- SharePoint-Betrieb mit Attrappe

const TENANT = 'a31131f2-4ccf-4eb2-ab3d-49c923c6bede'
const SITE = 'https://cleanos.sharepoint.com/sites/Cleanos'
const LIBRARY = 'Cleanos_Daten'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }

const msalStub = ({ name, email }) => `globalThis.msal = {
  InteractionRequiredAuthError: class extends Error {},
  PublicClientApplication: class {
    async initialize(){}
    async handleRedirectPromise(){ return null }
    getActiveAccount(){ return { name: ${JSON.stringify(name)}, username: ${JSON.stringify(email)}, homeAccountId: ${JSON.stringify(`oid-${email.replace(/[^a-z0-9]/gi, '-')}.${TENANT}`)}, tenantId: '${TENANT}', idTokenClaims: { tid: '${TENANT}', groups: [] } } }
    getAllAccounts(){ return [this.getActiveAccount()] }
    setActiveAccount(){}
    async acquireTokenSilent(req){ return { accessToken: 'TOKEN', expiresOn: new Date(Date.now() + 3600e3), scopes: req.scopes } }
    async acquireTokenRedirect(){}
    async loginRedirect(){}
    async logoutRedirect(){}
    async ssoSilent(){ throw new Error('keine stille Anmeldung in der Prüfung') }
  },
}`

/**
 * SharePoint-Attrappe: ein Laufwerk im Speicher (drive.items: Pfad ab der Bibliothek → Datei, drive.log: Anfragen),
 * gesendete E-Mails (sent), die config.json für den Betrieb (config), open(...) öffnet die App als angemeldete Person,
 * seed(docs) legt JSON-Dateien im App-Ordner an (Pfad ab „Plattform/“), json(pfad) liest eine.
 * access: wie config.json → access ({ planners: [E-Mails], members: { rolle: [E-Mails] }, groups, roles }).
 */
export function sharepoint({ access = { planners: ['office@cleanos.at'] }, folder = 'Plattform', features = {} } = {}) {
  const items = new Map()
  const folders = new Set()
  const log = []
  const sent = []
  const unknown = []
  let seq = 0
  const base = JSON.parse(readFileSync(join(R, 'config.json'), 'utf8'))
  const config = {
    ...base,
    storage: 'sharepoint',
    demo: false,
    migrateLegacy: false,
    sharepoint: { ...base.sharepoint, tenantId: TENANT, clientId: '11111111-2222-4333-8444-555555555555', siteUrl: SITE, library: LIBRARY, folder, allowGuests: false },
    access,
    features: { ...base.features, mail: true, ...features },
  }

  const put = (path, content, type = 'application/json', by = 'Attrappe') => {
    seq++
    const had = items.get(path)
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content ?? '')
    const it = { id: had?.id || `it${seq}`, path, name: path.split('/').pop(), content: buf, type, eTag: `"{${had?.id || `it${seq}`}},${seq}"`, modified: new Date().toISOString(), by, version: seq }
    items.set(path, it)
    return it
  }
  const webUrl = (path) => `${SITE}/${LIBRARY}/${path.split('/').map(encodeURIComponent).join('/')}`
  const fileMeta = (it) => ({
    id: it.id,
    name: it.name,
    size: it.content.length,
    eTag: it.eTag,
    file: { mimeType: it.type },
    webUrl: webUrl(it.path),
    lastModifiedDateTime: it.modified,
    lastModifiedBy: { user: { displayName: it.by } },
    parentReference: { driveId: 'drive1' },
    '@microsoft.graph.downloadUrl': `https://download.test/${encodeURIComponent(it.path)}?v=${it.version}`,
  })
  const isFolder = (path) => folders.has(path) || [...items.keys()].some((k) => k.startsWith(`${path}/`)) || [...folders].some((k) => k.startsWith(`${path}/`))
  const folderMeta = (path) => ({ id: `fo:${path}`, name: path.split('/').pop(), folder: { childCount: 0 }, webUrl: webUrl(path), eTag: `"fo:${path}"`, parentReference: { driveId: 'drive1' } })
  const children = (path) => {
    const pre = path ? `${path}/` : ''
    const out = new Map()
    for (const [k, it] of items) {
      if (!k.startsWith(pre)) continue
      const rest = k.slice(pre.length)
      if (!rest.includes('/')) out.set(rest, fileMeta(it))
      else out.set(rest.split('/')[0], out.get(rest.split('/')[0]) || folderMeta(pre + rest.split('/')[0]))
    }
    for (const f of folders) {
      if (!f.startsWith(pre) || f === path) continue
      const first = f.slice(pre.length).split('/')[0]
      if (first && !out.has(first)) out.set(first, folderMeta(pre + first))
    }
    return [...out.values()]
  }

  /** Eine Graph-Anfrage beantworten: { status, body } (body: Objekt oder null). */
  function answer(method, url, { headers = {}, body = null, who = {} } = {}) {
    const u = new URL(url, 'https://graph.microsoft.com')
    const p = decodeURIComponent(u.pathname.replace(/^\/v1\.0/, ''))
    log.push({ method, p })
    const ok = (b, status = 200) => ({ status, body: b })
    const no = (status = 404, message = 'nicht gefunden') => ({ status, body: { error: { code: String(status), message } } })
    if (/^\/sites\/[^/]+(:.*)?$/.test(p) && !p.endsWith('/drives')) return ok({ id: 'site1', displayName: 'Cleanos', webUrl: SITE })
    if (p === '/sites/site1/drives') return ok({ value: [{ id: 'drive1', name: LIBRARY, webUrl: `${SITE}/${LIBRARY}` }] })
    if (p === '/me') return ok({ displayName: who.name, mail: who.email, userPrincipalName: who.email })
    if (p === '/me/transitiveMemberOf' || p === '/me/memberOf') return ok({ value: [] })
    if (/\/sendMail$/.test(p) && method === 'POST') {
      sent.push({ from: who.email, ...(body ? JSON.parse(body.toString()) : {}) })
      return ok(null, 202)
    }
    if (p === '/drives/drive1/root/children') {
      if (method === 'POST') {
        const b = JSON.parse(body?.toString() || '{}')
        if (isFolder(b.name)) return no(409, 'gibt es schon')
        folders.add(b.name)
        return ok(folderMeta(b.name), 201)
      }
      return ok({ value: children('') })
    }
    let m = p.match(/^\/drives\/drive1\/root:\/(.+?):\/(content|children)$/)
    if (m) {
      const path = m[1].replace(/\/$/, '')
      if (m[2] === 'children') {
        if (method === 'POST') {
          const b = JSON.parse(body?.toString() || '{}')
          const child = `${path}/${b.name}`
          if (isFolder(child)) return no(409, 'gibt es schon')
          folders.add(child)
          return ok(folderMeta(child), 201)
        }
        if (!isFolder(path)) return no()
        return ok({ value: children(path) })
      }
      if (method === 'PUT') {
        const had = items.get(path)
        const match = headers['if-match']
        if (match && (!had || had.eTag !== match)) return no(412, 'eTag passt nicht')
        if (/conflictBehavior=fail/.test(u.search) && had) return no(409, 'gibt es schon')
        const it = put(path, body || Buffer.alloc(0), (headers['content-type'] || 'application/octet-stream').split(';')[0], who.name || 'Attrappe')
        return ok(fileMeta(it), had ? 200 : 201)
      }
      const it = items.get(path)
      return it ? { status: 200, raw: it } : no()
    }
    m = p.match(/^\/drives\/drive1\/root:\/(.+)$/)
    if (m) {
      const path = m[1].replace(/:$/, '').replace(/\/$/, '')
      if (method === 'DELETE') {
        for (const k of [...items.keys()]) if (k === path || k.startsWith(`${path}/`)) items.delete(k)
        for (const k of [...folders]) if (k === path || k.startsWith(`${path}/`)) folders.delete(k)
        return ok(null, 204)
      }
      const it = items.get(path)
      if (it) return ok(fileMeta(it))
      return isFolder(path) ? ok(folderMeta(path)) : no()
    }
    if (/^\/drives\/drive1\/items\/[^/]+\/permissions$/.test(p)) return ok({ value: [] })
    if (/^\/drives\/drive1\/items\/[^/]+\/invite$/.test(p)) return ok({ value: [] })
    if (/^\/drives\/drive1\/items\/[^/]+$/.test(p) && method === 'PATCH') return ok({})
    unknown.push(`${method} ${p}`)
    return no(404, 'in der Attrappe nicht nachgebildet')
  }

  async function graphRoute(route, who) {
    const req = route.request()
    const method = req.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const u = new URL(req.url())
    const headers = req.headers()
    const body = req.postDataBuffer()
    if (u.pathname.endsWith('/$batch')) {
      const reqs = JSON.parse(body?.toString() || '{}').requests || []
      const responses = reqs.map((x) => {
        const a = answer(x.method || 'GET', x.url, { headers: Object.fromEntries(Object.entries(x.headers || {}).map(([k, v]) => [k.toLowerCase(), v])), body: x.body === undefined ? null : Buffer.from(typeof x.body === 'string' ? x.body : JSON.stringify(x.body)), who })
        return { id: x.id, status: a.status, body: a.raw ? {} : a.body }
      })
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ responses }) })
    }
    const a = answer(method, req.url(), { headers, body, who })
    if (a.raw) return route.fulfill({ status: 200, headers: CORS, contentType: a.raw.type, body: a.raw.content })
    return route.fulfill({ status: a.status, headers: CORS, contentType: 'application/json', body: a.body === null ? '' : JSON.stringify(a.body) })
  }

  /** App als angemeldete Person öffnen (SharePoint-Betrieb). */
  async function open(browser, port, { email = 'office@cleanos.at', name = 'Petra Leitner', clock = null, errors = [], hash = '', mobile = false, todo = false } = {}) {
    const ctx = await browser.newContext({ ...(mobile ? MOBILE : { viewport: { width: 1400, height: 950 } }), serviceWorkers: 'block' })
    if (clock) await ctx.clock.install({ time: new Date(clock) })
    await quiet(ctx)
    const who = { email, name }
    await ctx.route(/\/config\.json(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) }))
    await ctx.route(/\/vendor\/msal-browser\.min\.js(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: msalStub(who) }))
    await ctx.route(/^https:\/\/graph\.microsoft\.com\//, (r) => graphRoute(r, who))
    await ctx.route(/^https:\/\/download\.test\//, (r) => {
      const it = items.get(decodeURIComponent(new URL(r.request().url()).pathname.slice(1)))
      return it ? r.fulfill({ status: 200, headers: CORS, contentType: it.type, body: it.content }) : r.fulfill({ status: 404, headers: CORS, body: '' })
    })
    const page = await ctx.newPage()
    watch(page, errors)
    await page.goto(`http://localhost:${port}/${hash}`)
    await ready(page, { todo })
    return { ctx, ...helpers(page) }
  }

  /** JSON-Dateien im App-Ordner anlegen: { 'matten/matten.json': { … }, … }. */
  const seed = (docs) => {
    for (const [p, data] of Object.entries(docs || {})) put(`${folder}/${p}`, JSON.stringify(data, null, 1), 'application/json', 'Vorbereitung')
  }
  /** JSON-Datei aus dem App-Ordner lesen (null, wenn es sie nicht gibt). */
  const json = (p) => {
    const it = items.get(`${folder}/${p}`)
    return it ? JSON.parse(it.content.toString('utf8')) : null
  }
  return { drive: { items, folders, log, unknown }, sent, config, open, seed, json }
}
