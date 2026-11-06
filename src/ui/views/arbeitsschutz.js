// Arbeitsschutz (Verwaltung): Arbeitsstoffverzeichnis aus den Material-Artikeln (Hersteller, Verwendung, Piktogramme,
// Signalwort, H- und P-Sätze, Sicherheitsdatenblatt mit Fassung, Menge je Lager, Objekte), Betriebsanweisungen je
// Arbeitsstoff oder Tätigkeit (vorbefüllt, als PDF zum Aushängen, in SharePoint), Evaluierung nach § 4 ASchG je
// Arbeitsbereich mit Bewertung 3 × 3, Maßnahmen, Verantwortlichen, Fristen und Wirksamkeit (Sicherheits- und
// Gesundheitsschutzdokument als PDF), Verbindung zu den Unterweisungen, „Zu erledigen“.
// Dateien: arbeitsschutz/arbeitsschutz.json (Rechenkern core/arbeitsschutz.js, Vorlagen core/arbeitsschutz-vorlagen.js),
// Angaben zu Arbeitsstoffen am Artikel in material/material.json; Sicherheitsdatenblätter und PDFs unter
// arbeitsschutz/dokumente/. Der digitale Mitarbeiter „Fristen“ (disponent.js) liest dieselben Dateien.
// Rechte: Arbeitsschutz bearbeiten (Evaluierung, Betriebsanweisungen) = Modul „arbeitsschutz“; die Angaben am Artikel
// = Modul „arbeitsstoffe“ (Lager, Vollzugriff). Aktionen und Dialoge mit dem Kürzel „asch-“.
// „Aus Sicherheitsdatenblatt lesen (KI)“ (Kürzel „kix-“, nur mit eingerichteter KI, ui/kix.js): liest das gewählte bzw.
// abgelegte PDF (ai/extract.js → extractSdb), füllt nur leere Felder als Vorschlag; gespeichert wird mit „Speichern“.

import {
  attention,
  BA_KINDS,
  badCodes,
  codesOf,
  emptyArbeitsschutz,
  evalProblem,
  evalRows,
  GHS,
  instructionFor,
  instructionProblem,
  isStoff,
  isUrgent,
  LIKELIHOOD,
  MEASURE_STATES,
  measureState,
  PPE,
  riskClass,
  riskOf,
  SDB_STATES,
  sdbState,
  setMeasureStatus,
  SEVERITY,
  settingsOf,
  SIGNALS,
  stoffCounts,
  stoffRows,
  trainingGaps,
  trainingTypeOf,
  allMeasures,
} from '../../core/arbeitsschutz.js'
import { BA_SECTIONS, EVAL_TEMPLATES, emptySections, hazardsFromTemplate, instructionFromArticle, SECTION_HINTS, templateOf } from '../../core/arbeitsschutz-vorlagen.js'
import { formatDate, todayISO } from '../../core/dates.js'
import { toCSV } from '../../core/reports.js'
import { TRAINING_DEFAULTS, typesOf as trainingTypes } from '../../core/trainings.js'
import { instructionDocument, instructionPdfName, sdbText, sgdDocument, sgdPdfName, verzeichnisDocument, verzeichnisPdfName } from '../../export/arbeitsschutz-pdf.js'
import { ghsSvg } from '../../export/ghs.js'
import { dataRights, MODULE_DOCS } from '../../storage/data-service.js'
import { app, canEdit, closeModal, confirmStep, mayEdit, memo, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, checkedValues, download, esc, ICON, menu, modalFrame, options, tabBar, uid, val } from '../shared.js'
import { KI_LIMITS } from '../../core/ki-vorschlag.js'
import { kixBox, kixButton, kixConsent, kixFailed, kixFile, kixSet } from '../kix.js'

const MODULE = 'arbeitsschutz'
const STOFFE = 'arbeitsstoffe'
const ICON_ASCH = '<path d="M12 2.8 4.5 5.8v5.6c0 4.6 3.1 8.5 7.5 9.8 4.4-1.3 7.5-5.2 7.5-9.8V5.8z"/><path d="m8.7 12.1 2.3 2.3 4.4-4.6"/>'
const doc = () => {
  const d = (app.data.arbeitsschutz ||= emptyArbeitsschutz())
  d.instructions ||= []
  d.evaluations ||= []
  d.settings ||= {}
  return d
}
const material = () => app.data.material || { articles: [], moves: [], locations: [] }
const settings = () => settingsOf(doc())
// Recht je Bereich, nicht je Ansicht: das Lager pflegt die Arbeitsstoffe auch in der (für es nur lesbaren) Ansicht
const editable = () => mayEdit(MODULE)
const stoffEditable = () => mayEdit(STOFFE)
const trainEditable = () => mayEdit('unterweisungen')
const nowIso = () => new Date().toISOString()
const user = () => app.user?.name || 'Browser'
const short = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const objName = (id) => app.data.objects.find((o) => o.id === id)?.name || ''
const artOf = (id) => (material().articles || []).find((a) => a.id === id) || null
const baOf = (id) => doc().instructions.find((b) => b.id === id) || null
const evOf = (id) => doc().evaluations.find((e) => e.id === id) || null
const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
/** Unterweisungen lesbar? Sonst wäre „noch nicht unterwiesen“ falsch (alle ohne Eintrag). */
const seesTrainings = () => !app.access || dataRights(app.access).read(MODULE_DOCS.unterweisungen.path)
const trainingsDoc = () => (seesTrainings() ? app.data.unterweisungen || { types: [], records: [], sessions: [] } : null)
const trainingOptions = () => trainingTypes(trainingsDoc() || {}).map((t) => [t.id, t.name])
const SDB_CLS = { ok: 'ok', veraltet: 'error', 'ohne-datum': 'warning', fehlt: 'error' }
const STATE_CLS = { ueberfaellig: 'error', unwirksam: 'error', offen: 'info', 'ohne-frist': 'warning', umgesetzt: 'warning', wirksam: 'ok' }
const STATE_TEXT = { ueberfaellig: 'überfällig', unwirksam: 'nicht wirksam', offen: 'offen', 'ohne-frist': 'Frist fehlt', umgesetzt: 'Wirksamkeit prüfen', wirksam: 'wirksam' }
const RISK_CLS = { gering: 'ok', mittel: 'warning', hoch: 'error' }
const REVIEW_CLS = { ok: 'ok', faellig: 'warning', ueberfaellig: 'error', anlass: 'error' }
const WHO = ['Geschäftsführung', 'Sicherheitsfachkraft', 'Arbeitsmedizin', 'Objektleitung', 'Lager', 'Büro']

const rowsAt = (today = todayISO()) => memo(app.cur, `asch:stoffe:${today}`, () => stoffRows({ material: material(), doc: doc(), today, settings: settings() }))
const evalsAt = (today = todayISO()) => memo(app.cur, `asch:evals:${today}`, () => evalRows({ doc: doc(), today, settings: settings() }))
/** Art der Unterweisung zu einem Arbeitsstoff: an der Betriebsanweisung, sonst die Vorgabe der Einstellungen. */
const trainingIdFor = (articleId) => instructionFor(doc(), articleId)?.trainingTypeId || settings().trainingTypeId
const gapsOf = (article, today = todayISO(), typeId = trainingIdFor(article.id)) =>
  memo(app.cur, `asch:gap:${article.id}:${typeId}:${today}`, () => trainingGaps({ article, material: material(), tasks: app.data.tasks || [], employees: app.data.employees || [], trainings: trainingsDoc(), typeId, today }))

const pictos = (ids = [], size = 26) => `<span class="asch-ghs">${ids.map((id) => ghsSvg(id, size)).join('')}</span>`
const sdbPill = (sdb) => `<span class="pill ${SDB_CLS[sdb.state]}">${esc(sdb.state === 'ok' ? `Fassung ${short(sdb.date)}` : sdb.state === 'veraltet' ? `veraltet (${short(sdb.date)})` : SDB_STATES[sdb.state])}</span>`
const riskTag = (r) => (r ? `<span class="pill ${RISK_CLS[riskClass(r)]}">Risiko ${r} ${esc(riskClass(r))}</span>` : '<span class="pill warning">nicht bewertet</span>')
const riskPill = (h) => riskTag(riskOf(h))
const reviewText = (rv) => (rv.state === 'anlass' ? `Anlass: ${short(rv.trigger.date)}${rv.trigger.text ? `, ${rv.trigger.text}` : ''}` : rv.state === 'ueberfaellig' ? `überfällig seit ${short(rv.next)}` : rv.state === 'faellig' ? `fällig am ${short(rv.next)}` : `nächste am ${short(rv.next)}`)
const measureText = (m, state) => (state === 'ueberfaellig' ? `überfällig seit ${short(m.due)}` : state === 'offen' ? `bis ${short(m.due)}` : state === 'ohne-frist' ? 'ohne Frist' : state === 'umgesetzt' ? `umgesetzt ${short(m.doneAt)}, Wirksamkeit prüfen` : `${MEASURE_STATES[m.status]}${m.checkedAt ? ` (${short(m.checkedAt)})` : ''}`)
const basisNote = () => '<p class="note">Vorschläge ohne Gewähr, keine Rechtsauskunft: Gefahren, Bewertung, Fristen und Texte mit Sicherheitsfachkraft und Arbeitsmedizin abstimmen. Die Angaben zu Arbeitsstoffen kommen aus dem Sicherheitsdatenblatt des Herstellers.</p>'

// ---------------------------------------------------------------- Dateien (Sicherheitsdatenblatt, PDFs)

// Browser-Modus: Dateien nur in diesem Fenster; mit SharePoint unter arbeitsschutz/dokumente/
const LOCAL = new Map()

/** Datei ablegen; liefert { path, name, type, size, at, by, url?, queued?, local? } oder null (mit Meldung). */
async function storeBlob(blob, path, name) {
  const meta = { path, name, type: blob.type || 'application/octet-stream', size: blob.size, at: nowIso(), by: user() }
  if (app.store?.kind !== 'sharepoint') {
    LOCAL.set(path, blob)
    return { ...meta, local: true }
  }
  try {
    const up = await app.store.upload(path, blob, meta.type)
    return { ...meta, ...(up?.webUrl ? { url: up.webUrl } : {}), ...(up?.queued ? { queued: true } : {}) }
  } catch (err) {
    toast(`${name} nicht gespeichert: ${err.message}`)
    return null
  }
}

async function openFile(meta) {
  if (!meta) return
  const local = LOCAL.get(meta.path)
  if (local) return void window.open(URL.createObjectURL(local), '_blank', 'noopener')
  if (meta.local) return toast('Im Browser-Modus werden Dateien nicht gespeichert (nur im Betrieb mit SharePoint).')
  if (meta.url) return void window.open(meta.url, '_blank', 'noopener')
  try {
    const blob = await app.store.readBlob?.(meta.path)
    if (!blob) return toast(meta.queued ? 'Die Datei wartet noch im Gerät aufs Hochladen.' : 'Datei nicht gefunden.')
    window.open(URL.createObjectURL(blob), '_blank', 'noopener')
  } catch (err) {
    toast(`Datei nicht geöffnet: ${err.message}`)
  }
}

/** PDF herunterladen; mit Recht auf den Arbeitsschutz zusätzlich in SharePoint ablegen (Rückgabe: Ablage oder null). */
async function pdfOut(docDef, name, folder) {
  const blob = await pdfBlob(docDef)
  download(name, blob)
  if (!editable()) return null
  return storeBlob(blob, `arbeitsschutz/dokumente/${folder}/${name}`, name)
}

// ---------------------------------------------------------------- Ansicht

function aschView() {
  const today = todayISO()
  const tab = ['ba', 'evaluierung'].includes(app.ui.aschTab) ? app.ui.aschTab : 'stoffe'
  const rows = rowsAt(today)
  const evals = evalsAt(today)
  const ed = editable()
  const n = stoffCounts(rows)
  const overdue = evals.reduce((s, r) => s + r.overdue + r.unwirksam, 0)
  const reviews = evals.filter((r) => r.review.state !== 'ok').length
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  const head = `<div class="section-head"><div><h2>Arbeitsschutz</h2><p>Arbeitsstoffverzeichnis aus dem Lager, Betriebsanweisungen zum Aushängen und die Evaluierung je Arbeitsbereich mit Maßnahmen und Fristen. Fällige Fristen stehen in „Zu erledigen“.</p></div>
      <div class="actions">${ed && tab === 'evaluierung' ? `<button class="btn primary" data-action="asch-eval-open">${ICON.plus} Evaluierung</button>` : ''}${ed && tab === 'ba' ? `<button class="btn primary" data-action="asch-ba-open" data-kind="taetigkeit">${ICON.plus} Betriebsanweisung</button>` : ''}${stoffEditable() && tab === 'stoffe' ? `<button class="btn primary" data-action="asch-stoff-open">${ICON.plus} Arbeitsstoff</button>` : ''}${menu({
        label: 'Mehr',
        single: false,
        items: [
          ed && { label: 'Evaluierung anlegen', icon: ICON.plus, action: 'asch-eval-open', hint: 'aus einer Vorlage der Reinigung' },
          ed && { label: 'Betriebsanweisung für Tätigkeit oder Maschine', icon: ICON.plus, action: 'asch-ba-open', data: { kind: 'taetigkeit' } },
          ed && { label: 'Einstellungen', icon: ICON.gear, action: 'asch-settings-open', hint: 'Fristen, Unterweisung' },
          { heading: 'Export' },
          { label: 'Arbeitsstoffverzeichnis (PDF)', icon: ICON.download, action: 'asch-verz-pdf', mail: { subject: 'Arbeitsstoffverzeichnis' } },
          { label: 'Arbeitsstoffverzeichnis (CSV)', icon: ICON.download, action: 'asch-verz-csv', mail: true },
          { label: 'Evaluierung (PDF)', icon: ICON.download, action: 'asch-sgd-pdf', hint: 'Sicherheits- und Gesundheitsschutzdokument', mail: { subject: 'Evaluierung (Sicherheits- und Gesundheitsschutzdokument)' } },
        ],
      })}</div></div>`
  const tabs = tabBar({
    action: 'asch-tab',
    current: tab,
    tabs: [
      { id: 'stoffe', label: 'Arbeitsstoffe', flag: n.sdb },
      { id: 'ba', label: 'Betriebsanweisungen' },
      { id: 'evaluierung', label: 'Evaluierung', flag: overdue + reviews },
    ],
  })
  const body = tab === 'ba' ? baTab() : tab === 'evaluierung' ? evalTab(evals) : stoffTab(rows)
  return `${head}
    <div class="impact-stats tc-stats">${tile('Arbeitsstoffe', n.stoffe)}${tile('Datenblatt fehlt oder veraltet', n.sdb, n.sdb ? 'err' : '')}${tile('Maßnahmen überfällig', overdue, overdue ? 'err' : '')}${tile('Überprüfung fällig', reviews, reviews ? 'err' : '')}</div>
    ${tabs}${body}${basisNote()}`
}

function stoffTab(all) {
  const q = String(app.ui.aschSearch || '').trim().toLowerCase()
  const only = !!app.ui.aschOnly
  const rows = all.filter((r) => (!only || r.needs) && (!q || [r.product, r.maker, r.article.name, r.haz.use].some((x) => String(x || '').toLowerCase().includes(q))))
  const today = todayISO()
  const lines = rows
    .map((r) => {
      const ba = r.instruction
      const gaps = gapsOf(r.article, today)
      const gapCell = !gaps.type ? '<span class="muted">–</span>' : !gaps.groups.length ? '<span class="muted">keine Personen bekannt</span>' : gaps.missing.length ? `<span class="pill warning">${plural(gaps.missing.length, 'Person', 'Personen')} nicht unterwiesen</span>` : '<span class="pill ok">alle unterwiesen</span>'
      const sdbOpen = r.sdb.file || r.sdb.link ? ` <button class="btn small ghost" data-action="asch-sdb-open" data-id="${esc(r.article.id)}" title="Sicherheitsdatenblatt öffnen">${ICON.download}</button>` : ''
      return `<tr><td class="clickable" data-action="asch-stoff-open" data-id="${esc(r.article.id)}"><strong>${esc(r.product)}</strong>${r.maker ? `<br><span class="muted">${esc(r.maker)}</span>` : ''}${r.haz.use ? `<br><span class="muted">${esc(r.haz.use)}</span>` : ''}${r.details ? '' : ' <span class="pill warning">Angaben fehlen</span>'}</td>
        <td>${(r.haz.ghs || []).length ? pictos(r.haz.ghs) : '<span class="muted">keine</span>'}${r.haz.signal ? ` <strong>${esc(SIGNALS[r.haz.signal])}</strong>` : ''}${codesOf(r.haz.h).length ? `<br><span class="asch-codes">${esc(codesOf(r.haz.h).join(', '))}</span>` : ''}</td>
        <td>${sdbPill(r.sdb)}${sdbOpen}</td>
        <td>${r.stock.list.length ? r.stock.list.map((s) => `${esc(s.name)}: ${esc(String(s.qty).replace('.', ','))} ${esc(r.article.unit || '')}`).join('<br>') : '<span class="muted">kein Bestand</span>'}</td>
        <td>${r.objectIds.length ? esc(r.objectIds.map(objName).filter(Boolean).slice(0, 3).join(', ')) + (r.objectIds.length > 3 ? ` <span class="muted">+${r.objectIds.length - 3}</span>` : '') : '<span class="muted">–</span>'}</td>
        <td>${ba ? `<button class="btn small" data-action="asch-ba-open" data-id="${esc(ba.id)}">${ba.approvedAt ? 'ansehen' : 'Entwurf'}</button>` : editable() ? `<button class="btn small" data-action="asch-ba-open" data-article="${esc(r.article.id)}">${ICON.plus} anlegen</button>` : '<span class="pill warning">fehlt</span>'}</td>
        <td>${gapCell}</td></tr>`
    })
    .join('')
  const filters = `<div class="filters"><label class="field inline"><span>Suche</span><input type="search" id="asch-search" value="${esc(app.ui.aschSearch || '')}" data-input="asch-search" placeholder="Produkt, Hersteller"></label>
    <label class="check"><input type="checkbox" id="asch-only" ${only ? 'checked' : ''} data-change="asch-only"><span>nur mit Handlungsbedarf</span></label></div>`
  if (!all.length)
    return `<div class="banner welcome"><p><strong>Noch keine Arbeitsstoffe.</strong> Reinigungsmittel und Desinfektion aus Material &amp; Lager stehen hier automatisch; andere Artikel lassen sich aufnehmen.${!(material().articles || []).length ? ' Dazu zuerst die Artikel in Material &amp; Lager anlegen.' : ''}</p>${stoffEditable() && (material().articles || []).length ? `<button class="btn primary" data-action="asch-stoff-open">${ICON.plus} Arbeitsstoff aufnehmen</button>` : ''}</div>`
  return `${filters}${lines ? `<div class="table-wrap"><table class="data asch-table"><thead><tr><th>Arbeitsstoff</th><th>Gefahren</th><th>Sicherheitsdatenblatt</th><th>Menge / Lagerort</th><th>verwendet in</th><th>Betriebsanweisung</th><th>Unterweisung</th></tr></thead><tbody>${lines}</tbody></table></div>` : '<p class="empty">Kein Arbeitsstoff in dieser Auswahl.</p>'}
    <p class="note">Im Verzeichnis stehen Reinigungsmittel und Desinfektion aus Material &amp; Lager und alle Artikel mit „im Arbeitsstoffverzeichnis“. Sicherheitsdatenblatt „veraltet“: Fassung älter als ${settings().sdbYears} Jahre (Einstellung). „verwendet in“: Ausgaben der letzten 12 Monate und eigene Zuordnung; „nicht unterwiesen“: Stammkräfte und Eingeschulte dieser Objekte ohne gültige Unterweisung.</p>`
}

function baTab() {
  const ed = editable()
  const list = doc().instructions.slice().sort((a, b) => (a.title || '').localeCompare(b.title || '', 'de'))
  if (!list.length)
    return `<div class="banner welcome"><p><strong>Noch keine Betriebsanweisungen.</strong> Je Arbeitsstoff vorbefüllt aus den Angaben am Artikel (im Reiter „Arbeitsstoffe“ bei der Zeile „anlegen“) oder für eine Tätigkeit oder Maschine, z. B. Scheuersaugmaschine.</p>${ed ? `<button class="btn primary" data-action="asch-ba-open" data-kind="taetigkeit">${ICON.plus} Betriebsanweisung</button>` : ''}</div>`
  const today = todayISO()
  const rows = list
    .map((b) => {
      const type = trainingTypeOf(trainingsDoc() || { types: [] }, b.trainingTypeId)
      const article = b.kind === 'stoff' ? artOf(b.articleId) : null
      const gaps = article && type && trainingsDoc() ? gapsOf(article, today, b.trainingTypeId) : null
      return `<tr><td class="clickable" data-action="asch-ba-open" data-id="${esc(b.id)}"><strong>${esc(b.title)}</strong><br><span class="muted">${esc(BA_KINDS[b.kind] || '')}</span></td>
        <td>${esc(b.area || '–')}</td><td>${short(b.date)}</td>
        <td>${b.approvedAt ? `<span class="pill ok">freigegeben ${short(b.approvedAt)}</span><br><span class="muted">${esc(b.approvedBy || '')}</span>` : '<span class="pill warning">Entwurf</span>'}</td>
        <td>${type ? esc(type.name) : '<span class="muted">keine verknüpft</span>'}${gaps?.missing.length ? `<br><span class="pill warning">${plural(gaps.missing.length, 'Person', 'Personen')} nicht unterwiesen</span>` : ''}</td>
        <td class="actions-cell"><button class="btn small" data-action="asch-ba-pdf" data-id="${esc(b.id)}" title="Zum Aushängen drucken">${ICON.download} PDF</button></td></tr>`
    })
    .join('')
  return `<div class="table-wrap"><table class="data asch-table"><thead><tr><th>Betriebsanweisung</th><th>Arbeitsbereich</th><th>Stand</th><th>Freigabe</th><th>Unterweisung</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Das PDF hat den Kopf mit Logo wie die anderen Berichte; ohne Freigabe steht „Entwurf“ darauf. Mit Recht auf den Arbeitsschutz liegt es danach auch in SharePoint unter arbeitsschutz/dokumente/betriebsanweisungen/.</p>`
}

function evalTab(evals) {
  const ed = editable()
  const today = todayISO()
  if (!evals.length)
    return `<div class="banner welcome"><p><strong>Noch keine Evaluierung.</strong> Je Arbeitsbereich oder Tätigkeit (z. B. Unterhaltsreinigung, Glasreinigung, Arbeiten auf Leitern, Winterdienst, Umgang mit Reinigungsmitteln, Alleinarbeit, Nachtarbeit) die Gefahren erfassen, bewerten und Maßnahmen mit Verantwortlichen und Fristen festlegen. Vorlagen mit typischen Gefahren der Reinigung helfen beim Start.</p>${ed ? `<button class="btn primary" data-action="asch-eval-open">${ICON.plus} Evaluierung anlegen</button>` : ''}</div>`
  const rows = evals
    .map((r) => `<tr><td class="clickable" data-action="asch-eval-open" data-id="${esc(r.ev.id)}"><strong>${esc(r.ev.title)}</strong>${(r.ev.objectIds || []).length ? `<br><span class="muted">${esc(r.ev.objectIds.map(objName).filter(Boolean).join(', '))}</span>` : ''}</td>
      <td>${plural(r.hazards, 'Gefahr', 'Gefahren')}${r.maxRisk ? ` ${riskTag(r.maxRisk)}` : ''}${r.unrated ? `<br><span class="pill warning">${r.unrated} nicht bewertet</span>` : ''}</td>
      <td>${r.open ? `${r.open} offen` : '<span class="muted">keine offen</span>'}${r.overdue ? ` <span class="pill error">${r.overdue} überfällig</span>` : ''}${r.unwirksam ? ` <span class="pill error">${r.unwirksam} nicht wirksam</span>` : ''}${r.noDue ? ` <span class="pill warning">${r.noDue} ohne Frist</span>` : ''}</td>
      <td>${short(r.ev.reviewedAt)}<br><span class="pill ${REVIEW_CLS[r.review.state]}">${esc(reviewText(r.review))}</span></td></tr>`)
    .join('')
  const showAll = !!app.ui.aschAllMeasures
  const measures = allMeasures(doc(), today).filter((x) => showAll || x.state !== 'wirksam')
  const mRows = measures
    .map(({ ev, hazard, m, state }) => {
      const acts = ed
        ? state === 'umgesetzt'
          ? `<button class="btn small" data-action="asch-m-set" data-ev="${esc(ev.id)}" data-m="${esc(m.id)}" data-v="wirksam">wirksam</button> <button class="btn small" data-action="asch-m-set" data-ev="${esc(ev.id)}" data-m="${esc(m.id)}" data-v="unwirksam">nicht wirksam</button>`
          : ['offen', 'ueberfaellig', 'ohne-frist'].includes(state)
            ? `<button class="btn small primary" data-action="asch-m-set" data-ev="${esc(ev.id)}" data-m="${esc(m.id)}" data-v="umgesetzt">umgesetzt</button>`
            : state === 'unwirksam'
              ? `<button class="btn small" data-action="asch-eval-open" data-id="${esc(ev.id)}">neue Maßnahme</button>`
              : ''
        : ''
      const type = m.trainingTypeId ? trainingTypeOf(trainingsDoc() || { types: [] }, m.trainingTypeId) : null
      const training = type && trainEditable() && state !== 'wirksam' ? ` <button class="btn small" data-action="tr-session-open" data-type="${esc(type.id)}" data-topic="${esc(m.text)}">Unterweisung</button>` : ''
      return `<tr><td class="clickable" data-action="asch-eval-open" data-id="${esc(ev.id)}"><strong>${esc(m.text)}</strong><br><span class="muted">${esc(ev.title)}: ${esc(hazard.text)}</span>${type ? `<br><span class="muted">Unterweisung: ${esc(type.name)}</span>` : ''}</td>
        <td>${esc(m.who || '–')}</td><td>${m.due ? short(m.due) : '–'}</td><td><span class="pill ${STATE_CLS[state]}">${esc(STATE_TEXT[state])}</span></td><td class="actions-cell">${acts}${training}</td></tr>`
    })
    .join('')
  return `<div class="table-wrap"><table class="data asch-table"><thead><tr><th>Arbeitsbereich / Tätigkeit</th><th>Gefahren</th><th>Maßnahmen</th><th>Überprüfung</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h3>Maßnahmen</h3>
    <div class="filters"><label class="check"><input type="checkbox" id="asch-all-m" ${showAll ? 'checked' : ''} data-change="asch-all-m"><span>auch wirksame</span></label></div>
    ${mRows ? `<div class="table-wrap"><table class="data asch-table asch-measures"><thead><tr><th>Maßnahme</th><th>verantwortlich</th><th>Frist</th><th>Status</th><th></th></tr></thead><tbody>${mRows}</tbody></table></div>` : '<p class="empty">Keine offenen Maßnahmen.</p>'}
    <p class="note">Bewertung (Vorschlag): Wahrscheinlichkeit (selten, gelegentlich, häufig) mal Schwere (leicht, mittel, schwer), Risiko 1–2 gering, 3–4 mittel, 6–9 hoch. Überprüfung alle ${settings().reviewMonths} Monate (Einstellung) und nach Unfällen, Beinaheunfällen oder Änderungen (im Dialog „Anlass“ eintragen). Umgesetzte Maßnahmen auf Wirksamkeit prüfen.</p>`
}

registerView({
  id: 'arbeitsschutz',
  order: 206,
  label: 'Arbeitsschutz',
  group: 'stamm',
  module: MODULE,
  icon: ICON_ASCH,
  noWeek: true,
  text: 'Arbeitsstoffe, Betriebsanweisungen, Evaluierung mit Maßnahmen',
  badge: () => {
    const today = todayISO()
    const ev = evalsAt(today)
    return ev.reduce((s, r) => s + r.overdue + r.unwirksam, 0) + ev.filter((r) => r.review.state === 'ueberfaellig' || r.review.state === 'anlass').length
  },
  render: aschView,
})

// ---------------------------------------------------------------- Arbeitsstoff (Angaben am Artikel)

function stoffDraft(m) {
  if (!m.draft) m.draft = draftFromArticle(artOf(m.id))
  return m.draft
}
function draftFromArticle(a) {
  const h = a?.haz || {}
  return { articleId: a?.id || '', on: a ? isStoff(a) : true, maker: h.maker || '', product: h.product || '', use: h.use || '', ghs: [...(h.ghs || [])], signal: h.signal || '', h: h.h || '', p: h.p || '', ppe: [...(h.ppe || [])], sdb: h.sdb || null, sdbDate: h.sdbDate || '', objectIds: [...(h.objectIds || [])], file: null }
}

function readStoff() {
  const m = app.ui.modal
  const d = stoffDraft(m)
  const articleId = document.getElementById('asch-s-article') ? val('asch-s-article') : d.articleId
  if (articleId !== d.articleId) {
    // anderer Artikel (neu aufnehmen): seine Angaben laden, die Datei bleibt gewählt
    const file = d.file
    m.draft = { ...draftFromArticle(artOf(articleId)), on: true, file }
    return m.draft
  }
  if (!document.getElementById('asch-s-maker')) return d
  Object.assign(d, {
    on: checked('asch-s-on'),
    maker: val('asch-s-maker').trim(),
    product: val('asch-s-product').trim(),
    use: val('asch-s-use').trim(),
    ghs: checkedValues('asch-s-ghs'),
    signal: val('asch-s-signal'),
    h: codesOf(val('asch-s-h')).join(', '),
    p: codesOf(val('asch-s-p')).join(', '),
    ppe: checkedValues('asch-s-ppe'),
    sdbDate: val('asch-s-sdbdate'),
    objectIds: checkedValues('asch-s-obj'),
  })
  return d
}

function stoffModal(c, m) {
  const d = stoffDraft(m)
  const ed = stoffEditable()
  const dis = ed ? '' : 'disabled'
  const a = artOf(d.articleId)
  const today = todayISO()
  const fresh = !m.id
  const articles = (material().articles || []).filter((x) => x.active !== false).sort((x, y) => x.name.localeCompare(y.name, 'de'))
  const sdb = a ? sdbState({ ...a, haz: { ...(a.haz || {}), sdb: d.file ? { path: 'neu' } : d.sdb, sdbDate: d.sdbDate } }, today, settings().sdbYears) : null
  const stock = a ? rowsAt(today).find((r) => r.article.id === a.id)?.stock : null
  const ba = a ? instructionFor(doc(), a.id) : null
  const gaps = a ? gapsOf(a, today) : null
  const ghsBox = GHS.map((g) => `<label class="check asch-pick"><input type="checkbox" name="asch-s-ghs" value="${g.id}" ${d.ghs.includes(g.id) ? 'checked' : ''} ${dis}>${ghsSvg(g.id, 30)}<span>${g.id}<br><span class="muted">${esc(g.name)}</span></span></label>`).join('')
  const objs = app.data.objects.filter((o) => !o.inactive || d.objectIds.includes(o.id)).sort((x, y) => x.name.localeCompare(y.name, 'de'))
  const fromMoves = a ? rowsAt(today).find((r) => r.article.id === a.id)?.objectIds.filter((id) => !d.objectIds.includes(id)) || [] : []
  // von der KI aus dem Sicherheitsdatenblatt gelesene Felder: markiert, bis gespeichert ist
  const ki = (key) => (m.kixFields?.includes(key) ? ' kix-mark' : '')
  const kiTag = (key) => (m.kixFields?.includes(key) ? ' <span class="kix-tag">KI</span>' : '')
  const kiRead = ed && (d.file || d.sdb) ? kixButton('<button type="button" class="btn kix-btn" data-action="kix-sdb">Aus Sicherheitsdatenblatt lesen (KI)</button>') : ''
  const fileChip = d.file
    ? `<span class="pill anl-file">${ICON.upload} ${esc(d.file.name)} <button type="button" class="btn small ghost" data-action="asch-sdb-del" data-kind="neu" aria-label="Datei entfernen">${ICON.close}</button></span>`
    : d.sdb
      ? `<span class="pill anl-file"><button type="button" class="reg-file-open" data-action="asch-sdb-open" data-id="${esc(d.articleId)}">${ICON.download} ${esc(d.sdb.name || 'Sicherheitsdatenblatt')}</button>${ed ? ` <button type="button" class="btn small ghost" data-action="asch-sdb-del" aria-label="Datei entfernen">${ICON.close}</button>` : ''}</span>`
      : ''
  return modalFrame({
    title: a ? (d.product || a.name) : 'Arbeitsstoff aufnehmen',
    subtitle: a ? `Artikel ${esc(a.name)}${a.category ? ` · ${esc(a.category)}` : ''}` : 'Artikel aus Material &amp; Lager wählen',
    wide: true,
    body: `${fresh ? `<div class="form-grid"><label class="field wide"><span>Artikel</span><select id="asch-s-article" data-change="asch-stoff-redraw" ${dis}>${options(articles.map((x) => [x.id, `${x.name}${isStoff(x) ? ' (im Verzeichnis)' : ''}`]), d.articleId, { empty: '– Artikel –' })}</select></label></div>` : ''}
      ${a ? `<label class="check"><input type="checkbox" id="asch-s-on" ${d.on ? 'checked' : ''} ${dis}><span>im Arbeitsstoffverzeichnis führen</span></label>
      <div class="form-grid">
        <label class="field${ki('maker')}"><span>Hersteller${kiTag('maker')}</span><input type="text" id="asch-s-maker" value="${esc(d.maker)}" placeholder="laut Sicherheitsdatenblatt" ${dis}></label>
        <label class="field${ki('product')}"><span>Produktname${kiTag('product')}</span><input type="text" id="asch-s-product" value="${esc(d.product)}" placeholder="${esc(a.name)}" ${dis}></label>
        <label class="field wide"><span>Verwendung</span><input type="text" id="asch-s-use" value="${esc(d.use)}" placeholder="z. B. Sanitärreinigung, 1:20 verdünnt" ${dis}></label>
      </div>
      <fieldset class="asch-picks${ki('ghs') ? ' kix-picks' : ''}"><legend>Gefahrenpiktogramme${kiTag('ghs')}</legend>${ghsBox}</fieldset>
      <div class="form-grid">
        <label class="field${ki('signal')}"><span>Signalwort${kiTag('signal')}</span><select id="asch-s-signal" ${dis}>${options(Object.entries(SIGNALS), d.signal)}</select></label>
        <label class="field${ki('h')}"><span>H-Sätze (Kürzel)${kiTag('h')}</span><input type="text" id="asch-s-h" value="${esc(d.h)}" placeholder="z. B. H290, H314" ${dis}></label>
        <label class="field wide${ki('p')}"><span>P-Sätze (Kürzel)${kiTag('p')}</span><input type="text" id="asch-s-p" value="${esc(d.p)}" placeholder="z. B. P280, P305+P351+P338" ${dis}></label>
      </div>
      <fieldset class="asch-picks asch-ppe"><legend>Schutzausrüstung</legend>${PPE.map((x) => `<label class="check"><input type="checkbox" name="asch-s-ppe" value="${esc(x)}" ${d.ppe.includes(x) ? 'checked' : ''} ${dis}><span>${esc(x)}</span></label>`).join('')}</fieldset>
      <section><h3>Sicherheitsdatenblatt ${sdb ? sdbPill(sdb) : ''}</h3>
        <div class="form-grid"><label class="field${ki('sdbDate')}"><span>Fassung vom (Überarbeitung)${kiTag('sdbDate')}</span><input type="date" id="asch-s-sdbdate" value="${esc(d.sdbDate)}" max="${today}" ${dis}></label></div>
        <div class="ek-beleg-bar">${ed ? `<label class="btn">${ICON.upload} PDF hochladen<input type="file" accept="application/pdf" data-change="asch-sdb-file" hidden></label>` : ''}${fileChip}${kiRead}${a.sds && /^https?:\/\//i.test(a.sds) ? ` <a href="${esc(a.sds)}" target="_blank" rel="noopener">Link am Artikel</a>` : ''}</div>
        ${kixBox('sdb')}
        ${sdb?.state === 'veraltet' ? `<p class="note">Älter als ${settings().sdbYears} Jahre: beim Lieferanten nach der aktuellen Fassung fragen.</p>` : sdb?.state === 'fehlt' ? '<p class="note">Das Sicherheitsdatenblatt gibt es beim Lieferanten oder Hersteller (meist zum Herunterladen).</p>' : ''}
      </section>
      <details class="asch-objs-wrap"><summary>Objekte zuordnen (${d.objectIds.length}, dazu aus Ausgaben: ${fromMoves.length})</summary>
        <p class="muted small">Aus den Ausgaben der letzten 12 Monate: ${fromMoves.length ? esc(fromMoves.map(objName).join(', ')) : 'keine'}. Hier zusätzlich ankreuzen, wo das Mittel sonst verwendet wird.</p>
        <div class="asch-objs">${objs.map((o) => `<label class="check"><input type="checkbox" name="asch-s-obj" value="${esc(o.id)}" ${d.objectIds.includes(o.id) ? 'checked' : ''} ${dis}><span>${esc(o.name)}</span></label>`).join('')}</div>
      </details>
      <section><h3>Lager, Betriebsanweisung, Unterweisung</h3>
        <p>${stock?.list.length ? stock.list.map((s) => `${esc(s.name)}: <strong>${esc(String(s.qty).replace('.', ','))} ${esc(a.unit || '')}</strong>`).join(' · ') : 'kein Bestand'}</p>
        <p>${ba ? `Betriebsanweisung: <button class="btn small" data-action="asch-ba-open" data-id="${esc(ba.id)}">${esc(ba.title)}</button>` : `Noch keine Betriebsanweisung.${editable() ? ` <button class="btn small" data-action="asch-ba-open" data-article="${esc(a.id)}">${ICON.plus} anlegen</button>` : ''}`}</p>
        ${gapsHtml(gaps)}
      </section>
      <p class="note">Angaben aus dem Sicherheitsdatenblatt übernehmen (Abschnitt 2: Einstufung und Kennzeichnung, Abschnitt 8: Schutzausrüstung). Nur die Kürzel der H- und P-Sätze eintragen.</p>` : '<p class="muted">Bitte den Artikel wählen.</p>'}`,
    foot: `<button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed && a ? '<div class="actions"><button class="btn primary edit-only" data-action="asch-stoff-save">Speichern</button></div>' : ''}`,
  })
}
registerModal('asch-stoff', stoffModal, { module: STOFFE })

/** Personen ohne gültige Unterweisung zum Arbeitsstoff, je Objekt. */
function gapsHtml(gaps, { topic = '' } = {}) {
  if (!gaps) return ''
  if (!trainingsDoc()) return '<p class="muted">Unterweisungen sind für deine Rolle nicht sichtbar.</p>'
  if (!gaps.type) return '<p class="muted">Keine Art der Unterweisung verknüpft (Betriebsanweisung oder Einstellungen).</p>'
  if (!gaps.groups.length) return `<p class="muted">${esc(gaps.type.name)}: keine Objekte oder Personen bekannt (Ausgaben, Zuordnung, Stammkräfte).</p>`
  const items = gaps.groups
    .map((g) => {
      const open = g.people.filter((p) => p.state !== 'ok')
      return `<li><strong>${esc(g.objectId ? objName(g.objectId) : 'direkt ausgegeben')}</strong>: ${open.length ? open.map((p) => `${esc(p.emp.name)} <span class="pill ${p.state === 'abgelaufen' ? 'error' : 'warning'}">${p.state === 'abgelaufen' ? `abgelaufen ${short(p.until)}` : 'fehlt'}</span>`).join(', ') : '<span class="pill ok">alle unterwiesen</span>'}</li>`
    })
    .join('')
  const can = trainEditable() && gaps.missing.length
  return `<p>${esc(gaps.type.name)}: ${gaps.missing.length ? `<strong>${plural(gaps.missing.length, 'Person', 'Personen')} noch nicht (gültig) unterwiesen</strong>` : 'alle unterwiesen'}</p><ul class="tc-list asch-gaps">${items}</ul>
    ${can ? `<p><button class="btn small primary" data-action="tr-session-open" data-type="${esc(gaps.type.id)}" data-topic="${esc(topic || gaps.type.note || gaps.type.name)}" data-participants="${esc(gaps.missing.map((e) => e.id).join(','))}">Unterweisung durchführen</button></p>` : ''}`
}

async function saveStoff() {
  const d = readStoff()
  const a = artOf(d.articleId)
  if (!a) return toast('Bitte den Artikel wählen.')
  const badH = badCodes(d.h, 'h')
  const badP = badCodes(d.p, 'p')
  if (badH.length) return toast(`Unbekanntes Kürzel bei den H-Sätzen: ${badH.join(', ')} (z. B. H314, EUH208).`)
  if (badP.length) return toast(`Unbekanntes Kürzel bei den P-Sätzen: ${badP.join(', ')} (z. B. P280, P305+P351+P338).`)
  if (d.sdbDate && d.sdbDate > todayISO()) return toast('Die Fassung des Sicherheitsdatenblatts liegt in der Zukunft.')
  if (d.file && !d.sdbDate) return toast('Bitte das Datum der Fassung eintragen (steht auf dem Sicherheitsdatenblatt).')
  let sdb = d.sdb
  if (d.file) {
    if (d.file.size > 15e6) return toast(`${d.file.name}: zu groß (höchstens 15 MB).`)
    toast('Sicherheitsdatenblatt wird hochgeladen …')
    const name = `SDB_${fileSafe(d.product || a.name)}_${d.sdbDate}.pdf`
    sdb = await storeBlob(d.file, `arbeitsschutz/dokumente/sdb/${fileSafe(d.product || a.name)}_${d.sdbDate}_${uid('s')}.pdf`, name)
    if (!sdb) return
  }
  const haz = { on: d.on, maker: d.maker, product: d.product, use: d.use, ghs: GHS.map((g) => g.id).filter((id) => d.ghs.includes(id)), signal: d.signal, h: d.h, p: d.p, ppe: d.ppe, sdb, sdbDate: d.sdbDate, objectIds: d.objectIds, changedAt: nowIso(), changedBy: user() }
  material().articles = material().articles.map((x) => (x.id === a.id ? { ...x, haz } : x))
  persist()
  const back = app.ui.modal?.back
  if (back) openModal({ type: 'asch-ba', id: back })
  else closeModal()
  renderNow()
  const s = sdbState({ ...a, haz }, todayISO(), settings().sdbYears)
  toast(`${d.product || a.name} gespeichert${haz.on ? `; Sicherheitsdatenblatt: ${SDB_STATES[s.state]}` : ', nicht im Verzeichnis'}${sdb?.queued ? '; die Datei wird hochgeladen, sobald wieder Netz da ist' : ''}.`)
}

// ---------------------------------------------------------------- Sicherheitsdatenblatt mit KI lesen

const SIGNAL_IDS = { Gefahr: 'gefahr', Achtung: 'achtung' }
const SDB_LABELS = { maker: 'Hersteller', product: 'Produktname', ghs: 'Piktogramme', signal: 'Signalwort', h: 'H-Sätze', p: 'P-Sätze', sdbDate: 'Fassung' }

/** Das PDF zum Lesen: gerade gewählt oder schon abgelegt (im Browser-Modus nur aus diesem Fenster). */
async function sdbPdf(d) {
  if (d.file) return d.file
  if (!d.sdb) return null
  const blob = LOCAL.get(d.sdb.path) || (d.sdb.local ? null : await app.store?.readBlob?.(d.sdb.path).catch(() => null))
  return blob ? new File([blob], d.sdb.name || 'Sicherheitsdatenblatt.pdf', { type: 'application/pdf' }) : null
}

/**
 * Ergebnis von extractSdb in den Entwurf: nur leere Felder füllen (Piktogramme nur, wenn keines angehakt ist),
 * markiert; schon ausgefüllte bleiben und stehen im Hinweis. Gespeichert wird erst mit „Speichern“.
 */
function applySdb(m, res) {
  const d = m.draft
  const filled = []
  const kept = []
  const fill = (key, value, empty) => {
    if (!value || (Array.isArray(value) && !value.length)) return
    if (empty) {
      d[key] = value
      filled.push(key)
    } else if (JSON.stringify(d[key]) !== JSON.stringify(value)) kept.push(SDB_LABELS[key])
  }
  fill('maker', res.hersteller, !d.maker)
  fill('product', res.produkt, !d.product)
  fill('ghs', GHS.map((g) => g.id).filter((id) => res.ghs.includes(id)), !d.ghs.length)
  fill('signal', SIGNAL_IDS[res.signalwort] || '', !d.signal)
  fill('h', res.hSaetze.map((x) => x.toUpperCase()).join(', '), !d.h)
  fill('p', res.pSaetze.join(', '), !d.p)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(res.fassung) && res.fassung <= todayISO() ? res.fassung : ''
  fill('sdbDate', date, !d.sdbDate)
  m.kixFields = filled
  const items = [
    ...(kept.length ? [{ level: 'info', text: `Schon ausgefüllt, nicht geändert: ${kept.join(', ')}.` }] : []),
    ...(res.fassung && !date ? [{ level: 'warning', text: `Fassung laut Datenblatt: „${res.fassung}“ – bitte das Datum selbst eintragen.` }] : []),
    ...res.hinweise,
  ]
  kixSet('sdb', { notice: { title: filled.length ? 'Aus dem Sicherheitsdatenblatt gelesen – bitte prüfen. Gespeichert wird erst mit „Speichern“.' : 'Aus dem Sicherheitsdatenblatt gelesen: alle Felder waren schon ausgefüllt.', items } })
}

// ---------------------------------------------------------------- Betriebsanweisung

function baDraft(m) {
  if (!m.draft) {
    const existing = m.id ? baOf(m.id) : null
    if (existing) m.draft = structuredClone({ ...existing, sections: { ...emptySections(), ...(existing.sections || {}) } })
    else {
      const kind = m.articleId || m.kind === 'stoff' ? 'stoff' : 'taetigkeit'
      m.draft = { id: '', kind, articleId: m.articleId || '', title: '', area: '', sections: emptySections(), date: todayISO(), approvedBy: '', approvedAt: '', trainingTypeId: kind === 'stoff' ? settings().trainingTypeId : '', pdf: null }
      if (m.articleId) fillFromArticle(m.draft)
    }
  }
  return m.draft
}

function fillFromArticle(d) {
  const a = artOf(d.articleId)
  if (!a) return
  const v = instructionFromArticle(a)
  d.title = v.title
  d.area ||= v.area
  d.sections = v.sections
}

function readBa() {
  const m = app.ui.modal
  const d = baDraft(m)
  if (!document.getElementById('asch-b-title')) return d
  const kind = document.getElementById('asch-b-kind') ? val('asch-b-kind') : d.kind
  const articleId = kind === 'stoff' && document.getElementById('asch-b-article') ? val('asch-b-article') : kind === 'stoff' ? d.articleId : ''
  Object.assign(d, {
    title: val('asch-b-title').trim(),
    area: val('asch-b-area').trim(),
    date: val('asch-b-date'),
    approvedBy: val('asch-b-appby').trim(),
    approvedAt: val('asch-b-appat'),
    trainingTypeId: document.getElementById('asch-b-train') ? val('asch-b-train') : d.trainingTypeId,
    sections: Object.fromEntries(BA_SECTIONS.map(([k]) => [k, val(`asch-b-sec-${k}`)])),
  })
  if (!d.id && (kind !== d.kind || articleId !== d.articleId)) {
    d.kind = kind
    d.articleId = articleId
    if (kind === 'stoff' && articleId) {
      fillFromArticle(d)
      d.trainingTypeId ||= settings().trainingTypeId
    }
  }
  return d
}

function baModal(c, m) {
  const d = baDraft(m)
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const existing = d.id ? baOf(d.id) : null
  const a = d.kind === 'stoff' ? artOf(d.articleId) : null
  const today = todayISO()
  const sdb = a ? sdbState(a, today, settings().sdbYears) : null
  const stoffe = rowsAt(today).map((r) => [r.article.id, r.product])
  if (a && !stoffe.some(([id]) => id === a.id)) stoffe.push([a.id, a.haz?.product || a.name])
  const tDoc = trainingsDoc()
  const type = tDoc && d.trainingTypeId ? trainingTypeOf(tDoc, d.trainingTypeId) : null
  const gaps = a && type ? gapsOf(a, today, d.trainingTypeId) : null
  const tOpts = trainingOptions()
  if (type && !tOpts.some(([id]) => id === type.id)) tOpts.push([type.id, type.name])
  const sections = BA_SECTIONS.map(([k, label]) => `<label class="field wide"><span>${esc(label)}</span><textarea id="asch-b-sec-${k}" rows="${k === 'schutz' || k === 'ersteHilfe' ? 5 : 3}" placeholder="${esc(SECTION_HINTS[k])}" ${dis}>${esc(d.sections[k] || '')}</textarea></label>`).join('')
  return modalFrame({
    title: existing ? `Betriebsanweisung: ${existing.title}` : 'Betriebsanweisung anlegen',
    subtitle: `${esc(BA_KINDS[d.kind])}${existing ? ` · Stand ${short(existing.date)}${existing.approvedAt ? ' · freigegeben' : ' · Entwurf'}` : ''}`,
    wide: true,
    body: `<div class="form-grid">
        ${existing ? '' : `<label class="field"><span>Für</span><select id="asch-b-kind" data-change="asch-ba-redraw" ${dis}>${options(Object.entries(BA_KINDS), d.kind)}</select></label>`}
        ${d.kind === 'stoff' && !existing ? `<label class="field"><span>Arbeitsstoff</span><select id="asch-b-article" data-change="asch-ba-redraw" ${dis}>${options(stoffe, d.articleId, { empty: '– Arbeitsstoff –' })}</select></label>` : ''}
        <label class="field wide"><span>Titel</span><input type="text" id="asch-b-title" value="${esc(d.title)}" placeholder="${d.kind === 'stoff' ? 'Produktname' : 'z. B. Scheuersaugmaschine'}" ${dis}></label>
        <label class="field wide"><span>Arbeitsbereich</span><input type="text" id="asch-b-area" value="${esc(d.area)}" placeholder="z. B. Sanitärreinigung in allen Objekten" ${dis}></label>
        <label class="field"><span>Stand</span><input type="date" id="asch-b-date" value="${esc(d.date)}" ${dis}></label>
      </div>
      ${a ? `<div class="asch-ba-pics">${pictos(a.haz?.ghs || [], 40)}${a.haz?.signal ? `<strong>${esc(SIGNALS[a.haz.signal])}</strong>` : ''} <span>Sicherheitsdatenblatt: ${sdbPill(sdb)}</span> <button class="btn small" data-action="asch-stoff-open" data-id="${esc(a.id)}" data-back="${esc(d.id)}">Angaben am Artikel</button>${ed && !existing ? '' : ed ? ` <button class="btn small edit-only" data-action="asch-ba-fill">${app.ui.confirm === 'asch-fill' ? 'Texte wirklich ersetzen?' : 'Vorschlag neu einsetzen'}</button>` : ''}</div>` : ''}
      <div class="form-grid">${sections}</div>
      <div class="form-grid">
        <label class="field"><span>Freigegeben von</span><input type="text" id="asch-b-appby" value="${esc(d.approvedBy)}" placeholder="Name, Funktion" ${dis}></label>
        <label class="field"><span>Freigegeben am</span><input type="date" id="asch-b-appat" value="${esc(d.approvedAt)}" max="${today}" ${dis}></label>
      </div>
      <section><h3>Unterweisung</h3>
        ${tDoc ? `<div class="form-grid"><label class="field"><span>Art der Unterweisung</span><select id="asch-b-train" data-change="asch-ba-redraw" ${dis}>${options(tOpts, d.trainingTypeId, { empty: '– keine –' })}</select></label></div>
        ${ed && trainEditable() ? `<p><button class="btn small edit-only" data-action="asch-ba-type">${ICON.plus} Eigene Art für diese Betriebsanweisung anlegen</button></p>` : ''}
        ${a ? gapsHtml(gaps, { topic: `Betriebsanweisung ${d.title}` }) : type && trainEditable() ? `<p><button class="btn small primary" data-action="tr-session-open" data-type="${esc(type.id)}" data-topic="${esc(`Betriebsanweisung ${d.title}`)}">Unterweisung durchführen</button></p>` : ''}` : '<p class="muted">Unterweisungen sind für deine Rolle nicht sichtbar.</p>'}
      </section>
      <p class="note">${d.kind === 'stoff' ? 'Vorbefüllt aus den Angaben am Artikel – Vorschlag ohne Gewähr. Mit dem Sicherheitsdatenblatt abgleichen (Abschnitte 2, 4 bis 8 und 13), dann freigeben, ausdrucken und gut sichtbar aushängen.' : 'Für Tätigkeiten und Maschinen: Angaben aus der Betriebsanleitung des Herstellers übernehmen.'} Eine Zeile je Punkt; im PDF wird daraus eine Aufzählung.</p>`,
    foot: `<div class="actions">${ed && existing ? `<button class="btn danger edit-only" data-action="asch-ba-delete" data-id="${esc(existing.id)}">${app.ui.confirm === `asch-ba-del:${existing.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}${existing && !ed ? `<button class="btn primary" data-action="asch-ba-pdf" data-id="${esc(existing.id)}">${ICON.download} PDF</button>` : ''}</div>
      <div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? `<button class="btn edit-only" data-action="asch-ba-save" data-pdf="1">${ICON.download} Speichern und PDF</button><button class="btn primary edit-only" data-action="asch-ba-save">Speichern</button>` : ''}</div>`,
  })
}
registerModal('asch-ba', baModal, { module: MODULE })

async function baPdf(ba) {
  const article = ba.kind === 'stoff' ? artOf(ba.articleId) : null
  const sdb = article ? sdbState(article, todayISO(), settings().sdbYears) : null
  const pdf = instructionDocument({ ba, article, sdb, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })
  const meta = await pdfOut(pdf, instructionPdfName(ba), 'betriebsanweisungen')
  if (meta) {
    doc().instructions = doc().instructions.map((b) => (b.id === ba.id ? { ...b, pdf: meta } : b))
    persist()
    renderNow()
  }
  return meta
}

async function saveBa(withPdf) {
  const d = readBa()
  const problem = instructionProblem(d)
  if (problem) return toast(problem)
  const fields = { ...d, title: d.title.trim(), changedAt: nowIso(), changedBy: user() }
  if (d.id) doc().instructions = doc().instructions.map((b) => (b.id === d.id ? { ...b, ...fields } : b))
  else {
    fields.id = uid('ba')
    fields.createdAt = nowIso()
    fields.createdBy = user()
    doc().instructions.push(fields)
  }
  persist()
  closeModal()
  renderNow()
  if (!withPdf) return toast(`Betriebsanweisung gespeichert${fields.approvedAt ? '' : ' (Entwurf, noch nicht freigegeben)'}.`)
  const meta = await baPdf(baOf(fields.id))
  toast(`Betriebsanweisung gespeichert, PDF erstellt${meta && !meta.local ? ' und in SharePoint abgelegt' : ''}.`)
}

// ---------------------------------------------------------------- Evaluierung

function evalDraft(m) {
  if (!m.draft) {
    const existing = m.id ? evOf(m.id) : null
    m.draft = existing ? structuredClone({ trigger: null, objectIds: [], hazards: [], ...existing }) : { id: '', title: '', templateId: '', objectIds: [], participants: '', reviewedAt: todayISO(), reviewedBy: user(), trigger: null, note: '', hazards: [], active: true }
    if (!existing && m.templateId) applyTemplate(m.draft, m.templateId)
  }
  return m.draft
}

/** Vorlage übernehmen: Titel (wenn leer) und Gefahren, die es noch nicht gibt (gleicher Text). */
function applyTemplate(d, id) {
  const t = templateOf(id)
  if (!t) return 0
  d.templateId = id
  d.title ||= t.title
  const have = new Set(d.hazards.map((h) => h.text.trim().toLowerCase()))
  const add = hazardsFromTemplate(id, () => uid('hz')).filter((h) => !have.has(h.text.toLowerCase()))
  d.hazards.push(...add)
  return add.length
}

function readEval() {
  const d = evalDraft(app.ui.modal)
  if (!document.getElementById('asch-e-title')) return d
  const today = todayISO()
  const level = (id) => Math.max(0, Math.min(3, Number(val(id)) || 0))
  Object.assign(d, {
    title: val('asch-e-title').trim(),
    objectIds: checkedValues('asch-e-obj'),
    participants: val('asch-e-part').trim(),
    reviewedAt: val('asch-e-rev'),
    reviewedBy: val('asch-e-revby').trim(),
    trigger: val('asch-e-trig') || val('asch-e-trigtext').trim() ? { date: val('asch-e-trig'), text: val('asch-e-trigtext').trim() } : null,
    note: val('asch-e-note').trim(),
    hazards: d.hazards.map((h, i) => ({
      ...h,
      text: val(`asch-h-text-${i}`).trim(),
      likelihood: level(`asch-h-l-${i}`),
      severity: level(`asch-h-s-${i}`),
      measures: (h.measures || []).map((x, j) => {
        const status = val(`asch-m-status-${i}-${j}`) || x.status
        const next = { ...x, text: val(`asch-m-text-${i}-${j}`).trim(), who: val(`asch-m-who-${i}-${j}`).trim(), due: val(`asch-m-due-${i}-${j}`), trainingTypeId: document.getElementById(`asch-m-train-${i}-${j}`) ? val(`asch-m-train-${i}-${j}`) : x.trainingTypeId || '' }
        return status !== x.status ? setMeasureStatus(next, status, today) : next
      }),
    })),
  })
  return d
}

function evalModal(c, m) {
  const d = evalDraft(m)
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const existing = d.id ? evOf(d.id) : null
  const today = todayISO()
  const tDoc = trainingsDoc()
  const tOpts = tDoc ? trainingOptions() : []
  const level = (map, v) => options([['0', '–'], ...Object.entries(map).map(([k, l]) => [k, `${k} ${l}`])], String(v || 0))
  const objs = app.data.objects.filter((o) => !o.inactive || d.objectIds.includes(o.id)).sort((x, y) => x.name.localeCompare(y.name, 'de'))
  const hazards = d.hazards
    .map((h, i) => {
      const measures = (h.measures || [])
        .map((x, j) => {
          const st = measureState(x, today)
          return `<div class="asch-m">
            <label class="field"><span>Maßnahme</span><input type="text" id="asch-m-text-${i}-${j}" value="${esc(x.text)}" ${dis}></label>
            <label class="field"><span>verantwortlich</span><input type="text" id="asch-m-who-${i}-${j}" value="${esc(x.who || '')}" list="asch-who" ${dis}></label>
            <label class="field"><span>Frist</span><input type="date" id="asch-m-due-${i}-${j}" value="${esc(x.due || '')}" ${dis}></label>
            <label class="field"><span>Status <span class="pill ${STATE_CLS[st]}">${esc(STATE_TEXT[st])}</span></span><select id="asch-m-status-${i}-${j}" data-change="asch-eval-redraw" ${dis}>${options(Object.entries(MEASURE_STATES), x.status || 'offen')}</select></label>
            ${tDoc ? `<label class="field"><span>Unterweisung (optional)</span><select id="asch-m-train-${i}-${j}" ${dis}>${options(tOpts, x.trainingTypeId || '', { empty: '– keine –' })}</select></label>` : ''}
            ${ed ? `<button type="button" class="btn small ghost edit-only" data-action="asch-m-del" data-i="${i}" data-j="${j}" aria-label="Maßnahme entfernen">${ICON.close}</button>` : ''}
          </div>`
        })
        .join('')
      return `<div class="asch-hz">
        <div class="asch-hz-head">
          <label class="field"><span>Gefahr ${h.source === 'vorschlag' ? '<span class="pill">Vorschlag</span>' : ''}</span><input type="text" id="asch-h-text-${i}" value="${esc(h.text)}" ${dis}></label>
          <label class="field"><span>Wahrscheinlichkeit</span><select id="asch-h-l-${i}" data-change="asch-eval-redraw" ${dis}>${level(LIKELIHOOD, h.likelihood)}</select></label>
          <label class="field"><span>Schwere</span><select id="asch-h-s-${i}" data-change="asch-eval-redraw" ${dis}>${level(SEVERITY, h.severity)}</select></label>
          <span class="asch-risk">${riskPill(h)}</span>
          ${ed ? `<button type="button" class="btn small ghost edit-only" data-action="asch-haz-del" data-i="${i}" aria-label="Gefahr entfernen">${app.ui.confirm === `asch-hz:${i}` ? 'Wirklich?' : ICON.close}</button>` : ''}
        </div>
        ${measures || '<p class="muted small">Noch keine Maßnahme.</p>'}
        ${ed ? `<p><button type="button" class="btn small edit-only" data-action="asch-m-add" data-i="${i}">${ICON.plus} Maßnahme</button></p>` : ''}
      </div>`
    })
    .join('')
  return modalFrame({
    title: existing ? `Evaluierung: ${existing.title}` : 'Evaluierung anlegen',
    subtitle: existing ? esc(reviewText(evalsAt(today).find((r) => r.ev.id === existing.id)?.review || { state: 'ok', next: '' })) : 'Arbeitsbereich oder Tätigkeit',
    wide: true,
    body: `<div class="form-grid">
        <label class="field wide"><span>Arbeitsbereich / Tätigkeit</span><input type="text" id="asch-e-title" value="${esc(d.title)}" placeholder="z. B. Unterhaltsreinigung" ${dis}></label>
        ${ed ? `<label class="field"><span>Vorlage (typische Gefahren)</span><select id="asch-e-tpl" ${dis}>${options(EVAL_TEMPLATES.map((t) => [t.id, t.title]), d.templateId || '', { empty: '– wählen –' })}</select></label>
        <div class="field"><span>&nbsp;</span><button type="button" class="btn edit-only" data-action="asch-tpl-add">Vorschläge übernehmen</button></div>` : ''}
        <label class="field"><span>Evaluiert bzw. zuletzt überprüft am</span><input type="date" id="asch-e-rev" value="${esc(d.reviewedAt || '')}" max="${today}" ${dis}></label>
        <label class="field"><span>von</span><input type="text" id="asch-e-revby" value="${esc(d.reviewedBy || '')}" ${dis}></label>
        ${ed ? `<div class="field"><span>&nbsp;</span><button type="button" class="btn edit-only" data-action="asch-reviewed">Heute überprüft</button></div>` : ''}
        <label class="field wide"><span>Beteiligt</span><input type="text" id="asch-e-part" value="${esc(d.participants || '')}" placeholder="z. B. Geschäftsführung, Sicherheitsfachkraft, Arbeitsmedizin" ${dis}></label>
        <label class="field"><span>Anlass zur Überprüfung am</span><input type="date" id="asch-e-trig" value="${esc(d.trigger?.date || '')}" max="${today}" ${dis}></label>
        <label class="field wide"><span>Anlass (z. B. Unfall, Beinaheunfall, neue Maschine)</span><input type="text" id="asch-e-trigtext" value="${esc(d.trigger?.text || '')}" ${dis}></label>
      </div>
      <details class="asch-objs-wrap"><summary>Objekte (${d.objectIds.length ? d.objectIds.length : 'alle'})</summary><p class="muted small">Leer = gilt für alle Objekte.</p><div class="asch-objs">${objs.map((o) => `<label class="check"><input type="checkbox" name="asch-e-obj" value="${esc(o.id)}" ${d.objectIds.includes(o.id) ? 'checked' : ''} ${dis}><span>${esc(o.name)}</span></label>`).join('')}</div></details>
      <h3>Gefahren und Maßnahmen</h3>
      ${hazards || '<p class="muted">Noch keine Gefahr. Vorlage wählen und „Vorschläge übernehmen“ oder „+ Gefahr“.</p>'}
      ${ed ? `<p><button type="button" class="btn small edit-only" data-action="asch-haz-add">${ICON.plus} Gefahr</button></p>` : ''}
      <datalist id="asch-who">${[...WHO, ...(app.data.employees || []).filter((e) => !e.exitDate || e.exitDate >= today).map((e) => e.name)].map((x) => `<option value="${esc(x)}"></option>`).join('')}</datalist>
      <div class="form-grid"><label class="field wide"><span>Notiz</span><input type="text" id="asch-e-note" value="${esc(d.note || '')}" ${dis}></label></div>
      <p class="note">Vorschläge ohne Gewähr: Gefahren aus den Vorlagen sind typische Beispiele der Reinigung, keine vollständige Liste. Jede Gefahr selbst bewerten (Wahrscheinlichkeit mal Schwere) und Maßnahmen mit Verantwortlichen und Fristen festlegen; mit Sicherheitsfachkraft und Arbeitsmedizin abstimmen.</p>`,
    foot: `<div class="actions">${ed && existing ? `<button class="btn danger edit-only" data-action="asch-eval-delete" data-id="${esc(existing.id)}">${app.ui.confirm === `asch-ev-del:${existing.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</div>
      <div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? '<button class="btn primary edit-only" data-action="asch-eval-save">Speichern</button>' : ''}</div>`,
  })
}
registerModal('asch-eval', evalModal, { module: MODULE })

function saveEval() {
  const d = readEval()
  const today = todayISO()
  const problem = evalProblem(d, today)
  if (problem) return toast(problem)
  const fields = { ...d, changedAt: nowIso(), changedBy: user() }
  if (d.id) doc().evaluations = doc().evaluations.map((e) => (e.id === d.id ? { ...e, ...fields } : e))
  else {
    fields.id = uid('ev')
    fields.createdAt = nowIso()
    fields.createdBy = user()
    doc().evaluations.push(fields)
  }
  persist()
  closeModal()
  renderNow()
  const r = evalsAt(today).find((x) => x.ev.id === fields.id)
  toast(`Evaluierung gespeichert${r ? `: ${plural(r.open, 'Maßnahme', 'Maßnahmen')} offen${r.overdue ? `, ${r.overdue} überfällig` : ''}${r.unrated ? `, ${r.unrated} nicht bewertet` : ''}; ${reviewText(r.review)}` : ''}.`)
}

// ---------------------------------------------------------------- Einstellungen

function settingsModal() {
  const s = settings()
  const tDoc = trainingsDoc()
  return modalFrame({
    title: 'Einstellungen Arbeitsschutz',
    body: `<div class="form-grid">
        <label class="field"><span>Sicherheitsdatenblatt veraltet nach (Jahren)</span><input type="number" id="asch-set-sdb" min="1" max="10" value="${esc(s.sdbYears)}"></label>
        <label class="field"><span>Evaluierung überprüfen alle (Monate)</span><input type="number" id="asch-set-rev" min="1" max="60" value="${esc(s.reviewMonths)}"></label>
        <label class="field"><span>Vorlauf für „bald fällig“ (Tage)</span><input type="number" id="asch-set-warn" min="1" max="120" value="${esc(s.warnDays)}"></label>
        ${tDoc ? `<label class="field"><span>Unterweisung zu Arbeitsstoffen</span><select id="asch-set-train">${options(trainingOptions(), s.trainingTypeId, { empty: '– keine –' })}</select></label>` : ''}
      </div>
      <p class="note">Eigene Vorgaben, keine gesetzlichen Fristen (Vorschlag ohne Gewähr). Die Unterweisung zu Arbeitsstoffen gilt, wenn an der Betriebsanweisung keine andere verknüpft ist.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="asch-settings-save">Speichern</button></div>`,
  })
}
registerModal('asch-settings', settingsModal, { module: MODULE })

// ---------------------------------------------------------------- Export

const csvColumns = [
  ['Produkt', (r) => r.product],
  ['Artikel', (r) => r.article.name],
  ['Hersteller', (r) => r.maker],
  ['Verwendung', (r) => r.haz.use || ''],
  ['Piktogramme', (r) => (r.haz.ghs || []).join(' ')],
  ['Signalwort', (r) => (r.haz.signal ? SIGNALS[r.haz.signal] : '')],
  ['H-Sätze', (r) => codesOf(r.haz.h).join(', ')],
  ['P-Sätze', (r) => codesOf(r.haz.p).join(', ')],
  ['Sicherheitsdatenblatt', (r) => sdbText(r.sdb)],
  ['Fassung', (r) => r.sdb.date || ''],
  ['Menge / Lagerort', (r) => r.stock.list.map((s) => `${s.name}: ${String(s.qty).replace('.', ',')} ${r.article.unit || ''}`.trim()).join('; ')],
  ['verwendet in', (r) => r.objectIds.map(objName).filter(Boolean).join(', ')],
  ['Betriebsanweisung', (r) => (r.instruction ? `${r.instruction.approvedAt ? 'freigegeben' : 'Entwurf'} ${r.instruction.date || ''}`.trim() : 'fehlt')],
]

// ---------------------------------------------------------------- Aktionen

registerActions({
  'asch-tab': (el) => {
    app.ui.aschTab = el.dataset.v
    renderNow()
  },
  'asch-search': () => {
    app.ui.aschSearch = val('asch-search')
    renderNow()
    const el = document.getElementById('asch-search')
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  },
  'asch-only': () => {
    app.ui.aschOnly = checked('asch-only')
    renderNow()
  },
  'asch-all-m': () => {
    app.ui.aschAllMeasures = checked('asch-all-m')
    renderNow()
  },
  // von „Zu erledigen“ und dem digitalen Mitarbeiter: Reiter öffnen, bei einer Evaluierung gleich den Dialog
  'asch-goto': (el) => {
    Object.assign(app.ui, { view: 'arbeitsschutz', aschTab: el.dataset.tab || 'stoffe', aschOnly: el.dataset.only === '1' ? true : app.ui.aschOnly, aschSearch: el.dataset.only === '1' ? '' : app.ui.aschSearch })
    if (app.ui.modal) closeModal()
    renderNow()
    if (el.dataset.id) openModal({ type: 'asch-eval', id: el.dataset.id })
  },
  'asch-stoff-open': (el) => openModal({ type: 'asch-stoff', id: el.dataset.id || '', back: el.dataset.back || '' }),
  'asch-stoff-redraw': () => {
    readStoff()
    renderModal()
  },
  'asch-sdb-open': (el) => {
    const a = artOf(el.dataset.id)
    if (!a) return
    const s = sdbState(a, todayISO())
    if (s.file) return openFile(s.file)
    if (s.link) return void window.open(s.link, '_blank', 'noopener')
    toast('Kein Sicherheitsdatenblatt hinterlegt.')
  },
  'asch-ba-open': (el) => openModal({ type: 'asch-ba', id: el.dataset.id || '', articleId: el.dataset.article || '', kind: el.dataset.kind || '' }),
  'asch-ba-redraw': () => {
    readBa()
    renderModal()
  },
  'asch-ba-pdf': async (el) => {
    const ba = baOf(el.dataset.id)
    if (ba) await baPdf(ba)
  },
  'asch-eval-open': (el) => openModal({ type: 'asch-eval', id: el.dataset.id || '', templateId: el.dataset.template || '' }),
  'asch-eval-redraw': () => {
    readEval()
    renderModal()
  },
  'asch-verz-pdf': async () => {
    const today = todayISO()
    const pdf = verzeichnisDocument({ rows: rowsAt(today), objectName: objName, today, settings: settings(), brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })
    const meta = await pdfOut(pdf, verzeichnisPdfName(today), 'verzeichnis')
    if (meta && !meta.local) toast('Arbeitsstoffverzeichnis erstellt und in SharePoint abgelegt.')
  },
  'asch-verz-csv': () => download(`Arbeitsstoffverzeichnis_${todayISO()}.csv`, new Blob([`﻿${toCSV(rowsAt(), csvColumns)}`], { type: 'text/csv;charset=utf-8' })),
  'asch-sgd-pdf': async () => {
    const today = todayISO()
    const pdf = sgdDocument({ rows: evalsAt(today), stoffe: rowsAt(today).length, instructions: doc().instructions, objectName: objName, today, settings: settings(), brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })
    const meta = await pdfOut(pdf, sgdPdfName(today), 'evaluierung')
    if (meta && !meta.local) toast('Sicherheits- und Gesundheitsschutzdokument erstellt und in SharePoint abgelegt.')
  },
})

// Angaben am Artikel: wer Arbeitsstoffe bearbeitet (Lager, Vollzugriff)
registerActions(
  {
    'asch-stoff-save': () => saveStoff(),
    'asch-sdb-file': (el) => {
      const file = el.files?.[0]
      if (!file) return
      readStoff().file = file
      renderModal()
    },
    'asch-sdb-del': (el) => {
      const d = readStoff()
      if (el.dataset.kind === 'neu') d.file = null
      else d.sdb = null
      renderModal()
    },
    'kix-sdb': async (el) => {
      const m = app.ui.modal
      if (m?.type !== 'asch-stoff' || m.kix?.sdb?.busy) return
      const d = readStoff()
      const file = await sdbPdf(d)
      if (!file) return kixSet('sdb', { error: 'Kein PDF zum Lesen: bitte das Sicherheitsdatenblatt als PDF hochladen.' })
      if (!el?.dataset?.consent && !kixConsent('sdb', 'Das Sicherheitsdatenblatt (PDF)', { action: 'kix-sdb' })) return
      const articleId = d.articleId
      kixSet('sdb', { busy: 'Die KI liest das Sicherheitsdatenblatt …' })
      try {
        const pdf = await kixFile(file, { pages: KI_LIMITS.sdbPages })
        if (pdf.kind !== 'pdf') throw new Error('Bitte das Sicherheitsdatenblatt als PDF nehmen.')
        const { extractSdb } = await import('../../ai/extract.js')
        const res = await extractSdb(pdf.data)
        if (app.ui.modal !== m || m.draft?.articleId !== articleId) return
        readStoff()
        applySdb(m, res)
        renderModal()
      } catch (err) {
        if (app.ui.modal === m) kixSet('sdb', { error: kixFailed(err) })
      }
    },
  },
  { edit: STOFFE },
)

registerActions(
  {
    'asch-ba-save': (el) => saveBa(el.dataset.pdf === '1'),
    'asch-ba-delete': (el) => {
      if (!confirmStep(`asch-ba-del:${el.dataset.id}`, renderModal)) return
      doc().instructions = doc().instructions.filter((b) => b.id !== el.dataset.id)
      persist()
      closeModal()
      renderNow()
      toast('Betriebsanweisung gelöscht. Abgelegte PDFs bleiben in SharePoint.')
    },
    'asch-ba-fill': () => {
      if (!confirmStep('asch-fill', renderModal)) return
      const d = readBa()
      fillFromArticle(d)
      renderModal()
    },
    // eigene Art der Unterweisung für diese Betriebsanweisung (in unterweisungen.json) und gleich verknüpfen
    'asch-ba-type': () => {
      if (!canEdit('unterweisungen')) return toast('Nur mit Recht auf die Unterweisungen.')
      const d = readBa()
      if (!d.title) return toast('Bitte zuerst den Titel eintragen.')
      const u = (app.data.unterweisungen ||= { types: [], records: [], sessions: [] })
      if (!u.types?.length) u.types = structuredClone(TRAINING_DEFAULTS)
      const name = `Unterweisung: ${d.title}`
      let type = u.types.find((t) => t.name === name)
      if (!type) {
        type = { id: uid('t'), name, months: 12, who: 'optional', kind: 'unterweisung', law: '§ 14 ASchG', note: `Betriebsanweisung ${d.title}`, active: true }
        u.types.push(type)
        persist()
      }
      d.trainingTypeId = type.id
      renderModal()
      toast(`Art „${name}“ unter Unterweisungen & Fristen angelegt und verknüpft.`)
    },
    'asch-eval-save': () => saveEval(),
    'asch-eval-delete': (el) => {
      if (!confirmStep(`asch-ev-del:${el.dataset.id}`, renderModal)) return
      doc().evaluations = doc().evaluations.filter((e) => e.id !== el.dataset.id)
      persist()
      closeModal()
      renderNow()
      toast('Evaluierung gelöscht.')
    },
    'asch-tpl-add': () => {
      const d = readEval()
      const id = val('asch-e-tpl')
      if (!id) return toast('Bitte zuerst eine Vorlage wählen.')
      const n = applyTemplate(d, id)
      renderModal()
      toast(n ? `${plural(n, 'Gefahr', 'Gefahren')} als Vorschlag übernommen – bitte bewerten und Fristen eintragen.` : 'Alle Gefahren dieser Vorlage sind schon eingetragen.')
    },
    'asch-reviewed': () => {
      const d = readEval()
      d.reviewedAt = todayISO()
      d.reviewedBy = user()
      renderModal()
    },
    'asch-haz-add': () => {
      readEval().hazards.push({ id: uid('hz'), text: '', source: 'eigen', likelihood: 0, severity: 0, measures: [{ id: uid('ms'), text: '', who: '', due: '', status: 'offen', doneAt: '', checkedAt: '', trainingTypeId: '' }] })
      renderModal()
      document.getElementById(`asch-h-text-${app.ui.modal.draft.hazards.length - 1}`)?.focus()
    },
    'asch-haz-del': (el) => {
      const d = readEval()
      const i = Number(el.dataset.i)
      const h = d.hazards[i]
      // mit Inhalt zweistufig bestätigen
      if (h && (h.text || (h.measures || []).some((x) => x.text)) && !confirmStep(`asch-hz:${i}`, renderModal)) return
      d.hazards = d.hazards.filter((_, k) => k !== i)
      renderModal()
    },
    'asch-m-add': (el) => {
      const d = readEval()
      const h = d.hazards[Number(el.dataset.i)]
      if (!h) return
      h.measures = [...(h.measures || []), { id: uid('ms'), text: '', who: '', due: '', status: 'offen', doneAt: '', checkedAt: '', trainingTypeId: '' }]
      renderModal()
      document.getElementById(`asch-m-text-${el.dataset.i}-${h.measures.length - 1}`)?.focus()
    },
    'asch-m-del': (el) => {
      const d = readEval()
      const h = d.hazards[Number(el.dataset.i)]
      if (!h) return
      h.measures = h.measures.filter((_, k) => k !== Number(el.dataset.j))
      renderModal()
    },
    // Status einer Maßnahme direkt in der Liste (umgesetzt, wirksam, nicht wirksam)
    'asch-m-set': (el) => {
      const ev = evOf(el.dataset.ev)
      if (!ev) return
      const today = todayISO()
      let text = ''
      const hazards = ev.hazards.map((h) => ({ ...h, measures: (h.measures || []).map((m) => (m.id === el.dataset.m ? ((text = m.text), setMeasureStatus(m, el.dataset.v, today)) : m)) }))
      doc().evaluations = doc().evaluations.map((e) => (e.id === ev.id ? { ...e, hazards, changedAt: nowIso(), changedBy: user() } : e))
      persist()
      renderNow()
      toast(`„${text}“: ${MEASURE_STATES[el.dataset.v]}${el.dataset.v === 'unwirksam' ? ' – bitte eine neue Maßnahme festlegen' : el.dataset.v === 'umgesetzt' ? '; Wirksamkeit später prüfen' : ''}.`)
    },
    'asch-settings-open': () => openModal({ type: 'asch-settings' }),
    'asch-settings-save': () => {
      const num = (id, min, max) => Math.max(min, Math.min(max, Math.round(Number(val(id)) || 0)))
      doc().settings = { ...doc().settings, sdbYears: num('asch-set-sdb', 1, 10), reviewMonths: num('asch-set-rev', 1, 60), warnDays: num('asch-set-warn', 1, 120), ...(document.getElementById('asch-set-train') ? { trainingTypeId: val('asch-set-train') } : {}) }
      persist()
      closeModal()
      renderNow()
      toast('Einstellungen gespeichert.')
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Zu erledigen

const todoLine = (x) => {
  if (x.kind === 'massnahmen') return x.list.map(({ m, state }) => `${m.text}: ${state === 'unwirksam' ? 'nicht wirksam' : `überfällig seit ${short(m.due)}`}${m.who ? ` (${m.who})` : ''}`)
  return [`Überprüfung ${x.review.state === 'anlass' ? `wegen Anlass am ${short(x.review.trigger.date)}${x.review.trigger.text ? `: ${x.review.trigger.text}` : ''}` : x.review.state === 'ueberfaellig' ? `überfällig seit ${short(x.review.next)}` : `fällig am ${short(x.review.next)}`}`]
}

registerTodo({
  id: 'arbeitsschutz',
  module: MODULE,
  title: 'Arbeitsschutz',
  compute: (today) =>
    attention({ doc: doc(), material: null, today, settings: settings() }).map((x) => ({
      ...x,
      id: x.kind === 'massnahmen' ? `m:${x.ev.id}:${x.list.map((y) => `${y.m.id}-${y.state}`).join(',')}` : `r:${x.ev.id}:${x.review.state}:${x.review.next}`,
    })),
  render: (list) =>
    list
      .map((x) => {
        const lines = todoLine(x)
        return `<div class="todo-item"><span class="flag ${isUrgent(x) ? 'error' : 'warning'}">${x.kind === 'massnahmen' ? lines.length : '!'}</span><div class="todo-text"><strong>Evaluierung ${esc(x.ev.title)}</strong><br><span class="muted">${esc(lines.slice(0, 3).join(' · '))}${lines.length > 3 ? ' …' : ''}</span></div><button class="btn small primary" data-action="asch-goto" data-tab="evaluierung" data-id="${esc(x.ev.id)}">Öffnen</button></div>`
      })
      .join(''),
})

// Sicherheitsdatenblätter: für alle, die die Angaben am Artikel pflegen (Lager, Vollzugriff)
registerTodo({
  id: 'arbeitsstoffe',
  module: STOFFE,
  title: 'Arbeitsstoffe',
  compute: (today) =>
    attention({ doc: { evaluations: [], instructions: doc().instructions, settings: doc().settings }, material: material(), today, settings: settings() })
      .filter((x) => x.kind === 'sdb')
      .map((x) => ({ ...x, id: `s:${x.rows.map((r) => `${r.article.id}-${r.sdb.state}`).join(',')}` })),
  render: (list) =>
    list
      .map((x) => {
        const text = x.rows.map((r) => `${r.product}: ${r.sdb.state === 'fehlt' ? 'fehlt' : `veraltet (Fassung ${short(r.sdb.date)})`}`)
        return `<div class="todo-item"><span class="flag ${isUrgent(x) ? 'error' : 'warning'}">${x.rows.length}</span><div class="todo-text"><strong>Sicherheitsdatenblätter</strong><br><span class="muted">${esc(text.slice(0, 4).join(' · '))}${text.length > 4 ? ' …' : ''}</span></div><button class="btn small primary" data-action="asch-goto" data-tab="stoffe" data-only="1">Öffnen</button></div>`
      })
      .join(''),
})
