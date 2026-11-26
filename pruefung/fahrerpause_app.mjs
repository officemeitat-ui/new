// Ruhepause der Fahrer im Tourvorschlag (§ 11 AZG) im SharePoint-Betrieb (Graph-Attrappe) mit den Demo-Daten und
// vier Liegeplätzen an einem Objekt.
//  1. Tourenplanung → Mehr → „Betriebshof und Arbeitszeit“: Ruhepause 30 Minuten, spätestens nach 1 Stunde (für die
//     Prüfung kurz, damit schon eine kleine Tour eine Pause bekommt) → in matten.json unter settings.routing.
//  2. Einsätze planen, „Vorschlag erzeugen“: Tour mit Pause nach einem Stopp; an der Tour „30 Min. Pause“, am Stopp
//     „danach Pause 08:xx–08:xx“; spätere Stopps kommen 30 Minuten später.
//  3. Freigeben, Fahreransicht (Büro sieht alle Touren): Zeile „Pause … Uhr (30 Min.)“ in der Liste der Stopps.
//  4. Ruhepause 0: nach „Fahrzeiten neu rechnen“ bzw. neuem Vorschlag keine Pause.
// Port 19875.
import { chromium, check, finish, sharepoint, startServer, wait, mondayOf, todayVienna, addDays } from './ablauf-lib.mjs'

const APP = 19875
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
  // Liegeplätze an zwei Objekten wie in matten_stammtouren_app (fällig ab heute)
  const cust = { id: 'c-fh', name: 'Flughafen Beispiel', no: '30001' }
  const mat = { articleId: m.placements[0].mats[0].articleId, name: m.placements[0].mats[0].name, size: m.placements[0].mats[0].size, color: m.placements[0].mats[0].color, qty: 1, owner: 'wir' }
  const pl = (id, name, objectId, lat, lon) => ({ id, name, objectId, customerId: cust.id, customer: cust, mats: [mat], active: true, intervalDays: 28, startDate: today, rule: 'ab-ist', lat, lon, workMinutes: 25, createdAt: '', createdBy: '' })
  m.placements.push(pl('fh1', 'GAC – Container SIKO', 'o1', 47.79, 13.0), pl('fh2', 'GAC – Schuhkontrolle', 'o1', 47.79, 13.0), pl('fh3', 'Werkstatt – Tor', 'o2', 47.70, 13.1), pl('fh4', 'Terminal – Windfang', 'o2', 47.70, 13.1))
  const SP = sharepoint({ access: { planners: ['office@cleanos.at'] } })
  SP.seed(docs)
  const O = await SP.open(browser, APP, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, hash: '#mw-planung' })
  const matten = () => SP.json('matten/matten.json') || {}
  const toursOf = () => [...SP.drive.items.keys()].filter((p) => p.includes('matten/touren/') && p.endsWith('.json')).map((p) => SP.json(p.replace(/^.*?matten\/touren\//, 'matten/touren/'))).filter((t) => t?.date === day)

  // ------------------------------------------------ 1. Einstellung
  await O.page.waitForSelector('main [data-action="mw-tp-propose"]')
  await O.act('mw-tp-depot-open')
  await O.page.waitForSelector('.modal #mw-tp-d-pause')
  check('Dialog: Ruhepause 30 Minuten, nach 6 Stunden (Vorgabe), Hinweis § 11 AZG', (await O.page.inputValue('#mw-tp-d-pause')) === '30' && (await O.page.inputValue('#mw-tp-d-pause-after')) === '6' && /§ 11 AZG/.test(await O.text('.modal')))
  await O.page.fill('#mw-tp-d-pause-after', '1')
  await O.page.click('.modal [data-action="mw-tp-depot-save"]')
  check('In matten.json: settings.routing.pauseAfter = 60, Minuten als Vorgabe nicht gespeichert', !!(await O.waitFor(() => matten().settings?.routing?.pauseAfter === 60 && !('pauseMinutes' in (matten().settings?.routing || {})), 15000)), JSON.stringify(matten().settings?.routing))

  // ------------------------------------------------ 2. Vorschlag
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
  await O.toastWait(/Vorschlag: \d+ Touren?/, 30000)
  const tours = await O.waitFor(() => (toursOf().length ? toursOf() : null), 15000)
  const withPause = (tours || []).find((t) => t.route?.pause)
  check('Tour mit Pause (länger als 1 Stunde)', !!withPause, JSON.stringify((tours || []).map((t) => [t.route?.start, t.route?.end, t.route?.pause])))
  if (withPause) {
    const p = withPause.route.pause
    const i = withPause.stops.findIndex((s) => s.id === p.stopId)
    const st = withPause.stops[i]
    check('Pause am Stopp: ab Abfahrt, 30 Minuten', st.times.pause.from === st.times.departure && p.minutes === 30)
    const nxt = withPause.stops[i + 1]
    if (nxt) check('Nächster Stopp erst nach der Pause', nxt.times.arrival >= p.to, `${nxt.times.arrival} / ${p.to}`)
    const main = await O.text('main')
    check('Tourenplanung: „30 Min. Pause“ und „danach Pause …“', main.includes('30 Min. Pause') && main.includes(`danach Pause ${p.from}–${p.to}`), main.slice(0, 400))

    // ------------------------------------------------ 3. Fahreransicht
    await O.page.click(`main [data-action="mw-tp-release"][data-tour="${withPause.id}"]`)
    await O.waitFor(() => toursOf().find((t) => t.id === withPause.id)?.status === 'freigegeben', 20000)
    await O.view('mw-touren')
    await O.act('mwf-open', { tour: withPause.id }).catch(() => {})
    const item = await O.waitFor(async () => (await O.page.locator('.mwf-pause-item').count()) > 0, 10000)
    check('Fahreransicht: Zeile „Pause … Uhr (30 Min.)“', !!item && (await O.text('.mwf-pause-item')).includes(`Pause ${p.from}–${p.to} Uhr (30 Min.)`), await O.text('main'))
  }

  // ------------------------------------------------ 4. Ohne Pause
  await O.view('mw-planung')
  await O.act('mw-tp-depot-open')
  await O.page.waitForSelector('.modal #mw-tp-d-pause')
  await O.page.fill('#mw-tp-d-pause', '0')
  await O.page.click('.modal [data-action="mw-tp-depot-save"]')
  await O.waitFor(() => matten().settings?.routing?.pauseMinutes === 0, 15000)
  // Entwürfe neu vorschlagen (der freigegebene bleibt)
  await O.page.click('main [data-action="mw-tp-propose"]')
  await wait(800)
  const confirmBtn = await O.page.locator('main [data-action="mw-tp-propose"]').count()
  if (confirmBtn && /Wirklich|ersetzen/.test(await O.text('main [data-action="mw-tp-propose"]'))) await O.page.click('main [data-action="mw-tp-propose"]')
  await O.toastWait(/Vorschlag|Keine/, 30000)
  const drafts = await O.waitFor(() => toursOf().filter((t) => t.status === 'entwurf'), 15000)
  check('Ruhepause 0: neue Entwürfe ohne Pause', (drafts || []).every((t) => !t.route?.pause && t.stops.every((s) => !s.times?.pause)), JSON.stringify((drafts || []).map((t) => t.route?.pause)))
  check('Handy 390 px: ohne Querscrollen', await (async () => { await O.page.setViewportSize({ width: 390, height: 844 }); await wait(300); return O.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1) })())
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
await finish(browser, [server], errors)
