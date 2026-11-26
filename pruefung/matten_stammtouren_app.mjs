// Mattenwechsel: Stammtouren im SharePoint-Betrieb (Graph-Attrappe) mit den Demo-Daten und vier Liegeplätzen an einem
// Objekt (wie am Flughafen) plus einem an einem zweiten Objekt.
//  1. Tourenplanung → Mehr → „Stammtouren“ → neue Stammtour: Name, Wochentag, alle 2 Wochen, nächster Tag, Fahrer;
//     Liegeplätze über die Suche hinzufügen, Reihenfolge ändern, speichern.
//  2. Hinweis „Intervall oder Starttermin passen nicht“ → „Liegeplätze anpassen“: Intervall 14, fester Rhythmus, Starttermin.
//  3. Matten-Kalender → „Einsätze planen“; Tourenplanung am Tag der Tour → „Vorschlag erzeugen“: eine Tour mit dem
//     Fahrer der Stammtour, Kennzeichnung „Tour 1 Flughafen“, Stopps und Liegeplätze in der Reihenfolge der Stammtour.
//  4. Handy 390 px: Dialog ohne Querscrollen.
// Port 19868.
import { chromium, check, finish, sharepoint, startServer, wait, mondayOf, todayVienna, addDays } from './ablauf-lib.mjs'

const APP = 19868
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
  // Tag der Tour: übermorgen (Werktag), damit „heute“ nicht dazwischenfunkt
  let day = addDays(today, 2)
  while (isoWeekday(day) > 5) day = addDays(day, 1)
  const cust = { id: 'c-fh', name: 'Flughafen Beispiel', no: '30001' }
  const mat = { articleId: m.placements[0].mats[0].articleId, name: m.placements[0].mats[0].name, size: m.placements[0].mats[0].size, color: m.placements[0].mats[0].color, qty: 1, owner: 'wir' }
  docs['objekte/objekte.json'] = { ...(docs['objekte/objekte.json'] || {}) }
  const pl = (id, name, objectId, interval = 28) => ({ id, name, objectId, customerId: cust.id, customer: cust, mats: [mat], active: true, intervalDays: interval, startDate: today, rule: 'ab-ist', lat: 47.79, lon: 13.0, createdAt: '', createdBy: '' })
  m.placements.push(pl('fh1', 'GAC – Container SIKO', 'o1'), pl('fh2', 'GAC – Schuhkontrolle', 'o1'), pl('fh3', '1900 – Follow me 1', 'o1'), pl('fh4', 'Terminal 1 – Windfang A', 'o1'), pl('fh5', 'Werkstatt – Tor', 'o2', 14))
  const SP = sharepoint({ access: { planners: ['office@cleanos.at'] } })
  SP.seed(docs)
  const O = await SP.open(browser, APP, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, hash: '#mw-planung' })
  const matten = () => SP.json('matten/matten.json') || {}
  const modal = () => O.text('.modal')

  // ------------------------------------------------ 1. Stammtour anlegen
  await O.page.waitForSelector('main [data-action="mw-tp-propose"]')
  await O.act('mw-st-open')
  await O.page.waitForSelector('.modal [data-action="mw-st-edit"]')
  check('Stammtouren: Erklärung, noch keine', /Noch keine Stammtour/.test(await modal()) && /fester Reihenfolge/.test(await modal()))
  await O.page.click('.modal .actions [data-action="mw-st-edit"]')
  await O.page.waitForSelector('.modal #mw-st-name')
  await O.page.fill('#mw-st-name', 'Tour 1 Flughafen')
  await O.page.selectOption('#mw-st-weekday', String(isoWeekday(day)))
  await O.page.selectOption('#mw-st-weeks', '2')
  await O.page.fill('#mw-st-anchor', day)
  await O.page.selectOption('#mw-st-driver', 'e4')
  await O.page.fill('#mw-st-f-q', 'GAC')
  await O.page.waitForFunction(() => document.querySelectorAll('.modal [data-action="mw-st-add"]').length === 2)
  await O.page.click('.modal [data-action="mw-st-add-all"]')
  await O.page.fill('#mw-st-f-q', 'Follow')
  await O.page.waitForFunction(() => document.querySelectorAll('.modal [data-action="mw-st-add"]').length === 1)
  await O.page.click('.modal [data-action="mw-st-add"]')
  // „Follow me 1“ an die erste Stelle
  await O.page.click('.modal [data-action="mw-st-move"][data-i="2"][data-d="-1"]')
  await O.page.click('.modal [data-action="mw-st-move"][data-i="1"][data-d="-1"]')
  const order = await O.page.$$eval('.modal .mw-st-name', (els) => els.map((e) => e.textContent))
  check('Reihenfolge: Follow me 1, Container SIKO, Schuhkontrolle', order.length === 3 && order[0].includes('Follow me 1') && order[1].includes('Container SIKO') && order[2].includes('Schuhkontrolle'), order.join(' | '))
  await O.page.click('.modal [data-action="mw-st-save"]')
  check('Gespeichert, Hinweis zu Intervall und Starttermin', !!(await O.toastWait(/Stammtour „Tour 1 Flughafen“ gespeichert\. Bei 3 Liegeplätzen passen Intervall oder Starttermin nicht zur Tour/)), await O.text('#toast'))
  const route = await O.waitFor(() => (matten().routes || []).find((r) => r.name === 'Tour 1 Flughafen'), 15000)
  check('In SharePoint: Stammtour mit Fahrer, Tag und Reihenfolge', !!route && route.driverId === 'e4' && route.everyWeeks === 2 && route.anchor === day && route.placementIds.join() === 'fh3,fh1,fh2', JSON.stringify(route))

  // ------------------------------------------------ 2. Liegeplätze anpassen
  await O.page.waitForSelector('.modal [data-action="mw-st-align"]')
  await O.page.click('.modal [data-action="mw-st-align"]')
  check('Angepasst', !!(await O.toastWait(/3 Liegeplätze angepasst: alle 2 Wochen/)), await O.text('#toast'))
  const fh = await O.waitFor(() => {
    const ps = (matten().placements || []).filter((p) => ['fh1', 'fh2', 'fh3'].includes(p.id))
    return ps.length === 3 && ps.every((p) => p.intervalDays === 14 && p.rule === 'rhythmus' && p.startDate === day) ? ps : null
  }, 15000)
  check('Liegeplätze: 14 Tage, fester Rhythmus, Starttermin = Tag der Tour; der vierte bleibt', !!fh && (matten().placements || []).find((p) => p.id === 'fh4').intervalDays === 28)
  check('Kein Hinweis mehr an der Stammtour', !/passen nicht/.test(await modal()) && (await O.page.locator('.modal [data-action="mw-st-align"]').count()) === 0)
  await O.closeModals()

  // ------------------------------------------------ 3. Einsätze planen und Vorschlag
  await O.view('mw-kalender')
  await O.act('mw-plan-open')
  await O.page.waitForSelector('.modal [data-action="mw-plan-run"]')
  await O.page.click('.modal [data-action="mw-plan-run"]')
  await O.waitFor(async () => /neu/.test(await O.text('.modal .mw-plan-result')), 20000)
  await O.closeModals()
  await O.view('mw-planung')
  await O.page.evaluate(async (d) => { const c = await import('/src/ui/context.js'); c.app.ui.mwTpDate = d; c.renderNow() }, day)
  await wait(500)
  await O.page.click('main [data-action="mw-tp-propose"]')
  check('Vorschlag mit Stammtour', !!(await O.toastWait(/Vorschlag: \d+ Touren? \(1 aus einer Stammtour\)/, 30000)), await O.text('#toast'))
  const tours = await O.waitFor(() => {
    const list = [...SP.drive.items.keys()].filter((p) => p.includes('matten/touren/') && p.endsWith('.json')).map((p) => SP.json(p.replace(/^.*?matten\/touren\//, 'matten/touren/'))).filter((t) => t?.date === day)
    return list.length ? list : null
  }, 15000)
  const fixed = (tours || []).find((t) => t.routeId === route.id)
  const items = fixed ? fixed.stops.flatMap((s) => s.items.map((i) => i.placementId)) : []
  check('Tour der Stammtour: Fahrer Dragan, Name gemerkt, Liegeplätze in fester Reihenfolge', !!fixed && fixed.driverId === 'e4' && fixed.routeName === 'Tour 1 Flughafen' && items.slice(0, 3).join() === 'fh3,fh1,fh2', JSON.stringify(fixed && { d: fixed.driverId, items }))
  check('Die übrigen Stopps gehen in den normalen Vorschlag (anderer Fahrer)', (tours || []).filter((t) => t.routeId !== route.id).every((t) => t.driverId !== 'e4'))
  check('Tourenplanung zeigt die Stammtour an der Tour', /Tour 1 Flughafen/.test(await O.text('main')))

  // ------------------------------------------------ 4. Handy
  await O.page.setViewportSize({ width: 390, height: 844 })
  await O.act('mw-st-edit', { id: route.id })
  await O.page.waitForSelector('.modal #mw-st-name')
  check('Handy 390 px: Dialog ohne Querscrollen', await O.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
await finish(browser, [server], errors)
