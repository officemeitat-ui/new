// Zulagen je Tätigkeit im SharePoint-Betrieb (Graph-Attrappe) mit den Demo-Daten:
//  1. Überstunden & Auszahlung → Export → „Zulagen je Tätigkeit“: noch keine; neue Zulage ohne Angaben → Hinweis;
//     „Erschwerniszulage Glas“, Lohnart 310, je Stunde 1,20 €, Stichwort „Glas“ → gespeichert in lohn/zeitkonto.json.
//  2. Zweite Zulage je Einsatz für gewählte Leistungen über die Suche, ohne Lohnart → Hinweis.
//  3. Vorschau: Personen mit Zulagen im Monat; Export Lohnprogramm: Zeile mit Lohnart 310, Hinweis „ohne Lohnart“.
//  4. Handy 390 px: Dialog ohne Querscrollen.
// Port 19880.
import { chromium, check, finish, sharepoint, startServer, wait, mondayOf, todayVienna } from './ablauf-lib.mjs'

const APP = 19880
const server = startServer(APP)
await wait(800)
const browser = await chromium.launch()
const errors = []
try {
  const today = todayVienna()
  const month = today.slice(0, 7)
  const { createDemoData } = await import('../src/data/demo.js')
  const { splitData } = await import('../src/storage/data-service.js')
  const docs = splitData(createDemoData(mondayOf(today)), [])
  const SP = sharepoint({ access: { planners: ['office@cleanos.at'] } })
  SP.seed(docs)
  const O = await SP.open(browser, APP, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, hash: '#overtime' })
  const zul = () => SP.json('lohn/zeitkonto.json')?.allowances || []
  const modal = () => O.text('.modal')

  // ------------------------------------------------ 1. Erste Zulage
  await O.page.waitForSelector('main')
  // Einteilung: eine Person auf alle Glas- und Grundreinigungs-Einsätze des Monats (die Demo-Daten haben keine Wochenpläne)
  const empName = await O.page.evaluate(async (m) => {
    const c = await import('/src/ui/context.js')
    const ot = await import('/src/ui/views/overtime.js')
    const emp = c.app.data.employees.find((e) => !e.exitDate)
    for (const i of ot.payroll(m).range.instances.filter((x) => x.date.startsWith(m) && x.status !== 'cancelled' && /glas|grundreinigung/i.test(x.label))) c.app.data.assignments[i.key] = [{ employeeId: emp.id }]
    c.persist()
    c.renderNow()
    return emp.name
  }, month)
  check('Menü „Export“ hat „Zulagen je Tätigkeit“', await O.page.evaluate(() => !!document.querySelector('main [data-action="zul-open"]')))
  await O.act('zul-open', { month })
  await O.page.waitForSelector('.modal [data-action="zul-edit"]')
  check('Erklärung, noch keine Zulage', /Noch keine Zulage/.test(await modal()) && /Kollektivvertrag/.test(await modal()))
  await O.page.click('.modal .actions [data-action="zul-edit"]')
  await O.page.waitForSelector('.modal #zul-name')
  await O.page.click('.modal [data-action="zul-save"]')
  check('Ohne Angaben: Hinweis', !!(await O.toastWait(/Namen der Zulage/)))
  await O.page.fill('#zul-name', 'Erschwerniszulage Glas')
  await O.page.fill('#zul-wt', '310')
  await O.page.fill('#zul-rate', '1,20')
  await O.page.click('.modal [data-action="zul-save"]')
  check('Ohne „wofür“: Hinweis', !!(await O.toastWait(/wofür die Zulage gilt/)))
  await O.page.fill('#zul-kw', 'Glas')
  await O.page.click('.modal [data-action="zul-save"]')
  check('Gespeichert (Hinweis)', !!(await O.toastWait(/Zulage „Erschwerniszulage Glas“ gespeichert/)))
  const z1 = await O.waitFor(() => zul().find((z) => z.name === 'Erschwerniszulage Glas'), 15000)
  check('In lohn/zeitkonto.json: Lohnart, je Stunde, 1,2 €, Stichwort', !!z1 && z1.wageType === '310' && z1.mode === 'stunde' && z1.rate === 1.2 && z1.keyword === 'Glas', JSON.stringify(z1))

  // ------------------------------------------------ 2. Zweite Zulage je Einsatz, Leistungen über die Suche
  await O.page.waitForSelector('.modal .actions [data-action="zul-edit"]')
  await O.page.click('.modal .actions [data-action="zul-edit"]')
  await O.page.waitForSelector('.modal #zul-name')
  await O.page.fill('#zul-name', 'Schmutzzulage Grundreinigung')
  await O.page.selectOption('#zul-mode', 'einsatz')
  await O.page.fill('#zul-rate', '5')
  await O.page.click('.modal details:has(#zul-q) summary')
  await O.page.fill('#zul-q', 'Grundreinigung')
  await O.page.waitForFunction(() => {
    const boxes = [...document.querySelectorAll('.modal input[name="zul-task"]')]
    return boxes.length >= 2 && boxes.every((x) => /Grundreinigung/.test(x.closest('label').textContent))
  })
  for (const box of await O.page.$$('.modal input[name="zul-task"]')) await box.check()
  await O.page.click('.modal [data-action="zul-save"]')
  check('Ohne Lohnart: gespeichert mit Hinweis', !!(await O.toastWait(/Ohne Lohnart kommt sie nicht in den Export/)))
  const z2 = await O.waitFor(() => zul().find((z) => z.name === 'Schmutzzulage Grundreinigung'), 15000)
  check('Zweite Zulage: je Einsatz, gewählte Leistungen', !!z2 && z2.mode === 'einsatz' && z2.taskIds.length >= 2 && !z2.wageType, JSON.stringify(z2))

  // ------------------------------------------------ 3. Vorschau und Export
  await O.page.waitForSelector('.modal .actions [data-action="zul-edit"]')
  const prev = await modal()
  const glasInPlan = /Erschwerniszulage Glas: [\d,]+ h/.test(prev)
  const schmutzInPlan = /Schmutzzulage Grundreinigung: \d+ Eins/.test(prev)
  check(`Vorschau: ${empName} mit beiden Zulagen im Monat`, /laut Plan/.test(prev) && glasInPlan && schmutzInPlan && prev.includes(empName), prev.slice(-500))
  await O.page.setViewportSize({ width: 390, height: 844 })
  await wait(300)
  check('Handy 390 px: Dialog ohne Querscrollen', await O.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await O.page.setViewportSize({ width: 1400, height: 950 })
  await O.closeModals()
  await O.act('pe-open', { month })
  await O.page.waitForSelector('.modal .pe-preview')
  if (glasInPlan) check('Export: Zeile mit Lohnart 310 und Name der Zulage', /;310;/.test(await O.text('.modal .pe-preview')) && /Erschwerniszulage Glas/.test(await O.text('.modal .pe-preview')), await O.text('.modal .pe-preview'))
  if (schmutzInPlan) check('Export: Hinweis „Zulagen ohne Lohnart“', /Zulagen ohne Lohnart.*Schmutzzulage Grundreinigung/.test(await modal()))
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
await finish(browser, [server], errors)
