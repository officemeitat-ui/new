// Umplanung am Tag im SharePoint-Betrieb (Graph-Attrappe) mit den Demo-Daten (zwei Fahrer) und zwei Liegeplätzen am
// Flughafen.
//  1. Vorschlag nur für Markus (Dragan an dem Tag abgewählt), freigeben, Tour starten (unterwegs).
//  2. Tourenplanung: am Stopp „Umplanen“ → „Neue Tour für Dragan“ → neue Tour freigegeben mit dem Stopp (umgeplant von
//     Markus), aus Markus' Tour weg (mit Vermerk), Einsatz „in Tour“ mit der neuen Tour.
//  3. Noch ein Stopp an Dragans (freigegebene) Tour: dort mit Zeiten; Vermerk beim Fahrer in „Matten-Touren“.
//  4. Fahrer hat ohne Netz weitergearbeitet (Stopp wieder in Markus' Tour): Warnung „steht auch in der Tour von …“.
//  5. Handy 390 px: Dialog „Umplanen“ ohne Querscrollen.
// Port 19877.
import { chromium, check, finish, sharepoint, startServer, wait, mondayOf, todayVienna, addDays } from './ablauf-lib.mjs'

const APP = 19877
const server = startServer(APP)
await wait(800)
const browser = await chromium.launch()
const errors = []
try {
  const today = todayVienna()
  const { createDemoData } = await import('../src/data/demo.js')
  const { splitData } = await import('../src/storage/data-service.js')
  const { isoWeekday } = await import('../src/core/dates.js')
  const docs = splitData(createDemoData(mondayOf(today)), [])
  const m = docs['matten/matten.json']
  let day = addDays(today, 2)
  while (isoWeekday(day) > 5) day = addDays(day, 1)
  const cust = { id: 'c-fh', name: 'Flughafen Beispiel', no: '30001' }
  const mat = { articleId: m.placements[0].mats[0].articleId, name: m.placements[0].mats[0].name, size: m.placements[0].mats[0].size, color: m.placements[0].mats[0].color, qty: 1, owner: 'wir' }
  const pl = (id, name, objectId, lat, lon) => ({ id, name, objectId, customerId: cust.id, customer: cust, mats: [mat], active: true, intervalDays: 28, startDate: today, rule: 'ab-ist', lat, lon, workMinutes: 10, createdAt: '', createdBy: '' })
  m.placements.push(pl('fh1', 'GAC – Container SIKO', 'o1', 47.79, 13.0), pl('fh2', 'Werkstatt – Tor', 'o2', 47.70, 13.1))
  const SP = sharepoint({ access: { planners: ['office@cleanos.at'] } })
  SP.seed(docs)
  const O = await SP.open(browser, APP, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, hash: '#mw-planung' })
  const tourPaths = () => [...SP.drive.items.keys()].filter((p) => p.includes('matten/touren/') && p.endsWith('.json')).map((p) => p.replace(/^.*?matten\/touren\//, 'matten/touren/'))
  const toursOf = () => tourPaths().map((p) => SP.json(p)).filter((t) => t?.date === day)
  const jobs = () => SP.json(`matten/einsaetze-${day.slice(0, 4)}.json`)?.jobs || []
  const modal = () => O.text('.modal')
  const setDay = async () => {
    await O.page.evaluate(async (d) => { const c = await import('/src/ui/context.js'); c.app.ui.mwTpDate = d; c.renderNow() }, day)
    await wait(400)
  }

  // ------------------------------------------------ 1. Tour für Markus, freigeben, starten
  await O.page.waitForSelector('main [data-action="mw-tp-propose"]')
  await O.view('mw-kalender')
  await O.act('mw-plan-open')
  await O.page.waitForSelector('.modal [data-action="mw-plan-run"]')
  await O.page.click('.modal [data-action="mw-plan-run"]')
  await O.waitFor(async () => /neu/.test(await O.text('.modal .mw-plan-result')), 20000)
  await O.closeModals()
  await O.view('mw-planung')
  await setDay()
  await O.page.uncheck('main input[data-change="mw-tp-drv"][data-id="fd-demo2"][data-f="on"]')
  await wait(400)
  await O.page.click('main [data-action="mw-tp-propose"]')
  await O.toastWait(/Vorschlag: 1 Tour/, 30000)
  const A0 = await O.waitFor(() => toursOf().find((t) => t.driverId === 'e2'), 15000)
  check('Eine Tour für Markus mit mindestens 2 Stopps', !!A0 && A0.stops.length >= 2, JSON.stringify(A0 && A0.stops.map((s) => s.id)))
  await O.page.click(`main [data-action="mw-tp-release"][data-tour="${A0.id}"]`)
  await O.waitFor(() => SP.json(tourPaths().find((p) => p.includes(A0.id)))?.status === 'freigegeben', 20000)
  await O.view('mw-touren')
  await O.act('mwf-open', { tour: A0.id })
  await O.page.waitForSelector('main [data-action="mwf-start"]')
  await O.page.click('main [data-action="mwf-start"]')
  const pathA = tourPaths().find((p) => p.includes(A0.id))
  check('Markus’ Tour unterwegs', !!(await O.waitFor(() => SP.json(pathA)?.status === 'unterwegs', 20000)))

  // ------------------------------------------------ 2. Umplanen an eine neue Tour für Dragan
  await O.view('mw-planung')
  await setDay()
  const first = A0.stops[0]
  await O.page.waitForSelector(`main [data-action="mw-tp-ho-open"][data-stop="${first.id}"]`)
  check('Laufende Tour: „Umplanen“ je offenem Stopp', (await O.page.locator(`main [data-action="mw-tp-ho-open"][data-tour="${A0.id}"]`).count()) === A0.stops.length)
  await O.page.click(`main [data-action="mw-tp-ho-open"][data-stop="${first.id}"]`)
  await O.page.waitForSelector('.modal #mw-ho-to')
  check('Dialog: Stopp vorgewählt, „Neue Tour für Dragan Jović“', (await O.page.isChecked(`.modal input[name="mw-ho-stop"][value="${first.id}"]`)) && /Neue Tour für Dragan Jović/.test(await modal()))
  await O.page.setViewportSize({ width: 390, height: 844 })
  await wait(300)
  check('Handy 390 px: „Umplanen“ ohne Querscrollen', await O.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await O.page.setViewportSize({ width: 1400, height: 950 })
  await wait(300)
  await O.page.selectOption('#mw-ho-to', 'neu:e4')
  await O.page.click('.modal [data-action="mw-tp-ho"]')
  check('Hinweis: an Dragan gegeben, neue Tour freigegeben', !!(await O.toastWait(/an Dragan Jović gegeben\. Neue Tour ist freigegeben/, 30000)), await O.text('#toast'))
  const B = await O.waitFor(() => toursOf().find((t) => t.driverId === 'e4'), 15000)
  check('Neue Tour für Dragan: freigegeben, mit E-Mail, Stopp „umgeplant von Markus“', !!B && B.status === 'freigegeben' && !!B.driverEmail && B.stops.length === 1 && B.stops[0].handedFrom?.driverName === 'Markus Huber', JSON.stringify(B && { s: B.status, st: B.stops.map((s) => s.handedFrom) }))
  const A1 = SP.json(pathA)
  check('Aus Markus’ Tour weg, mit Vermerk; Tour bleibt unterwegs', !A1.stops.some((s) => s.id === first.id) && A1.handovers?.[0]?.toDriver === 'Dragan Jović' && A1.status === 'unterwegs', JSON.stringify(A1.handovers))
  const key = first.items[0].jobKey
  check('Einsatz „in Tour“ mit Dragans Tour', !!(await O.waitFor(() => jobs().find((j) => j.key === key && j.status === 'in-tour' && j.tourId === B.id), 15000)), JSON.stringify(jobs().find((j) => j.key === key)))

  // ------------------------------------------------ 3. Noch ein Stopp an Dragans Tour
  const second = A1.stops[0]
  await O.page.click(`main [data-action="mw-tp-ho-open"][data-stop="${second.id}"]`)
  await O.page.waitForSelector('.modal #mw-ho-to')
  await O.page.selectOption('#mw-ho-to', `tour:${B.id}`)
  await O.page.click('.modal [data-action="mw-tp-ho"]')
  await O.toastWait(/an Dragan Jović gegeben/, 30000)
  const B2 = await O.waitFor(() => { const t = toursOf().find((x) => x.id === B.id); return t?.stops.length === 2 ? t : null }, 15000)
  check('Dragans Tour: 2 Stopps, mit Zeiten', !!B2 && B2.stops.every((s) => s.times?.arrival), JSON.stringify(B2 && B2.stops.map((s) => s.times)))
  await O.view('mw-touren')
  await O.act('mwf-open', { tour: A0.id })
  check('Fahreransicht Markus: „Vom Büro an andere Fahrer gegeben“', !!(await O.waitFor(async () => /Vom Büro an andere Fahrer gegeben/.test(await O.text('main')), 10000)))

  // ------------------------------------------------ 4. Stopp wieder in Markus' Tour (Fahrer ohne Netz)
  const back = SP.json(pathA)
  back.stops.push({ ...first, status: 'in-bearbeitung', updatedAt: new Date().toISOString() })
  back.order = back.stops.map((s) => s.id)
  SP.seed({ [pathA]: back })
  await O.view('mw-planung')
  await setDay()
  await O.act('mw-tp-reload')
  check('Warnung: steht auch in der Tour von …', !!(await O.waitFor(async () => /steht auch in der Tour von Dragan Jović/.test(await O.text('main')), 15000)), (await O.text('main')).slice(0, 300))
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
await finish(browser, [server], errors)
