// „Problem melden“ auf der Fahrerseite am Webspace (mattentour.php, Fahrer ohne Microsoft-Konto) gegen den eingebauten
// PHP-Server mit eigenem Ordner (MATTEN_ORDNER): Tour über die Schnittstelle wie aus der App übertragen, am Handy
// (390 px) den Stopp öffnen, „Problem melden“ ohne Auswahl (Fehler), mit Art, Liegeplatz und Text (gesendet, steht am
// Stopp), ohne Netz (wartet im Gerät, wird nachgesendet); die App holt die Meldungen ab und legt sie am Stopp an
// (applyWebEvents). Der Abschluss des Stopps bleibt davon unberührt. Port 19878.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, check, finish, wait, R, P, todayVienna } from './ablauf-lib.mjs'

const PORT = 19878
const dir = join(P, 'mattentour-php')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const KEY = 'k'.repeat(40)
const CODE = 'Ab12Cd34Ef56Gh78Ij90'
const HASH = createHash('sha256').update(CODE).digest('hex')
writeFileSync(join(dir, 'mattentour.json'), JSON.stringify({ version: 1, schluessel: KEY, adresse: `http://127.0.0.1:${PORT}/`, ntfy: '', absender: '', buero: [] }))
const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', R], { env: { ...process.env, MATTEN_ORDNER: dir }, stdio: 'ignore' })
await wait(1200)
const browser = await chromium.launch()
const errors = []
try {
  const DAY = todayVienna()
  const { stopsFromJobs } = await import('../src/core/matten-tour.js')
  const { applyWebEvents, webTourPayload, withWebspace } = await import('../src/core/matten-webspace.js')
  const cust = { id: 'c1', name: 'Flughafen Beispiel', no: '30001' }
  const mat = { articleId: 'a1', name: '150 × 250 cm, anthrazit', size: '150 × 250 cm', color: 'anthrazit' }
  const placements = [['lpgac1', 'GAC Schuhkontrolle'], ['lpterm2', 'Terminal Windfang']].map(([id, name]) => ({ id, objectId: 'o1', customerId: cust.id, customer: cust, name, active: true, mats: [{ ...mat, qty: 1 }], intervalDays: 14, startDate: DAY, rule: 'rhythmus' }))
  const objects = [{ id: 'o1', name: 'Terminal 1', address: 'Innsbrucker Bundesstraße 95, 5020 Salzburg', lat: 47.79, lon: 13.0 }]
  const stops = stopsFromJobs({ jobs: placements.map((p) => ({ key: `${p.id}:${DAY}`, placementId: p.id, due: DAY, status: 'geplant' })), placements, objects, date: DAY, customers: [cust] })
  const tour = withWebspace({ schema: 1, id: 'mtprob00000001', date: DAY, driverId: 'e7', driverName: 'Ivo Beispiel', status: 'freigegeben', order: stops.map((s) => s.id), stops, route: {} }, { hash: HASH, name: 'Ivo Beispiel', lang: 'de' })
  const api = async (aktion, body) => {
    const r = await fetch(`http://127.0.0.1:${PORT}/mattentour.php?aktion=${aktion}`, { method: body ? 'POST' : 'GET', headers: { 'X-Schluessel': KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, json: await r.json().catch(() => null) }
  }
  let r = await api('fahrer', { fahrer: [{ hash: HASH, name: 'Ivo Beispiel', sprache: 'de' }] })
  check('Fahrer übertragen', r.status === 200, JSON.stringify(r))
  r = await api('tour', webTourPayload(tour, { hash: HASH, name: 'Ivo Beispiel', lang: 'de' }))
  check('Tour übertragen', r.status === 200, JSON.stringify(r))

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  const sid = stops[0].id
  await page.goto(`http://127.0.0.1:${PORT}/mattentour.php?p=${CODE}&tour=${tour.id}&stopp=${encodeURIComponent(sid)}`)
  await page.waitForSelector('details.mww-problem')
  check('Stopp: „Problem melden“ unter dem Abschluss', (await page.locator(`section[data-mww-teil="${sid}"] details.mww-problem`).count()) === 1)
  const teil = page.locator(`section[data-mww-teil="${sid}"]`)
  await teil.locator('details.mww-problem summary').click()
  await teil.locator('form[data-mww-problem] button[type=submit]').click()
  await page.waitForFunction((s) => !document.querySelector(`section[data-mww-teil="${s}"] form[data-mww-problem] [data-mww-fehler]`).hidden, sid)
  check('Ohne Auswahl: Hinweis „Bitte wählen, was passiert ist.“', /Bitte wählen, was passiert ist/.test(await teil.locator('form[data-mww-problem] [data-mww-fehler]').textContent()))
  await teil.locator('input[name=problem_art][value=schaden]').check()
  await teil.locator('select[name=liegeplatz]').selectOption('lpgac1')
  await teil.locator('textarea[name=problem_text]').fill('Rand eingerissen, Stolpergefahr')
  await Promise.all([page.waitForURL(/gesendet=problem/), teil.locator('form[data-mww-problem] button[type=submit]').click()])
  check('Gesendet: „Meldung ans Büro gesendet.“', /Meldung ans Büro gesendet/.test(await page.locator(`section[data-mww-teil="${sid}"]`).textContent()))
  check('Am Stopp: was schon gemeldet ist', /Matte beschädigt/.test(await page.locator(`section[data-mww-teil="${sid}"] .mww-probleme`).textContent()))
  check('Handy 390 px: ohne Querscrollen', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))

  // ohne Netz: im Gerät, später nachgesendet
  const teil2 = page.locator(`section[data-mww-teil="${sid}"]`)
  await teil2.locator('input[name=problem_art][value=kunde]').check()
  await teil2.locator('textarea[name=problem_text]').fill('Kunde möchte eine größere Matte')
  await ctx.setOffline(true)
  await teil2.locator('form[data-mww-problem] button[type=submit]').click()
  await page.waitForFunction((s) => !document.querySelector(`section[data-mww-teil="${s}"] [data-mww-problem-ok]`).hidden, sid)
  check('Ohne Netz: „wird gesendet, sobald wieder Netz da ist“, Formular wieder leer', /sobald wieder Netz/.test(await teil2.locator('[data-mww-problem-ok]').textContent()) && (await teil2.locator('textarea[name=problem_text]').inputValue()) === '')
  check('Stopp ist nicht als erledigt markiert', (await page.locator(`li[data-mww-stopp-li="${sid}"].fertig`).count()) === 0)
  await ctx.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  let events = []
  for (let i = 0; i < 40; i++) {
    events = (await api('meldungen')).json?.meldungen || []
    if (events.filter((m) => m.art === 'problem').length === 2) break
    await wait(500)
  }
  check('Am Webspace: zwei Meldungen „problem“', events.filter((m) => m.art === 'problem').length === 2, JSON.stringify(events))

  // App holt ab
  const res = applyWebEvents(tour, events, { now: new Date().toISOString() })
  const reports = res.tour.stops[0].reports || []
  check('App: zwei Meldungen am Stopp mit Art, Liegeplatz, Text und Fahrer', reports.length === 2 && reports[0].kind === 'schaden' && reports[0].placementId === 'lpgac1' && reports[0].placementName === 'GAC Schuhkontrolle' && reports[1].kind === 'kunde' && reports.every((x) => x.by === 'Ivo Beispiel'), JSON.stringify(reports))
  check('App: Stopp unverändert offen', res.tour.stops[0].status === 'geplant', res.tour.stops[0].status)
  r = await api('uebernommen', { ids: res.done })
  check('Übernommen gemeldet', r.status === 200 && ((await api('meldungen')).json?.meldungen || []).length === 0)
  await ctx.close()
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
php.kill()
await finish(browser, [], errors)
