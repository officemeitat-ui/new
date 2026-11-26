// QR am Liegeplatz in der App (SharePoint-Attrappe, Demo-Daten): das Büro ist zugleich Fahrer Markus (gleiche E-Mail).
//  1. Matten-Liegeplätze → Mehr → „QR-Aufkleber drucken“: Kunde wählen, einen abwählen, PDF (ohne Fahrerseite am
//     Webspace: Hinweis, Codes öffnen direkt die App).
//  2. Tour für heute vorschlagen und freigeben; Scan (#mw-touren/qr/<Liegeplatz>) → Stopp offen, „vor Ort bestätigt (QR)“,
//     an der Tour scan am Liegeplatz, Stopp in Bearbeitung; zweiter Scan ändert nichts.
//  3. Tourenplanung zeigt „QR hh:mm“ am Liegeplatz; Fahreransicht ebenso.
//  4. Liegeplatz in keiner Tour (Büro): öffnet den Liegeplatz.
//  5. Handy 390 px: Dialog ohne Querscrollen.
// Port 19879.
import { readFileSync } from 'node:fs'
import { chromium, check, finish, sharepoint, startServer, wait, mondayOf, todayVienna, addDays } from './ablauf-lib.mjs'

const APP = 19879
const server = startServer(APP)
await wait(800)
const browser = await chromium.launch()
const errors = []
try {
  const today = todayVienna()
  const { createDemoData } = await import('../src/data/demo.js')
  const { splitData } = await import('../src/storage/data-service.js')
  const docs = splitData(createDemoData(mondayOf(today)), [])
  const m = docs['matten/matten.json']
  m.settings.drivers = m.settings.drivers.map((d) => (d.id === 'fd-demo1' ? { ...d, email: 'office@cleanos.at' } : d))
  const cust = { id: 'c-fh', name: 'Flughafen Beispiel', no: '30001' }
  const mat = { articleId: m.placements[0].mats[0].articleId, name: m.placements[0].mats[0].name, size: m.placements[0].mats[0].size, color: m.placements[0].mats[0].color, qty: 1, owner: 'wir' }
  const pl = (id, name, start) => ({ id, name, objectId: 'o1', customerId: cust.id, customer: cust, mats: [mat], active: true, intervalDays: 28, startDate: start, rule: 'rhythmus', lat: 47.79, lon: 13.0, workMinutes: 10, createdAt: '', createdBy: '' })
  m.placements.push(pl('fh1', 'GAC Schuhkontrolle', today), pl('fh2', 'Terminal Windfang', today), pl('fh9', 'Werkstatt Tor', addDays(today, 10)))
  const SP = sharepoint({ access: { planners: ['office@cleanos.at'] } })
  SP.seed(docs)
  const O = await SP.open(browser, APP, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, hash: '#mw-liegeplaetze' })
  const tourPaths = () => [...SP.drive.items.keys()].filter((p) => p.includes('matten/touren/') && p.endsWith('.json')).map((p) => p.replace(/^.*?matten\/touren\//, 'matten/touren/'))
  const toursOf = () => tourPaths().map((p) => SP.json(p)).filter((t) => t?.date === today)

  // ------------------------------------------------ 1. Aufkleber
  await O.page.waitForSelector('main .section-head')
  await O.act('mw-qr-open')
  await O.page.waitForSelector('.modal #mw-qr-cust')
  check('Dialog: Hinweis ohne Fahrerseite am Webspace', /nicht eingerichtet/.test(await O.text('.modal')))
  await O.page.selectOption('#mw-qr-cust', 'c-fh')
  await O.page.waitForFunction(() => document.querySelectorAll('.modal input[name="mw-qr-p"]').length === 3)
  await O.page.uncheck('.modal input[name="mw-qr-p"][value="fh9"]')
  await O.page.setViewportSize({ width: 390, height: 844 })
  await wait(300)
  check('Handy 390 px: Dialog ohne Querscrollen', await O.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await O.page.setViewportSize({ width: 1400, height: 950 })
  await wait(300)
  const [dl] = await Promise.all([O.page.waitForEvent('download'), O.page.click('.modal [data-action="mw-qr-pdf"]')])
  const pdf = readFileSync(await dl.path())
  check('PDF mit den Aufklebern', dl.suggestedFilename() === `QR-Liegeplaetze_Flughafen-Beispiel_${today}.pdf` && pdf.subarray(0, 4).toString() === '%PDF', dl.suggestedFilename())
  check('Hinweis: 2 Aufkleber', !!(await O.toastWait(/2 Aufkleber als PDF/)))
  await O.closeModals()

  // ------------------------------------------------ 2. Tour heute, Scan
  await O.view('mw-kalender')
  await O.act('mw-plan-open')
  await O.page.waitForSelector('.modal [data-action="mw-plan-run"]')
  await O.page.click('.modal [data-action="mw-plan-run"]')
  await O.waitFor(async () => /neu/.test(await O.text('.modal .mw-plan-result')), 20000)
  await O.closeModals()
  await O.view('mw-planung')
  await O.page.evaluate(async (d) => { const c = await import('/src/ui/context.js'); c.app.ui.mwTpDate = d; c.renderNow() }, today)
  await wait(400)
  await O.page.uncheck('main input[data-change="mw-tp-drv"][data-id="fd-demo2"][data-f="on"]').catch(() => {})
  await wait(300)
  await O.page.click('main [data-action="mw-tp-propose"]')
  await O.toastWait(/Vorschlag: 1 Tour/, 30000)
  const A = await O.waitFor(() => toursOf().find((t) => t.stops.some((s) => s.items.some((i) => i.placementId === 'fh1'))), 15000)
  await O.page.click(`main [data-action="mw-tp-release"][data-tour="${A.id}"]`)
  const pathA = tourPaths().find((p) => p.includes(A.id))
  await O.waitFor(() => SP.json(pathA)?.status === 'freigegeben', 20000)
  await O.page.evaluate(() => { location.hash = '#mw-touren/qr/fh1' })
  check('Scan: „vor Ort bestätigt (QR …)“', !!(await O.toastWait(/GAC Schuhkontrolle: vor Ort bestätigt \(QR, \d\d:\d\d Uhr\)/, 20000)), await O.text('#toast'))
  const stopId = A.stops.find((s) => s.items.some((i) => i.placementId === 'fh1')).id
  const scanned = await O.waitFor(() => { const t = SP.json(pathA); const s = t?.stops.find((x) => x.id === stopId); return s?.items.find((i) => i.placementId === 'fh1')?.scan ? s : null }, 20000)
  check('An der Tour: scan am Liegeplatz, Stopp in Bearbeitung', !!scanned && scanned.status === 'in-bearbeitung' && scanned.items.find((i) => i.placementId === 'fh1').scan.via === 'qr', JSON.stringify(scanned && scanned.items.map((i) => i.scan)))
  check('Fahreransicht: Stopp offen, „QR hh:mm“ am Liegeplatz', /QR \d\d:\d\d/.test(await O.text(`main section.mwf-pl[data-pl="fh1"]`)))
  const at = scanned.items.find((i) => i.placementId === 'fh1').scan.at
  await O.page.evaluate(() => { location.hash = '#mw-planung' })
  await wait(300)
  await O.page.evaluate(() => { location.hash = '#mw-touren/qr/fh1' })
  await wait(1500)
  check('Zweiter Scan: erster zählt', SP.json(pathA).stops.find((x) => x.id === stopId).items.find((i) => i.placementId === 'fh1').scan.at === at)

  // ------------------------------------------------ 3. Tourenplanung
  await O.view('mw-planung')
  await O.page.evaluate(async (d) => { const c = await import('/src/ui/context.js'); c.app.ui.mwTpDate = d; c.renderNow() }, today)
  check('Tourenplanung: „QR hh:mm“ am Liegeplatz', !!(await O.waitFor(async () => /GAC Schuhkontrolle: 1 × .* QR \d\d:\d\d/.test(await O.text('main')), 10000)))

  // ------------------------------------------------ 4. Liegeplatz in keiner Tour
  await O.page.evaluate(() => { location.hash = '#mw-touren/qr/fh9' })
  await O.page.waitForSelector('.modal #mw-name', { timeout: 20000 })
  check('Büro: Liegeplatz in keiner Tour → Liegeplatz öffnet sich', (await O.page.inputValue('.modal #mw-name')) === 'Werkstatt Tor')
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
await finish(browser, [server], errors)
