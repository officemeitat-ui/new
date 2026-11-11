import { test } from 'node:test'
import assert from 'node:assert/strict'

// Hier wird nur der Dialogwechsel geprüft, ohne Graph-Aufrufe oder E-Mail-Versand.
const noop = () => {}
const element = { innerHTML: '', scrollTop: 0, classList: { toggle: noop }, focus: noop, querySelectorAll: () => [], querySelector: () => element }
globalThis.window = globalThis
globalThis.addEventListener = noop
globalThis.document = { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], getElementById: () => element }
const { app, ACTIONS, MODALS, openModal } = await import('../src/ui/context.js')
await import('../src/ui/views/invoicing-laeufe.js')
// Die Inhalte brauchen für diesen Übergang keine DOM-Implementierung.
MODALS['fak-dunning'] = () => '<div>Mahnlauf</div>'
MODALS['fak-block'] = () => '<div>Mahnsperre</div>'

test('Zahlungserinnerungen: Mahnsperre abbrechen erhält die erste Stufe und die bewusste Auswahl', () => {
  app.access = null
  const sel = { re1: true, re2: false }
  openModal({ type: 'fak-dunning', only: 'erinnerung', sel, block: 'freundlich' })
  ACTIONS['fak-block-open']({ dataset: { doc: 're1', back: 'fak-dunning' } })
  assert.equal(app.ui.modal.type, 'fak-block')
  ACTIONS['fak-block-back']()
  assert.equal(app.ui.modal.type, 'fak-dunning')
  assert.equal(app.ui.modal.only, 'erinnerung', 'höhere Mahnstufen dürfen nach dem Zurückkehren nicht hinzukommen')
  assert.deepEqual(app.ui.modal.sel, { re1: true, re2: false }, 'abgewählte Rechnungen bleiben abgewählt')
  assert.equal(app.ui.modal.block, 'freundlich')
})

test('Mahnlauf: Rückkehr ohne Erinnerungsfilter und Mahnsperre ohne Rücksprung bleiben möglich', () => {
  app.access = null
  openModal({ type: 'fak-dunning', sel: { re1: false } })
  ACTIONS['fak-block-open']({ dataset: { doc: 're1', back: 'fak-dunning' } })
  ACTIONS['fak-block-back']()
  assert.equal(app.ui.modal.only, undefined)
  assert.deepEqual(app.ui.modal.sel, { re1: false })
  ACTIONS['fak-block-open']({ dataset: { doc: 're1' } })
  ACTIONS['fak-block-back']()
  assert.equal(app.ui.modal, null)
})
