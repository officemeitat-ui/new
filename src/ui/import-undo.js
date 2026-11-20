// „Einfügen zurücknehmen“: Sicherheitsnetz für das Einfügen ganzer Listen (Mitarbeitende, Objekte und Leistungen,
// Unterweisungen, Schlüssel, Liegeplätze des Mattenwechsels). Vor dem Einfügen merkt sich die App die betroffenen
// Bereiche; in der passenden Ansicht steht danach 30 Minuten lang ein Hinweis mit „Einfügen zurücknehmen“ (zwei
// Klicks). Gemerkt wird ein Schritt, nur in dieser Sitzung: nach dem Neuladen der Seite ist er weg.
// Zurückgenommen wird der ganze Bereich auf den Stand davor – was seither dort geändert wurde, geht mit verloren
// (das sagt der zweite Klick). Wochenpläne, Einteilungen und alles außerhalb der Bereiche bleiben unberührt.

import { app, confirmStep, persist, registerActions, renderNow, toast } from './context.js'
import { esc } from './shared.js'

const MINUTES = 30
let last = null

/**
 * Stand vor dem Einfügen merken. kind: Ansicht, in der der Hinweis erscheint ('employees' | 'tasks' | 'trainings' |
 * 'keys' | 'matten'); label: was eingefügt wird (für den Hinweis, z. B. „26 Mitarbeitende“); fields: Bereiche von
 * app.data, die das Einfügen ändert. Nach dem Einfügen setLabel() mit dem Ergebnis aufrufen.
 */
export function recordImportUndo(kind, fields, label = '') {
  last = { kind, label, fields, at: Date.now(), data: Object.fromEntries(fields.map((f) => [f, app.data[f] === undefined ? undefined : structuredClone(app.data[f])])) }
}
/** Text des Hinweises nach dem Einfügen setzen (das Ergebnis steht erst danach fest). */
export function setImportUndoLabel(label) {
  if (last) last.label = label
}
/** Einfügen hat nichts geändert bzw. wurde abgebrochen: nichts zum Zurücknehmen. */
export function clearImportUndo() {
  last = null
}

const current = () => (last && Date.now() - last.at < MINUTES * 60000 ? last : null)
/** Gibt es etwas zurückzunehmen? { kind, label, minutes } oder null (für Tests und Ansichten). */
export const importUndoInfo = () => {
  const u = current()
  return u ? { kind: u.kind, label: u.label, minutes: Math.floor((Date.now() - u.at) / 60000) } : null
}

/** Hinweis für die Ansicht (leer, wenn nichts gemerkt ist, die Ansicht nicht passt oder nur gelesen wird). */
export function importUndoBanner(kind) {
  const u = current()
  if (!u || u.kind !== kind || app.readOnly) return ''
  const min = Math.floor((Date.now() - u.at) / 60000)
  const ask = app.ui.confirm === 'import-undo'
  const when = min < 1 ? 'gerade eben' : `vor ${min} ${min === 1 ? 'Minute' : 'Minuten'}`
  return `<div class="banner import-undo" role="status"><p><strong>Eingefügt ${when}:</strong> ${esc(u.label || 'Liste')}.${ask ? ' Zurücknehmen stellt den Bereich auf den Stand davor: Was seither hier geändert wurde, geht mit verloren.' : ' Passt etwas nicht, lässt sich das Einfügen zurücknehmen.'}</p>
    <button class="btn ${ask ? 'danger confirm' : ''}" data-action="import-undo">${ask ? 'Wirklich zurücknehmen?' : 'Einfügen zurücknehmen'}</button></div>`
}

registerActions({
  'import-undo': () => {
    const u = current()
    if (!u || app.readOnly) {
      last = null
      renderNow()
      return toast('Nichts zum Zurücknehmen.')
    }
    if (!confirmStep('import-undo', renderNow)) return
    for (const f of u.fields) {
      if (u.data[f] === undefined) delete app.data[f]
      else app.data[f] = u.data[f]
    }
    last = null
    persist()
    renderNow()
    toast(`Zurückgenommen: ${u.label || 'Einfügen'}.`)
  },
})
