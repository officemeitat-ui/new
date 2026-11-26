// Mattenwechsel: QR-Code am Liegeplatz. Ein Aufkleber je Liegeplatz (export/matten-qr-pdf.js); der Fahrer scannt ihn mit
// der Handykamera: die App öffnet den passenden Stopp seiner Tour von heute und vermerkt am Liegeplatz „vor Ort
// bestätigt (QR)“ mit Uhrzeit – ein Nachweis, dass er wirklich dort war. Reine Funktionen (Tests: test/matten-qr.test.js).
//
// Link auf dem Aufkleber: mit eingerichteter Fahrerseite am Webspace mattentour.php?qr=<Liegeplatz> (Fahrer ohne Konto
// bleiben dort, alle anderen leitet die Seite in die App weiter), sonst direkt die App #mw-touren/qr/<Liegeplatz>.
// Am Liegeplatz in der Tour (erster Eintrag des Liegeplatzes im Stopp): scan { at, by, via? } – der erste Scan zählt.

import { canMoveStop, isFinal, updateStop } from './matten-fahrt.js'

const text = (v) => String(v ?? '').trim()
export const QR_KEY = 'mw-touren/qr/'
const ID = /^[A-Za-z0-9_-]{1,64}$/

/** Link für den Aufkleber. appBase: Adresse der App (ohne #); webBase: Ordner der Fahrerseite (leer = nicht eingerichtet). */
export function qrLink(placementId, { appBase = '', webBase = '' } = {}) {
  const id = encodeURIComponent(text(placementId))
  if (webBase) return `${String(webBase).replace(/\/?$/, '/')}mattentour.php?qr=${id}`
  return `${String(appBase).replace(/#.*$/, '')}#${QR_KEY}${id}`
}

/** Liegeplatz aus dem Teil hinter # (app.ui.linked, klein geschrieben): '' wenn es kein QR-Link ist. */
export function qrIdFromKey(key) {
  const k = text(key)
  if (!k.toLowerCase().startsWith(QR_KEY)) return ''
  const id = k.slice(QR_KEY.length)
  return ID.test(id) ? id : ''
}

/** Liegeplatz-ID aus der Liste (der Teil hinter # kommt klein geschrieben an): gleiche ID ohne Groß/Klein. */
export const matchPlacementId = (id, ids = []) => ids.find((x) => x === id) || ids.find((x) => String(x).toLowerCase() === String(id).toLowerCase()) || ''

/**
 * Stopp für einen Scan: offene Stopps von Touren (freigegeben bzw. unterwegs) mit dem Liegeplatz – zuerst heute, dann
 * liegen gebliebene vergangener Tage. tours: die des Fahrers (bzw. alle fürs Büro). → { tour, stop } | null
 */
export function scanTarget(tours = [], placementId, { today } = {}) {
  const live = (tours || []).filter((t) => t && ['freigegeben', 'unterwegs'].includes(t.status) && t.date <= today)
  const order = [...live.filter((t) => t.date === today), ...live.filter((t) => t.date < today).sort((a, b) => b.date.localeCompare(a.date))]
  const want = String(placementId).toLowerCase()
  for (const tour of order) {
    for (const stop of tour.stops || []) {
      if (isFinal(stop)) continue
      if ((stop.items || []).some((it) => String(it.placementId).toLowerCase() === want)) return { tour, stop, placementId: (stop.items || []).find((it) => String(it.placementId).toLowerCase() === want).placementId }
    }
  }
  return null
}

/**
 * Scan am Liegeplatz vermerken (Kopie): scan { at, by, via? } am ersten Eintrag des Liegeplatzes, der erste Scan zählt;
 * ein noch nicht angefahrener Stopp kommt auf „in Bearbeitung“ (wie „Angekommen“). Abgeschlossene Stopps: unverändert.
 */
export function markScanned(tour, stopId, placementId, { now = new Date().toISOString(), by = '', via = '' } = {}) {
  const stop = (tour?.stops || []).find((s) => s.id === stopId)
  if (!stop || isFinal(stop)) return tour
  const lead = (stop.items || []).findIndex((it) => it.placementId === placementId)
  if (lead < 0) throw new Error('Liegeplatz nicht im Stopp.')
  if (stop.items[lead].scan) return tour
  return updateStop(
    tour,
    stopId,
    (s) => {
      const items = [...s.items]
      items[lead] = { ...items[lead], scan: { at: now, by, ...(via ? { via } : {}) } }
      const status = canMoveStop(s.status || 'geplant', 'in-bearbeitung') && ['geplant', 'unterwegs'].includes(s.status || 'geplant') ? 'in-bearbeitung' : s.status
      return { ...s, items, status }
    },
    { now, by, keepStatus: true },
  )
}

/** Scans eines Stopps je Liegeplatz: Map placementId → scan. */
export function scansOf(stop) {
  const out = new Map()
  for (const it of stop?.items || []) if (it.scan && !out.has(it.placementId)) out.set(it.placementId, it.scan)
  return out
}
