// Gemeinsame Touren-Ablage der Sitzung für die Tourenplanung im Büro (views/matten-planung.js) und die Fahreransicht
// (views/matten-fahrer.js): eine Instanz von TourStore (storage/matten-touren.js) mit Gerätespeicher je Konto
// (Ungespeichertes übersteht Neuladen ohne Netz), Schreiben nur in den Ordnern, die die Rolle schreiben darf.
// Wer neu zeichnen will, meldet sich mit onToursChanged an.

import { TourStore } from '../storage/matten-touren.js'
import { createOfflineCache, memoryCache } from '../storage/offline.js'
import { app } from './context.js'

const listeners = new Set()
let shared = null

/** Die Ablage der Touren (null ohne Ablage der App). */
export function tourStore() {
  if (!app.store) return null
  if (shared && shared.store === app.store) return shared
  // je Konto ein eigener Gerätespeicher (wie die Ablage selbst)
  const name = app.user && app.store.kind === 'sharepoint' ? `dienstplan-offline:${app.user.id || app.user.email}:mattentouren` : ''
  shared = new TourStore({
    store: app.store,
    cache: name ? createOfflineCache(name) : memoryCache(),
    onChange: () => listeners.forEach((fn) => fn()),
    canWrite: (path) => (app.service?.rights?.write ? app.service.rights.write(path) : true),
  })
  return shared
}

/** Nach jeder Änderung der Touren (geladen, geändert, gespeichert) aufrufen. */
export function onToursChanged(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
