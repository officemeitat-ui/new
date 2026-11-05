// Fakturierung → SEPA-Lastschrift: Gläubiger-ID und Dateiformat (Einstellungen), Mandat je Kunde (Kundenblatt →
// „Lastschrift & Mahnung“, mit Vorlage als PDF zum Unterschreiben), „Lastschrifteinzug“ (offene Rechnungen von
// Kunden mit Mandat wählen, Fälligkeit mit Vorlauf, Vorabankündigung per E-Mail oder auf der Rechnung, Datei
// pain.008 herunterladen, Belege „im Einzug“) und die Rücklastschrift. Der Zahlungseingang kommt wie bisher über
// den Bankabgleich (camt); ein Eingang aus dem Einzug ist dort ein sicherer Treffer. Rechenkern: core/sepa.js.

import { sendMail } from '../../auth/graph-mail.js'
import { addDays, formatDate, todayISO } from '../../core/dates.js'
import { emailValid, mailTo } from '../../core/fak-laeufe.js'
import { customerName, defaultBlock, blocksFor, deDate, fillPlaceholders, formatIban, round2, settingsOf } from '../../core/invoicing.js'
import {
  applyCollection,
  buildCollection,
  collectionCandidates,
  collectionFileName,
  collectionSetupProblems,
  creditorIdValid,
  earliestCollection,
  inCollection,
  LEAD_DAYS,
  mandateProblems,
  mandateReferenceFor,
  messageId,
  nextTargetDay,
  noticeFits,
  pain008Problems,
  pain008Xml,
  PRE_NOTICE_DAYS,
  RETURN_REASONS,
  returnDebit,
  SCHEMES,
  SEPA_VERSIONS,
  SEQUENCES,
  sepaSettings,
  targetDay,
} from '../../core/sepa.js'
import { mandateDocument, mandateFileName } from '../../export/sepa-pdf.js'
import { app, canEdit, closeModal, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { canMail } from '../modals/send.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, download, esc, euro, ICON, modalFrame, options, val } from '../shared.js'
import { laeufeHooks } from './invoicing-laeufe.js'

const MODULE = 'fakturierung'
const F = () => app.data.fakturierung
const S = () => settingsOf(F())
const editable = () => canEdit(MODULE) && !app.readOnly
const by = () => app.user?.name || 'Browser'
const nowIso = () => new Date().toISOString()
const docOf = (id) => F().documents.find((d) => d.id === id)
const custOf = (id) => (F().customers || []).find((c) => c.id === id)
const money = (n) => euro(round2(n))
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const day = (iso) => (iso ? formatDate(iso, { weekday: false, year: true }) : '')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)
const li = (p) => `<li class="${p.level === 'error' ? 'err-text' : p.level === 'warn' ? 'warn-text' : 'muted'}">${esc(p.text)}</li>`
const live = (m) => app.ui.modal === m
const batches = () => ((F().sepa ||= { batches: [] }).batches ||= [])

// ---------------------------------------------------------------- Einstellungen

export function sepaSettingsHtml(s, dis) {
  const ss = sepaSettings(s)
  const bad = ss.creditorId && !creditorIdValid(ss.creditorId)
  return `<h3>SEPA-Lastschrift</h3>
    <div class="form-grid">
      <label class="field"><span>Gläubiger-ID (Creditor Identifier)</span><input type="text" id="fs-ci" value="${esc(ss.creditorId)}" placeholder="AT12ZZZ00000012345" maxlength="35" ${dis}></label>
      <label class="field"><span>Dateiformat</span><select id="fs-sepa-version" ${dis}>${options(Object.entries(SEPA_VERSIONS), ss.version)}</select></label>
      <label class="field"><span>Vorlauf bei der Bank (Bankarbeitstage)</span><input type="number" id="fs-sepa-lead" min="1" max="10" value="${esc(ss.leadDays)}" ${dis}></label>
      <label class="field"><span>Vorabankündigung (Tage vor dem Einzug)</span><input type="number" id="fs-sepa-notice" min="1" max="60" value="${esc(ss.preNoticeDays)}" ${dis}></label>
      <label class="check wide"><input type="checkbox" id="fs-sepa-batch" ${ss.batchBooking !== false ? 'checked' : ''} ${dis}><span>Sammelbuchung: eine Gutschrift je Einzug am Kontoauszug (sonst je Rechnung eine)</span></label>
    </div>
    ${bad ? '<p class="err-text">Die Gläubiger-ID ist ungültig (Aufbau oder Prüfziffer). In Österreich: 18 Stellen, z. B. AT12ZZZ00000012345.</p>' : ''}
    <p class="note">Die Gläubiger-ID vergibt die Oesterreichische Nationalbank (OeNB); beantragt wird sie über die Hausbank, die auch den Einzug freischalten muss. Dateiformat: pain.008.001.08 ist der aktuelle Standard (seit März 2024); .02 nur, wenn die Bank-Software .08 noch nicht annimmt. Vorabankündigung: 14 Tage, wenn im Mandat nichts Kürzeres vereinbart ist; der Vorlauf richtet sich nach dem Annahmeschluss der eigenen Bank.</p>`
}

export function readSepaSettings() {
  if (!document.getElementById('fs-ci')) return {}
  return {
    sepa: {
      creditorId: val('fs-ci').replace(/\s+/g, '').toUpperCase(),
      version: val('fs-sepa-version') || 'pain.008.001.08',
      leadDays: Math.max(1, Number(val('fs-sepa-lead')) || LEAD_DAYS),
      preNoticeDays: Math.max(1, Number(val('fs-sepa-notice')) || PRE_NOTICE_DAYS),
      batchBooking: checked('fs-sepa-batch'),
    },
  }
}

// ---------------------------------------------------------------- Kundenblatt: Lastschrift & Mahnung

/** Reiter im Kundenblatt: SEPA-Mandat und Mahnsperre. */
export function customerPayTab(v, x, dis) {
  const md = v.mandate || {}
  const has = !!String(md.reference || '').trim()
  const problems = has || md.signedAt ? mandateProblems(v, todayISO()) : []
  const b = v.dunningBlock || {}
  const ed = !dis
  return `<h3>SEPA-Lastschrift-Mandat</h3>
    <p class="muted">Konto des Kunden: ${v.iban ? `<strong>${esc(formatIban(v.iban))}</strong>${v.bic ? ` · BIC ${esc(v.bic)}` : ''}` : '<span class="warn-text">noch keine IBAN</span>'} (Stammdaten → Rechnung und Zahlung)</p>
    <div class="form-grid">
      <label class="field"><span>Mandatsreferenz</span><input type="text" id="fcm-ref" value="${esc(md.reference || '')}" maxlength="35" placeholder="z. B. ${esc(mandateReferenceFor(v, F().customers || []))}" data-input="fak-mandate-check" ${dis}></label>
      <label class="field"><span>Datum der Unterschrift</span><input type="date" id="fcm-signed" value="${esc(md.signedAt || '')}" data-change="fak-mandate-check" ${dis}></label>
      <label class="field"><span>Art</span><select id="fcm-scheme" data-change="fak-mandate-check" ${dis}>${options(Object.entries(SCHEMES), md.scheme || 'CORE')}</select></label>
      <label class="field"><span>Nächste Lastschrift</span><select id="fcm-seq" ${dis}>${options(Object.entries(SEQUENCES), md.sequence || 'FRST')}</select></label>
      <label class="field"><span>Vorabankündigung (Tage)</span><input type="number" id="fcm-days" min="1" max="60" value="${esc(md.preNoticeDays ?? '')}" placeholder="${esc(sepaSettings(S()).preNoticeDays)} (Standard)" ${dis}></label>
      <label class="check"><input type="checkbox" id="fcm-active" ${md.active === false || md.revokedAt ? '' : 'checked'} ${dis}><span>Mandat gültig (nicht widerrufen)</span></label>
      <label class="field wide"><span>Notiz</span><input type="text" id="fcm-note" value="${esc(md.note || '')}" placeholder="z. B. Original im Ordner Verträge" ${dis}></label>
    </div>
    <div id="fcm-problems">${problems.length ? `<ul class="fak-problems">${problems.map(li).join('')}</ul>` : has ? '<p class="ok-text">Mandat vollständig.</p>' : ''}</div>
    <p><button class="btn small" data-action="fak-mandate-pdf">${ICON.download} Mandat als PDF zum Unterschreiben</button>${ed && !has ? ' <button class="btn small ghost" data-action="fak-mandate-ref">Referenz vorschlagen</button>' : ''}${md.lastCollection ? ` <span class="muted">letzter Einzug ${esc(day(md.lastCollection))}</span>` : ''}</p>
    <h3>Mahnsperre</h3>
    <div class="form-grid">
      <label class="field"><span>Nicht mahnen bis</span><input type="date" id="fcb-until" value="${esc(b.until || '')}" ${dis}></label>
      <label class="field wide"><span>Grund</span><input type="text" id="fcb-note" value="${esc(b.note || '')}" placeholder="z. B. Ratenvereinbarung bis Jahresende" ${dis}></label>
    </div>
    <p class="note">Mandat: Referenz und Datum der Unterschrift stehen in jeder Lastschrift. Basis-Lastschrift (CORE): der Kunde kann 8 Wochen lang die Erstattung verlangen. Firmen-Lastschrift (B2B): nur für Unternehmen, ohne Erstattung; der Kunde muss das Mandat seiner Bank bestätigen. Ein Mandat verfällt nach 36 Monaten ohne Lastschrift. Die Mahnsperre gilt für alle Rechnungen dieses Kunden (leeres Datum: bis auf Weiteres).</p>`
}

/** Felder des Reiters in den Entwurf des Kunden (null entfernt Mandat bzw. Sperre). */
export function readCustomerPay(v) {
  if (!document.getElementById('fcm-ref')) return v
  const reference = val('fcm-ref').trim()
  const signedAt = val('fcm-signed')
  if (reference || signedAt) {
    const active = checked('fcm-active')
    const days = val('fcm-days')
    v.mandate = {
      ...(v.mandate || {}),
      reference,
      signedAt,
      scheme: val('fcm-scheme') || 'CORE',
      sequence: val('fcm-seq') || 'FRST',
      preNoticeDays: days === '' ? '' : Math.max(1, Number(days) || PRE_NOTICE_DAYS),
      active,
      revokedAt: active ? '' : v.mandate?.revokedAt || todayISO(),
      note: val('fcm-note').trim(),
    }
  } else if (v.mandate) v.mandate = null
  const until = val('fcb-until')
  const note = val('fcb-note').trim()
  if (until || note) v.dunningBlock = { ...(v.dunningBlock || {}), until, note, by: by(), at: v.dunningBlock?.at || nowIso() }
  else if (v.dunningBlock) v.dunningBlock = null
  return v
}

// ---------------------------------------------------------------- Lastschrifteinzug

const NOTICE_TEXT = `{Anrede},

den Betrag von {Einzugsbetrag} zu unserer Rechnung {Belegnummer} vom {Datum} ziehen wir am {Einzugstag} mit SEPA-Lastschrift von Ihrem Konto {Konto} ein.
Mandatsreferenz: {Mandatsreferenz}
Gläubiger-ID: {Gläubiger-ID}

Bitte sorgen Sie für Deckung; eine Überweisung ist nicht nötig.

Mit freundlichen Grüßen
{Benutzer}
{Firma}`

/** Platzhalter der Vorabankündigung zu einem Kandidaten und Einzugstag. */
function noticeContext(it, date) {
  const s = S()
  const iban = formatIban(it.customer.iban)
  return { ...laeufeHooks.ctxFor(it.doc), Einzugstag: deDate(date), Einzugsbetrag: money(it.open), Mandatsreferenz: it.mandate.reference, 'Gläubiger-ID': sepaSettings(s).creditorId, Konto: iban.length > 9 ? `${iban.slice(0, 4)} **** ${iban.slice(-4)}` : iban }
}

/** Zustand eines Kandidaten für den Einzugstag date. */
function rowState(it, date, today) {
  if (it.problems.length) return { ready: false, fix: 'mandat', text: it.problems[0].text }
  if (!it.notice) {
    const can = daysBetween(today, date) >= it.preNotice
    return { ready: false, fix: can ? 'notice' : 'later', text: can ? 'Vorabankündigung fehlt' : `Vorabankündigung fehlt; mit Ankündigung heute frühestens am ${deDate(nextTargetDay(addDays(today, it.preNotice)))}` }
  }
  if (noticeFits(it.notice, date, it.preNotice)) return { ready: true, text: `angekündigt ${it.notice.via === 'mail' ? 'per E-Mail' : 'auf der Rechnung'} für ${deDate(it.notice.dueDate)}` }
  const can = daysBetween(today, date) >= it.preNotice
  if (date < it.notice.dueDate) return { ready: false, fix: can ? 'notice' : 'later', text: `angekündigt für ${deDate(it.notice.dueDate)}, nicht früher einziehen` }
  return { ready: false, fix: can ? 'notice' : 'later', text: `Ankündigung zu spät (am ${deDate(it.notice.date)}, ${plural(it.preNotice, 'Tag', 'Tage')} nötig)` }
}

/** Vorgeschlagener Einzugstag: frühestmöglich für die Kandidaten (Vorlauf der Bank, Ankündigung, Frist). */
function defaultDate(list, today, earliest) {
  const best = list.filter((it) => !it.problems.length).map((it) => (it.notice ? [it.notice.dueDate, addDays(it.notice.date, it.preNotice), earliest].sort().at(-1) : [earliest, addDays(today, it.preNotice)].sort().at(-1)))
  return nextTargetDay(best.length ? best.sort()[0] : earliest)
}

function sepaModal(c, m) {
  const s = S()
  const ss = sepaSettings(s)
  const today = todayISO()
  const earliest = earliestCollection(today, ss.leadDays)
  const list = collectionCandidates(F().documents, F().customers || [], today, s)
  m.date ||= defaultDate(list, today, earliest)
  const date = m.date
  const states = new Map(list.map((it) => [it.doc.id, rowState(it, date, today)]))
  m.sel ||= Object.fromEntries(list.filter((it) => states.get(it.doc.id).ready || states.get(it.doc.id).fix === 'notice').map((it) => [it.doc.id, true]))
  const chosen = list.filter((it) => m.sel[it.doc.id])
  const ready = chosen.filter((it) => states.get(it.doc.id).ready)
  const needNotice = chosen.filter((it) => states.get(it.doc.id).fix === 'notice')
  const mailOk = canMail()
  const setup = collectionSetupProblems(s)
  const dateErr = date < earliest ? `Zu früh: frühestens am ${deDate(earliest)} (${plural(Number(ss.leadDays) || LEAD_DAYS, 'Bankarbeitstag', 'Bankarbeitstage')} Vorlauf).` : !targetDay(date) ? `${deDate(date)} ist kein Bankarbeitstag (TARGET).` : ''
  const sum = round2(ready.reduce((a, it) => a + it.open, 0))
  const rows = list
    .map((it) => {
      const st = states.get(it.doc.id)
      const res = m.results?.[it.doc.id]
      return `<tr><td><input type="checkbox" data-change="fak-sepa-pick" data-id="${esc(it.doc.id)}" ${m.sel[it.doc.id] ? 'checked' : ''} ${it.problems.length ? 'disabled' : ''} aria-label="auswählen"></td>
        <td><button class="link-btn" data-action="fak-open" data-id="${esc(it.doc.id)}">${esc(it.doc.number)}</button>${it.returned ? ' <span class="pill error">Rücklastschrift</span>' : ''}<br><span class="muted">${esc(customerName(it.customer))}</span></td>
        <td>${esc(day(it.doc.dueDate))}</td><td class="num"><strong>${money(it.open)}</strong></td>
        <td>${esc(it.mandate.reference)}<br><span class="muted">${esc(it.mandate.scheme === 'B2B' ? 'B2B' : 'CORE')} · ${esc(it.mandate.sequence === 'RCUR' ? 'RCUR' : 'FRST')}</span></td>
        <td><span class="${st.ready ? 'ok-text' : st.fix === 'mandat' ? 'err-text' : 'warn-text'}">${esc(st.text)}</span>${res ? `<br><span class="${res.ok ? 'ok-text' : 'err-text'}">${esc(res.text)}</span>` : ''}</td></tr>`
    })
    .join('')
  const pending = F().documents.filter(inCollection)
  const recent = batches().slice(-5).reverse()
  const blocks = blocksFor(F().textBlocks, 'lastschrift', 'mail')
  return modalFrame({
    title: 'Lastschrifteinzug',
    subtitle: `SEPA-Lastschrift · ${esc(ss.version)}`,
    wide: true,
    body: `${setup.length ? `<div class="banner warn-banner"><ul class="fak-problems">${setup.map(li).join('')}</ul>${editable() ? '<button class="btn" data-action="fak-tab" data-v="einstellungen">Einstellungen</button>' : ''}</div>` : ''}
      <div class="filters"><label class="field inline"><span>Einzugstag (Fälligkeit)</span><input type="date" id="fsd-date" value="${esc(date)}" min="${esc(earliest)}" data-change="fak-sepa-date"></label>
        <span class="muted">frühestens ${esc(day(earliest))}</span><span class="spacer"></span>
        ${list.length ? `<button class="btn small ghost" data-action="fak-sepa-all" data-v="1">alle</button><button class="btn small ghost" data-action="fak-sepa-all" data-v="">keine</button>` : ''}</div>
      ${dateErr ? `<p class="err-text">${esc(dateErr)}</p>` : ''}
      ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th></th><th>Rechnung</th><th>fällig</th><th class="num">Betrag</th><th>Mandat</th><th>Vorabankündigung</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine offenen Rechnungen von Kunden mit SEPA-Mandat. Mandate stehen im Kundenblatt unter „Lastschrift &amp; Mahnung“.</p>'}
      ${m.progress ? `<div role="status" aria-live="polite"><progress max="${m.progress.total}" value="${m.progress.done}" style="width:100%"></progress><p class="muted">${esc(m.progress.label)} ${m.progress.done} von ${m.progress.total}</p></div>` : ''}
      ${needNotice.length ? `<div class="filters"><label class="field inline"><span>Text der Ankündigung</span><select id="fsd-block" data-change="fak-sepa-block">${options([['', 'Standardtext'], ...blocks.map((b) => [b.id, b.name || 'Textbaustein'])], m.block || '')}</select></label></div>` : ''}
      ${pending.length ? `<h3>Im Einzug (${pending.length})</h3><ul>${pending.map((d) => `<li><button class="link-btn" data-action="fak-open" data-id="${esc(d.id)}">${esc(d.number)}</button> ${esc(d.recipient?.name || '')} · ${money(d.directDebit.amount)} fällig ${esc(day(d.directDebit.dueDate))} (${esc(d.directDebit.seq)})${editable() ? ` <button class="link-btn" data-action="fak-return-open" data-id="${esc(d.id)}">Rücklastschrift</button>` : ''}</li>`).join('')}</ul>` : ''}
      ${recent.length ? `<details><summary>Letzte Einzüge</summary><ul>${recent.map((b) => `<li>${esc(day(String(b.createdAt).slice(0, 10)))}: ${plural(b.count, 'Lastschrift', 'Lastschriften')}, ${money(b.sum)}, fällig ${esc(day(b.dueDate))} · ${esc(b.file || b.msgId)}${b.by ? ` · ${esc(b.by)}` : ''}</li>`).join('')}</ul></details>` : ''}
      <p class="note">Ablauf: Einzugstag wählen; Rechnungen mit Lastschrift-Hinweis sind schon angekündigt, die übrigen bekommen die Vorabankündigung per E-Mail (Frist laut Mandat, sonst ${esc(ss.preNoticeDays)} Tage). Dann „Lastschriftdatei erstellen“, die Datei im Online-Banking (z. B. George Business, ELBA, BusinessNet) hochladen und freigeben. Die Rechnungen stehen danach „im Einzug“ und werden nicht gemahnt; der Eingang wird im Bankabgleich sicher erkannt. Kommt eine Lastschrift zurück: „Rücklastschrift“ beim Beleg.</p>`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">
      ${needNotice.length ? (mailOk ? `<button class="btn" data-action="fak-sepa-notice" ${m.busy ? 'disabled' : ''}>${ICON.send} Vorabankündigung per E-Mail (${needNotice.length})</button>` : '') + `<button class="btn ghost" data-action="fak-sepa-noted" title="z. B. per Brief oder telefonisch angekündigt" ${m.busy ? 'disabled' : ''}>Als angekündigt vermerken (${needNotice.length})</button>` : ''}
      <button class="btn primary" data-action="fak-sepa-file" ${ready.length && !setup.some((p) => p.level === 'error') && !dateErr && !m.busy ? '' : 'disabled'}>${ICON.download} Lastschriftdatei erstellen (${ready.length}${ready.length ? `, ${money(sum)}` : ''})</button></div>`,
  })
}
registerModal('fak-sepa', sepaModal, { module: MODULE })

function returnModal(c, m) {
  const x = docOf(m.id)
  if (!x?.directDebit) return ''
  const dd = x.directDebit
  return modalFrame({
    title: `Rücklastschrift ${x.number}`,
    subtitle: `${esc(x.recipient?.name || '')} · ${money(dd.amount)} vom ${esc(day(dd.dueDate))}`,
    body: `<div class="form-grid"><label class="field"><span>Datum (Kontoauszug)</span><input type="date" id="frd-date" value="${esc(todayISO())}"></label>
        <label class="field"><span>Grund laut Bank</span><select id="frd-reason">${options(Object.entries(RETURN_REASONS).map(([k, v]) => [k, `${k} – ${v}`]), 'AM04', { empty: '– unbekannt –' })}</select></label>
        <label class="field"><span>Bankspesen (€)</span><input type="text" inputmode="decimal" id="frd-fee" placeholder="0,00"></label></div>
      <p class="note">Die Rechnung ist danach wieder offen (eine schon gebuchte Zahlung wird gegengebucht) und kann gemahnt oder neu eingezogen werden; war es die erste Lastschrift, ist die nächste wieder „FRST“. Bankspesen nur weiterverrechnen, wenn das vereinbart ist (eigene Rechnung). Bei Widerspruch (MS02, MD06) den Kunden kontaktieren, nicht einfach neu einziehen.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="fak-return-save" data-id="${esc(x.id)}">Rücklastschrift erfassen</button></div>`,
  })
}
registerModal('fak-return', returnModal, { module: MODULE })

// ---------------------------------------------------------------- Aktionen

const candidatesNow = () => collectionCandidates(F().documents, F().customers || [], todayISO(), S())

registerActions({
  'fak-mandate-pdf': async (el) => {
    const m = app.ui.modal
    if (m?.type !== 'fak-cust') return
    const v = readCustomerPay(m.draft)
    el.disabled = true
    try {
      const doc = mandateDocument({ customer: { ...v, name: customerName(v) }, mandate: v.mandate || { scheme: val('fcm-scheme') || 'CORE' }, settings: S(), brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })
      download(mandateFileName(v, v.mandate || {}), await pdfBlob(doc))
    } catch (err) {
      toast(`PDF nicht erstellt: ${err.message}`)
    } finally {
      el.disabled = false
    }
  },
  'fak-mandate-check': () => {
    const m = app.ui.modal
    if (m?.type !== 'fak-cust') return
    const v = readCustomerPay(m.draft)
    const box = document.getElementById('fcm-problems')
    const list = v.mandate ? mandateProblems(v, todayISO()) : []
    if (box) box.innerHTML = list.length ? `<ul class="fak-problems">${list.map(li).join('')}</ul>` : v.mandate ? '<p class="ok-text">Mandat vollständig.</p>' : ''
  },
})

registerActions(
  {
    'fak-mandate-ref': () => {
      const m = app.ui.modal
      const field = document.getElementById('fcm-ref')
      if (!field || m?.type !== 'fak-cust') return
      field.value = mandateReferenceFor(m.draft, F().customers || [])
      field.dispatchEvent(new Event('input', { bubbles: true }))
    },
    'fak-sepa-open': () => openModal({ type: 'fak-sepa' }),
    'fak-sepa-date': () => {
      const m = app.ui.modal
      m.date = val('fsd-date') || m.date
      m.sel = null
      renderModal()
    },
    'fak-sepa-pick': (el) => {
      app.ui.modal.sel[el.dataset.id] = el.checked
      renderModal()
    },
    'fak-sepa-all': (el) => {
      const m = app.ui.modal
      for (const it of candidatesNow()) if (!it.problems.length) m.sel[it.doc.id] = !!el.dataset.v
      renderModal()
    },
    'fak-sepa-block': () => {
      app.ui.modal.block = val('fsd-block')
    },
    'fak-sepa-notice': async () => {
      const m = app.ui.modal
      if (!canMail()) return toast('E-Mail-Versand aus der App ist nicht eingerichtet.')
      const today = todayISO()
      const list = candidatesNow().filter((it) => m.sel[it.doc.id] && rowState(it, m.date, today).fix === 'notice')
      if (!list.length) return
      m.busy = true
      m.results = {}
      m.progress = { done: 0, total: list.length, label: 'Vorabankündigung …' }
      renderModal()
      const own = m.block ? (F().textBlocks || []).find((b) => b.id === m.block) : defaultBlock(F().textBlocks, 'lastschrift', 'mail')
      let ok = 0
      for (const [i, it] of list.entries()) {
        const x = docOf(it.doc.id)
        const to = mailTo(x, it.customer)
        try {
          if (!emailValid(to)) throw new Error('keine E-Mail-Adresse')
          const ctx = noticeContext(it, m.date)
          await sendMail(app.auth.getToken, { to, subject: `Ankündigung SEPA-Lastschrift: Rechnung ${x.number}`, text: fillPlaceholders(own?.text || NOTICE_TEXT, ctx) }, { from: app.config.mail?.from || '' })
          x.debitNotice = [...(x.debitNotice || []), { at: nowIso(), to, dueDate: m.date, amount: it.open, by: by() }]
          persist()
          ok++
          m.results[x.id] = { ok: true, text: `angekündigt an ${to}` }
        } catch (err) {
          m.results[x.id] = { ok: false, text: `nicht angekündigt: ${err.message}` }
        }
        m.progress = { ...m.progress, done: i + 1 }
        if (live(m)) renderModal()
        if (i < list.length - 1) await wait(2100)
      }
      m.busy = false
      m.sel = null
      if (live(m)) renderModal()
      toast(`${plural(ok, 'Vorabankündigung', 'Vorabankündigungen')} gesendet.`)
    },
    'fak-sepa-noted': () => {
      const m = app.ui.modal
      const today = todayISO()
      const list = candidatesNow().filter((it) => m.sel[it.doc.id] && rowState(it, m.date, today).fix === 'notice')
      for (const it of list) {
        const x = docOf(it.doc.id)
        x.debitNotice = [...(x.debitNotice || []), { at: nowIso(), to: '', dueDate: m.date, amount: it.open, by: by(), via: 'vermerk' }]
      }
      persist()
      m.sel = null
      renderModal()
      toast(`${plural(list.length, 'Rechnung', 'Rechnungen')} als angekündigt vermerkt (für ${deDate(m.date)}).`)
    },
    'fak-sepa-file': async (el) => {
      const m = app.ui.modal
      const s = S()
      const ss = sepaSettings(s)
      const today = todayISO()
      const items = candidatesNow().filter((it) => m.sel[it.doc.id] && rowState(it, m.date, today).ready)
      if (!items.length) return toast('Keine Rechnung bereit für den Einzug.')
      if (m.date < earliestCollection(today, ss.leadDays) || !targetDay(m.date)) return toast('Bitte einen gültigen Einzugstag wählen.')
      const built = buildCollection(items, { dueDate: m.date })
      const creditor = { name: s.sender.name, iban: s.bank.iban, bic: s.bank.bic, ci: ss.creditorId }
      const errors = pain008Problems({ creditor, payments: built.payments }).filter((p) => p.level === 'error')
      if (errors.length) return toast(errors[0].text)
      el.disabled = true
      const at = nowIso()
      const msgId = messageId(at)
      const xml = pain008Xml({ version: ss.version, msgId, createdAt: at, creditor, payments: built.payments, batchBooking: ss.batchBooking !== false })
      const file = collectionFileName(msgId, m.date)
      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' })
      download(file, blob)
      let path = ''
      if (app.store?.kind === 'sharepoint') {
        try {
          path = `fakturierung/lastschrift/${m.date.slice(0, 4)}/${file}`
          await app.store.upload(path, blob, 'application/xml')
        } catch (err) {
          path = ''
          toast(`Datei nicht in SharePoint abgelegt: ${err.message}`)
        }
      }
      const batch = applyCollection(F().documents, F().customers || [], built, { msgId, dueDate: m.date, version: ss.version, at, by: by(), file })
      batches().push({ ...batch, ...(path ? { path } : {}) })
      persist()
      m.sel = null
      m.results = {}
      if (live(m)) renderModal()
      renderNow()
      toast(`Lastschriftdatei ${file}: ${plural(built.count, 'Lastschrift', 'Lastschriften')}, ${money(built.sum)}, fällig ${deDate(m.date)}. Jetzt im Online-Banking hochladen und freigeben.`)
    },
    'fak-return-open': (el) => openModal({ type: 'fak-return', id: el.dataset.id }),
    'fak-return-save': (el) => {
      const x = docOf(el.dataset.id)
      if (!x) return
      try {
        const r = returnDebit(x, custOf(x.customerId), { date: val('frd-date') || todayISO(), reason: val('frd-reason'), fee: val('frd-fee'), at: nowIso(), by: by(), newId: () => `p${Math.random().toString(36).slice(2, 10)}` })
        closeModal()
        persist()
        renderNow()
        toast(`Rücklastschrift erfasst${r.booked ? `, Zahlung ${money(r.booked)} gegengebucht` : ''}: ${x.number} ist wieder offen.`)
      } catch (err) {
        toast(err.message)
      }
    },
  },
  { edit: MODULE },
)
