// Fotos vom Handy (Zählerstand, Mangel): verkleinern, damit Upload und Ablage
// klein bleiben. Mit SharePoint als Datei unter fotos/…, im Browser-Modus als
// kleines Vorschaubild direkt in den Daten.

import { fileSafe } from '../core/filename.js'
import { app, openModal, persist, registerActions, registerModal, renderModal } from './context.js'
import { esc, modalFrame } from './shared.js'

async function shrink(file, maxSide, quality) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

const dataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

/** Vorschau für den Dialog (klein, sofort). */
export async function photoPreview(file) {
  return dataUrl(await shrink(file, 360, 0.7))
}

/**
 * Foto ablegen. `name` z. B. „zaehler/fotos/2026/Q3/Musterstrasse-12_A123“ (ohne Endung).
 * Liefert { url, path } (SharePoint) oder { data } (Browser).
 */
export async function storePhoto(file, name) {
  if (app.store?.kind === 'sharepoint') {
    const blob = await shrink(file, 1600, 0.8)
    const path = `${name.split('/').map(fileSafe).join('/')}.jpg`
    const res = await app.store.upload(path, blob, 'image/jpeg')
    // ohne Netz: Datei wartet im Gerät, bis dahin ein kleines Vorschaubild
    if (res.queued) return { path, pending: true, data: await dataUrl(await shrink(file, 240, 0.6)) }
    return { url: res.webUrl, path }
  }
  return { data: await dataUrl(await shrink(file, 480, 0.6)) }
}

/** Bild (z. B. Unterschrift als PNG-Daten-URL) ablegen wie ein Foto. */
export async function storeImageData(data, name) {
  if (app.store?.kind !== 'sharepoint') return { data }
  const blob = await (await fetch(data)).blob()
  const path = `${name.split('/').map(fileSafe).join('/')}.png`
  const res = await app.store.upload(path, blob, 'image/png')
  if (res.queued) return { path, pending: true, data }
  return { url: res.webUrl, path }
}

/** Alle Foto-Verweise in den Modul-Daten (für das Nachtragen nach dem Hochladen). */
function* photoRefs(data) {
  for (const r of data.zaehler?.readings || []) if (r.photo) yield r.photo
  for (const k of data.kontrolle?.inspections || []) {
    for (const it of Object.values(k.items || {})) yield* it.photos || []
    for (const s of Object.values(k.signatures || {})) if (s?.image) yield s.image
  }
  for (const m of Object.values(data.mappe?.objects || {})) for (const p of m.photos || []) if (p.photo) yield p.photo
}

/** Ohne Netz zurückgestellte Fotos hochladen und die Verweise nachtragen. */
export async function uploadQueued() {
  if (!app.store?.flushUploads || !(await app.store.queuedUploads())) return 0
  const done = new Map()
  const left = await app.store.flushUploads((path, url) => done.set(path, url))
  if (done.size) {
    for (const ref of photoRefs(app.data)) {
      if (!ref.pending || !done.has(ref.path)) continue
      ref.url = done.get(ref.path)
      delete ref.pending
      delete ref.data
    }
    persist()
  }
  return left
}

/** Bild als Daten-URL (fürs PDF): direkt oder aus SharePoint geladen. */
export async function photoDataUrl(photo) {
  if (!photo) return null
  if (photo.data) return photo.data
  if (photo.path && app.store?.readBlob) {
    try {
      const blob = await app.store.readBlob(photo.path, { root: !!photo.root })
      return blob ? await dataUrl(blob) : null
    } catch {
      return null
    }
  }
  return null
}

/** Nur echte Bild-Daten (base64) als Vorschau; alles andere (z. B. manipulierte Daten) wird nicht eingebettet. */
const SAFE_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i
export const safeImageData = (data) => (typeof data === 'string' && SAFE_IMAGE.test(data) ? data : '')

/** Foto anzeigen: Vorschaubild (groß im Dialog) oder Link auf die Datei in SharePoint. */
export function photoLink(photo, label = 'Foto') {
  if (!photo) return ''
  const data = safeImageData(photo.data)
  const name = esc(label)
  if (photo.pending && data) return `<button type="button" class="photo-thumb pending" data-action="photo-view" data-src="${data}" title="Wird hochgeladen, sobald Netz da ist" aria-label="${name} (wartet aufs Hochladen)"><img src="${data}" alt=""></button>`
  if (data) return `<button type="button" class="photo-thumb" data-action="photo-view" data-src="${data}" aria-label="${name} groß anzeigen"><img src="${data}" alt=""></button>`
  if (/^https:\/\//.test(photo.url || '')) return `<a href="${esc(photo.url)}" target="_blank" rel="noopener">${name}</a>`
  return ''
}

registerModal('photo', (c, { src, back }) => modalFrame({ title: 'Foto', body: safeImageData(src) || /^https:\/\//.test(src || '') ? `<img class="photo-large" src="${esc(src)}" alt="Foto">` : '<p class="muted">Foto nicht verfügbar.</p>', foot: back ? '<span></span><button class="btn primary" data-action="photo-back">Zurück</button>' : '' }))
registerActions({
  'photo-view': (el) => openModal({ type: 'photo', src: el.dataset.src, back: app.ui.modal }),
  'photo-back': () => {
    app.ui.modal = app.ui.modal?.back || null
    renderModal()
  },
})
