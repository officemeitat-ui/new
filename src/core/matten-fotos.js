// Mattenwechsel: Fotos auswerten – rein rechnend, ohne Oberfläche (Tests: test/matten-fotos.test.js).
//   - Fotos des Fahrers je Stopp und Tour (stopPhotos, tourPhotos): für das Büro, den Lieferschein-Dialog und den
//     Fotonachweis als PDF (proofRows, proofFileName)
//   - Verlauf je Liegeplatz über alle Touren (placementPhotos), neueste zuerst
//   - Fotopflicht: Einstellung settings.photoRule in matten/matten.json, bei der Freigabe als Kopie an die Tour
//     (tour.photoRule – Fahrer lesen matten.json nicht): 'nie' (freiwillig) | 'ausnahme' (Foto, wenn ein Wechsel nicht
//     möglich war oder niemand angetroffen wurde) | 'immer' (mindestens ein Foto je Stopp) → photoProblem
//   - Liegeplatz-Foto „so liegt die Matte“: placement.photo { path, name, at, by, size? } unter
//     matten/fotos/liegeplatz/<placementId>/ (refPhotoPath); der Stopp trägt die Kopie des Pfads (items[].refPhoto),
//     damit der Fahrer es ohne die Stammdaten öffnen kann.
import { localDate, localTime, PHOTO_RULES, photoProblem, photoRule, placementsOf } from './matten-fahrt.js'

const text = (v) => String(v ?? '').trim()
const safe = (v) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '')
const deDate = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}` : '')

export { PHOTO_RULES, photoProblem, photoRule }

const photoOf = (p, ph) => ({
  placementId: p.placementId,
  placementName: p.placementName || 'Liegeplatz',
  status: p.status,
  reason: p.reason || '',
  path: ph.path,
  name: ph.name || String(ph.path).split('/').pop(),
  at: ph.at || '',
  by: ph.by || '',
  url: ph.url || '',
  queued: !!ph.queued,
  local: !!ph.local,
})

/** Fotos eines Stopps in der Reihenfolge der Liegeplätze: [{ placementId, placementName, status, reason, path, name, at, by, url, queued, local }]. */
export function stopPhotos(stop) {
  return placementsOf(stop).flatMap((p) => (p.photos || []).filter((ph) => ph?.path).map((ph) => photoOf(p, ph)))
}

export const photoCount = (stop) => stopPhotos(stop).length

/** Alle Fotos einer Tour, je Foto dazu tourId, date, stopId, customerName, objectName. */
export function tourPhotos(tour) {
  return (tour?.stops || []).flatMap((s) => stopPhotos(s).map((p) => ({ ...p, tourId: tour.id, date: tour.date, stopId: s.id, customerName: s.customer?.name || '', objectName: s.objectName || '' })))
}

/**
 * Verlauf der Fotos eines Liegeplatzes über alle Touren, neueste zuerst (höchstens limit): je Foto dazu tourId,
 * date (Tag der Tour), stopId und driverName.
 */
export function placementPhotos(tours = [], placementId, { limit = 12 } = {}) {
  if (!placementId) return []
  const out = []
  for (const t of tours || []) {
    for (const s of t?.stops || []) {
      if (!(s.items || []).some((it) => it.placementId === placementId && (it.photos || []).length)) continue
      for (const p of stopPhotos(s)) if (p.placementId === placementId) out.push({ ...p, tourId: t.id, date: t.date, stopId: s.id, driverName: t.driverName || '' })
    }
  }
  out.sort((a, b) => String(b.at || b.date || '').localeCompare(String(a.at || a.date || '')) || String(b.path).localeCompare(String(a.path)))
  return out.slice(0, Math.max(0, limit))
}

/** Kurzer Hinweis für die Stopp-Ansicht des Fahrers ('' bei freiwillig). */
export const photoRuleHint = (rule) => (photoRule(rule) === 'immer' ? 'Foto Pflicht: mindestens ein Foto an diesem Stopp.' : photoRule(rule) === 'ausnahme' ? 'Foto Pflicht, wenn ein Wechsel nicht möglich ist.' : '')

/** Pfad für das Liegeplatz-Foto: matten/fotos/liegeplatz/<placementId>/<JJJJMMTT-HHMMSS>.<ext>. */
export function refPhotoPath(placementId, { now = new Date().toISOString(), ext = 'jpg' } = {}) {
  if (!safe(placementId)) throw new Error('Foto ohne Liegeplatz.')
  const stamp = String(now).replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  return `matten/fotos/liegeplatz/${safe(placementId)}/${safe(stamp) || 'foto'}.${safe(ext) || 'jpg'}`
}

export const isRefPhotoPath = (p) => /^matten\/fotos\/liegeplatz\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.\w+$/.test(String(p || ''))

/**
 * Zeilen für den Fotonachweis (PDF) und die Liste im Büro: je Foto { path, title (Liegeplatz), sub (Tag, Uhrzeit,
 * wer; dazu „nicht möglich: Grund“) }.
 */
export function proofRows(stop, { timeZone = 'Europe/Vienna' } = {}) {
  return stopPhotos(stop).map((p) => {
    const when = p.at ? [deDate(localDate(p.at, timeZone)), localTime(p.at, timeZone) ? `${localTime(p.at, timeZone)} Uhr` : ''].filter(Boolean).join(', ') : ''
    const state = p.status === 'nicht-moeglich' ? `nicht möglich${p.reason ? `: ${p.reason}` : ''}` : ''
    return { path: p.path, title: p.placementName, sub: [when, p.by, state].filter(Boolean).join(' · '), queued: p.queued, local: p.local, url: p.url }
  })
}

/** Dateiname des Fotonachweises: Fotonachweis_<Lieferscheinnummer bzw. Tag>_<Kunde>.pdf. */
export function proofFileName({ number = '', date = '', customerName = '' } = {}) {
  const part = (v) => text(v).replace(/[^A-Za-z0-9ÄÖÜäöüß._-]+/g, '-').replace(/^-+|-+$/g, '')
  return `${['Fotonachweis', part(number) || part(date), part(customerName).slice(0, 40)].filter(Boolean).join('_')}.pdf`
}
