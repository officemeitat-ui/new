// Gemeinsames für Einkauf (purchase.js) und Kassenbuch (cashbook.js): Daten, Belege hochladen und öffnen,
// Kassenbuchung zu einer Zahlung. Registriert selbst keine Ansicht, keinen Dialog und keine Aktion.

import { addEntry, CASH_CATEGORIES, emptyCashbook } from '../../core/cashbook.js'
import { todayISO } from '../../core/dates.js'
import { emptyPurchase, purchaseSettings } from '../../core/purchase.js'
import { round2 } from '../../core/invoicing.js'
import { app, canEdit, toast } from '../context.js'
import { esc, euro } from '../shared.js'

export const MODULE = 'einkauf'

/** Einkauf (einkauf/einkauf.json), Felder sicher vorhanden. */
export const E = () => {
  const d = (app.data.einkauf ||= emptyPurchase())
  for (const k of ['suppliers', 'invoices', 'sepaRuns']) d[k] ||= []
  d.bankIgnored ||= {}
  d.settings ||= {}
  return d
}
/** Kassenbuch (einkauf/kassenbuch.json). */
export const K = () => {
  const b = (app.data.kasse ||= emptyCashbook())
  for (const k of ['entries', 'counts', 'closings']) b[k] ||= []
  b.settings ||= {}
  return b
}
export const PS = () => purchaseSettings(E())
export const editable = () => canEdit(MODULE) && !app.readOnly
export const by = () => app.user?.name || 'Browser'
export const nowIso = () => new Date().toISOString()
export const money = (n) => euro(round2(n))
export const sees = (m) => !app.access || app.access.sees(m)
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
export const newId = (prefix = 'e') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

/** Kategorien fürs Kassenbuch: Einnahmen fest, Ausgaben dazu die Kategorien des Einkaufs (Barkauf mit Vorsteuer). */
export function cashCategories(kind) {
  if (kind === 'einnahme') return CASH_CATEGORIES.einnahme
  const [first, ...rest] = CASH_CATEGORIES.ausgabe
  return [first, ...PS().categories.map((c) => ({ id: `ek-${c.id}`, name: `Barkauf: ${c.name}`, account: c.account, vat: c.vat })), ...rest]
}

// ---------------------------------------------------------------- Belege (PDF, Foto)

// Browser-Modus: Belege nur in diesem Fenster (nicht gespeichert); mit SharePoint unter einkauf/belege/…
const LOCAL = new Map()

/** Foto verkleinern (Handy: oft 4–8 MB): längste Seite höchstens 2000 Pixel, JPEG. PDFs und kleine Bilder bleiben. */
async function shrink(file) {
  if (!/^image\//.test(file.type) || file.size < 600e3 || typeof createImageBitmap !== 'function') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

/**
 * Beleg ablegen: SharePoint unter path (Endung aus der Datei), im Browser-Modus nur für dieses Fenster.
 * Liefert { path, name, type, size, at, by, url?, local? } oder null bei einem Fehler (mit Meldung).
 */
export async function storeBeleg(file, pathFor) {
  if (!file) return null
  if (file.size > 15e6) {
    toast('Die Datei ist zu groß (höchstens 15 MB).')
    return null
  }
  const f = await shrink(file)
  const ext = (f.name.match(/\.(\w{2,4})$/)?.[1] || (f.type === 'application/pdf' ? 'pdf' : 'jpg')).toLowerCase()
  const path = pathFor(ext)
  const meta = { path, name: file.name, type: f.type || 'application/octet-stream', size: f.size, at: nowIso(), by: by() }
  if (app.store?.kind !== 'sharepoint') {
    LOCAL.set(path, f)
    return { ...meta, local: true }
  }
  try {
    const up = await app.store.upload(path, f, meta.type)
    return { ...meta, ...(up?.webUrl ? { url: up.webUrl } : {}) }
  } catch (err) {
    toast(`Beleg nicht gespeichert: ${err.message}`)
    return null
  }
}

/** Beleg öffnen (neuer Tab). */
export async function openBeleg(beleg) {
  if (!beleg) return
  const local = LOCAL.get(beleg.path)
  if (local) return void window.open(URL.createObjectURL(local), '_blank', 'noopener')
  if (beleg.local) return toast('Im Browser-Modus werden Belege nicht gespeichert (nur im Betrieb mit SharePoint).')
  if (beleg.url) return void window.open(beleg.url, '_blank', 'noopener')
  try {
    const blob = await app.store.readBlob?.(beleg.path)
    if (!blob) return toast('Beleg nicht gefunden.')
    window.open(URL.createObjectURL(blob), '_blank', 'noopener')
  } catch (err) {
    toast(`Beleg nicht geöffnet: ${err.message}`)
  }
}

/** Kurzinfo zum Beleg mit Knopf zum Öffnen. */
export const belegChip = (beleg, action, data = {}) =>
  beleg ? `<button type="button" class="pill ek-beleg" data-action="${action}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')} title="${esc(beleg.name)}">Beleg ${esc(beleg.type === 'application/pdf' ? 'PDF' : 'Foto')}${beleg.local ? ' (nur Vorschau)' : ''}</button>` : ''

/** Bytes entpacken (FlateDecode in ZUGFeRD-PDFs). */
export async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// ---------------------------------------------------------------- Kassenbuchung zu einer Zahlung

/**
 * Barzahlung ins Kassenbuch: Einnahme (Ausgangsrechnung) oder Ausgabe (Eingangsrechnung). Wirft mit Hinweis, wenn
 * die Kasse nicht reicht (Stand nie negativ) oder der Tag/Monat gesperrt ist. Liefert den Eintrag.
 */
export function cashForPayment({ kind, date, amount, text, ref, account }) {
  const cat = kind === 'einnahme' ? CASH_CATEGORIES.einnahme.find((c) => c.id === 'rechnung') : CASH_CATEGORIES.ausgabe.find((c) => c.id === 'eingang')
  return addEntry(K(), { date, kind, amount: round2(amount), text, rate: 0, vat: 0, account: account || cat.account, category: cat.id, receipt: ref?.number || '', ref }, { newId: () => newId('k'), now: nowIso(), by: by(), today: todayISO() })
}

// ---------------------------------------------------------------- Zahlungsdialog der Fakturierung (bar bezahlt)

/** Häkchen im Zahlungsdialog der Fakturierung, nur mit Recht auf Einkauf & Kasse. */
export const payCashOption = () => (canEdit(MODULE) && !app.readOnly ? '<label class="check wide"><input type="checkbox" id="fp-cash"><span>bar bezahlt: Einnahme ins Kassenbuch</span></label>' : '')

/**
 * Häkchen gesetzt: Einnahme ins Kassenbuch (mit Bezug auf die Ausgangsrechnung) und deren id zurück; ohne Häkchen null.
 * Wirft mit Hinweis, wenn der Tag oder Monat im Kassenbuch abgeschlossen ist.
 */
export function cashForSalePayment(doc, { date, amount }) {
  if (!document.getElementById('fp-cash')?.checked) return null
  return cashForPayment({ kind: 'einnahme', date, amount, text: `Barzahlung ${doc.recipient?.name || ''} Rechnung ${doc.number}`.replace(/\s+/g, ' ').trim(), ref: { type: 'ausgang', id: doc.id, number: doc.number } }).id
}

/** Kurzer Text für einen Betrag mit Vorzeichen. */
export const signedMoney = (n) => `${n < 0 ? '−' : ''}${money(Math.abs(n))}`
