// Fotos und Dateien, die ohne Netz aufgenommen wurden (Regiebericht, Anlagen, Qualitätsmessung, Arbeitsschutz,
// Bewerbungen, Matten-Touren …), warten in der Ablage im Gerät (storage/offline.js: blobs). Der Abgleich
// (DataService.refresh: regelmäßig, beim Zurückkommen und wenn das Netz wiederkommt, sync.js) und der Start
// holen sie nach – für alle Module, nicht nur das gerade offene – und vermerken sie im Modul (context.js:
// uploadDone). Was mit echtem Fehler hängt (z. B. kein Schreibrecht auf den Ordner), steht in „Zu erledigen“
// und im Systemcheck. Nur im Betrieb mit SharePoint: die Browser-Ablage lädt nichts hoch.

import { FOLDERS } from '../storage/data-service.js'
import { app, registerActions, renderModal, renderNow, toast, uploadDone } from './context.js'
import { invalidateTodo, refreshBell, registerTodo } from './modals/todo.js'
import { esc } from './shared.js'

/** Stand nach dem letzten Nachholen: wartende Dateien, davon mit echtem Fehler [{ path, error, tries }]. */
export const uploadState = { queued: 0, failed: [], at: 0 }

/** Bereich zum Pfad einer Datei (Ordner in SharePoint, data-service.js FOLDERS), z. B. „Regieberichte“. */
export function uploadLabel(path) {
  const hit = FOLDERS.filter(([folder]) => path.startsWith(`${folder}/`)).sort((a, b) => b[0].length - a[0].length)[0]
  return hit ? hit[1].split(/: | \(/)[0] : path.split('/')[0]
}

const key = (failed) => failed.map((f) => f.path).sort().join(',')

/** Nach jedem Nachholen (DataService.onUploads): Stand merken, „Zu erledigen“ und Ansicht auffrischen. */
export function uploadsChanged({ done = 0, left = 0, failed = [] } = {}) {
  const before = key(uploadState.failed)
  Object.assign(uploadState, { queued: left, failed, at: Date.now() })
  if (before !== key(failed)) {
    invalidateTodo()
    refreshBell()
  }
  // „wartet auf Netz“ an den Dateien ist weg: neu zeichnen, außer jemand arbeitet gerade in einem Dialog
  if (done && !app.ui.modal) renderNow()
}

/**
 * Beim Start: Nachholen an den DataService hängen (der Abgleich ruft es auf) und gleich einmal nachholen,
 * was vom letzten Mal ohne Netz liegen blieb. Nur mit einer Ablage, die eine Warteschlange hat (SharePoint).
 */
export function startUploads({ service }) {
  if (!service?.store?.flushUploads) return false
  service.onUploaded = uploadDone
  service.onUploads = uploadsChanged
  if (navigator.onLine !== false) service.flushQueuedUploads().catch(() => {})
  return true
}

// ---------------------------------------------------------------- Zu erledigen

registerTodo({
  id: 'uploads',
  module: null, // betrifft nur dieses Gerät: für jede Rolle
  title: 'Dateien im Gerät nicht hochgeladen',
  compute: () => (uploadState.failed.length ? [{ id: `fehl:${key(uploadState.failed)}`, failed: uploadState.failed }] : []),
  render: (items) => {
    const failed = items.flatMap((x) => x.failed)
    const rows = failed
      .map(
        (f) => `<div class="todo-item"><span class="flag error">!</span><div class="todo-text"><strong>${esc(f.path.split('/').pop())}</strong> <span class="muted">${esc(uploadLabel(f.path))}</span><br><span class="muted">${esc(f.error || 'Fehler')}${f.tries > 1 ? ` · ${f.tries} Versuche` : ''}</span></div>
          <button class="btn small" data-action="uploads-retry">Erneut versuchen</button></div>`,
      )
      .join('')
    return `${rows}<p class="note">${failed.length === 1 ? 'Die Datei liegt' : 'Die Dateien liegen'} weiter im Gerät; die App versucht es alle 10 Minuten von selbst. Bleibt „Zugriff verweigert“, fehlt das Schreibrecht auf den Ordner in SharePoint – das Büro gibt ihn frei, danach klappt der nächste Versuch.</p>`
  },
})

registerActions({
  'uploads-retry': async (el) => {
    if (el) el.disabled = true
    const left = await app.service.flushQueuedUploads({ retryFailed: true }).catch(() => -1)
    if (el) el.disabled = false
    if (left < 0) toast('Hochladen nicht möglich – bitte später noch einmal.')
    else if (!left) toast('Alles hochgeladen.')
    else toast(`${left} ${left === 1 ? 'Datei wartet' : 'Dateien warten'} weiter im Gerät${uploadState.failed[0]?.error ? `: ${uploadState.failed[0].error}` : ' (kein Netz)'}.`)
    renderModal()
  },
})
