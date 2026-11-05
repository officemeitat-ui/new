// Fakturierung → Einstellungen → „Briefpapier“ (wie der Briefpapier-Designer in orgaMAX, nur einfacher): eigenes
// Briefpapier als Bild für die erste Seite und die Folgeseiten, Ränder, damit der Text nicht in Kopf und Fuß läuft
// (Vorschau mit dem Textbereich auf dem Bild), Logo/Absender/Fußzeile der App ausblenden, eigene Fußzeile in bis zu
// 4 Spalten, Akzentfarbe, Schrift; Vorschau als PDF (zweiseitige Musterrechnung).
// Gilt für alle PDFs der Fakturierung: export/letterhead.js → pageSetup(settings). Vor einem PDF lädt
// loadLetterhead() die Bilder (SharePoint: fakturierung/briefpapier/…, im Browser-Modus nur in diesem Browser;
// Zwischenspeicher im Gerät, IndexedDB „cleanos-briefpapier“).
//
// Ein PDF als Briefpapier geht nicht: pdfmake kann keine PDF-Seiten einbetten (nur PNG, JPEG, SVG), und eine
// Bibliothek, die PDFs im Browser in Bilder umwandelt (pdf.js), wäre für diesen Zweck zu groß. Der Dialog erklärt,
// wie aus der PDF-Vorlage ein Bild wird.

import { settingsOf } from '../../core/invoicing.js'
import { invoiceDocument } from '../../export/invoice-pdf.js'
import { A4, checkLetterheadImage, DEFAULT_MARGINS_MM, FONT_SIZES, FOOTER_COLUMNS, footerNeedMm, LETTERHEAD_FONTS, letterheadActive, letterheadImages, letterheadKey, letterheadOf, letterheadPath, marginProblems, NEXT_MODES, setLetterheadImages, suggestFooter } from '../../export/letterhead.js'
import { createOfflineCache } from '../../storage/offline.js'
import { app, canEdit, closeModal, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, download, esc, ICON, modalFrame, options, val } from '../shared.js'

const MODULE = 'fakturierung'
const F = () => (app.data.fakturierung ||= { settings: {} })
const editable = () => canEdit(MODULE) && !app.readOnly
const MAX_WIDTH = 1654 // 200 dpi auf A4: scharf im Druck, PDF bleibt klein
const mmText = (v) => String(v ?? '').replace('.', ',')
const kb = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`)

// ---------------------------------------------------------------- Bilder laden (für jedes PDF der Fakturierung)

let cache = null
const deviceCache = () => (cache ||= createOfflineCache('cleanos-briefpapier'))
const blobToDataUrl = (blob) => new Promise((resolve, reject) => Object.assign(new FileReader(), { onload: (e) => resolve(e.target.result), onerror: () => reject(new Error('Bild nicht lesbar')) }).readAsDataURL(blob))
const dataUrlToBlob = (url) => {
  const [head, body] = String(url).split(',')
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: head.match(/data:([^;]+)/)?.[1] || 'image/jpeg' })
}

/** Bild als data-URL: aus dem Gerät, sonst aus SharePoint (dann im Gerät gemerkt). */
async function imageData(meta) {
  if (!meta?.path) return null
  const hit = await deviceCache().get('docs', meta.path)
  if (hit?.dataUrl && hit.at === meta.at) return hit.dataUrl
  if (app.store?.kind !== 'sharepoint' || !app.store.readBlob) return null
  const blob = await app.store.readBlob(meta.path)
  if (!blob) return null
  const dataUrl = await blobToDataUrl(blob)
  await deviceCache().put('docs', meta.path, { dataUrl, at: meta.at })
  return dataUrl
}

let pending = null
let warned = ''
let retry = { key: '', at: 0 } // nach einem Netzfehler erst nach einer Minute wieder versuchen
/**
 * Bilder des Briefpapiers bereitlegen (export/letterhead.js → setLetterheadImages). Vor jedem PDF der Fakturierung
 * abwarten; ohne Briefpapier oder schon geladen kehrt es sofort zurück. Fehlt ein Bild, einmal ein Hinweis.
 */
export async function loadLetterhead() {
  const lh = letterheadOf(F().settings)
  const key = letterheadKey(lh)
  if (letterheadImages().key === key) return letterheadImages()
  if (pending?.key === key) return pending.promise
  if (retry.key === key && Date.now() < retry.at) return letterheadImages()
  const promise = (async () => {
    let failed = false
    const get = (meta) => imageData(meta).catch(() => ((failed = true), null))
    const [first, next] = await Promise.all([get(lh.first), lh.nextMode === 'own' ? get(lh.next) : null])
    if (letterheadKey(letterheadOf(F().settings)) !== key) return letterheadImages() // inzwischen geändert
    if (failed) {
      // ohne Netz bzw. Fehler beim Laden: kein Briefpapier, später neu versuchen
      retry = { key, at: Date.now() + 60e3 }
      if (warned !== key) toast('Briefpapier gerade nicht erreichbar. Das PDF entsteht ohne Briefpapier.')
      warned = key
      return letterheadImages()
    }
    setLetterheadImages({ key, first, next })
    if ((lh.first && !first) || (lh.nextMode === 'own' && lh.next && !next)) {
      if (warned !== key) toast(app.store?.kind === 'sharepoint' ? 'Briefpapier nicht gefunden (fakturierung/briefpapier/). Das PDF entsteht ohne Briefpapier.' : 'Das Briefpapier liegt nur im Browser, in dem es hochgeladen wurde. Das PDF entsteht ohne Briefpapier.')
      warned = key
    }
    return letterheadImages()
  })().finally(() => (pending = null))
  pending = { key, promise }
  return promise
}

/** Bild aus einer Datei: prüfen, auf höchstens 200 dpi verkleinern, als PNG (klein) oder JPEG. */
async function readImage(file) {
  const first = checkLetterheadImage({ type: file.type, name: file.name })
  if (first.error === 'pdf' || first.error === 'type') return { error: first.error }
  let bmp
  try {
    bmp = await createImageBitmap(file)
  } catch {
    return { error: 'type' }
  }
  const check = checkLetterheadImage({ type: file.type, name: file.name, width: bmp.width, height: bmp.height })
  const scale = Math.min(1, MAX_WIDTH / bmp.width)
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  const g = c.getContext('2d')
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(bmp, 0, 0, c.width, c.height)
  let type = 'image/jpeg'
  let dataUrl = c.toDataURL('image/jpeg', 0.9)
  if (/png/i.test(file.type)) {
    const asPng = c.toDataURL('image/png')
    // PNG nur, wenn klein: das Briefpapier steckt in jedem PDF und geht mit jeder E-Mail mit
    if (asPng.length < 9e5) [type, dataUrl] = ['image/png', asPng]
  }
  return { dataUrl, type, width: c.width, height: c.height, name: file.name, size: Math.round((dataUrl.length * 3) / 4), warnings: check.warnings }
}

// ---------------------------------------------------------------- Abschnitt in den Einstellungen

/** Abschnitt „Briefpapier“ im Reiter Einstellungen: Stand und Knopf zum Dialog. */
export function letterheadSection() {
  const lh = letterheadOf(F().settings)
  const parts = [
    lh.first ? `eigenes Briefpapier (${esc(lh.first.name || 'Bild')})` : 'ohne eigenes Briefpapier',
    lh.first ? `Folgeseiten ${esc(lh.nextMode === 'own' ? `mit eigenem Bild (${lh.next?.name || 'fehlt'})` : NEXT_MODES[lh.nextMode])}` : '',
    lh.custom ? `Ränder oben ${mmText(lh.margins.top)}/${mmText(lh.margins.topNext)} mm, unten ${mmText(lh.margins.bottom)} mm` : '',
    [lh.hideLogo && 'Logo', lh.hideSender && 'Absender', lh.hideReturnLine && 'Absenderzeile', lh.hideFooter && 'Fußzeile'].filter(Boolean).join(', ') ? `ausgeblendet: ${[lh.hideLogo && 'Logo', lh.hideSender && 'Absender', lh.hideReturnLine && 'Absenderzeile', lh.hideFooter && 'Fußzeile'].filter(Boolean).join(', ')}` : '',
    lh.footer.some(Boolean) ? 'eigene Fußzeile' : '',
  ].filter(Boolean)
  return `<h3>Briefpapier</h3>
    <div class="fak-lh-summary"><p>${parts.join(' · ')}.${letterheadActive(F().settings) ? '' : ' Logo, Absender und Fußzeile kommen aus den Angaben oben.'}</p>
      <button class="btn" data-action="fak-lh-open">${ICON.palette} Briefpapier ${editable() ? 'einrichten' : 'ansehen'}</button></div>
    <p class="muted">Gilt für alle PDFs der Fakturierung: Rechnungen, Angebote, Mahnungen und Briefe.</p>`
}

// ---------------------------------------------------------------- Dialog

const PDF_HELP = `<div class="banner warn-banner fak-lh-pdf" role="alert"><p><strong>Ein PDF geht als Briefpapier nicht direkt.</strong> Die App erzeugt die PDFs mit pdfmake, und pdfmake kann keine PDF-Seiten einbetten, nur Bilder. So wird aus der PDF-Vorlage ein Bild (A4 hoch, 150 bis 200 dpi):</p>
  <ul><li><strong>Adobe Acrobat (Pro):</strong> Datei → Exportieren in → Bild → PNG; Auflösung 150 oder 200 Pixel/Zoll.</li>
  <li><strong>Windows ohne Acrobat:</strong> mit dem kostenlosen PDF24 Creator „PDF in Bilder konvertieren“ (PNG, 200 dpi); läuft am PC, ohne Hochladen ins Internet.</li>
  <li><strong>Mac:</strong> PDF in „Vorschau“ öffnen → Ablage → Exportieren → Format PNG, Auflösung 200.</li>
  <li><strong>Grafik bzw. Druckerei:</strong> um je ein PNG für die erste Seite und die Folgeseiten bitten.</li></ul>
  <p>Bei einer mehrseitigen Vorlage: Seite 1 für die erste Seite, Seite 2 für die Folgeseiten.</p></div>`

const IMAGE_ERRORS = { type: 'Bitte ein Bild als PNG oder JPG wählen.', size: 'Das Bild ist leer oder beschädigt.' }

/** Stand im Dialog: Entwurf der Einstellungen und neu gewählte Bilder (pending; null = entfernen). */
function draftOf(m) {
  m.draft ||= structuredClone(F().settings?.letterhead || {})
  m.pending ||= {}
  m.images ||= { ...letterheadImages() }
  return m.draft
}

/** Bild (data-URL) für erste Seite bzw. Folgeseiten im Dialog: neu gewählt, sonst das gespeicherte. */
function shownImage(m, which) {
  if (m.pending[which] === null) return null
  if (m.pending[which]) return m.pending[which].dataUrl
  const lh = letterheadOf(F().settings)
  return lh[which] && m.images.key === letterheadKey(lh) ? m.images[which] : null
}

const imageMeta = (m, which) => (m.pending[which] === null ? null : m.pending[which] ? { path: `vorschau-${which}`, at: 'neu', name: m.pending[which].name, width: m.pending[which].width, height: m.pending[which].height, size: m.pending[which].size } : letterheadOf(F().settings)[which])

function imageBlock(m, which, dis) {
  const meta = imageMeta(m, which)
  const url = shownImage(m, which)
  const label = which === 'first' ? 'Erste Seite' : 'Folgeseiten'
  const warn = m.pending[which]?.warnings || []
  return `<div class="fak-lh-image">
      <div class="fak-lh-thumb">${url ? `<img src="${esc(url)}" alt="Briefpapier ${label}">` : `<span class="muted">${meta ? 'Bild nicht geladen' : 'kein Bild'}</span>`}</div>
      <div class="fak-lh-file"><strong>${label}</strong><br>${meta ? `<span class="muted">${esc(meta.name || '')}${meta.width ? ` · ${meta.width} × ${meta.height} Pixel` : ''}${meta.size ? ` · ${kb(meta.size)}` : ''}</span>` : '<span class="muted">noch keines</span>'}
        ${warn.map((w) => `<p class="warn-text">${esc(w)}</p>`).join('')}
        ${dis ? '' : `<div class="actions"><label class="btn small">${ICON.upload} Bild wählen<input type="file" id="flh-file-${which}" accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf" data-change="fak-lh-file" data-which="${which}" hidden></label>${meta ? `<button class="btn small ghost" data-action="fak-lh-remove" data-which="${which}">${ICON.trash} entfernen</button>` : ''}</div>`}</div>
    </div>`
}

/** Bild mit dem Textbereich (gestrichelt) und der Fußzeile: so liegt der Text auf dem Briefpapier. */
function sheetPreview(m, which, lh) {
  const url = which === 'first' ? shownImage(m, 'first') : lh.nextMode === 'none' ? null : lh.nextMode === 'own' ? shownImage(m, 'next') : shownImage(m, 'first')
  const mg = lh.margins
  const top = which === 'first' ? Math.max(mg.top, mg.topNext) : mg.topNext
  const pct = (v, total) => `${((v / total) * 100).toFixed(2)}%`
  return `<figure class="fak-lh-sheet-wrap"><div class="fak-lh-sheet" id="flh-sheet-${which}" ${url ? `style="background-image:url('${esc(url)}')"` : ''}>
      <div class="fak-lh-area" style="left:${pct(mg.left, A4.widthMm)};right:${pct(mg.right, A4.widthMm)};top:${pct(top, A4.heightMm)};bottom:${pct(mg.bottom, A4.heightMm)}"><span>Text</span></div>
      <div class="fak-lh-foot" style="left:${pct(mg.left, A4.widthMm)};right:${pct(mg.right, A4.widthMm)};bottom:${pct(Math.max(0, mg.bottom - footerNeedMm(lh)), A4.heightMm)};height:${pct(footerNeedMm(lh), A4.heightMm)}"></div>
    </div><figcaption>${which === 'first' ? 'erste Seite' : 'Folgeseiten'}</figcaption></figure>`
}

/** Eingaben des Dialogs in den Entwurf. */
function readDialog(m) {
  const v = draftOf(m)
  if (!document.getElementById('flh-top')) return v
  const mm = (id) => {
    const raw = val(id).trim().replace(',', '.')
    return raw === '' ? '' : Number(raw)
  }
  v.margins = { top: mm('flh-top'), topNext: mm('flh-topnext'), bottom: mm('flh-bottom'), left: mm('flh-left'), right: mm('flh-right') }
  for (const k of Object.keys(v.margins)) if (v.margins[k] === '' || !Number.isFinite(v.margins[k])) delete v.margins[k]
  if (!Object.keys(v.margins).length) delete v.margins
  v.nextMode = val('flh-next-mode') || 'same'
  for (const k of ['hideLogo', 'hideSender', 'hideReturnLine', 'hideFooter']) v[k] = checked(`flh-${k}`)
  v.pageNumbers = checked('flh-pagenumbers')
  v.footer = Array.from({ length: FOOTER_COLUMNS }, (_, i) => val(`flh-foot-${i}`).trim())
  const accent = val('flh-accent-text').trim()
  v.accent = checked('flh-accent-on') && /^#[0-9a-f]{6}$/i.test(accent) ? accent : ''
  v.font = val('flh-font') || 'Roboto'
  v.fontSize = Number(val('flh-size')) || 9
  return v
}

/** Einstellungen mit dem Entwurf (für Vorschau und Prüfungen): Bilder als Platzhalter-Angaben. */
function draftSettings(m) {
  const v = draftOf(m)
  return { ...F().settings, letterhead: { ...v, first: imageMeta(m, 'first'), next: imageMeta(m, 'next') } }
}

function letterheadModal(c, m) {
  const v = draftOf(m)
  const lh = letterheadOf(draftSettings(m))
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const mg = { ...DEFAULT_MARGINS_MM, ...(v.margins || {}) }
  const s = settingsOf(F())
  const problems = marginProblems(lh)
  const field = (id, label, value) => `<label class="field"><span>${label}</span><input type="text" inputmode="decimal" id="${id}" value="${esc(mmText(value))}" data-input="fak-lh-preview" ${dis}></label>`
  return modalFrame({
    title: 'Briefpapier',
    subtitle: 'für Rechnungen, Angebote, Mahnungen und Briefe',
    wide: true,
    body: `${m.pdfHelp ? PDF_HELP : ''}
      <div class="fak-lh-grid">
        <div>
          <h3>Bild des Briefpapiers</h3>
          <p class="muted">PNG oder JPG, A4 hoch (210 × 297 mm), am besten 150 bis 200 dpi. Ein PDF geht nicht direkt, <button class="link-btn" data-action="fak-lh-pdfhelp">so wird ein Bild daraus</button>.</p>
          ${imageBlock(m, 'first', dis)}
          <label class="field"><span>Folgeseiten</span><select id="flh-next-mode" data-change="fak-lh-mode" ${dis}>${options(Object.entries(NEXT_MODES), lh.nextMode)}</select></label>
          ${lh.nextMode === 'own' ? imageBlock(m, 'next', dis) : ''}
          <h3>Ränder (mm)</h3>
          <p class="muted">So weit bleibt der Text vom Rand weg, damit er nicht in Kopf und Fuß des Briefpapiers läuft: oben unter dem Kopf mit Logo, unten über dem Fuß (dort steht die Fußzeile). Die gestrichelte Fläche zeigt den Textbereich.</p>
          <div class="form-grid fak-lh-margins">
            ${field('flh-top', 'Oben, erste Seite', mg.top)}
            ${field('flh-topnext', 'Oben, Folgeseiten', mg.topNext ?? mg.top)}
            ${field('flh-bottom', 'Unten', mg.bottom)}
            ${field('flh-left', 'Links', mg.left)}
            ${field('flh-right', 'Rechts', mg.right)}
          </div>
          <div id="flh-problems">${problemsHtml(problems)}</div>
        </div>
        <div class="fak-lh-side" id="flh-sheets">${sheetPreview(m, 'first', lh)}${sheetPreview(m, 'next', lh)}</div>
      </div>
      <h3>Was das Briefpapier schon enthält</h3>
      <div class="check-grid">
        <label class="check"><input type="checkbox" id="flh-hideLogo" ${lh.hideLogo ? 'checked' : ''} ${dis}><span>Logo der App weglassen</span></label>
        <label class="check"><input type="checkbox" id="flh-hideSender" ${lh.hideSender ? 'checked' : ''} ${dis}><span>Absender oben rechts weglassen</span></label>
        <label class="check"><input type="checkbox" id="flh-hideReturnLine" ${lh.hideReturnLine ? 'checked' : ''} ${dis}><span>Absenderzeile über der Anschrift weglassen</span></label>
        <label class="check"><input type="checkbox" id="flh-hideFooter" data-change="fak-lh-preview" ${lh.hideFooter ? 'checked' : ''} ${dis}><span>Fußzeile der App weglassen</span></label>
      </div>
      <h3>Fußzeile</h3>
      <p class="muted">Bis zu 4 Spalten, mehrzeilig. Leer: die Fußzeile der App (Firma, Anschrift, UID, Bank). Gilt nicht, wenn die Fußzeile oben ausgeblendet ist.</p>
      <div class="form-grid fak-lh-footer">${Array.from({ length: FOOTER_COLUMNS }, (_, i) => `<label class="field"><span>Spalte ${i + 1}</span><textarea id="flh-foot-${i}" rows="4" data-input="fak-lh-preview" ${dis}>${esc(lh.footer[i] || '')}</textarea></label>`).join('')}</div>
      <div class="filters">${ed ? '<button class="btn small" data-action="fak-lh-suggest">Aus den Firmendaten vorschlagen</button>' : ''}<label class="check"><input type="checkbox" id="flh-pagenumbers" ${lh.pageNumbers ? 'checked' : ''} ${dis}><span>Seitenzahl („Seite 1 von 2“)</span></label></div>
      <h3>Farbe und Schrift</h3>
      <div class="form-grid">
        <div class="field"><span>Akzentfarbe (Titel, Tabellenkopf, Linien)</span><div class="fak-lh-color"><label class="check"><input type="checkbox" id="flh-accent-on" ${lh.accent ? 'checked' : ''} ${dis}><span>eigene</span></label><input type="color" id="flh-accent" value="${esc(lh.accent || app.config?.brand?.colors?.primary || '#1f3a5f')}" data-input="fak-lh-color" aria-label="Akzentfarbe wählen" ${dis}><input type="text" id="flh-accent-text" value="${esc(lh.accent || app.config?.brand?.colors?.primary || '#1f3a5f')}" maxlength="7" data-input="fak-lh-color" aria-label="Akzentfarbe als Hex-Wert" ${dis}></div><small class="muted">Zu helle Farben dunkelt die App für die Lesbarkeit ab (Kontrast mindestens 4,5 : 1).</small></div>
        <label class="field"><span>Schrift</span><select id="flh-font" ${dis}>${options(Object.entries(LETTERHEAD_FONTS), lh.font)}</select><small class="muted">pdfmake bringt nur Roboto mit (mit č, ć, ş …); andere Schriften müssten mit der App ausgeliefert werden.</small></label>
        <label class="field"><span>Schriftgröße Text (pt)</span><select id="flh-size" ${dis}>${options(FONT_SIZES.map((n) => [String(n), mmText(n)]), String(lh.fontSize))}</select></label>
      </div>
      <p class="note">Ränder und Fußzeile gelten auch ohne Bild. ${app.store?.kind === 'sharepoint' ? 'Die Bilder liegen in SharePoint unter fakturierung/briefpapier/.' : 'Im Browser-Modus liegen die Bilder nur in diesem Browser.'} Vor dem Speichern mit „Vorschau (PDF)“ prüfen: eine Musterrechnung über zwei Seiten.${s.sender.name ? '' : ' Tipp: zuerst den Absender eintragen.'}</p>`,
    foot: `<div class="actions">${ed && letterheadActive(F().settings) ? `<button class="btn danger" data-action="fak-lh-reset">${app.ui.confirm === 'fak-lh-reset' ? 'Wirklich alles zurücksetzen?' : 'Zurücksetzen'}</button>` : ''}</div><div class="actions"><button class="btn" data-action="close-modal">Schließen</button><button class="btn" data-action="fak-lh-pdf">${ICON.download} Vorschau (PDF)</button>${ed ? '<button class="btn primary" data-action="fak-lh-save">Speichern</button>' : ''}</div>`,
  })
}
registerModal('fak-letterhead', letterheadModal, { module: MODULE })

const problemsHtml = (list) => (list.length ? `<ul class="fak-problems">${list.map((p) => `<li class="warn-text">${esc(p)}</li>`).join('')}</ul>` : '')

/** Vorschau und Hinweise neu zeichnen, ohne die Eingaben anzufassen. */
function refreshPreview(m) {
  readDialog(m)
  const lh = letterheadOf(draftSettings(m))
  const box = document.getElementById('flh-sheets')
  if (box) box.innerHTML = `${sheetPreview(m, 'first', lh)}${sheetPreview(m, 'next', lh)}`
  const p = document.getElementById('flh-problems')
  if (p) p.innerHTML = problemsHtml(marginProblems(lh))
}

/** Musterrechnung über zwei Seiten mit dem Briefpapier aus dem Dialog (noch nicht gespeichert). */
function sampleInvoice() {
  const today = new Date().toISOString().slice(0, 10)
  const lines = Array.from({ length: 34 }, (_, i) => ({ id: `m${i}`, text: i % 3 ? `Unterhaltsreinigung Stiege ${i + 1} lt. Leistungsverzeichnis` : `Glasreinigung Stiegenhaus ${i + 1}`, qty: i % 3 ? 1 : 24, unit: i % 3 ? 'Monat' : 'm²', price: i % 3 ? 180 : 2.4, vat: 20 }))
  return { id: 'muster', kind: 'rechnung', number: 'Muster', date: today, serviceFrom: today.slice(0, 8) + '01', serviceTo: today, dueDate: today, recipient: { name: 'Hausverwaltung Muster GmbH', address: 'z. H. Frau Mag. Eva Muster\nMusterplatz 1\n5020 Salzburg', customerNo: '10001' }, title: 'Musterrechnung für das Briefpapier', intro: 'Sehr geehrte Damen und Herren,\nso sehen Rechnungen mit diesem Briefpapier aus. Der Text bleibt innerhalb der eingestellten Ränder.', outro: 'Vielen Dank für den Auftrag.', lines }
}

registerActions({
  'fak-lh-open': () => openModal({ type: 'fak-letterhead' }),
  'fak-lh-pdfhelp': () => {
    const m = app.ui.modal
    readDialog(m)
    m.pdfHelp = !m.pdfHelp
    renderModal()
  },
  'fak-lh-preview': () => {
    const m = app.ui.modal
    if (m?.type === 'fak-letterhead') refreshPreview(m)
  },
  'fak-lh-color': (el) => {
    const v = el.value.trim()
    const other = document.getElementById(el.id === 'flh-accent' ? 'flh-accent-text' : 'flh-accent')
    if (/^#[0-9a-f]{6}$/i.test(v) && other) other.value = v
    const on = document.getElementById('flh-accent-on')
    if (on) on.checked = true
  },
  'fak-lh-pdf': async (el) => {
    const m = app.ui.modal
    if (m?.type !== 'fak-letterhead') return
    readDialog(m)
    const settings = draftSettings(m)
    const lh = letterheadOf(settings)
    el.disabled = true
    try {
      const doc = invoiceDocument({ doc: sampleInvoice(), settings, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null), letterhead: { key: letterheadKey(lh), first: shownImage(m, 'first'), next: shownImage(m, 'next') } })
      download('Briefpapier-Vorschau.pdf', await pdfBlob(doc))
    } catch (err) {
      toast(`Vorschau nicht erstellt: ${err.message}`)
    } finally {
      el.disabled = false
    }
  },
})

registerActions(
  {
    'fak-lh-file': async (el) => {
      const m = app.ui.modal
      const file = el.files?.[0]
      if (!file || m?.type !== 'fak-letterhead') return
      readDialog(m)
      const which = el.dataset.which === 'next' ? 'next' : 'first'
      const img = await readImage(file)
      if (img.error === 'pdf') {
        m.pdfHelp = true
        renderModal()
        return toast('Ein PDF geht als Briefpapier nicht: bitte als Bild (PNG oder JPG) speichern, siehe Hinweis oben.')
      }
      if (img.error) return toast(IMAGE_ERRORS[img.error] || 'Bild nicht lesbar.')
      m.pending[which] = img
      m.pdfHelp = false
      renderModal()
      toast(`Bild für ${which === 'first' ? 'die erste Seite' : 'die Folgeseiten'} übernommen${img.warnings.length ? ' – bitte die Hinweise beachten' : ''}. Mit „Speichern“ gilt es.`)
    },
    'fak-lh-remove': (el) => {
      const m = app.ui.modal
      readDialog(m)
      m.pending[el.dataset.which === 'next' ? 'next' : 'first'] = null
      renderModal()
    },
    'fak-lh-mode': () => {
      const m = app.ui.modal
      readDialog(m)
      renderModal()
    },
    'fak-lh-suggest': () => {
      const s = settingsOf(F())
      suggestFooter(s.sender, s.bank).forEach((t, i) => {
        const el = document.getElementById(`flh-foot-${i}`)
        if (el) el.value = t
      })
      const m = app.ui.modal
      if (m?.type === 'fak-letterhead') refreshPreview(m)
      if (!s.sender.name) toast('Erst den Absender in den Einstellungen eintragen, dann passt der Vorschlag.')
    },
    'fak-lh-reset': () => {
      if (app.ui.confirm !== 'fak-lh-reset') {
        app.ui.confirm = 'fak-lh-reset'
        return renderModal()
      }
      app.ui.confirm = null
      delete F().settings.letterhead
      setLetterheadImages(null)
      closeModal()
      persist()
      renderNow()
      toast('Briefpapier zurückgesetzt: die PDFs sehen wieder aus wie ohne Briefpapier.')
    },
    'fak-lh-save': async (el) => {
      const m = app.ui.modal
      if (m?.type !== 'fak-letterhead') return
      const v = { ...readDialog(m) }
      const lh = letterheadOf({ letterhead: v })
      const hard = marginProblems(lh).filter((p) => /für den Text/.test(p))
      if (hard.length) return toast(hard[0])
      el.disabled = true
      try {
        const at = new Date().toISOString()
        const old = letterheadOf(F().settings)
        for (const which of ['first', 'next']) {
          const p = m.pending[which]
          if (p === null) {
            v[which] = null
            if (old[which]?.path && app.store?.kind === 'sharepoint') await app.store.remove?.(old[which].path).catch(() => {})
            continue
          }
          if (!p) {
            v[which] = old[which] || null
            continue
          }
          const path = letterheadPath(which, p.type)
          if (app.store?.kind === 'sharepoint') await app.store.upload(path, dataUrlToBlob(p.dataUrl), p.type)
          await deviceCache().put('docs', path, { dataUrl: p.dataUrl, at })
          if (old[which]?.path && old[which].path !== path && app.store?.kind === 'sharepoint') await app.store.remove?.(old[which].path).catch(() => {})
          v[which] = { path, name: p.name, type: p.type, width: p.width, height: p.height, size: p.size, at }
        }
        if (!v.first) delete v.first
        if (!v.next) delete v.next
        F().settings.letterhead = v
        // gleich bereitlegen, damit das nächste PDF schon das neue Briefpapier hat
        const saved = letterheadOf(F().settings)
        setLetterheadImages({ key: letterheadKey(saved), first: shownImage(m, 'first'), next: saved.nextMode === 'own' ? shownImage(m, 'next') : null })
        closeModal()
        persist()
        renderNow()
        toast(`Briefpapier gespeichert${app.store?.kind === 'sharepoint' && (m.pending.first || m.pending.next) ? ' (Bilder in SharePoint unter fakturierung/briefpapier/)' : ''}. Es gilt ab sofort für alle PDFs der Fakturierung.`)
      } catch (err) {
        el.disabled = false
        toast(`Nicht gespeichert: ${err.message}`)
      }
    },
  },
  { edit: MODULE },
)
