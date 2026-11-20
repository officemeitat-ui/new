// „Einfügen zurücknehmen“: Sicherheitsnetz für das Einfügen ganzer Listen (Mitarbeitende, Objekte und Leistungen,
// Abwesenheiten, Unterweisungen, Schlüssel, Liegeplätze des Mattenwechsels). Vor dem Einfügen merkt sich die App die betroffenen
// Bereiche; in der passenden Ansicht steht danach 30 Minuten lang ein Hinweis mit „Einfügen zurücknehmen“ (zwei
// Klicks). Gemerkt wird ein Schritt, nur in dieser Sitzung: nach dem Neuladen der Seite ist er weg.
// Zurückgenommen wird der ganze Bereich auf den Stand davor – was seither dort geändert wurde, geht mit verloren
// (das sagt der zweite Klick). Wochenpläne, Einteilungen und alles außerhalb der Bereiche bleiben unberührt.

import { app, confirmStep, persist, registerActions, renderNow, toast } from './context.js'
import { esc } from './shared.js'

const MINUTES = 30
let last = null

// Bereich lesen und schreiben; 'fakturierung.customers' meint nur die Kundenliste (der Rest der Fakturierung bleibt).
const read = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), app.data)
function write(path, value) {
  const keys = path.split('.')
  const leaf = keys.pop()
  const parent = keys.reduce((o, k) => (o == null ? undefined : o[k]), app.data)
  if (!parent) return
  if (value === undefined) delete parent[leaf]
  else parent[leaf] = value
}

/**
 * Stand vor dem Einfügen merken. kind: Ansicht, in der der Hinweis erscheint ('employees' | 'tasks' | 'absences' |
 * 'trainings' | 'keys' | 'matten'); fields: Bereiche von app.data, die das Einfügen ändert (auch 'bereich.liste'); label: was
 * eingefügt wird (für den Hinweis, z. B. „26 Mitarbeitende“; steht es erst danach fest: setImportUndoLabel);
 * after: läuft nach dem Zurücknehmen (z. B. den Stand eines Dialogs leeren).
 */
export function recordImportUndo(kind, fields, label = '', { after = null } = {}) {
  last = { kind, label, fields, after, at: Date.now(), data: Object.fromEntries(fields.map((f) => [f, read(f) === undefined ? undefined : structuredClone(read(f))])) }
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
    for (const f of u.fields) write(f, u.data[f])
    last = null
    u.after?.()
    persist()
    renderNow()
    toast(`Zurückgenommen: ${u.label || 'Einfügen'}.`)
  },
})
