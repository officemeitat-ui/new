// Fotos vom Handy (Zählerstand, Mangel): verkleinern, damit Upload und Ablage
// klein bleiben. Mit SharePoint als Datei unter fotos/…, im Browser-Modus als
// kleines Vorschaubild direkt in den Daten.

import { fileSafe } from '../core/filename.js'
import { app, openModal, registerActions, registerModal, renderModal } from './context.js'
import { modalFrame } from './shared.js'

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
    const { webUrl } = await app.store.upload(path, blob, 'image/jpeg')
    return { url: webUrl, path }
  }
  return { data: await dataUrl(await shrink(file, 480, 0.6)) }
}

/** Bild (z. B. Unterschrift als PNG-Daten-URL) ablegen wie ein Foto. */
export async function storeImageData(data, name) {
  if (app.store?.kind !== 'sharepoint') return { data }
  const blob = await (await fetch(data)).blob()
  const path = `${name.split('/').map(fileSafe).join('/')}.png`
  const { webUrl } = await app.store.upload(path, blob, 'image/png')
  return { url: webUrl, path }
}

/** Bild als Daten-URL (fürs PDF): direkt oder aus SharePoint geladen. */
export async function photoDataUrl(photo) {
  if (!photo) return null
  if (photo.data) return photo.data
  if (photo.path && app.store?.readBlob) {
    try {
      const blob = await app.store.readBlob(photo.path)
      return blob ? await dataUrl(blob) : null
    } catch {
      return null
    }
  }
  return null
}

/** Foto anzeigen: Vorschaubild (groß im Dialog) oder Link auf die Datei in SharePoint. */
export function photoLink(photo, label = 'Foto') {
  if (!photo) return ''
  if (photo.data?.startsWith('data:image/')) return `<button type="button" class="photo-thumb" data-action="photo-view" data-src="${photo.data}" aria-label="${label} groß anzeigen"><img src="${photo.data}" alt=""></button>`
  if (/^https:\/\//.test(photo.url || '')) return `<a href="${photo.url}" target="_blank" rel="noopener">${label}</a>`
  return ''
}

registerModal('photo', (c, { src, back }) => modalFrame({ title: 'Foto', body: `<img class="photo-large" src="${src}" alt="Foto">`, foot: back ? '<span></span><button class="btn primary" data-action="photo-back">Zurück</button>' : '' }))
registerActions({
  'photo-view': (el) => openModal({ type: 'photo', src: el.dataset.src, back: app.ui.modal }),
  'photo-back': () => {
    app.ui.modal = app.ui.modal?.back || null
    renderModal()
  },
})
