// Fakturierung → „Läufe ▾“ (wie in orgaMAX): Entwürfe auf einmal prüfen, festschreiben und versenden
// (Sammelversand per E-Mail, ohne E-Mail-Adresse als Sammel-PDF zum Drucken), Mahnlauf mit Mahnsperre
// („nicht mahnen bis …“) und Angebote nachfassen (Wiedervorlage, Nachfass-E-Mail, Angebotsquote).
// Rechenkern: core/fak-laeufe.js; PDF, Ablage und Platzhalter kommen aus invoicing.js (laeufeHooks).

import { sendMail } from '../../auth/graph-mail.js'
import { addDays, formatDate, todayISO } from '../../core/dates.js'
import { activeBlocks, batchDrafts, DEFAULT_FOLLOW_UP_DAYS, dunningRun, emailValid, finalizeBatch, followUpMailText, followUpOf, MAIL_PAUSE_MS, mailWithDebit, offerStats, offerTasks, paymentReminders, sendCandidates } from '../../core/fak-laeufe.js'
import { blocksFor, customerName, defaultBlock, docFileName, fillPlaceholders, invoiceMailText, isInvoice, KINDS, monthLabel, periodLabel, reminderFileName, reminderMailText, round2, settingsOf } from '../../core/invoicing.js'
import { collectionCandidates, inCollection } from '../../core/sepa.js'
import { eInvoiceProblems } from '../../export/e-invoice.js'
import { reminderDocument } from '../../export/invoice-pdf.js'
import { combineDocuments, pdfPageCount } from '../../export/pdf-sammel.js'
import { app, canEdit, closeModal, confirmStep, openModal, persist, registerActions, registerModal, render, renderModal, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { canMail } from '../modals/send.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, download, esc, euro, ICON, menu, modalFrame, options, val } from '../shared.js'
import { textFieldHead, textMenu } from './invoicing-texte.js'
import { mattenRunMenuItem } from './invoicing-mattenabrechnung.js'
import { contractRunMenuItem } from './invoicing-vertraege.js'

const MODULE = 'fakturierung'
/**
 * Aus invoicing.js (dort gesetzt): PDF, Ablage in SharePoint, Platzhalter, E-Rechnung, Nummern prüfen und conflicts(x, docs):
 * Gründe gegen das Festschreiben wie beim Einzel-Festschreiben (schon anderswo verrechnet, Mattenwechsel nicht freigegeben).
 */
export const laeufeHooks = { docPdf: null, docDefinition: null, archive: null, ctxFor: null, eInvoiceXml: null, checkNumbers: () => {}, reminderLetterText: () => '', beilageFiles: async () => [], beilageArchiveName: (x, name) => name, conflicts: () => [] }
const check = (x, docs) => laeufeHooks.conflicts(x, docs)

const F = () => app.data.fakturierung
const S = () => settingsOf(F())
const editable = () => canEdit(MODULE) && !app.readOnly
const by = () => app.user?.name || 'Browser'
const nowIso = () => new Date().toISOString()
const custOf = (id) => (F().customers || []).find((c) => c.id === id)
const docOf = (id) => F().documents.find((d) => d.id === id)
const money = (n) => euro(round2(n))
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const day = (iso) => (iso ? formatDate(iso, { weekday: false, year: true }) : '')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const customers = () => F().customers || []
const customersById = () => new Map(customers().map((c) => [c.id, c]))
const li = (p) => `<li class="${p.level === 'error' ? 'err-text' : p.level === 'warn' ? 'warn-text' : 'muted'}">${esc(p.text)}</li>`
const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
const progressHtml = (p) => (p ? `<div class="fak-run-progress" role="status" aria-live="polite"><progress max="${p.total}" value="${p.done}" style="width:100%"></progress><p class="muted">${esc(p.label || '')} ${p.done} von ${p.total}</p></div>` : '')
const pick = (name, id, on, action) => `<input type="checkbox" name="${name}" data-change="${action}" data-id="${esc(id)}" ${on ? 'checked' : ''} aria-label="auswählen">`
const live = (m) => app.ui.modal === m
const rerender = (m) => live(m) && renderModal()
const flush = () => app.service?.flush?.().catch(() => {})

/** Menü „Läufe“ neben „Anlegen“ und „Export“. */
export function laeufeMenu(ed) {
  if (!ed) return ''
  return menu({
    label: 'Läufe',
    icon: ICON.send,
    single: false,
    items: [
      { label: 'Festschreiben und senden', action: 'fak-batch-open', hint: 'alle Entwürfe auf einmal, z. B. nach dem Monatslauf' },
      { label: 'Mahnlauf', action: 'fak-dunning-open', hint: 'alle fälligen Mahnungen' },
      { label: 'Lastschrifteinzug', action: 'fak-sepa-open', hint: 'SEPA-Lastschrift (pain.008)' },
      mattenRunMenuItem(),
      contractRunMenuItem(),
    ],
  })
}

// ---------------------------------------------------------------- Sammel-Festschreiben und Sammelversand

const unsent = () => sendCandidates(F().documents, customers())

/** Hinweis über der Rechnungsliste: Entwürfe auf einmal festschreiben, Belege noch nicht versendet. */
export function batchBanner() {
  if (!editable()) return ''
  const drafts = F().documents.filter((d) => isInvoice(d) && !d.number).length
  const open = unsent().length
  if (!drafts && !open) return ''
  return `<div class="banner"><p>${drafts ? `<strong>${plural(drafts, 'Entwurf', 'Entwürfe')}</strong> prüfen und auf einmal festschreiben` : ''}${drafts && open ? '; ' : ''}${open ? `<strong>${plural(open, 'Rechnung', 'Rechnungen')}</strong> noch nicht versendet` : ''}.</p>
    <button class="btn primary" data-action="fak-batch-open" ${drafts ? '' : 'data-step="senden"'}>${drafts ? 'Festschreiben und senden' : 'Versenden'}</button></div>`
}

function batchModal(c, m) {
  m.step ||= 'fest'
  m.filter ||= F().documents.some((d) => isInvoice(d) && !d.number && d.source?.type === 'dauerauftrag') ? 'lauf' : 'alle'
  const steps = `<div class="seg tabbar" role="tablist"><button class="btn ${m.step === 'fest' ? 'primary' : ''}" data-action="fak-batch-step" data-v="fest" role="tab" aria-selected="${m.step === 'fest'}">1. Festschreiben</button><button class="btn ${m.step === 'senden' ? 'primary' : ''}" data-action="fak-batch-step" data-v="senden" role="tab" aria-selected="${m.step === 'senden'}">2. Versenden</button></div>`
  return m.step === 'senden' ? sendStep(m, steps) : finalStep(m, steps)
}
registerModal('fak-batch', batchModal, { module: MODULE })

function finalStep(m, steps) {
  const list = batchDrafts(F().documents, { filter: m.filter, ym: m.filter === 'lauf' ? m.ym || '' : '', settings: S(), check })
  m.sel ||= Object.fromEntries(list.filter((x) => !x.errors.length).map((x) => [x.doc.id, true]))
  const chosen = list.filter((x) => m.sel[x.doc.id] && !x.errors.length)
  const months = [...new Set(F().documents.filter((d) => isInvoice(d) && !d.number && d.source?.type === 'dauerauftrag').map((d) => String(d.source.key || '').slice(-7)).filter((k) => /^\d{4}-\d{2}$/.test(k)))].sort().reverse()
  const rows = list
    .map(({ doc: x, problems, errors, gross }) => {
      const rest = problems.filter((p) => p.level !== 'info')
      return `<tr><td>${errors.length ? '' : pick('fbt', x.id, m.sel[x.id], 'fak-batch-pick')}</td><td><button class="link-btn" data-action="fak-open" data-id="${esc(x.id)}">${esc(x.recipient?.name || '– ohne Empfänger –')}</button>${x.objectName ? `<br><span class="muted">${esc(x.objectName)}</span>` : ''}</td>
        <td>${esc(x.title || KINDS[x.kind])}${x.serviceFrom ? `<br><span class="muted">${esc(periodLabel({ from: x.serviceFrom, to: x.serviceTo || x.serviceFrom }))}</span>` : ''}</td><td>${esc(day(x.date))}</td><td class="num">${money(gross)}</td>
        <td>${rest.length ? `<ul class="fak-problems">${rest.map(li).join('')}</ul>` : '<span class="ok-text">in Ordnung</span>'}</td></tr>`
    })
    .join('')
  const confirm = app.ui.confirm === 'fak-batch-final'
  const p = m.progress
  return modalFrame({
    title: 'Festschreiben und senden',
    subtitle: 'alle Entwürfe auf einmal',
    wide: true,
    body: `${steps}
      <div class="filters"><label class="field inline"><span>Entwürfe</span><select id="fbt-filter" data-change="fak-batch-filter">${options([['lauf', 'aus dem Monatslauf'], ['alle', 'alle Entwürfe']], m.filter)}</select></label>
        ${m.filter === 'lauf' && months.length ? `<label class="field inline"><span>Monat</span><select id="fbt-month" data-change="fak-batch-filter">${options(months.map((k) => [k, monthLabel(k)]), m.ym || '', { empty: 'alle Monate' })}</select></label>` : ''}
        <span class="spacer"></span>${list.length ? `<button class="btn small ghost" data-action="fak-batch-all" data-v="1">alle</button><button class="btn small ghost" data-action="fak-batch-all" data-v="">keine</button>` : ''}</div>
      ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th></th><th>Empfänger</th><th>Betreff</th><th>Datum</th><th class="num">brutto</th><th>Pflichtangaben</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">Keine Entwürfe${m.filter === 'lauf' ? ' aus dem Monatslauf' : ''}.</p>`}
      ${progressHtml(p)}
      <p class="note">Festgeschrieben wird in fortlaufender Nummernfolge (nach Datum, dann Empfänger), vorher holt die App den Stand der anderen. Entwürfe mit Fehlern bleiben stehen: öffnen, ergänzen, dann hier wieder anhaken. Hat der Kunde ein SEPA-Mandat, steht der Lastschrift-Hinweis auf der Rechnung.</p>`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions"><button class="btn primary ${confirm ? 'confirm' : ''}" data-action="fak-batch-final" ${chosen.length && !m.busy ? '' : 'disabled'}>${confirm ? `Wirklich ${plural(chosen.length, 'Entwurf', 'Entwürfe')} festschreiben? Danach nicht mehr änderbar` : `Festschreiben (${chosen.length})`}</button></div>`,
  })
}

/** Text der E-Mail zum Beleg: gewählter Textbaustein, sonst Standard wie beim Einzelversand; mit Lastschrift-Hinweis. */
function invoiceText(x, blockId) {
  const s = S()
  const ctx = laeufeHooks.ctxFor(x)
  const own = blockId ? (F().textBlocks || []).find((b) => b.id === blockId) : defaultBlock(F().textBlocks, x.kind, 'mail')
  if (own) return fillPlaceholders(own.text, ctx)
  return mailWithDebit(invoiceMailText({ doc: x, company: s.sender.name, sender: app.user?.name || '', iban: s.bank.iban, greeting: ctx.Anrede }), x)
}
const invoiceSubject = (x) => `${KINDS[x.kind]} ${x.number}${x.title ? ` – ${x.title}` : ''}`

function sendStep(m, steps) {
  m.scope ||= m.ids?.length ? 'lauf' : 'alle'
  const list = sendCandidates(F().documents, customers(), { ids: m.scope === 'lauf' ? m.ids || [] : null })
  m.sendSel ||= Object.fromEntries(list.map((x) => [x.doc.id, true]))
  const chosen = list.filter((x) => m.sendSel[x.doc.id])
  const mail = chosen.filter((x) => emailValid(x.to))
  const post = chosen.filter((x) => !emailValid(x.to))
  const done = Object.entries(m.results || {})
  const blocks = blocksFor(F().textBlocks, 'rechnung', 'mail')
  const mailOk = canMail()
  // eben versendete Belege bleiben mit ihrem Ergebnis stehen
  const sentNowRows = Object.keys(m.results || {})
    .filter((id) => !list.some((x) => x.doc.id === id))
    .map((id) => docOf(id))
    .filter(Boolean)
    .map((doc) => ({ doc, to: doc.sent?.at(-1)?.to || '', done: true }))
  const rows = [...sentNowRows, ...list]
    .map(({ doc: x, to, done: was }) => {
      const res = m.results?.[x.id]
      return `<tr><td>${was ? '' : pick('fbs', x.id, m.sendSel[x.id], 'fak-batch-spick')}</td><td><button class="link-btn" data-action="fak-open" data-id="${esc(x.id)}">${esc(x.number)}</button></td><td>${esc(x.recipient?.name || '')}</td><td class="num">${money(x.total?.gross || 0)}</td>
        <td class="fak-break">${emailValid(to) ? esc(to) : `<span class="pill warning">per Post</span>`}</td><td>${res ? `<span class="${res.ok ? 'ok-text' : 'err-text'}">${esc(res.text)}</span>` : ''}</td></tr>`
    })
    .join('')
  const sentNow = Object.values(m.results || {}).filter((r) => r.ok).length
  const failed = done.filter(([, r]) => !r.ok)
  const preview = mail[0] ? invoiceText(mail[0].doc, m.block || '') : ''
  return modalFrame({
    title: 'Festschreiben und senden',
    subtitle: 'Versand per E-Mail oder Post',
    wide: true,
    body: `${steps}
      <div class="filters"><label class="field inline"><span>Belege</span><select id="fbs-scope" data-change="fak-batch-scope">${options([...(m.ids?.length ? [['lauf', `eben festgeschrieben (${m.ids.length})`]] : []), ['alle', 'alle noch nicht versendeten']], m.scope)}</select></label>
        <label class="field inline"><span>E-Mail-Text</span><select id="fbs-block" data-change="fak-batch-opts">${options([['', 'Standard (wie beim Einzelversand)'], ...blocks.map((b) => [b.id, b.name || 'Textbaustein'])], m.block || '')}</select></label>
        <label class="check"><input type="checkbox" id="fbs-xml" data-change="fak-batch-opts" ${m.xml ? 'checked' : ''}><span>E-Rechnung anhängen (factur-x.xml)</span></label>
        <span class="spacer"></span>${list.length ? `<button class="btn small ghost" data-action="fak-batch-all" data-v="1" data-step="senden">alle</button><button class="btn small ghost" data-action="fak-batch-all" data-v="" data-step="senden">keine</button>` : ''}</div>
      ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th></th><th>Nummer</th><th>Empfänger</th><th class="num">brutto</th><th>E-Mail für Rechnungen</th><th>Ergebnis</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Alle festgeschriebenen Rechnungen sind versendet.</p>'}
      ${progressHtml(m.progress)}
      ${sentNow || failed.length ? `<p>${sentNow ? `<span class="ok-text">${plural(sentNow, 'Beleg', 'Belege')} versendet.</span> ` : ''}${failed.length ? `<span class="err-text">${plural(failed.length, 'Fehler', 'Fehler')}: in der Liste beim Beleg.</span>` : ''}</p>` : ''}
      ${preview ? `<details class="fak-preview-mail"><summary>Vorschau der E-Mail an ${esc(mail[0].doc.recipient?.name || mail[0].to)}</summary><p><strong>${esc(invoiceSubject(mail[0].doc))}</strong></p><pre class="fak-mail-text">${esc(preview)}</pre></details>` : ''}
      <p class="note">${mailOk ? `E-Mails gehen aus deinem Postfach${app.config.mail?.from ? ` (${esc(app.config.mail.from)})` : ''}, mit kurzer Pause dazwischen (Microsoft 365 nimmt höchstens 30 je Minute an); das PDF liegt danach in SharePoint (fakturierung/belege/).` : 'E-Mail-Versand aus der App ist nicht eingerichtet (nur mit SharePoint und features.mail): Belege als Sammel-PDF drucken oder einzeln über „E-Mail“ senden.'} Ohne E-Mail-Adresse beim Beleg oder Kunden: Sammel-PDF zum Drucken; der Beleg gilt dann als per Post versendet.</p>`,
    foot: `<button class="btn" data-action="${m.busy ? 'fak-batch-cancel' : 'close-modal'}">${m.busy ? 'Abbrechen' : 'Schließen'}</button><div class="actions">
      <button class="btn" data-action="fak-batch-print" ${(mailOk ? post : chosen).length && !m.busy ? '' : 'disabled'}>${ICON.download} Sammel-PDF zum Drucken (${(mailOk ? post : chosen).length})</button>
      ${mailOk ? `<button class="btn primary" data-action="fak-batch-send" ${mail.length && !m.busy ? '' : 'disabled'}>${ICON.send} Per E-Mail senden (${mail.length})</button>` : ''}</div>`,
  })
}

/** Sammel-PDF: je Beleg ein frisches pdfmake-Dokument, Seiten gezählt am einzeln erstellten PDF (das auch abgelegt wird). */
async function printBatch(items, { title, fileName, makeDef, archiveName, onEach }) {
  const defs = []
  const counts = []
  for (const it of items) {
    const blob = await pdfBlob(await makeDef(it))
    counts.push(pdfPageCount(new Uint8Array(await blob.arrayBuffer())) || 1)
    defs.push(await makeDef(it))
    await laeufeHooks.archive?.(it.doc, blob, archiveName(it))
    onEach?.(it)
  }
  download(fileName, await pdfBlob(combineDocuments(defs, counts, { title })))
}

// ---------------------------------------------------------------- Mahnlauf

/**
 * Zu mahnende Rechnungen des Dialogs. m.only === 'erinnerung': nur die freundliche erste Stufe per E-Mail
 * (Zahlungserinnerung, aus „Zu erledigen“ bzw. vom digitalen Mitarbeiter zur Freigabe angeboten).
 */
function dunningList(m, today) {
  if (m.only === 'erinnerung') return canMail() ? paymentReminders(F().documents, customers(), today, S()).ready : []
  return dunningRun(F().documents, customers(), today, S()).due
}

function dunningModal(c, m) {
  const today = todayISO()
  const r = dunningRun(F().documents, customers(), today, S())
  const only = m.only === 'erinnerung'
  const list = dunningList(m, today)
  m.sel ||= Object.fromEntries(list.map((x) => [x.doc.id, true]))
  const chosen = list.filter((x) => m.sel[x.doc.id])
  const mailOk = canMail()
  const mail = mailOk ? chosen.filter((x) => emailValid(x.to)) : []
  const blocks = blocksFor(F().textBlocks, 'mahnung', 'mail')
  const sum = round2(list.reduce((a, x) => a + x.open, 0))
  const ed = editable()
  const row = (x, extra = '') => {
    const rem = x.reminder
    const res = m.results?.[x.doc.id]
    return `<tr><td>${extra ? '' : pick('fdn', x.doc.id, m.sel[x.doc.id], 'fak-dunning-pick')}</td><td><button class="link-btn" data-action="fak-open" data-id="${esc(x.doc.id)}">${esc(x.doc.number)}</button><br><span class="muted">${esc(x.doc.recipient?.name || '')}</span></td>
      <td>${esc(day(x.doc.dueDate))}<br><span class="pill ${x.overdueDays > 30 ? 'error' : 'warning'}">${x.overdueDays} Tage</span></td><td><strong>${esc(rem.name)}</strong></td><td class="num">${money(x.open)}</td>
      <td class="num">${rem.interest.amount ? money(rem.interest.amount) : '–'}</td><td class="num">${rem.fee ? money(rem.fee) : '–'}</td><td class="num"><strong>${money(rem.total)}</strong></td>
      <td>${extra || (emailValid(x.to) && mailOk ? `<span class="pill info" title="${esc(x.to)}">E-Mail</span>` : '<span class="pill warning">per Post</span>')}${res ? `<br><span class="${res.ok ? 'ok-text' : 'err-text'}">${esc(res.text)}</span>` : ''}</td>
      <td>${ed ? `<button class="btn small ghost" data-action="fak-block-open" data-doc="${esc(x.doc.id)}" data-back="fak-dunning" title="Mahnsperre: nicht mahnen bis …">${extra ? 'Sperre ändern' : 'Sperren'}</button>` : ''}</td></tr>`
  }
  const head = '<thead><tr><th></th><th>Rechnung</th><th>fällig</th><th>Stufe</th><th class="num">offen</th><th class="num">Zinsen</th><th class="num">Gebühr</th><th class="num">gesamt</th><th>Versand</th><th></th></tr></thead>'
  const blockText = (b) => `gesperrt ${b.until ? `bis ${day(b.until)}` : 'bis auf Weiteres'}${b.scope === 'kunde' ? ' (Kunde)' : ''}${b.note ? `: ${b.note}` : ''}`
  const others = activeBlocks(F().documents, customers(), today).filter((b) => !r.blocked.some((x) => (b.scope === 'beleg' ? x.doc.id === b.id : x.customer?.id === b.id)))
  if (only) {
    const pr = paymentReminders(F().documents, customers(), today, S())
    return modalFrame({
      title: 'Zahlungserinnerungen',
      subtitle: `Stand ${day(today)}`,
      wide: true,
      body: `<p>Freundliche erste Erinnerung an überfällige Rechnungen, ohne Zinsen und Gebühr, per E-Mail mit PDF. Erst nach deiner Freigabe geht etwas hinaus; vermerkt wird sie beim Beleg, die nächste Stufe kommt dann im Mahnlauf.</p>
        <div class="filters"><label class="field inline"><span>E-Mail-Text</span><select id="fdn-block" data-change="fak-dunning-opts">${options([['', 'Standardtext je Mahnstufe'], ...blocks.map((b) => [b.id, b.name || 'Textbaustein'])], m.block || '')}</select></label><span class="spacer"></span>
          ${list.length ? `<button class="btn small ghost" data-action="fak-dunning-all" data-v="1">alle</button><button class="btn small ghost" data-action="fak-dunning-all" data-v="">keine</button>` : ''}</div>
        ${list.length ? `<div class="table-wrap"><table class="data">${head}<tbody>${list.map((x) => row(x)).join('')}</tbody></table></div><p class="muted">Summe offen ${money(sum)}.</p>` : `<p class="empty">${canMail() ? 'Keine Zahlungserinnerung fällig.' : 'E-Mail-Versand aus der App ist nicht eingerichtet – Erinnerungen über den Mahnlauf als PDF.'}</p>`}
        ${progressHtml(m.progress)}
        ${pr.post.length ? `<p class="note">Ohne E-Mail-Adresse (Erinnerung im Mahnlauf per Post): ${esc(pr.post.map((x) => x.doc.number).join(', '))}.</p>` : ''}
        ${pr.later ? `<p class="note">${pr.later === 1 ? 'Eine Rechnung braucht' : `${pr.later} Rechnungen brauchen`} schon die nächste Mahnstufe – <button class="link-btn" data-action="fak-dunning-open">Mahnlauf öffnen</button>.</p>` : ''}`,
      foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions"><button class="btn primary" data-action="fak-dunning-run" ${chosen.length && !m.busy ? '' : 'disabled'}>${ICON.send} Erinnerungen senden (${chosen.length})</button></div>`,
    })
  }
  return modalFrame({
    title: 'Mahnlauf',
    subtitle: `Stand ${day(today)}`,
    wide: true,
    body: `<div class="impact-stats tc-stats">${tile('zu mahnen', r.due.length, r.due.length ? 'err' : '')}${tile('Summe offen', money(sum))}${tile('gesperrt', r.blocked.length)}${tile('im Lastschrifteinzug', r.collecting.length)}</div>
      <div class="filters"><label class="field inline"><span>E-Mail-Text</span><select id="fdn-block" data-change="fak-dunning-opts">${options([['', 'Standardtext je Mahnstufe'], ...blocks.map((b) => [b.id, b.name || 'Textbaustein'])], m.block || '')}</select></label><span class="spacer"></span>
        ${r.due.length ? `<button class="btn small ghost" data-action="fak-dunning-all" data-v="1">alle</button><button class="btn small ghost" data-action="fak-dunning-all" data-v="">keine</button>` : ''}</div>
      ${r.due.length ? `<div class="table-wrap"><table class="data">${head}<tbody>${r.due.map((x) => row(x)).join('')}</tbody></table></div>` : '<p class="empty">Keine Mahnung fällig.</p>'}
      ${progressHtml(m.progress)}
      ${r.blocked.length ? `<h3>Gesperrt (nicht mahnen)</h3><div class="table-wrap"><table class="data">${head}<tbody>${r.blocked.map((x) => row(x, `<span class="pill info">${esc(blockText(x.block))}</span>`)).join('')}</tbody></table></div>` : ''}
      ${others.length ? `<details><summary>Weitere Mahnsperren (${others.length})</summary><ul>${others.map((b) => `<li>${esc(b.name)}: ${esc(blockText(b))}${ed ? ` <button class="link-btn" data-action="fak-block-open" data-${b.scope === 'kunde' ? 'customer' : 'doc'}="${esc(b.id)}" data-back="fak-dunning">ändern</button>` : ''}</li>`).join('')}</ul></details>` : ''}
      ${r.collecting.length ? `<p class="muted">Im Lastschrifteinzug, deshalb nicht gemahnt: ${esc(r.collecting.map((x) => x.doc.number).join(', '))}.</p>` : ''}
      <p class="note">Je Rechnung die nächste fällige Stufe mit Verzugszinsen und Pauschale wie bei der Einzelmahnung (Einstellungen → Mahnwesen); vermerkt wird sie beim Beleg. ${mailOk ? 'Mit E-Mail-Adresse geht die Mahnung als PDF per E-Mail, sonst kommt sie ins Sammel-PDF zum Drucken.' : 'Alle Mahnungen kommen in ein Sammel-PDF zum Drucken (E-Mail-Versand aus der App ist nicht eingerichtet).'} Mahnsperre: z. B. bei Ratenvereinbarung oder Reklamation – je Rechnung oder für alle Rechnungen des Kunden.</p>`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions"><button class="btn primary" data-action="fak-dunning-run" ${chosen.length && !m.busy ? '' : 'disabled'}>${mail.length ? `${ICON.send} Mahnungen erstellen und senden (${chosen.length})` : `${ICON.download} Mahnungen als PDF erstellen (${chosen.length})`}</button></div>`,
  })
}
registerModal('fak-dunning', dunningModal, { module: MODULE })

/** Mahnsperre für eine Rechnung oder für alle Rechnungen des Kunden. */
function blockModal(c, m) {
  const x = m.doc ? docOf(m.doc) : null
  const cu = custOf(m.customer || x?.customerId)
  m.scope ||= m.customer ? 'kunde' : 'beleg'
  const cur = (m.scope === 'kunde' ? cu?.dunningBlock : x?.dunningBlock) || {}
  return modalFrame({
    title: 'Mahnsperre',
    subtitle: esc([x?.number, customerName(cu || {}) || x?.recipient?.name].filter(Boolean).join(' · ')),
    body: `<div class="form-grid">
        ${x && cu ? `<div class="field wide seg" role="radiogroup" aria-label="Sperre für"><label class="check"><input type="radio" name="fb-scope" value="beleg" data-change="fak-block-scope" ${m.scope === 'beleg' ? 'checked' : ''}><span>nur diese Rechnung</span></label><label class="check"><input type="radio" name="fb-scope" value="kunde" data-change="fak-block-scope" ${m.scope === 'kunde' ? 'checked' : ''}><span>alle Rechnungen des Kunden</span></label></div>` : ''}
        <label class="field"><span>Nicht mahnen bis</span><input type="date" id="fb-until" value="${esc(cur.until || '')}"></label>
        <label class="field wide"><span>Grund</span><input type="text" id="fb-note" value="${esc(cur.note || '')}" placeholder="z. B. Ratenvereinbarung, Reklamation offen"></label></div>
      <p class="note">Leeres Datum: bis auf Weiteres. Die Rechnung bleibt in den offenen Posten, erscheint aber nicht im Mahnlauf und nicht in „Zu erledigen“.</p>`,
    foot: `<div class="actions">${cur.until || cur.note ? '<button class="btn danger" data-action="fak-block-clear">Sperre aufheben</button>' : ''}</div><div class="actions"><button class="btn" data-action="${m.back ? 'fak-block-back' : 'close-modal'}">Abbrechen</button><button class="btn primary" data-action="fak-block-save">Speichern</button></div>`,
  })
}
registerModal('fak-block', blockModal, { module: MODULE })

/** Zeile in den offenen Posten: Mahnsperre und „im Einzug“. */
export function openRowBadges(x) {
  const out = []
  const b = x.dunningBlock?.until || x.dunningBlock?.note ? x.dunningBlock : custOf(x.customerId)?.dunningBlock
  if (b && (b.until || b.note) && (!b.until || b.until >= todayISO())) out.push(`<span class="pill info" title="${esc(b.note || '')}">Mahnsperre${b.until ? ` bis ${esc(day(b.until))}` : ''}</span>`)
  if (inCollection(x)) out.push(`<span class="pill ok" title="SEPA-Lastschrift fällig am ${esc(day(x.directDebit.dueDate))}">im Einzug</span>`)
  else if (x.directDebit?.status === 'zurueck') out.push('<span class="pill error">Rücklastschrift</span>')
  return out.join(' ')
}

/** Über den offenen Posten: Mahnlauf und Lastschrifteinzug. */
export function openTabTools() {
  if (!editable()) return ''
  const today = todayISO()
  const due = dunningRun(F().documents, customers(), today, S()).due.length
  const dd = collectionCandidates(F().documents, customers(), today, S()).length
  return `<div class="filters"><button class="btn ${due ? 'primary' : ''}" data-action="fak-dunning-open">Mahnlauf${due ? ` (${due})` : ''}</button><button class="btn" data-action="fak-sepa-open">Lastschrifteinzug${dd ? ` (${dd})` : ''}</button></div>`
}

// ---------------------------------------------------------------- Angebote nachfassen

const offerLine = (x, extra) => `<div class="todo-item"><span class="flag ${extra.cls}">${extra.flag}</span><div class="todo-text"><button class="link-btn" data-action="fak-open" data-id="${esc(x.id)}"><strong>${esc(x.number)}</strong></button> ${esc(x.recipient?.name || '')}${x.title ? ` · ${esc(x.title)}` : ''}<br><span class="muted">${extra.text}</span></div>${editable() ? `<div class="todo-acts"><button class="btn small" data-action="fak-followup-mail-open" data-id="${esc(x.id)}">${ICON.send} Nachfassen</button> <button class="btn small ghost" data-action="fak-followup-open" data-id="${esc(x.id)}">Wiedervorlage</button></div>` : ''}</div>`

/** Reiter „Angebote & Aufträge“: Angebotsquote des Jahres, fällige Wiedervorlagen, bald ablaufende Angebote. */
export function offersPanel(year) {
  const s = S()
  const today = todayISO()
  const st = offerStats(F().documents, year, today, s)
  const t = offerTasks(F().documents, today, s)
  const b = st.byState
  const part = (k) => `${b[k].count}${b[k].count ? ` · ${money(b[k].net)}` : ''}`
  const tasks = [
    ...t.followUps.map(({ doc, date, note, auto }) => offerLine(doc, { cls: 'warning', flag: '!', text: `Wiedervorlage ${esc(day(date))}${auto ? ' (nach Versand)' : ''}${note ? `: ${esc(note)}` : ''}` })),
    ...t.expiring.map(({ doc, days }) => offerLine(doc, { cls: '', flag: days, text: `gilt nur noch ${days === 0 ? 'heute' : `${plural(days, 'Tag', 'Tage')} (bis ${esc(day(doc.validUntil))})`}` })),
  ].join('')
  return `${st.count ? `<div class="impact-stats tc-stats">${tile(`Angebote ${esc(st.year)}`, `${st.count} · ${money(st.net)}`)}${tile('angenommen', part('angenommen'), 'ok')}${tile('abgelehnt / abgelaufen', `${b.abgelehnt.count + b.abgelaufen.count} · ${money(b.abgelehnt.net + b.abgelaufen.net)}`)}${tile('offen', part('offen'))}${tile('Angebotsquote', st.rate == null ? '–' : `${String(st.rate).replace('.', ',')} %`)}</div>
    ${st.rate != null ? `<p class="muted">Angebotsquote: angenommen von den entschiedenen Angeboten (angenommen, abgelehnt, abgelaufen) nach Anzahl; nach Wert ${String(st.rateNet ?? 0).replace('.', ',')} %. Summen netto.</p>` : ''}` : ''}
    ${tasks ? `<h3>Nachfassen</h3><div class="todo-list">${tasks}</div>` : ''}`
}

/** „Zu erledigen“ auf der Übersicht der Fakturierung: Angebote nachfassen, unversendete Rechnungen, Lastschriften. */
export function laeufeTodo() {
  const ed = editable()
  const today = todayISO()
  const t = offerTasks(F().documents, today, S())
  const n = t.followUps.length + t.expiring.length
  const open = ed ? unsent().length : 0
  const dd = ed ? collectionCandidates(F().documents, customers(), today, S()).length : 0
  const pr = ed && canMail() ? paymentReminders(F().documents, customers(), today, S()).ready : []
  return [
    pr.length ? `<div class="todo-item"><span class="flag warning">${pr.length}</span><div class="todo-text"><strong>Zahlungserinnerung bereit:</strong> ${esc(pr.slice(0, 4).map((x) => x.doc.number).join(', '))}${pr.length > 4 ? ' …' : ''} – freundlich per E-Mail, nach deiner Freigabe</div><button class="btn small" data-action="fak-erinnern-open">Prüfen und senden</button></div>` : '',
    n ? `<div class="todo-item"><span class="flag warning">${n}</span><div class="todo-text"><strong>Angebote nachfassen:</strong> ${esc([...t.followUps.map((x) => x.doc.number), ...t.expiring.map((x) => `${x.doc.number} (läuft ab)`)].slice(0, 4).join(', '))}${n > 4 ? ' …' : ''}</div><button class="btn small" data-action="fak-tab" data-v="angebote">Angebote</button></div>` : '',
    open ? `<div class="todo-item"><span class="flag">${open}</span><div class="todo-text"><strong>Noch nicht versendet:</strong> festgeschriebene Rechnungen</div><button class="btn small" data-action="fak-batch-open" data-step="senden">Versenden</button></div>` : '',
    dd ? `<div class="todo-item"><span class="flag">${dd}</span><div class="todo-text"><strong>Lastschrift:</strong> offene Rechnungen von Kunden mit SEPA-Mandat</div><button class="btn small" data-action="fak-sepa-open">Einzug</button></div>` : '',
  ].join('')
}

function followUpModal(c, m) {
  const x = docOf(m.id)
  if (!x) return ''
  const f = followUpOf(x, S())
  const days = Number(S().offerFollowUpDays ?? DEFAULT_FOLLOW_UP_DAYS) || DEFAULT_FOLLOW_UP_DAYS
  return modalFrame({
    title: `Wiedervorlage ${x.number}`,
    subtitle: esc(x.recipient?.name || ''),
    body: `<div class="form-grid"><label class="field"><span>Wiedervorlage am</span><input type="date" id="fw-date" value="${esc(f && !f.done ? f.date : addDays(todayISO(), days))}"></label>
        <label class="field wide"><span>Notiz</span><input type="text" id="fw-note" value="${esc(x.followUp?.note || '')}" placeholder="z. B. Herrn Beispiel anrufen, Preis nachbessern"></label>
        ${x.followUp?.date ? `<label class="check wide"><input type="checkbox" id="fw-done" ${x.followUp?.doneAt ? 'checked' : ''}><span>erledigt</span></label>` : ''}</div>
      <p class="note">Fällige Wiedervorlagen stehen in „Zu erledigen“ und unter „Angebote & Aufträge“. Ohne eigene Wiedervorlage gilt: ${plural(days, 'Tag', 'Tage')} nach dem Versand (Einstellungen).</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="fak-followup-save" data-id="${esc(x.id)}">Speichern</button></div>`,
  })
}
registerModal('fak-followup', followUpModal, { module: MODULE })

function followUpMailModal(c, m) {
  const x = docOf(m.id)
  if (!x) return ''
  const s = S()
  const ctx = laeufeHooks.ctxFor(x)
  const block = defaultBlock(F().textBlocks, 'nachfassen', 'mail')
  m.text ??= block ? fillPlaceholders(block.text, ctx) : followUpMailText({ doc: x, greeting: ctx.Anrede, sender: app.user?.name || '', company: s.sender.name })
  const days = Number(s.offerFollowUpDays ?? DEFAULT_FOLLOW_UP_DAYS) || DEFAULT_FOLLOW_UP_DAYS
  const to = m.to ?? (x.recipient?.email || custOf(x.customerId)?.email || '')
  return modalFrame({
    title: `Angebot ${x.number} nachfassen`,
    subtitle: esc(x.recipient?.name || ''),
    wide: true,
    body: `<div class="form-grid"><label class="field wide"><span>An</span><input type="email" id="fu-to" value="${esc(to)}"></label>
        <label class="field wide"><span>Betreff</span><input type="text" id="fu-subject" value="${esc(m.subject ?? `Unser Angebot ${x.number}${x.title ? ` – ${x.title}` : ''}`)}"></label>
        <div class="field wide">${textFieldHead('Text', 'fu-text', textMenu({ target: 'fu-text', kind: 'nachfassen', place: 'mail', fill: true }))}<textarea id="fu-text" rows="9">${esc(m.text)}</textarea></div>
        <label class="check wide"><input type="checkbox" id="fu-pdf" checked><span>Angebot als PDF anhängen</span></label>
        <label class="field"><span>Nächste Wiedervorlage</span><input type="date" id="fu-next" value="${esc(addDays(todayISO(), days))}"></label></div>
      <p class="note">${canMail() ? 'Geht aus deinem Postfach.' : 'Öffnet dein E-Mail-Programm; das PDF wird heruntergeladen.'} Vermerkt wird das Nachfassen beim Angebot; die nächste Wiedervorlage gilt ab dann. Eigener Text: Textbaustein für „Angebot nachfassen“, Stelle „E-Mail-Text“.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="fak-followup-send" data-id="${esc(x.id)}">${ICON.send} ${canMail() ? 'Senden' : 'Im E-Mail-Programm öffnen'}</button></div>`,
  })
}
registerModal('fak-followup-mail', followUpMailModal, { module: MODULE })

/** Im festgeschriebenen Beleg: Wiedervorlage, Mahnsperre, Lastschrift. */
export function docExtras(x) {
  const out = []
  if (x.kind === 'angebot') {
    const f = followUpOf(x, S())
    if (f) out.push(`<p class="fak-doc-head">Wiedervorlage: <strong>${esc(day(f.date))}</strong>${f.auto ? ' (nach Versand)' : ''}${f.note ? ` · ${esc(f.note)}` : ''}${f.done ? ' · <span class="ok-text">erledigt</span>' : ''}</p>`)
  }
  if (x.kind === 'rechnung') {
    const badges = openRowBadges(x)
    if (badges) out.push(`<p class="fak-doc-head">${badges}${x.dunningBlock?.note ? ` ${esc(x.dunningBlock.note)}` : ''}${x.directDebit ? ` · Lastschrift ${esc(x.directDebit.seq || '')} fällig ${esc(day(x.directDebit.dueDate))}, ${money(x.directDebit.amount)}, Mandat ${esc(x.directDebit.mandateRef || '')}` : ''}</p>`)
    if (x.debitText) out.push(`<p class="muted">${esc(x.debitText)}</p>`)
    const notices = (x.debitNotice || []).map((n) => `<li>${esc(day(String(n.at).slice(0, 10)))}: Vorabankündigung ${n.to ? `an ${esc(n.to)}` : 'vermerkt'} für ${esc(day(n.dueDate))}</li>`).join('')
    if (notices) out.push(`<h3>Lastschrift angekündigt</h3><ul>${notices}</ul>`)
  }
  return out.join('')
}

/** Zusätzliche Knöpfe im festgeschriebenen Beleg. */
export function docButtons(x, state) {
  if (!editable()) return ''
  if (x.kind === 'angebot' && state === 'offen') return `<button class="btn" data-action="fak-followup-open" data-id="${esc(x.id)}">Wiedervorlage</button><button class="btn" data-action="fak-followup-mail-open" data-id="${esc(x.id)}">Nachfassen</button>`
  if (x.kind !== 'rechnung' || state === 'storniert') return ''
  return `${state !== 'bezahlt' ? `<button class="btn" data-action="fak-block-open" data-doc="${esc(x.id)}">Mahnsperre</button>` : ''}${x.directDebit && x.directDebit.status !== 'zurueck' ? `<button class="btn" data-action="fak-return-open" data-id="${esc(x.id)}">Rücklastschrift</button>` : ''}`
}

registerTodo({
  id: 'fakturierung-angebote',
  module: MODULE,
  title: 'Angebote nachfassen',
  compute: (today) => {
    if (!app.data?.fakturierung) return []
    const t = offerTasks(F().documents, today, S())
    const out = []
    if (t.followUps.length) out.push({ id: `fu:${t.followUps.map((x) => `${x.doc.id}.${x.date}`).join(',')}`, kind: 'fu', list: t.followUps })
    if (t.expiring.length) out.push({ id: `exp:${t.expiring.map((x) => x.doc.id).join(',')}`, kind: 'exp', list: t.expiring })
    return out
  },
  render: (items) =>
    items
      .map((x) =>
        x.kind === 'fu'
          ? `<div class="todo-item"><span class="flag warning">${x.list.length}</span><div class="todo-text"><strong>Angebot nachfassen:</strong> ${esc(x.list.slice(0, 4).map((i) => `${i.doc.number} (${i.doc.recipient?.name || ''})`).join(', '))}${x.list.length > 4 ? ' …' : ''}</div><button class="btn small" data-action="fak-goto-offers">Angebote</button></div>`
          : `<div class="todo-item"><span class="flag">${x.list.length}</span><div class="todo-text"><strong>Angebot läuft bald ab:</strong> ${esc(x.list.slice(0, 4).map((i) => `${i.doc.number} (bis ${day(i.doc.validUntil)})`).join(', '))}${x.list.length > 4 ? ' …' : ''}</div><button class="btn small" data-action="fak-goto-offers">Angebote</button></div>`,
      )
      .join(''),
})

// ---------------------------------------------------------------- Einstellungen

/** Einstellungen → Angebote: Wiedervorlage X Tage nach Versand. */
export function offerSettingsHtml(s, dis) {
  return `<h3>Angebote nachfassen</h3><div class="form-grid"><label class="field"><span>Wiedervorlage (Tage nach Versand)</span><input type="number" id="fs-followup" min="0" value="${esc(s.offerFollowUpDays ?? DEFAULT_FOLLOW_UP_DAYS)}" ${dis}></label><p class="muted wide">0: keine automatische Wiedervorlage; eine eigene je Angebot geht immer.</p></div>`
}
export const readOfferSettings = () => (document.getElementById('fs-followup') ? { offerFollowUpDays: Math.max(0, Number(val('fs-followup')) || 0) } : {})

// ---------------------------------------------------------------- Aktionen

const record = (x, text) => (x.history = [...(x.history || []), { at: nowIso(), by: by(), text }])

registerActions({
  'fak-goto-offers': () => {
    app.ui.view = 'fakturierung'
    app.ui.fakTab = 'angebote'
    closeModal()
    render()
  },
})

registerActions(
  {
    'fak-batch-open': (el) => openModal({ type: 'fak-batch', step: el.dataset.step || 'fest', ...(el.dataset.ym ? { filter: 'lauf', ym: el.dataset.ym } : {}) }),
    'fak-batch-step': (el) => {
      const m = app.ui.modal
      if (m.busy) return
      m.step = el.dataset.v
      app.ui.confirm = null
      renderModal()
    },
    'fak-batch-filter': () => {
      const m = app.ui.modal
      m.filter = val('fbt-filter') || 'alle'
      m.ym = m.filter === 'lauf' ? val('fbt-month') : ''
      m.sel = null
      app.ui.confirm = null
      renderModal()
    },
    'fak-batch-pick': (el) => {
      app.ui.modal.sel[el.dataset.id] = el.checked
      app.ui.confirm = null
      renderModal()
    },
    'fak-batch-spick': (el) => {
      app.ui.modal.sendSel[el.dataset.id] = el.checked
      renderModal()
    },
    'fak-batch-all': (el) => {
      const m = app.ui.modal
      const on = !!el.dataset.v
      if (el.dataset.step === 'senden') for (const k of Object.keys(m.sendSel || {})) m.sendSel[k] = on
      else for (const { doc, errors } of batchDrafts(F().documents, { filter: m.filter, ym: m.filter === 'lauf' ? m.ym || '' : '', settings: S(), check })) m.sel[doc.id] = on && !errors.length
      renderModal()
    },
    'fak-batch-scope': () => {
      const m = app.ui.modal
      m.scope = val('fbs-scope')
      m.sendSel = null
      renderModal()
    },
    'fak-batch-opts': () => {
      const m = app.ui.modal
      m.block = val('fbs-block')
      m.xml = checked('fbs-xml')
      renderModal()
    },
    'fak-batch-cancel': () => {
      const m = app.ui.modal
      if (m) m.cancel = true
      toast('Wird nach dem laufenden Beleg angehalten.')
    },
    'fak-batch-final': async (el) => {
      const m = app.ui.modal
      const list = batchDrafts(F().documents, { filter: m.filter, ym: m.filter === 'lauf' ? m.ym || '' : '', settings: S(), check }).filter((x) => m.sel[x.doc.id] && !x.errors.length)
      if (!list.length) return toast('Bitte Entwürfe ohne Fehler auswählen.')
      if (!confirmStep('fak-batch-final', renderModal)) return
      el.disabled = true
      m.busy = true
      m.progress = { done: 0, total: list.length, label: 'Festschreiben …' }
      renderModal()
      try {
        // erst den Stand der anderen holen (deren Nummern), dann nacheinander festschreiben und gleich speichern
        await flush()
        await app.service?.refresh?.().catch(() => [])
        const d = F()
        const r = finalizeBatch(
          list.map((x) => x.doc.id),
          d.documents,
          S(),
          { now: nowIso(), by: by(), customersById: customersById(), terms: d.paymentTerms || [], user: app.user?.name || by(), check },
        )
        d.documents = r.docs
        persist()
        await flush()
        laeufeHooks.checkNumbers()
        m.progress = { done: r.done.length, total: list.length, label: 'festgeschrieben' }
        m.ids = r.done.map((x) => x.id)
        m.step = 'senden'
        m.scope = 'lauf'
        m.sendSel = null
        m.busy = false
        rerender(m)
        renderNow()
        const numbers = r.done.map((x) => docOf(x.id)?.number).filter(Boolean)
        toast(`${plural(r.done.length, 'Beleg', 'Belege')} festgeschrieben${numbers.length ? ` (${numbers[0]}${numbers.length > 1 ? ` bis ${numbers.at(-1)}` : ''})` : ''}${r.failed.length ? `, ${r.failed.length} nicht: ${r.failed[0].error}` : ''}.`)
        // PDFs in SharePoint ablegen (im Hintergrund, wie beim Einzel-Festschreiben)
        if (app.store?.kind === 'sharepoint')
          (async () => {
            for (const id of m.ids) {
              const x = docOf(id)
              if (!x) continue
              const path = await laeufeHooks.archive(x, await laeufeHooks.docPdf(x)).catch(() => null)
              if (path) x.pdfPath = path
            }
            persist()
          })().catch(() => {})
      } catch (err) {
        m.busy = false
        rerender(m)
        toast(`Nicht festgeschrieben: ${err.message}`)
      }
    },
    'fak-batch-send': async () => {
      const m = app.ui.modal
      if (!canMail()) return toast('E-Mail-Versand aus der App ist nicht eingerichtet.')
      laeufeHooks.checkNumbers()
      const list = sendCandidates(F().documents, customers(), { ids: m.scope === 'lauf' ? m.ids || [] : null }).filter((x) => m.sendSel[x.doc.id] && emailValid(x.to))
      if (!list.length) return toast('Keine Belege mit E-Mail-Adresse ausgewählt.')
      m.busy = true
      m.cancel = false
      m.results ||= {}
      m.progress = { done: 0, total: list.length, label: 'Senden …' }
      rerender(m)
      await flush()
      let ok = 0
      for (const [i, { doc, to }] of list.entries()) {
        if (m.cancel) break
        const x = docOf(doc.id)
        try {
          if ((x.sent || []).length) throw new Error('schon versendet')
          const blob = await laeufeHooks.docPdf(x)
          const name = docFileName(x)
          const xmlOk = m.xml && isInvoice(x) && !eInvoiceProblems(x, S()).some((p) => p.level === 'error')
          const xml = xmlOk ? new Blob([laeufeHooks.eInvoiceXml(x, 'cii')], { type: 'application/xml' }) : null
          // Beilage (Winterdienst-Nachweis, Einsatzliste) wie beim Einzelversand
          const extra = await laeufeHooks.beilageFiles(x)
          await sendMail(app.auth.getToken, { to, subject: invoiceSubject(x), text: invoiceText(x, m.block || ''), attachments: [{ name, blob, type: 'application/pdf' }, ...extra, ...(xml ? [{ name: 'factur-x.xml', blob: xml, type: 'application/xml' }] : [])] }, { from: app.config.mail?.from || '' })
          x.sent = [...(x.sent || []), { at: nowIso(), to, via: 'graph', by: by(), batch: true, ...(xml ? { eInvoice: 'factur-x' } : {}), ...(extra.length ? { attachments: extra.map((f) => f.name) } : {}) }]
          const path = await laeufeHooks.archive(x, blob, name)
          if (path) x.pdfPath = path
          for (const f of extra) await laeufeHooks.archive(x, f.blob, laeufeHooks.beilageArchiveName(x, f.name))
          persist()
          ok++
          m.results[x.id] = { ok: true, text: `gesendet${extra.length ? ` mit ${extra.map((f) => f.name).join(', ')}` : ''}${xml ? ' mit factur-x.xml' : ''}` }
        } catch (err) {
          m.results[x.id] = { ok: false, text: `nicht gesendet: ${err.message}` }
        }
        m.progress = { ...m.progress, done: i + 1 }
        rerender(m)
        if (i < list.length - 1 && !m.cancel) await wait(MAIL_PAUSE_MS)
      }
      m.busy = false
      m.sendSel = null
      rerender(m)
      renderNow()
      const failed = list.filter((x) => m.results[x.doc.id] && !m.results[x.doc.id].ok).length
      toast(`${plural(ok, 'E-Mail', 'E-Mails')} gesendet${failed ? `, ${failed} mit Fehler` : ''}${m.cancel ? ' (angehalten)' : ''}.`)
    },
    'fak-batch-print': async (el) => {
      const m = app.ui.modal
      const all = sendCandidates(F().documents, customers(), { ids: m.scope === 'lauf' ? m.ids || [] : null }).filter((x) => m.sendSel[x.doc.id])
      const list = canMail() ? all.filter((x) => !emailValid(x.to)) : all
      if (!list.length) return toast('Nichts zu drucken.')
      el.disabled = true
      m.busy = true
      m.progress = { done: 0, total: list.length, label: 'Sammel-PDF …' }
      rerender(m)
      try {
        let n = 0
        await printBatch(list, {
          title: `Sammeldruck Rechnungen ${day(todayISO())}`,
          fileName: `Sammeldruck_Rechnungen_${todayISO()}.pdf`,
          makeDef: (it) => laeufeHooks.docDefinition(docOf(it.doc.id)),
          archiveName: (it) => docFileName(it.doc),
          onEach: (it) => {
            const x = docOf(it.doc.id)
            x.sent = [...(x.sent || []), { at: nowIso(), to: '', via: 'post', by: by() }]
            m.results = { ...(m.results || {}), [x.id]: { ok: true, text: 'im Sammel-PDF (per Post)' } }
            m.progress = { ...m.progress, done: ++n }
            rerender(m)
          },
        })
        persist()
        toast(`${plural(list.length, 'Beleg', 'Belege')} im Sammel-PDF; als per Post versendet vermerkt.`)
      } catch (err) {
        toast(`Sammel-PDF nicht erstellt: ${err.message}`)
      } finally {
        m.busy = false
        m.sendSel = null
        rerender(m)
        renderNow()
      }
    },

    'fak-dunning-open': () => openModal({ type: 'fak-dunning' }),
    'fak-erinnern-open': () => openModal({ type: 'fak-dunning', only: 'erinnerung' }),
    'fak-dunning-pick': (el) => {
      app.ui.modal.sel[el.dataset.id] = el.checked
      renderModal()
    },
    'fak-dunning-all': (el) => {
      const m = app.ui.modal
      for (const k of Object.keys(m.sel || {})) m.sel[k] = !!el.dataset.v
      renderModal()
    },
    'fak-dunning-opts': () => {
      app.ui.modal.block = val('fdn-block')
      renderModal()
    },
    'fak-dunning-run': async (el) => {
      const m = app.ui.modal
      laeufeHooks.checkNumbers()
      const today = todayISO()
      const s = S()
      const chosen = dunningList(m, today).filter((x) => m.sel[x.doc.id])
      if (!chosen.length) return toast('Bitte Rechnungen auswählen.')
      el.disabled = true
      m.busy = true
      m.results = {}
      m.progress = { done: 0, total: chosen.length, label: 'Mahnungen …' }
      rerender(m)
      const logo = await loadLogo().catch(() => null)
      const mailOk = canMail()
      const post = []
      let mailed = 0
      const ownBlock = m.block ? (F().textBlocks || []).find((b) => b.id === m.block) : null
      const makeDef = ({ doc, reminder: r }) => {
        const ctx = laeufeHooks.ctxFor(doc, { reminder: r, open: r.open })
        return reminderDocument({ doc, reminder: r, settings: s, brand: app.config.brand || {}, logo, today, text: laeufeHooks.reminderLetterText(doc, r), greeting: ctx.Anrede })
      }
      for (const [i, it] of chosen.entries()) {
        const x = docOf(it.doc.id)
        const r = it.reminder
        try {
          if (mailOk && emailValid(it.to)) {
            const ctx = laeufeHooks.ctxFor(x, { reminder: r, open: r.open })
            const block = ownBlock || defaultBlock(F().textBlocks, 'mahnung', 'mail')
            const text = block ? fillPlaceholders(block.text, ctx) : reminderMailText({ doc: x, reminder: r, company: s.sender.name, sender: app.user?.name || '', greeting: ctx.Anrede })
            const blob = await pdfBlob(makeDef({ doc: x, reminder: r }))
            const name = reminderFileName(x, r.level)
            await sendMail(app.auth.getToken, { to: it.to, subject: `${r.name}: Rechnung ${x.number}`, text, attachments: [{ name, blob, type: 'application/pdf' }] }, { from: app.config.mail?.from || '' })
            laeufeHooks.archive(x, blob, name)
            x.reminders = [...(x.reminders || []), { level: r.level, name: r.name, date: today, deadline: r.deadline, interest: r.interest.amount, fee: r.fee, total: r.total, sentTo: it.to, by: by() }]
            persist()
            mailed++
            m.results[x.id] = { ok: true, text: `gesendet an ${it.to}` }
            if (i < chosen.length - 1) await wait(MAIL_PAUSE_MS)
          } else post.push({ ...it, doc: x })
        } catch (err) {
          m.results[x.id] = { ok: false, text: `nicht gesendet: ${err.message}` }
        }
        m.progress = { ...m.progress, done: i + 1 - post.length }
        rerender(m)
      }
      try {
        if (post.length)
          await printBatch(post, {
            title: `Mahnungen ${day(today)}`,
            fileName: `Mahnungen_${today}.pdf`,
            makeDef: (it) => makeDef(it),
            archiveName: (it) => reminderFileName(it.doc, it.reminder.level),
            onEach: (it) => {
              const r = it.reminder
              it.doc.reminders = [...(it.doc.reminders || []), { level: r.level, name: r.name, date: today, deadline: r.deadline, interest: r.interest.amount, fee: r.fee, total: r.total, sentTo: '', via: 'post', by: by() }]
              m.results[it.doc.id] = { ok: true, text: 'im Sammel-PDF (per Post)' }
              m.progress = { ...m.progress, done: m.progress.done + 1 }
              rerender(m)
            },
          })
      } catch (err) {
        toast(`Sammel-PDF nicht erstellt: ${err.message}`)
      }
      persist()
      m.busy = false
      m.sel = null
      rerender(m)
      renderNow()
      toast(`${mailed ? `${plural(mailed, 'Mahnung', 'Mahnungen')} per E-Mail gesendet` : ''}${mailed && post.length ? ', ' : ''}${post.length ? `${plural(post.length, 'Mahnung', 'Mahnungen')} im Sammel-PDF zum Drucken` : ''}.`)
    },

    'fak-block-open': (el) => openModal({ type: 'fak-block', doc: el.dataset.doc || '', customer: el.dataset.customer || '', back: el.dataset.back || '' }),
    'fak-block-scope': (el) => {
      app.ui.modal.scope = el.value
      renderModal()
    },
    'fak-block-back': () => {
      const back = app.ui.modal?.back
      if (back) openModal({ type: back })
      else closeModal()
    },
    'fak-block-save': () => {
      const m = app.ui.modal
      const x = m.doc ? docOf(m.doc) : null
      const cu = custOf(m.customer || x?.customerId)
      const until = val('fb-until')
      const note = val('fb-note').trim()
      if (!until && !note) return toast('Bitte ein Datum oder einen Grund eintragen.')
      if (until && until < todayISO()) return toast('Das Datum liegt in der Vergangenheit.')
      const block = { until, note, by: by(), at: nowIso() }
      if (m.scope === 'kunde' && cu) cu.dunningBlock = block
      else if (x) {
        x.dunningBlock = block
        record(x, `Mahnsperre ${until ? `bis ${day(until)}` : 'bis auf Weiteres'}${note ? `: ${note}` : ''}`)
      }
      persist()
      toast(`Mahnsperre gespeichert${m.scope === 'kunde' ? ` für ${customerName(cu)}` : ''}.`)
      if (m.back) openModal({ type: m.back })
      else closeModal()
      renderNow()
    },
    'fak-block-clear': () => {
      const m = app.ui.modal
      const x = m.doc ? docOf(m.doc) : null
      const cu = custOf(m.customer || x?.customerId)
      if (m.scope === 'kunde' && cu) delete cu.dunningBlock
      else if (x) {
        delete x.dunningBlock
        record(x, 'Mahnsperre aufgehoben')
      }
      persist()
      toast('Mahnsperre aufgehoben.')
      if (m.back) openModal({ type: m.back })
      else closeModal()
      renderNow()
    },

    'fak-followup-open': (el) => openModal({ type: 'fak-followup', id: el.dataset.id }),
    'fak-followup-save': (el) => {
      const x = docOf(el.dataset.id)
      if (!x) return
      const date = val('fw-date')
      if (!date) return toast('Bitte ein Datum wählen.')
      const done = checked('fw-done')
      x.followUp = { date, note: val('fw-note').trim(), by: by(), ...(done ? { doneAt: x.followUp?.doneAt || nowIso() } : {}) }
      record(x, `Wiedervorlage ${day(date)}${x.followUp.note ? `: ${x.followUp.note}` : ''}${done ? ' (erledigt)' : ''}`)
      closeModal()
      persist()
      renderNow()
      toast(`Wiedervorlage ${x.number}: ${day(date)}.`)
    },
    'fak-followup-mail-open': (el) => openModal({ type: 'fak-followup-mail', id: el.dataset.id }),
    'fak-followup-send': async (el) => {
      const x = docOf(el.dataset.id)
      const to = val('fu-to').trim()
      if (!x) return
      if (!emailValid(to)) return toast('Bitte eine gültige E-Mail-Adresse eintragen.')
      const ctx = laeufeHooks.ctxFor(x)
      const subject = fillPlaceholders(val('fu-subject').trim(), ctx) || `Unser Angebot ${x.number}`
      const text = fillPlaceholders(val('fu-text'), ctx)
      const next = val('fu-next')
      const withPdf = checked('fu-pdf')
      el.disabled = true
      try {
        const blob = withPdf ? await laeufeHooks.docPdf(x) : null
        if (canMail()) await sendMail(app.auth.getToken, { to, subject, text, attachments: blob ? [{ name: docFileName(x), blob, type: 'application/pdf' }] : [] }, { from: app.config.mail?.from || '' })
        else {
          if (blob) download(docFileName(x), blob)
          location.href = `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?${new URLSearchParams({ subject, body: text }).toString().replace(/\+/g, '%20')}`
        }
        const now = nowIso()
        x.followUp = next ? { date: next, note: '', by: by() } : { ...(x.followUp || {}), date: x.followUp?.date || now.slice(0, 10), doneAt: now, by: by() }
        record(x, `nachgefasst per E-Mail an ${to}${next ? `, nächste Wiedervorlage ${day(next)}` : ''}`)
        closeModal()
        persist()
        renderNow()
        toast(canMail() ? `Nachfass-E-Mail an ${to} gesendet.` : `E-Mail an ${to} vorbereitet.`)
      } catch (err) {
        el.disabled = false
        toast(`Nicht gesendet: ${err.message}`)
      }
    },
  },
  { edit: MODULE },
)
