// „Problem melden“ auf der Fahrerseite am Webspace (mattentour.php, Fahrer ohne Microsoft-Konto) gegen den eingebauten
// PHP-Server mit eigenem Ordner (MATTEN_ORDNER): Tour über die Schnittstelle wie aus der App übertragen, am Handy
// (390 px) den Stopp öffnen, „Problem melden“ ohne Auswahl (Fehler), mit Art, Liegeplatz und Text (gesendet, steht am
// Stopp), ohne Netz (wartet im Gerät, wird nachgesendet); die App holt die Meldungen ab und legt sie am Stopp an
// (applyWebEvents). Der Abschluss des Stopps bleibt davon unberührt.
// Fotopflicht „immer“ (an der Tour): Hinweis am Stopp; Abschluss ohne Foto abgelehnt, auch ohne Netz (nichts im Ausgang);
// mit Foto angenommen, die App übernimmt den Abschluss mit dem Foto.
// QR am Liegeplatz (mattentour.php?qr=…): mit Fahrer-Link im Gerät → Stopp öffnen, „QR bestätigt“, Rückmeldung „scan“
// (einmal je Liegeplatz), App vermerkt den Scan; ohne Fahrer-Link → weiter in die App; fremder Liegeplatz → Hinweis. Port 19878.
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
  const tour = withWebspace({ schema: 1, id: 'mtprob00000001', date: DAY, driverId: 'e7', driverName: 'Ivo Beispiel', status: 'freigegeben', photoRule: 'immer', order: stops.map((s) => s.id), stops, route: {} }, { hash: HASH, name: 'Ivo Beispiel', lang: 'de' })
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
  // beide in derselben Sekunde möglich: Reihenfolge dann beliebig
  const rSchaden = reports.find((x) => x.kind === 'schaden')
  check('App: zwei Meldungen am Stopp mit Art, Liegeplatz, Text und Fahrer', reports.length === 2 && !!rSchaden && rSchaden.placementId === 'lpgac1' && rSchaden.placementName === 'GAC Schuhkontrolle' && reports.some((x) => x.kind === 'kunde') && reports.every((x) => x.by === 'Ivo Beispiel'), JSON.stringify(reports))
  check('App: Stopp unverändert offen', res.tour.stops[0].status === 'geplant', res.tour.stops[0].status)
  r = await api('uebernommen', { ids: res.done })
  check('Übernommen gemeldet', r.status === 200 && ((await api('meldungen')).json?.meldungen || []).length === 0)

  // ------------------------------------------------ QR am Liegeplatz
  await page.goto(`http://127.0.0.1:${PORT}/mattentour.php?qr=lpterm2`)
  check('Scan: Stopp offen, „Liegeplatz per QR bestätigt“', page.url().includes(`stopp=${sid}`) && /Liegeplatz per QR bestätigt/.test(await page.locator(`section[data-mww-teil="${sid}"]`).textContent()), page.url())
  check('Scan: am Liegeplatz „QR bestätigt …“', /QR bestätigt \d\d:\d\d/.test(await page.locator(`section[data-mww-teil="${sid}"] [data-mww-pl="lpterm2"]`).textContent()))
  await page.goto(`http://127.0.0.1:${PORT}/mattentour.php?qr=lpterm2`)
  let scans = ((await api('meldungen')).json?.meldungen || []).filter((m) => m.art === 'scan')
  check('Zweiter Scan: nur eine Rückmeldung „scan“', scans.length === 1 && scans[0].daten.liegeplatz === 'lpterm2', JSON.stringify(scans))
  const scanned = applyWebEvents(res.tour, scans, { now: new Date().toISOString() })
  check('App: Scan am Liegeplatz vermerkt, Stopp in Bearbeitung', !!scanned.tour.stops[0].items.find((x) => x.placementId === 'lpterm2')?.scan && scanned.tour.stops[0].status === 'in-bearbeitung')
  await api('uebernommen', { ids: scanned.done })
  await page.goto(`http://127.0.0.1:${PORT}/mattentour.php?qr=gibtsnicht`)
  check('Fremder Liegeplatz: „in keiner deiner offenen Touren“', /in keiner deiner offenen Touren/.test(await page.textContent('body')))
  const fremd = await fetch(`http://127.0.0.1:${PORT}/mattentour.php?qr=lpterm2`, { redirect: 'manual' })
  check('Ohne Fahrer-Link: weiter in die App (#mw-touren/qr/…)', fremd.status === 302 && (fremd.headers.get('location') || '').endsWith('/#mw-touren/qr/lpterm2'), `${fremd.status} ${fremd.headers.get('location')}`)

  // ------------------------------------------------ Fotopflicht beim Abschluss
  await page.goto(`http://127.0.0.1:${PORT}/mattentour.php?tour=${tour.id}&stopp=${encodeURIComponent(sid)}`)
  const st = page.locator(`section[data-mww-teil="${sid}"]`)
  check('Hinweis „Pflicht: … mindestens ein Foto“', /Pflicht: an diesem Stopp mindestens ein Foto/.test(await st.textContent()))
  const form = st.locator('form[data-mww-stopp]')
  // die Auswahlfelder sind als große Knöpfe (Label) gestaltet: wie ein Tippen darauf
  for (const lid of ['lpgac1', 'lpterm2']) await form.locator(`input[name="ergebnis[${lid}]"][value=gewechselt]`).evaluate((el) => el.click())
  await form.locator('input[name=ohne]').evaluate((el) => el.click())
  await form.locator('input[name=ohne_grund]').fill('niemand vor Ort')
  await ctx.setOffline(true)
  await form.locator('button[type=submit]').click()
  await page.waitForFunction((s) => !document.querySelector(`section[data-mww-teil="${s}"] form[data-mww-stopp] [data-mww-fehler]`).hidden, sid)
  check('Ohne Foto (ohne Netz): „Foto fehlt“, nichts im Ausgang', /Foto fehlt: an jedem Stopp/.test(await form.locator('[data-mww-fehler]').textContent()) && (await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('ausgang')).map((k) => localStorage.getItem(k)).join(''))).indexOf('abschluss') < 0)
  await ctx.setOffline(false)
  // am Webspace selbst (ohne Skript-Prüfung): 400
  const fd = new FormData()
  for (const [k, v] of Object.entries({ p: CODE, art: 'abschluss', tour: tour.id, stopp: sid, meldung: 'abcdef0123456789abcd', zeit: String(Date.now()), 'ergebnis[lpgac1]': 'gewechselt', 'ergebnis[lpterm2]': 'gewechselt', ohne: '1', ohne_grund: 'niemand vor Ort' })) fd.append(k, v)
  const raw = await fetch(`http://127.0.0.1:${PORT}/mattentour.php?aktion=meldung`, { method: 'POST', body: fd, headers: { Accept: 'application/json' } })
  check('Webspace lehnt Abschluss ohne Pflichtfoto ab (400)', raw.status === 400 && /Foto fehlt/.test((await raw.json()).fehler || ''))
  const jpeg = Buffer.from(await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; const x = c.getContext('2d'); x.fillStyle = '#39c'; x.fillRect(0, 0, 64, 48); const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); return [...new Uint8Array(await b.arrayBuffer())] }))
  await form.locator('input[data-mww-foto="lpgac1"]').setInputFiles({ name: 'matte.jpg', mimeType: 'image/jpeg', buffer: jpeg })
  await page.waitForFunction((s) => document.querySelectorAll(`section[data-mww-teil="${s}"] [data-mww-fotos="lpgac1"] img`).length > 0, sid)
  await Promise.all([page.waitForURL(/gesendet=abschluss/), form.locator('button[type=submit]').click()])
  events = (await api('meldungen')).json?.meldungen || []
  const fin = events.find((m) => m.art === 'abschluss')
  check('Mit Foto: Abschluss angenommen, Foto dabei', !!fin && (fin.fotos || []).length === 1, JSON.stringify(fin))
  const res2 = applyWebEvents(res.tour, events, { now: new Date().toISOString() })
  check('App übernimmt den Abschluss (ohne Vermerk „ohne Pflichtfoto“)', res2.tour.stops[0].status === 'abgeschlossen' && !res2.tour.stops[0].web?.fotoPflicht && res2.skipped.length === 0, JSON.stringify({ s: res2.tour.stops[0].status, sk: res2.skipped }))
  await ctx.close()
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
php.kill()
await finish(browser, [], errors)
