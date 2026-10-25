// Auszahlungen versenden: gesammelt an die Lohnverrechnung (wer bekommt wie
// viel, PDF + CSV) und einzeln an die Mitarbeitenden (eigene Aufstellung).
// Per E-Mail über Microsoft 365, sonst über das eigene E-Mail-Programm, als
// PDF/ZIP oder „Teilen“ am Handy. Versandstand je Empfänger:in.

import { sendMail } from '../../auth/graph-mail.js'
import { formatHours } from '../../core/dates.js'
import { euroText, mailtoUrl, monthName, parseRecipients, payoutEntries, payoutFileBase, payoutListText, payoutPersonFile, payoutPersonText, payoutSig } from '../../core/payout.js'
import { toCSV } from '../../core/reports.js'
import { payoutListDocument, payoutStatementDocument } from '../../export/payout-pdf.js'
import { app, confirmStep, persist, registerActions, registerModal, renderModal, toast } from '../context.js'
import { loadScript } from '../load-script.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { download, esc, ICON, modalFrame, signed } from '../shared.js'
import { OVERTIME_COLUMNS, payroll } from '../views/overtime.js'
import { copyText } from '../views/sheet.js'
import { canMail } from './send.js'

const fmt = (iso) => new Date(iso).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const canPdf = () => app.config.features.pdf && app.config.features.download
const canShare = () => app.config.features.pdf && typeof navigator.canShare === 'function' && typeof navigator.share === 'function'

function context(month) {
  const data = payroll(month)
  const closure = app.data.payroll?.[month]
  const closed = !!closure?.closedAt
  const entries = payoutEntries(data.rows, closure)
  const status = closed ? `abgeschlossen am ${new Date(closure.closedAt).toLocaleDateString('de-AT')}` : 'Vorschau, Monat noch nicht abgeschlossen'
  return { data, closure, closed, entries, status, sent: closure?.sent || {} }
}

const stateOf = (sent, sig) => {
  if (!sent) return { key: 'offen', label: 'noch nicht versendet', cls: 'info' }
  if (sent.sig !== sig) return { key: 'geaendert', label: `geändert seit Versand (${fmt(sent.at)})`, cls: 'warning' }
  return { key: 'aktuell', label: `${sent.via === 'PDF' ? 'PDF erstellt' : sent.via === 'manuell' ? 'als versendet markiert' : `per ${sent.via}`} ${fmt(sent.at)}`, cls: 'ok' }
}

function markSent(month, patch) {
  if (app.readOnly) return
  app.data.payroll = app.data.payroll || {}
  const entry = (app.data.payroll[month] = app.data.payroll[month] || {})
  const sent = { office: entry.sent?.office, people: { ...(entry.sent?.people || {}) } }
  const stamp = { at: new Date().toISOString(), by: app.user?.name || 'Browser' }
  if (patch.office) sent.office = { ...stamp, ...patch.office }
  for (const [id, value] of Object.entries(patch.people || {})) sent.people[id] = { ...stamp, ...value }
  entry.sent = sent
  persist()
}

const sender = () => app.user?.name || ''
const brandName = () => app.config.brand.name || ''
const officeSubject = (month) => `Auszahlungen Überstunden und Mehrarbeit ${monthName(month)}${brandName() ? ` – ${brandName()}` : ''}`
const personSubject = (month) => `Deine Auszahlung ${monthName(month)}: Überstunden und Mehrarbeit`

async function listPdf(month, ctx) {
  return pdfBlob(payoutListDocument(ctx.entries, { month, status: ctx.status, brand: app.config.brand, logo: await loadLogo() }))
}
async function personPdf(month, ctx, entries) {
  return pdfBlob(payoutStatementDocument(entries, { month, status: ctx.status, brand: app.config.brand, logo: await loadLogo(), contact: app.config.brand.contact || '' }))
}
function csvBlob(ctx) {
  const ids = new Map(ctx.entries.map((e) => [e.employee.id, e]))
  const rows = ctx.data.rows.filter((r) => ids.has(r.employee.id)).map((r) => ({ ...r, ...pick(ids.get(r.employee.id)) }))
  return new Blob([`﻿${toCSV(rows, OVERTIME_COLUMNS)}`], { type: 'text/csv;charset=utf-8' })
}
const pick = (e) => ({ wage: e.wage, amount: e.amount, taxFree: e.taxFree, accountDelta: e.accountDelta, zaBonus: e.zaBonus, ueMode: e.ueMode })

function openMailto(url) {
  const a = Object.assign(document.createElement('a'), { href: url })
  document.body.append(a)
  a.click()
  a.remove()
}

function payoutModal(c, modal) {
  const month = modal.month || c.month
  const ctx = context(month)
  const total = ctx.entries.reduce((s, e) => s + e.amount, 0)
  const paid = ctx.entries.filter((e) => e.amount)
  const to = modal.to ?? app.data.settings?.payrollMail ?? ''
  const office = stateOf(ctx.sent.office, payoutSig(ctx.entries))
  const busy = modal.busy || ''
  const people = ctx.entries.map((e) => ({ e, st: stateOf(ctx.sent.people?.[e.employee.id], payoutSig(e)) }))
  const mailable = people.filter(({ e }) => e.employee.email)
  const confirmAll = app.ui.confirm === 'po-people-mail'

  const preview = ctx.entries.length
    ? `<div class="table-wrap"><table class="data payout-list"><thead><tr><th>Mitarbeiter:in</th><th>Brutto</th><th>Zeitkonto</th></tr></thead><tbody>${ctx.entries
        .map((e) => `<tr><td><strong>${esc(e.employee.name)}</strong>${e.employee.personnelNo ? ` <span class="muted">#${esc(e.employee.personnelNo)}</span>` : ''}<br><span class="muted">${esc(e.lines.map((l) => `${formatHours(l.min)} h ${l.label}`).join(' · ') || 'nur Zeitausgleich')}</span></td><td class="num"><strong>${e.amount ? esc(euroText(e.amount)) : '–'}</strong></td><td class="num">${e.accountDelta ? signed(e.accountDelta) : '±0'}</td></tr>`)
        .join('')}<tr class="total-row"><th>Summe (${paid.length} ${paid.length === 1 ? 'Person' : 'Personen'})</th><td class="num"><strong>${esc(euroText(total))}</strong></td><td></td></tr></tbody></table></div>`
    : '<p class="empty">In diesem Monat gibt es nichts auszuzahlen.</p>'

  const officeBlock = `<section><h3>An die Lohnverrechnung (gesammelt)</h3>
      <div class="form-grid"><label class="field wide"><span>An (eine oder mehrere Adressen)</span><input type="text" id="po-to" value="${esc(to)}" placeholder="lohnverrechnung@steuerberatung.at, buchhaltung@firma.at" data-change="po-to" autocomplete="email"></label></div>
      ${preview}
      <div class="toolbar send-bulk">
        ${canMail() ? `<button class="btn primary edit-only" data-action="po-office-mail" ${ctx.entries.length ? '' : 'disabled'}>${ICON.send} E-Mail mit PDF und CSV senden</button>` : ''}
        <button class="btn ${canMail() ? '' : 'primary'}" data-action="po-office-mailto" ${ctx.entries.length ? '' : 'disabled'}>${ICON.send} Im E-Mail-Programm öffnen</button>
        ${canPdf() ? `<button class="btn" data-action="po-office-pdf" ${ctx.entries.length ? '' : 'disabled'}>${ICON.print} PDF</button><button class="btn" data-action="po-office-csv" ${ctx.entries.length ? '' : 'disabled'}>${ICON.sheet} CSV</button>` : ''}
        <button class="btn" data-action="po-office-copy" ${ctx.entries.length ? '' : 'disabled'}>${ICON.copy} Text kopieren</button>
        <span class="pill ${office.cls} name">${esc(office.label)}${ctx.sent.office?.to ? ` · ${esc(ctx.sent.office.to)}` : ''}</span>
      </div></section>`

  const rows = people
    .map(({ e, st }) => `<tr><td><strong>${esc(e.employee.name)}</strong><br><span class="muted">${e.employee.email ? esc(e.employee.email) : 'keine E-Mail'}</span></td>
      <td class="num">${e.amount ? esc(euroText(e.amount)) : '–'}${e.zaBonus ? `<br><span class="muted">ZA +${formatHours(e.zaBonus)} h</span>` : ''}</td>
      <td><span class="pill ${st.cls} name">${esc(st.label)}</span></td>
      <td class="send-acts">
        ${canPdf() ? `<button class="btn small" data-action="po-person-pdf" data-emp="${esc(e.employee.id)}">${ICON.sheet} PDF</button>` : ''}
        ${canShare() ? `<button class="btn small" data-action="po-person-share" data-emp="${esc(e.employee.id)}">${ICON.send} Teilen</button>` : ''}
        ${e.employee.email ? (canMail() ? `<button class="btn small primary edit-only" data-action="po-person-mail" data-emp="${esc(e.employee.id)}">${ICON.send} E-Mail</button>` : `<button class="btn small" data-action="po-person-mailto" data-emp="${esc(e.employee.id)}">${ICON.send} E-Mail</button>`) : ''}
      </td></tr>`)
    .join('')
  const peopleBlock = ctx.entries.length
    ? `<section><h3>An die Mitarbeitenden (einzeln)</h3>
      <div class="toolbar send-bulk">
        ${canMail() ? `<button class="btn ${confirmAll ? 'primary confirm' : 'primary'} edit-only" data-action="po-people-mail" ${mailable.length ? '' : 'disabled'}>${ICON.send} ${confirmAll ? `Wirklich ${mailable.length} E-Mails senden?` : `E-Mail an ${mailable.length} ${mailable.length === 1 ? 'Person' : 'Personen'}`}</button>` : ''}
        ${canPdf() ? `<button class="btn" data-action="po-people-pdf">${ICON.print} Ein PDF für ${ctx.entries.length} ${ctx.entries.length === 1 ? 'Person' : 'Personen'}</button><button class="btn" data-action="po-people-zip">${ICON.sheet} ZIP: je Person ein PDF</button>` : ''}
        <button class="btn edit-only" data-action="po-people-mark">Als versendet markieren</button>
      </div>
      <div class="table-wrap"><table class="data send"><thead><tr><th>Mitarbeiter:in</th><th>Betrag</th><th>Stand</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`
    : ''

  return modalFrame({
    title: `Auszahlungen ${monthName(month)} versenden`,
    subtitle: `${esc(ctx.status)} · ${paid.length} ${paid.length === 1 ? 'Person' : 'Personen'} · ${esc(euroText(total))} brutto`,
    wide: true,
    body: `${ctx.closed ? '' : `<div class="banner warn-banner"><p><strong>Noch nicht abgeschlossen.</strong> Erst abschließen, dann versenden: so stehen die Beträge fest und das Zeitkonto stimmt.</p><button class="btn primary edit-only ${app.ui.confirm === 'ot-close' ? 'confirm' : ''}" data-action="ot-close" data-month="${month}">${app.ui.confirm === 'ot-close' ? 'Jetzt abschließen?' : 'Monat abschließen'}</button></div>`}
      ${officeBlock}
      ${peopleBlock}
      ${busy ? `<p class="muted">${esc(busy)}</p>` : ''}
      <p class="note">Die Sammel-E-Mail enthält die Liste „wer bekommt wie viel“ im Text, dazu die Übersicht mit Einzelaufstellung als PDF und die Daten für den Import als CSV. ${
        canMail() ? `E-Mails gehen aus deinem Microsoft-365-Postfach${app.config.mail?.from ? ` (${esc(app.config.mail.from)})` : ''} und liegen danach unter „Gesendete Elemente“.` : '„Im E-Mail-Programm öffnen“ übernimmt Empfänger, Betreff und Text; PDF und CSV bitte anhängen. Mit Microsoft 365 (config.json → features.mail) gehen die Anhänge direkt mit.'
      } Ändern sich Beträge nach dem Versand, steht der Empfänger wieder auf „geändert seit Versand“.</p>`,
    foot: `<span></span><div class="actions"><button class="btn primary" data-action="close-modal">Fertig</button></div>`,
  })
}

registerModal('payout-send', payoutModal)

const currentMonth = () => app.ui.modal?.month || app.cur.month
const setBusy = (text) => {
  if (app.ui.modal?.type !== 'payout-send') return
  app.ui.modal.busy = text
  renderModal()
}
const recipientsNow = () => document.getElementById('po-to')?.value ?? app.ui.modal?.to ?? app.data.settings?.payrollMail ?? ''
const entryOf = (ctx, id) => ctx.entries.find((e) => e.employee.id === id)

async function withBusy(text, fn) {
  try {
    setBusy(text)
    await fn()
  } catch (err) {
    toast(err.message)
  } finally {
    setBusy('')
  }
}

registerActions({
  'po-to': (el) => {
    app.ui.modal.to = el.value
    if (!app.readOnly && el.value.trim() !== (app.data.settings?.payrollMail || '')) {
      app.data.settings = { ...(app.data.settings || {}), payrollMail: el.value.trim() }
      persist()
    }
  },
  'po-office-mailto': () => {
    const month = currentMonth()
    const ctx = context(month)
    const to = recipientsNow()
    if (!parseRecipients(to).length) return toast('Bitte eine E-Mail-Adresse der Lohnverrechnung eintragen.')
    openMailto(mailtoUrl(to, officeSubject(month), payoutListText(ctx.entries, { month, status: ctx.status, sender: sender(), brand: brandName() })))
    markSent(month, { office: { via: 'E-Mail-Programm', to: parseRecipients(to).join(', '), sig: payoutSig(ctx.entries), total: ctx.entries.reduce((s, e) => s + e.amount, 0) } })
    renderModal()
  },
  'po-office-copy': () => {
    const month = currentMonth()
    const ctx = context(month)
    copyText(payoutListText(ctx.entries, { month, status: ctx.status, sender: sender(), brand: brandName() }))
  },
  'po-office-pdf': () => {
    const month = currentMonth()
    return withBusy('PDF wird erstellt …', async () => download(`${payoutFileBase(month)}.pdf`, await listPdf(month, context(month))))
  },
  'po-office-csv': () => {
    const month = currentMonth()
    download(`${payoutFileBase(month)}.csv`, csvBlob(context(month)))
  },
  'po-person-pdf': (el) => {
    const month = currentMonth()
    const ctx = context(month)
    const e = entryOf(ctx, el.dataset.emp)
    return withBusy(`PDF für ${e.employee.name} …`, async () => {
      download(payoutPersonFile(month, e.employee.name), await personPdf(month, ctx, [e]))
      if (!ctx.sent.people?.[e.employee.id]) markSent(month, { people: { [e.employee.id]: { via: 'PDF', sig: payoutSig(e) } } })
    })
  },
  'po-person-share': async (el) => {
    const month = currentMonth()
    const ctx = context(month)
    const e = entryOf(ctx, el.dataset.emp)
    try {
      const file = new File([await personPdf(month, ctx, [e])], payoutPersonFile(month, e.employee.name), { type: 'application/pdf' })
      if (!navigator.canShare({ files: [file] })) {
        download(file.name, file)
        return toast('Teilen von Dateien wird hier nicht unterstützt: PDF wurde heruntergeladen.')
      }
      await navigator.share({ files: [file], title: personSubject(month), text: payoutPersonText(e, { month, sender: sender(), brand: brandName() }) })
      markSent(month, { people: { [e.employee.id]: { via: 'Teilen', sig: payoutSig(e) } } })
      renderModal()
    } catch (err) {
      if (err.name !== 'AbortError') toast(err.name === 'NotAllowedError' ? 'Das PDF ist bereit: bitte nochmals auf „Teilen“ tippen.' : `Teilen fehlgeschlagen: ${err.message}`)
    }
  },
  'po-person-mailto': (el) => {
    const month = currentMonth()
    const ctx = context(month)
    const e = entryOf(ctx, el.dataset.emp)
    openMailto(mailtoUrl(e.employee.email, personSubject(month), payoutPersonText(e, { month, sender: sender(), brand: brandName() })))
    markSent(month, { people: { [e.employee.id]: { via: 'E-Mail-Programm', sig: payoutSig(e) } } })
    renderModal()
  },
  'po-people-pdf': () => {
    const month = currentMonth()
    const ctx = context(month)
    return withBusy(`PDF mit ${ctx.entries.length} Seiten …`, async () => download(`${payoutFileBase(month)}_Aufstellungen.pdf`, await personPdf(month, ctx, ctx.entries)))
  },
  'po-people-zip': () => {
    const month = currentMonth()
    const ctx = context(month)
    return withBusy('ZIP wird erstellt …', async () => {
      await loadScript('vendor/jszip.min.js')
      const zip = new globalThis.JSZip()
      for (const [i, e] of ctx.entries.entries()) {
        setBusy(`PDF ${i + 1} von ${ctx.entries.length} …`)
        zip.file(payoutPersonFile(month, e.employee.name), await personPdf(month, ctx, [e]))
      }
      download(`${payoutFileBase(month)}_Aufstellungen.zip`, await zip.generateAsync({ type: 'blob' }))
    })
  },
})

async function mailPerson(month, ctx, e) {
  await sendMail(
    app.auth.getToken,
    { to: e.employee.email, subject: personSubject(month), text: payoutPersonText(e, { month, sender: sender(), brand: brandName() }), attachments: [{ name: payoutPersonFile(month, e.employee.name), blob: await personPdf(month, ctx, [e]), type: 'application/pdf' }] },
    { from: app.config.mail?.from || '' },
  )
}

registerActions(
  {
    'po-office-mail': () => {
      const month = currentMonth()
      const ctx = context(month)
      const to = parseRecipients(recipientsNow())
      if (!to.length) return toast('Bitte eine E-Mail-Adresse der Lohnverrechnung eintragen.')
      return withBusy(`E-Mail an ${to.join(', ')} …`, async () => {
        const attachments = [{ name: `${payoutFileBase(month)}.pdf`, blob: await listPdf(month, ctx), type: 'application/pdf' }, { name: `${payoutFileBase(month)}.csv`, blob: csvBlob(ctx), type: 'text/csv' }]
        await sendMail(app.auth.getToken, { to, subject: officeSubject(month), text: payoutListText(ctx.entries, { month, status: ctx.status, sender: sender(), brand: brandName() }), attachments }, { from: app.config.mail?.from || '' })
        markSent(month, { office: { via: 'E-Mail', to: to.join(', '), sig: payoutSig(ctx.entries), total: ctx.entries.reduce((s, e) => s + e.amount, 0) } })
        toast(`Auszahlungen an ${to.join(', ')} gesendet.`)
      })
    },
    'po-person-mail': (el) => {
      const month = currentMonth()
      const ctx = context(month)
      const e = entryOf(ctx, el.dataset.emp)
      return withBusy(`E-Mail an ${e.employee.name} …`, async () => {
        await mailPerson(month, ctx, e)
        markSent(month, { people: { [e.employee.id]: { via: 'E-Mail', sig: payoutSig(e) } } })
        toast(`E-Mail an ${e.employee.name} gesendet.`)
      })
    },
    'po-people-mail': async () => {
      if (!confirmStep('po-people-mail', renderModal)) return
      const month = currentMonth()
      const ctx = context(month)
      const list = ctx.entries.filter((e) => e.employee.email)
      const done = {}
      const failed = []
      for (const [i, e] of list.entries()) {
        setBusy(`Sende ${i + 1} von ${list.length}: ${e.employee.name} …`)
        try {
          await mailPerson(month, ctx, e)
          done[e.employee.id] = { via: 'E-Mail', sig: payoutSig(e) }
        } catch (err) {
          failed.push(`${e.employee.name}: ${err.message}`)
          if (/Berechtigung/.test(err.message)) break
        }
      }
      if (Object.keys(done).length) markSent(month, { people: done })
      setBusy('')
      toast(`${Object.keys(done).length} E-Mails gesendet.${failed.length ? ` Nicht gesendet: ${failed.slice(0, 2).join('; ')}${failed.length > 2 ? ' …' : ''}` : ''}`)
    },
    'po-people-mark': () => {
      const month = currentMonth()
      const ctx = context(month)
      markSent(month, { people: Object.fromEntries(ctx.entries.map((e) => [e.employee.id, { via: 'manuell', sig: payoutSig(e) }])) })
      renderModal()
      toast(`${ctx.entries.length} als versendet markiert.`)
    },
  },
  { edit: true },
)
