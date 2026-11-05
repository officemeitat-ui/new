// Fakturierung → „Aus orgaMAX übernehmen“: Assistent in vier Schritten.
//  1. Dateien: Excel (.xlsx), CSV/Text, XML (Tabellen-Export oder E-Rechnung), PDF (ZUGFeRD oder Original-Belege),
//     ZIP mit allem. Alles bleibt im Browser, bis „Übernehmen“ gedrückt wird.
//  2. Zuordnen: je Tabelle die erkannte Art (Kunden, Belege, Positionen …) und die Spalten, änderbar.
//  3. Prüfen: was neu kommt, was ergänzt wird, was übersprungen wird, Hinweise; Nummernkreise weiterzählen.
//  4. Übernehmen: in fakturierung.json, Original-PDFs nach SharePoint (fakturierung/belege/JAHR/…).
// Rechenkern: core/fak-import.js (getestet).

import { buildImport, dbTableKind, detectTable, dumpTable, eInvoiceFromPdf, matchColumns, mergeImport, numberInName, numberingAfterImport, parseEInvoice, SYSTEM, tableFromCsv, tablesFromXml, TARGETS, toTable } from '../../core/fak-import.js'
import { todayISO } from '../../core/dates.js'
import { mergePurchaseImport } from '../../core/purchase.js'
import { archivePath, docFileName, emptyInvoicing, formatNumber, KINDS, settingsOf } from '../../core/invoicing.js'
import { app, canEdit, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { loadScript } from '../load-script.js'
import { esc, ICON, modalFrame, options } from '../shared.js'

const MODULE = 'fakturierung'
const F = () => (app.data.fakturierung ||= emptyInvoicing())
const editable = () => canEdit(MODULE) && !app.readOnly

// Arbeitsstand des Assistenten (nicht im Dialog-Objekt: Tabellen können groß sein)
let W = null
const reset = () => {
  W = { step: 'files', files: [], tables: [], eInvoices: [], pdfs: [], blobs: new Map(), dumpInfo: null, progress: '', busy: false, result: null, preview: null, numbering: {}, take: {}, open: null }
}

// ---------------------------------------------------------------- Dateien lesen

const ext = (name) => String(name).toLowerCase().split('.').pop()

/** Text aus Bytes: UTF-8, sonst Windows-1252 (ältere Exporte aus Windows-Programmen). */
function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Zellwert aus ExcelJS: Rich Text, Formeln, Links, Datum. */
function cellValue(v) {
  if (v == null) return ''
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((x) => x.text).join('')
    if ('result' in v) return cellValue(v.result)
    if ('text' in v) return String(v.text)
    if ('error' in v) return ''
  }
  return v
}

async function readXlsx(bytes, name) {
  await loadScript('vendor/exceljs.min.js')
  const wb = new window.ExcelJS.Workbook()
  await wb.xlsx.load(bytes)
  const out = []
  wb.eachSheet((sheet) => {
    const rows = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values.slice(1).map(cellValue)
      rows.push(values)
    })
    const t = toTable(rows, wb.worksheets.length > 1 ? `${name} · ${sheet.name}` : name)
    if (t.columns.length && t.rows.length) out.push(t)
  })
  return out
}

/** Eine Datei auswerten; ZIP rekursiv. */
async function readFile(name, bytes) {
  const e = ext(name)
  const entry = { name, size: bytes.length, found: '' }
  W.files.push(entry)
  try {
    if (e === 'zip') {
      await loadScript('vendor/jszip.min.js')
      const zip = await window.JSZip.loadAsync(bytes)
      const manifestName = Object.keys(zip.files).find((n) => /(^|[\\/])_orgamax\.json$/.test(n))
      if (manifestName) return readDump(zip, manifestName, entry)
      const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !/(^|\/)(__MACOSX|\.)/.test(n))
      entry.found = `${names.length} Dateien im ZIP`
      for (const n of names) await readFile(n.split('/').pop(), new Uint8Array(await zip.files[n].async('uint8array')))
      return
    }
    if (e === 'xlsx' || e === 'xlsm') {
      const tables = await readXlsx(bytes, name)
      addTables(tables)
      entry.found = tables.length ? tables.map((t) => `${t.rows.length} Zeilen`).join(', ') : 'leer'
      return
    }
    if (e === 'xls') {
      entry.error = 'Altes Excel-Format: in Excel öffnen und als .xlsx speichern (oder in orgaMAX als Excel 2007+ exportieren).'
      return
    }
    if (e === 'csv' || e === 'txt' || e === 'tsv') {
      const t = tableFromCsv(decodeText(bytes), name)
      addTables(t.columns.length ? [t] : [])
      entry.found = `${t.rows.length} Zeilen`
      return
    }
    if (e === 'xml') {
      const text = decodeText(bytes)
      try {
        const invoice = parseEInvoice(text)
        W.eInvoices.push({ invoice, fileName: name })
        entry.found = `E-Rechnung ${invoice.number}`
        return
      } catch {
        const tables = tablesFromXml(text, name)
        addTables(tables)
        entry.found = tables.length ? `${tables.length} Tabelle(n)` : 'nichts erkannt'
        return
      }
    }
    if (e === 'pdf') {
      const xml = await eInvoiceFromPdf(bytes, inflate).catch(() => null)
      if (xml) {
        const invoice = parseEInvoice(xml)
        W.eInvoices.push({ invoice, fileName: name, pdf: bytes })
        entry.found = `ZUGFeRD-Rechnung ${invoice.number}`
      } else {
        W.pdfs.push({ name, bytes: bytes.length < 3e6 ? bytes : null, load: async () => bytes })
        entry.found = 'PDF (wird an den Beleg mit passender Nummer angehängt)'
      }
      return
    }
    entry.error = 'Dateiart unbekannt (erwartet: xlsx, csv, txt, xml, pdf, zip).'
  } catch (err) {
    entry.error = `Nicht lesbar: ${err.message}`
  }
}

/**
 * Komplettexport aus dem Export-Werkzeug (orgaMAX-Datenbank über ODBC): _orgamax.json mit Tabellen und Spaltentypen,
 * tabellen/*.csv, dateien/ (PDFs und Bilder aus der Datenbank), archiv/ (PDFs und E-Rechnungen aus dem Datenordner).
 */
async function readDump(zip, manifestName, entry) {
  const base = manifestName.replace(/_orgamax\.json$/, '')
  const file = (rel) => zip.file(`${base}${rel}`) || zip.file(`${base}${rel.replace(/\//g, '\\')}`)
  const manifest = JSON.parse(await zip.files[manifestName].async('string'))
  W.dumpInfo = { created: manifest.created, tables: manifest.tables?.length || 0, rows: manifest.rows || 0, unreadable: (manifest.log || []).length, dsn: manifest.dsn }
  let n = 0
  for (const t of manifest.tables || []) {
    if (!t.rows) continue
    const f = file(`tabellen/${t.name}.csv`)
    if (!f) continue
    W.progress = `Lese ${t.name} (${++n} von ${manifest.tables.length}) …`
    renderModal()
    const table = dumpTable(await f.async('string'), t.name, t.columns || [])
    const known = dbTableKind(t.name)
    const d = known ? null : detectTable(table)
    const kind = known || (d && d.score >= 8 ? d.kind : '')
    W.tables.push({ id: `t${++tableId}`, table, kind, map: kind ? matchColumns(kind, table.columns) : {}, db: true, known: !!known })
  }
  // Dateien aus der Datenbank (z. B. Beleg-PDFs) für später merken
  for (const name of Object.keys(zip.files)) {
    const rel = name.slice(base.length).replace(/\\/g, '/')
    if (/^dateien\//.test(rel)) W.blobs.set(rel, () => zip.files[name].async('uint8array'))
  }
  // Archiv: PDFs und E-Rechnungen aus dem orgaMAX-Datenordner
  const archive = Object.keys(zip.files).filter((name) => /^archiv\//.test(name.slice(base.length).replace(/\\/g, '/')) && /\.(pdf|xml)$/i.test(name))
  let i = 0
  for (const name of archive) {
    W.progress = `Prüfe Archiv ${++i} von ${archive.length} …`
    if (i % 25 === 0) renderModal()
    const short = name.split(/[\\/]/).pop()
    const load = () => zip.files[name].async('uint8array')
    try {
      if (/\.xml$/i.test(name)) {
        const invoice = parseEInvoice(decodeText(await load()))
        W.eInvoices.push({ invoice, fileName: short })
      } else {
        const bytes = await load()
        const xml = await eInvoiceFromPdf(bytes, inflate).catch(() => null)
        if (xml) W.eInvoices.push({ invoice: parseEInvoice(xml), fileName: short, pdf: bytes })
        else W.pdfs.push({ name: short, load })
      }
    } catch {
      /* keine E-Rechnung: bleibt Archiv */
    }
  }
  W.progress = ''
  const known = W.tables.filter((t) => t.known).length
  entry.found = `Komplettexport: ${manifest.tables?.length || 0} Tabellen, ${known} erkannt${archive.length ? `, ${archive.length} Archivdateien` : ''}${W.dumpInfo.unreadable ? ` · ${W.dumpInfo.unreadable} Tabellen nicht lesbar (erweiterten ODBC-Zugriff wählen)` : ''}`
}

/** Export-Werkzeug für den orgaMAX-PC als ZIP (CMD + PowerShell mit BOM und Windows-Zeilenenden + Anleitung). */
async function downloadTool() {
  await loadScript('vendor/jszip.min.js')
  const get = async (f) => (await fetch(`assets/orgamax-export/${f}`)).text()
  const crlf = (t) => t.replace(/\r?\n/g, '\r\n')
  const zip = new window.JSZip()
  zip.file('orgaMAX-Export/orgaMAX-Export.cmd', crlf(await get('orgaMAX-Export.cmd.txt')))
  zip.file('orgaMAX-Export/orgaMAX-Export.ps1', `﻿${crlf(await get('orgaMAX-Export.ps1.txt'))}`)
  zip.file('orgaMAX-Export/LIESMICH.txt', `﻿${crlf(TOOL_README)}`)
  const blob = await zip.generateAsync({ type: 'blob' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'orgaMAX-Export.zip'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

const TOOL_README = `orgaMAX-Komplettexport für die Cleanos App
==========================================

Was es tut: liest ALLE Daten aus orgaMAX (Kunden, Ansprechpartner, Artikel, Rechnungen, Gutschriften,
Angebote, Aufträge mit allen Positionen, Zahlungen, Mahnstufen, Abo-Rechnungen, Textbausteine,
Zahlungsbedingungen und alle weiteren Tabellen) über den ODBC-Zugang von orgaMAX. Es wird nur gelesen,
in orgaMAX ändert sich nichts. Dazu kommen die PDF-Belege und E-Rechnungen aus dem orgaMAX-Datenordner.

Einmalig vorbereiten (auf dem PC mit orgaMAX):
 1. Firebird-ODBC-Treiber installieren (orgaMAX zeigt im nächsten Schritt den passenden Link, 32 oder 64 Bit).
 2. Rechtsklick auf orgaMAX → „Als Administrator ausführen“.
 3. orgaMAX → Einstellungen → „ODBC-Datenbankzugriff einrichten…“ → den ERWEITERTEN Zugriff
    (Lesezugriff auf alle Tabellen) wählen und speichern. Benutzer und Kennwort von dort notieren.

Export:
 4. Diesen Ordner auf den orgaMAX-PC kopieren (z. B. Desktop), Doppelklick auf „orgaMAX-Export.cmd“.
    Fragt Windows nach („Der Computer wurde durch Windows geschützt“): „Weitere Informationen“ → „Trotzdem ausführen“.
 5. Fragt das Fenster nach Benutzer und Kennwort: die aus Schritt 3 eingeben.
 6. Nach ein paar Minuten liegt auf dem Desktop „orgaMAX-Komplettexport_DATUM.zip“
    und „orgaMAX-Struktur_DATUM.json“ (nur Tabellen- und Spaltennamen, ohne Kundendaten).

Übernehmen:
 7. Die ZIP (z. B. per USB-Stick) auf einen PC mit der Cleanos App bringen.
 8. Cleanos App → Fakturierung → „Aus orgaMAX übernehmen“ → ZIP hineinziehen → prüfen → „Übernehmen“.

Die ZIP enthält alle Geschäftsdaten: sicher aufbewahren und nach der Übernahme löschen oder verschlüsselt archivieren.
Die Struktur-Datei enthält keine Kundendaten und darf zur Abstimmung an den Entwickler der App.
`

let tableId = 0
function addTables(tables) {
  for (const t of tables) {
    const d = detectTable(t)
    W.tables.push({ id: `t${++tableId}`, table: t, kind: d.kind, map: d.map, scores: d.scores })
  }
}

// ---------------------------------------------------------------- Prüfen

function analyse() {
  const d = F()
  const s = settingsOf(d)
  const sources = W.tables.filter((t) => t.kind).map((t) => ({ table: t.table, kind: t.kind, map: t.map }))
  const result = buildImport(sources, W.eInvoices, { existing: d, objects: app.data.objects || [], sender: s.sender })
  // Original-PDFs: E-Rechnung im PDF → ihr PDF; sonst Belegnummer im Dateinamen
  const numbers = result.documents.map((x) => x.number)
  W.uploads = []
  for (const e of W.eInvoices.filter((x) => x.pdf)) {
    const doc = result.documents.find((x) => x.number === e.invoice.number)
    if (doc) W.uploads.push({ doc, name: e.fileName, bytes: e.pdf })
  }
  // PDF aus der Datenbank (Komplettexport): Spalte mit „dateien/…pdf“ am Beleg
  for (const doc of result.documents) {
    const path = Object.values(doc.extra || {}).find((x) => /^dateien\/.+\.pdf$/i.test(String(x)))
    if (path && W.blobs.has(path) && !W.uploads.some((u) => u.doc === doc)) W.uploads.push({ doc, name: path.split('/').pop(), load: W.blobs.get(path) })
  }
  W.unmatched = []
  for (const p of W.pdfs) {
    const no = numberInName(p.name, numbers)
    const doc = no && result.documents.find((x) => x.number === no)
    if (doc && !W.uploads.some((u) => u.doc === doc)) W.uploads.push({ doc, name: p.name, bytes: p.bytes, load: p.load })
    else W.unmatched.push(p.name)
  }
  // nur mit SharePoint gibt es eine Ablage für die Original-PDFs
  if (app.store?.kind === 'sharepoint') for (const u of W.uploads) u.doc.original = { path: archivePath(u.doc, `Original_${docFileName(u.doc)}`), name: u.name, system: SYSTEM }
  W.result = result
  W.preview = mergeImport(d, result)
  // Einkauf & Kasse: Probelauf auf einer Kopie (eingespielt wird erst bei „Übernehmen“)
  const p = result.purchase || { suppliers: [], invoices: [], cash: [] }
  W.purchaseAny = p.suppliers.length + p.invoices.length + p.cash.length > 0
  W.purchaseAllowed = canEdit('einkauf')
  W.purchasePreview = W.purchaseAny && W.purchaseAllowed ? mergePurchaseImport(structuredClone({ einkauf: app.data.einkauf, kasse: app.data.kasse }), p, { system: SYSTEM }) : null
  W.numbering = Object.fromEntries(Object.entries(numberingAfterImport(W.preview.data.documents, todayISO(), { series: s.series })).filter(([kind, n]) => !(n.same && !s.numberFormats?.[kind])))
  // Weiterzählen wie in orgaMAX vorschlagen, solange in der App noch keine eigenen Belege dieser Art festgeschrieben sind
  W.take = Object.fromEntries(Object.keys(W.numbering).map((kind) => [kind, !d.documents.some((x) => x.kind === kind && x.number && !x.imported)]))
  W.step = 'check'
}

async function apply() {
  if (!W?.preview) return
  W.busy = true
  renderModal()
  // Original-PDFs zuerst hochladen (Pfad steht dann im Beleg); ohne SharePoint bleiben sie weg
  let uploaded = 0
  if (app.store?.kind === 'sharepoint') {
    for (const u of W.uploads) {
      try {
        W.progress = `Lege PDF ${++uploaded} von ${W.uploads.length} ab …`
        renderModal()
        const bytes = u.bytes || (await u.load())
        const up = await app.store.upload(u.doc.original.path, new Blob([bytes], { type: 'application/pdf' }), 'application/pdf')
        u.doc.original.url = up?.webUrl || ''
      } catch (err) {
        uploaded--
        delete u.doc.original
        toast(`PDF ${u.name} nicht abgelegt: ${err.message}`)
      }
    }
  } else for (const u of W.uploads) delete u.doc.original
  // neu einspielen, damit die Belege den Ablageort (oder keinen) haben; „original“ zählt nicht zur Prüfsumme
  W.preview = mergeImport(F(), W.result)
  const d = F()
  const next = W.preview.data
  for (const k of ['customers', 'articles', 'documents', 'textBlocks', 'paymentTerms', 'recurring']) d[k] = next[k]
  // Nummernkreise: gewähltes Format übernehmen, Start mit der nächsten Nummer
  const year = todayISO().slice(0, 4)
  for (const [kind, n] of Object.entries(W.numbering)) {
    if (!W.take[kind]) continue
    d.settings.numberFormats = { ...(d.settings.numberFormats || {}), [kind]: n.template }
    d.settings.numberDigits = { ...(d.settings.numberDigits || {}), [kind]: n.digits }
    d.settings.yearly = { ...(d.settings.yearly || {}), [kind]: n.yearly }
    d.settings.start = { ...(d.settings.start || {}), ...(n.yearly ? { [`${kind}|${year}`]: n.next } : { [kind]: n.next }) }
  }
  // Einkauf & Kasse (eigene Dateien einkauf/…, nur mit Recht darauf)
  if (W.purchaseAny && W.purchaseAllowed) W.purchaseReport = mergePurchaseImport(app.data, W.result.purchase, { system: SYSTEM, by: app.user?.name || 'Übernahme' })
  d.imports = [...(d.imports || []), { at: new Date().toISOString(), by: app.user?.name || 'Browser', system: SYSTEM, files: W.files.map((f) => f.name).slice(0, 200), report: W.preview.report, purchase: W.purchaseReport ? { added: W.purchaseReport.added, updated: W.purchaseReport.updated } : null, pdfs: uploaded }]
  persist()
  W.busy = false
  W.step = 'done'
  W.uploaded = uploaded
  renderNow()
  renderModal()
}

// ---------------------------------------------------------------- Oberfläche

const KIND_PLURAL = { rechnung: ['Rechnung', 'Rechnungen'], korrektur: ['Gutschrift/Korrektur', 'Gutschriften/Korrekturen'], storno: ['Stornorechnung', 'Stornorechnungen'], angebot: ['Angebot', 'Angebote'], auftrag: ['Auftragsbestätigung', 'Auftragsbestätigungen'], lieferschein: ['Lieferschein', 'Lieferscheine'], proforma: ['Proformarechnung', 'Proformarechnungen'] }
const KIND_OPTIONS = [['', '– nicht übernehmen –'], ...Object.entries(TARGETS).map(([k, t]) => [k, t.label])]
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

const HOWTO = `<details class="fim-howto" open><summary>So holst du die Daten aus orgaMAX</summary>
  <div class="fim-tool"><p><strong>Empfohlen: Komplettexport.</strong> Ein kleines Werkzeug für den PC mit orgaMAX liest <em>alle</em> Daten über den ODBC-Zugang von orgaMAX (nur lesen) und packt sie mit den PDF-Belegen in eine ZIP – die ziehst du dann hier herein. Anleitung liegt bei.</p><button class="btn small" data-action="fim-tool">${ICON.download || ''} Export-Werkzeug herunterladen</button></div>
  <p class="muted">Oder einzeln:</p>
  <ol>
    <li><strong>Tabellen:</strong> in orgaMAX <em>Listen &amp; Statistiken → Tabellen-Auswertungen → Neu</em>, als Datenquelle nacheinander <em>Kunden</em>, <em>Ansprechpartner</em>, <em>Artikel</em>, <em>Vorgänge</em> (Rechnungen, Angebote, Gutschriften), <em>Vorgangspositionen</em>, <em>Zahlungen</em>, <em>Abo-Rechnungen</em>, <em>Textbausteine</em> und <em>Zahlungsbedingungen</em> wählen, alle Spalten anhaken, dann <em>Tabelle exportieren (F4)</em> → Excel. Alternativ in jeder Übersicht <em>Ansicht → Tabelle exportieren</em>.</li>
    <li><strong>E-Rechnungen</strong> (XRechnung/ZUGFeRD, XML oder PDF) bringen jede Rechnung samt Positionen mit.</li>
    <li><strong>Original-PDFs</strong> aus dem Belegarchiv: Der Dateiname muss die Belegnummer enthalten, dann hängt die App das PDF an den Beleg (Aufbewahrung 7 Jahre).</li>
    <li>Alles auf einmal hier ablegen – auch als ZIP. Nichts wird gespeichert, bevor du „Übernehmen“ drückst; eine zweite Übernahme legt nichts doppelt an.</li>
  </ol></details>`

function filesStep() {
  const list = W.files.length
    ? `<ul class="fim-files">${W.files.map((f) => `<li class="${f.error ? 'err' : ''}"><strong>${esc(f.name)}</strong> <span class="muted">${esc(f.error || f.found || '…')}</span></li>`).join('')}</ul>`
    : ''
  return {
    title: 'Aus orgaMAX übernehmen',
    subtitle: 'Kunden, Artikel, Belege, Zahlungen, Textbausteine und mehr',
    body: `${HOWTO}
      <label class="fim-drop" data-drop="fim"><input type="file" id="fim-file" multiple accept=".xlsx,.xlsm,.xls,.csv,.txt,.tsv,.xml,.pdf,.zip" data-change="fim-files"><span>${ICON.download || ''}<strong>Dateien wählen</strong> oder hierher ziehen</span><small class="muted">Excel, CSV, XML, PDF oder ZIP – mehrere auf einmal</small></label>
      ${W.busy ? `<p class="muted">${esc(W.progress || 'Lese Dateien …')}</p>${list}` : list}`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions">${W.files.length ? '<button class="btn" data-action="fim-reset">Neu beginnen</button>' : ''}<button class="btn primary" data-action="fim-to-map" ${W.tables.length || W.eInvoices.length ? '' : 'disabled'}>Weiter: Zuordnung prüfen</button></div>`,
  }
}

function sample(t, i) {
  const vals = t.table.rows.map((r) => r[i]).filter((v) => v !== '' && v != null).slice(0, 2)
  return vals.map((v) => esc(v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 40))).join(' · ')
}

function mapStep() {
  const shown = W.tables.filter((t) => !t.db || t.kind)
  const hidden = W.tables.filter((t) => t.db && !t.kind)
  const cards = shown
    .map((t) => {
      const fields = t.kind ? Object.entries(TARGETS[t.kind].fields) : []
      const open = W.open === t.id
      const mapped = Object.keys(t.map).length
      return `<section class="fim-card ${t.kind ? '' : 'off'}">
        <header><div><strong>${esc(t.table.name || 'Tabelle')}</strong> <span class="muted">${plural(t.table.rows.length, 'Zeile', 'Zeilen')} · ${t.table.columns.length} Spalten</span></div>
          <label class="field inline"><span>Art</span><select data-change="fim-kind" data-id="${t.id}">${options(KIND_OPTIONS, t.kind)}</select></label></header>
        ${t.kind ? `<p class="muted">${plural(mapped, 'Spalte', 'Spalten')} zugeordnet${t.table.columns.length - mapped ? `, ${t.table.columns.length - mapped} weitere ${t.kind === 'customers' || t.kind === 'articles' || t.kind === 'documents' ? 'bleiben als „weitere Felder“ erhalten' : 'werden nicht gebraucht'}` : ''}. <button class="link-btn" data-action="fim-open" data-id="${t.id}">${open ? 'Zuordnung schließen' : 'Zuordnung ansehen'}</button></p>` : '<p class="muted">Wird nicht übernommen.</p>'}
        ${open && t.kind ? `<div class="table-wrap"><table class="data fim-map"><thead><tr><th>Feld in der App</th><th>Spalte aus der Datei</th><th>Beispiel</th></tr></thead><tbody>${fields
          .map(([f, [label]]) => {
            const i = t.map[f]
            return `<tr><td>${esc(label)}</td><td><select data-change="fim-col" data-id="${t.id}" data-field="${f}">${options([['', '–'], ...t.table.columns.map((c, k) => [String(k), c])], i == null ? '' : String(i))}</select></td><td class="muted">${i == null ? '' : sample(t, i)}</td></tr>`
          })
          .join('')}</tbody></table></div>` : ''}
      </section>`
    })
    .join('')
  const rest = hidden.length
    ? `<details class="fim-card fim-rest"><summary>${plural(hidden.length, 'weitere Tabelle', 'weitere Tabellen')} aus der Datenbank – werden nicht übernommen</summary><div class="fim-rest-list">${hidden
        .map((t) => `<label class="field inline"><span>${esc(t.table.name)} <small class="muted">${t.table.rows.length}</small></span><select data-change="fim-kind" data-id="${t.id}">${options(KIND_OPTIONS, t.kind)}</select></label>`)
        .join('')}</div></details>`
    : ''
  const einv = W.eInvoices.length ? `<section class="fim-card"><header><div><strong>E-Rechnungen</strong> <span class="muted">${W.eInvoices.length} Belege mit Positionen</span></div></header><p class="muted">${esc(W.eInvoices.slice(0, 8).map((e) => e.invoice.number).join(', '))}${W.eInvoices.length > 8 ? ' …' : ''}</p></section>` : ''
  const pdfs = W.pdfs.length ? `<section class="fim-card"><header><div><strong>PDF-Belege</strong> <span class="muted">${W.pdfs.length} Dateien</span></div></header><p class="muted">Werden beim nächsten Schritt den Belegen mit passender Nummer zugeordnet.</p></section>` : ''
  return {
    title: 'Zuordnung prüfen',
    subtitle: 'Art jeder Tabelle und welche Spalte wohin gehört',
    body: `${W.dumpInfo ? `<p class="note">Komplettexport vom ${esc(String(W.dumpInfo.created || '').slice(0, 10).split('-').reverse().join('.'))}: ${W.dumpInfo.tables} Tabellen, ${W.dumpInfo.rows.toLocaleString('de-AT')} Zeilen.${W.dumpInfo.unreadable ? ` <strong>${W.dumpInfo.unreadable} Tabellen waren nicht lesbar</strong> – in orgaMAX beim ODBC-Zugang den erweiterten Zugriff wählen und neu exportieren.` : ''}</p>` : ''}${cards}${rest}${einv}${pdfs}`,
    foot: `<button class="btn" data-action="fim-step" data-step="files">Zurück</button><div class="actions"><button class="btn primary" data-action="fim-check">Weiter: Ergebnis prüfen</button></div>`,
  }
}

function checkStep() {
  const r = W.preview.report
  const res = W.result
  const row = (label, x, extra = '') => `<tr><td>${label}</td><td class="num">${x?.added ?? 0}</td><td class="num">${(x?.updated ?? 0) + (x?.attached ?? 0)}</td><td class="num">${(x?.same ?? 0) + (x?.skipped ?? 0)}</td><td class="muted">${extra}</td></tr>`
  const notes = [...(r.conflicts || []), ...res.warnings, ...(W.purchasePreview?.warnings || []), ...(W.purchasePreview?.skipped || []).filter((x) => !/schon/.test(x.reason)).map((x) => `${x.type === 'kasse' ? 'Kassenbuch' : x.type === 'rechnung' ? 'Eingangsrechnung' : 'Lieferant'} ${x.ref}: ${x.reason}`)]
  if (W.purchaseAny && !W.purchaseAllowed) notes.unshift('Lieferanten, Eingangsrechnungen und Kassenbuch werden nicht übernommen: dafür fehlt das Recht auf „Einkauf & Kasse“.')
  const kindCount = (k) => res.documents.filter((d) => d.kind === k).length
  const docInfo = Object.entries(KIND_PLURAL).map(([k, [one, many]]) => (kindCount(k) ? plural(kindCount(k), one, many) : '')).filter(Boolean).join(', ')
  const s = settingsOf(F())
  const year = todayISO().slice(0, 4)
  const numbering = Object.entries(W.numbering)
    .map(([kind, n]) => {
      const sample = formatNumber(n.template, { prefix: s.series[kind], year, n: n.next, digits: n.digits })
      return `<label class="check"><input type="checkbox" data-change="fim-take" data-kind="${kind}" ${W.take[kind] ? 'checked' : ''}><span><strong>${esc(KINDS[kind])}:</strong> weiterzählen wie in orgaMAX – letzte ${esc(n.last)}, nächste <strong>${esc(sample)}</strong>${n.yearly ? ' (jedes Jahr neu)' : ' (durchlaufend)'}</span></label>`
    })
    .join('')
  const open = res.documents.filter((d) => d.kind === 'rechnung' && !(d.payments || []).length).length
  return {
    title: 'Ergebnis prüfen',
    subtitle: 'Noch ist nichts gespeichert',
    body: `<div class="table-wrap"><table class="data"><thead><tr><th>Bereich</th><th class="num">neu</th><th class="num">ergänzt</th><th class="num">schon da</th><th></th></tr></thead><tbody>
        ${row('Kunden', r.customers, res.customers.reduce((n, c) => n + (c.contacts?.length || 0), 0) ? `${res.customers.reduce((n, c) => n + (c.contacts?.length || 0), 0)} Ansprechpartner` : '')}
        ${row('Artikel', r.articles)}
        ${row('Belege', r.documents, docInfo + (open ? ` · ${open} offene Rechnungen kommen in die offenen Posten` : ''))}
        ${row('Textbausteine', r.textBlocks)}
        ${row('Zahlungsbedingungen', r.paymentTerms)}
        ${row('Abo-Rechnungen', r.recurring, r.recurring?.added ? 'als Daueraufträge; Start ab der nächsten fälligen Rechnung' : '')}
        ${W.purchasePreview ? (() => {
          const pp = W.purchasePreview
          const skip = (type) => pp.skipped.filter((x) => x.type === type).length
          return `${row('Lieferanten (Einkauf)', { added: pp.added.suppliers, updated: pp.updated.suppliers, skipped: skip('lieferant') })}${row('Eingangsrechnungen', { added: pp.added.invoices, skipped: skip('rechnung') })}${row('Kassenbuch', { added: pp.added.cash, skipped: skip('kasse') }, pp.added.cash ? 'fortlaufend nach dem letzten Eintrag' : '')}`
        })() : ''}
      </tbody></table></div>
      ${W.uploads.length ? (app.store?.kind === 'sharepoint' ? `<p>${plural(W.uploads.length, 'Original-PDF wird', 'Original-PDFs werden')} an die Belege gehängt und in SharePoint abgelegt.</p>` : `<p class="muted">${plural(W.uploads.length, 'Original-PDF passt', 'Original-PDFs passen')} zu Belegen – ablegen geht nur im Betrieb mit SharePoint.</p>`) : ''}
      ${W.unmatched?.length ? `<p class="muted">${plural(W.unmatched.length, 'PDF ohne', 'PDFs ohne')} passende Belegnummer: ${esc(W.unmatched.slice(0, 6).join(', '))}${W.unmatched.length > 6 ? ' …' : ''}</p>` : ''}
      ${res.skipped.lieferscheine ? `<p class="muted">${plural(res.skipped.lieferscheine, 'sonstiger Beleg', 'sonstige Belege')} (z. B. Mahnung, Bestellung) nicht übernommen.</p>` : ''}
      ${res.skipped.lieferanten ? `<p class="muted">${plural(res.skipped.lieferanten, 'Lieferant', 'Lieferanten')} aus der Kundentabelle ${W.purchaseAllowed ? 'kommen in den Einkauf, nicht zu den Kunden' : 'nicht als Kunde übernommen'}.</p>` : ''}
      ${numbering ? `<h3>Nummernkreise</h3><div class="fim-numbering">${numbering}</div>` : ''}
      ${notes.length ? `<details class="fim-notes" ${notes.length <= 5 ? 'open' : ''}><summary>${plural(notes.length, 'Hinweis', 'Hinweise')}</summary><ul>${notes.slice(0, 60).map((x) => `<li>${esc(x)}</li>`).join('')}${notes.length > 60 ? `<li>… und ${notes.length - 60} weitere</li>` : ''}</ul></details>` : '<p><span class="pill ok">Keine Auffälligkeiten</span></p>'}
      <p class="note">Altbelege werden so übernommen, wie sie in orgaMAX stehen (Nummer, Datum, Summen), und sind festgeschrieben. Vorhandene Daten in der App werden nur ergänzt, nie überschrieben.</p>`,
    foot: `<button class="btn" data-action="fim-step" data-step="map">Zurück</button><div class="actions"><button class="btn primary" data-action="fim-apply" ${W.busy ? 'disabled' : ''}>${W.busy ? 'Übernehme …' : 'Übernehmen'}</button></div>`,
  }
}

function doneStep() {
  const r = W.preview.report
  return {
    title: 'Übernommen',
    subtitle: 'Die Daten stehen jetzt in der Fakturierung',
    body: `<p><span class="pill ok">Fertig</span> ${W.purchaseReport ? `${plural(W.purchaseReport.added.suppliers, 'Lieferant', 'Lieferanten')}, ${plural(W.purchaseReport.added.invoices, 'Eingangsrechnung', 'Eingangsrechnungen')}, ${plural(W.purchaseReport.added.cash, 'Kassenbuchung', 'Kassenbuchungen')}, ` : ''}${plural(r.customers.added + r.customers.updated, 'Kunde', 'Kunden')}, ${plural(r.articles.added + r.articles.updated, 'Artikel', 'Artikel')}, ${plural(r.documents.added, 'Beleg', 'Belege')}, ${plural(r.textBlocks.added, 'Textbaustein', 'Textbausteine')}, ${plural(r.paymentTerms.added, 'Zahlungsbedingung', 'Zahlungsbedingungen')}, ${plural(r.recurring.added, 'Abo', 'Abos')}${W.uploaded ? `, ${plural(W.uploaded, 'Original-PDF', 'Original-PDFs')}` : ''}.</p>
      <p>Prüfe stichprobenartig ein paar Rechnungen und die offenen Posten. Fehlt etwas, einfach weitere Dateien übernehmen – Vorhandenes wird nicht doppelt angelegt.</p>`,
    foot: `<button class="btn" data-action="fim-reset">Weitere Dateien übernehmen</button><div class="actions"><button class="btn primary" data-action="close-modal">Schließen</button></div>`,
  }
}

registerModal(
  'fak-import',
  () => {
    if (!W) reset()
    const step = { files: filesStep, map: mapStep, check: checkStep, done: doneStep }[W.step]()
    return modalFrame({ ...step, wide: true })
  },
  { module: MODULE },
)

async function takeFiles(list) {
  if (!list?.length) return
  W.busy = true
  renderModal()
  for (const f of list) await readFile(f.name, new Uint8Array(await f.arrayBuffer()))
  W.busy = false
  renderModal()
}

registerActions({
  'fak-import-open': () => {
    if (!editable()) return toast('Übernehmen darf nur, wer die Fakturierung bearbeiten darf.')
    if (!W || W.step === 'done') reset()
    openModal({ type: 'fak-import' })
  },
  'fim-files': (el) => takeFiles([...(el.files || [])]),
  'fim-tool': () => downloadTool().catch((err) => toast(`Download nicht möglich: ${err.message}`)),
  'fim-reset': () => {
    reset()
    renderModal()
  },
  'fim-step': (el) => {
    W.step = el.dataset.step
    renderModal()
  },
  'fim-to-map': () => {
    W.step = 'map'
    renderModal()
  },
  'fim-kind': (el) => {
    const t = W.tables.find((x) => x.id === el.dataset.id)
    t.kind = el.value
    t.map = t.kind ? matchColumns(t.kind, t.table.columns) : {}
    renderModal()
  },
  'fim-col': (el) => {
    const t = W.tables.find((x) => x.id === el.dataset.id)
    const f = el.dataset.field
    // eine Spalte nur einem Feld
    for (const [k, v] of Object.entries(t.map)) if (String(v) === el.value) delete t.map[k]
    if (el.value === '') delete t.map[f]
    else t.map[f] = Number(el.value)
    renderModal()
  },
  'fim-open': (el) => {
    W.open = W.open === el.dataset.id ? null : el.dataset.id
    renderModal()
  },
  'fim-check': () => {
    try {
      analyse()
    } catch (err) {
      toast(`Prüfen nicht möglich: ${err.message}`)
    }
    renderModal()
  },
  'fim-take': (el) => {
    W.take[el.dataset.kind] = el.checked
  },
  'fim-apply': () => apply().catch((err) => {
    W.busy = false
    toast(`Übernahme fehlgeschlagen: ${err.message}`)
    renderModal()
  }),
}, { edit: MODULE })

// Ziehen und Ablegen auf die Fläche im Dialog
if (typeof document !== 'undefined') {
  document.addEventListener('dragover', (e) => {
    if (e.target.closest?.('[data-drop="fim"]')) e.preventDefault()
  })
  document.addEventListener('drop', (e) => {
    if (!e.target.closest?.('[data-drop="fim"]')) return
    e.preventDefault()
    takeFiles([...(e.dataTransfer?.files || [])])
  })
}

export const importButton = () => (editable() ? `<button class="btn small" data-action="fak-import-open">${ICON.download || ''} Aus orgaMAX übernehmen</button>` : '')
