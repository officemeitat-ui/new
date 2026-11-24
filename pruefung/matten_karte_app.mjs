// Mattenwechsel: Karte der Touren eines Tages in der Tourenplanung (core/matten-karte.js, ui/matten-karte.js) im
// SharePoint-Betrieb (Graph-Attrappe). Zwei Touren für heute, nach Fahrer sortiert (Dragan: ein Stopp; Markus: drei
// Stopps, davon einer ohne Koordinaten und einer erledigt): „Karte zeigen“ → Kachelkarte (basemap.at, hier mit einer Attrappe für die
// Kacheln), Betriebshof, nummerierte Stopps in zwei Farben, Linie je Tour, Legende, Hinweis auf den Stopp ohne
// Koordinaten; Zoomen; Ausblenden; am Handy ohne Querscrollen.
// Port 19853.
import { chromium, check, finish, sharepoint, startServer, wait, mondayOf, todayVienna, P } from './ablauf-lib.mjs'

const APP = 19853
const server = startServer(APP)
await wait(1000)
const browser = await chromium.launch()
const errors = []
try {
  const today = todayVienna()
  const y = today.slice(0, 4)
  const { createDemoData } = await import('../src/data/demo.js')
  const { splitData } = await import('../src/storage/data-service.js')
  const { stopsFromJobs } = await import('../src/core/matten-tour.js')
  const { TOUR_COLORS } = await import('../src/core/matten-karte.js')
  const SP = sharepoint({ access: { planners: ['office@cleanos.at'] } })
  SP.seed(splitData(createDemoData(mondayOf(today)), []))
  const depot = { name: 'Betriebshof (Beispiel)', address: 'Beispielweg 1, 5020 Salzburg', lat: 47.7745, lon: 13.07 }
  const mat = (qty) => ({ articleId: 'a-fdemo6', name: '85 × 150 cm, grau', size: '85 × 150 cm', color: 'grau', qty, owner: 'wir' })
  const objects = [
    { id: 'kx1', name: 'Wohnanlage Testweg', address: 'Testweg 1, 5020 Salzburg', lat: 47.8101, lon: 13.0402 },
    { id: 'kx2', name: 'Bäckerei Probe', address: 'Probegasse 4, 5020 Salzburg', lat: 47.8012, lon: 13.0511 },
    { id: 'kx3', name: 'Praxis Muster', address: 'Musterplatz 2, 5020 Salzburg' }, // ohne Koordinaten
    { id: 'kx4', name: 'Autohaus Probe', address: 'Autoweg 9, 5020 Salzburg', lat: 47.79, lon: 13.0 },
  ]
  const cust = (n) => ({ id: `c-kx${n}`, name: ['Hausverwaltung Probe', 'Bäckerei Probe OG', 'Praxis Muster', 'Autohaus Probe KG'][n - 1], no: `2000${n}` })
  const placements = objects.map((o, i) => ({ id: `mwk${i + 1}`, name: 'Eingang', objectId: o.id, customerId: cust(i + 1).id, customer: cust(i + 1), mats: [mat(1)], active: true, intervalDays: 14, startDate: today, rule: 'rhythmus' }))
  const tourFor = (id, ids, driver) => {
    const jobs = ids.map((pid) => ({ key: `${pid}:${today}`, placementId: pid, due: today, status: 'geplant' }))
    const stops = stopsFromJobs({ jobs, placements, objects, date: today })
    const order = ids.map((pid) => `st-${placements.find((p) => p.id === pid).objectId}`)
    return { schema: 1, id, date: today, ...driver, vehicleId: '', status: 'freigegeben', order, route: { provider: 'luftlinie', km: 12.4, minutes: 31, depot, shift: { from: '07:00', to: '15:30' } }, stops: order.map((sid) => stops.find((s) => s.id === sid)), createdAt: `${today}T05:00:00.000Z`, createdBy: 'Büro', updatedAt: `${today}T05:00:00.000Z`, updatedBy: 'Büro' }
  }
  const A = tourFor('mtkarte0000001', ['mwk1', 'mwk2', 'mwk3'], { driverId: 'e2', driverName: 'Markus Huber', driverEmail: 'fahrer@cleanos.at' })
  A.stops[0].status = 'abgeschlossen'
  A.stops[0].finishedAt = `${today}T07:30:00.000Z`
  const B = tourFor('mtkarte0000002', ['mwk4'], { driverId: 'e4', driverName: 'Dragan Jović', driverEmail: 'fahrer2@cleanos.at' })
  SP.seed(Object.fromEntries([A, B].map((t) => [`matten/touren/${y}/${t.id}.json`, t])))

  // Kacheln: Attrappe (ein kleines PNG), gezählt
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const tiles = []
  const withTiles = async (X) => X.ctx.route(/mapsneu\.wien\.gv\.at|tile\.openstreetmap\.org/, (r) => { tiles.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'image/png', body: PNG }) })

  const O = await SP.open(browser, APP, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, hash: '#mw-planung' })
  await withTiles(O)
  await O.page.evaluate(async (d) => { const c = await import('/src/ui/context.js'); c.app.ui.mwTpDate = d; c.renderNow() }, today)
  await O.waitFor(async () => /Markus Huber/.test(await O.text('main')) && /Dragan Jović/.test(await O.text('main')), 20000)
  check('Tourenplanung: Knopf „Karte zeigen“, Karte zuerst ausgeblendet', (await O.page.locator('main [data-action="mw-tp-map"]').count()) === 1 && /Karte zeigen/.test(await O.text('main [data-action="mw-tp-map"]')) && (await O.page.locator('main .mw-tp-mapbox').count()) === 0)
  await O.page.click('main [data-action="mw-tp-map"]')
  await O.page.waitForSelector('main #mw-tp-map .wx-map')
  await O.waitFor(async () => (await O.page.locator('#mw-tp-map .wx-mark').count()) >= 4 && tiles.length > 0, 15000)
  const marks = await O.page.$$eval('#mw-tp-map .wx-mark', (els) => els.map((e) => ({ kind: e.className.replace('wx-mark ', ''), text: e.querySelector('i').textContent, bg: e.querySelector('i').style.background, title: e.title })))
  const hex = (c) => `rgb(${parseInt(c.slice(1, 3), 16)}, ${parseInt(c.slice(3, 5), 16)}, ${parseInt(c.slice(5, 7), 16)})`
  check('Karte: Betriebshof und drei Stopps mit Nummer (der ohne Koordinaten fehlt), zwei Farben, erledigter Stopp markiert', JSON.stringify(marks.map((m) => [m.kind, m.text])) === JSON.stringify([['depot', 'B'], ['stopp', '1'], ['stopp done', '1'], ['stopp', '2']]) && marks[1].bg === hex(TOUR_COLORS[0]) && marks[2].bg === hex(TOUR_COLORS[1]) && marks[3].bg === hex(TOUR_COLORS[1]) && /^1\. Hausverwaltung Probe/.test(marks[2].title) && /Markus Huber/.test(marks[2].title) && /Dragan Jović/.test(marks[1].title) && /^Betriebshof/.test(marks[0].title), JSON.stringify(marks))
  const inside = await O.page.$$eval('#mw-tp-map .wx-mark', (els) => { const box = document.querySelector('#mw-tp-map .wx-map').getBoundingClientRect(); return els.every((e) => { const r = e.querySelector('i').getBoundingClientRect(); return r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom }) })
  check('Ausschnitt passt: alle Punkte liegen in der Karte', inside)
  const drawn = await O.page.evaluate(() => { const cv = document.querySelector('#mw-tp-map canvas'); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let blue = 0; let orange = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 200) continue; if (d[i] < 60 && d[i + 1] > 70 && d[i + 1] < 120 && d[i + 2] > 180) blue++; if (d[i] > 170 && d[i + 1] > 40 && d[i + 1] < 90 && d[i + 2] < 40) orange++ } return { blue, orange } })
  check('Linien beider Touren sind gezeichnet (blau und orange)', drawn.blue > 200 && drawn.orange > 200, JSON.stringify(drawn))
  let t = await O.text('main .mw-tp-mapbox')
  check('Legende je Fahrer mit Zahl der Stopps, Hinweis auf den Stopp ohne Koordinaten, Quelle der Karte', /Markus Huber \(3 Stopps, 2 auf der Karte\)/.test(t) && /Dragan Jović \(1 Stopp\)/.test(t) && /Betriebshof/.test(t) && /Ohne Koordinaten und daher nicht auf der Karte: 3\. Praxis Muster\./.test(t) && /basemap\.at/.test(t) && /Luftlinie/.test(t), t)
  check('Kacheln von basemap.at (Verwaltungsgrundkarte)', tiles.length > 0 && tiles.every((u) => /mapsneu\.wien\.gv\.at\/basemap\/geolandbasemap\/normal\/google3857\/\d+\/\d+\/\d+\.png$/.test(u)), `${tiles.length} ${tiles[0]}`)
  await O.page.screenshot({ path: `${P}/matten-karte.png`, fullPage: true })
  // Zoomen: Knopf „+“ lädt Kacheln der nächsten Stufe, die Punkte bleiben
  const before = tiles.length
  await O.page.click('#mw-tp-map .wx-map-zoom [data-zoom="1"]')
  await O.waitFor(async () => tiles.length > before, 10000)
  check('Zoomen lädt weitere Kacheln, die Karte bleibt beim Neuzeichnen erhalten', tiles.length > before && (await O.page.locator('#mw-tp-map .wx-mark').count()) >= 1)
  await O.page.evaluate(async () => (await import('/src/ui/context.js')).renderNow())
  await wait(300)
  check('Nach dem Neuzeichnen der Ansicht hängt dieselbe Karte wieder im Platzhalter', (await O.page.locator('#mw-tp-map .wx-map').count()) === 1 && (await O.page.locator('#mw-tp-map .wx-mark').count()) >= 1)
  await O.page.click('main [data-action="mw-tp-map"]')
  await wait(300)
  check('„Karte ausblenden“ nimmt die Karte weg', (await O.page.locator('main .mw-tp-mapbox').count()) === 0 && /Karte zeigen/.test(await O.text('main [data-action="mw-tp-map"]')))

  // Handy
  const M = await SP.open(browser, APP, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, mobile: true, hash: '#mw-planung' })
  await withTiles(M)
  await M.page.evaluate(async (d) => { const c = await import('/src/ui/context.js'); c.app.ui.mwTpDate = d; c.app.ui.mwTpMap = true; c.renderNow() }, today)
  await M.page.waitForSelector('main #mw-tp-map .wx-map', { timeout: 20000 })
  await M.waitFor(async () => (await M.page.locator('#mw-tp-map .wx-mark').count()) >= 4, 15000)
  const over = await M.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  const h = await M.page.evaluate(() => document.querySelector('#mw-tp-map .wx-map').getBoundingClientRect().height)
  check('Handy (390 px): Karte 300 px hoch, ohne Querscrollen', over <= 1 && Math.round(h) === 300, `${over} ${h}`)
  await M.page.screenshot({ path: `${P}/matten-karte-handy.png`, fullPage: true })
  check('keine Fehler im Browser', !errors.length, errors.slice(0, 5).join(' | '))
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
await finish(browser, [server], errors)
