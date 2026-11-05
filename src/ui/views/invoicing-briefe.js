// Fakturierung → Reiter „Briefe“ (wie „Briefe“ in orgaMAX): Geschäftsbrief an einen Kunden (Ansprechpartner wählbar)
// mit Betreff, Text, Textbausteinen (Belegart „Brief“, Stelle „Brieftext“) und Platzhaltern wie {Anrede}, als PDF auf
// dem Briefpapier per E-Mail senden oder herunterladen, Ablage in SharePoint (fakturierung/briefe/JAHR/). Verlauf je
// Kunde im Kundenblatt (Reiter „Briefe“).
// Serienbrief: Empfänger nach Kundengruppe, Objekt oder alle aktiven Kunden mit Filtern, Vorschau je Empfänger,
// Versand per E-Mail mit Pause, Fortschritt, Anhalten und Fehlerliste, Sammel-PDF zum Drucken für die ohne E-Mail.
// Hinweis zur E-Mail-Werbung (§ 174 TKG 2021, Ausnahme für Bestandskunden; docs/RECHTSPRUEFUNG.md).
// Rechenkern: core/letters.js, PDF: export/letter-pdf.js, Briefpapier: invoicing-briefpapier.js.

import { sendMail } from '../../auth/graph-mail.js'
import { todayISO } from '../../core/dates.js'
import { customerName, deDate, defaultBlock, PLACEHOLDERS, settingsOf } from '../../core/invoicing.js'
import { customerLetters, LETTER_MAIL_TEXT, LETTER_PLACEHOLDERS, LETTER_TEXT, letterArchivePath, letterFileName, letterRecipient, letterState, pageStarts, resolveLetter, SERIAL_SCOPES, SERIAL_TYPES, serialCounts, serialFileName, serialRecipients } from '../../core/letters.js'
import { mailtoUrl } from '../../core/mail.js'
import { letterDocument, lettersDocument } from '../../export/letter-pdf.js'
import { app, canEdit, closeModal, confirmStep, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { canMail } from '../modals/send.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, download, esc, ICON, modalFrame, options, tabBar, uid, val } from '../shared.js'
import { loadLetterhead } from './invoicing-briefpapier.js'
import { textFieldHead, textMenu } from './invoicing-texte.js'

const MODULE = 'fakturierung'
const F = () => {
  const d = (app.data.fakturierung ||= {})
  for (const k of ['customers', 'documents', 'recurring', 'textBlocks', 'letters', 'serials']) d[k] ||= []
  d.settings ||= {}
  return d
}
const S = () => settingsOf(F())
const editable = () => canEdit(MODULE) && !app.readOnly
const userName = () => app.user?.name || ''
const by = () => app.user?.name || 'Browser'
const nowIso = () => new Date().toISOString()
const custOf = (id) => F().customers.find((c) => c.id === id) || null
const letterOf = (id) => F().letters.find((l) => l.id === id) || null
const serialOf = (id) => F().serials.find((s) => s.id === id) || null
const objName = (id) => (app.data.objects || []).find((o) => o.id === id)?.name || ''
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const mailOk = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim())
const LETTER_PHS = PLACEHOLDERS.filter(([k]) => LETTER_PLACEHOLDERS.includes(k))
const byNewest = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
const STATE_PILL = { entwurf: '', versendet: 'ok', gedruckt: 'info' }
const OPT_OUT = 'Sie möchten solche Informationen nicht mehr per E-Mail erhalten? Dann antworten Sie bitte kurz auf diese E-Mail, wir tragen Sie sofort aus.'
const DEFAULT_PAUSE = 2 // Sekunden: Microsoft 365 erlaubt etwa 30 E-Mails je Minute und Postfach

/** Hinweis zur E-Mail-Werbung (kurz; ausführlich mit Quelle in docs/RECHTSPRUEFUNG.md). */
const LEGAL = `<details class="fak-legal" open><summary>E-Mail-Werbung: was erlaubt ist (§ 174 Telekommunikationsgesetz 2021)</summary>
  <p><strong>Werbung per E-Mail</strong> braucht die vorherige Einwilligung, auch bei Firmen. Ohne Einwilligung nur an <strong>eigene Kunden</strong>, wenn alles zutrifft: die Adresse stammt aus einem Auftrag oder Verkauf, die Werbung gilt eigenen ähnlichen Leistungen, der Kunde konnte schon beim Erheben der Adresse und kann in jeder E-Mail kostenlos ablehnen, und er hat nicht abgelehnt (auch nicht über die ECG-Liste der RTR).</p>
  <p><strong>Reine Information</strong> zum laufenden Auftrag (neue Bankverbindung, Betriebsurlaub, Änderung der Reinigungszeiten, Preisanpassung laut Vertrag) ist keine Werbung. Werbe-E-Mails müssen als Werbung erkennbar sein und den Absender nennen. Im Zweifel nur auf Papier. Das ist keine Rechtsberatung.</p></details>`

// ---------------------------------------------------------------- PDF, Ablage

/** Brief mit aufgelösten Platzhaltern: Entwurf aus Kunde und Ansprechpartner, festgehaltener Brief wie versendet. */
function materialize(v) {
  const cu = custOf(v.customerId)
  const serial = v.serialId ? serialOf(v.serialId) : null
  if (serial) {
    const out = resolveLetter({ ...v, subject: serial.subject, text: serial.text, mailText: mailTextOf(serial), recipient: undefined }, { customer: cu, settings: S(), user: serial.createdBy || userName(), today: v.date })
    return { ...v, ...out, recipient: v.recipient?.name ? v.recipient : out.recipient }
  }
  if (v.status && v.status !== 'entwurf') return { ...v }
  const out = resolveLetter({ ...v, objectName: objName(v.objectId), recipient: undefined }, { customer: cu, settings: S(), user: v.author || userName(), today: todayISO() })
  return { ...v, objectName: objName(v.objectId), ...out }
}

async function letterPdf(letter) {
  const [logo] = await Promise.all([loadLogo().catch(() => null), loadLetterhead().catch(() => null)])
  return pdfBlob(letterDocument({ letter, settings: S(), brand: app.config.brand || {}, logo }))
}

/** PDF in SharePoint ablegen (fakturierung/briefe/JAHR/…); im Browser-Modus nicht. */
async function archive(path, blob) {
  if (app.store?.kind !== 'sharepoint') return null
  try {
    await app.store.upload(path, blob, 'application/pdf')
    return path
  } catch (err) {
    toast(`PDF nicht in SharePoint abgelegt: ${err.message}`)
    return null
  }
}

function upsertLetter(l) {
  const d = F()
  const i = d.letters.findIndex((x) => x.id === l.id)
  if (i >= 0) d.letters[i] = l
  else d.letters.push(l)
}

// ---------------------------------------------------------------- Reiter „Briefe“

export function lettersTab() {
  const d = F()
  const ed = editable()
  const q = String(app.ui.fakLetterSearch || '').trim().toLowerCase()
  const serials = new Map(d.serials.map((s) => [s.id, s]))
  const list = d.letters.filter((l) => !q || `${l.subject || ''} ${l.recipient?.name || ''} ${serials.get(l.serialId)?.subject || ''} ${l.contactName || ''}`.toLowerCase().includes(q)).sort(byNewest)
  const rows = list
    .slice(0, 300)
    .map((l) => {
      const st = letterState(l)
      const subject = l.subject || serials.get(l.serialId)?.subject || ''
      return `<tr class="clickable" data-action="fak-letter-open" data-id="${esc(l.id)}"><td>${l.date ? deDate(l.date) : ''}</td><td><strong>${esc(l.recipient?.name || customerName(custOf(l.customerId) || {}) || '–')}</strong>${contactNameOf(l) ? `<br><span class="muted">z. H. ${esc(contactNameOf(l))}</span>` : ''}</td><td>${esc(subject || '(ohne Betreff)')}${l.serialId ? ' <span class="pill">Serienbrief</span>' : ''}</td><td><span class="pill ${STATE_PILL[st.key]}">${esc(st.key === 'versendet' ? 'per E-Mail' : st.key === 'gedruckt' ? 'als PDF' : 'Entwurf')}</span>${st.key === 'versendet' ? `<br><span class="muted fak-break">${esc(l.sent.at(-1).to)}</span>` : ''}</td></tr>`
    })
    .join('')
  const serialRows = d.serials
    .slice()
    .sort(byNewest)
    .map((s) => {
      const ok = (s.results || []).filter((r) => !r.error)
      const failed = failedOf(s).length
      return `<tr class="clickable" data-action="fak-serial-open" data-id="${esc(s.id)}"><td>${s.date ? deDate(s.date) : ''}</td><td><strong>${esc(s.subject || '(ohne Betreff)')}</strong>${s.advertising ? ' <span class="pill warning">Werbung</span>' : ''}</td><td class="num">${ok.filter((r) => r.via !== 'druck').length}</td><td class="num">${ok.filter((r) => r.via === 'druck').length}</td><td class="num">${failed ? `<span class="err-text">${failed}</span>` : ''}</td></tr>`
    })
    .join('')
  return `<div class="filters"><label class="field inline"><span>Suche</span><input type="search" id="fak-letter-search" value="${esc(app.ui.fakLetterSearch || '')}" data-input="fak-letter-search" placeholder="Betreff, Empfänger"></label><span class="spacer"></span>
      ${ed ? `<button class="btn small" data-action="fak-serial-open">${ICON.users} Serienbrief</button><button class="btn small primary" data-action="fak-letter-open">${ICON.plus} Brief</button>` : ''}</div>
    ${serialRows ? `<h3>Serienbriefe</h3><div class="table-wrap"><table class="data"><thead><tr><th>Datum</th><th>Betreff</th><th class="num">per E-Mail</th><th class="num">im Sammel-PDF</th><th class="num">Fehler</th></tr></thead><tbody>${serialRows}</tbody></table></div>` : ''}
    ${serialRows ? '<h3>Briefe</h3>' : ''}
    ${rows ? `<div class="table-wrap"><table class="data fak-letter-table"><thead><tr><th>Datum</th><th>Empfänger</th><th>Betreff</th><th>Versand</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">${d.letters.length ? 'Kein Brief passt zur Suche.' : 'Noch keine Briefe. Ein Brief geht an einen Kunden (wahlweise an einen Ansprechpartner), ein Serienbrief an viele.'}</p>`}
    <p class="note">Briefe stehen auf dem Briefpapier der Fakturierung (Einstellungen → Briefpapier). Platzhalter wie {Anrede} oder {Kunde} ersetzt die App beim Senden; gesendete Briefe bleiben so, wie sie hinausgingen${app.store?.kind === 'sharepoint' ? ', das PDF liegt in SharePoint unter fakturierung/briefe/' : ''}. Textbausteine für Briefe: Stammdaten → Textbausteine, Belegart „Brief“.</p>`
}

/** Kundenblatt → Reiter „Briefe“: Verlauf, neuer Brief, Werbewiderspruch und „inaktiv“ (mit „Speichern“). */
export function customerLettersTab(v, x, dis) {
  const list = customerLetters(F().letters, x.id)
  const rows = list
    .map((l) => {
      const st = letterState(l)
      return `<tr class="clickable" data-action="fak-letter-open" data-id="${esc(l.id)}"><td>${l.date ? deDate(l.date) : ''}</td><td>${esc(l.subject || serialOf(l.serialId)?.subject || '(ohne Betreff)')}${l.serialId ? ' <span class="pill">Serienbrief</span>' : ''}</td><td>${esc(st.text)}</td></tr>`
    })
    .join('')
  return `<div class="filters"><span class="muted">${plural(list.length, 'Brief', 'Briefe')}</span><span class="spacer"></span>${dis ? '' : `<button class="btn small" data-action="fak-letter-open" data-customer="${esc(x.id)}">${ICON.plus} Brief an diesen Kunden</button>`}</div>
    ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Datum</th><th>Betreff</th><th>Versand</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Noch keine Briefe an diesen Kunden.</p>'}
    <h3>Serienbriefe</h3>
    <div class="check-grid fak-cust-flags">
      <label class="check"><input type="checkbox" id="fc-noads" data-change="fak-cust-flag" data-k="noAds" ${v.noAds ? 'checked' : ''} ${dis}><span>Werbung per E-Mail abgelehnt: Werbe-Serienbriefe nur auf Papier</span></label>
      <label class="check"><input type="checkbox" id="fc-inactive" data-change="fak-cust-flag" data-k="inactive" ${v.active === false ? 'checked' : ''} ${dis}><span>Kunde inaktiv: nicht bei „alle aktiven Kunden“</span></label>
    </div>
    <p class="note">Mit „Speichern“ übernehmen. Ein Widerspruch gegen Werbung gilt sofort und ohne Begründung (§ 174 Telekommunikationsgesetz 2021, Art. 21 DSGVO).</p>`
}

// ---------------------------------------------------------------- Brief

function newLetter({ customerId = '' } = {}) {
  const blocks = F().textBlocks
  const cu = custOf(customerId)
  return {
    id: uid('br'),
    customerId,
    contactId: '',
    objectId: cu?.objectIds?.length === 1 ? cu.objectIds[0] : '',
    date: todayISO(),
    subject: '',
    text: defaultBlock(blocks, 'brief', 'letter')?.text ?? LETTER_TEXT,
    mailText: defaultBlock(blocks, 'brief', 'mail')?.text ?? LETTER_MAIL_TEXT,
    status: 'entwurf',
    author: userName(),
    createdAt: nowIso(),
    createdBy: by(),
  }
}

const contactOf = (cu, id) => (id ? (cu?.contacts || []).find((p) => p.id === id) || null : null)
const contactNameOf = (l) => l.contactName || contactOf(custOf(l.customerId), l.contactId)?.name || ''

/** Vorschläge für „An“: Ansprechpartner, Kunde, Ansprechpartner mit Funktion. */
function mailList(id, cu) {
  const list = [[cu?.email, 'Kunde'], ...(cu?.contacts || []).map((p) => [p.email, [p.name, p.role].filter(Boolean).join(', ')])].filter(([e]) => mailOk(e))
  const seen = new Set()
  return `<datalist id="${id}">${list.filter(([e]) => !seen.has(e) && seen.add(e)).map(([e, label]) => `<option value="${esc(e)}">${esc(label)}</option>`).join('')}</datalist>`
}

function letterModal(c, m) {
  const saved = m.id ? letterOf(m.id) : null
  m.draft ||= structuredClone(saved || newLetter({ customerId: m.customerId || '' }))
  const v = m.draft
  const done = v.status && v.status !== 'entwurf'
  const ed = editable()
  const dis = ed && !done ? '' : 'disabled'
  const d = F()
  const cu = custOf(v.customerId)
  const shown = done ? materialize(v) : v
  const rec = done ? shown.recipient || {} : letterRecipient(cu || {}, contactOf(cu, v.contactId))
  m.to ??= rec.email || ''
  const custOpts = options(d.customers.slice().sort((a, b) => customerName(a).localeCompare(customerName(b), 'de')).map((x) => [x.id, `${customerName(x)}${x.customerNo ? ` (${x.customerNo})` : ''}`]), v.customerId, { empty: '– Kunde wählen –' })
  const contactOpts = options((cu?.contacts || []).map((p) => [p.id, [p.name, p.role].filter(Boolean).join(', ')]), v.contactId || '', { empty: cu ? '– an die Firma –' : '–' })
  const objOpts = options((app.data.objects || []).map((o) => [o.id, o.name]), v.objectId || '', { empty: '– ohne Objekt –' })
  const st = letterState(v)
  const tm = (target, place) => (ed && !done ? textMenu({ target, kind: 'brief', place, placeholders: LETTER_PHS }) : '')
  const confirmDel = app.ui.confirm === `fak-brdel:${v.id}`
  return modalFrame({
    title: done ? `Brief vom ${deDate(v.date)}` : saved ? 'Brief (Entwurf)' : 'Neuer Brief',
    subtitle: done ? esc(st.text) : 'auf dem Briefpapier der Fakturierung',
    wide: true,
    body: `${done ? `<div class="banner"><p>${v.serialId ? `Teil des Serienbriefs „${esc(serialOf(v.serialId)?.subject || '')}“. ` : ''}So ist der Brief hinausgegangen; ändern geht nicht mehr. „Als neuen Brief kopieren“ übernimmt Text und Empfänger.</p></div>` : ''}
      <div class="form-grid">
        <label class="field"><span>Kunde</span><select id="fbr-customer" data-change="fak-letter-customer" ${dis}>${custOpts}</select></label>
        <label class="field"><span>Ansprechpartner</span><select id="fbr-contact" data-change="fak-letter-contact" ${dis || (cu?.contacts?.length ? '' : 'disabled')}>${contactOpts}</select></label>
        <label class="field"><span>Objekt (für {Objekt})</span><select id="fbr-object" ${dis}>${objOpts}</select></label>
        <label class="field"><span>Datum</span><input type="date" id="fbr-date" value="${esc(v.date || '')}" ${dis}></label>
        <div class="field wide"><span>Anschrift</span><div class="fak-preview" id="fbr-address">${rec.name ? `<p><strong>${esc(rec.name)}</strong><br>${esc(rec.address || '').split('\n').join('<br>')}</p>` : '<p class="muted">Bitte einen Kunden wählen.</p>'}</div></div>
        <label class="field wide"><span>Betreff</span><input type="text" id="fbr-subject" value="${esc(done ? shown.subject : v.subject || '')}" placeholder="z. B. Neue Reinigungszeiten ab Jänner" ${dis}></label>
        <div class="field wide">${textFieldHead('Text des Briefs', 'fbr-text', tm('fbr-text', 'letter'))}<textarea id="fbr-text" rows="12" ${dis}>${esc(done ? shown.text : v.text || '')}</textarea></div>
      </div>
      <details class="fak-recipient" ${done ? '' : 'open'}><summary>E-Mail${rec.email ? `: ${esc(rec.email)}` : ''}</summary>
        <div class="form-grid">
          <label class="field wide"><span>An</span><input type="email" id="fbr-to" list="fbr-to-list" value="${esc(m.to)}" placeholder="name@kunde.at">${mailList('fbr-to-list', cu)}</label>
          <div class="field wide">${textFieldHead('Text der E-Mail (der Brief hängt als PDF an)', 'fbr-mail', tm('fbr-mail', 'mail'))}<textarea id="fbr-mail" rows="6" ${dis}>${esc(done ? shown.mailText || '' : v.mailText ?? LETTER_MAIL_TEXT)}</textarea></div>
        </div></details>
      ${(v.sent || []).length ? `<p class="muted">Gesendet: ${v.sent.map((s) => `${esc(new Date(s.at).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' }))} an ${esc(s.to)}`).join(' · ')}</p>` : ''}
      <p class="note">${done ? '' : 'Platzhalter wie {Anrede} (Anrede des Ansprechpartners bzw. des Kunden), {Kunde}, {Betreff} oder {Benutzer} ersetzt die App im PDF und in der E-Mail. '}${canMail() ? 'Senden geht aus deinem Postfach; das PDF liegt danach in SharePoint (fakturierung/briefe/).' : 'Senden öffnet dein E-Mail-Programm; das PDF wird heruntergeladen und muss angehängt werden.'}</p>`,
    foot: `<div class="actions">${ed && saved && !done ? `<button class="btn danger" data-action="fak-letter-del" data-id="${esc(v.id)}">${confirmDel ? 'Wirklich löschen?' : 'Entwurf löschen'}</button>` : ''}${ed && done ? `<button class="btn" data-action="fak-letter-copy" data-id="${esc(v.id)}">${ICON.copy} Als neuen Brief kopieren</button>` : ''}</div>
      <div class="actions"><button class="btn" data-action="fak-letter-pdf">${ICON.download} ${done ? 'PDF' : 'Vorschau (PDF)'}</button>${ed && !done ? `<button class="btn" data-action="fak-letter-save">Speichern</button><button class="btn" data-action="fak-letter-print">${ICON.print} PDF zum Drucken</button>` : ''}${ed ? `<button class="btn primary" data-action="fak-letter-send">${ICON.send} ${canMail() ? (done ? 'Erneut senden' : 'Senden') : 'Im E-Mail-Programm öffnen'}</button>` : ''}</div>`,
  })
}
registerModal('fak-letter', letterModal, { module: MODULE })

/** Eingaben des Briefs in den Entwurf (nur solange er nicht versendet ist). */
function readLetter(m) {
  const v = m.draft
  if (document.getElementById('fbr-to')) m.to = val('fbr-to').trim()
  if (!document.getElementById('fbr-subject') || (v.status && v.status !== 'entwurf')) return v
  Object.assign(v, { objectId: val('fbr-object'), date: val('fbr-date') || todayISO(), subject: val('fbr-subject'), text: val('fbr-text'), mailText: val('fbr-mail') })
  return v
}

/** Brief festhalten wie versendet: Platzhalter aufgelöst, Empfänger als Momentaufnahme. */
function freeze(v) {
  const out = materialize(v)
  const contact = contactOf(custOf(v.customerId), v.contactId)
  return { ...v, subject: out.subject, text: out.text, mailText: out.mailText, recipient: out.recipient, objectName: out.objectName || objName(v.objectId), contactName: contact?.name || v.contactName || '' }
}

function letterProblems(v) {
  if (!v.customerId && !v.recipient?.name) return 'Bitte einen Kunden wählen.'
  if (!String(v.subject || '').trim()) return 'Bitte einen Betreff eintragen.'
  if (!String(v.text || '').trim()) return 'Bitte einen Text eintragen.'
  return ''
}

// ---------------------------------------------------------------- Serienbrief

const STEPS = [
  { id: 'empfaenger', label: 'Empfänger' },
  { id: 'text', label: 'Text' },
  { id: 'vorschau', label: 'Vorschau' },
  { id: 'versand', label: 'Versand' },
]

const mailTextOf = (s) => {
  const t = s.mailText ?? LETTER_MAIL_TEXT
  return s.advertising && s.optOut !== false && !/abmelden|austragen|tragen sie.*aus|nicht mehr .*erhalten/i.test(t) ? `${t.replace(/\s+$/, '')}\n\n${OPT_OUT}` : t
}

function newSerial() {
  const blocks = F().textBlocks
  return { id: uid('sb'), date: todayISO(), subject: '', text: defaultBlock(blocks, 'brief', 'letter')?.text ?? LETTER_TEXT, mailText: defaultBlock(blocks, 'brief', 'mail')?.text ?? LETTER_MAIL_TEXT, advertising: false, optOut: true, filter: { scope: 'aktiv', group: '', objectId: '', type: '', role: '', search: '' }, excluded: [], results: [], createdBy: by() }
}

/** Empfänger nach dem Filter des Serienbriefs (mit ausgewählt/abgewählt). */
function recipientsOf(s) {
  const d = F()
  return serialRecipients(d.customers, { ...s.filter, advertising: !!s.advertising, excluded: s.excluded, documents: d.documents, recurring: d.recurring, objects: app.data.objects || [], today: todayISO() })
}

/** Schon erledigt (gesendet oder im Sammel-PDF) je Kunde; Fehlversuche zählen nicht. */
const doneIds = (s) => new Set((s.results || []).filter((r) => !r.error).map((r) => r.customerId))
/** Letzter Stand je Kunde mit Fehler (ohne späteren Erfolg). */
function failedOf(s) {
  const ok = doneIds(s)
  const last = new Map()
  for (const r of s.results || []) if (r.error && !ok.has(r.customerId)) last.set(r.customerId, r)
  return [...last.values()]
}

/** Brief für einen Empfänger des Serienbriefs (aufgelöst). */
function serialLetter(s, r) {
  const out = resolveLetter({ subject: s.subject, text: s.text, mailText: mailTextOf(s), date: s.date, contactId: r.contact?.id || '', recipient: r.recipient }, { customer: r.customer, settings: S(), user: userName(), today: todayISO() })
  return { id: uid('br'), customerId: r.id, contactId: r.contact?.id || '', contactName: r.contact?.name || '', date: s.date, author: userName(), serialId: s.id, ...out }
}

function serialModal(c, m) {
  const saved = m.id ? serialOf(m.id) : null
  m.draft ||= structuredClone(saved || newSerial())
  m.step ||= saved ? 'versand' : 'empfaenger'
  const s = m.draft
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const list = recipientsOf(s)
  const n = serialCounts(list)
  const body = { empfaenger: serialRecipientsStep, text: serialTextStep, vorschau: serialPreviewStep, versand: serialSendStep }[m.step](m, s, list, n, dis)
  const idx = STEPS.findIndex((x) => x.id === m.step)
  const running = m.run?.running
  return modalFrame({
    title: s.subject ? `Serienbrief: ${s.subject}` : 'Serienbrief',
    subtitle: `${plural(n.selected, 'Empfänger', 'Empfänger')}: ${n.mail} per E-Mail, ${n.print} im Sammel-PDF`,
    wide: true,
    body: `${tabBar({ action: 'fak-serial-step', current: m.step, tabs: STEPS.map((x, i) => ({ id: x.id, label: `${i + 1}. ${x.label}` })), cls: 'fak-serial-steps' })}${body}`,
    foot: `<div class="actions"><button class="btn" data-action="close-modal">${running ? 'Im Hintergrund weiter' : 'Schließen'}</button></div><div class="actions">${idx > 0 ? `<button class="btn" data-action="fak-serial-step" data-v="${STEPS[idx - 1].id}" ${running ? 'disabled' : ''}>Zurück</button>` : ''}${idx < STEPS.length - 1 ? `<button class="btn primary" data-action="fak-serial-step" data-v="${STEPS[idx + 1].id}">Weiter: ${STEPS[idx + 1].label}</button>` : ''}</div>`,
  })
}
registerModal('fak-serial', serialModal, { module: MODULE })

function serialRecipientsStep(m, s, list, n, dis) {
  const d = F()
  const f = s.filter
  const groups = [...new Set(d.customers.map((x) => x.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'))
  const roles = [...new Set(d.customers.flatMap((x) => (x.contacts || []).map((p) => p.role)).filter(Boolean))]
  return `<div class="form-grid">
      <label class="field"><span>Empfänger</span><select id="fsb-scope" data-change="fak-serial-filter" ${dis}>${options(Object.entries(SERIAL_SCOPES), f.scope)}</select></label>
      ${f.scope === 'gruppe' ? `<label class="field"><span>Kundengruppe</span><select id="fsb-group" data-change="fak-serial-filter" ${dis}>${options(groups.map((g) => [g, g]), f.group, { empty: '– Gruppe wählen –' })}</select></label>` : ''}
      ${f.scope === 'objekt' ? `<label class="field"><span>Objekt</span><select id="fsb-object" data-change="fak-serial-filter" ${dis}>${options((app.data.objects || []).map((o) => [o.id, o.name]), f.objectId, { empty: '– Objekt wählen –' })}</select></label>` : ''}
      <label class="field"><span>Art</span><select id="fsb-type" data-change="fak-serial-filter" ${dis}>${options(Object.entries(SERIAL_TYPES), f.type)}</select></label>
      <label class="field"><span>An Ansprechpartner mit Funktion</span><input type="text" id="fsb-role" list="fsb-role-list" value="${esc(f.role || '')}" placeholder="leer: an die Firma" data-input="fak-serial-list" ${dis}><datalist id="fsb-role-list">${roles.map((r) => `<option value="${esc(r)}"></option>`).join('')}</datalist></label>
      <label class="field"><span>Suche</span><input type="search" id="fsb-search" value="${esc(f.search || '')}" placeholder="Name, Ort, Gruppe …" data-input="fak-serial-list" ${dis}></label>
    </div>
    <div id="fsb-list">${recipientsHtml(list, n, dis)}</div>
    <p class="note">„Aktiv“ heißt: in den letzten 24 Monaten eine Rechnung, ein laufender Dauerauftrag oder ein aktives Objekt, und nicht als inaktiv markiert (Kundenblatt → Briefe). Kunden ohne E-Mail-Adresse kommen ins Sammel-PDF zum Drucken.</p>`
}

function recipientsHtml(list, n, dis) {
  const rows = list
    .map((r) => `<tr class="${r.selected ? '' : 'muted'}"><td><label class="check"><input type="checkbox" data-change="fak-serial-pick" data-id="${esc(r.id)}" ${r.selected ? 'checked' : ''} ${dis} aria-label="${esc(r.name)} auswählen"><span><strong>${esc(r.name)}</strong>${r.contact ? `<br><span class="muted">z. H. ${esc(r.contact.name)}</span>` : ''}</span></label></td><td class="fak-break">${r.viaMail ? esc(r.email) : '<span class="muted">Sammel-PDF</span>'}</td><td class="muted">${esc(r.note)}</td></tr>`)
    .join('')
  return `<div class="filters"><strong>${plural(n.selected, 'Empfänger', 'Empfänger')} ausgewählt</strong><span class="muted">${n.mail} per E-Mail, ${n.print} im Sammel-PDF${n.all > n.selected ? `, ${n.all - n.selected} abgewählt` : ''}</span><span class="spacer"></span>${dis || !list.length ? '' : '<button class="btn small ghost" data-action="fak-serial-all" data-on="1">alle</button><button class="btn small ghost" data-action="fak-serial-all" data-on="">keine</button>'}</div>
    ${rows ? `<div class="table-wrap fak-serial-list"><table class="data"><thead><tr><th>Empfänger</th><th>E-Mail</th><th>Hinweis</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Kein Kunde passt zur Auswahl.</p>'}`
}

function serialTextStep(m, s, list, n, dis) {
  const tm = (target, place) => (dis ? '' : textMenu({ target, kind: 'brief', place, placeholders: LETTER_PHS }))
  return `<div class="fak-serial-kind" role="radiogroup" aria-label="Art des Serienbriefs">
      <label class="check"><input type="radio" name="fsb-kind" value="info" data-change="fak-serial-kind" ${s.advertising ? '' : 'checked'} ${dis}><span><strong>Information</strong> zum laufenden Auftrag (keine Werbung)</span></label>
      <label class="check"><input type="radio" name="fsb-kind" value="werbung" data-change="fak-serial-kind" ${s.advertising ? 'checked' : ''} ${dis}><span><strong>Werbung</strong>, z. B. neue Leistung oder Aktion</span></label>
    </div>
    ${s.advertising ? `<div class="banner warn-banner"><p>Werbung geht per E-Mail nur an Kunden, die nicht widersprochen haben (Kundenblatt → Briefe). Die übrigen kommen ins Sammel-PDF.</p><label class="check"><input type="checkbox" id="fsb-optout" ${s.optOut !== false ? 'checked' : ''} ${dis}><span>Abmeldehinweis an jede E-Mail anhängen</span></label></div>` : ''}
    ${LEGAL}
    <div class="form-grid">
      <label class="field"><span>Datum</span><input type="date" id="fsb-date" value="${esc(s.date || '')}" ${dis}></label>
      <label class="field wide"><span>Betreff</span><input type="text" id="fsb-subject" value="${esc(s.subject || '')}" placeholder="z. B. Unsere Reinigungszeiten zu den Feiertagen" ${dis}></label>
      <div class="field wide">${textFieldHead('Text des Briefs', 'fsb-text', tm('fsb-text', 'letter'))}<textarea id="fsb-text" rows="12" ${dis}>${esc(s.text || '')}</textarea></div>
      <div class="field wide">${textFieldHead('Text der E-Mail (der Brief hängt als PDF an)', 'fsb-mail', tm('fsb-mail', 'mail'))}<textarea id="fsb-mail" rows="6" ${dis}>${esc(s.mailText ?? LETTER_MAIL_TEXT)}</textarea></div>
    </div>
    <p class="note">{Anrede} wird je Empfänger zur Anrede des Ansprechpartners bzw. des Kunden, {Kunde} zum Namen, {Kundennummer} zur Nummer. Die Vorschau zeigt jeden Brief.</p>`
}

function serialPreviewStep(m, s, list, n, dis) {
  const sel = list.filter((r) => r.selected)
  if (!sel.length) return '<p class="empty">Keine Empfänger ausgewählt (Schritt 1).</p>'
  const i = Math.max(0, sel.findIndex((r) => r.id === m.previewId))
  const r = sel[i]
  m.previewId = r.id
  const l = serialLetter(s, r)
  return `<div class="filters"><button class="btn small" data-action="fak-serial-prev" data-d="-1" ${i ? '' : 'disabled'} aria-label="voriger Empfänger">${ICON.left}</button>
      <label class="field inline"><span>Empfänger ${i + 1} von ${sel.length}</span><select id="fsb-preview" data-change="fak-serial-prev">${options(sel.map((x) => [x.id, x.name]), r.id)}</select></label>
      <button class="btn small" data-action="fak-serial-prev" data-d="1" ${i < sel.length - 1 ? '' : 'disabled'} aria-label="nächster Empfänger">${ICON.right}</button><span class="spacer"></span>
      <button class="btn small" data-action="fak-serial-pdf">${ICON.download} PDF dieses Briefs</button></div>
    <div class="fak-serial-preview">
      <div class="fak-preview"><span class="muted">Anschrift</span><p><strong>${esc(l.recipient.name)}</strong><br>${esc(l.recipient.address || '').split('\n').join('<br>')}</p></div>
      <div class="fak-preview"><span class="muted">${r.viaMail ? `per E-Mail an ${esc(r.email)}` : 'im Sammel-PDF zum Drucken'}${r.note ? ` · ${esc(r.note)}` : ''}</span><p><strong>${esc(l.subject || '(ohne Betreff)')}</strong></p><p class="fak-pre">${esc(l.text)}</p></div>
      ${r.viaMail ? `<div class="fak-preview"><span class="muted">Text der E-Mail</span><p class="fak-pre">${esc(l.mailText)}</p></div>` : ''}
    </div>`
}

function serialSendStep(m, s, list, n, dis) {
  const done = doneIds(s)
  const open = list.filter((r) => r.selected && !done.has(r.id))
  const openMail = open.filter((r) => r.viaMail)
  const openPrint = open.filter((r) => !r.viaMail)
  const failed = failedOf(s)
  const run = m.run
  const mailOn = canMail()
  const problem = !s.subject?.trim() ? 'Bitte im Schritt „Text“ einen Betreff eintragen.' : !s.text?.trim() ? 'Bitte im Schritt „Text“ einen Text eintragen.' : ''
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  const progress = run ? `<div class="fak-serial-progress" role="status" aria-live="polite"><progress max="${run.total}" value="${run.done}"></progress><p><strong>${run.done} von ${run.total}</strong> ${run.running ? (run.stop ? 'erledigt – hält nach dieser E-Mail an …' : 'erledigt …') : run.stopped ? 'erledigt, angehalten.' : 'erledigt.'} ${run.sent} gesendet${run.failed ? `, ${run.failed} mit Fehler` : ''}.</p></div>` : ''
  return `<div class="impact-stats tc-stats">${tile('per E-Mail offen', openMail.length)}${tile('Sammel-PDF offen', openPrint.length)}${tile('erledigt', done.size)}${tile('mit Fehler', failed.length, failed.length ? 'err' : '')}</div>
    ${problem ? `<p class="err-text">${problem}</p>` : ''}
    ${s.advertising ? '<p class="warn-text">Werbung: nur an Kunden ohne Widerspruch per E-Mail; Abmeldehinweis in jeder E-Mail. Bitte den Hinweis im Schritt „Text“ beachten.</p>' : ''}
    <h3>Per E-Mail</h3>
    ${
      mailOn
        ? `<div class="filters"><label class="field inline"><span>Pause zwischen E-Mails (Sekunden)</span><input type="number" id="fsb-pause" min="0" max="60" value="${esc(m.pause ?? DEFAULT_PAUSE)}" ${run?.running ? 'disabled' : ''}></label>
        ${run?.running ? `<button class="btn danger" data-action="fak-serial-stop" ${run.stop ? 'disabled' : ''}>Anhalten</button>` : `<button class="btn primary" data-action="fak-serial-send" ${openMail.length && !problem && !dis ? '' : 'disabled'}>${ICON.send} ${run?.stopped ? 'Fortsetzen' : 'E-Mails senden'} (${openMail.length})</button>`}</div>
        <p class="muted">Jeder Empfänger bekommt eine eigene E-Mail mit seinem Brief als PDF, aus deinem Postfach. Microsoft 365 erlaubt etwa 30 E-Mails je Minute; die Pause hält das ein. Das Fenster darf zu, der Versand läuft weiter, solange die App offen ist.</p>`
        : '<p class="muted">E-Mails direkt aus der App senden geht nur mit Microsoft 365 (Betrieb mit SharePoint, E-Mail eingeschaltet). Hier: alle Briefe ins Sammel-PDF.</p>'
    }
    ${progress}
    ${failed.length ? `<h3>Fehler</h3><div class="table-wrap"><table class="data fak-serial-failed"><thead><tr><th>Empfänger</th><th>E-Mail</th><th>Fehler</th></tr></thead><tbody>${failed.map((r) => `<tr><td>${esc(custOf(r.customerId) ? customerName(custOf(r.customerId)) : r.customerId)}</td><td class="fak-break">${esc(r.to || '')}</td><td class="err-text">${esc(r.error)}</td></tr>`).join('')}</tbody></table></div><p class="muted">„E-Mails senden“ versucht die Fehlgeschlagenen noch einmal; Adresse vorher im Kundenblatt prüfen.</p>` : ''}
    <h3>Sammel-PDF zum Drucken</h3>
    <div class="filters"><button class="btn ${mailOn ? '' : 'primary'}" data-action="fak-serial-print" data-all="" ${openPrint.length && !problem && !dis && !run?.running ? '' : 'disabled'}>${ICON.print} Sammel-PDF (${openPrint.length})</button>${mailOn ? '' : `<button class="btn" data-action="fak-serial-print" data-all="1" ${open.length && !problem && !dis ? '' : 'disabled'}>${ICON.print} Alle ins Sammel-PDF (${open.length})</button>`}</div>
    <p class="muted">Ein PDF mit allen Briefen ohne E-Mail, jeder auf neuer Seite mit dem Briefpapier der ersten Seite – für Fensterkuverts.</p>`
}

/** Eingaben des offenen Schritts in den Serienbrief. */
function readSerial(m) {
  const s = m.draft
  if (document.getElementById('fsb-scope')) Object.assign(s.filter, { scope: val('fsb-scope'), group: document.getElementById('fsb-group') ? val('fsb-group') : s.filter.group, objectId: document.getElementById('fsb-object') ? val('fsb-object') : s.filter.objectId, type: val('fsb-type'), role: val('fsb-role').trim(), search: val('fsb-search').trim() })
  if (document.getElementById('fsb-subject')) {
    Object.assign(s, { date: val('fsb-date') || todayISO(), subject: val('fsb-subject'), text: val('fsb-text'), mailText: val('fsb-mail') })
    if (document.getElementById('fsb-optout')) s.optOut = checked('fsb-optout')
  }
  if (document.getElementById('fsb-pause')) m.pause = Math.max(0, Math.min(60, Number(val('fsb-pause')) || 0))
  return s
}

/** Serienbrief speichern (beim ersten Versand bzw. Sammel-PDF): Text, Filter, Ergebnisse. */
function storeSerial(m) {
  const s = m.draft
  s.createdAt ||= nowIso()
  const d = F()
  const i = d.serials.findIndex((x) => x.id === s.id)
  if (i >= 0) d.serials[i] = s
  else d.serials.push(s)
  return s
}

const wait = (ms, stop = () => false) =>
  new Promise((resolve) => {
    const t0 = Date.now()
    const tick = () => (stop() || Date.now() - t0 >= ms ? resolve() : setTimeout(tick, Math.min(200, ms)))
    tick()
  })

/** Fortschritt neu zeichnen, wenn der Dialog offen ist. */
function showRun(m) {
  if (app.ui.modal === m) {
    const pause = document.getElementById('fsb-pause')?.value
    renderModal()
    const el = document.getElementById('fsb-pause')
    if (el && pause !== undefined) el.value = pause
  }
}

async function runSerialMail(m) {
  readSerial(m)
  const s = storeSerial(m)
  const done = doneIds(s)
  const queue = recipientsOf(s).filter((r) => r.selected && r.viaMail && !done.has(r.id))
  if (!queue.length) return toast('Alle ausgewählten Empfänger mit E-Mail haben den Brief schon.')
  const pause = (m.pause ?? DEFAULT_PAUSE) * 1000
  const run = (m.run = { running: true, stop: false, stopped: false, total: queue.length, done: 0, sent: 0, failed: 0 })
  showRun(m)
  await app.service?.flush?.().catch(() => {})
  const [logo] = await Promise.all([loadLogo().catch(() => null), loadLetterhead().catch(() => null)])
  const brand = app.config.brand || {}
  for (const [i, r] of queue.entries()) {
    if (run.stop) break
    const letter = serialLetter(s, r)
    try {
      const blob = await pdfBlob(letterDocument({ letter, settings: S(), brand, logo }))
      const name = letterFileName(letter)
      await sendMail(app.auth.getToken, { to: r.email, subject: letter.subject, text: letter.mailText, attachments: [{ name, blob, type: 'application/pdf' }] }, { from: app.config.mail?.from || '' })
      const path = await archive(letterArchivePath(letter, name), blob)
      const at = nowIso()
      upsertLetter({ id: letter.id, customerId: r.id, contactId: letter.contactId, contactName: letter.contactName, date: s.date, subject: letter.subject, recipient: letter.recipient, author: userName(), status: 'versendet', sent: [{ at, to: r.email, via: 'graph', by: by() }], serialId: s.id, ...(path ? { pdfPath: path } : {}), createdAt: at, createdBy: by() })
      s.results.push({ customerId: r.id, letterId: letter.id, via: 'graph', to: r.email, at })
      run.sent++
    } catch (err) {
      s.results.push({ customerId: r.id, via: 'graph', to: r.email, at: nowIso(), error: err.message || String(err) })
      run.failed++
    }
    run.done++
    persist()
    showRun(m)
    if (pause && i < queue.length - 1) await wait(pause, () => run.stop)
  }
  run.running = false
  run.stopped = run.stop && run.done < run.total
  persist()
  renderNow()
  showRun(m)
  toast(`Serienbrief: ${plural(run.sent, 'E-Mail', 'E-Mails')} gesendet${run.failed ? `, ${run.failed} mit Fehler (Liste im Schritt „Versand“)` : ''}${run.stopped ? `, ${run.total - run.done} noch offen (angehalten)` : ''}.`)
}

/** Sammel-PDF: jeder Brief einzeln gesetzt (Seitenzahl), dann alle in einem PDF mit Briefpapier je Brief. */
async function serialPrint(m, all) {
  readSerial(m)
  const s = storeSerial(m)
  const done = doneIds(s)
  const queue = recipientsOf(s).filter((r) => r.selected && !done.has(r.id) && (all || !r.viaMail))
  if (!queue.length) return toast('Keine offenen Briefe für das Sammel-PDF.')
  const [logo] = await Promise.all([loadLogo().catch(() => null), loadLetterhead().catch(() => null)])
  const brand = app.config.brand || {}
  const letters = queue.map((r) => serialLetter(s, r))
  const counts = []
  for (const [i, letter] of letters.entries()) {
    if (letters.length > 1 && i % 10 === 0) toast(`Sammel-PDF: ${i} von ${letters.length} Briefen gesetzt …`)
    // nur zum Zählen der Seiten: ohne Bilder (schneller, die Lage des Textes ist dieselbe)
    const doc = letterDocument({ letter, settings: S(), brand, logo: null, letterhead: { key: 'zaehlen' } })
    let pages = 1
    const foot = doc.footer
    doc.footer = (p, total) => ((pages = total), foot?.(p, total) ?? null)
    if (letters.length > 1) await pdfBlob(doc)
    counts.push(pages)
  }
  const blob = await pdfBlob(lettersDocument({ letters, settings: S(), brand, logo, starts: pageStarts(counts), title: `Serienbrief ${s.subject}` }))
  const name = serialFileName(s)
  download(name, blob)
  const path = await archive(`fakturierung/briefe/${String(s.date).slice(0, 4)}/${name}`, blob)
  const at = nowIso()
  for (const [i, r] of queue.entries()) {
    const l = letters[i]
    upsertLetter({ id: l.id, customerId: r.id, contactId: l.contactId, contactName: l.contactName, date: s.date, subject: l.subject, recipient: l.recipient, author: userName(), status: 'gedruckt', printedAt: at, serialId: s.id, ...(path ? { pdfPath: path } : {}), createdAt: at, createdBy: by() })
    s.results.push({ customerId: r.id, letterId: l.id, via: 'druck', at })
  }
  persist()
  renderNow()
  showRun(m)
  toast(`Sammel-PDF mit ${plural(letters.length, 'Brief', 'Briefen')} (${counts.reduce((a, b) => a + b, 0)} Seiten) erstellt${path ? ' und in SharePoint abgelegt' : ''}.`)
}

// ---------------------------------------------------------------- Aktionen

registerActions({
  'fak-letter-search': () => {
    app.ui.fakLetterSearch = val('fak-letter-search')
    renderNow()
  },
  'fak-letter-open': (el) => openModal({ type: 'fak-letter', id: el.dataset.id || '', customerId: el.dataset.customer || '' }),
  'fak-serial-open': (el) => openModal({ type: 'fak-serial', id: el.dataset.id || '' }),
  'fak-letter-pdf': async (el) => {
    const m = app.ui.modal
    if (m?.type !== 'fak-letter') return
    const v = readLetter(m)
    el.disabled = true
    try {
      const letter = materialize(v)
      download(letterFileName(letter), await letterPdf(letter))
    } catch (err) {
      toast(`PDF nicht erstellt: ${err.message}`)
    } finally {
      el.disabled = false
    }
  },
  'fak-serial-step': (el) => {
    const m = app.ui.modal
    if (m?.type !== 'fak-serial') return
    readSerial(m)
    m.step = el.dataset.v
    renderModal()
  },
  'fak-serial-filter': () => {
    const m = app.ui.modal
    readSerial(m)
    renderModal()
  },
  'fak-serial-list': () => {
    const m = app.ui.modal
    if (m?.type !== 'fak-serial') return
    const s = readSerial(m)
    const list = recipientsOf(s)
    const box = document.getElementById('fsb-list')
    if (box) box.innerHTML = recipientsHtml(list, serialCounts(list), editable() ? '' : 'disabled')
  },
  'fak-serial-prev': (el) => {
    const m = app.ui.modal
    const sel = recipientsOf(m.draft).filter((r) => r.selected)
    const i = sel.findIndex((r) => r.id === m.previewId)
    m.previewId = el.dataset.d ? sel[Math.max(0, Math.min(sel.length - 1, i + Number(el.dataset.d)))]?.id : val('fsb-preview')
    renderModal()
  },
  'fak-serial-pdf': async (el) => {
    const m = app.ui.modal
    const r = recipientsOf(m.draft).find((x) => x.id === m.previewId)
    if (!r) return
    el.disabled = true
    try {
      const letter = serialLetter(m.draft, r)
      download(letterFileName(letter), await letterPdf(letter))
    } catch (err) {
      toast(`PDF nicht erstellt: ${err.message}`)
    } finally {
      el.disabled = false
    }
  },
})

registerActions(
  {
    'fak-letter-customer': () => {
      const m = app.ui.modal
      const v = readLetter(m)
      v.customerId = val('fbr-customer')
      const cu = custOf(v.customerId)
      v.contactId = ''
      if (cu?.objectIds?.length === 1) v.objectId = cu.objectIds[0]
      m.to = letterRecipient(cu || {}).email
      renderModal()
    },
    'fak-letter-contact': () => {
      const m = app.ui.modal
      const v = readLetter(m)
      v.contactId = val('fbr-contact')
      const cu = custOf(v.customerId)
      m.to = letterRecipient(cu || {}, contactOf(cu, v.contactId)).email
      renderModal()
    },
    'fak-letter-save': () => {
      const m = app.ui.modal
      const v = readLetter(m)
      if (!v.customerId) return toast('Bitte einen Kunden wählen.')
      v.updatedAt = nowIso()
      upsertLetter(structuredClone(v))
      closeModal()
      persist()
      renderNow()
      toast('Brief als Entwurf gespeichert.')
    },
    'fak-letter-del': (el) => {
      if (!confirmStep(`fak-brdel:${el.dataset.id}`, renderModal)) return
      F().letters = F().letters.filter((l) => l.id !== el.dataset.id)
      closeModal()
      persist()
      renderNow()
      toast('Entwurf gelöscht.')
    },
    'fak-letter-copy': (el) => {
      const src = letterOf(el.dataset.id) || app.ui.modal?.draft
      if (!src) return
      const full = materialize(src)
      const copy = { ...newLetter({ customerId: src.customerId }), contactId: src.contactId || '', objectId: src.objectId || '', subject: full.subject || '', text: full.text || '', mailText: full.mailText || LETTER_MAIL_TEXT }
      openModal({ type: 'fak-letter', draft: copy })
      toast('Kopie als neuer Brief – Text und Empfänger übernommen.')
    },
    'fak-letter-print': async (el) => {
      const m = app.ui.modal
      const v = readLetter(m)
      const problem = letterProblems(v)
      if (problem) return toast(problem)
      el.disabled = true
      try {
        const letter = freeze(v)
        const blob = await letterPdf(letter)
        const name = letterFileName(letter)
        download(name, blob)
        const path = await archive(letterArchivePath(letter, name), blob)
        upsertLetter({ ...letter, status: 'gedruckt', printedAt: nowIso(), ...(path ? { pdfPath: path } : {}) })
        closeModal()
        persist()
        renderNow()
        toast(`Brief als PDF erstellt${path ? ' und in SharePoint abgelegt' : ''}.`)
      } catch (err) {
        el.disabled = false
        toast(`PDF nicht erstellt: ${err.message}`)
      }
    },
    'fak-letter-send': async (el) => {
      const m = app.ui.modal
      const v = readLetter(m)
      const to = String(m.to || '').trim()
      const problem = letterProblems(v)
      if (problem) return toast(problem)
      if (!mailOk(to)) return toast('Bitte eine gültige E-Mail-Adresse eintragen.')
      el.disabled = true
      try {
        await app.service?.flush?.().catch(() => {})
        const letter = v.status && v.status !== 'entwurf' ? { ...v, ...materialize(v) } : freeze(v)
        const blob = await letterPdf(letter)
        const name = letterFileName(letter)
        let path = null
        if (canMail()) {
          await sendMail(app.auth.getToken, { to, subject: letter.subject, text: letter.mailText, attachments: [{ name, blob, type: 'application/pdf' }] }, { from: app.config.mail?.from || '' })
          path = await archive(letterArchivePath(letter, name), blob)
        } else {
          download(name, blob)
          location.href = mailtoUrl({ to: [to], subject: letter.subject, body: `(PDF bitte anhängen: ${name} – liegt im Download-Ordner)\n\n${letter.mailText}` })
        }
        const saved = { ...(v.serialId ? v : letter), status: 'versendet', sent: [...(v.sent || []), { at: nowIso(), to, via: canMail() ? 'graph' : 'mailto', by: by() }], ...(path ? { pdfPath: path } : {}) }
        upsertLetter(saved)
        const cu = custOf(v.customerId)
        if (cu && !cu.email && !contactOf(cu, v.contactId)?.email) cu.email = to
        closeModal()
        persist()
        renderNow()
        toast(canMail() ? `Brief an ${to} gesendet.` : `E-Mail an ${to} vorbereitet; das PDF liegt im Download-Ordner.`)
      } catch (err) {
        el.disabled = false
        toast(`Nicht gesendet: ${err.message}`)
      }
    },
    'fak-cust-flag': (el) => {
      const m = app.ui.modal
      if (m?.type !== 'fak-cust' || !m.draft) return
      if (el.dataset.k === 'noAds') {
        if (el.checked) m.draft.noAds = true
        else delete m.draft.noAds
      } else if (el.checked) m.draft.active = false
      else delete m.draft.active
    },
    'fak-serial-pick': (el) => {
      const m = app.ui.modal
      const s = readSerial(m)
      const off = new Set(s.excluded || [])
      if (el.checked) off.delete(el.dataset.id)
      else off.add(el.dataset.id)
      s.excluded = [...off]
      const list = recipientsOf(s)
      const box = document.getElementById('fsb-list')
      if (box) box.innerHTML = recipientsHtml(list, serialCounts(list), '')
    },
    'fak-serial-all': (el) => {
      const m = app.ui.modal
      const s = readSerial(m)
      s.excluded = el.dataset.on ? [] : recipientsOf({ ...s, excluded: [] }).map((r) => r.id)
      renderModal()
    },
    'fak-serial-kind': () => {
      const m = app.ui.modal
      const s = readSerial(m)
      s.advertising = document.querySelector('input[name="fsb-kind"]:checked')?.value === 'werbung'
      renderModal()
    },
    'fak-serial-send': async (el) => {
      const m = app.ui.modal
      if (m?.type !== 'fak-serial' || m.run?.running) return
      if (!canMail()) return toast('E-Mails direkt senden geht nur mit Microsoft 365. Bitte das Sammel-PDF nehmen.')
      const s = readSerial(m)
      if (!s.subject?.trim() || !s.text?.trim()) return toast('Bitte Betreff und Text eintragen (Schritt „Text“).')
      el.disabled = true
      await runSerialMail(m).catch((err) => {
        if (m.run) m.run.running = false
        toast(`Versand abgebrochen: ${err.message}`)
        showRun(m)
      })
    },
    'fak-serial-stop': () => {
      const m = app.ui.modal
      if (m?.run?.running) {
        m.run.stop = true
        showRun(m)
      }
    },
    'fak-serial-print': async (el) => {
      const m = app.ui.modal
      if (m?.type !== 'fak-serial') return
      const s = readSerial(m)
      if (!s.subject?.trim() || !s.text?.trim()) return toast('Bitte Betreff und Text eintragen (Schritt „Text“).')
      el.disabled = true
      try {
        await serialPrint(m, !!el.dataset.all)
      } catch (err) {
        toast(`Sammel-PDF nicht erstellt: ${err.message}`)
      } finally {
        el.disabled = false
      }
    },
  },
  { edit: MODULE },
)
