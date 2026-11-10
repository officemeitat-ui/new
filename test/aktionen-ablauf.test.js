// Knöpfe im Ablauf: Fehler einer Aktion bleiben nicht unbemerkt, ein Fehler beim PDF speichert nichts doppelt.
// Ohne Browser: Seite, Dialog und Meldung sind Attrappen, gezeichnet wird ein leerer Rahmen.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const noop = () => {}
const stub = () => ({ innerHTML: '', hidden: true, firstChild: null, classList: { toggle: noop, add: noop, remove: noop, contains: () => false }, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, append: noop, focus: noop })
const els = { app: stub(), 'modal-root': stub(), toast: stub() }
// Skripte (pdfmake) lassen sich nicht laden: wie ohne Netz, wenn die Bibliothek noch nicht im Gerät liegt
const head = { append: (el) => queueMicrotask(() => el.onerror?.()) }
globalThis.window ??= globalThis
globalThis.localStorage ??= { getItem: () => null, setItem: noop, removeItem: noop }
globalThis.document = { getElementById: (id) => els[id] || null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ dataset: {}, style: {} }), head, body: stub(), documentElement: stub(), addEventListener: noop }
// Zeitgeber aus dem Import (Abgleich, Wetter) halten den Test nicht offen
const timers = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval }
// Fehler landen zusätzlich in der Konsole: hier nur mitzählen
const logged = []
console.error = (err) => logged.push(err)
globalThis.setTimeout = (...args) => timers.setTimeout(...args).unref()
globalThis.setInterval = (...args) => timers.setInterval(...args).unref()

const ctx = await import('../src/ui/context.js')
const { app, ACTIONS } = ctx
ctx.setFrame({ frame: () => '', afterRender: noop })
const lastToast = () => els.toast.innerHTML.replace(/<[^>]+>/g, '')

function reset(data = {}) {
  app.config = { brand: {}, features: {} }
  app.user = { name: 'Büro' }
  app.access = null
  app.readOnly = false
  app.locked = false
  app.service = { schedule: noop, ensureWeeks: async () => {}, version: 0 }
  app.data = { employees: [], objects: [], tasks: [], assignments: {}, absences: [], ...data }
  app.ui.modal = null
  els.toast.innerHTML = ''
}

test('Aktion: Fehler einer Aktion zeigt einen Hinweis statt still zu scheitern (auch nach dem Laden des Moduls)', async () => {
  reset()
  ctx.registerActions({ 'test-kaputt': async () => { throw new Error('vendor/pdfmake.min.js konnte nicht geladen werden') } })
  await ctx.runAction(ACTIONS['test-kaputt'], {}, {})
  assert.match(lastToast(), /Das hat nicht geklappt: vendor\/pdfmake\.min\.js konnte nicht geladen werden/)
  // sofort geworfen (ohne async) ebenso
  ctx.registerActions({ 'test-kaputt-sofort': () => { throw new TypeError('x is undefined') } })
  els.toast.innerHTML = ''
  ctx.runAction(ACTIONS['test-kaputt-sofort'], {}, {})
  assert.match(lastToast(), /x is undefined/)
  // abgebrochen (Teilen, Datei wählen): kein Hinweis
  ctx.registerActions({ 'test-abbruch': async () => { throw Object.assign(new Error('Share canceled'), { name: 'AbortError' }) } })
  els.toast.innerHTML = ''
  await ctx.runAction(ACTIONS['test-abbruch'], {}, {})
  assert.equal(lastToast(), '')
  // ohne Fehler: Ergebnis wie bisher
  ctx.registerActions({ 'test-gut': async () => 'fertig' })
  assert.equal(await ctx.runAction(ACTIONS['test-gut'], {}, {}), 'fertig')
})

test('Unterweisung für viele: PDF scheitert (ohne Netz) → einmal eingetragen, Dialog zu, Hinweis zum PDF', async () => {
  const { emptyTrainings, TRAINING_DEFAULTS } = await import('../src/core/trainings.js')
  await import('../src/ui/views/trainings.js')
  reset({ employees: [{ id: 'e1', name: 'Anna Berger' }, { id: 'e2', name: 'Ben Cerny' }], unterweisungen: emptyTrainings() })
  const type = TRAINING_DEFAULTS[0]
  app.ui.modal = { type: 'tr-session', init: true, typeId: type.id, date: '2026-11-10', trainer: 'Büro', place: 'Lager', topic: 'Leitern', participants: ['e1', 'e2'], sign: false, pdf: true }
  await ctx.runAction(ACTIONS['ts-save'], {}, {})
  const d = app.data.unterweisungen
  assert.equal(d.sessions.length, 1)
  assert.equal(d.records.length, 2)
  assert.equal(app.ui.modal, null, 'Dialog geschlossen: ein zweiter Klick legt nichts doppelt an')
  assert.match(lastToast(), /PDF/)
  assert.doesNotMatch(lastToast(), /Das hat nicht geklappt/, 'eigener Hinweis, nicht der allgemeine')
})

test('Digitale Mitarbeiter: „Woche planen“ teilt eine Woche, die ohne Netz nicht geladen ist, nicht ein (wie im Plan)', async () => {
  const { addDays, mondayOf, todayISO } = await import('../src/core/dates.js')
  const { createDemoData } = await import('../src/data/demo.js')
  const { proposals } = await import('../src/ui/views/disponent.js')
  const next = addDays(mondayOf(todayISO()), 7)
  reset(createDemoData(mondayOf(todayISO())))
  app.data.assignments = {}
  app.service.weekUnavailable = (monday) => monday === next
  app.dataVersion = (app.dataVersion || 0) + 1
  app.cur = ctx.compute()
  const p = proposals().find((x) => x.run?.fn === 'planen' && x.run.data.monday === next)
  assert.ok(p, 'Vorschlag „Woche planen“ für die nächste Woche')
  await ctx.runAction(ACTIONS['dm-run'], { dataset: { id: p.id } }, {})
  assert.deepEqual(app.data.assignments, {}, 'nichts eingeteilt')
  assert.match(lastToast(), /ohne Verbindung nicht geladen/)
  assert.equal(app.data.assistenz?.decided?.[p.id], undefined, 'nicht als erledigt vermerkt')
  // geladen: wird eingeteilt und als erledigt vermerkt
  app.service.weekUnavailable = () => false
  await ctx.runAction(ACTIONS['dm-run'], { dataset: { id: p.id } }, {})
  assert.ok(Object.keys(app.data.assignments).length, 'eingeteilt')
  assert.equal(app.data.assistenz.decided[p.id].status, 'erledigt')
})
