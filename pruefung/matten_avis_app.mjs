// Mattenwechsel: Ankündigung an die Kunden vor dem Wechsel (core/matten-avis.js) im SharePoint-Betrieb (Graph-Attrappe).
// Freigegebene Tour für morgen mit drei Stopps: Autohaus (E-Mail aus der Fakturierung, Ankunft 07:20), Hausverwaltung
// (Ankunft 09:05, Fenster 08:00–10:00) und ein Kunde ohne E-Mail. Knopf „Kunden ankündigen“ → Dialog mit Vorauswahl,
// Zeitfenster, Vorschau; einen Kunden abwählen; senden: zwei … eine E-Mail über Microsoft 365 (Text mit Tag, Fenster,
// Liegeplätzen, ohne Fahrernamen und ohne Preise), am Stopp vermerkt, Knopf zeigt den Stand, der abgewählte Kunde ist
// beim nächsten Mal nicht vorgewählt. Entwurf und vergangene Touren haben keinen Knopf. Handy ohne Querscrollen.
// Port 19855.
import { chromium, check, finish, sharepoint, startServer, wait, mondayOf, todayVienna, addDays, P } from './ablauf-lib.mjs'

const APP = 19855
const server = startServer(APP)
await wait(1000)
const browser = await chromium.launch()
const errors = []
try {
  const today = todayVienna()
  const day = addDays(today, 1)
  const y = day.slice(0, 4)
  const { createDemoData } = await import('../src/data/demo.js')
  const { splitData } = await import('../src/storage/data-service.js')
  const { stopsFromJobs } = await import('../src/core/matten-tour.js')
  const SP = sharepoint({ access: { planners: ['office@cleanos.at'] } })
  const demo = createDemoData(mondayOf(today))
  SP.seed(splitData(demo, []))
  const fak = () => SP.json('fakturierung/fakturierung.json')
  const cAuto = fak().customers.find((c) => c.id === 'c-demo2')
  const cHv = fak().customers.find((c) => c.id === 'c-demo1')
  const mat = (qty) => ({ articleId: 'a-fdemo6', name: '85 × 150 cm, grau', size: '85 × 150 cm', color: 'grau', qty, owner: 'wir' })
  const objects = [
    { id: 'ax1', name: 'Autohaus Maxglan', address: 'Autoweg 7, 5020 Salzburg', lat: 47.79, lon: 13.0 },
    { id: 'ax2', name: 'Wohnanlage Lehen', address: 'Lehener Straße 1, 5020 Salzburg', lat: 47.81, lon: 13.03 },
    { id: 'ax3', name: 'Praxis Muster', address: 'Musterplatz 2, 5020 Salzburg', lat: 47.80, lon: 13.05 },
  ]
  const copy = (c) => ({ id: c.id, name: c.name, no: c.customerNo })
  const none = { id: 'c-ohne', name: 'Praxis Muster', no: '29999' }
  const lp = (id, name, objectId, customer, qty, extra = {}) => ({ id, name, objectId, customerId: customer.id, customer, mats: [mat(qty)], active: true, intervalDays: 14, startDate: day, rule: 'rhythmus', ...extra })
  const placements = [lp('mwa1', 'Schauraum', 'ax1', copy(cAuto), 2), lp('mwa2', 'Werkstatt', 'ax1', copy(cAuto), 1), lp('mwa3', 'Stiege 1', 'ax2', copy(cHv), 1, { window: { from: '08:00', to: '10:00' } }), lp('mwa4', 'Wartezimmer', 'ax3', none, 1)]
  const tourFor = (id, date, ids, status, times) => {
    const jobs = ids.map((pid) => ({ key: `${pid}:${date}`, placementId: pid, due: date, status: 'geplant' }))
    const stops = stopsFromJobs({ jobs, placements, objects, date })
    const order = [...new Set(ids.map((pid) => `st-${placements.find((p) => p.id === pid).objectId}`))]
    return { schema: 1, id, date, driverId: 'e2', driverName: 'Markus Huber', driverEmail: 'fahrer@cleanos.at', vehicleId: '', status, order, route: { provider: 'luftlinie', km: 9, minutes: 25, shift: { from: '07:00', to: '15:30' } }, stops: order.map((sid, i) => ({ ...stops.find((s) => s.id === sid), ...(times[i] ? { times: { arrival: times[i] } } : {}) })), createdAt: `${today}T05:00:00.000Z`, createdBy: 'Büro', updatedAt: `${today}T05:00:00.000Z`, updatedBy: 'Büro' }
  }
  const A = tourFor('mtavis00000001', day, ['mwa1', 'mwa2', 'mwa3', 'mwa4'], 'freigegeben', ['07:20', '09:05', ''])
  const E = tourFor('mtavis00000002', day, ['mwa4'], 'entwurf', ['08:00'])
  const V = tourFor('mtavis00000003', addDays(today, -1), ['mwa4'], 'freigegeben', ['08:00'])
  // gestrige Tour abgeschlossen: geplant 08:00, fertig 08:40 (Wien) → Soll-Ist + 40 Minuten, Ende 08:40 statt 09:00
  const yest = addDays(today, -1)
  const utc = (hhmm) => `${yest}T${hhmm}:00.000Z`
  const offset = Math.round((Date.parse(`${yest}T12:00:00Z`) - Date.parse(new Date(`${yest}T12:00:00Z`).toLocaleString('sv-SE', { timeZone: 'Europe/Vienna' }).replace(' ', 'T') + 'Z')) / 36e5) // −1 Winter, −2 Sommer
  const at = (h, m) => utc(`${String(h + offset).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  Object.assign(V.stops[0], { status: 'abgeschlossen', finishedAt: at(8, 40), finishedBy: 'Markus Huber' })
  Object.assign(V, { status: 'abgeschlossen', finishedAt: at(8, 40), route: { ...V.route, end: '09:00' } })
  const pathOf = (t) => `matten/touren/${t.date.slice(0, 4)}/${t.id}.json`
  SP.seed(Object.fromEntries([A, E, V].map((t) => [pathOf(t), t])))
  const fileA = () => SP.json(pathOf(A))
  check('Vorbereitung: Fenster des Kunden am Stopp, E-Mails in der Fakturierung', A.stops[1].window?.from === '08:00' && /@/.test(cAuto.email || cAuto.deliveryNoteEmail || '') && /@/.test(cHv.email || cHv.deliveryNoteEmail || ''), JSON.stringify([A.stops[1].window, cAuto.email, cHv.email]))
  const mailAuto = cAuto.deliveryNoteEmail || cAuto.email
  const mailHv = cHv.deliveryNoteEmail || cHv.email

  const O = await SP.open(browser, APP, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, hash: '#mw-planung' })
  const show = (d) => O.page.evaluate(async (x) => { const c = await import('/src/ui/context.js'); c.app.ui.mwTpDate = x; c.renderNow() }, d)
  await show(day)
  await O.waitFor(async () => (await O.page.locator('main [data-action="mw-tp-avis-open"]').count()) > 0, 20000)
  check('Knopf „Kunden ankündigen“ nur an der freigegebenen Tour, nicht am Entwurf', (await O.page.locator('main [data-action="mw-tp-avis-open"]').count()) === 1 && (await O.page.locator(`main [data-action="mw-tp-avis-open"][data-tour="${A.id}"]`).count()) === 1 && /Kunden ankündigen/.test(await O.text('main [data-action="mw-tp-avis-open"]')))
  await O.page.click('main [data-action="mw-tp-avis-open"]')
  await O.page.waitForSelector('.modal table.mw-tp-avis')
  const rows = () => O.page.$$eval('.modal table.mw-tp-avis tbody tr', (trs) => trs.map((tr) => ({ on: tr.querySelector('input').checked, dis: tr.querySelector('input').disabled, cells: [...tr.children].slice(1).map((td) => td.innerText.replace(/\s+/g, ' ').trim()) })))
  let r = await rows()
  check('Dialog: drei Stopps in Fahrreihenfolge, E-Mail aus der Fakturierung, Zeitfenster, Vorauswahl nur mit E-Mail', r.length === 3 && r[0].on && r[1].on && !r[2].on && r[2].dis && r[0].cells[1] === mailAuto && r[1].cells[1] === mailHv && r[0].cells[2] === '06:30–09:00 Uhr' && r[1].cells[2] === '08:30–10:00 Uhr' && r[2].cells[2] === 'im Laufe des Tages' && /keine E-Mail beim Kunden/.test(r[2].cells[3]), JSON.stringify(r))
  check('Knopf zählt die gewählten Kunden', /Ankündigung senden \(2\)/.test(await O.text('.modal [data-action="mw-tp-avis-send"]')))
  await O.page.click('.modal details.mw-tp-avis-preview summary')
  let t = await O.text('.modal details.mw-tp-avis-preview')
  check('Vorschau: Betreff mit Tag und Objekt, Zeitfenster, Liegeplätze, ohne Fahrernamen und ohne Preise', /Mattenwechsel am \w+, \d+\.\d+\.\d{4} – Autohaus Maxglan/.test(t) && /zwischen 06:30 und 09:00 Uhr/.test(t) && /– Schauraum: 2 Matten/.test(t) && /– Werkstatt: 1 Matte/.test(t) && /Petra Leitner/.test(t) && !/Markus Huber|€|Preis/.test(t), t.slice(0, 600))
  await O.page.screenshot({ path: `${P}/matten-avis-dialog.png` })
  // Hausverwaltung abwählen → nur eine E-Mail
  await O.page.locator('.modal table.mw-tp-avis tbody tr').nth(1).locator('input').uncheck()
  await O.waitFor(async () => /Ankündigung senden \(1\)/.test(await O.text('.modal [data-action="mw-tp-avis-send"]')))
  const n = SP.sent.length
  await O.page.click('.modal [data-action="mw-tp-avis-send"]')
  await O.waitFor(async () => SP.sent.length > n && fileA().stops[0].notice, 20000)
  await O.waitFor(async () => /1 Ankündigung gesendet/.test(await O.text('.modal')), 10000)
  const mail = SP.sent.at(-1)?.message
  const body = mail?.body?.content || ''
  check('Eine E-Mail an das Autohaus über Microsoft 365: Betreff, Zeitfenster, Liegeplätze', SP.sent.length === n + 1 && (mail?.toRecipients || []).map((x) => x.emailAddress.address).join() === mailAuto && /^Mattenwechsel am /.test(mail.subject) && /zwischen 06:30 und 09:00 Uhr/.test(body) && /Schauraum: 2 Matten/.test(body) && !(mail.attachments || []).length && !/Markus Huber|€/.test(body), JSON.stringify({ to: mail?.toRecipients, s: mail?.subject, b: body.slice(0, 300) }))
  const notice = fileA().stops[0].notice
  check('Am Stopp vermerkt (wann, wer, an wen, Zeitfenster); die anderen Stopps ohne Vermerk; Tour bleibt freigegeben', !!notice && notice.by === 'Petra Leitner' && notice.to.join() === mailAuto && notice.window.from === '06:30' && notice.window.to === '09:00' && /T/.test(notice.at) && !fileA().stops[1].notice && !fileA().stops[2].notice && fileA().status === 'freigegeben', JSON.stringify(notice))
  check('Abgewählter Kunde gemerkt („wünscht keine Ankündigung“)', !!(await O.waitFor(async () => JSON.stringify(SP.json('matten/matten.json').settings.noticeOff) === JSON.stringify(['c-demo1']), 15000)), JSON.stringify(SP.json('matten/matten.json').settings.noticeOff))
  r = await rows()
  check('Dialog danach: Autohaus „angekündigt am …“ und nicht mehr vorgewählt, Hausverwaltung „wünscht keine Ankündigung“', !r[0].on && /angekündigt am \d{2}\.\d{2}\.\d{4}/.test(r[0].cells[3]) && /Petra Leitner/.test(r[0].cells[3]) && !r[1].on && !r[1].dis && /wünscht keine Ankündigung/.test(r[1].cells[3]) && /Ankündigung senden \(0\)/.test(await O.text('.modal [data-action="mw-tp-avis-send"]')) && (await O.page.locator('.modal [data-action="mw-tp-avis-send"]').isDisabled()), JSON.stringify(r))
  await O.closeModals()
  await O.waitFor(async () => /Kunden angekündigt \(1 von 3\)/.test(await O.text('main')), 10000)
  check('Knopf an der Tour zeigt den Stand „Kunden angekündigt (1 von 3)“', /Kunden angekündigt \(1 von 3\)/.test(await O.text('main [data-action="mw-tp-avis-open"]')))
  // doch ankündigen: wieder anhaken → gesendet, aus der Liste genommen
  await O.page.click('main [data-action="mw-tp-avis-open"]')
  await O.page.waitForSelector('.modal table.mw-tp-avis')
  await O.page.locator('.modal table.mw-tp-avis tbody tr').nth(1).locator('input').check()
  const n2 = SP.sent.length
  await O.page.click('.modal [data-action="mw-tp-avis-send"]')
  await O.waitFor(async () => SP.sent.length > n2 && fileA().stops[1].notice, 20000)
  const body2 = SP.sent.at(-1)?.message?.body?.content || ''
  check('Wieder angehakt: E-Mail an die Hausverwaltung mit dem Fenster des Kunden (08:30–10:00), Merker gelöscht', (SP.sent.at(-1)?.message?.toRecipients || [])[0]?.emailAddress.address === mailHv && /zwischen 08:30 und 10:00 Uhr/.test(body2) && !!(await O.waitFor(async () => !SP.json('matten/matten.json').settings.noticeOff, 15000)), body2.slice(0, 300))
  await O.closeModals()
  // vergangene Tour: kein Knopf
  await show(addDays(today, -1))
  await O.waitFor(async () => /Markus Huber/.test(await O.text('main .mw-tp-tours')), 15000)
  check('Tour von gestern: kein Knopf zum Ankündigen', (await O.page.locator('main [data-action="mw-tp-avis-open"]').count()) === 0)
  t = await O.text('main .mw-tp-tours')
  check('Soll-Ist an der abgeschlossenen Tour: Stopp „fertig 08:40 · +40 Min.“, Tour mit Schnitt und Ende', /fertig 08:40 · \+40 Min\./.test(t) && /Soll-Ist: 0 von 1 Stopp pünktlich, 1 später · im Schnitt \+40 Min\. · Ende 08:40 statt 09:00 Uhr/.test(t), t.slice(0, 500))
  await O.page.screenshot({ path: `${P}/matten-sollist.png` })

  // Handy
  const M = await SP.open(browser, APP, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, mobile: true, hash: '#mw-planung' })
  await M.page.evaluate(async (x) => { const c = await import('/src/ui/context.js'); c.app.ui.mwTpDate = x; c.renderNow() }, day)
  await M.waitFor(async () => (await M.page.locator('main [data-action="mw-tp-avis-open"]').count()) > 0, 20000)
  await M.page.locator('main [data-action="mw-tp-avis-open"]').tap()
  await M.page.waitForSelector('.modal table.mw-tp-avis')
  const over = await M.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('Handy (390 px): Dialog ohne Querscrollen der Seite', over <= 1, String(over))
  await M.page.screenshot({ path: `${P}/matten-avis-handy.png` })
  check('keine Fehler im Browser', !errors.length, errors.slice(0, 5).join(' | '))
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
await finish(browser, [server], errors)
