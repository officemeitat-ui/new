// Versand der Wochenpläne an die Mitarbeitenden: PDF je Person, Teilen
// (am Handy z. B. WhatsApp, Signal, Mail), E-Mail über Microsoft 365 und
// Versandstand je Person („aktuell“ oder „geändert seit Versand“).

import { sendMail } from '../../auth/graph-mail.js'
import { formatDate, isoWeek } from '../../core/dates.js'
import { timesheetSignature } from '../../core/timesheet.js'
import { addLog, app, confirmStep, openModal, persist, registerActions, registerModal, renderModal, toast } from '../context.js'
import { allPdfName, pdfFileName, weekPdfBlob, weekPdfZip } from '../pdf.js'
import { changeMessage } from '../planning.js'
import { download, esc, ICON, modalFrame } from '../shared.js'
import { weekFileBase } from '../../export/excel.js'

const fmt = (iso) => new Date(iso).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
export const canMail = () => !!(app.config.features.mail && app.store?.kind === 'sharepoint' && app.auth)
const canShare = () => typeof navigator.canShare === 'function' && typeof navigator.share === 'function'

/** Versandstand einer Person in der Woche. */
export function sendState(c, emp) {
  const sent = c.published?.sent?.[emp.id]
  if (!sent) return { key: 'offen', label: 'noch nicht versendet', cls: 'info' }
  if (sent.sig !== timesheetSignature(c.timesheet(emp))) return { key: 'geaendert', label: `geändert seit Versand (${fmt(sent.at)})`, cls: 'warning' }
  return { key: 'aktuell', label: `${sent.via === 'PDF' ? 'PDF erstellt' : sent.via === 'manuell' ? 'als versendet markiert' : `per ${sent.via}`} ${fmt(sent.at)}`, cls: 'ok' }
}

/** Personen, denen der aktuelle Stand noch nicht zugestellt wurde. */
export const toSend = (c) => c.ctx.employees.filter((e) => sendState(c, e).key !== 'aktuell')

function markSent(c, employees, via) {
  const p = app.data.published?.[c.monday]
  if (!p || app.readOnly) return
  const at = new Date().toISOString()
  const by = app.user?.name || 'Browser'
  p.sent = { ...(p.sent || {}) }
  for (const emp of employees) p.sent[emp.id] = { at, by, via, sig: timesheetSignature(c.timesheet(emp)) }
  addLog(c.monday, `Versand (${via}): ${employees.length === 1 ? employees[0].name : `${employees.length} Personen`}`)
  persist()
}

function mailText(c, emp) {
  const { week } = isoWeek(c.monday)
  const changed = !!c.published?.sent?.[emp.id]
  const days = changeMessage(c, emp).split('\n').slice(1)
  return [
    `Hallo ${emp.name.split(' ')[0]},`,
    '',
    `im Anhang dein Dienstplan für KW ${week} (${formatDate(c.monday, { weekday: false })}–${formatDate(c.sunday, { weekday: false, year: true })})${changed ? '. Das ist eine geänderte Fassung, Änderungen sind rot markiert' : ''}.`,
    '',
    ...(days.length ? ['Deine Einsätze:', ...days, ''] : ['Diese Woche hast du keine Einsätze.', '']),
    'Bei Fragen bitte melden.',
    '',
    'Liebe Grüße',
    app.user?.name || '',
    app.config.brand.name,
  ].join('\n')
}

const FILTERS = [
  ['todo', 'Zu versenden'],
  ['all', 'Alle'],
  ['done', 'Aktuell versendet'],
]

function sendModal(c, modal) {
  const filter = modal.filter || 'todo'
  const p = c.published
  const states = new Map(c.ctx.employees.map((e) => [e.id, sendState(c, e)]))
  const list = c.ctx.employees.filter((e) => filter === 'all' || (filter === 'done') === (states.get(e.id).key === 'aktuell'))
  const counts = { todo: c.ctx.employees.filter((e) => states.get(e.id).key !== 'aktuell').length, all: c.ctx.employees.length, done: c.ctx.employees.filter((e) => states.get(e.id).key === 'aktuell').length }
  const mailable = list.filter((e) => e.email)
  const busy = modal.busy || ''
  const rows = list
    .map((e) => {
      const st = states.get(e.id)
      return `<tr><td><strong>${esc(e.name)}</strong><br><span class="muted">${esc(e.team || e.type)}</span></td>
        <td>${e.email ? esc(e.email) : '<span class="muted">keine E-Mail</span>'}</td>
        <td><span class="pill ${st.cls} name">${esc(st.label)}</span></td>
        <td class="send-acts">
          <button class="btn small" data-action="send-pdf" data-emp="${esc(e.id)}" title="PDF herunterladen">${ICON.sheet} PDF</button>
          ${canShare() ? `<button class="btn small" data-action="send-share" data-emp="${esc(e.id)}" title="Am Handy z. B. per WhatsApp senden">${ICON.send} Teilen</button>` : ''}
          ${canMail() && e.email && p ? `<button class="btn small primary edit-only" data-action="send-mail" data-emp="${esc(e.id)}">${ICON.send} E-Mail</button>` : ''}
        </td></tr>`
    })
    .join('')
  const confirmAll = app.ui.confirm === 'send-mail-all'
  return modalFrame({
    title: `KW ${isoWeek(c.monday).week} an Mitarbeitende versenden`,
    subtitle: p ? `Veröffentlicht am ${new Date(p.publishedAt).toLocaleDateString('de-AT')}${p.correctedAt ? `, korrigiert am ${new Date(p.correctedAt).toLocaleDateString('de-AT')}` : ''}` : 'Entwurf',
    wide: true,
    body: `${
      p
        ? ''
        : `<div class="banner warn-banner"><p><strong>Noch nicht veröffentlicht.</strong> Erst veröffentlichen, dann versenden: so stimmen Zeitkonto und Versandstand. PDFs zur Vorschau sind trotzdem möglich (Vermerk „Entwurf“).</p><button class="btn primary edit-only" data-action="open-publish">${ICON.send} Veröffentlichen</button></div>`
    }
      <div class="filters">${FILTERS.map(([k, label]) => `<button class="filter" data-action="send-filter" data-filter="${k}" aria-pressed="${filter === k}">${label} <span class="muted">${counts[k]}</span></button>`).join('')}</div>
      <div class="toolbar send-bulk">
        <button class="btn" data-action="send-all-pdf" ${list.length ? '' : 'disabled'}>${ICON.print} ${list.length === 1 ? 'PDF' : `Ein PDF für ${list.length} Personen`}</button>
        <button class="btn" data-action="send-zip" ${list.length ? '' : 'disabled'}>${ICON.sheet} ZIP: je Person ein PDF</button>
        ${canMail() && p ? `<button class="btn ${confirmAll ? 'primary confirm' : 'primary'} edit-only" data-action="send-mail-all" ${mailable.length ? '' : 'disabled'}>${ICON.send} ${confirmAll ? `Wirklich ${mailable.length} E-Mails senden?` : `E-Mail an ${mailable.length} ${mailable.length === 1 ? 'Person' : 'Personen'}`}</button>` : ''}
        ${p && filter !== 'done' ? `<button class="btn edit-only" data-action="send-mark" ${list.length ? '' : 'disabled'} title="z. B. ausgedruckt und übergeben">Als versendet markieren</button>` : ''}
        ${busy ? `<span class="muted">${esc(busy)}</span>` : ''}
      </div>
      ${list.length ? `<div class="table-wrap"><table class="data send"><thead><tr><th>Mitarbeiter:in</th><th>E-Mail</th><th>Stand</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Alle haben den aktuellen Stand.</p>'}
      <p class="note">Das PDF enthält je Person eine Seite im gewohnten Layout mit Adressen, Hinweisen zu den Objekten und Zeitkonto. „Teilen“ öffnet am Handy WhatsApp, Signal oder Mail mit dem PDF im Anhang.${
        canMail() ? ' E-Mails gehen aus deinem Microsoft-365-Postfach' + (app.config.mail?.from ? ` (${esc(app.config.mail.from)})` : '') + ' und liegen danach unter „Gesendete Elemente“.' : app.store?.kind === 'sharepoint' ? ' E-Mail-Versand direkt aus dem Dienstplan lässt sich in config.json einschalten (features.mail).' : ''
      } Wird ein Plan nach dem Versand geändert, steht die Person wieder unter „Zu versenden“.</p>`,
    foot: `<span></span><div class="actions"><button class="btn primary" data-action="close-modal">Fertig</button></div>`,
  })
}

registerModal('send', sendModal)

const empOf = (id) => app.cur.ctx.employeesById.get(id)
const setBusy = (text) => {
  if (app.ui.modal?.type !== 'send') return
  app.ui.modal.busy = text
  renderModal()
}

async function mailOne(c, emp) {
  const blob = await weekPdfBlob(c, [emp])
  await sendMail(
    app.auth.getToken,
    { to: emp.email, subject: `Dienstplan KW ${isoWeek(c.monday).week} (${formatDate(c.monday, { weekday: false })}–${formatDate(c.sunday, { weekday: false, year: true })})`, text: mailText(c, emp), attachments: [{ name: pdfFileName(c.monday, emp.name), blob, type: 'application/pdf' }] },
    { from: app.config.mail?.from || '' },
  )
}

registerActions({
  'open-send': () => openModal({ type: 'send' }),
  'send-filter': (el) => {
    app.ui.modal.filter = el.dataset.filter
    app.ui.confirm = null
    renderModal()
  },
  'send-pdf': async (el) => {
    const c = app.cur
    const emp = empOf(el.dataset.emp)
    try {
      setBusy(`PDF für ${emp.name} wird erstellt …`)
      download(pdfFileName(c.monday, emp.name), await weekPdfBlob(c, [emp]))
      if (c.published && !c.published.sent?.[emp.id]) markSent(c, [emp], 'PDF')
      setBusy('')
    } catch (err) {
      setBusy('')
      toast(`PDF fehlgeschlagen: ${err.message}`)
    }
  },
  'send-share': async (el) => {
    const c = app.cur
    const emp = empOf(el.dataset.emp)
    try {
      const file = new File([await weekPdfBlob(c, [emp])], pdfFileName(c.monday, emp.name), { type: 'application/pdf' })
      if (!navigator.canShare({ files: [file] })) {
        download(file.name, file)
        return toast('Teilen von Dateien wird hier nicht unterstützt: PDF wurde heruntergeladen.')
      }
      await navigator.share({ files: [file], title: `Dienstplan KW ${isoWeek(c.monday).week}`, text: `Dein Dienstplan KW ${isoWeek(c.monday).week}` })
      markSent(c, [emp], 'Teilen')
      renderModal()
    } catch (err) {
      if (err.name === 'AbortError') return
      if (err.name === 'NotAllowedError') return toast('Das PDF ist bereit: bitte nochmals auf „Teilen“ tippen.')
      toast(`Teilen fehlgeschlagen: ${err.message}`)
    }
  },
  'send-all-pdf': async () => {
    const c = app.cur
    const list = currentList(c)
    try {
      setBusy(`PDF mit ${list.length} Seiten wird erstellt …`)
      download(list.length === 1 ? pdfFileName(c.monday, list[0].name) : allPdfName(c), await weekPdfBlob(c, list))
      setBusy('')
    } catch (err) {
      setBusy('')
      toast(`PDF fehlgeschlagen: ${err.message}`)
    }
  },
  'send-zip': async () => {
    const c = app.cur
    const list = currentList(c)
    try {
      const zip = await weekPdfZip(c, list, (i, n) => setBusy(`PDF ${i} von ${n} …`))
      download(`Wochenplaene_${weekFileBase(c.monday)}.zip`, zip)
      setBusy('')
    } catch (err) {
      setBusy('')
      toast(`ZIP fehlgeschlagen: ${err.message}`)
    }
  },
})

/** Personen in der aktuell gefilterten Liste des Dialogs. */
function currentList(c) {
  const filter = app.ui.modal?.filter || 'todo'
  return c.ctx.employees.filter((e) => filter === 'all' || (filter === 'done') === (sendState(c, e).key === 'aktuell'))
}

registerActions(
  {
    'send-mark': () => {
      const c = app.cur
      const list = currentList(c)
      markSent(c, list, 'manuell')
      renderModal()
      toast(`${list.length} als versendet markiert.`)
    },
    'send-mail': async (el) => {
      const c = app.cur
      const emp = empOf(el.dataset.emp)
      el.disabled = true
      try {
        setBusy(`E-Mail an ${emp.name} …`)
        await mailOne(c, emp)
        markSent(c, [emp], 'E-Mail')
        setBusy('')
        toast(`E-Mail an ${emp.name} gesendet.`)
      } catch (err) {
        setBusy('')
        toast(err.message)
      }
    },
    'send-mail-all': async () => {
      if (!confirmStep('send-mail-all', renderModal)) return
      const c = app.cur
      const list = currentList(c).filter((e) => e.email)
      const done = []
      const failed = []
      for (const [i, emp] of list.entries()) {
        setBusy(`Sende ${i + 1} von ${list.length}: ${emp.name} …`)
        try {
          await mailOne(c, emp)
          done.push(emp)
        } catch (err) {
          failed.push(`${emp.name}: ${err.message}`)
          if (/Berechtigung/.test(err.message)) break
        }
      }
      if (done.length) markSent(c, done, 'E-Mail')
      setBusy('')
      toast(`${done.length} E-Mails gesendet.${failed.length ? ` Nicht gesendet: ${failed.slice(0, 2).join('; ')}${failed.length > 2 ? ' …' : ''}` : ''}`)
    },
  },
  { edit: true },
)
