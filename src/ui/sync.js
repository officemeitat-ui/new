// Abgleich mit SharePoint: wann und wie oft.
//
// - Solange jemand arbeitet (Tippen, Klicken in den letzten 2 Minuten): alle 20 Sekunden,
//   sonst alle 60 Sekunden (config: sharepoint.fastSeconds / refreshSeconds). Im Hintergrund
//   (anderer Tab, Handy gesperrt) gar nicht; beim Zurückkommen und wenn das Netz wiederkommt sofort.
// - Ein Abgleich prüft alle offenen Dateien mit einer Anfrage je 20 Dateien (nur eTags) und lädt
//   nur, was sich geändert hat.
// - Mehrere Fenster im selben Browser: Speichert eines, übernehmen die anderen den Stand sofort
//   aus dem Gerätespeicher (ohne Anfrage an SharePoint).
// - Geht die App in den Hintergrund, wird sofort gespeichert statt erst nach der kurzen Pause.

const ACTIVE_MS = 120e3

export const syncState = { lastAt: 0, running: false, error: '', next: 0 }

export function startSync({ service, fastSeconds = 20, idleSeconds = 60, onChange = () => {} }) {
  let lastActivity = Date.now()
  const session = Math.random().toString(36).slice(2)
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('cleanos-app-abgleich') : null

  async function sync() {
    if (syncState.running || !navigator.onLine) return
    syncState.running = true
    try {
      await service.refresh()
      syncState.lastAt = Date.now()
      syncState.error = ''
    } catch (err) {
      syncState.error = String(err?.message || err)
    } finally {
      syncState.running = false
      onChange()
    }
  }

  function tick() {
    if (document.visibilityState === 'visible') {
      const active = Date.now() - lastActivity < ACTIVE_MS
      const every = (active ? fastSeconds : idleSeconds) * 1000
      if (Date.now() - syncState.lastAt >= every) sync()
    }
    setTimeout(tick, 5000)
  }

  const touch = () => (lastActivity = Date.now())
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(ev, touch, { passive: true })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      touch()
      sync()
    } else service.flushNow?.() // Handy: App gewechselt, Tab geschlossen
  })
  window.addEventListener('pagehide', () => service.flushNow?.())
  window.addEventListener('online', sync)

  // andere Fenster: gespeicherte Pfade melden bzw. übernehmen
  if (channel) {
    channel.onmessage = (e) => {
      const m = e.data || {}
      if (m.from === session || m.type !== 'gespeichert' || !Array.isArray(m.paths)) return
      service
        .adoptSaved?.(m.paths)
        .then((changed) => changed?.length && onChange())
        .catch(() => {})
    }
  }

  syncState.lastAt = Date.now()
  setTimeout(tick, 5000)
  return {
    sync,
    /** nach dem Speichern aufrufen (DataService onSaved) */
    saved(paths) {
      syncState.lastAt = Date.now()
      channel?.postMessage({ type: 'gespeichert', from: session, paths })
    },
  }
}

/** „vor 12 s“, „vor 3 min“ */
export function agoText(at, now = Date.now()) {
  if (!at) return 'noch nicht'
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `vor ${s} s`
  const m = Math.round(s / 60)
  return m < 60 ? `vor ${m} min` : `um ${new Date(at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}`
}
