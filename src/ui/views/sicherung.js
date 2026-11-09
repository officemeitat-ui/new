// Datensicherung (nur Vollzugriff, Verwaltung → Datensicherung): alle Dateien der App aus SharePoint (App-Ordner
// Plattform/: JSON-Dateien samt Modul- und Jahres-Dateien und Touren je Jahr, auf Wunsch PDFs und Fotos) als ZIP-Datei
// mit manifest.json herunterladen, eine Sicherung prüfen (Prüfsummen, Vergleich mit dem aktuellen Stand) und einzelne
// Dateien nach Auswahl und Bestätigung zurückspielen – vorher kommt der aktuelle Stand der Datei nach
// Plattform/_Sicherung/<Datum>/ (Rückweg). Nie automatisch. Erinnerung in „Zu erledigen“ (Vorgabe alle 30 Tage).
// Rechenkern: core/sicherung.js. ZIP: vendor/jszip.min.js (wie Leistungsnachweis und Zeiterfassung). Kürzel sich-.

import { addDays, formatDate, todayISO } from '../../core/dates.js'
import {
  SICH_EVERY_CHOICES,
  SICH_RUECKWEG,
  sichArt,
  sichAuswahl,
  sichFaellig,
  sichGroesse,
  sichManifest,
  sichPruefen,
  sichPruefsumme,
  sichRechte,
  sichRueckwegPfad,
  sichVergleich,
  sichZipBauen,
  sichZipLesen,
  sichZipName,
  sichZurueckspielbar,
} from '../../core/sicherung.js'
import { app, confirmStep, persist, registerActions, registerView, renderNow, toast } from '../context.js'
import { loadScript } from '../load-script.js'
import { registerTodo } from '../modals/todo.js'
import { download, esc, ICON } from '../shared.js'

const VIEW = 'sicherung'
const MAX_LISTE = 300 // so viele Zeilen je Liste, der Rest als „… und n weitere“
const PARALLEL = 4
// Zustand dieser Sitzung (nicht in app.data: nichts davon wird gespeichert)
const S = { liste: null, lesen: false, fehler: '', anhaenge: false, lauf: null, bericht: null, pruef: null }

const mayUse = () => sichRechte(app.access).backup
const settings = () => app.data?.settings?.sicherung || {}
const enc = (data) => new TextEncoder().encode(JSON.stringify(data, null, 1))
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const when = (iso) => (iso ? new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–')
const TYPES = { json: 'application/json', pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', svg: 'image/svg+xml', xml: 'application/xml', txt: 'text/plain' }
const typeOf = (path) => TYPES[String(path).split('.').pop().toLowerCase()] || 'application/octet-stream'
const message = (err) => String(err?.message || err || 'Fehler')

let last = 0
/** Fortschritt zeichnen, höchstens alle 250 ms (nur, wenn die Ansicht offen ist). */
function redraw(force = false) {
  if (app.ui.view !== VIEW || app.ui.modal) return
  if (!force && Date.now() - last < 250) return
  last = Date.now()
  renderNow()
}

/** Version der App: Name des gebauten Einstiegs (app-<Hash>.js), im Quellcode „Quellcode“. */
function appVersion() {
  const src = [...document.querySelectorAll('script[type="module"][src]')].map((s) => s.getAttribute('src') || '').find((s) => /(^|\/)app[-.]/.test(s)) || ''
  return /app-([A-Za-z0-9]+)\.js/.exec(src)?.[1] || 'Quellcode'
}

// ---------------------------------------------------------------- Ablage

/**
 * SharePoint direkt (ohne die Warteschlange des Geräts: ohne Netz geht nichts) oder die Ablage dieses Browsers.
 * liste() → [{ path, size, etag, modified }] ab dem App-Ordner; lesen(path) → Uint8Array | null; jetzt(path) → { bytes,
 * etag } | null; rueckweg(datum, path, bytes) → Pfad der Kopie; zurueck(path, bytes, etag) schreibt den gesicherten Stand.
 */
function ablage() {
  const sp = app.store?.remote || app.store
  if (sp?.kind === 'sharepoint' && typeof sp.listTree === 'function') {
    const base = sp.folder
    const lesen = async (path) => {
      const b = await sp.readBlob(path)
      return b ? new Uint8Array(await b.arrayBuffer()) : null
    }
    return {
      art: 'SharePoint',
      ordner: base,
      ort: sp.label || '',
      liste: async () => (await sp.listTree(base, { depth: 12, skip: [SICH_RUECKWEG] })).map((f) => ({ path: f.path.slice(base.length + 1), size: f.size || 0, etag: f.etag ?? null, modified: f.modified || null })),
      lesen,
      jetzt: async (path) => {
        const etag = await sp.etagOf(path)
        if (!etag) return null
        const bytes = await lesen(path)
        return bytes ? { bytes, etag } : null
      },
      rueckweg: async (datum, path, bytes) => {
        for (let n = 1; n <= 20; n++) {
          const rel = sichRueckwegPfad(datum, path, n)
          if (await sp.writeRootNew(`${base}/${rel}`, new Blob([bytes], { type: typeOf(path) }), typeOf(path))) return `${base}/${rel}`
        }
        throw new Error('Rückweg: schon 20 Kopien dieser Datei von heute')
      },
      zurueck: async (path, bytes, etag) => {
        // JSON wie die App (mit eTag: hat inzwischen jemand gespeichert, kommt ein Konflikt statt eines Überschreibens)
        if (sichArt(path) === 'daten') return app.store.write(path, JSON.parse(new TextDecoder().decode(bytes)), etag || undefined)
        return sp.upload(path, new Blob([bytes], { type: typeOf(path) }), typeOf(path))
      },
    }
  }
  const ls = app.store
  if (!ls || typeof ls.list !== 'function') return null
  const jetzt = async (path) => {
    const d = await ls.read(path)
    return d ? { bytes: enc(d.data), etag: d.etag, modified: d.modifiedAt || null } : null
  }
  return {
    art: 'Browser',
    ordner: 'Plattform',
    ort: 'dieser Browser',
    liste: async () => {
      const out = []
      for (const path of await ls.list('')) {
        const d = await jetzt(path)
        if (d) out.push({ path, size: d.bytes.length, etag: d.etag, modified: d.modified })
      }
      return out
    },
    lesen: async (path) => (await jetzt(path))?.bytes || null,
    jetzt,
    rueckweg: async (datum, path, bytes) => {
      for (let n = 1; n <= 20; n++) {
        const rel = sichRueckwegPfad(datum, path, n)
        try {
          await ls.write(rel, JSON.parse(new TextDecoder().decode(bytes)))
          return rel
        } catch (err) {
          if (err?.name !== 'ConflictError') throw err
        }
      }
      throw new Error('Rückweg: schon 20 Kopien dieser Datei von heute')
    },
    zurueck: (path, bytes, etag) => ls.write(path, JSON.parse(new TextDecoder().decode(bytes)), etag ?? undefined),
  }
}

/** Pfade, die die App geladen hat (mit eTag, gibt es also): kommen mit, auch wenn die Liste sie nicht hatte. */
const knownPaths = () => [...(app.service?.etags?.keys?.() || [])]

// ---------------------------------------------------------------- Sicherung herunterladen

async function listen() {
  const a = ablage()
  if (!a) return toast('Keine Ablage verbunden.')
  S.lesen = true
  S.fehler = ''
  redraw(true)
  try {
    S.liste = { at: new Date().toISOString(), files: await a.liste() }
  } catch (err) {
    S.fehler = `Liste der Dateien nicht lesbar: ${message(err)}`
  }
  S.lesen = false
  redraw(true)
}

const auswahl = () => sichAuswahl({ files: S.liste?.files || [], known: knownPaths(), anhaenge: S.anhaenge })

async function erstellen() {
  const a = ablage()
  if (!a || !S.liste || S.lauf?.running) return
  const sel = auswahl()
  const lauf = (S.lauf = { running: true, abbrechen: false, total: sel.dateien.length, done: 0, bytes: 0, fehler: [], zip: 0 })
  S.bericht = null
  redraw(true)
  const files = []
  const queue = [...sel.dateien]
  const worker = async () => {
    while (queue.length && !lauf.abbrechen) {
      const f = queue.shift()
      try {
        const bytes = await a.lesen(f.path)
        if (!bytes) throw new Error('nicht gefunden')
        files.push({ pfad: f.path, art: f.art, bytes, groesse: bytes.length, sha256: await sichPruefsumme(bytes), etag: f.etag, geaendert: f.modified })
        lauf.bytes += bytes.length
      } catch (err) {
        lauf.fehler.push({ pfad: f.path, fehler: message(err) })
      }
      lauf.done++
      redraw()
    }
  }
  try {
    await Promise.all(Array.from({ length: PARALLEL }, worker))
    if (lauf.abbrechen) {
      S.bericht = { abgebrochen: true, done: lauf.done, total: lauf.total }
      return
    }
    await loadScript('vendor/jszip.min.js')
    const erstellt = new Date().toISOString()
    const manifest = sichManifest({
      erstellt,
      app: { name: app.config?.brand?.app || app.config?.brand?.name || 'App', version: appVersion() },
      quelle: { ablage: a.art, ordner: a.ordner, ort: a.ort },
      von: app.user?.name || '',
      anhaenge: S.anhaenge,
      dateien: files,
      fehler: lauf.fehler,
      ausgelassen: sel.ausgelassen,
    })
    lauf.zip = 1
    redraw(true)
    const blob = await sichZipBauen(globalThis.JSZip, manifest, files)
    const name = sichZipName(todayISO(), app.config?.brand?.name)
    download(name, blob)
    S.bericht = { at: erstellt, name, dateien: files.length, bytes: manifest.groesse, zipBytes: blob.size, fehler: lauf.fehler, anhaenge: S.anhaenge, ausgelassen: sel.ausgelassen }
    // Datum der letzten Sicherung in den Einstellungen der App (daten/stammdaten.json → settings.sicherung)
    app.data.settings = { ...(app.data.settings || {}), sicherung: { ...settings(), datum: todayISO(), at: erstellt, by: app.user?.name || '', dateien: files.length, bytes: manifest.groesse, fehler: lauf.fehler.length, anhaenge: S.anhaenge } }
    persist()
    toast(lauf.fehler.length ? `Sicherung heruntergeladen, ${plural(lauf.fehler.length, 'Datei', 'Dateien')} mit Fehler (siehe Bericht).` : 'Sicherung heruntergeladen.')
  } catch (err) {
    S.bericht = { error: message(err) }
  } finally {
    lauf.running = false
    S.lauf = null
    redraw(true)
  }
}

// ---------------------------------------------------------------- Sicherung prüfen

async function pruefen(file) {
  const a = ablage()
  if (!file || !a) return
  const p = (S.pruef = { name: file.name, phase: 'lesen', schritt: 0, n: 0, wahl: new Set(), zurueck: {}, fehler: '' })
  redraw(true)
  try {
    await loadScript('vendor/jszip.min.js')
    const z = await sichZipLesen(globalThis.JSZip, await file.arrayBuffer())
    p.manifest = z.manifest
    p.lesen = z.lesen
    p.phase = 'pruefen'
    p.n = z.manifest.dateien.length
    redraw(true)
    p.pruefung = await sichPruefen(z.manifest, z.lesen, { namen: z.namen, onStep: (i) => ((p.schritt = i), redraw()) })
    p.phase = 'vergleichen'
    redraw(true)
    p.vergleich = sichVergleich(z.manifest, await a.liste())
    p.phase = 'fertig'
  } catch (err) {
    p.fehler = message(err)
    p.phase = 'fehler'
  }
  redraw(true)
}

const pruefungOf = (pfad) => S.pruef?.pruefung?.dateien.find((d) => d.pfad === pfad)
const restorable = () => (S.pruef?.vergleich?.dateien || []).filter((v) => !S.pruef.zurueck[v.pfad] && sichZurueckspielbar(v, pruefungOf(v.pfad)))

async function zurueckspielen() {
  const p = S.pruef
  const a = ablage()
  if (!p || !a || p.laeuft) return
  const list = restorable().filter((v) => p.wahl.has(v.pfad))
  if (!list.length) return toast('Bitte zuerst Dateien auswählen.')
  // Ungespeichertes zuerst speichern; was dann noch wartet (ohne Netz), würde sonst den zurückgespielten Stand überschreiben
  await app.service?.flush?.().catch(() => {})
  if (app.service?.hasPendingChanges?.()) return toast('Es gibt noch nicht gespeicherte Änderungen (ohne Verbindung?). Bitte warten, bis alles gespeichert ist.')
  p.laeuft = true
  redraw(true)
  const datum = todayISO()
  for (const v of list) {
    try {
      const bytes = await p.lesen(v.pfad)
      if (!bytes || (await sichPruefsumme(bytes)) !== v.gesichert.sha256) throw new Error('Inhalt der Sicherung stimmt nicht mit der Prüfsumme überein')
      const now = await a.jetzt(v.pfad)
      const kopie = now ? await a.rueckweg(datum, v.pfad, now.bytes) : ''
      await a.zurueck(v.pfad, bytes, now?.etag)
      p.zurueck[v.pfad] = { ok: true, kopie }
    } catch (err) {
      p.zurueck[v.pfad] = { ok: false, fehler: err?.name === 'ConflictError' ? 'inzwischen geändert – bitte die Sicherung erneut prüfen' : message(err) }
    }
    p.wahl.delete(v.pfad)
    redraw()
  }
  p.laeuft = false
  const ok = list.filter((v) => p.zurueck[v.pfad]?.ok).length
  // gespeicherte Stände anderer Fenster und Personen: neu laden, was die App offen hat
  await app.service?.refresh?.().catch(() => [])
  toast(ok === list.length ? `${plural(ok, 'Datei', 'Dateien')} zurückgespielt.` : `${ok} von ${list.length} Dateien zurückgespielt, Fehler siehe Liste.`)
  redraw(true)
}

// ---------------------------------------------------------------- Ansicht

const tile = (label, value, sub = '', cls = '') => `<div class="stat ${cls}"><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<small class="muted">${esc(sub)}</small>` : ''}</div>`

function statusBlock(today) {
  const s = settings()
  const f = sichFaellig(s, today)
  const lastText = f.datum ? formatDate(f.datum, { weekday: false, year: true }) : 'noch keine'
  const sub = f.datum ? [f.tage === 0 ? 'heute' : f.tage === 1 ? 'gestern' : `vor ${f.tage} Tagen`, s.by, s.dateien ? plural(s.dateien, 'Datei', 'Dateien') : '', s.bytes ? sichGroesse(s.bytes) : '', s.fehler ? `${s.fehler} mit Fehler` : ''].filter(Boolean).join(' · ') : 'Erinnerung in „Zu erledigen“'
  const every = `<label class="field sich-every"><span>Erinnerung</span><select id="sich-every" data-change="sich-every">${SICH_EVERY_CHOICES.map((d) => `<option value="${d}" ${d === f.every ? 'selected' : ''}>alle ${d} Tage</option>`).join('')}</select></label>`
  return `<div class="sich-tiles">${tile('Letzte Sicherung', esc(lastText), sub, f.faellig ? 'warn' : '')}${tile('Nächste fällig', f.faellig ? 'jetzt' : esc(formatDate(addDays(f.datum, f.every), { weekday: false, year: true })), `alle ${f.every} Tage`)}</div>${every}`
}

function downloadBlock(a) {
  const lauf = S.lauf
  if (lauf) {
    const text = lauf.zip ? 'ZIP-Datei wird erstellt …' : `${lauf.done} von ${lauf.total} Dateien gelesen, ${sichGroesse(lauf.bytes)}${lauf.fehler.length ? `, ${lauf.fehler.length} mit Fehler` : ''}${lauf.abbrechen ? ' – hält an …' : ' …'}`
    return `<div class="sich-progress" role="status" aria-live="polite"><progress max="${lauf.total || 1}" value="${lauf.done}" aria-label="Fortschritt der Sicherung"></progress><p>${esc(text)}</p></div>
      ${lauf.zip ? '' : `<div class="actions"><button class="btn" data-action="sich-stop" ${lauf.abbrechen ? 'disabled' : ''}>Abbrechen</button></div>`}`
  }
  if (S.lesen) return '<p class="muted" role="status">Liste der Dateien wird gelesen …</p>'
  const err = S.fehler ? `<div class="banner warn-banner" role="alert"><p>${esc(S.fehler)}</p></div>` : ''
  if (!S.liste) {
    return `${err}<p class="note">Liest zuerst die Liste aller Dateien im Ordner ${esc(a.ordner)} (ohne Inhalte) und zeigt, wie groß die Sicherung wird.</p>
      <div class="actions"><button class="btn primary" data-action="sich-liste">${ICON.search} Umfang ermitteln</button></div>`
  }
  const sel = auswahl()
  const n = sel.dateien.length
  const bytes = sel.dateien.reduce((s, f) => s + f.size, 0)
  return `${err}<ul class="sich-list">
      <li><span class="flag info">i</span><div><strong>Daten (JSON)</strong> <span class="muted">${plural(sel.daten.anzahl, 'Datei', 'Dateien')}, ${sichGroesse(sel.daten.groesse)}: Stammdaten, Pläne, Module, Einsätze je Jahr, Touren je Jahr</span></div></li>
      <li><span class="flag info">i</span><div><label class="check"><input type="checkbox" id="sich-anhaenge" data-change="sich-anhaenge" ${S.anhaenge ? 'checked' : ''} ${sel.anhaenge.anzahl ? '' : 'disabled'}><span><strong>PDFs und Fotos mitnehmen</strong> <span class="muted">${plural(sel.anhaenge.anzahl, 'Datei', 'Dateien')}, ${sichGroesse(sel.anhaenge.groesse)}</span></span></label></div></li>
    </ul>
    <p class="note">Liste vom ${esc(when(S.liste.at))}. Die Sicherung umfasst ${plural(n, 'Datei', 'Dateien')}, ${sichGroesse(bytes)}${S.anhaenge && sel.anhaenge.groesse > 200 * 1024 ** 2 ? ' – das dauert und braucht viel Speicher im Browser' : ''}.</p>
    <div class="actions"><button class="btn primary" data-action="sich-start" ${n ? '' : 'disabled'}>${ICON.download} Sicherung herunterladen</button><button class="btn" data-action="sich-liste">${ICON.refresh} Liste neu lesen</button></div>`
}

function berichtBlock() {
  const b = S.bericht
  if (!b) return ''
  if (b.error) return `<div class="banner warn-banner" role="alert"><p><strong>Sicherung nicht erstellt:</strong> ${esc(b.error)}</p></div>`
  if (b.abgebrochen) return `<div class="banner warn-banner" role="status"><p>Abgebrochen nach ${b.done} von ${b.total} Dateien. Es wurde keine ZIP-Datei erstellt.</p></div>`
  const errs = b.fehler.length
    ? `<p><strong>${plural(b.fehler.length, 'Datei', 'Dateien')} nicht gesichert</strong> (stehen im Manifest unter „fehler“):</p><ul class="sich-list">${b.fehler
        .slice(0, MAX_LISTE)
        .map((x) => `<li><span class="flag error">!</span><div><code>${esc(x.pfad)}</code> <span class="muted">${esc(x.fehler)}</span></div></li>`)
        .join('')}</ul>`
    : ''
  return `<div class="banner sich-bericht" role="status"><p><strong>Sicherung heruntergeladen:</strong> ${esc(b.name)} mit ${plural(b.dateien, 'Datei', 'Dateien')} (${sichGroesse(b.bytes)}, gepackt ${sichGroesse(b.zipBytes)})${b.anhaenge ? ', mit PDFs und Fotos' : b.ausgelassen?.anzahl ? `, ohne ${plural(b.ausgelassen.anzahl, 'PDF oder Foto', 'PDFs und Fotos')}` : ''}. Bitte an einem sicheren Ort ablegen (nicht nur auf diesem Gerät).</p></div>${errs}`
}

const STATUS_TEXT = { gleich: 'gleich', neuer: 'jetzt neuer', aelter: 'jetzt älter', anders: 'geändert', fehlt: 'fehlt jetzt', neu: 'neu seit der Sicherung' }
const STATUS_FLAG = { neuer: 'info', aelter: 'warning', anders: 'warning', fehlt: 'error', neu: 'info' }

function pruefBlock() {
  const p = S.pruef
  const input = `<label class="field"><span>ZIP-Datei einer Sicherung wählen</span><input type="file" id="sich-datei" accept=".zip,application/zip" data-change="sich-pruefen" ${p && !['fertig', 'fehler'].includes(p.phase) ? 'disabled' : ''}></label>`
  if (!p) return `<p class="note">Prüft die Prüfsummen jeder Datei und vergleicht mit dem aktuellen Stand. Es wird nichts verändert; einzelne Dateien lassen sich danach gezielt zurückspielen.</p>${input}`
  if (p.phase === 'fehler') return `${input}<div class="banner warn-banner" role="alert"><p><strong>${esc(p.name)}:</strong> ${esc(p.fehler)}</p></div>`
  if (p.phase !== 'fertig') {
    const text = p.phase === 'lesen' ? 'ZIP-Datei wird gelesen …' : p.phase === 'pruefen' ? `Prüfsummen: ${p.schritt + 1} von ${p.n} …` : 'Vergleich mit dem aktuellen Stand …'
    return `${input}<div class="sich-progress" role="status" aria-live="polite"><progress max="${p.n || 1}" value="${p.phase === 'pruefen' ? p.schritt : p.phase === 'lesen' ? 0 : p.n}" aria-label="Fortschritt der Prüfung"></progress><p>${esc(text)}</p></div>`
  }
  const m = p.manifest
  const pr = p.pruefung
  const vz = p.vergleich.zaehler
  const okAll = !pr.falsch && !pr.fehlt
  const head = `<p><strong>${esc(p.name)}</strong>: Sicherung vom ${esc(when(m.erstellt))}${m.von ? ` von ${esc(m.von)}` : ''}, App ${esc(m.app?.name || '')} (Version ${esc(m.app?.version || '–')}), ${plural(m.anzahl ?? m.dateien.length, 'Datei', 'Dateien')}, ${sichGroesse(m.groesse)}${m.anhaenge ? ', mit PDFs und Fotos' : ', ohne PDFs und Fotos'}${m.fehler?.length ? `; beim Sichern ${m.fehler.length} nicht lesbar` : ''}.</p>`
  const sums = `<div class="banner ${okAll ? '' : 'warn-banner'}" role="status"><p><strong>Prüfsummen:</strong> ${okAll ? `alle ${pr.ok} stimmen.` : `${pr.ok} stimmen, ${pr.falsch} falsch, ${pr.fehlt} fehlen in der ZIP-Datei.`}${pr.fremd.length ? ` ${plural(pr.fremd.length, 'Eintrag steht', 'Einträge stehen')} nicht im Manifest (nicht berücksichtigt).` : ''}</p></div>`
  const bad = pr.dateien.filter((d) => d.status !== 'ok')
  const badList = bad.length ? `<ul class="sich-list">${bad.slice(0, MAX_LISTE).map((d) => `<li><span class="flag error">!</span><div><code>${esc(d.pfad)}</code> <span class="muted">${esc(d.grund)}</span></div></li>`).join('')}</ul>` : ''
  const counts = `<div class="sich-tiles sich-counts">${tile('Gleich', vz.gleich)}${tile('Jetzt neuer', vz.neuer)}${tile('Jetzt älter', vz.aelter, '', vz.aelter ? 'warn' : '')}${tile('Geändert', vz.anders, '', vz.anders ? 'warn' : '')}${tile('Fehlen jetzt', vz.fehlt, '', vz.fehlt ? 'err' : '')}${tile('Neu seit der Sicherung', vz.neu)}</div>`
  const diff = p.vergleich.dateien.filter((v) => v.status !== 'gleich')
  const may = sichRechte(app.access).restore && !app.readOnly
  const rows = diff
    .slice(0, MAX_LISTE)
    .map((v) => {
      const done = p.zurueck[v.pfad]
      const can = may && !done && sichZurueckspielbar(v, pruefungOf(v.pfad))
      const times = [v.gesichert ? `gesichert ${when(v.gesichert.geaendert)}` : '', v.jetzt ? `jetzt ${when(v.jetzt.modified)}` : ''].filter(Boolean).join(' · ')
      const state = done ? (done.ok ? `<span class="pill ok">zurückgespielt</span>${done.kopie ? ` <span class="muted">vorheriger Stand: ${esc(done.kopie)}</span>` : ''}` : `<span class="pill error">Fehler</span> <span class="muted">${esc(done.fehler)}</span>`) : ''
      const box = can ? `<input type="checkbox" name="sich-wahl" value="${esc(v.pfad)}" data-change="sich-wahl" aria-label="${esc(v.pfad)} zurückspielen" ${p.wahl.has(v.pfad) ? 'checked' : ''} ${p.laeuft ? 'disabled' : ''}>` : `<span class="flag ${STATUS_FLAG[v.status] || 'info'}">${v.status === 'fehlt' ? '!' : 'i'}</span>`
      return `<li>${box}<div><code>${esc(v.pfad)}</code> <span class="pill ${STATUS_FLAG[v.status] === 'error' ? 'error' : STATUS_FLAG[v.status] === 'warning' ? 'warning' : 'info'}">${esc(STATUS_TEXT[v.status])}</span>${state ? ` ${state}` : ''}<br><small class="muted">${esc(times)}</small></div></li>`
    })
    .join('')
  const more = diff.length > MAX_LISTE ? `<p class="note">… und ${diff.length - MAX_LISTE} weitere.</p>` : ''
  const nWahl = restorable().filter((v) => p.wahl.has(v.pfad)).length
  const confirm = app.ui.confirm === 'sich-restore'
  const restore =
    may && restorable().length
      ? confirm && nWahl
        ? `<div class="banner warn-banner sich-confirm" role="alert"><p><strong>${plural(nWahl, 'Datei', 'Dateien')} durch den Stand der Sicherung vom ${esc(when(m.erstellt))} ersetzen?</strong> Der aktuelle Stand jeder Datei kommt vorher nach ${esc(ablage()?.ordner || 'Plattform')}/${SICH_RUECKWEG}/${esc(todayISO())}/.</p>
            <div class="actions"><button class="btn danger" data-action="sich-restore">Ja, zurückspielen</button><button class="btn" data-action="sich-restore-no">Abbrechen</button></div></div>`
        : `<div class="actions"><button class="btn" data-action="sich-restore" ${nWahl && !p.laeuft ? '' : 'disabled'}>${ICON.upload} Ausgewählte zurückspielen${nWahl ? ` (${nWahl})` : ''}</button></div><p class="note">Nur einzeln ausgewählte Dateien, nur nach Bestätigung. Vorher kommt der aktuelle Stand nach ${SICH_RUECKWEG}/&lt;Datum&gt;/ im Ordner ${esc(ablage()?.ordner || 'Plattform')}.</p>`
      : ''
  return `${input}${head}${sums}${badList}<h4>Vergleich mit dem aktuellen Stand</h4>${counts}${diff.length ? `<ul class="sich-list sich-diff">${rows}</ul>${more}` : '<p class="muted">Alle Dateien der Sicherung sind unverändert.</p>'}${restore}`
}

function sicherungView() {
  if (!mayUse()) return '<p class="muted">Die Datensicherung ist nur mit Vollzugriff möglich.</p>'
  const a = ablage()
  const today = todayISO()
  const intro = `<div class="section-head"><div><h2>Datensicherung</h2><p>Alle Daten der App aus ${a?.art === 'SharePoint' ? `SharePoint (Ordner ${esc(a.ordner)})` : 'diesem Browser'} als ZIP-Datei mit Prüfsummen. Der Versionsverlauf von SharePoint bleibt; die ZIP-Datei ist der zweite Rückweg, z. B. wenn ein ganzer Ordner fehlt. Zurückgespielt wird nie von selbst.</p></div></div>`
  if (!a) return `${intro}<p class="muted">Keine Ablage verbunden.</p>`
  return `${intro}${statusBlock(today)}
    <section class="sich-teil"><h3>Sicherung herunterladen</h3>${downloadBlock(a)}${berichtBlock()}</section>
    <section class="sich-teil"><h3>Sicherung prüfen</h3>${pruefBlock()}</section>`
}

registerView({ id: 'sicherung', order: 131, label: 'Datensicherung', group: 'stamm', module: 'stammdaten', noWeek: true, available: () => !app.access || !!app.access.all, text: 'Alle Daten als ZIP sichern und prüfen', render: sicherungView })

registerActions(
  {
    'sich-liste': () => listen(),
    'sich-anhaenge': (el) => {
      S.anhaenge = !!el.checked
      redraw(true)
    },
    'sich-start': () => erstellen(),
    'sich-stop': () => {
      if (S.lauf) S.lauf.abbrechen = true
      redraw(true)
    },
    'sich-every': (el) => {
      const every = Number(el.value)
      if (!SICH_EVERY_CHOICES.includes(every)) return
      app.data.settings = { ...(app.data.settings || {}), sicherung: { ...settings(), every } }
      persist()
      redraw(true)
    },
    'sich-pruefen': (el) => {
      const file = el.files?.[0]
      el.value = '' // dieselbe Datei später noch einmal wählbar (z. B. nach dem Zurückspielen erneut prüfen)
      return pruefen(file)
    },
    'sich-wahl': (el) => {
      if (!S.pruef) return
      if (el.checked) S.pruef.wahl.add(el.value)
      else S.pruef.wahl.delete(el.value)
      redraw(true)
    },
    'sich-restore': () => {
      if (!S.pruef || S.pruef.laeuft) return
      if (!restorable().some((v) => S.pruef.wahl.has(v.pfad))) return toast('Bitte zuerst Dateien auswählen.')
      if (confirmStep('sich-restore')) zurueckspielen()
    },
    'sich-restore-no': () => {
      app.ui.confirm = null
      redraw(true)
    },
  },
  { edit: '*' },
)

// ---------------------------------------------------------------- Erinnerung in „Zu erledigen“

registerTodo({
  id: 'sicherung',
  module: 'stammdaten',
  title: 'Datensicherung',
  // nur Vollzugriff und nur im Betrieb mit SharePoint (im Browser-Modus liegen die Daten ohnehin nur hier)
  compute: (today) => {
    if (!mayUse() || app.store?.kind !== 'sharepoint') return []
    const f = sichFaellig(settings(), today)
    return f.faellig ? [{ id: `sich:${f.datum || 'nie'}:${f.every}`, ...f }] : []
  },
  render: (items) =>
    items
      .map(
        (f) => `<div class="todo-item"><span class="flag warning">!</span><div class="todo-text"><strong>${f.datum ? `Letzte Sicherung vor ${plural(f.tage, 'Tag', 'Tagen')}` : 'Noch keine Datensicherung'}</strong><br><span class="muted">Alle ${f.every} Tage alle Daten aus SharePoint als ZIP-Datei sichern (einstellbar in „Datensicherung“).</span></div>
        <button class="btn small primary" data-action="view" data-view="${VIEW}">Jetzt sichern</button></div>`,
      )
      .join(''),
})
