// E-Mail aus der App: ein Senden-Fenster für alles.
// – Exporte: Menüpunkte mit mail: true (shared.js → menu) bekommen „Per E-Mail senden“; die Datei wird
//   dabei nicht heruntergeladen, sondern als Anhang eingesammelt (captureDownloads).
// – Berichte: „Diese Ansicht per E-Mail“ im ⋯-Menü macht aus der aktuellen Ansicht ein PDF (Kennzahlen,
//   Tabellen, Listen wie auf dem Bildschirm, mit Filter) und eine CSV-Datei der Tabellen.
// – Aufgaben: „+ Neu → Aufgabe per E-Mail“ mit Fälligkeit und Kalender-Erinnerung (.ics) im Anhang.
// – „Zu erledigen“: ganze Liste oder ein Abschnitt als Text mit Link in die App.
// Versand über Microsoft 365 (Graph, Mail.Send), sonst öffnet sich das E-Mail-Programm (mailto) und
// die Anhänge werden heruntergeladen.

import { sendMail } from '../auth/graph-mail.js'
import { todayISO } from '../core/dates.js'
import { fileSafe } from '../core/filename.js'
import { attachmentSize, formatAddress, listMail, MAIL_LIMIT, mailtoUrl, parseAddresses, reportMail, rowsToCsv, sizeText, subjectFromFile, taskMail } from '../core/mail.js'
import { reportDocument } from '../export/report-pdf.js'
import { ACTIONS, app, closeModal, openModal, registerActions, registerModal, renderModalKeepingInput, toast, VIEWS } from './context.js'
import { canMail } from './modals/send.js'
import { loadLogo, pdfBlob } from './pdf.js'
import { captureDownloads, download, esc, ICON, modalFrame, val } from './shared.js'

const RECENT_KEY = 'cleanos-mail-zuletzt'
const sees = (m) => !app.access || app.access.sees(m)
const sender = () => app.user?.name || ''

// ---------------------------------------------------------------- Adressen

function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, 10) : []
  } catch {
    return []
  }
}

/** Zuletzt verwendete Adressen (nur auf diesem Gerät, höchstens 10). */
function remember(addresses) {
  try {
    const list = [...addresses, ...readRecent()].filter((a, i, all) => all.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)))
  } catch {
    /* privater Modus: ohne Merken */
  }
}

/** Adressbuch nach Rolle: Mitarbeitende, Kundschaft, Objekte, Lieferanten, Werkstätten. [[Gruppe, [[Wert, Anzeige]]]] */
export function addressBook() {
  const today = todayISO()
  const groups = []
  const recent = readRecent()
  if (recent.length) groups.push(['Zuletzt verwendet', recent.map((a) => [a, a])])
  const add = (label, list) => {
    const items = list.filter((x) => x.email && /@/.test(x.email)).map((x) => [formatAddress(x.name, x.email), `${x.name || x.email}${x.name ? ` – ${x.email}` : ''}`])
    if (items.length) groups.push([label, items.sort((a, b) => a[1].localeCompare(b[1], 'de'))])
  }
  if (sees('planung') || sees('stammdaten') || sees('auswertung')) add('Mitarbeitende', (app.data.employees || []).filter((e) => !e.exitDate || e.exitDate >= today))
  if (sees('fakturierung')) add('Kundschaft', app.data.fakturierung?.customers || [])
  if (sees('stammdaten') || sees('objektmappe') || sees('kontrolle')) add('Objekte (Leistungsnachweis)', (app.data.objects || []).filter((o) => o.active !== false).map((o) => ({ name: o.name, email: o.proofEmail })))
  if (sees('material')) add('Lieferanten', app.data.material?.suppliers || [])
  if (sees('fahrzeuge')) add('Werkstätten', app.data.fahrzeuge?.workshops || [])
  return groups
}

export const pickSelect = (id, target) => {
  const groups = addressBook()
  if (!groups.length) return ''
  return `<select id="${id}" class="mc-pick" data-change="mail-pick" data-target="${target}" aria-label="Adresse aus der Liste hinzufügen"><option value="">+ aus der Liste …</option>${groups
    .map(([label, items]) => `<optgroup label="${esc(label)}">${items.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</optgroup>`)
    .join('')}</select>`
}

// ---------------------------------------------------------------- Versand

function clickLink(url) {
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
}

/** Senden über Microsoft 365 – oder E-Mail-Programm öffnen und Anhänge herunterladen. → 'graph' | 'mailto' */
export async function deliver({ to, cc = [], bcc = [], subject, text, attachments = [] }) {
  if (canMail()) {
    await sendMail(app.auth.getToken, { to, cc, bcc, subject, text, attachments }, { from: app.config.mail?.from || '' })
    return 'graph'
  }
  for (const a of attachments) download(a.name, a.blob)
  // Hinweis oben: E-Mail-Programme kürzen lange mailto-Texte am Ende
  const hint = attachments.length ? `(Bitte anhängen: ${attachments.map((a) => a.name).join(', ')} – liegt im Download-Ordner)\n\n` : ''
  clickLink(mailtoUrl({ to, cc, subject, body: `${hint}${text}` }))
  return 'mailto'
}

function readRecipients(toId, ccId) {
  const to = parseAddresses(val(toId))
  const cc = ccId ? parseAddresses(val(ccId)) : { valid: [], invalid: [] }
  const bad = [...to.invalid, ...cc.invalid]
  if (bad.length) return { error: `Bitte prüfen: „${bad.slice(0, 2).join('“, „')}“ ist keine gültige E-Mail-Adresse.` }
  if (!to.valid.length) return { error: 'Bitte mindestens eine Adresse unter „An“ eintragen.' }
  return { to: to.valid, cc: cc.valid.filter((a) => !to.valid.some((b) => b.toLowerCase() === a.toLowerCase())) }
}

const sentToast = (via, to, files) =>
  via === 'graph'
    ? `Gesendet an ${to.length === 1 ? to[0] : `${to.length} Empfänger`}. Liegt unter „Gesendete Elemente“.`
    : `E-Mail-Programm geöffnet${files.length ? `; ${files.length === 1 ? 'der Anhang liegt' : 'die Anhänge liegen'} im Download-Ordner – bitte anhängen` : ''}.`

const routeNote = () =>
  canMail()
    ? `Geht aus deinem Microsoft-365-Postfach${app.config.mail?.from ? ` (${esc(app.config.mail.from)})` : ''} und liegt danach unter „Gesendete Elemente“.`
    : `Öffnet dein E-Mail-Programm${app.store?.kind === 'sharepoint' ? ' (Senden direkt aus der App lässt sich in config.json einschalten: features.mail)' : ''}; Anhänge werden heruntergeladen und müssen angehängt werden.`

const copyMe = (id) => (canMail() && app.user?.email ? `<label class="check"><input type="checkbox" id="${id}"><span>Kopie an mich (${esc(app.user.email)})</span></label>` : '')

// ---------------------------------------------------------------- Senden-Fenster

/**
 * Senden-Fenster öffnen. mail: { to?, cc?, subject, text, files: [{ name, blob, type }], origin?, privacy?, onSent? }
 * privacy: Hinweis auf personenbezogene Daten im Anhang (Exporte, Berichte); onSent({ via, to, cc, subject, files }):
 * nach dem Senden (bzw. dem Öffnen des E-Mail-Programms), z. B. um den Versand zu vermerken.
 */
export function openCompose(mail) {
  openModal({ type: 'mail-compose', files: [], ...mail })
  // „… wird erstellt“ ist erledigt; die Meldung soll nicht über den Knöpfen stehen bleiben
  const t = document.getElementById('toast')
  if (t) t.hidden = true
}

function composeModal(c, m) {
  const size = attachmentSize(m.files)
  const tooBig = canMail() && size > MAIL_LIMIT
  const files = m.files.length
    ? `<ul class="mc-files">${m.files
        .map((f, i) => `<li>${ICON.sheet}<span class="mc-file-name">${esc(f.name)}</span><span class="muted">${sizeText(f.blob?.size || 0)}</span><button type="button" class="btn small ghost icon" data-action="mail-file-remove" data-i="${i}" aria-label="Anhang ${esc(f.name)} entfernen" title="Anhang entfernen">${ICON.close}</button></li>`)
        .join('')}</ul>`
    : ''
  return modalFrame({
    title: 'Per E-Mail senden',
    subtitle: m.origin ? esc(m.origin) : '',
    wide: true,
    body: `<div class="form-grid mc-form">
        <label class="field wide"><span>An</span><span class="mc-row"><input type="text" id="mc-to" value="${esc(m.to || '')}" placeholder="name@firma.at; mehrere mit Strichpunkt" autocomplete="email" inputmode="email">${pickSelect('mc-pick', 'mc-to')}</span></label>
        <label class="field wide"><span>Kopie (CC)</span><input type="text" id="mc-cc" value="${esc(m.cc || '')}" placeholder="optional" autocomplete="email" inputmode="email"></label>
        <label class="field wide"><span>Betreff</span><input type="text" id="mc-subject" value="${esc(m.subject || '')}"></label>
        <label class="field wide"><span>Text</span><textarea id="mc-text" rows="9">${esc(m.text || '')}</textarea></label>
        ${copyMe('mc-me')}
      </div>
      ${files ? `<h3 class="mc-head">Anhang <span class="muted">${sizeText(size)}</span></h3>${files}` : ''}
      ${tooBig ? `<p class="banner warn-banner">Die Anhänge sind zusammen ${sizeText(size)} groß – Microsoft 365 nimmt aus der App höchstens ${sizeText(MAIL_LIMIT)}. Bitte einen Anhang entfernen oder herunterladen und in Outlook anhängen.</p>` : ''}
      ${m.privacy && m.files.length ? '<p class="note">Im Anhang können personenbezogene Daten stehen (Namen, Zeiten, Adressen). Nur an Personen senden, die sie brauchen.</p>' : ''}
      <p class="note">${routeNote()}</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions">${m.files.length ? `<button class="btn" data-action="mail-download">${ICON.download} Herunterladen</button>` : ''}<button class="btn primary" data-action="mail-send" ${tooBig ? 'disabled' : ''}>${ICON.send} ${canMail() ? 'Senden' : 'Im E-Mail-Programm öffnen'}</button></div>`,
  })
}
registerModal('mail-compose', composeModal)

// ---------------------------------------------------------------- Export einsammeln

const TYPES = { pdf: 'application/pdf', csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip', ics: 'text/calendar', json: 'application/json', txt: 'text/plain' }
const typeOf = (name, blob) => blob?.type?.split(';')[0] || TYPES[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream'

/** Export-Aktion ausführen und ihre Datei(en) einsammeln statt herunterzuladen. */
export async function captureExport(action, data = {}) {
  const files = []
  const el = document.createElement('button')
  for (const [k, v] of Object.entries(data)) el.dataset[k] = v
  captureDownloads((name, blob) => {
    files.push({ name, blob, type: typeOf(name, blob) })
  })
  try {
    await ACTIONS[action]?.(el)
    // manche Exporte rechnen weiter, ohne auf sich warten zu lassen
    for (let i = 0; i < 50 && !files.length; i++) await new Promise((r) => setTimeout(r, 100))
  } finally {
    captureDownloads(null)
  }
  return files
}

const labelOf = (el) => (el.querySelector('.mi-label')?.firstChild?.textContent || el.textContent || '').trim()

// ---------------------------------------------------------------- Ansicht als Bericht

/** Text eines Elements ohne Knöpfe und Menüs; <br> wird zu „ · “. */
function cleanText(el) {
  const copy = el.cloneNode(true)
  for (const x of copy.querySelectorAll('.btn:not(.link-btn), details, svg, .visually-hidden, .caret, kbd, input[type=checkbox]')) x.remove()
  for (const x of copy.querySelectorAll('input, select, textarea')) x.replaceWith(x.tagName === 'SELECT' ? x.options[x.selectedIndex]?.text || '' : x.value || '')
  // Grund einer Abwesenheit (Krankenstand ist ein Gesundheitsdatum) geht nicht per E-Mail hinaus: nur „abwesend“
  for (const x of copy.querySelectorAll('.abs-tag, .abs-why, .tl-row.absent .tl-note')) x.replaceWith('abwesend')
  for (const br of copy.querySelectorAll('br')) br.replaceWith(' · ')
  // Kennzeichen wie „rückwirkend“ nicht direkt an den Text kleben
  for (const x of copy.querySelectorAll('.pill, .tag, .flag')) x.before(' · ')
  return copy.textContent.replace(/\s+/g, ' ').replace(/(\s*·\s*)+/g, ' · ').replace(/^[\s·]+|[\s·]+$/g, '').trim()
}

/** Ansichten ohne Zahlen oder Tabellen zum Senden (Anleitung, eingebettete Werkzeuge); eigene mit mail: false. */
const NOT_MAILABLE = new Set(['anleitung', 'zaehler', 'kontrolle', 'objektmappe', 'matten'])
export const canMailView = (id = app.ui.view) => !NOT_MAILABLE.has(id) && VIEWS.find((v) => v.id === id)?.mail !== false
/** Ansichten, die eine Woche zeigen (sonst steht „Woche ab …“ nicht im Betreff). */
const WEEK_VIEWS = new Set(['week', 'timeline', 'coverage', 'report', 'sheet', 'zeiten'])

const shown = (el) => el.getClientRects().length > 0 && !el.closest('.menu, .modal-backdrop, [hidden], details:not([open]) > :not(summary)')

function tableData(table) {
  const headRow = table.tHead?.rows[0] || null
  const bodyRows = [...(table.tBodies[0]?.rows || [])].filter((tr) => !tr.hidden)
  const head = headRow ? [...headRow.cells].map(cleanText) : []
  let rows = bodyRows.map((tr) => [...tr.cells].map(cleanText))
  const width = Math.max(head.length, ...rows.map((r) => r.length), 0)
  const keep = [...Array(width).keys()].filter((i) => head[i] || rows.some((r) => r[i]))
  rows = rows.map((r) => keep.map((i) => r[i] || '')).filter((r) => r.some(Boolean))
  const wrap = table.closest('.table-wrap') || table
  const prev = wrap.previousElementSibling
  const title = prev && /^H[34]$/.test(prev.tagName) ? cleanText(prev) : ''
  return { title, head: keep.map((i) => head[i] || ''), rows }
}

/** Was die Ansicht gerade zeigt: Titel, Kennzahlen-Kacheln, Tabellen, Listen. */
export function readView(root = document.querySelector('main'), { viewId = app.ui.view, monday = null } = {}) {
  const view = VIEWS.find((v) => v.id === viewId)
  // Titel ohne Zusätze wie „(12 Gänge diese Woche)“
  const head = (root.querySelector('.section-head h2') || document.createElement('i')).cloneNode(true)
  for (const x of head.querySelectorAll('.muted, small, .pill, .flag')) x.remove()
  const title = cleanText(head).replace(/\s*\(.*\)\s*$/, '') || view?.label || 'Bericht'
  const tiles = [...root.querySelectorAll('.stat, .kpi-tile')]
    .filter(shown)
    .map((el) => ({ label: cleanText(el.querySelector('.label, .kpi-tile-label') || el), value: cleanText(el.querySelector('.value, .kpi-tile-value') || el) }))
    .filter((t) => t.label && t.value && t.label !== t.value)
    // Kennzahlen haben inzwischen rund 20 Kacheln (Verträge, Geräte, Mattenwechsel …); das PDF bricht in Zeilen um
    .slice(0, 40)
  const tables = [...root.querySelectorAll('table')].filter(shown).map(tableData).filter((t) => t.head.length && t.rows.length)
  const lists = []
  const report = [...root.querySelectorAll('.report-row, .todo-item')].filter(shown).map(cleanText).filter(Boolean)
  if (report.length) lists.push({ title: '', items: report })
  const week = view && WEEK_VIEWS.has(view.id) ? monday || (app.ui.monday ? app.cur?.monday : null) : null
  const today = new Date().toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const subtitle = `${week ? `Woche ab ${new Date(`${week}T12:00`).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })} · ` : ''}Stand ${today}`
  return { title, subtitle, tiles, tables, lists }
}

/** Tabellen als eine CSV-Datei (bei mehreren mit Überschrift und Leerzeile dazwischen). */
export function tablesCsv(tables) {
  const rows = []
  for (const t of tables) {
    if (tables.length > 1) rows.push([t.title || 'Tabelle'])
    rows.push(t.head, ...t.rows)
    if (tables.length > 1) rows.push([])
  }
  return rowsToCsv(rows)
}

// ---------------------------------------------------------------- Aufgabe per E-Mail

function taskModal(c, m) {
  const objects = (app.data.objects || []).filter((o) => o.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'))
  return modalFrame({
    title: 'Aufgabe per E-Mail',
    subtitle: 'mit Kalender-Erinnerung zum Fälligkeitstag',
    wide: true,
    body: `<div class="form-grid mc-form">
        <label class="field wide"><span>An</span><span class="mc-row"><input type="text" id="mt-to" value="${esc(m.to || '')}" placeholder="name@firma.at; mehrere mit Strichpunkt" autocomplete="email" inputmode="email">${pickSelect('mt-pick', 'mt-to')}</span></label>
        <label class="field wide"><span>Aufgabe</span><input type="text" id="mt-title" value="${esc(m.title || '')}" placeholder="z. B. Glasreinigung Stiegenhaus nachbessern" maxlength="160"></label>
        <label class="field"><span>Fällig bis</span><input type="date" id="mt-due" value="${esc(m.due || '')}" min="${todayISO()}"></label>
        <label class="field"><span>Objekt</span><select id="mt-obj"><option value="">ohne Objekt</option>${objects.map((o) => `<option value="${esc(o.id)}" ${o.id === m.objectId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
        <label class="field wide"><span>Beschreibung</span><textarea id="mt-desc" rows="5" placeholder="Was genau, worauf achten, wen fragen">${esc(m.description || '')}</textarea></label>
        <label class="check"><input type="checkbox" id="mt-ics" checked><span>Kalender-Erinnerung anhängen (am Vortag um 9 Uhr, auch ohne Microsoft 365)</span></label>
        ${copyMe('mt-me')}
      </div>
      <p class="note">${routeNote()}</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="mail-task-send">${ICON.send} ${canMail() ? 'Aufgabe senden' : 'Im E-Mail-Programm öffnen'}</button></div>`,
  })
}
registerModal('mail-task', taskModal)

// ---------------------------------------------------------------- „Zu erledigen“ weitergeben

export function todoSections(only = null, root = document.querySelector('#modal-root')) {
  const secs = [...(root?.querySelectorAll('.modal-body > section') || [])]
  return secs
    .filter((_, i) => only === null || i === only)
    .map((sec) => {
      const head = sec.querySelector('h3')
      const title = head ? cleanText(head) : ''
      let items = [...sec.querySelectorAll('.todo-item')].map((x) => cleanText(x.querySelector('.todo-text') || x))
      if (!items.length) items = [...sec.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map(cleanText).filter(Boolean).join(' · '))
      if (!items.length) items = [...sec.children].filter((x) => x !== head && !x.classList.contains('note')).map(cleanText)
      return { title, items: items.filter(Boolean) }
    })
    .filter((s) => s.items.length)
}

const appLink = (hash = '') => `${location.origin}${location.pathname}${hash ? `#${hash}` : ''}`

// ---------------------------------------------------------------- Aktionen

registerActions({
  'mail-export': async (el) => {
    const { of, subject = '', action, ...data } = el.dataset
    if (!ACTIONS[of]) return
    const origin = labelOf(el)
    el.disabled = true
    toast('Anhang wird erstellt …')
    let files = []
    try {
      files = await captureExport(of, data)
    } catch (err) {
      return toast(`Export fehlgeschlagen: ${err.message}`)
    } finally {
      el.disabled = false
    }
    if (!files.length) return toast('Es ist keine Datei entstanden (keine Einträge oder Export ausgeschaltet).')
    const title = subject || subjectFromFile(files[0].name)
    const mail = reportMail({ title, files: files.map((f) => f.name), from: sender() })
    openCompose({ subject: mail.subject, text: mail.text, files, origin: origin ? `Export: ${origin}` : '', privacy: true })
  },
  'mail-view': async (el) => {
    const r = readView()
    if (!r.tiles.length && !r.tables.length && !r.lists.length) return toast('Diese Ansicht hat keine Zahlen oder Tabellen zum Senden. Exporte findest du im Menü der Ansicht.')
    if (el) el.disabled = true
    toast('Bericht wird erstellt …')
    try {
      const base = fileSafe(`${r.title}_${todayISO()}`)
      const pdf = await pdfBlob(reportDocument({ ...r, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) }))
      const files = [{ name: `${base}.pdf`, blob: pdf, type: 'application/pdf' }]
      if (r.tables.length) files.push({ name: `${base}.csv`, blob: new Blob([tablesCsv(r.tables)], { type: 'text/csv;charset=utf-8' }), type: 'text/csv' })
      const mail = reportMail({ title: r.title, subtitle: r.subtitle, tiles: r.tiles, files: files.map((f) => f.name), from: sender() })
      openCompose({ subject: mail.subject, text: mail.text, files, origin: `Ansicht „${r.title}“ als Bericht`, privacy: true })
    } catch (err) {
      toast(`Bericht nicht erstellt: ${err.message}`)
    } finally {
      if (el) el.disabled = false
    }
  },
  'mail-compose-open': () => openCompose({ subject: '', text: sender() ? `\n\nLiebe Grüße\n${sender()}` : '' }),
  'mail-pick': (el) => {
    const input = document.getElementById(el.dataset.target)
    if (input && el.value) {
      const has = parseAddresses(input.value).valid.map((a) => a.toLowerCase())
      const add = parseAddresses(el.value).valid[0]
      if (add && !has.includes(add.toLowerCase())) input.value = [input.value.trim().replace(/[;,]\s*$/, ''), el.value].filter(Boolean).join('; ')
      input.focus()
    }
    el.value = ''
  },
  'mail-file-remove': (el) => {
    const m = app.ui.modal
    if (m?.type !== 'mail-compose') return
    m.files = m.files.filter((_, i) => i !== Number(el.dataset.i))
    renderModalKeepingInput()
  },
  'mail-download': () => {
    for (const f of app.ui.modal?.files || []) download(f.name, f.blob)
  },
  'mail-send': async (el) => {
    const m = app.ui.modal
    if (m?.type !== 'mail-compose') return
    const r = readRecipients('mc-to', 'mc-cc')
    if (r.error) return toast(r.error)
    const subject = val('mc-subject').trim() || 'Nachricht aus der Cleanos App'
    const text = val('mc-text')
    const bcc = document.getElementById('mc-me')?.checked && app.user?.email ? [app.user.email] : []
    if (canMail() && attachmentSize(m.files) > MAIL_LIMIT) return toast(`Anhänge zu groß (${sizeText(attachmentSize(m.files))}).`)
    el.disabled = true
    try {
      const via = await deliver({ to: r.to, cc: r.cc, bcc, subject, text, attachments: m.files })
      remember([...r.to, ...r.cc])
      const files = m.files
      closeModal()
      toast(sentToast(via, r.to, via === 'mailto' ? files : []))
      // Vermerk im Modul, das das Fenster geöffnet hat (Regiebericht, Bericht der Qualitätsmessung: „gesendet an …“)
      try {
        m.onSent?.({ via, to: r.to, cc: r.cc, subject, files: files.map((f) => f.name) })
      } catch (err) {
        console.warn('Vermerk nach dem Senden:', err)
      }
    } catch (err) {
      el.disabled = false
      toast(`Nicht gesendet: ${err.message}`)
    }
  },
  'mail-task-new': (el) => openModal({ type: 'mail-task', objectId: el?.dataset?.obj || '', to: el?.dataset?.to || '', title: el?.dataset?.title || '' }),
  'mail-task-send': async (el) => {
    const r = readRecipients('mt-to')
    if (r.error) return toast(r.error)
    const title = val('mt-title').trim()
    if (!title) return toast('Bitte die Aufgabe kurz beschreiben (Feld „Aufgabe“).')
    const due = val('mt-due')
    const obj = (app.data.objects || []).find((o) => o.id === val('mt-obj'))
    const mail = taskMail({ title, due, object: obj ? [obj.name, obj.address].filter(Boolean).join(', ') : '', description: val('mt-desc'), from: sender() })
    const attachments = mail.ics && document.getElementById('mt-ics')?.checked ? [{ name: `Aufgabe_${fileSafe(title).slice(0, 60)}.ics`, blob: new Blob([mail.ics], { type: 'text/calendar;charset=utf-8' }), type: 'text/calendar' }] : []
    const bcc = document.getElementById('mt-me')?.checked && app.user?.email ? [app.user.email] : []
    el.disabled = true
    try {
      const via = await deliver({ to: r.to, bcc, subject: mail.subject, text: mail.text, attachments })
      remember(r.to)
      closeModal()
      toast(via === 'graph' ? `Aufgabe an ${r.to.join(', ')} gesendet${attachments.length ? ' – mit Kalender-Erinnerung' : ''}.` : sentToast(via, r.to, attachments))
    } catch (err) {
      el.disabled = false
      toast(`Nicht gesendet: ${err.message}`)
    }
  },
  'mail-todo': (el) => {
    const only = el.dataset.sec === undefined ? null : Number(el.dataset.sec)
    const sections = todoSections(only)
    if (!sections.length) return toast('Hier ist gerade nichts offen.')
    const title = only === null ? 'Zu erledigen' : `Zu erledigen: ${sections[0].title}`
    const mail = listMail({ title, sections: only === null ? sections : [{ title: '', items: sections[0].items }], link: appLink(), from: sender() })
    openCompose({ subject: mail.subject, text: mail.text, files: [], origin: title })
  },
})
