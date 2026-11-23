// Gemeinsame Foto-Hilfen des Mattenwechsels für die Fahreransicht (views/matten-fahrer.js), die Lieferscheine
// (views/matten-lieferscheine.js) und die Liegeplätze (views/matten.js): Fotos dieser Sitzung im Speicher (sofort
// ansehen, auch ohne Netz und im Browser-Modus), sonst aus der Warteschlange des Geräts oder aus SharePoint lesen;
// verkleinern vor dem Hochladen; verkleinert als data:-URL für den Fotonachweis (PDF) – das PDF soll als Anhang
// unter der Grenze für E-Mails aus der App bleiben (core/mail.js → MAIL_LIMIT).

import { photoProofDocument } from '../export/matten-foto-pdf.js'
import { proofFileName, proofRows } from '../core/matten-fotos.js'
import { app, toast } from './context.js'

const BLOBS = new Map() // Pfad → Blob (in dieser Sitzung aufgenommen oder schon gelesen)

/** Höchstens so viele Fotos kommen in den Fotonachweis (die übrigen nennt das PDF als „in unserer Ablage“). */
export const PROOF_MAX = 8

export const rememberPhoto = (path, blob) => void BLOBS.set(path, blob)
export const hasPhotoInSession = (path) => BLOBS.has(path)

/** Vor dem Hochladen verkleinern (wie beim Regiebericht): längste Seite höchstens max, JPEG; kleine Dateien bleiben. */
export async function shrinkPhoto(file, max = 2000, quality = 0.82, minSize = 600e3) {
  if (!/^image\//.test(file.type) || file.size < minSize || typeof createImageBitmap !== 'function') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality))
    return blob && blob.size < file.size ? new File([blob], `${String(file.name || 'foto').replace(/\.\w+$/, '')}.jpg`, { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

/** Bild zum Pfad: diese Sitzung → Warteschlange im Gerät → Ablage (SharePoint). null, wenn es nicht ladbar ist. */
export async function photoBlob(path) {
  if (!path) return null
  const mem = BLOBS.get(path)
  if (mem) return mem
  try {
    const queued = await app.offline?.get?.('blobs', path)
    if (queued?.blob) return queued.blob
  } catch {
    // kein Gerätespeicher: weiter mit der Ablage
  }
  const blob = await app.store?.readBlob?.(path).catch(() => null)
  if (blob) BLOBS.set(path, blob)
  return blob || null
}

/** Foto in einem neuen Fenster öffnen; meta: { url, queued, local } vom Eintrag des Fotos. */
export async function openPhotoPath(path, meta = {}) {
  const mem = BLOBS.get(path)
  if (mem) return void window.open(URL.createObjectURL(mem), '_blank', 'noopener')
  if (meta.local) return toast('Im Browser-Modus werden Fotos nicht gespeichert (nur im Betrieb mit SharePoint).')
  // zuerst über die Anmeldung der App lesen (geht auch in der installierten App); sonst der Link in SharePoint
  const blob = await photoBlob(path)
  if (blob) return void window.open(URL.createObjectURL(blob), '_blank', 'noopener')
  if (meta.url && !meta.queued) return void window.open(meta.url, '_blank', 'noopener')
  toast(meta.queued ? 'Das Foto wartet noch im Gerät aufs Hochladen.' : 'Foto nicht gefunden.')
}

/** Bild als data:-URL (JPEG, längste Seite höchstens max) für das PDF; '' wenn nicht ladbar. */
export async function photoDataUrl(path, { max = 1000, quality = 0.72 } = {}) {
  const blob = await photoBlob(path)
  if (!blob) return ''
  try {
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    const g = canvas.getContext('2d')
    g.fillStyle = '#fff'
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return ''
  }
}

/**
 * Fotonachweis eines Stopps als PDF: { blob, name, count (Fotos am Stopp), shown (im PDF) } oder null ohne Fotos.
 * info wie export/matten-foto-pdf.js (Kunde, Objekt, Tag, Lieferschein, Fahrer).
 */
export async function photoProofPdf(stop, info = {}) {
  const rows = proofRows(stop)
  if (!rows.length) return null
  const out = []
  for (const [i, r] of rows.entries()) out.push({ ...r, image: i < PROOF_MAX ? await photoDataUrl(r.path) : '' })
  const shown = out.filter((r) => r.image).length
  if (!shown) return null
  const { loadLogo, pdfBlob } = await import('./pdf.js')
  const doc = photoProofDocument({ rows: out, info, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })
  return { blob: await pdfBlob(doc), name: proofFileName({ number: info.number, date: info.date, customerName: info.customerName }), count: rows.length, shown }
}
