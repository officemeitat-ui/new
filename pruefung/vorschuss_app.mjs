// Lohnvorschuss im Büro: App im SharePoint-Betrieb (Graph-Attrappe) mit den Demo-Daten und einer Austritts-Checkliste.
//  1. Überstunden & Auszahlung → Export ▾ → „Vorschüsse“ → neuer Vorschuss: 2500 €, erste Rate 1000 €, dann 500 €;
//     „Raten berechnen“ → 4 Raten; falsche Summe wird abgelehnt; speichern → Vereinbarung als PDF, in lohn/zeitkonto.json.
//  2. Liste: offen und nächste Rate.
//  3. Export Lohnprogramm: Kennzahl „Rückzahlung Vorschuss“ mit 1000 € im ersten Monat, mit Lohnart in der Vorschau.
//  4. Eintritt & Austritt: die Austritts-Checkliste zeigt den offenen Rest für die Endabrechnung.
//  5. Erledigt (zweistufig) und Rechte: die Objektleitung sieht keine Vorschüsse.
//  6. Handy 390 px: Dialog ohne Querscrollen.
// Port 19874.
import { readFileSync } from 'node:fs'
import { chromium, check, finish, sharepoint, startServer, wait, mondayOf, todayVienna, addDays } from './ablauf-lib.mjs'

const PORT = 19874
const server = startServer(PORT)
const browser = await chromium.launch()
const errors = []
try {
  const today = todayVienna()
  const month = today.slice(0, 7)
  const { createDemoData } = await import('../src/data/demo.js')
  const { splitData } = await import('../src/storage/data-service.js')
  const demo = createDemoData(mondayOf(today))
  const docs = splitData(demo, [])
  const emp = demo.employees.find((e) => !e.exitDate)
  // Austritt der Person in drei Wochen (Liste ohne Aufgaben außer Zeitkonto)
  const exit = addDays(today, 21)
  docs['eintritt/eintritt.json'] = { lists: [{ id: 'l-aus', kind: 'austritt', empId: emp.id, applicantId: '', date: exit, tasks: [{ id: 'a-zeitkonto', type: 'zeitkonto', title: 'Zeitkonto, Resturlaub und Überstunden prüfen', offset: -7, due: addDays(exit, -7), note: '', data: {}, done: null }], createdAt: '', createdBy: '', closedAt: '' }], templates: {}, settings: {} }
  const SP = sharepoint({ access: { planners: ['office@cleanos.at'], members: { objektleitung: ['ol@cleanos.at'] } } })
  SP.seed(docs)
  const O = await SP.open(browser, PORT, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, hash: '#overtime' })
  const advances = () => SP.json('lohn/zeitkonto.json')?.advances || []
  const modal = () => O.text('.modal')

  // ------------------------------------------------ 1. Neuer Vorschuss
  await O.page.waitForSelector('main')
  const viaMenu = await O.page.evaluate(() => !!document.querySelector('main [data-action="vs-open"]'))
  check('Menü „Export“ in Überstunden & Auszahlung hat „Vorschüsse“', viaMenu)
  await O.act('vs-open')
  await O.page.waitForSelector('.modal [data-action="vs-new"]')
  check('Vorschüsse: Erklärung, noch keiner', /Noch kein Vorschuss/.test(await modal()) && /Export Lohnprogramm/.test(await modal()))
  await O.page.click('.modal [data-action="vs-new"]')
  await O.page.waitForSelector('.modal #vs-emp')
  await O.page.selectOption('#vs-emp', emp.id)
  await O.page.fill('#vs-amount', '2500')
  await O.page.fill('#vs-first', month)
  await O.page.fill('#vs-firstrate', '1000')
  await O.page.fill('#vs-rate', '500')
  await O.page.click('.modal [data-action="vs-plan"]')
  await O.page.waitForSelector('.modal #vs-i-a-3')
  check('Raten berechnet: 1000, 500, 500, 500', (await O.page.$$eval('.modal input[id^="vs-i-a-"]', (els) => els.map((e) => e.value))).join() === '1000,500,500,500', await modal())
  // Summe falsch → abgelehnt
  await O.page.fill('#vs-i-a-3', '400')
  await O.page.click('.modal [data-action="vs-save"]')
  check('Falsche Summe wird abgelehnt', !!(await O.toastWait(/Die Raten ergeben 2400,00 €, der Vorschuss ist 2500,00 €/)), await O.text('#toast'))
  await O.page.fill('#vs-i-a-3', '500')
  await O.page.fill('#vs-place', 'Hallein')
  const [dl] = await Promise.all([O.page.waitForEvent('download'), O.page.click('.modal [data-action="vs-save"]')])
  const pdf = readFileSync(await dl.path())
  check('Vereinbarung als PDF heruntergeladen', /^Vorschuss_\d{4}-\d{2}-\d{2}_.+\.pdf$/.test(dl.suggestedFilename()) && pdf.subarray(0, 4).toString() === '%PDF', dl.suggestedFilename())
  const saved = await O.waitFor(() => advances().find((a) => a.empId === emp.id), 15000)
  check('In lohn/zeitkonto.json: Betrag, Raten, kein Bankkonto', !!saved && saved.amount === 2500 && saved.installments.length === 4 && saved.installments[0].month === month && !('iban' in saved), JSON.stringify(saved))

  // ------------------------------------------------ 2. Liste
  await O.page.waitForSelector('.modal [data-action="vs-pdf"]')
  check('Liste: offen € 1.500,00 und nächste Rate € 500,00', /€\s1\.500,00/.test(await modal()) && /: €\s500,00/.test(await modal()), await modal())
  await O.closeModals()

  // ------------------------------------------------ 3. Export Lohnprogramm
  await O.act('pe-open', { month })
  await O.page.waitForSelector('.modal #pe-wt-vorschuss')
  check('Export: Kennzahl „Rückzahlung Vorschuss“ mit 1000 € im Monat', /Rückzahlung Vorschuss/.test(await modal()) && /1000 €/.test(await modal()), (await modal()).slice(0, 600))
  await O.page.fill('#pe-wt-vorschuss', '9123')
  await O.page.click('.modal [data-action="pe-refresh"]')
  await O.page.waitForFunction(() => /9123/.test(document.querySelector('.modal .pe-preview')?.textContent || ''))
  const prev = await O.text('.modal .pe-preview')
  check('Vorschau: Zeile mit Lohnart 9123 und Betrag 1000', prev.split('\n').some((l) => l.includes(';9123;') && /;1000(,00)?;/.test(l)), prev)
  await O.closeModals()

  // ------------------------------------------------ 4. Austritt
  await O.view('eintritt')
  await O.act('bew-kind', { v: 'austritt' }).catch(() => {})
  await O.act('bew-list-open', { id: 'l-aus' })
  await O.page.waitForSelector('.modal')
  const rest = saved.installments.filter((x) => x.month > exit.slice(0, 7)).reduce((s, x) => s + x.amount, 0)
  const restText = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(rest).replace(/\s/g, ' ')
  check(`Austritt: offener Vorschuss ${restText} für die Endabrechnung`, !!(await O.waitFor(async () => (await modal()).replace(/\s/g, ' ').includes(`Offener Lohnvorschuss (Raten nach dem Austrittsmonat): ${restText}`), 10000)), (await modal()).slice(0, 800))
  await O.closeModals()

  // ------------------------------------------------ 5. Erledigt, Rechte
  await O.act('vs-open')
  await O.page.waitForSelector('.modal [data-action="vs-done"]')
  await O.page.click('.modal [data-action="vs-done"]')
  check('Erledigt fragt nach', /Wirklich erledigt\?/.test(await modal()))
  await O.page.click('.modal [data-action="vs-done"]')
  check('Als erledigt gespeichert', !!(await O.waitFor(() => advances().find((a) => a.id === saved.id)?.done?.date === today, 15000)))
  check('Liste: „erledigt“', /erledigt/.test(await modal()))
  await O.page.setViewportSize({ width: 390, height: 844 })
  await O.act('vs-new')
  await O.page.waitForSelector('.modal #vs-emp')
  check('Handy 390 px: Dialog ohne Querscrollen', await O.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await O.closeModals()

  const L = await SP.open(browser, PORT, { email: 'ol@cleanos.at', name: 'Olga Leitung', errors })
  await L.act('vs-open').catch(() => {})
  check('Objektleitung: Hinweis statt Dialog', !!(await L.toastWait(/Vorschüsse sieht nur, wer Löhne sehen darf/)) && !/Vorschüsse/.test(await L.text('#modal-root')), await L.text('#toast'))
  check('Objektleitung: keine Vorschüsse im Speicher', await L.page.evaluate(async () => !((await import('/src/ui/context.js')).app.data.advances || []).length))
  await wait(100)
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
await finish(browser, [server], errors)
