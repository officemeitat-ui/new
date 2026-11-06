// Später geladene Module (views/lazy.js, registerLazy in context.js): Die Platzhalter müssen zum
// echten Modul passen, sonst fehlt vor dem Laden eine Aktion, eine Ansicht steht falsch im Menü oder
// „Zu erledigen“ ändert die Reihenfolge. Und der Build darf sie nicht in den Start ziehen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Was die Module beim Import vom Browser brauchen (Ereignisse, Speicher): Attrappen genügen.
// Zeitgeber aus dem Import (z. B. Schnee-Alarm alle 15 Minuten) halten den Test nicht offen.
const noop = () => {}
const el = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop }, append: noop, setAttribute: noop, addEventListener: noop })
globalThis.window ??= globalThis
globalThis.addEventListener ??= noop
globalThis.localStorage ??= { getItem: () => null, setItem: noop, removeItem: noop }
globalThis.document ??= { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: el, head: el(), body: el(), documentElement: el() }
const timers = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval }
globalThis.setTimeout = (...args) => timers.setTimeout(...args).unref()
globalThis.setInterval = (...args) => timers.setInterval(...args).unref()

const ctx = await import('../src/ui/context.js')
const { SOURCES } = await import('../src/ui/modals/todo.js')
await import('../src/ui/views/index.js')

const snapshot = () => ({
  views: ctx.VIEWS.map((v) => v.id),
  actions: Object.keys(ctx.ACTIONS).sort(),
  modals: Object.keys(ctx.MODALS).sort(),
  hints: ctx.OBJECT_HINTS.map((h) => h.module),
  todo: SOURCES.map((s) => s.id),
})
// Felder, die der Platzhalter weglassen darf (kommen mit dem Modul)
const OPTIONAL = ['badge', 'range', 'actions']
const same = (x) => (typeof x === 'function' ? String(x) : x)

test('Später laden: Platzhalter passen zum Modul (views/lazy.js)', async () => {
  const stubs = new Map(ctx.VIEWS.filter((v) => v.lazy).map((v) => [v.id, v]))
  const start = snapshot()
  assert.ok(ctx.LAZY.length >= 10, 'Module in views/lazy.js')
  for (const entry of ctx.LAZY) for (const id of entry.views) assert.ok(stubs.has(id), `Ansicht ${id}: schon beim Start geladen (statischer Import des Moduls?)`)
  assert.ok(Object.values(ctx.ACTIONS).some((fn) => fn.lazy) && Object.values(ctx.MODALS).some((fn) => fn.lazy))

  for (const entry of ctx.LAZY) {
    await entry.load()
    assert.ok(entry.loaded)
    for (const id of entry.views) assert.ok(!ctx.VIEWS.find((v) => v.id === id).lazy, `Ansicht ${id}: das Modul registriert sie nicht`)
  }
  // nach dem Laden: alles echt, nichts Neues dazugekommen, Reihenfolge wie beim Start
  const after = snapshot()
  for (const [name, fn] of Object.entries(ctx.ACTIONS)) assert.ok(!fn.lazy, `Aktion ${name}: steht in views/lazy.js, das Modul registriert sie nicht`)
  for (const [type, fn] of Object.entries(ctx.MODALS)) assert.ok(!fn.lazy, `Dialog ${type}: steht in views/lazy.js, das Modul registriert ihn nicht`)
  assert.deepEqual(after.actions.filter((n) => !start.actions.includes(n)), [], 'Aktionen fehlen in views/lazy.js (actions)')
  assert.deepEqual(after.modals.filter((n) => !start.modals.includes(n)), [], 'Dialoge fehlen in views/lazy.js (modals)')
  assert.deepEqual(after.views, start.views, 'Reihenfolge der Ansichten')
  assert.deepEqual(ctx.NAME_CLASHES, [], 'Namen doppelt vergeben: das zuletzt geladene Modul überschreibt das andere (Kürzel je Modul wählen)')
  assert.deepEqual(after.hints, start.hints, 'Hinweise zum Objekt: hints in views/lazy.js')
  assert.ok(!ctx.OBJECT_HINTS.some((h) => h.lazy), 'hints: true, aber das Modul ruft registerObjectHint nicht auf')
  assert.deepEqual(after.todo, start.todo, '„Zu erledigen“: todo in views/lazy.js (Kennungen von registerTodo)')
  assert.ok(!SOURCES.some((s) => s.lazy), 'todo: Kennung steht in views/lazy.js, das Modul registriert sie nicht')

  // Kopfdaten der Ansichten: wie im Modul (Menü, Suche, Rollen sehen den Platzhalter)
  for (const [id, stub] of stubs) {
    const real = ctx.VIEWS.find((v) => v.id === id)
    for (const [key, value] of Object.entries(real)) {
      if (key === 'render' || (OPTIONAL.includes(key) && !(key in stub))) continue
      assert.deepEqual(same(stub[key]), same(value), `Ansicht ${id}: „${key}“ in views/lazy.js anders als im Modul`)
    }
    for (const key of Object.keys(stub)) if (key !== 'lazy' && key !== 'render') assert.ok(key in real, `Ansicht ${id}: „${key}“ gibt es im Modul nicht`)
  }
  Object.assign(globalThis, timers)
})

test('Später laden: Platzhalter-Aktion lädt das Modul, ruft die echte auf und gibt ihr Ergebnis zurück', async () => {
  const calls = []
  const entry = ctx.registerLazy(async () => ctx.registerActions({ 'test-lazy': async (el) => (calls.push(el), `fertig ${el}`) }, { edit: true }), { actions: 'test-lazy', module: 'planung' })
  assert.equal(ctx.ACTIONS['test-lazy'].lazy, entry)
  assert.equal(await ctx.ACTIONS['test-lazy']('A'), 'fertig A')
  assert.deepEqual(calls, ['A'])
  assert.ok(entry.loaded && !ctx.ACTIONS['test-lazy'].lazy)
})

test('Später laden: ensureView, ensureModal und ensureAction liefern das echte Objekt', async () => {
  const head = { id: 'test-lazy-view', order: 999, label: 'Test', group: 'stamm' }
  ctx.registerLazy(
    async () => {
      ctx.registerView({ ...head, render: () => 'echt' })
      ctx.registerModal('test-lazy-modal', () => 'dialog')
      ctx.registerActions({ 'test-lazy-2': () => 'aktion' })
    },
    { views: [head], modals: 'test-lazy-modal', actions: 'test-lazy-2' },
  )
  assert.ok(ctx.VIEWS.find((v) => v.id === 'test-lazy-view').lazy)
  assert.equal((await ctx.ensureView('test-lazy-view')).render(), 'echt')
  assert.equal((await ctx.ensureModal('test-lazy-modal'))(), 'dialog')
  assert.equal((await ctx.ensureAction('test-lazy-2'))(), 'aktion')
  // immer geladene Ansichten und Aktionen: sofort
  assert.equal((await ctx.ensureView('week')).id, 'week')
  assert.equal(await ctx.ensureAction('gibt-es-nicht'), undefined)
})

test('Build: später geladene Module und Hilfe-Themen sind nicht im Start', async () => {
  const esbuild = await import('esbuild')
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
  const result = await esbuild.build({ entryPoints: [join(root, 'src/ui/app.js')], bundle: true, splitting: true, format: 'esm', outdir: join(root, 'dist-test'), write: false, metafile: true, logLevel: 'error' })
  const outputs = result.metafile.outputs
  const startFiles = new Set()
  const walk = (file) => {
    if (startFiles.has(file)) return
    startFiles.add(file)
    for (const imp of outputs[file].imports) if (imp.kind === 'import-statement') walk(imp.path)
  }
  walk(Object.keys(outputs).find((f) => outputs[f].entryPoint === 'src/ui/app.js'))
  const startInputs = new Set([...startFiles].flatMap((f) => Object.keys(outputs[f].inputs)))
  const lazy = ['kpi', 'guide', 'calculation', 'proof', 'staff', 'sites', 'trainings', 'rules', 'system', 'vehicles', 'complaints', 'material', 'keys', 'invoicing', 'invoicing-bank', 'invoicing-online', 'purchase', 'cashbook', 'einkauf-shared', 'weather'].map((m) => `src/ui/views/${m}.js`)
  for (const file of [...lazy, 'src/help/topics.js', 'src/ai/agent.js', 'src/data/demo.js']) assert.ok(!startInputs.has(file), `${file} ist im Start (statischer Import aus einem Modul, das immer geladen wird?)`)
  for (const file of ['src/ui/views/lazy.js', 'src/ui/views/home.js', 'src/ui/views/week.js', 'src/ui/help.js']) assert.ok(startInputs.has(file), `${file} fehlt im Start`)
})
