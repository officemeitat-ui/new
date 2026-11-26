// Mitarbeiterakte im Büro: App im SharePoint-Betrieb (Attrappe) mit Demo-Daten und einer fertigen Qualitätsmessung, in der
// zwei Räume mit Mangel einer Person zugeordnet sind („gereinigt von“).
//  1. Qualitätsmessung: bei einem Raum mit Mangel erscheint „Gereinigt von“ (laut Plan zuerst), die Wahl wird gespeichert.
//  2. Mitarbeiterakte öffnen: Vermerk aus der Messung übernommen, PDF im Ordner der Person (SharePoint).
//  3. Zwei Vermerke von Hand (einer mit Foto) → drei offen → „Zu erledigen“: Mitarbeitergespräch fällig.
//  4. Gespräch führen: Protokoll als PDF (heruntergeladen und im Ordner), Erinnerung weg.
//  5. Rechte: die Objektleitung sieht die Akte nicht.
// Port 19865.
import { readFileSync } from 'node:fs'
import { chromium, check, finish, sharepoint, startServer, wait, mondayOf, todayVienna } from './ablauf-lib.mjs'

const PORT = 19865
const server = startServer(PORT)
const browser = await chromium.launch()
const errors = []
// kleines JPEG (1 × 1) für das Foto zum Vermerk
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')
try {
  const today = todayVienna()
  const { createDemoData } = await import('../src/data/demo.js')
  const { splitData } = await import('../src/storage/data-service.js')
  const demo = createDemoData(mondayOf(today))
  const docs = splitData(demo, [])
  const emp = demo.employees.find((e) => !e.exitDate)
  const obj = demo.objects[0]
  const room = (label, cleanedBy, state) => ({ key: label, groupId: 'g1', group: 'Büro', no: 1, label, checked: true, cleanedBy, items: [{ id: 'boden', name: 'Boden', weight: 1, state, defects: state === 'mangel' ? ['staub'] : [], note: state === 'mangel' ? 'unter den Tischen' : '', photo: null }] })
  docs['qualitaet/qualitaet.json'] = {
    settings: {},
    objects: [{ objectId: obj.id, groups: [{ id: 'g1', name: 'Büro', template: 'buero', rooms: 4, names: [] }] }],
    measurements: [
      { id: 'mfertig', objectId: obj.id, date: today, status: 'fertig', by: 'Petra Leitner', seed: 1, groupIds: ['g1'], lot: 4, plan: { n: 3, ac: 0, re: 1 }, roomLimit: 1, target: 90, rooms: [room('Büro 1', emp.id, 'mangel'), room('Büro 2', emp.id, 'mangel'), room('Büro 3', '', 'ok')], result: null, finishedAt: new Date().toISOString() },
      { id: 'mlauf', objectId: obj.id, date: today, status: 'laufend', by: 'Petra Leitner', seed: 2, groupIds: ['g1'], lot: 4, plan: { n: 1, ac: 0, re: 1 }, roomLimit: 1, target: 90, rooms: [{ ...room('Büro 4', undefined, 'ok'), checked: false }] },
    ],
  }
  const SP = sharepoint({ access: { planners: ['office@cleanos.at'], members: { objektleitung: ['ol@cleanos.at'] } } })
  SP.seed(docs)
  const O = await SP.open(browser, PORT, { email: 'office@cleanos.at', name: 'Petra Leitner', errors })
  const akte = () => SP.json('mitarbeiterakte/akte.json') || {}
  const files = () => SP.files?.() || []

  // ------------------------------------------------ 1. Qualitätsmessung: „Gereinigt von“
  await O.view('qualitaet')
  await O.act('qm-rate-open', { id: 'mlauf' })
  await O.page.waitForSelector('.modal .qm-items')
  check('Raum ohne Mangel: keine Auswahl „Gereinigt von“', (await O.page.locator('.modal select[data-change="qm-cleaned"]').count()) === 0)
  await O.page.click('.modal [data-action="qm-item"][data-s="mangel"]')
  await O.page.waitForSelector('.modal select[data-change="qm-cleaned"]')
  check('Mit Mangel: „Gereinigt von (für die Mitarbeiterakte)“ erscheint', /Gereinigt von/.test(await O.text('.modal')))
  await O.page.selectOption('.modal select[data-change="qm-cleaned"]', emp.id)
  check('Wahl gespeichert (Raum der Messung)', !!(await O.waitFor(() => SP.json('qualitaet/qualitaet.json')?.measurements?.find((m) => m.id === 'mlauf')?.rooms?.[0]?.cleanedBy === emp.id, 15000)))
  await O.closeModals()

  // ------------------------------------------------ 2. Akte: Vermerk aus der Messung
  await O.view('akte')
  check('Vermerk aus der fertigen Messung übernommen (zwei Räume)', !!(await O.waitFor(() => (akte().entries || []).some((e) => e.empId === emp.id && e.source?.measurementId === 'mfertig' && /2 Räume nicht in Ordnung/.test(e.title)), 15000)), JSON.stringify(akte().entries || []).slice(0, 200))
  check('Vermerk als PDF im Ordner der Person (SharePoint)', !!(await O.waitFor(() => (akte().entries || []).some((e) => e.pdf?.path?.startsWith('mitarbeiterakte/') && e.pdf.path.includes(`_${emp.id}/`)), 20000)), JSON.stringify((akte().entries || []).map((e) => e.pdf?.path)))
  await O.view('akte')
  check('Übersicht: Person mit „1 offen“', /1 offen/.test(await O.text('main')))

  // ------------------------------------------------ 3. Zwei Vermerke von Hand
  for (const [i, title] of ['Sanitär nicht ordentlich gereinigt', 'Müll nicht entleert'].entries()) {
    await O.act('ak-entry-open', { emp: emp.id })
    await O.page.waitForSelector('.modal #ak-title')
    await O.page.selectOption('#ak-obj', obj.id)
    await O.page.fill('#ak-title', title)
    await O.page.fill('#ak-text', 'Bei der Kontrolle festgestellt.')
    if (i === 0) await O.page.setInputFiles('#ak-photos', { name: 'wc.jpg', mimeType: 'image/jpeg', buffer: JPEG })
    await O.page.click('.modal [data-action="ak-entry-save"]')
    await O.toastWait(/Vermerk eingetragen/, 20000)
  }
  check('Drei offene Vermerke: Hinweis „Mitarbeitergespräch führen“', /3 offene Vermerke: Mitarbeitergespräch führen/.test(await O.text('#toast')), await O.text('#toast'))
  check('Foto in den Ordner der Person hochgeladen', !!(await O.waitFor(() => (akte().entries || []).some((e) => e.photos?.[0]?.path?.startsWith(`mitarbeiterakte/`)), 15000)), JSON.stringify((akte().entries || []).map((e) => e.photos)))
  await O.closeModals()
  await O.view('akte')
  check('Ansicht: „Mitarbeitergespräch fällig“ mit der Person', /Mitarbeitergespräch fällig/.test(await O.text('main')) && (await O.text('main')).includes(emp.name))
  await O.act('open-todo')
  check('„Zu erledigen“: Mitarbeitergespräch mit 3 Vermerken', !!(await O.waitFor(async () => /Mitarbeitergespräch/.test(await O.text('#modal-root')) && (await O.text('#modal-root')).includes('3 Vermerke'), 15000)), (await O.text('#modal-root')).slice(0, 300))
  await O.closeModals()

  // ------------------------------------------------ 4. Gespräch
  await O.act('ak-talk-open', { emp: emp.id })
  await O.page.waitForSelector('.modal #akt-note')
  check('Gespräch: drei Vermerke vorausgewählt', (await O.page.locator('.modal input[name="akt-e"]:checked').count()) === 3)
  await O.page.fill('#akt-note', 'Zu wenig Zeit im Objekt.')
  await O.page.fill('#akt-agreed', 'Einschulung WC-Reinigung, Checkliste am Handy.')
  const [dl] = await Promise.all([O.page.waitForEvent('download'), O.page.click('.modal [data-action="ak-talk-save"]')])
  const pdf = readFileSync(await dl.path())
  check('Protokoll heruntergeladen (PDF)', /^Mitarbeitergespraech_\d{4}-\d{2}-\d{2}_.+\.pdf$/.test(dl.suggestedFilename()) && pdf.subarray(0, 4).toString() === '%PDF')
  check('Gespräch gespeichert, Vermerke besprochen, Protokoll im Ordner', !!(await O.waitFor(() => (akte().talks || []).some((t) => t.empId === emp.id && t.entryIds.length === 3 && t.pdf?.path?.startsWith('mitarbeiterakte/')) && (akte().entries || []).filter((e) => e.empId === emp.id && !e.talkId).length === 0, 20000)))
  await O.closeModals()
  await O.view('akte')
  check('Erinnerung weg', !/Mitarbeitergespräch fällig/.test(await O.text('main')))

  // ------------------------------------------------ 5. Rechte
  const L = await SP.open(browser, PORT, { email: 'ol@cleanos.at', name: 'Olga Leitung', errors })
  const hasView = await L.page.evaluate(async () => (await import('/src/ui/context.js')).visibleViews().some((v) => v.id === 'akte'))
  check('Objektleitung: keine Mitarbeiterakte im Menü', !hasView)
  check('Objektleitung: liest die Datei der Akte nicht', !SP.log?.some?.((x) => x.by === 'ol@cleanos.at' && String(x.path || '').startsWith('mitarbeiterakte/')))
  void files
  await wait(100)
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
await finish(browser, [server], errors)
