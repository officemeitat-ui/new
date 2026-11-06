// Qualitätsmessung (Objektleitung, Objektmanagement): genormte Stichprobenmessung in Anlehnung an EN 13549.
// Je Objekt Raumgruppen mit Anzahl Räume (auf Wunsch aus dem Raumbuch der Objektdoku), je Messung eine zufällige
// Stichprobe (Startwert, änderbar), Bewertung je Raum am Handy (Prüfobjekte, Fehlerarten, Foto je Mangel), Ergebnis
// erfüllt / nicht erfüllt, Qualitätskennzahl mit Verlauf je Objekt, Unterschrift des Kunden (optional), Bericht als
// PDF in SharePoint (qualitaet/nachweise/<Jahr>/) und per E-Mail, Nachkontrolle und „Reklamationsgefahr“ in „Zu
// erledigen“ und beim digitalen Mitarbeiter „Fristen“ (nur „Öffnen“). Datei qualitaet/qualitaet.json, Rechenkern
// core/qualitaet.js. Die freie Objektkontrolle (Werkzeug) bleibt davon unberührt. Aktionen und Dialoge: „qm-“.

import { addDays, formatDate, MONTH_LONG, todayISO } from '../../core/dates.js'
import { AQL_VALUES, attention, DEFECT_DEFAULTS, drawSample, emptyQualitaet, evaluate, findAkte, GROUP_DEFAULTS, groupsFromRaumbuch, groupsProblem, isUrgent, ITEM_DEFAULTS, levelOf, lotSize, measurementsOf, monthly, newMeasurement, objectConf, objectStatus, planFor, planProblem, QM_HINT, resultOf, roomLabel, roomResult, SAMPLE_DEFAULTS, SETTINGS_DEFAULTS, settingsOf } from '../../core/qualitaet.js'
import { toCSV } from '../../core/reports.js'
import { aqlText, levelText, qualitaetDocument, qualitaetPdfName } from '../../export/qualitaet-pdf.js'
import { app, canEdit, closeModal, confirmStep, memo, openModal, persist, registerActions, registerModal, registerObjectHint, registerView, renderModal, renderNow, toast } from '../context.js'
import { lineChart, tableView } from '../kpi-charts.js'
import { openCompose } from '../mailer.js'
import { registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { clearSignatures, signatureField, signatureSvg } from '../signature.js'
import { checked, download, esc, ICON, menu, modalFrame, options, tabBar, uid, val } from '../shared.js'

const MODULE = 'qualitaet'
const ICON_QM = '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/><path d="m7.8 10.6 2 2 3.6-3.6"/>'
const doc = () => {
  const d = (app.data.qualitaet ||= emptyQualitaet())
  d.settings ||= {}
  d.objects ||= []
  d.measurements ||= []
  return d
}
const editable = () => canEdit(MODULE) && !app.readOnly
const sees = (m) => !app.access || app.access.sees(m)
const nowIso = () => new Date().toISOString()
const user = () => app.user?.name || 'Browser'
const objOf = (id) => app.data.objects.find((o) => o.id === id)
const objName = (id) => objOf(id)?.name || 'Objekt'
const measurementOf = (id) => doc().measurements.find((m) => m.id === id)
const short = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const pct = (v) => (v === null || v === undefined ? '–' : `${Number(v).toFixed(1).replace('.', ',')} %`)
const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
const verdictPill = (r) => (r.ok === null ? '<span class="pill na">ohne Annahmezahl</span>' : r.ok ? '<span class="pill ok">erfüllt</span>' : '<span class="pill error">nicht erfüllt</span>')
const hintNote = () => `<p class="note">${esc(QM_HINT)}: Stichprobentabelle, Prüfobjekte, Gewichte und Fehlerarten lassen sich unter „Mehr“ → „Vorgaben“ ändern und sollten mit dem Kunden vereinbart sein.</p>`
const openComplaints = (objectId) => (sees('reklamationen') ? (app.data.reklamationen?.items || []).filter((c) => c.objectId === objectId && c.status !== 'erledigt').length : 0)

/** Lage eines Objekts (je Berechnung gemerkt). */
const statusAt = (objectId, today = todayISO()) => memo(app.cur, `qm:${objectId}:${today}`, () => objectStatus({ doc: doc(), objectId, today }))
const attentionAt = (today = todayISO()) => memo(app.cur, `qm-attention:${today}`, () => attention({ doc: doc(), objects: app.data.objects, today }))
/** Objekte mit Raumgruppen (oder Messungen), nach Name. */
function configured() {
  const ids = [...new Set([...doc().objects.map((c) => c.objectId), ...doc().measurements.map((m) => m.objectId)])]
  return ids.filter((id) => objOf(id)).sort((a, b) => objName(a).localeCompare(objName(b), 'de'))
}

/** Gründe für Handlungsbedarf als kurze Zeilen. */
function reasons(g) {
  const out = []
  if (g.last) out.push(`letzte Messung ${short(g.last.date)}: ${pct(g.result.score)}, ${g.result.ok === false ? 'nicht erfüllt' : g.result.ok === null ? 'ohne Annahmezahl' : g.result.poor ? 'erfüllt, unter dem Zielwert' : 'erfüllt'}`)
  if (g.recheck) out.push(g.recheck.overdue ? `Nachkontrolle seit ${short(g.recheck.due)} überfällig` : `Nachkontrolle bis ${short(g.recheck.due)}`)
  if (g.twoBad) out.push('zwei schlechte Messungen in Folge')
  if (g.falling) out.push('Kennzahl fällt seit drei Messungen')
  const rek = openComplaints(g.objectId)
  if (rek) out.push(plural(rek, 'offene Reklamation', 'offene Reklamationen'))
  return out
}

// ---------------------------------------------------------------- Dateien (Fotos, Bericht)

// Browser-Modus: Dateien nur in diesem Fenster; mit SharePoint unter qualitaet/nachweise/<Jahr>/ (ohne Netz wartet
// das Hochladen im Gerät, siehe storage/offline.js)
const LOCAL = new Map()

/** Foto verkleinern (Handy: oft 4–8 MB): längste Seite höchstens 1600 Pixel, JPEG. Kleine Bilder bleiben. */
async function shrink(file) {
  if (!/^image\//.test(file.type) || file.size < 500e3 || typeof createImageBitmap !== 'function') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
    return blob && blob.size < file.size ? new File([blob], `${file.name.replace(/\.\w+$/, '')}.jpg`, { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

/** Datei ablegen; liefert { path, name, type, size, at, by, url?, queued?, local? } oder null (mit Meldung). */
async function storeFile(file, path) {
  if (file.size > 15e6) {
    toast(`${file.name}: zu groß (höchstens 15 MB).`)
    return null
  }
  const meta = { path, name: file.name, type: file.type || 'application/octet-stream', size: file.size, at: nowIso(), by: user() }
  if (app.store?.kind !== 'sharepoint') {
    LOCAL.set(path, file)
    return { ...meta, local: true }
  }
  try {
    const up = await app.store.upload(path, file, meta.type)
    return { ...meta, ...(up?.webUrl ? { url: up.webUrl } : {}), ...(up?.queued ? { queued: true } : {}) }
  } catch (err) {
    toast(`${file.name} nicht gespeichert: ${err.message}`)
    return null
  }
}

async function readFile(meta) {
  if (!meta) return null
  if (LOCAL.has(meta.path)) return LOCAL.get(meta.path)
  if (meta.local || app.store?.kind !== 'sharepoint') return null
  return app.store.readBlob?.(meta.path).catch(() => null) ?? null
}

async function openFile(meta) {
  if (!meta) return
  const local = LOCAL.get(meta.path)
  if (local) return void window.open(URL.createObjectURL(local), '_blank', 'noopener')
  if (meta.local) return toast('Im Browser-Modus bleiben Fotos und Berichte nur in diesem Fenster (gespeichert wird im Betrieb mit SharePoint).')
  if (meta.url) return void window.open(meta.url, '_blank', 'noopener')
  const blob = await readFile(meta)
  if (!blob) return toast(meta.queued ? 'Die Datei wartet noch im Gerät aufs Hochladen.' : 'Datei nicht gefunden.')
  window.open(URL.createObjectURL(blob), '_blank', 'noopener')
}

const basePath = (m) => `qualitaet/nachweise/${m.date.slice(0, 4)}/${fileSafe(objName(m.objectId))}_${m.date}_${m.id}`

/** Bild als data-URL fürs PDF: nur JPEG und PNG, die der Browser auch lesen kann (sonst bricht pdfmake ab). */
async function imageUrl(blob) {
  if (!blob) return null
  try {
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
    const type = head[0] === 0xff && head[1] === 0xd8 ? 'image/jpeg' : head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 ? 'image/png' : ''
    if (!type) return null
    const typed = new Blob([blob], { type })
    if (typeof createImageBitmap === 'function') (await createImageBitmap(typed)).close?.()
    return await new Promise((resolve, reject) => Object.assign(new FileReader(), { onload: (e) => resolve(e.target.result), onerror: reject }).readAsDataURL(typed))
  } catch {
    return null
  }
}

/** Bericht als PDF (Blob) mit Verlauf und ladbaren Fotos. */
async function reportBlob(m) {
  const photos = new Map()
  for (const room of m.rooms)
    for (const it of room.items)
      if (it.state === 'mangel' && it.photo?.path) {
        const url = await imageUrl(await readFile(it.photo))
        if (url) photos.set(it.photo.path, url)
      }
  const history = measurementsOf(doc(), m.objectId).filter((x) => x.id !== m.id && x.date <= m.date)
  const defectNames = Object.fromEntries(settingsOf(doc()).defectTypes.map((x) => [x.id, x.name]))
  const pdf = qualitaetDocument({ m, object: objOf(m.objectId) || { name: 'Objekt' }, history, defectNames, photos, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })
  return pdfBlob(pdf)
}

/** Bericht erstellen und in SharePoint ablegen (Browser-Modus: nur in diesem Fenster). → Datei oder null */
async function storeReport(m) {
  try {
    const blob = await reportBlob(m)
    const file = new File([blob], qualitaetPdfName(objName(m.objectId), m.date), { type: 'application/pdf' })
    const meta = await storeFile(file, `${basePath(m)}_bericht.pdf`)
    if (!meta) return null
    const cur = measurementOf(m.id)
    if (cur) cur.report = meta
    persist()
    return meta
  } catch (err) {
    toast(`Bericht nicht erstellt: ${err.message}`)
    return null
  }
}

// ---------------------------------------------------------------- Ansicht

function qualitaetView() {
  const today = todayISO()
  const ed = editable()
  const ids = configured()
  const tab = app.ui.qmTab === 'messungen' ? 'messungen' : 'objekte'
  const head = `<div class="section-head"><div><h2>Qualitätsmessung</h2><p>Genormte Stichprobenmessung in Anlehnung an EN 13549: je Objekt Raumgruppen, die App zieht die Räume der Stichprobe, bewertet wird vor Ort am Handy. Ergebnis erfüllt oder nicht erfüllt, Qualitätskennzahl mit Verlauf, Bericht für den Kunden.</p></div>
      <div class="actions">${ed && doc().objects.length ? `<button class="btn primary" data-action="qm-measure-open"${app.ui.qmObj ? ` data-obj="${esc(app.ui.qmObj)}"` : ''}>${ICON.check} Messung starten</button>` : ''}${menu({
        label: 'Mehr',
        single: false,
        items: [
          ed && { label: 'Raumgruppen eines Objekts', icon: ICON.plus, action: 'qm-groups-open', hint: 'Räume, Qualitätsniveau' },
          { label: 'Vorgaben', icon: ICON.gear, action: 'qm-settings-open', hint: 'Stichprobe, Prüfobjekte, Fehlerarten' },
          { heading: 'Export' },
          doc().measurements.length && { label: 'Messungen (CSV)', icon: ICON.download, action: 'qm-csv', mail: true },
        ],
      })}</div></div>`
  if (!ids.length)
    return `${head}<div class="banner welcome"><p><strong>Noch keine Raumgruppen.</strong> Je Objekt die Raumgruppen mit der Anzahl Räume eintragen, z. B. Büro, Sanitär, Verkehrsflächen und Küche. Hat das Objekt ein Raumbuch in der Objektdoku, schlägt die App die Raumgruppen daraus vor.</p>${ed ? `<button class="btn primary" data-action="qm-groups-open">${ICON.plus} Raumgruppen anlegen</button>` : ''}</div>${hintNote()}`
  const stats = ids.map((id) => ({ id, ...statusAt(id, today) }))
  const scored = stats.filter((s) => s.result?.score !== null && s.result?.score !== undefined)
  const avg = scored.length ? scored.reduce((s, x) => s + x.result.score, 0) / scored.length : null
  const notMet = stats.filter((s) => s.result?.ok === false).length
  const recheck = stats.filter((s) => s.recheck).length
  const risk = stats.filter((s) => s.risk).length
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  const running = doc().measurements.filter((m) => m.status === 'laufend').length
  const tabs = tabBar({
    action: 'qm-tab',
    current: tab,
    tabs: [
      { id: 'objekte', label: 'Objekte' },
      { id: 'messungen', label: 'Messungen', flag: running },
    ],
  })
  const body = tab === 'messungen' ? measurementsTab(ids) : app.ui.qmObj && ids.includes(app.ui.qmObj) ? detail(app.ui.qmObj, today) : objectsTab(stats)
  return `${head}
    <div class="impact-stats tc-stats">${tile('Kennzahl im Schnitt', pct(avg))}${tile('nicht erfüllt', notMet, notMet ? 'err' : '')}${tile('Nachkontrolle offen', recheck, recheck ? 'warn' : '')}${tile('Reklamationsgefahr', risk, risk ? 'err' : '')}</div>
    ${tabs}${body}`
}

function filters(ids) {
  const regions = [...new Set(ids.map((id) => objOf(id)?.region).filter(Boolean))].sort()
  const f = { objectId: app.ui.qmObj || '', region: app.ui.qmRegion || '' }
  return `<div class="filters qm-filters">
      <label class="field inline"><span>Objekt</span><select id="qm-f-obj" data-change="qm-filter">${options(ids.map((id) => [id, objName(id)]), f.objectId, { empty: 'alle' })}</select></label>
      ${regions.length > 1 ? `<label class="field inline"><span>Revier</span><select id="qm-f-region" data-change="qm-filter">${options(regions.map((x) => [x, x]), f.region, { empty: 'alle' })}</select></label>` : ''}
      ${f.objectId || f.region ? '<button class="btn small ghost" data-action="qm-reset">Filter zurücksetzen</button>' : ''}</div>`
}

const inRegion = (id) => !app.ui.qmRegion || objOf(id)?.region === app.ui.qmRegion
const groupsText = (conf) => (conf?.groups || []).map((g) => `${g.name} ${g.rooms}`).join(' · ')

function levelOfObject(id) {
  const settings = settingsOf(doc())
  const conf = objectConf(doc(), id)
  const level = levelOf(conf, settings)
  const plan = conf ? planFor(lotSize(conf.groups), { aql: level.aql, accept: level.accept, sample: settings.sample }) : null
  return { conf, level, plan }
}

function planText(plan) {
  if (!plan) return 'keine Räume eingetragen'
  if (plan.needsAccept) return `Los ${plan.lot} Räume, Stichprobe ${plan.n}: für diese Größe keine Annahmezahl aus der ISO-Tabelle, bitte die zulässige Zahl beim Objekt festlegen`
  return `Los ${plan.lot} Räume, Stichprobe ${plan.full ? `alle ${plan.n}` : plan.n} Räume, höchstens ${plural(plan.ac, 'Raum', 'Räume')} nicht in Ordnung (${levelText(plan)})`
}

function objectsTab(stats) {
  const ed = editable()
  const rows = stats
    .filter((s) => inRegion(s.id))
    .map((s) => {
      const o = objOf(s.id) || {}
      const { conf, level } = levelOfObject(s.id)
      const flags = [s.risk ? '<span class="pill error">Reklamationsgefahr</span>' : '', s.recheck ? `<span class="pill ${s.recheck.overdue ? 'error' : 'warning'}">Nachkontrolle ${s.recheck.overdue ? 'überfällig' : `bis ${short(s.recheck.due)}`}</span>` : ''].filter(Boolean).join(' ')
      return `<tr><td class="clickable" data-action="qm-goto" data-obj="${esc(s.id)}"><strong>${esc(o.name || 'Objekt')}</strong>${o.region ? `<br><span class="muted">${esc(o.region)}</span>` : ''}</td>
        <td>${conf ? `${lotSize(conf.groups)} Räume<br><span class="muted">${esc(groupsText(conf))}</span>` : '<span class="muted">keine Raumgruppen</span>'}</td>
        <td>${level.accept !== null ? `höchstens ${level.accept} nicht in Ordnung` : `AQL ${aqlText(level.aql)}`}<br><span class="muted">Ziel ${pct(level.target)}</span></td>
        <td>${s.last ? short(s.last.date) : '<span class="muted">noch keine</span>'}</td>
        <td class="num">${s.last ? pct(s.result.score) : '–'}</td>
        <td>${s.last ? verdictPill(s.result) : ''}${flags ? `<br>${flags}` : ''}</td>
        <td class="actions-cell">${ed && conf ? `<button class="btn small primary" data-action="qm-measure-open" data-obj="${esc(s.id)}">Messung</button> ` : ''}<button class="btn small" data-action="qm-goto" data-obj="${esc(s.id)}">Verlauf</button></td></tr>`
    })
    .join('')
  return `${filters(stats.map((s) => s.id))}
    ${rows ? `<div class="table-wrap"><table class="data qm-table"><thead><tr><th>Objekt</th><th>Räume</th><th>Qualitätsniveau</th><th>letzte Messung</th><th class="num">Kennzahl</th><th>Ergebnis</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Kein Objekt in dieser Auswahl.</p>'}
    ${hintNote()}`
}

/** Verlauf je Objekt: Kennzahl je Monat (Mittel der Messungen) und Zielwert, wie die Diagramme der Kennzahlen. */
function chart(list, target, today) {
  const months = monthly(list, { today, months: 12 })
  if (!months.some((x) => x.score !== null)) return ''
  const label = (key) => MONTH_LONG[Number(key.slice(5, 7)) - 1].slice(0, 3)
  const title = (key) => `${MONTH_LONG[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`
  const narrow = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px)').matches
  const series = [
    { id: 'score', label: 'Qualitätskennzahl', color: '--kpi-1', values: months.map((x) => x.score) },
    { id: 'target', label: 'Zielwert', color: '--kpi-neutral', values: months.map(() => target) },
  ]
  // Achse ab einer runden Untergrenze unter dem kleinsten Wert (Kennzahlen liegen meist nahe 100 %)
  const low = Math.min(target, ...months.filter((x) => x.score !== null).map((x) => x.score))
  const min = Math.max(0, Math.min(80, Math.floor((low - 5) / 10) * 10))
  const legend = `<div class="kpi-legend">${series.map((s) => `<span><i class="kpi-key line" style="--c:var(${s.color})"></i>${esc(s.label)}</span>`).join('')}</div>`
  return `<div class="kpi-root qm-chart"><section class="kpi-card" data-chart="qm-verlauf"><header><div><h3>Verlauf der Qualitätskennzahl</h3><p class="muted small">je Monat (Mittel der Messungen), letzte 12 Monate</p></div></header>${legend}
    <div class="kpi-plot">${lineChart({ labels: months.map((x) => label(x.key)), titles: months.map((x) => title(x.key)), series, fmt: (v) => pct(v), axis: (v) => `${Math.round(v)} %`, width: narrow ? 340 : 560, ariaLabel: 'Verlauf der Qualitätskennzahl je Monat', min })}</div>
    ${tableView(['Monat', 'Kennzahl', 'Messungen'], months.filter((x) => x.count).map((x) => [title(x.key), pct(x.score), String(x.count)]))}</section></div>`
}

function measurementRows(list, { withObject = true } = {}) {
  return list
    .map((m) => {
      const r = resultOf(m)
      const running = m.status !== 'fertig'
      return `<tr><td class="clickable" data-action="qm-show" data-id="${esc(m.id)}"><strong>${short(m.date)}</strong>${m.recheckOf ? '<br><span class="muted">Nachkontrolle</span>' : ''}</td>
        ${withObject ? `<td>${esc(objName(m.objectId))}</td>` : ''}
        <td>${plural(m.rooms.length, 'Raum', 'Räume')} von ${m.lot}<br><span class="muted">${esc(levelText(m.plan))}</span></td>
        <td class="num">${pct(r.score)}</td>
        <td>${running ? `<span class="pill info">läuft (${m.rooms.filter((x) => x.checked).length} von ${m.rooms.length})</span>` : `${verdictPill(r)}<br><span class="muted">${r.bad} von ${r.rooms} nicht in Ordnung</span>`}</td>
        <td>${esc(m.by || '')}${m.signature ? '<br><span class="pill ok">unterschrieben</span>' : ''}${m.sent?.length ? '<br><span class="muted">gesendet</span>' : ''}</td>
        <td class="actions-cell">${running && editable() ? `<button class="btn small primary" data-action="qm-rate-open" data-id="${esc(m.id)}">Fortsetzen</button>` : `<button class="btn small" data-action="qm-show" data-id="${esc(m.id)}">Ansehen</button>`}</td></tr>`
    })
    .join('')
}

const measurementsHead = (withObject = true) => `<thead><tr><th>Datum</th>${withObject ? '<th>Objekt</th>' : ''}<th>Stichprobe</th><th class="num">Kennzahl</th><th>Ergebnis</th><th>gemessen von</th><th></th></tr></thead>`

function measurementsTab(ids) {
  const list = doc()
    .measurements.filter((m) => (!app.ui.qmObj || m.objectId === app.ui.qmObj) && inRegion(m.objectId))
    .sort((a, b) => Number(a.status === 'fertig') - Number(b.status === 'fertig') || (b.date || '').localeCompare(a.date || '') || (b.at || '').localeCompare(a.at || ''))
  const rows = measurementRows(list)
  return `${filters(ids)}${rows ? `<div class="table-wrap"><table class="data qm-table">${measurementsHead()}<tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine Messung in dieser Auswahl.</p>'}`
}

function detail(id, today) {
  const ed = editable()
  const o = objOf(id) || {}
  const st = statusAt(id, today)
  const { conf, level, plan } = levelOfObject(id)
  const rek = openComplaints(id)
  const list = [...st.list, ...doc().measurements.filter((m) => m.objectId === id && m.status !== 'fertig')].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || '').localeCompare(a.at || ''))
  const actions = [
    ed && conf ? `<button class="btn small primary" data-action="qm-measure-open" data-obj="${esc(id)}">${ICON.check} Messung</button>` : '',
    `<button class="btn small" data-action="qm-groups-open" data-obj="${esc(id)}">${ed ? 'Raumgruppen' : 'Raumgruppen ansehen'}</button>`,
    canEdit('termine') && !app.readOnly ? `<button class="btn small" data-action="qm-appt" data-obj="${esc(id)}">${ICON.calendar} ${st.recheck ? 'Nachkontrolle als Termin' : 'Termin'}</button>` : '',
    sees('reklamationen') ? `<button class="btn small" data-action="qm-complaints" data-obj="${esc(id)}">Reklamationen${rek ? ` <span class="flag warning">${rek}</span>` : ''}</button>` : '',
  ].join('')
  const banners = [
    st.risk ? `<div class="banner qm-risk"><p><strong>Reklamationsgefahr:</strong> ${esc([st.twoBad ? 'zwei schlechte Messungen in Folge' : '', st.falling ? 'die Kennzahl fällt seit drei Messungen' : ''].filter(Boolean).join(', '))}. Mit dem Team die Mängel besprechen, Einschulung und Leistungsumfang prüfen${rek ? `; ${plural(rek, 'Reklamation ist', 'Reklamationen sind')} offen` : ''}.</p></div>` : '',
    st.recheck ? `<div class="banner warn-banner"><p><strong>Nachkontrolle ${st.recheck.overdue ? `seit ${short(st.recheck.due)} überfällig` : `bis ${short(st.recheck.due)}`}:</strong> Die letzte Messung war ${st.result.ok === false ? 'nicht erfüllt' : `unter dem Zielwert (${pct(st.result.score)})`}. Eine neue Messung mit neuer Stichprobe erledigt die Nachkontrolle.</p></div>` : '',
  ].join('')
  const rows = measurementRows(list, { withObject: false })
  return `<section class="qm-obj"><div class="section-head small"><h3>${esc(o.name || 'Objekt')} <span class="muted qm-addr">${esc([o.address, o.region && !String(o.address || '').includes(o.region) ? o.region : ''].filter(Boolean).join(' · '))}</span></h3><div class="actions">${actions}</div></div>
      <p class="qm-sum">${conf ? `<strong>${esc(groupsText(conf))}</strong><br>${esc(planText(plan))}; Zielwert ${pct(level.target)}` : 'Noch keine Raumgruppen.'}</p>
      ${banners}
      ${chart(st.list, level.target, today)}
      ${rows ? `<div class="table-wrap"><table class="data qm-table">${measurementsHead(false)}<tbody>${rows}</tbody></table></div>` : '<p class="empty">Noch keine Messung.</p>'}
      <p><button class="btn small ghost" data-action="qm-reset">${ICON.left} Alle Objekte</button></p></section>`
}

registerView({
  id: 'qualitaet',
  order: 78,
  label: 'Qualitätsmessung',
  group: 'service',
  module: MODULE,
  icon: ICON_QM,
  noWeek: true,
  text: 'Stichprobe je Objekt nach EN 13549, Kennzahl, Verlauf, Bericht',
  badge: () => attentionAt().filter(isUrgent).length,
  render: qualitaetView,
})

// ---------------------------------------------------------------- Raumgruppen je Objekt

function groupsDraft(m) {
  if (!m.draft) {
    const conf = m.objectId ? objectConf(doc(), m.objectId) : null
    m.draft = conf ? structuredClone(conf) : { objectId: m.objectId || '', groups: [], aql: '', accept: '', target: '', email: '', note: '' }
    m.draft.groups = m.draft.groups.map((g) => ({ ...g, names: [...(g.names || [])] }))
    m.isNew = !conf
  }
  return m.draft
}

function readGroups() {
  const m = app.ui.modal
  if (m?.type !== 'qm-groups') return null
  const d = groupsDraft(m)
  if (!document.getElementById('qmg-obj')) return d
  const templates = settingsOf(doc()).groupTemplates
  d.objectId = val('qmg-obj') || d.objectId
  d.groups = d.groups.map((g, i) => {
    const template = val(`qmg-tpl-${i}`) || g.template
    let name = val(`qmg-name-${i}`).trim()
    // Vorlage gewechselt und der Name war noch der der alten Vorlage: Name mitnehmen
    const old = templates.find((t) => t.id === g.template)
    if (template !== g.template && (!name || name === old?.name)) name = templates.find((t) => t.id === template)?.name || name
    const names = document.getElementById(`qmg-names-${i}`) ? val(`qmg-names-${i}`).split('\n').map((x) => x.trim()) : g.names || []
    while (names.length && !names.at(-1)) names.pop()
    return { ...g, name, template, rooms: Math.max(0, Math.round(Number(val(`qmg-rooms-${i}`)) || 0)), names }
  })
  d.aql = val('qmg-aql') ? Number(val('qmg-aql')) : ''
  d.accept = val('qmg-accept').trim() === '' ? '' : Math.max(0, Math.round(Number(val('qmg-accept')) || 0))
  d.target = val('qmg-target').trim() === '' ? '' : Math.min(100, Math.max(0, Number(val('qmg-target').replace(',', '.')) || 0))
  d.email = val('qmg-email').trim()
  d.note = val('qmg-note').trim()
  return d
}

function groupsModal(c, m) {
  const d = groupsDraft(m)
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const settings = settingsOf(doc())
  const obj = objOf(d.objectId)
  const level = levelOf(d, settings)
  const plan = planFor(lotSize(d.groups), { aql: level.aql, accept: level.accept, sample: settings.sample })
  const usedIds = new Set(doc().objects.map((x) => x.objectId))
  const objectChoices = app.data.objects.filter((o) => !o.inactive && (o.id === d.objectId || !usedIds.has(o.id))).map((o) => [o.id, o.name])
  const rows = d.groups
    .map(
      (g, i) => `<div class="qm-group">
        <label class="field"><span>Raumgruppe</span><input type="text" id="qmg-name-${i}" value="${esc(g.name)}" ${dis}></label>
        <label class="field"><span>Prüfobjekte wie</span><select id="qmg-tpl-${i}" data-change="qm-groups-redraw" ${dis}>${options(settings.groupTemplates.map((t) => [t.id, t.name]), g.template)}</select></label>
        <label class="field qm-rooms"><span>Räume</span><input type="number" id="qmg-rooms-${i}" min="1" max="9999" inputmode="numeric" value="${esc(g.rooms || '')}" data-input="qm-groups-live" ${dis}></label>
        ${ed ? `<button type="button" class="btn small ghost icon qm-group-del" data-action="qm-group-del" data-i="${i}" aria-label="Raumgruppe ${esc(g.name)} entfernen" title="Entfernen">${ICON.close}</button>` : ''}
        <details class="qm-names wide"><summary>Räume benennen <span class="muted">(optional${g.names?.filter(Boolean).length ? `, ${g.names.filter(Boolean).length} benannt` : ''})</span></summary><textarea id="qmg-names-${i}" rows="4" placeholder="ein Raum je Zeile, z. B. EG-01 Büro Leitung" ${dis}>${esc((g.names || []).join('\n'))}</textarea></details>
      </div>`,
    )
    .join('')
  return modalFrame({
    title: m.isNew ? 'Raumgruppen anlegen' : `Raumgruppen: ${obj?.name || 'Objekt'}`,
    subtitle: 'Los für die Stichprobe; Qualitätsniveau wie mit dem Kunden vereinbart',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Objekt</span><select id="qmg-obj" data-change="qm-groups-redraw" ${m.isNew && ed ? '' : 'disabled'}>${options(objectChoices, d.objectId, { empty: '– wählen –' })}</select></label>
      </div>
      ${ed ? `<div class="ek-beleg-bar qm-raumbuch"><button class="btn" data-action="qm-raumbuch">${ICON.folder} Aus dem Raumbuch vorschlagen</button><label class="btn ghost">${ICON.upload} Akte laden (JSON)<input type="file" accept="application/json,.json" data-change="qm-raumbuch-file" hidden></label><span class="muted small">Raumbuch der Objektdoku: Räume je Bereich, die App ordnet sie Raumgruppen zu.</span></div>` : ''}
      ${m.raumbuch ? `<p class="note">Vorschlag aus dem Raumbuch (${esc(m.raumbuch)}): bitte prüfen und speichern.</p>` : ''}
      <div class="qm-groups">${rows || '<p class="muted">Noch keine Raumgruppe.</p>'}</div>
      ${ed ? `<p><button class="btn small" data-action="qm-group-add">${ICON.plus} Raumgruppe</button></p>` : ''}
      <fieldset class="qm-level"><legend>Qualitätsniveau</legend><div class="form-grid">
        <label class="field"><span>AQL (Räume nicht in Ordnung, %)</span><select id="qmg-aql" data-change="qm-groups-redraw" ${dis}>${options(AQL_VALUES.map((v) => [v, aqlText(v)]), d.aql, { empty: `Vorgabe (${aqlText(settings.aql)})` })}</select></label>
        <label class="field"><span>oder fest: höchstens … Räume nicht in Ordnung</span><input type="number" id="qmg-accept" min="0" max="99" inputmode="numeric" value="${esc(d.accept ?? '')}" placeholder="leer = aus der AQL" data-input="qm-groups-live" ${dis}></label>
        <label class="field"><span>Zielwert Kennzahl (%)</span><input type="text" inputmode="decimal" id="qmg-target" value="${esc(d.target === '' ? '' : String(d.target).replace('.', ','))}" placeholder="${esc(String(settings.target).replace('.', ','))}" ${dis}></label>
        <label class="field"><span>E-Mail für den Bericht</span><input type="email" id="qmg-email" value="${esc(d.email || '')}" placeholder="${esc(obj?.proofEmail || 'z. B. hausverwaltung@beispiel.at')}" ${dis}></label>
        <label class="field wide"><span>Notiz</span><input type="text" id="qmg-note" value="${esc(d.note || '')}" placeholder="z. B. Messung monatlich mit der Büroleitung" ${dis}></label>
      </div></fieldset>
      <p class="qm-plan-info"><strong>${esc(planText(plan))}</strong></p>
      ${hintNote()}`,
    foot: `<div class="actions">${ed && !m.isNew && !doc().measurements.some((x) => x.objectId === d.objectId) ? `<button class="btn danger" data-action="qm-groups-delete">${app.ui.confirm === `qm-gdel:${d.objectId}` ? 'Wirklich entfernen?' : 'Objekt entfernen'}</button>` : ''}<button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button></div><div class="actions">${ed ? '<button class="btn primary" data-action="qm-groups-save">Speichern</button>' : ''}</div>`,
  })
}
registerModal('qm-groups', groupsModal, { module: MODULE })

function applyRaumbuch(groups, source) {
  const m = app.ui.modal
  const d = readGroups()
  if (!d) return
  d.groups = groups.map((g) => ({ id: uid('qg'), ...g }))
  m.raumbuch = source
  renderModal()
  toast(`Aus dem Raumbuch: ${plural(groups.length, 'Raumgruppe', 'Raumgruppen')} mit ${groups.reduce((s, g) => s + g.rooms, 0)} Räumen. Bitte prüfen und speichern.`)
}

async function fromRaumbuch() {
  const d = readGroups()
  const obj = objOf(d?.objectId)
  if (!obj) return toast('Bitte zuerst das Objekt wählen.')
  if (app.store?.kind !== 'sharepoint' || !app.store.listTree) return toast('Das Raumbuch der Objektdoku liest die App im Betrieb mit SharePoint. Hier geht es über „Akte laden“ (Sicherung der Akte aus der Objektdoku).')
  toast('Suche das Raumbuch in der Objektdoku …')
  try {
    const files = await app.store.listTree('Objektdoku', { depth: 3, skip: ['Fotos', 'Stammdaten', 'Vorlagen'] })
    for (const path of findAkte(files, obj.name)) {
      const groups = groupsFromRaumbuch(await app.store.readRoot(path), settingsOf(doc()).groupTemplates)
      if (groups.length) return applyRaumbuch(groups, path)
    }
    toast(`Kein Raumbuch für „${obj.name}“ in der Objektdoku gefunden (Akte mit erfassten Räumen).`)
  } catch (err) {
    toast(`Raumbuch nicht gelesen: ${err.message}`)
  }
}

function saveGroups() {
  const d = readGroups()
  if (!d) return
  if (!d.objectId || !objOf(d.objectId)) return toast('Bitte das Objekt wählen.')
  const groups = d.groups.map((g) => ({ ...g, name: g.name.trim() }))
  const problem = groupsProblem(groups)
  if (problem) return toast(problem)
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return toast('Die E-Mail-Adresse sieht nicht richtig aus.')
  const conf = { objectId: d.objectId, groups, aql: d.aql, accept: d.accept, target: d.target, email: d.email, note: d.note, changedAt: nowIso(), changedBy: user() }
  const list = doc().objects
  const idx = list.findIndex((x) => x.objectId === d.objectId)
  if (idx >= 0) list[idx] = { ...list[idx], ...conf }
  else list.push(conf)
  persist()
  closeModal()
  Object.assign(app.ui, { view: 'qualitaet', qmTab: 'objekte', qmObj: d.objectId })
  renderNow()
  const { plan } = levelOfObject(d.objectId)
  toast(`Raumgruppen gespeichert: ${plan ? `${plan.lot} Räume, Stichprobe ${plan.n}` : 'keine Räume'}.`)
}

// ---------------------------------------------------------------- Vorgaben

function settingsDraft(m) {
  m.draft ||= structuredClone(settingsOf(doc()))
  return m.draft
}

function readSettings() {
  const d = settingsDraft(app.ui.modal)
  if (!document.getElementById('qms-target')) return d
  const n = (id, fallback) => (val(id).trim() === '' ? fallback : Number(val(id).replace(',', '.')))
  d.aql = Number(val('qms-aql')) || SETTINGS_DEFAULTS.aql
  d.target = n('qms-target', SETTINGS_DEFAULTS.target)
  d.roomLimit = Math.max(1, Math.round(n('qms-limit', 1)))
  d.recheckDays = Math.max(1, Math.round(n('qms-recheck', 7)))
  d.dropPoints = Math.max(0, n('qms-drop', 5))
  d.sample = d.sample.map((r, i) => ({ upTo: Math.max(1, Math.round(n(`qms-upto-${i}`, r.upTo))), n: Math.max(1, Math.round(n(`qms-n-${i}`, r.n))) }))
  d.checkItems = d.checkItems.map((x, i) => ({ ...x, name: val(`qms-item-${i}`).trim(), weight: Math.max(0, n(`qms-w-${i}`, x.weight)) }))
  d.groupTemplates = d.groupTemplates.map((t, i) => ({ ...t, name: val(`qms-tpl-${i}`).trim(), items: d.checkItems.filter((x) => document.getElementById(`qms-tpl-${i}-${x.id}`)?.checked).map((x) => x.id) }))
  d.defectTypes = d.defectTypes.map((x, i) => ({ ...x, name: val(`qms-def-${i}`).trim() }))
  return d
}

function settingsModal(c, m) {
  const d = settingsDraft(m)
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const del = (kind, i, label) => (ed ? `<button type="button" class="btn small ghost icon" data-action="qm-set-del" data-kind="${kind}" data-i="${i}" aria-label="${esc(label)} entfernen" title="Entfernen">${ICON.close}</button>` : '')
  const sample = d.sample.map((r, i) => `<tr><td><input type="number" id="qms-upto-${i}" min="1" value="${esc(r.upTo)}" class="num-input" aria-label="Räume bis" ${dis}></td><td><input type="number" id="qms-n-${i}" min="1" value="${esc(r.n)}" class="num-input" aria-label="Stichprobe" ${dis}></td><td>${del('sample', i, 'Zeile')}</td></tr>`).join('')
  const items = d.checkItems.map((x, i) => `<tr><td><input type="text" id="qms-item-${i}" value="${esc(x.name)}" aria-label="Prüfobjekt" ${dis}></td><td><input type="number" id="qms-w-${i}" min="0" max="10" step="0.5" value="${esc(x.weight)}" class="num-input" aria-label="Gewicht" ${dis}></td><td>${del('item', i, x.name)}</td></tr>`).join('')
  const tpls = d.groupTemplates
    .map(
      (t, i) => `<details class="qm-tpl"><summary><strong>${esc(t.name)}</strong> <span class="muted">${plural(t.items.length, 'Prüfobjekt', 'Prüfobjekte')}</span></summary>
        <div class="form-grid"><label class="field"><span>Name</span><input type="text" id="qms-tpl-${i}" value="${esc(t.name)}" ${dis}></label></div>
        <div class="qm-defs">${d.checkItems.map((x) => `<label class="check"><input type="checkbox" id="qms-tpl-${i}-${esc(x.id)}" ${t.items.includes(x.id) ? 'checked' : ''} ${dis}><span>${esc(x.name)}</span></label>`).join('')}</div>${ed ? `<p>${del('tpl', i, t.name)} <span class="muted small">Vorlage entfernen</span></p>` : ''}</details>`,
    )
    .join('')
  const defects = d.defectTypes.map((x, i) => `<li><input type="text" id="qms-def-${i}" value="${esc(x.name)}" aria-label="Fehlerart" ${dis}>${del('defect', i, x.name)}</li>`).join('')
  return modalFrame({
    title: 'Vorgaben der Qualitätsmessung',
    subtitle: esc(QM_HINT),
    wide: true,
    body: `<p class="banner warn-banner"><span>${esc(QM_HINT)}. Der Wortlaut von EN 13549 und ISO 2859-1 lag beim Einrichten nicht vor: Tabelle, Gewichte und Fehlerarten bitte mit dem Kunden vereinbaren. Laufende und alte Messungen behalten ihre Werte.</span></p>
      <section><h3>Bewertung</h3><div class="form-grid">
        <label class="field"><span>AQL (Vorgabe für neue Objekte)</span><select id="qms-aql" ${dis}>${options(AQL_VALUES.map((v) => [v, aqlText(v)]), d.aql)}</select></label>
        <label class="field"><span>Zielwert Kennzahl (%)</span><input type="text" inputmode="decimal" id="qms-target" value="${esc(String(d.target).replace('.', ','))}" ${dis}></label>
        <label class="field"><span>Raum nicht in Ordnung ab … Fehlerpunkten</span><input type="number" id="qms-limit" min="1" max="20" value="${esc(d.roomLimit)}" ${dis}></label>
        <label class="field"><span>Nachkontrolle binnen … Tagen</span><input type="number" id="qms-recheck" min="1" max="60" value="${esc(d.recheckDays)}" ${dis}></label>
        <label class="field"><span>Kennzahl fällt: ab … Prozentpunkten über drei Messungen</span><input type="number" id="qms-drop" min="0" max="50" step="0.5" value="${esc(d.dropPoints)}" ${dis}></label>
      </div><p class="note">Fehlerpunkte eines Raums = Summe der Gewichte der Prüfobjekte mit Mangel. Qualitätskennzahl = gewichteter Anteil der Prüfobjekte ohne Mangel. Schlecht ist eine Messung, die nicht erfüllt ist oder unter dem Zielwert liegt.</p></section>
      <section><h3>Stichprobe je Losgröße</h3><div class="table-wrap"><table class="data qm-set-table"><thead><tr><th>Räume bis</th><th>Stichprobe (Räume)</th><th></th></tr></thead><tbody>${sample}</tbody></table></div>
        ${ed ? `<p><button class="btn small" data-action="qm-set-add" data-kind="sample">${ICON.plus} Zeile</button></p>` : ''}
        <p class="note">Vorgabe: ISO 2859-1, allgemeines Prüfniveau II, Einfach-Stichprobe, Normalprüfung. Die zulässige Zahl kommt aus der AQL nach Tabelle 2-A, dabei kann sich die Stichprobe noch ändern (Pfeile der Tabelle). Bei eigenen Werten ohne Entsprechung in der Tabelle die zulässige Zahl je Objekt festlegen.</p></section>
      <section><h3>Prüfobjekte und Gewicht</h3><div class="table-wrap"><table class="data qm-set-table"><thead><tr><th>Prüfobjekt</th><th>Gewicht</th><th></th></tr></thead><tbody>${items}</tbody></table></div>
        ${ed ? `<p><button class="btn small" data-action="qm-set-add" data-kind="item">${ICON.plus} Prüfobjekt</button></p>` : ''}</section>
      <section><h3>Raumgruppen: welche Prüfobjekte</h3>${tpls}${ed ? `<p><button class="btn small" data-action="qm-set-add" data-kind="tpl">${ICON.plus} Vorlage</button></p>` : ''}</section>
      <section><h3>Fehlerarten</h3><ul class="qm-def-list">${defects}</ul>${ed ? `<p><button class="btn small" data-action="qm-set-add" data-kind="defect">${ICON.plus} Fehlerart</button></p>` : ''}</section>`,
    foot: `<button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button><div class="actions">${ed ? `<button class="btn" data-action="qm-settings-reset">${app.ui.confirm === 'qm-set-reset' ? 'Wirklich alle Vorgaben zurücksetzen?' : 'Vorgaben wiederherstellen'}</button><button class="btn primary" data-action="qm-settings-save">Speichern</button>` : ''}</div>`,
  })
}
registerModal('qm-settings', settingsModal, { module: MODULE })

// ---------------------------------------------------------------- Messung planen (Stichprobe)

const newSeed = () => 1000 + Math.floor(Math.random() * 9000)

/** Stand des Plans: Objekt, gewählte Raumgruppen, Plan, gezogene und gewählte Räume. */
function planState(m) {
  const settings = settingsOf(doc())
  const conf = objectConf(doc(), m.objectId)
  const groups = (conf?.groups || []).filter((g) => Number(g.rooms) > 0)
  const sel = m.groupIds ? groups.filter((g) => m.groupIds.includes(g.id)) : groups
  const level = levelOf(conf, settings)
  const plan = planFor(lotSize(sel), { aql: level.aql, accept: level.accept, sample: settings.sample })
  const drawn = plan ? drawSample({ groups: sel, n: plan.n, seed: m.seed }) : []
  return { settings, conf, groups, sel, level, plan, drawn, picks: m.picks || drawn }
}

function readPlan() {
  const m = app.ui.modal
  if (m?.type !== 'qm-plan') return null
  if (!document.getElementById('qmp-obj')) return m
  const objectId = val('qmp-obj')
  m.date = val('qmp-date') || m.date
  if (objectId !== m.objectId) Object.assign(m, { objectId, groupIds: null, picks: null })
  else {
    const boxes = [...document.querySelectorAll('input[name="qmp-group"]')]
    const ids = boxes.filter((b) => b.checked).map((b) => b.value)
    const before = m.groupIds || boxes.map((b) => b.value)
    if (ids.join() !== before.join()) Object.assign(m, { groupIds: ids, picks: null })
    const seed = Math.round(Number(val('qmp-seed')) || 0)
    if (seed && seed !== m.seed) Object.assign(m, { seed, picks: null })
  }
  return m
}

function planModal(c, m) {
  const today = todayISO()
  const s = planState(m)
  const st = s.conf ? objectStatus({ doc: doc(), objectId: m.objectId, today }) : null
  const choices = doc()
    .objects.filter((x) => objOf(x.objectId) && !objOf(x.objectId).inactive && lotSize(x.groups) > 0)
    .map((x) => [x.objectId, objName(x.objectId)])
    .sort((a, b) => a[1].localeCompare(b[1], 'de'))
  const groupBoxes = s.groups.map((g) => `<label class="check"><input type="checkbox" name="qmp-group" value="${esc(g.id)}" ${s.sel.includes(g) ? 'checked' : ''} data-change="qm-plan-redraw"><span>${esc(g.name)} <span class="muted">(${g.rooms})</span></span></label>`).join('')
  const taken = new Set(s.picks.map((p) => `${p.groupId}#${p.no}`))
  const lists = s.sel
    .map((g) => {
      const mine = s.picks.map((p, i) => ({ ...p, i })).filter((p) => p.groupId === g.id)
      const items = mine
        .map((p) => {
          const opts = Array.from({ length: Number(g.rooms) }, (_, k) => k + 1).filter((no) => no === p.no || !taken.has(`${g.id}#${no}`))
          return `<li><select id="qmp-room-${p.i}" data-change="qm-plan-room" data-i="${p.i}" aria-label="Raum der Stichprobe">${options(opts.map((no) => [no, roomLabel(g, no)]), p.no)}</select><button type="button" class="btn small ghost icon" data-action="qm-plan-del" data-i="${p.i}" aria-label="${esc(roomLabel(g, p.no))} aus der Stichprobe nehmen" title="Aus der Stichprobe nehmen">${ICON.close}</button></li>`
        })
        .join('')
      return `<div class="qm-pick-group"><h4>${esc(g.name)} <span class="muted">${mine.length} von ${g.rooms}</span></h4><ul class="qm-picks">${items}</ul>${mine.length < Number(g.rooms) ? `<button type="button" class="btn small ghost" data-action="qm-plan-add" data-g="${esc(g.id)}">${ICON.plus} Raum</button>` : ''}</div>`
    })
    .join('')
  const off = s.plan && s.picks.length !== s.plan.n
  return modalFrame({
    title: 'Messung starten',
    subtitle: s.conf ? esc(objName(m.objectId)) : 'Objekt wählen',
    body: `<div class="form-grid">
        <label class="field"><span>Objekt</span><select id="qmp-obj" data-change="qm-plan-redraw">${options(choices, m.objectId, { empty: '– Objekt –' })}</select></label>
        <label class="field"><span>Datum</span><input type="date" id="qmp-date" value="${esc(m.date)}" max="${today}"></label>
      </div>
      ${st?.recheck ? `<p class="banner warn-banner"><span><strong>Nachkontrolle</strong> zur Messung vom ${short(st.last.date)} (${st.recheck.overdue ? 'überfällig' : `bis ${short(st.recheck.due)}`}).</span></p>` : ''}
      ${s.groups.length ? `<fieldset class="qm-level"><legend>Raumgruppen</legend><div class="qm-defs">${groupBoxes}</div></fieldset>` : ''}
      ${s.plan ? `<p class="qm-plan-info"><strong>${esc(planText(s.plan))}</strong></p>
        <div class="form-grid"><label class="field"><span>Startwert für die Zufallsauswahl</span><span class="qm-seed"><input type="number" id="qmp-seed" min="1" max="999999" inputmode="numeric" value="${esc(m.seed)}"><button type="button" class="btn small" data-action="qm-plan-draw">Ziehen</button><button type="button" class="btn small ghost" data-action="qm-plan-seed">${ICON.refresh} neuer Startwert</button></span><small class="muted">gleicher Startwert, gleiche Räume</small></label></div>
        <div class="qm-sample">${lists}</div>
        ${off ? `<p class="banner warn-banner"><span>Die Stichprobe hat ${s.picks.length} statt ${s.plan.n} Räume (von Hand geändert). Das Ergebnis gilt dann nur eingeschränkt.</span></p>` : ''}
        ${m.picks ? '<p class="note">Räume von Hand geändert: „Ziehen“ stellt die Zufallsauswahl zum Startwert wieder her.</p>' : ''}` : s.conf ? '<p class="empty">Bitte mindestens eine Raumgruppe wählen.</p>' : ''}
      <p class="note">${esc(QM_HINT)}. Nicht zugängliche Räume einfach durch einen anderen derselben Raumgruppe ersetzen.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="qm-plan-start">Messung beginnen</button></div>`,
  })
}
registerModal('qm-plan', planModal, { module: MODULE })

function startMeasurement() {
  const typed = Math.round(Number(val('qmp-seed')) || 0)
  const before = app.ui.modal?.seed
  const m = readPlan()
  if (!m) return
  // neuer Startwert getippt, aber noch nicht gezogen: erst die Räume zeigen, dann beginnen
  if (typed && typed !== before) {
    renderModal()
    return toast('Neuer Startwert: bitte die Räume prüfen und noch einmal „Messung beginnen“.')
  }
  const s = planState(m)
  const today = todayISO()
  const problem = planProblem({ conf: s.conf, date: m.date, today, picks: s.picks, plan: s.plan })
  if (problem) return toast(problem)
  const st = objectStatus({ doc: doc(), objectId: m.objectId, today })
  const id = uid('qm')
  const meas = newMeasurement({ id, conf: s.conf, settings: s.settings, date: m.date, seed: m.seed, groupIds: s.sel.map((g) => g.id), picks: m.picks ? s.picks : null, by: user(), at: nowIso(), recheckOf: st.recheck?.of || null })
  doc().measurements.push(meas)
  persist()
  openModal({ type: 'qm-rate', id, i: 0 })
  renderNow()
}

// ---------------------------------------------------------------- Bewerten (am Handy)

function rateModal(c, mo) {
  const m = measurementOf(mo.id)
  if (!m) return ''
  if (mo.step === 'finish') return finishModal(m)
  const settings = settingsOf(doc())
  const ed = editable()
  const i = Math.min(Math.max(0, Number(mo.i) || 0), m.rooms.length - 1)
  const room = m.rooms[i]
  const rr = roomResult(room, m.roomLimit)
  const res = evaluate(m)
  const strip = m.rooms
    .map((r, j) => {
      const x = roomResult(r, m.roomLimit)
      const state = !r.checked ? 'offen' : x.ok ? 'in Ordnung' : 'nicht in Ordnung'
      return `<button type="button" class="qm-chip ${!r.checked ? 'open' : x.ok ? 'ok' : 'bad'}" data-action="qm-room" data-i="${j}" aria-current="${j === i}" aria-label="Raum ${j + 1}, ${esc(r.label)}: ${state}" title="${esc(r.label)}">${j + 1}</button>`
    })
    .join('')
  const items = room.items
    .map((it, k) => {
      const btn = (s, label) => `<button type="button" class="filter qm-state qm-${s}" data-action="qm-item" data-k="${k}" data-s="${s}" aria-pressed="${it.state === s}" ${ed ? '' : 'disabled'}>${label}</button>`
      const defs = it.state === 'mangel'
        ? `<div class="qm-defs" role="group" aria-label="Fehlerarten ${esc(it.name)}">${settings.defectTypes.map((x) => `<label class="check qm-def"><input type="checkbox" data-change="qm-defect" data-k="${k}" value="${esc(x.id)}" ${it.defects.includes(x.id) ? 'checked' : ''} ${ed ? '' : 'disabled'}><span>${esc(x.name)}</span></label>`).join('')}</div>
          <div class="qm-more"><input type="text" id="qmr-note-${k}" data-change="qm-note" data-k="${k}" value="${esc(it.note || '')}" placeholder="Notiz (optional), z. B. Kaffeeflecken beim Drucker" aria-label="Notiz zu ${esc(it.name)}" ${ed ? '' : 'disabled'}>
            ${it.photo ? `<span class="pill qm-file">${ICON.camera} <button type="button" class="link-btn" data-action="qm-file" data-id="${esc(m.id)}" data-room="${i}" data-k="${k}">Foto</button>${ed ? ` <button type="button" class="btn small ghost" data-action="qm-photo-del" data-k="${k}" aria-label="Foto entfernen">${ICON.close}</button>` : ''}</span>` : ed ? `<label class="btn small">${ICON.camera} Foto<input type="file" accept="image/*" capture="environment" data-change="qm-photo" data-k="${k}" hidden></label>` : ''}</div>`
        : ''
      return `<div class="qm-item ${it.state === 'mangel' ? 'bad' : ''}"><div class="qm-item-head"><strong>${esc(it.name)}</strong> <span class="muted small">Gewicht ${esc(String(it.weight).replace('.', ','))}</span></div>
        <div class="qm-states" role="group" aria-label="${esc(it.name)}">${btn('ok', 'in Ordnung')}${btn('mangel', 'Mangel')}${btn('na', 'entfällt')}</div>${defs}</div>`
    })
    .join('')
  const last = i === m.rooms.length - 1
  return modalFrame({
    title: room.label,
    subtitle: `Raum ${i + 1} von ${m.rooms.length} · ${esc(room.group)} · ${esc(objName(m.objectId))} · ${short(m.date)}`,
    body: `<nav class="qm-strip" aria-label="Räume der Stichprobe">${strip}</nav>
      <p class="qm-room-state">${rr.rated ? (rr.ok ? '<span class="pill ok">in Ordnung</span>' : `<span class="pill error">nicht in Ordnung</span> <span class="muted">${plural(rr.points, 'Fehlerpunkt', 'Fehlerpunkte')}</span>`) : '<span class="pill na">nicht bewertet</span>'}</p>
      <div class="qm-items">${items}</div>
      <p class="qm-running muted small">Bisher: ${plural(res.bad, 'Raum', 'Räume')} nicht in Ordnung (zulässig ${res.ac ?? '–'}), Kennzahl ${pct(res.score)} · ${m.rooms.filter((x) => x.checked).length} von ${m.rooms.length} Räumen angesehen</p>`,
    foot: `<button class="btn" data-action="qm-room-prev" ${i === 0 ? 'disabled' : ''}>${ICON.left} Zurück</button><div class="actions">${ed ? `<button class="btn primary" data-action="qm-room-next">${last ? 'Raum fertig, abschließen' : 'Raum fertig, weiter'} ${ICON.right}</button>` : ''}</div>`,
  })
}
registerModal('qm-rate', rateModal, { module: MODULE })

function finishModal(m) {
  const r = evaluate(m)
  const bad = m.rooms.filter((x) => !roomResult(x, m.roomLimit).ok)
  const names = Object.fromEntries(settingsOf(doc()).defectTypes.map((x) => [x.id, x.name]))
  return modalFrame({
    title: 'Messung abschließen',
    subtitle: `${esc(objName(m.objectId))} · ${short(m.date)}`,
    body: `<div class="impact-stats tc-stats qm-result"><div class="stat ${r.ok === false ? 'err' : ''}"><div class="label">Ergebnis</div><div class="value">${r.ok === null ? '–' : r.ok ? 'erfüllt' : 'nicht erfüllt'}</div></div><div class="stat"><div class="label">Qualitätskennzahl</div><div class="value">${pct(r.score)}</div></div><div class="stat"><div class="label">nicht in Ordnung</div><div class="value">${r.bad} von ${r.rooms}</div></div></div>
      <p class="muted">Zulässig: ${r.ac ?? '–'} (${esc(levelText(m.plan))}); Zielwert ${pct(r.target)}. ${r.itemsOk} von ${r.items} Prüfobjekten ohne Mangel.</p>
      ${bad.length ? `<ul class="tc-list qm-bad">${bad.map((x) => `<li><strong>${esc(x.label)}</strong> <span class="muted">(${esc(x.group)})</span>: ${esc(x.items.filter((it) => it.state === 'mangel').map((it) => `${it.name}${it.defects.length ? ` (${it.defects.map((id) => names[id] || id).join(', ')})` : ''}`).join('; '))}</li>`).join('')}</ul>` : '<p>Alle Räume in Ordnung.</p>'}
      <div class="form-grid">
        <label class="field wide"><span>Bemerkung (steht im Bericht)</span><textarea id="qmf-note" rows="2" placeholder="z. B. Messung gemeinsam mit der Büroleitung">${esc(m.note || '')}</textarea></label>
        <label class="field"><span>Kunde anwesend (Name, optional)</span><input type="text" id="qmf-customer" value="${esc(m.customer || '')}" autocomplete="name"></label>
      </div>
      ${signatureField('qm-sig', 'Unterschrift Kunde (optional, am Handy oder Tablet)')}`,
    foot: `<button class="btn" data-action="qm-room" data-i="0">${ICON.left} Zu den Räumen</button><div class="actions"><button class="btn primary" data-action="qm-finish-save">Messung abschließen</button></div>`,
  })
}

/** Notizen der offenen Mängel übernehmen (ohne Neuzeichnen; Blur kommt vor dem Klick). */
function readNotes() {
  const mo = app.ui.modal
  const m = mo?.type === 'qm-rate' ? measurementOf(mo.id) : null
  const room = m?.rooms[mo.i || 0]
  if (!room || mo.step === 'finish') return
  room.items.forEach((it, k) => {
    const el = document.getElementById(`qmr-note-${k}`)
    if (el) it.note = el.value.trim()
  })
}

const rateRoom = () => {
  const mo = app.ui.modal
  const m = mo?.type === 'qm-rate' ? measurementOf(mo.id) : null
  return m ? { mo, m, room: m.rooms[Math.min(Number(mo.i) || 0, m.rooms.length - 1)] } : {}
}

async function finishMeasurement() {
  const mo = app.ui.modal
  const m = measurementOf(mo?.id)
  if (!m) return
  const open = m.rooms.findIndex((x) => !x.checked)
  if (open >= 0) {
    Object.assign(mo, { step: 'rooms', i: open })
    renderModal()
    return toast(`Bitte zuerst alle Räume ansehen (${plural(m.rooms.filter((x) => !x.checked).length, 'Raum ist', 'Räume sind')} noch offen).`)
  }
  m.note = val('qmf-note').trim()
  m.customer = val('qmf-customer').trim()
  const svg = signatureSvg('qm-sig')
  m.signature = svg ? { name: m.customer, svg, at: nowIso() } : null
  clearSignatures('qm-')
  Object.assign(m, { status: 'fertig', finishedAt: nowIso(), result: evaluate(m) })
  persist()
  openModal({ type: 'qm-show', id: m.id })
  renderNow()
  toast('Messung abgeschlossen, der Bericht wird erstellt …')
  const report = await storeReport(m)
  if (app.ui.modal?.type === 'qm-show' && app.ui.modal.id === m.id) renderModal()
  renderNow()
  const r = m.result
  toast(`Messung abgeschlossen: ${r.ok === null ? 'ohne Annahmezahl' : r.ok ? 'erfüllt' : 'nicht erfüllt'}, Kennzahl ${pct(r.score)}${report ? (report.local ? '; Bericht erstellt' : report.queued ? '; der Bericht wird hochgeladen, sobald wieder Netz da ist' : '; Bericht in SharePoint abgelegt') : ''}.`)
}

// ---------------------------------------------------------------- Messung ansehen, Bericht, E-Mail

function showModal(c, mo) {
  const m = measurementOf(mo.id)
  if (!m) return ''
  const ed = editable()
  const r = resultOf(m)
  const running = m.status !== 'fertig'
  const names = Object.fromEntries(settingsOf(doc()).defectTypes.map((x) => [x.id, x.name]))
  const st = statusAt(m.objectId)
  const isLast = st.last?.id === m.id
  const rows = m.rooms
    .map((room, ri) => {
      const x = roomResult(room, m.roomLimit)
      const defects = room.items
        .map((it, k) => ({ it, k }))
        .filter(({ it }) => it.state === 'mangel')
        .map(({ it, k }) => `${esc(it.name)}${it.defects.length ? `: ${esc(it.defects.map((id) => names[id] || id).join(', '))}` : ''}${it.note ? ` <span class="muted">(${esc(it.note)})</span>` : ''}${it.photo ? ` <button type="button" class="pill qm-file" data-action="qm-file" data-id="${esc(m.id)}" data-room="${ri}" data-k="${k}">${ICON.camera} Foto</button>` : ''}`)
      return `<tr><td><strong>${esc(room.label)}</strong></td><td>${esc(room.group)}</td><td>${!room.checked && running ? '<span class="pill info">offen</span>' : x.rated ? (x.ok ? '<span class="pill ok">in Ordnung</span>' : '<span class="pill error">nicht in Ordnung</span>') : '<span class="pill na">nicht bewertet</span>'}</td><td>${defects.join('<br>') || '–'}</td></tr>`
    })
    .join('')
  const del = ed ? `<button class="btn danger" data-action="qm-delete" data-id="${esc(m.id)}">${app.ui.confirm === `qm-del:${m.id}` ? 'Wirklich löschen?' : running ? 'Verwerfen' : 'Löschen'}</button>` : ''
  return modalFrame({
    title: `Qualitätsmessung ${short(m.date)}`,
    subtitle: `${esc(objName(m.objectId))}${m.recheckOf ? ' · Nachkontrolle' : ''}${running ? ' · läuft' : ''}`,
    wide: true,
    body: `<div class="impact-stats tc-stats qm-result"><div class="stat ${r.ok === false ? 'err' : ''}"><div class="label">Ergebnis</div><div class="value">${running ? 'läuft' : r.ok === null ? '–' : r.ok ? 'erfüllt' : 'nicht erfüllt'}</div></div><div class="stat"><div class="label">Qualitätskennzahl</div><div class="value">${pct(r.score)}</div></div><div class="stat"><div class="label">nicht in Ordnung</div><div class="value">${r.bad} von ${r.rooms}</div></div></div>
      <p class="muted">Los ${m.lot} Räume, Stichprobe ${m.rooms.length} Räume${m.plan?.full ? ' (alle)' : ''}, zulässig ${r.ac ?? '–'} (${esc(levelText(m.plan))}), Zielwert ${pct(r.target)}; Startwert ${esc(m.seed)}${m.manual ? ', Räume von Hand geändert' : ''}. Gemessen von ${esc(m.by || '–')}.</p>
      <div class="table-wrap"><table class="data qm-table"><thead><tr><th>Raum</th><th>Raumgruppe</th><th>Ergebnis</th><th>Mängel</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${m.note ? `<p><strong>Bemerkung:</strong> ${esc(m.note)}</p>` : ''}
      ${running ? '' : `<p>${m.signature ? `<span class="pill ok">vom Kunden unterschrieben</span>${m.signature.name ? ` ${esc(m.signature.name)}` : ''}` : '<span class="muted">ohne Unterschrift des Kunden</span>'}${m.report ? ` · <button type="button" class="link-btn" data-action="qm-file" data-id="${esc(m.id)}" data-i="report">Bericht${m.report.local ? '' : ' in SharePoint'}</button>` : ''}${m.sent?.length ? ` · gesendet an ${esc(m.sent.at(-1).to.join(', '))} am ${short(m.sent.at(-1).at.slice(0, 10))}` : ''}</p>`}
      ${isLast && st.recheck ? `<p class="banner warn-banner"><span><strong>Nachkontrolle ${st.recheck.overdue ? 'überfällig' : `bis ${short(st.recheck.due)}`}.</strong>${st.risk ? ' Reklamationsgefahr.' : ''}</span></p>` : ''}`,
    foot: `<div class="actions">${del}${!running ? `<button class="btn" data-action="qm-pdf" data-id="${esc(m.id)}">${ICON.download} Bericht (PDF)</button>` : ''}${sees('reklamationen') ? `<button class="btn" data-action="qm-complaints" data-obj="${esc(m.objectId)}">Reklamationen</button>` : ''}</div>
      <div class="actions">${running && ed ? `<button class="btn primary" data-action="qm-rate-open" data-id="${esc(m.id)}">Fortsetzen</button>` : ''}${!running && isLast && st.recheck && canEdit('termine') && !app.readOnly ? `<button class="btn" data-action="qm-appt" data-obj="${esc(m.objectId)}">${ICON.calendar} Nachkontrolle als Termin</button>` : ''}${!running && ed ? `<button class="btn primary" data-action="qm-mail" data-id="${esc(m.id)}">${ICON.send} An den Kunden senden</button>` : ''}</div>`,
  })
}
registerModal('qm-show', showModal, { module: MODULE })

async function mailReport(m) {
  const obj = objOf(m.objectId) || {}
  const conf = objectConf(doc(), m.objectId)
  toast('Bericht wird erstellt …')
  let blob
  try {
    blob = (await readFile(m.report)) || (await reportBlob(m))
  } catch (err) {
    return toast(`Bericht nicht erstellt: ${err.message}`)
  }
  const r = resultOf(m)
  const brand = app.config.brand?.name || ''
  openCompose({
    to: conf?.email || obj.proofEmail || '',
    subject: `Qualitätsmessung ${obj.name || ''} vom ${short(m.date)}`,
    text: [
      'Sehr geehrte Damen und Herren,',
      '',
      `im Anhang der Bericht unserer Qualitätsmessung vom ${short(m.date)} im Objekt ${obj.name || ''}.`,
      `Ergebnis: ${r.ok === null ? 'ohne Bewertung' : r.ok ? 'erfüllt' : 'nicht erfüllt'}, Qualitätskennzahl ${pct(r.score)} (${r.bad} von ${r.rooms} Räumen der Stichprobe nicht in Ordnung).`,
      r.ok === false ? 'Die Mängel beheben wir umgehend; eine Nachkontrolle ist eingeplant.' : '',
      '',
      'Mit freundlichen Grüßen',
      app.user?.name || '',
      brand,
    ]
      .filter((x, i, all) => x !== '' || all[i - 1] !== '')
      .join('\n'),
    files: [{ name: qualitaetPdfName(obj.name || 'Objekt', m.date), blob, type: 'application/pdf' }],
    origin: `Qualitätsmessung ${obj.name || ''}`,
    onSent: ({ to }) => {
      const cur = measurementOf(m.id)
      if (!cur) return
      cur.sent = [...(cur.sent || []), { at: nowIso(), to, by: user() }]
      persist()
      renderNow()
    },
  })
}

// ---------------------------------------------------------------- Export

const csvColumns = [
  ['Datum', (m) => m.date],
  ['Objekt', (m) => objName(m.objectId)],
  ['Revier', (m) => objOf(m.objectId)?.region || ''],
  ['Status', (m) => (m.status === 'fertig' ? 'abgeschlossen' : 'läuft')],
  ['Nachkontrolle', (m) => (m.recheckOf ? 'ja' : '')],
  ['Los (Räume)', (m) => m.lot],
  ['Stichprobe (Räume)', (m) => m.rooms.length],
  ['Qualitätsniveau', (m) => levelText(m.plan)],
  ['zulässig', (m) => resultOf(m).ac ?? ''],
  ['nicht in Ordnung', (m) => resultOf(m).bad],
  ['Kennzahl', (m) => (resultOf(m).score === null ? '' : String(resultOf(m).score).replace('.', ','))],
  ['Zielwert', (m) => String(resultOf(m).target).replace('.', ',')],
  ['Ergebnis', (m) => (m.status !== 'fertig' ? '' : resultOf(m).ok === null ? '' : resultOf(m).ok ? 'erfüllt' : 'nicht erfüllt')],
  ['gemessen von', (m) => m.by || ''],
  ['unterschrieben', (m) => (m.signature ? 'ja' : '')],
]

/** Nächster Werktag (Mo–Fr) ab einem Tag; liegt die Frist am Wochenende, lieber den Freitag davor (nicht vor morgen). */
function workdayBefore(date, earliest) {
  let d = date
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()) && d > earliest) d = addDays(d, -1)
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, 1)
  return d
}

// ---------------------------------------------------------------- Aktionen

registerActions({
  'qm-tab': (el) => {
    app.ui.qmTab = el.dataset.v
    renderNow()
  },
  'qm-filter': () => {
    app.ui.qmObj = val('qm-f-obj')
    app.ui.qmRegion = document.getElementById('qm-f-region') ? val('qm-f-region') : ''
    renderNow()
  },
  'qm-reset': () => {
    Object.assign(app.ui, { qmObj: '', qmRegion: '' })
    renderNow()
  },
  // von „Zu erledigen“, dem digitalen Mitarbeiter, der Suche und dem Einsatz-Dialog: das Objekt mit Verlauf
  'qm-goto': (el) => {
    Object.assign(app.ui, { view: 'qualitaet', qmTab: 'objekte', qmObj: el.dataset.obj || '', qmRegion: '' })
    if (app.ui.modal) closeModal()
    renderNow()
  },
  'qm-show': (el) => openModal({ type: 'qm-show', id: el.dataset.id }),
  'qm-file': (el) => {
    const m = measurementOf(el.dataset.id)
    if (!m) return
    openFile(el.dataset.i === 'report' ? m.report : m.rooms[Number(el.dataset.room)]?.items[Number(el.dataset.k)]?.photo)
  },
  'qm-pdf': async (el) => {
    const m = measurementOf(el.dataset.id)
    if (!m) return
    try {
      download(qualitaetPdfName(objName(m.objectId), m.date), await reportBlob(m))
    } catch (err) {
      toast(`Bericht nicht erstellt: ${err.message}`)
    }
  },
  'qm-csv': () => {
    const list = doc()
      .measurements.filter((m) => (!app.ui.qmObj || m.objectId === app.ui.qmObj) && inRegion(m.objectId))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    download(`Qualitaetsmessungen_${todayISO()}.csv`, new Blob([`﻿${toCSV(list, csvColumns)}`], { type: 'text/csv;charset=utf-8' }))
  },
  'qm-complaints': (el) => {
    Object.assign(app.ui, { view: 'reklamationen', complaintObject: el.dataset.obj || '', complaintFilter: 'alle' })
    if (app.ui.modal) closeModal()
    renderNow()
  },
  'qm-groups-open': (el) => openModal({ type: 'qm-groups', objectId: el?.dataset?.obj || '' }),
  'qm-groups-redraw': () => {
    if (readGroups()) renderModal()
  },
  // beim Tippen (Räume, feste Zahl): nur den Plan neu schreiben, ohne den Dialog neu zu zeichnen (Fokus bleibt)
  'qm-groups-live': () => {
    const d = readGroups()
    const el = document.querySelector('#modal-root .qm-plan-info strong')
    if (!d || !el) return
    const settings = settingsOf(doc())
    const level = levelOf(d, settings)
    el.textContent = planText(planFor(lotSize(d.groups), { aql: level.aql, accept: level.accept, sample: settings.sample }))
  },
  'qm-settings-open': () => openModal({ type: 'qm-settings' }),
})

registerActions(
  {
    'qm-group-add': () => {
      const d = readGroups()
      if (!d) return
      const templates = settingsOf(doc()).groupTemplates
      const used = new Set(d.groups.map((g) => g.template))
      const t = templates.find((x) => !used.has(x.id)) || templates.at(-1)
      d.groups.push({ id: uid('qg'), name: d.groups.some((g) => g.name === t.name) ? '' : t.name, template: t.id, rooms: '', names: [] })
      renderModal()
    },
    'qm-group-del': (el) => {
      const d = readGroups()
      if (!d) return
      d.groups.splice(Number(el.dataset.i), 1)
      renderModal()
    },
    'qm-raumbuch': () => fromRaumbuch(),
    'qm-raumbuch-file': async (el) => {
      const file = el.files?.[0]
      const d = readGroups()
      if (!file || !d) return
      try {
        const data = JSON.parse((await file.text()).replace(/^﻿/, ''))
        const name = objName(d.objectId).toLowerCase()
        const akte = Array.isArray(data?.objekte) ? data.objekte.find((o) => String(o.objekt || '').trim().toLowerCase() === name) || data.objekte.find((o) => (o.bereiche || []).length) : data
        const groups = groupsFromRaumbuch(akte, settingsOf(doc()).groupTemplates)
        if (!groups.length) return toast('In dieser Datei ist kein Raumbuch mit Räumen (Objektdoku: Bereiche → Räume).')
        applyRaumbuch(groups, file.name)
      } catch {
        toast('Die Datei ist keine Akte der Objektdoku (JSON).')
      }
    },
    'qm-groups-save': () => saveGroups(),
    // nur ohne Messungen (sonst bleibt der Verlauf ohne Raumgruppen stehen)
    'qm-groups-delete': () => {
      const d = readGroups()
      if (!d || doc().measurements.some((x) => x.objectId === d.objectId)) return
      if (!confirmStep(`qm-gdel:${d.objectId}`, renderModal)) return
      doc().objects = doc().objects.filter((x) => x.objectId !== d.objectId)
      persist()
      closeModal()
      if (app.ui.qmObj === d.objectId) app.ui.qmObj = ''
      renderNow()
      toast(`${objName(d.objectId)}: Raumgruppen entfernt.`)
    },
    'qm-set-add': (el) => {
      const d = readSettings()
      const kind = el.dataset.kind
      if (kind === 'sample') d.sample.push({ upTo: (Number(d.sample.at(-1)?.upTo) || 0) * 2 || 10, n: Number(d.sample.at(-1)?.n) || 2 })
      if (kind === 'item') d.checkItems.push({ id: uid('qi'), name: 'Neues Prüfobjekt', weight: 1 })
      if (kind === 'tpl') d.groupTemplates.push({ id: uid('qt'), name: 'Neue Raumgruppe', items: d.checkItems.slice(0, 1).map((x) => x.id) })
      if (kind === 'defect') d.defectTypes.push({ id: uid('qd'), name: 'Neue Fehlerart' })
      renderModal()
    },
    'qm-set-del': (el) => {
      const d = readSettings()
      const key = { sample: 'sample', item: 'checkItems', tpl: 'groupTemplates', defect: 'defectTypes' }[el.dataset.kind]
      if (!key || d[key].length <= 1) return toast('Mindestens ein Eintrag muss bleiben.')
      const [gone] = d[key].splice(Number(el.dataset.i), 1)
      if (key === 'checkItems') for (const t of d.groupTemplates) t.items = t.items.filter((id) => id !== gone.id)
      renderModal()
    },
    'qm-settings-reset': () => {
      if (!confirmStep('qm-set-reset', renderModal)) return
      app.ui.modal.draft = { ...structuredClone(settingsOf(null)), sample: structuredClone(SAMPLE_DEFAULTS), checkItems: structuredClone(ITEM_DEFAULTS), defectTypes: structuredClone(DEFECT_DEFAULTS), groupTemplates: structuredClone(GROUP_DEFAULTS) }
      renderModal()
      toast('Vorgaben wiederhergestellt. Mit „Speichern“ übernehmen.')
    },
    'qm-settings-save': () => {
      const d = readSettings()
      if ([...d.checkItems, ...d.groupTemplates, ...d.defectTypes].some((x) => !x.name)) return toast('Jeder Eintrag braucht einen Namen.')
      if (d.groupTemplates.some((t) => !t.items.length)) return toast('Jede Raumgruppe braucht mindestens ein Prüfobjekt.')
      if (!(d.target >= 0 && d.target <= 100)) return toast('Der Zielwert liegt zwischen 0 und 100 %.')
      const sample = [...d.sample].sort((a, b) => a.upTo - b.upTo)
      if (new Set(sample.map((r) => r.upTo)).size !== sample.length) return toast('Zwei Zeilen der Stichprobe haben dieselbe Losgröße.')
      doc().settings = { sample, checkItems: d.checkItems, defectTypes: d.defectTypes, groupTemplates: d.groupTemplates, aql: d.aql, target: d.target, roomLimit: d.roomLimit, recheckDays: d.recheckDays, dropPoints: d.dropPoints }
      persist()
      closeModal()
      renderNow()
      toast('Vorgaben gespeichert. Sie gelten für neue Messungen.')
    },
    'qm-measure-open': (el) => {
      const ids = doc().objects.filter((x) => objOf(x.objectId) && lotSize(x.groups) > 0).map((x) => x.objectId)
      if (!ids.length) return openModal({ type: 'qm-groups', objectId: el?.dataset?.obj || '' })
      const want = el?.dataset?.obj || app.ui.qmObj || ''
      openModal({ type: 'qm-plan', objectId: ids.includes(want) ? want : ids.length === 1 ? ids[0] : '', date: todayISO(), seed: newSeed(), groupIds: null, picks: null })
    },
    'qm-plan-redraw': () => {
      if (readPlan()) renderModal()
    },
    'qm-plan-draw': () => {
      const m = readPlan()
      if (!m) return
      m.picks = null
      renderModal()
    },
    'qm-plan-seed': () => {
      const m = readPlan()
      if (!m) return
      Object.assign(m, { seed: newSeed(), picks: null })
      renderModal()
    },
    'qm-plan-room': (el) => {
      const m = readPlan()
      if (!m) return
      const s = planState(m)
      m.picks = s.picks.map((p, i) => (i === Number(el.dataset.i) ? { ...p, no: Number(el.value) } : { ...p }))
      renderModal()
    },
    'qm-plan-del': (el) => {
      const m = readPlan()
      if (!m) return
      m.picks = planState(m).picks.filter((_, i) => i !== Number(el.dataset.i))
      renderModal()
    },
    'qm-plan-add': (el) => {
      const m = readPlan()
      if (!m) return
      const s = planState(m)
      const g = s.sel.find((x) => x.id === el.dataset.g)
      if (!g) return
      const taken = new Set(s.picks.filter((p) => p.groupId === g.id).map((p) => p.no))
      const no = Array.from({ length: Number(g.rooms) }, (_, k) => k + 1).find((x) => !taken.has(x))
      if (!no) return
      const picks = [...s.picks, { groupId: g.id, no }]
      const order = s.sel.map((x) => x.id)
      m.picks = picks.sort((a, b) => order.indexOf(a.groupId) - order.indexOf(b.groupId) || a.no - b.no)
      renderModal()
    },
    'qm-plan-start': () => startMeasurement(),
    'qm-rate-open': (el) => {
      const m = measurementOf(el.dataset.id)
      if (!m) return
      const open = m.rooms.findIndex((x) => !x.checked)
      openModal({ type: 'qm-rate', id: m.id, i: open < 0 ? 0 : open, step: open < 0 ? 'finish' : 'rooms' })
    },
    'qm-room': (el) => {
      readNotes()
      const mo = app.ui.modal
      const m = measurementOf(mo?.id)
      // vom Abschluss zurück: Bemerkung und Name nicht verlieren
      if (m && mo.step === 'finish' && document.getElementById('qmf-note')) Object.assign(m, { note: val('qmf-note').trim(), customer: val('qmf-customer').trim() })
      Object.assign(mo, { i: Number(el.dataset.i) || 0, step: 'rooms' })
      renderModal()
      document.querySelector('#modal-root .modal-backdrop')?.scrollTo?.(0, 0)
    },
    'qm-room-prev': () => {
      readNotes()
      app.ui.modal.i = Math.max(0, (Number(app.ui.modal.i) || 0) - 1)
      renderModal()
    },
    'qm-room-next': () => {
      readNotes()
      const { mo, m, room } = rateRoom()
      if (!room) return
      room.checked = true
      persist()
      const i = Number(mo.i) || 0
      const open = m.rooms.findIndex((x) => !x.checked)
      if (open < 0) mo.step = 'finish'
      else if (i < m.rooms.length - 1) mo.i = i + 1
      else {
        mo.i = open
        toast(`Noch ${plural(m.rooms.filter((x) => !x.checked).length, 'Raum', 'Räume')} offen.`)
      }
      renderModal()
      document.querySelector('#modal-root .modal-backdrop')?.scrollTo?.(0, 0)
    },
    'qm-item': (el) => {
      readNotes()
      const { m, room } = rateRoom()
      const it = room?.items[Number(el.dataset.k)]
      if (!it) return
      it.state = el.dataset.s
      if (it.state !== 'mangel') Object.assign(it, { defects: [], note: '' })
      persist()
      renderModal()
      if (m && it.state === 'mangel') document.querySelector(`#modal-root [data-k="${el.dataset.k}"][data-change="qm-defect"]`)?.focus({ preventScroll: true })
    },
    'qm-defect': (el) => {
      readNotes()
      const { room } = rateRoom()
      const it = room?.items[Number(el.dataset.k)]
      if (!it) return
      it.defects = el.checked ? [...new Set([...it.defects, el.value])] : it.defects.filter((x) => x !== el.value)
      persist()
    },
    'qm-note': (el) => {
      const { room } = rateRoom()
      const it = room?.items[Number(el.dataset.k)]
      if (!it) return
      it.note = el.value.trim()
      persist()
    },
    'qm-photo': async (el) => {
      const file = el.files?.[0]
      readNotes()
      const { mo, m, room } = rateRoom()
      const k = Number(el.dataset.k)
      const it = room?.items[k]
      if (!file || !it) return
      toast('Foto wird gespeichert …')
      const pic = await shrink(file)
      const meta = await storeFile(pic, `${basePath(m)}_raum-${room.no}-${fileSafe(room.group)}_${it.id}.${pic.type === 'image/png' ? 'png' : 'jpg'}`)
      if (!meta) return
      it.photo = meta
      persist()
      if (app.ui.modal === mo) renderModal()
      toast(meta.queued ? 'Foto gespeichert; es wird hochgeladen, sobald wieder Netz da ist.' : 'Foto gespeichert.')
    },
    'qm-photo-del': (el) => {
      const { room } = rateRoom()
      const it = room?.items[Number(el.dataset.k)]
      if (!it) return
      it.photo = null
      persist()
      renderModal()
    },
    'qm-finish-save': () => finishMeasurement(),
    'qm-delete': (el) => {
      if (!confirmStep(`qm-del:${el.dataset.id}`, renderModal)) return
      doc().measurements = doc().measurements.filter((m) => m.id !== el.dataset.id)
      persist()
      closeModal()
      renderNow()
      toast('Messung gelöscht. Fotos und Bericht bleiben in SharePoint.')
    },
    'qm-mail': (el) => {
      const m = measurementOf(el.dataset.id)
      if (m) mailReport(m)
    },
  },
  { edit: MODULE },
)

// Outlook-Termin über die Termine (Dialog „appt“, Recht auf Termine)
registerActions(
  {
    'qm-appt': (el) => {
      const id = el.dataset.obj
      const st = objectStatus({ doc: doc(), objectId: id, today: todayISO() })
      const today = todayISO()
      const tomorrow = addDays(today, 1)
      const due = st.recheck?.due && st.recheck.due > today ? st.recheck.due : tomorrow
      openModal({ type: 'appt', date: workdayBefore(due, tomorrow), time: '08:00', minutes: 60, kind: 'kontrolle', title: `${st.recheck ? 'Nachkontrolle' : 'Qualitätsmessung'}: ${objName(id)}`, objectId: id })
    },
  },
  { edit: 'termine' },
)

// ---------------------------------------------------------------- Zu erledigen, Objekt-Hinweis

registerTodo({
  id: 'qualitaet',
  module: MODULE,
  title: 'Qualitätsmessung',
  compute: (today) => attentionAt(today).map((g) => ({ ...g, id: `${g.objectId}:${g.last?.id}:${g.recheck?.overdue ? 'u' : ''}${g.risk ? 'r' : ''}` })),
  render: (list) =>
    list
      .map((g) => {
        const lines = reasons(g)
        return `<div class="todo-item"><span class="flag ${isUrgent(g) ? 'error' : 'warning'}">!</span><div class="todo-text"><strong>${esc(g.object?.name || objName(g.objectId))}</strong>${g.risk ? ' <span class="pill error">Reklamationsgefahr</span>' : ''}<br><span class="muted">${esc(lines.join(' · '))}</span></div><button class="btn small primary" data-action="qm-goto" data-obj="${esc(g.objectId)}">Öffnen</button></div>`
      })
      .join(''),
})

registerObjectHint({
  module: MODULE,
  html: (objectId) => {
    const st = statusAt(objectId)
    if (!st.last || (!st.recheck && !st.risk)) return ''
    return `<strong>Qualität</strong>: letzte Messung ${pct(st.result.score)} (${st.result.ok === false ? 'nicht erfüllt' : st.result.poor ? 'unter dem Zielwert' : 'erfüllt'})${st.recheck ? `, Nachkontrolle ${st.recheck.overdue ? 'überfällig' : `bis ${short(st.recheck.due)}`}` : ''}${st.risk ? ', Reklamationsgefahr' : ''} <button class="btn small" data-action="qm-goto" data-obj="${esc(objectId)}">Ansehen</button>`
  },
})
