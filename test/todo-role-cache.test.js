import { test } from 'node:test'
import assert from 'node:assert/strict'

globalThis.window = globalThis
globalThis.addEventListener = () => {}
globalThis.document = { getElementById: () => null, activeElement: null }
globalThis.requestIdleCallback = (fn) => queueMicrotask(fn)
const { app } = await import('../src/ui/context.js')
const { SOURCES, registerTodo, todo, todoOrLast, todoReady, bellButton } = await import('../src/ui/modals/todo.js')

test('Aufgabenzähler: beim Rollenwechsel keine Aufgaben der vorherigen Rolle zeigen', async () => {
  app.data = { assignments: {}, absences: [], published: {} }
  // Ein offener Dialog verhindert Neuzeichnen; geprüft werden die echten Berechnungen und Zähler.
  app.ui.modal = { type: 'test' }
  const access = (id, module) => ({ roles: [id], canEdit: (m) => m === module })
  app.access = access('buero', 'buero')
  SOURCES.length = 0
  registerTodo({ id: 'buero', module: 'buero', compute: () => [{ id: 'vertraulich' }] })
  registerTodo({ id: 'fahrer', module: 'fahrer', compute: () => [{ id: 'tour1' }, { id: 'tour2' }] })
  assert.equal(todo().count, 1)
  app.access = access('fahrer', 'fahrer')
  const stale = todoOrLast()
  assert.ok(!stale.ids.includes('buero:vertraulich'), 'auch während der Neuberechnung keine fremden Aufgaben')
  assert.ok(!/id="todo-count"[^>]*>1</.test(bellButton()), 'Glocke zeigt nicht mehr den Bürozähler')
  await new Promise(setImmediate)
  assert.deepEqual(todoReady().ids, ['fahrer:tour1', 'fahrer:tour2'])
  assert.equal(todoOrLast().count, 2)
  // Gleich benannte Rollen können bei einem neuen Zugriffskontext andere Rechte haben.
  app.access = access('fahrer', 'buero')
  assert.equal(todoReady(), null)
  assert.deepEqual(todo().ids, ['buero:vertraulich'])
})

test('Aufgabenzähler: bei Datenänderungen innerhalb derselben Rolle bleibt der letzte Stand nutzbar', () => {
  const previous = todo()
  app.dataVersion = (app.dataVersion || 0) + 1
  assert.equal(todoOrLast(), previous)
})
