// Geräte & Maschinen aus Excel einfügen und Formulare am Handy anlegen: App im SharePoint-Betrieb (Attrappe).
//  1. Geräte: Tabelle einfügen, Prüfen (Vorschau mit erkannter Art), anlegen; Inventarnummern fortlaufend, Prüfintervalle
//     von der Art; zweimal eingefügt legt nichts doppelt an.
//  2. Unterweisung am Handy: „Vereinbarung Diensthandy“ anlegen → Art „Formular“, Pflicht mit „Diensthandy“, ohne Fragen.
// Port 19867.
import { chromium, check, finish, sharepoint, startServer, mondayOf, todayVienna } from './ablauf-lib.mjs'

const server = startServer(19867)
const browser = await chromium.launch()
const errors = []
try {
  const { createDemoData } = await import('../src/data/demo.js')
  const { splitData } = await import('../src/storage/data-service.js')
  const SP = sharepoint({ access: { planners: ['office@cleanos.at'] } })
  SP.seed(splitData(createDemoData(mondayOf(todayVienna())), []))
  const O = await SP.open(browser, 19867, { email: 'office@cleanos.at', name: 'Petra Leitner', errors })
  const geraete = () => SP.json('geraete/geraete.json')?.items || []
  const before = geraete().length
  const TABLE = 'Bezeichnung\tArt\tHersteller\tModell\tStandort\nHochdruckreiniger Kärcher HD 5/15\t\tKärcher\tHD 5/15\t\nEinscheibenmaschine Nanodisc 43 EVO\t\t\tNanodisc 43 EVO\t\nKaffeemaschine WMF\tSonstiges Gerät\tWMF\t\tBüro'

  // ------------------------------------------------ 1. Geräte
  await O.view('geraete')
  await O.act('gr-import-open')
  await O.page.waitForSelector('.modal #gr-imp-text')
  await O.page.fill('#gr-imp-text', TABLE)
  await O.page.click('.modal [data-action="gr-import-check"]')
  await O.page.waitForSelector('.modal [data-action="gr-import-save"]')
  const prev = await O.text('.modal')
  check('Vorschau: drei Geräte, Art erkannt (Hochdruckreiniger, Einscheibenmaschine)', /3 Geräte anlegen/.test(prev) && /Hochdruckreiniger/.test(prev) && /Einscheibenmaschine/.test(prev), prev.slice(0, 300))
  await O.page.click('.modal [data-action="gr-import-save"]')
  check('Angelegt', !!(await O.toastWait(/3 Geräte angelegt/)), await O.text('#toast'))
  const neu = await O.waitFor(() => (geraete().length === before + 3 ? geraete().slice(-3) : null), 15000)
  check('In SharePoint: Inventarnummern fortlaufend, Art und Prüfintervalle, Standort, Verlauf „aus Excel eingefügt“', !!neu && new Set(neu.map((x) => x.no)).size === 3 && neu[0].typeId === 'hochdruck' && neu[0].plans.length === 2 && neu[2].home.label === 'Büro' && neu.every((x) => x.status === 'betrieb' && x.history[0].note === 'aus Excel eingefügt'), JSON.stringify(neu?.map((x) => [x.no, x.typeId, x.plans.length, x.home.label])))
  await O.act('gr-import-open')
  await O.page.waitForSelector('.modal #gr-imp-text')
  await O.page.fill('#gr-imp-text', 'Bezeichnung\tInventarnummer\nHochdruckreiniger Kärcher HD 5/15\t' + neu[0].no)
  await O.page.click('.modal [data-action="gr-import-check"]')
  await O.page.waitForFunction(() => /Schon vorhanden/.test(document.querySelector('.modal')?.innerText || ''))
  check('Nochmals eingefügt (gleiche Inventarnummer): „schon vorhanden“, nichts anzulegen', (await O.page.locator('.modal [data-action="gr-import-save"]').count()) === 0)
  await O.closeModals()

  // ------------------------------------------------ 2. Formular am Handy
  await O.view('unterweisungen')
  await O.act('uo-open')
  await O.page.waitForSelector('.modal [data-action="uo-form-add"][data-tpl="diensthandy"]')
  await O.page.click('.modal [data-action="uo-form-add"][data-tpl="diensthandy"]')
  await O.page.waitForSelector('.modal #uo-content')
  const types = () => SP.json('unterweisungen/unterweisungen.json')?.types || []
  const t = await O.waitFor(() => types().find((x) => x.id === 'diensthandy'), 15000)
  check('Formular „Vereinbarung Diensthandy“ angelegt: Art Formular, Pflicht mit „Diensthandy“, ohne Ablauf, am Handy', !!t && t.kind === 'formular' && t.who === 'skill:Diensthandy' && t.months === 0 && t.online?.on, JSON.stringify(t && { kind: t.kind, who: t.who }))
  check('Editor: ohne Fragen, Text der Vorlage', (await O.page.inputValue('#uo-quiz')) === '' && (await O.page.inputValue('#uo-content')).includes('## Rückgabe') && /ohne Fragen: gleich zur Unterschrift/.test(await O.text('.modal')))
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
await finish(browser, [server], errors)
