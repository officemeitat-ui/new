// Mattenwechsel P10b: Fahrerseite am Webspace für Fahrer ohne Microsoft-Konto (mattentour.php; Entscheidung E7 „gemischt“)
// – rein rechnend, ohne Oberfläche (Tests: test/matten-webspace.test.js). Plan: docs/MATTENWECHSEL-PLAN.md, P10b.
//
// App → Webspace: beim Freigeben die Tour als schmale Kopie (webTourPayload: Kunde nur mit Namen, Objekt, Adresse,
// Koordinaten, Zeitfenster, Ankunft, Liegeplätze mit Stockwerk, Zugang, Hinweis, Matten mit Bezeichnung und Soll,
// Reihenfolge, Ladeliste) – keine Preise, keine Kundennummer, keine E-Mail-Adressen, keine Einsatz-Schlüssel. Der Fahrer
// ist nur über den Hashwert seines persönlichen Codes bekannt (wie bei „Plan am Handy“; ist er in den Mitarbeitenden und
// hat schon den Link von Plan am Handy, ist es derselbe Code).
// Webspace → App: Meldungen { id, art: start | unterwegs | abschluss, tour, stopp, zeit (Unix-Sekunden), eingang, status,
// daten { liegeplaetze [{ id, ergebnis: gewechselt | nicht-moeglich | '', mengen [{ i, ist }], grund, bemerkung }],
// ausnahme, notiz, unterschrift { name, funktion, pfad } | null, ohne { grund } | null }, fotos [{ datei, liegeplatz }] }.
// applyWebEvents übernimmt sie mit denselben Rechenkernen wie die Fahreransicht der App (core/matten-fahrt.js:
// startTour, setStopStatus, setQuantity, confirmPlacement, markNotPossible, setPlacementNote, addPlacementPhoto,
// finishStop); dieselbe Meldung zweimal ändert nichts (Kennung an der Tour in webspace.applied, am Stopp in web.event).
// Fotos bekommen feste Pfade (Nummern ab 51 je Liegeplatz), damit ein wiederholter Abgleich dieselbe Datei trifft.

import { addPlacementPhoto, confirmPlacement, finishStop, isFinal, localDate, markNotPossible, orderedStops, photoPath, placementsOf, setPlacementNote, setQuantity, setStopStatus, startTour } from './matten-fahrt.js'
import { loadList } from './matten-tour.js'

export const WEB_PAGE = 'mattentour.php'
/** So lange (Tage nach dem Tag der Tour) bleiben Touren, Meldungen und Fotos höchstens am Webspace. */
export const WEB_KEEP_DAYS = 14
/** Erste Nummer der Fotos vom Webspace je Liegeplatz (die App zählt ab 1). */
export const WEB_PHOTO_START = 51
export const WEB_DEFAULTS = { enabled: false, key: '', officeTopic: '', officeEmails: '', sender: '', keepDays: WEB_KEEP_DAYS }
/** Wie viele Kennungen übernommener Meldungen die Tour sich merkt. */
const APPLIED_MAX = 300

const text = (v) => String(v ?? '').trim()
const int = (v) => Math.max(0, Math.round(Number(v) || 0))
const isHash = (v) => /^[a-f0-9]{64}$/.test(String(v || ''))
const hasCoords = (s) => Number.isFinite(Number(s?.lat)) && Number.isFinite(Number(s?.lon)) && s?.lat !== null && s?.lon !== null && s?.lat !== '' && s?.lon !== ''

/** Persönlicher Link zur Fahrerseite. */
export const webLink = (address, code) => `${String(address).replace(/\/?$/, '/')}${WEB_PAGE}?p=${encodeURIComponent(code)}`

/** Fahrer ohne Microsoft-Konto (Fahrerseite am Webspace)? */
export const isWebDriver = (d) => d?.webspace === true

/** Hängt die Tour am Webspace (Fahrer ohne Konto)? */
export const tourOnWebspace = (tour) => isHash(tour?.webspace?.hash)

/**
 * Was dem Fahrer ohne Konto noch fehlt ('' = in Ordnung): ein Link (Code bzw. der von Plan am Handy). Fehlt er, legt
 * „Speichern“ im Dialog „Fahrer“ einen an.
 */
export function webDriverProblem(d) {
  if (!isWebDriver(d)) return ''
  if (!isHash(d.web?.hash)) return `${d.name || 'Der Fahrer'} hat noch keinen Link zur Fahrerseite: im Dialog „Fahrer“ speichern.`
  return ''
}

/** Kennung des Fahrers an der Tour: { hash, name, lang } aus dem Eintrag der Einstellungen (hash: frisch berechnet, wenn bekannt). */
export function webIdentity(driver, { hash = '' } = {}) {
  const h = isHash(hash) ? hash : driver?.web?.hash
  if (!isWebDriver(driver) || !isHash(h)) return null
  return { hash: h, name: text(driver.name), lang: text(driver.lang) || 'de' }
}

/** Fahrer ohne Konto für den Webspace: [{ hash, name, sprache }] (der Code selbst geht nie hinaus). */
export function webDriversPayload(drivers = []) {
  const out = []
  const seen = new Set()
  for (const d of drivers || []) {
    if (!isWebDriver(d) || d.active === false || !isHash(d.web?.hash) || seen.has(d.web.hash)) continue
    seen.add(d.web.hash)
    out.push({ hash: d.web.hash, name: text(d.name), sprache: text(d.lang) || 'de' })
  }
  return out
}

/** Bezeichnung einer Matte wie in der Fahreransicht („85 × 150 cm, grau“). */
export const webMatLabel = (m) => [m?.size, m?.color].filter(Boolean).join(', ') || text(m?.name) || 'Matte'

/**
 * Tour für den Webspace (aktion=tour): nur, was der Fahrer zum Wechseln braucht. Keine Preise, keine Kundennummer,
 * keine Lieferschein-Mail, keine Einsatz-Schlüssel, keine Artikel. matten[].i ist der Index der Matte in stop.items
 * (für die Rückmeldung der Menge). identity: { hash, name, lang } (webIdentity).
 */
export function webTourPayload(tour, identity) {
  if (!tour?.id || !identity || !isHash(identity.hash)) return null
  const stopps = orderedStops(tour).map((s) => ({
    id: s.id,
    kunde: text(s.customer?.name),
    objekt: text(s.objectName),
    adresse: text(s.address),
    lat: hasCoords(s) ? Number(s.lat) : null,
    lon: hasCoords(s) ? Number(s.lon) : null,
    ankunft: text(s.times?.arrival),
    fenster: { von: text(s.window?.from), bis: text(s.window?.to), hinweis: text(s.windowNote) },
    status: s.status || 'geplant',
    liegeplaetze: placementsOf(s).map((p) => ({
      id: p.placementId,
      name: text(p.placementName),
      stockwerk: text(p.floor),
      zugang: text(p.access),
      hinweis: text(p.hint),
      matten: p.items.map((it, k) => ({ i: p.indexes[k], bezeichnung: webMatLabel(it.mat), soll: int(it.planned) })),
    })),
  }))
  return {
    id: tour.id,
    datum: tour.date,
    status: tour.status === 'entwurf' ? 'freigegeben' : tour.status,
    fahrer: { hash: identity.hash, name: text(identity.name), sprache: text(identity.lang) || 'de' },
    fahrzeug: text(tour.vehicleLabel),
    stopps,
    ladeliste: loadList(tour).map((r) => ({ groesse: text(r.size), farbe: text(r.color), bezeichnung: webMatLabel(r), stueck: int(r.qty), stopps: int(r.stops) })),
  }
}

/** Kennung des Fahrers an die Tour (beim Freigeben); ohne Kennung: entfernt. */
export function withWebspace(tour, identity) {
  const next = { ...tour }
  if (!identity) {
    delete next.webspace
    return next
  }
  next.webspace = { ...(tour.webspace || {}), hash: identity.hash, name: identity.name, lang: identity.lang }
  delete next.webspace.publishedAt
  delete next.webspace.error
  return next
}

// ---------------------------------------------------------------- Unterschrift vom Webspace

const SIG_PATTERN = /^M[0-9. ML]{2,16000}$/

/**
 * Unterschrift vom Webspace (Striche als Pfad „M12 30L14 31…“ im Feld 600 × 200) als SVG wie in der App (300 × 100,
 * ui/signature.js). '' wenn der Pfad nicht lesbar ist oder kaum etwas gezeichnet wurde.
 */
export function webSignatureSvg(path) {
  const p = String(path || '').trim()
  if (!SIG_PATTERN.test(p)) return ''
  const strokes = []
  for (const part of p.split('M').filter(Boolean)) {
    const pts = []
    for (const xy of part.split('L')) {
      const [x, y] = xy.trim().split(/\s+/).map(Number)
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 600 || y > 200) return ''
      pts.push([Math.round(x * 5) / 10, Math.round(y * 5) / 10])
    }
    if (pts.length) strokes.push(pts)
  }
  if (strokes.reduce((n, s) => n + s.length, 0) < 4) return ''
  const d = strokes.map((s) => `M${s.map(([x, y]) => `${x} ${y}`).join('L')}`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100" width="300" height="100"><path d="${d}" fill="none" stroke="#13232f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

// ---------------------------------------------------------------- Meldungen vom Webspace

const ARTEN = ['start', 'unterwegs', 'abschluss']
const ERGEBNISSE = ['gewechselt', 'nicht-moeglich', '']
const AUSNAHMEN = ['nicht-angetroffen', 'teilweise', 'nicht-durchgefuehrt']

/** Meldung vom Webspace prüfen und auf bekannte Felder kürzen (null = unbrauchbar). */
export function cleanWebEvent(m) {
  if (!m || typeof m !== 'object') return null
  const id = String(m.id || '')
  if (!/^[a-z0-9]{8,32}$/.test(id) || !ARTEN.includes(m.art) || !/^[A-Za-z0-9_-]{4,40}$/.test(String(m.tour || ''))) return null
  const zeit = Number(m.zeit) > 0 ? Math.round(Number(m.zeit)) : Math.round(Number(m.eingang) || 0)
  const out = { id, art: m.art, tour: String(m.tour), stopp: text(m.stopp), zeit, eingang: Math.round(Number(m.eingang) || zeit), fahrer: text(m.fahrer) }
  if (m.art !== 'start' && !out.stopp) return null
  if (m.art !== 'abschluss') return out
  const d = m.daten && typeof m.daten === 'object' ? m.daten : {}
  out.daten = {
    liegeplaetze: (Array.isArray(d.liegeplaetze) ? d.liegeplaetze : [])
      .filter((l) => l && text(l.id))
      .map((l) => ({
        id: text(l.id),
        ergebnis: ERGEBNISSE.includes(l.ergebnis) ? l.ergebnis : '',
        mengen: (Array.isArray(l.mengen) ? l.mengen : []).filter((x) => Number.isInteger(Number(x?.i)) && Number(x.i) >= 0).map((x) => ({ i: Number(x.i), ist: Math.min(999, int(x.ist)) })),
        grund: text(l.grund).slice(0, 120),
        bemerkung: text(l.bemerkung).slice(0, 500),
      })),
    ausnahme: AUSNAHMEN.includes(d.ausnahme) ? d.ausnahme : '',
    notiz: text(d.notiz).slice(0, 500),
    unterschrift: d.unterschrift && typeof d.unterschrift === 'object' ? { name: text(d.unterschrift.name).slice(0, 80), funktion: text(d.unterschrift.funktion).slice(0, 80), pfad: String(d.unterschrift.pfad || '') } : null,
    ohne: d.ohne && typeof d.ohne === 'object' ? { grund: text(d.ohne.grund).slice(0, 120) } : null,
  }
  out.fotos = (Array.isArray(m.fotos) ? m.fotos : []).filter((f) => /^[a-z0-9]{8,32}-\d{1,2}\.jpg$/.test(String(f?.datei || '')) && text(f.liegeplatz)).map((f) => ({ datei: f.datei, liegeplatz: text(f.liegeplatz), size: int(f.groesse) }))
  return out
}

/** Zeitpunkt der Meldung als ISO. */
const eventIso = (ev) => new Date((Number(ev.zeit) || Number(ev.eingang) || 0) * 1000).toISOString()

/**
 * Fotos einer Meldung mit ihrem Ziel in SharePoint: [{ datei, placementId, path, name, size }] – Pfad wie in der App
 * (photoPath: matten/fotos/<Jahr>/<Liegeplatz>/<Datum>_<TourId>_<NN>.jpg), NN fest ab WEB_PHOTO_START je Liegeplatz.
 */
export function webPhotoTargets(tour, ev) {
  const date = localDate(eventIso(ev)) || tour?.date
  const count = new Map()
  return (ev?.fotos || []).map((f) => {
    const k = count.get(f.liegeplatz) || 0
    count.set(f.liegeplatz, k + 1)
    const path = photoPath({ tour, placementId: f.liegeplatz, date, n: WEB_PHOTO_START + k })
    return { datei: f.datei, placementId: f.liegeplatz, path, name: path.split('/').pop(), size: f.size || 0 }
  })
}

const stopOf = (tour, id) => (tour?.stops || []).find((s) => s.id === id) || null
const hasPlacement = (stop, placementId) => (stop?.items || []).some((it) => it.placementId === placementId)

/** Stopp ohne die Fahrer-Regeln ändern (Merker am fertigen Stopp). */
function patchStop(tour, stopId, fn) {
  return { ...tour, stops: (tour.stops || []).map((s) => (s.id === stopId ? fn(s) : s)) }
}

/**
 * Eine Abschluss-Meldung auf den Stopp anwenden (wie der Fahrer in der App): Mengen vorbelegen und „Gewechselt“, „Nicht
 * möglich“ mit Grund, Bemerkung und Fotos je Liegeplatz, dann finishStop mit Unterschrift bzw. ohne Unterschrift mit Grund
 * und der Ausnahme für noch offene Liegeplätze. Passt die Ausnahme nicht mehr (z. B. Liegeplätze anders als am Webspace),
 * wird mit „Teilweise erledigt“ bzw. „Nicht durchgeführt“ abgeschlossen.
 */
function applyFinish(tour, ev, { by, photos }) {
  const sid = ev.stopp
  const at = eventIso(ev)
  const o = { now: at, by }
  let t = tour
  for (const l of ev.daten.liegeplaetze) {
    if (!hasPlacement(stopOf(t, sid), l.id)) continue
    if (l.ergebnis === 'gewechselt') {
      for (const { i, ist } of l.mengen) if (stopOf(t, sid).items?.[i]?.placementId === l.id) t = setQuantity(t, sid, i, ist, o)
      t = confirmPlacement(t, sid, l.id, o)
    } else if (l.ergebnis === 'nicht-moeglich') t = markNotPossible(t, sid, l.id, l.grund || 'nicht möglich', o)
    if (l.bemerkung) t = setPlacementNote(t, sid, l.id, l.bemerkung, o)
  }
  for (const p of photos) if (hasPlacement(stopOf(t, sid), p.placementId)) t = addPlacementPhoto(t, sid, p.placementId, { name: p.name, path: p.path, at, by, size: p.size, via: 'webspace' }, o)
  const d = ev.daten
  const svg = d.unterschrift ? webSignatureSvg(d.unterschrift.pfad) : ''
  const signature = svg && d.unterschrift.name ? { name: d.unterschrift.name, role: d.unterschrift.funktion, svg } : null
  const reason = signature ? '' : d.ohne?.grund || (d.unterschrift ? 'Unterschrift am Webspace nicht lesbar' : '')
  const base = { signature, reason, note: d.notiz || undefined, now: at, by, driverId: tour.driverId || '' }
  try {
    return finishStop(t, sid, { ...base, outcome: d.ausnahme })
  } catch (first) {
    const anyDone = (stopOf(t, sid).items || []).some((it) => it.status === 'gewechselt')
    try {
      return finishStop(t, sid, { ...base, outcome: anyDone ? 'teilweise' : 'nicht-durchgefuehrt', reason: base.reason || (signature ? '' : 'ohne Unterschrift (Webspace)') })
    } catch {
      throw first
    }
  }
}

/**
 * Meldungen vom Webspace in eine Tour übernehmen (rein, liefert Kopien):
 * { tour, applied: [Kennung], done: [Kennung], skipped: [{ id, reason }], notes: [{ id, stopId, reason }],
 *   uploads: [{ id, datei, placementId, path }] }.
 *  applied  neu übernommen; done = applied und schon früher übernommene bzw. nicht mehr nötige (am Webspace als
 *           „übernommen“ melden); skipped: bleibt am Webspace (Tour ist Entwurf, Stopp fehlt, Fehler).
 *  uploads  Fotos, die vor dem Speichern nach SharePoint gehören (fester Pfad, siehe webPhotoTargets).
 * Ein schon abgeschlossener Stopp (z. B. im Büro nach einem Anruf) bleibt, wie er ist; seine Fotos kommen dazu (notes).
 * opts: { now (ISO, für updatedAt der Tour), by (Name für updatedBy, Vorgabe „Webspace“) }.
 */
export function applyWebEvents(tour, events = [], { now = new Date().toISOString(), by = '' } = {}) {
  let t = tour
  const applied = []
  const done = []
  const skipped = []
  const uploads = []
  const notes = []
  const seen = new Set(tour?.webspace?.applied || [])
  const list = (events || [])
    .map(cleanWebEvent)
    .filter((ev) => ev && ev.tour === tour?.id)
    .sort((a, b) => a.zeit - b.zeit || a.eingang - b.eingang || a.id.localeCompare(b.id))
  const driver = text(tour?.driverName) || 'Fahrer'
  for (const ev of list) {
    if (seen.has(ev.id)) {
      done.push(ev.id)
      continue
    }
    if (t.status === 'entwurf') {
      skipped.push({ id: ev.id, reason: 'Die Tour ist nicht mehr freigegeben.' })
      continue
    }
    const who = text(ev.fahrer) || driver
    const at = eventIso(ev)
    try {
      if (ev.art === 'start') {
        if (t.status === 'freigegeben') t = startTour(t, { now: at, by: who })
      } else {
        const stop = stopOf(t, ev.stopp)
        if (!stop) {
          skipped.push({ id: ev.id, reason: 'Diesen Stopp gibt es in der Tour nicht mehr.' })
          continue
        }
        if (ev.art === 'unterwegs') {
          if (!isFinal(stop) && (stop.status || 'geplant') === 'geplant') t = setStopStatus(t, ev.stopp, 'unterwegs', { now: at, by: who })
        } else {
          const photos = webPhotoTargets(t, ev).filter((p) => hasPlacement(stop, p.placementId))
          if (isFinal(stop)) {
            // schon abgeschlossen (Büro oder früherer Abgleich): nur die Fotos dazu, nichts überschreiben
            for (const p of photos) t = addPlacementPhoto(t, ev.stopp, p.placementId, { name: p.name, path: p.path, at, by: who, size: p.size, via: 'webspace' }, { now: at, by: who, force: true })
            if (stop.web?.event !== ev.id) notes.push({ id: ev.id, stopId: ev.stopp, reason: 'Der Stopp war schon abgeschlossen; nur die Fotos wurden übernommen.' })
          } else {
            t = applyFinish(t, ev, { by: who, photos })
            t = patchStop(t, ev.stopp, (s) => ({ ...s, web: { event: ev.id, at: new Date((ev.eingang || ev.zeit) * 1000).toISOString() }, updatedAt: now }))
          }
          for (const p of photos) uploads.push({ id: ev.id, datei: p.datei, placementId: p.placementId, path: p.path })
        }
      }
    } catch (err) {
      skipped.push({ id: ev.id, reason: String(err?.message || err) })
      continue
    }
    applied.push(ev.id)
    done.push(ev.id)
  }
  if (applied.length) {
    const ids = [...(tour.webspace?.applied || []), ...applied].slice(-APPLIED_MAX)
    t = { ...t, webspace: { ...(t.webspace || {}), applied: ids }, updatedAt: now, updatedBy: by || `Webspace (${driver})` }
  }
  return { tour: t, applied, done, skipped, notes, uploads }
}

/** Meldungen nach Tour: Map Tour-ID → [Meldung] (nur brauchbare). */
export function eventsByTour(events = []) {
  const out = new Map()
  for (const m of events || []) {
    const ev = cleanWebEvent(m)
    if (!ev) continue
    if (!out.has(ev.tour)) out.set(ev.tour, [])
    out.get(ev.tour).push(m)
  }
  return out
}

// ---------------------------------------------------------------- Nachricht mit dem Link

/** Nachricht mit dem persönlichen Link (WhatsApp, E-Mail) je Sprache. */
export const TOUR_LINK_TEXTS = {
  de: { betreff: 'Deine Matten-Tour am Handy', text: 'Hallo {name},\n\nhier ist dein persönlicher Link für die Matten-Touren ({produkt}):\n{link}\n\nEinmal öffnen, dann im Browser-Menü „Zum Startbildschirm“ wählen. Dort siehst du deine Touren, startest die Navigation und bestätigst je Liegeplatz den Wechsel.\n\nDer Link ist nur für dich, bitte nicht weitergeben.' },
  bks: { betreff: 'Tvoja tura otirača na mobitelu', text: 'Zdravo {name},\n\novo je tvoj lični link za ture otirača ({produkt}):\n{link}\n\nOtvori ga jednom, zatim u meniju preglednika odaberi „Dodaj na početni ekran“. Tamo vidiš svoje ture, pokrećeš navigaciju i potvrđuješ zamjenu za svako mjesto.\n\nLink je samo za tebe, nemoj ga dijeliti.' },
  ro: { betreff: 'Traseul tău de covorașe pe telefon', text: 'Bună, {name},\n\nacesta este linkul tău personal pentru traseele de covorașe ({produkt}):\n{link}\n\nDeschide-l o dată, apoi în meniul browserului alege „Adaugă pe ecranul de pornire”. Acolo îți vezi traseele, pornești navigația și confirmi schimbul pentru fiecare loc.\n\nLinkul este doar pentru tine, te rugăm să nu-l dai mai departe.' },
  tr: { betreff: 'Telefonunda paspas turun', text: 'Merhaba {name},\n\npaspas turları için kişisel bağlantın burada ({produkt}):\n{link}\n\nBir kez aç, sonra tarayıcı menüsünde “Ana ekrana ekle” seç. Orada turlarını görür, navigasyonu başlatır ve her paspas yeri için değişimi onaylarsın.\n\nBağlantı sadece senin için, lütfen kimseyle paylaşma.' },
  hu: { betreff: 'A lábtörlő-túrád a telefonon', text: 'Szia {name}!\n\nItt a személyes linked a lábtörlő-túrákhoz ({produkt}):\n{link}\n\nNyisd meg egyszer, aztán a böngésző menüjében válaszd a „Hozzáadás a kezdőképernyőhöz” lehetőséget. Ott látod a túráidat, elindítod a navigációt, és minden helynél megerősíted a cserét.\n\nA link csak neked szól, kérjük, ne add tovább.' },
  en: { betreff: 'Your mat route on your phone', text: 'Hello {name},\n\nhere is your personal link for the mat routes ({produkt}):\n{link}\n\nOpen it once, then choose “Add to Home Screen” in the browser menu. There you see your routes, start the navigation and confirm the exchange for each mat location.\n\nThis link is only for you, please do not share it.' },
}

/** Nachricht mit dem Link in der Sprache des Fahrers: { subject, text }. */
export function tourLinkMessage(lang, { name, product, link }) {
  const t = TOUR_LINK_TEXTS[lang] || TOUR_LINK_TEXTS.de
  const v = { name: text(name).split(' ')[0] || text(name), produkt: product, link }
  const fill = (s) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m))
  return { subject: fill(t.betreff), text: fill(t.text) }
}
