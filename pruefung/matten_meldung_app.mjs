// Meldungen der Fahrer aus dem Stopp im SharePoint-Betrieb (Graph-Attrappe) mit den Demo-Daten und Liegeplätzen an zwei
// Objekten (wie fahrerpause_app).
//  1. Büro plant und gibt eine Tour frei; in „Matten-Touren“ am Stopp „Problem melden“: Matte beschädigt am Liegeplatz,
//     Text → an der Tour gespeichert (stops[].reports), am Stopp sichtbar. Zweite Meldung: Beschwerde des Kunden.
//  2. Matten-Übersicht: „Meldungen der Fahrer (2 offen)“; „Zu erledigen“ zeigt sie.
//  3. „Als Reklamation“: Reklamation mit Objekt, Quelle „Mattenwechsel (Fahrer)“, Art „Schaden“, Text der Meldung →
//     gespeichert mit ref; die Meldung ist nicht mehr offen.
//  4. „Erledigt“ für die zweite (matten.json reportsHandled), Liste leer.
//  5. Handy 390 px: Dialog „Problem melden“ ohne Querscrollen.
// Port 19876.
import { chromium, check, finish, sharepoint, startServer, wait, mondayOf, todayVienna, addDays } from './ablauf-lib.mjs'

const APP = 19876
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
  m.placements.push(pl('fh1', 'GAC – Container SIKO', 'o1', 47.79, 13.0), pl('fh2', 'GAC – Schuhkontrolle', 'o1', 47.79, 13.0))
  const SP = sharepoint({ access: { planners: ['office@cleanos.at'] } })
  SP.seed(docs)
  const O = await SP.open(browser, APP, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, hash: '#mw-planung' })
  const toursOf = () => [...SP.drive.items.keys()].filter((p) => p.includes('matten/touren/') && p.endsWith('.json')).map((p) => SP.json(p.replace(/^.*?matten\/touren\//, 'matten/touren/'))).filter((t) => t?.date === day)
  const modal = () => O.text('.modal')

  // ------------------------------------------------ 1. Tour planen, freigeben, melden
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
  const tour = (await O.waitFor(() => toursOf().find((t) => t.stops.some((s) => s.items.some((i) => i.placementId === 'fh2'))), 15000)) || null
  check('Tour mit dem Flughafen im Vorschlag', !!tour)
  const stop = tour.stops.find((s) => s.items.some((i) => i.placementId === 'fh2'))
  await O.page.click(`main [data-action="mw-tp-release"][data-tour="${tour.id}"]`)
  await O.waitFor(() => toursOf().find((t) => t.id === tour.id)?.status === 'freigegeben', 20000)
  await O.view('mw-touren')
  await O.act('mwf-open', { tour: tour.id })
  await O.act('mwf-stop', { tour: tour.id, stop: stop.id })
  await O.page.waitForSelector('main [data-action="mwf-report-open"]')
  check('Stopp: „Meldungen ans Büro“ mit „Problem melden“', /Meldungen ans Büro/.test(await O.text('main')))
  await O.page.click('main [data-action="mwf-report-open"]')
  await O.page.waitForSelector('.modal #mwf-rep-text')
  await O.page.click('.modal [data-action="mwf-report"]')
  check('Ohne Auswahl: Hinweis', !!(await O.toastWait(/Bitte wählen, was passiert ist/)))
  await O.page.check('.modal input[name="mwf-rep-kind"][value="schaden"]')
  await O.page.selectOption('#mwf-rep-pl', 'fh2')
  await O.page.fill('#mwf-rep-text', 'Rand eingerissen, Stolpergefahr')
  await O.page.click('.modal [data-action="mwf-report"]')
  check('Gespeichert (Hinweis)', !!(await O.toastWait(/Meldung ans Büro gespeichert/)))
  const saved = await O.waitFor(() => toursOf().find((t) => t.id === tour.id)?.stops.find((s) => s.id === stop.id)?.reports?.[0], 20000)
  check('An der Tour: Art, Liegeplatz, Text, wer', !!saved && saved.kind === 'schaden' && saved.placementId === 'fh2' && saved.placementName === 'GAC – Schuhkontrolle' && saved.text.startsWith('Rand') && !!saved.by, JSON.stringify(saved))
  check('Am Stopp sichtbar', /Matte beschädigt/.test(await O.text('main')) && /Rand eingerissen/.test(await O.text('main')))
  await O.page.click('main [data-action="mwf-report-open"]')
  await O.page.waitForSelector('.modal #mwf-rep-text')
  await O.page.check('.modal input[name="mwf-rep-kind"][value="kunde"]')
  await O.page.fill('#mwf-rep-text', 'Kunde möchte eine größere Matte im Windfang')
  await wait(50)
  // Handy (gleich nach dem Tippen: der Dialog wird neu gezeichnet, der Text bleibt): Dialog ohne Querscrollen
  await O.page.setViewportSize({ width: 390, height: 844 })
  await wait(200)
  check('Handy 390 px: „Problem melden“ ohne Querscrollen', await O.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await wait(400)
  check('Text nach dem Neuzeichnen noch da', (await O.page.inputValue('#mwf-rep-text')).startsWith('Kunde möchte'))
  await O.page.setViewportSize({ width: 1400, height: 950 })
  await O.page.click('.modal [data-action="mwf-report"]')
  await O.waitFor(() => (toursOf().find((t) => t.id === tour.id)?.stops.find((s) => s.id === stop.id)?.reports || []).length === 2, 20000)
  const reports = toursOf().find((t) => t.id === tour.id).stops.find((s) => s.id === stop.id).reports

  // ------------------------------------------------ 2. Übersicht, Zu erledigen
  await O.view('mw-uebersicht')
  const ov = await O.waitFor(async () => /Meldungen der Fahrer \(2 offen\)/.test(await O.text('main')), 15000)
  check('Matten-Übersicht: „Meldungen der Fahrer (2 offen)“', !!ov, (await O.text('main')).slice(0, 300))
  await O.act('open-todo')
  check('„Zu erledigen“: Meldungen der Fahrer (2)', !!(await O.waitFor(async () => /Meldungen der Fahrer \(2\)/.test(await O.text('#modal-root')), 15000)))
  await O.closeModals()

  // ------------------------------------------------ 3. Als Reklamation
  await O.page.click(`main [data-action="mwu-rep-complaint"][data-id="${reports[0].id}"]`)
  await O.page.waitForSelector('.modal #cp-text')
  check('Reklamation vorbefüllt: Text, Quelle, Art, Objekt', (await O.page.inputValue('#cp-text')).startsWith('Matte beschädigt (GAC – Schuhkontrolle): Rand eingerissen') && (await O.page.inputValue('#cp-source')) === 'Mattenwechsel (Fahrer)' && (await O.page.inputValue('#cp-kind')) === 'Schaden' && (await O.page.inputValue('#cp-obj')) === stop.objectId, await O.page.inputValue('#cp-text'))
  await O.page.click('.modal [data-action="complaint-save"]')
  const rk = await O.waitFor(() => (SP.json('reklamationen/reklamationen.json')?.items || []).find((c) => c.ref === `mw-report:${reports[0].id}`), 15000)
  check('Reklamation gespeichert mit Verweis auf die Meldung', !!rk && rk.source === 'Mattenwechsel (Fahrer)' && rk.kind === 'Schaden', JSON.stringify(rk))
  await O.view('mw-uebersicht')
  check('Übersicht: nur noch 1 offen', !!(await O.waitFor(async () => /Meldungen der Fahrer \(1 offen\)/.test(await O.text('main')), 15000)))

  // ------------------------------------------------ 4. Erledigt
  await O.page.click(`main [data-action="mwu-rep-done"][data-id="${reports[1].id}"]`)
  check('Erledigt in matten.json', !!(await O.waitFor(() => SP.json('matten/matten.json')?.reportsHandled?.[reports[1].id]?.state === 'erledigt', 15000)))
  check('Übersicht: keine offenen Meldungen mehr', !/Meldungen der Fahrer \(/.test(await O.text('main')))
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
await finish(browser, [server], errors)
