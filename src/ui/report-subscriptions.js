// Berichte automatisch per E-Mail: Abos wie „Kennzahlen jeden Montag ab 7 Uhr an die Geschäftsführung“.
// Gesendet wird aus dem Postfach der Person, die das Abo angelegt hat, sobald sie die App an oder nach dem
// Termin offen hat (PC oder Handy) – ohne Server und ohne gespeichertes Passwort. Ein verpasster Termin wird
// einmal nachgeholt. Abos liegen in berichte/abos.json (nur Vollzugriff); Zeitplan in core/report-schedule.js.

import { sendMail } from '../auth/graph-mail.js'
import { addDays, formatDate, mondayOf } from '../core/dates.js'
import { fileSafe } from '../core/filename.js'
import { listMail, parseAddresses, reportMail } from '../core/mail.js'
import { mondaysBetween } from '../core/reports.js'
import { isDue, lastSlot, mayRetry, nextSlot, RHYTHMS, rhythmText, viennaNow, WEEKDAYS } from '../core/report-schedule.js'
import { reportDocument } from '../export/report-pdf.js'
import { app, compute, confirmStep, ensureModal, ensureRange, ensureView, MODALS, openModal, persist, preloadLazy, registerActions, registerModal, renderModal, toast, VIEWS, windowFor } from './context.js'
import { openCompose, pickSelect, readView, tablesCsv, todoSections } from './mailer.js'
import { canMail } from './modals/send.js'
import { loadLogo, pdfBlob } from './pdf.js'
import { dayAt, esc, ICON, modalFrame, options, uid, val } from './shared.js'

/** Berichte, die sich abonnieren lassen: Ansicht (als PDF + CSV) oder „Zu erledigen“ (als Text). */
export const REPORTS = [
  { id: 'kennzahlen', label: 'Kennzahlen', view: 'kennzahlen' },
  { id: 'report', label: 'Prüfbericht der Woche', view: 'report' },
  { id: 'coverage', label: 'Vertretungen und offene Einsätze', view: 'coverage' },
  { id: 'due', label: 'Periodische Leistungen', view: 'due' },
  { id: 'reklamationen', label: 'Reklamationen', view: 'reklamationen' },
  { id: 'material', label: 'Material & Lager', view: 'material' },
  { id: 'todo', label: 'Zu erledigen', modal: 'todo' },
  { id: 'briefing', label: 'Wochenbriefing (das Wichtigste der Woche)', briefing: true },
]
const reportOf = (id) => REPORTS.find((r) => r.id === id)
const available = () => REPORTS.filter((r) => (r.briefing ? !!MODALS.todo : r.view ? VIEWS.some((v) => v.id === r.view) : !!MODALS[r.modal]))
const isAdmin = () => !app.access || app.access.all
const doc = () => {
  const d = (app.data.berichte ||= { abos: [] })
  d.abos ||= []
  return d
}

// ---------------------------------------------------------------- Bericht erstellen

/** Ansicht oder Dialog unsichtbar zeichnen und auslesen (aktuelle Woche in Wien). */
async function renderOffscreen(def) {
  const today = viennaNow().day
  const monday = mondayOf(today)
  const { from, to } = windowFor(monday, addDays(monday, 3).slice(0, 7))
  await app.service?.ensureWeeks?.(mondaysBetween(from, to))
  // später geladene Ansicht (views/lazy.js), die noch niemand geöffnet hat: erst laden; „Zu erledigen“
  // enthält auch Punkte später geladener Module (Fakturierung, Material …): die der eigenen Bereiche laden
  await preloadLazy()
  const view = def.view ? await ensureView(def.view) : null
  const modal = def.modal ? await ensureModal(def.modal) : null
  const extra = view?.range?.()
  if (extra) await ensureRange(extra.from, extra.to)
  const c = compute(monday)
  const html = view ? view.render(c) : modal(c, {})
  const box = document.createElement('div')
  box.setAttribute('aria-hidden', 'true')
  box.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;visibility:hidden;pointer-events:none'
  box.innerHTML = view ? `<main class="wrap">${html}</main>` : html
  document.body.append(box)
  return { box, monday }
}

/** Bericht als E-Mail: { subject, text, files }. ki: Wochenbriefing mit Zusammenfassung der KI. */
export async function buildReport(id, { abo = null, ki = abo?.ki || false } = {}) {
  const def = reportOf(id)
  if (!def) throw new Error('Diesen Bericht gibt es nicht mehr.')
  const footer = abo ? `\n\nAutomatisch gesendet (${rhythmText(abo)}). Ändern oder abbestellen: in der App unter ⋯ → „Berichte automatisch“.` : ''
  if (def.briefing) {
    await preloadLazy()
    return (await import('./briefing-mail.js')).buildBriefing({ ki, footer, renderOffscreen, formatDate, viennaNow })
  }
  const { box, monday } = await renderOffscreen(def)
  try {
    if (def.modal) {
      const sections = todoSections(null, box)
      const mail = listMail({ title: `${def.label} – Stand ${formatDate(viennaNow().day, { weekday: false, year: true })}`, sections: sections.length ? sections : [{ title: '', items: ['Alles erledigt.'] }], link: `${location.origin}${location.pathname}`, from: app.user?.name || '' })
      return { subject: mail.subject, text: mail.text + footer, files: [] }
    }
    const r = readView(box.querySelector('main'), { viewId: def.view, monday })
    const base = fileSafe(`${r.title}_${viennaNow().day}`)
    const files = [{ name: `${base}.pdf`, blob: await pdfBlob(reportDocument({ ...r, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })), type: 'application/pdf' }]
    if (r.tables.length) files.push({ name: `${base}.csv`, blob: new Blob([tablesCsv(r.tables)], { type: 'text/csv;charset=utf-8' }), type: 'text/csv' })
    const mail = reportMail({ title: r.title, subtitle: r.subtitle, tiles: r.tiles, files: files.map((f) => f.name), from: app.user?.name || '' })
    return { subject: mail.subject, text: mail.text + footer, files }
  } finally {
    box.remove()
  }
}

// ---------------------------------------------------------------- automatisch senden

let running = false
const me = () => (app.user?.email || '').toLowerCase()
const lockKey = (abo, slot) => `cleanos-bericht-${abo.id}-${slot}`

function cleanLocks() {
  try {
    const old = Date.now() - 40 * 864e5
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith('cleanos-bericht-') && Number(localStorage.getItem(k)) < old) localStorage.removeItem(k)
    }
  } catch {
    /* ohne Speicher */
  }
}

/** Fällige Abos senden (nur die eigenen, nur mit Microsoft 365). Liefert die Zahl der gesendeten Berichte. */
export async function sendDue(now = viennaNow()) {
  if (running || !app.data?.berichte || !canMail() || !isAdmin()) return 0
  const due = doc().abos.filter((a) => isDue(a, now) && mayRetry(a) && (!a.by || a.by.toLowerCase() === me()))
  if (!due.length) return 0
  running = true
  let sent = 0
  try {
    cleanLocks()
    for (const abo of due) {
      const slot = lastSlot(abo, now)
      try {
        // zwei Fenster gleichzeitig: nur eines sendet
        if (localStorage.getItem(lockKey(abo, slot))) continue
        localStorage.setItem(lockKey(abo, slot), String(Date.now()))
      } catch {
        /* ohne Speicher: trotzdem senden */
      }
      try {
        const r = await buildReport(abo.report, { abo })
        await sendMail(app.auth.getToken, { to: parseAddresses(abo.to).valid, subject: r.subject, text: r.text, attachments: r.files }, { from: app.config.mail?.from || '' })
        Object.assign(abo, { lastSent: slot, lastAt: new Date().toISOString(), lastError: '', lastTry: '' })
        sent++
        toast(`Bericht „${reportOf(abo.report)?.label || abo.report}“ automatisch gesendet.`)
      } catch (err) {
        Object.assign(abo, { lastError: err.message, lastTry: new Date().toISOString() })
        try {
          localStorage.removeItem(lockKey(abo, slot))
        } catch {
          /* egal */
        }
      }
      persist()
    }
  } finally {
    running = false
  }
  if (app.ui.modal?.type === 'mail-reports') renderModal()
  return sent
}

// nach dem Start, alle 5 Minuten und beim Zurückkehren in die App
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const check = () => sendDue().catch(() => 0)
  setTimeout(check, 20000)
  setInterval(check, 5 * 60000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(check, 3000)
  })
}

// ---------------------------------------------------------------- Dialog

const HOURS = Array.from({ length: 16 }, (_, i) => i + 5)

function form(m) {
  const d = m.draft
  const reports = available()
  return `<div class="form-grid mc-form ra-form">
      <label class="field"><span>Bericht</span><select id="ra-report">${options(reports.map((r) => [r.id, r.label]), d.report)}</select></label>
      <label class="field"><span>Rhythmus</span><select id="ra-rhythm" data-toggle="ra">${options(RHYTHMS, d.rhythm)}</select></label>
      <label class="field" data-ra="woche" ${d.rhythm === 'woche' ? '' : 'hidden'}><span>Wochentag</span><select id="ra-weekday">${options(WEEKDAYS.map((w, i) => [String(i + 1), w]), String(d.weekday || 1))}</select></label>
      <label class="field"><span>ab</span><select id="ra-hour">${options(HOURS.map((h) => [String(h), `${h} Uhr`]), String(d.hour ?? 7))}</select></label>
      <label class="field wide"><span>An</span><span class="mc-row"><input type="text" id="ra-to" value="${esc(d.to || '')}" placeholder="name@firma.at; mehrere mit Strichpunkt" autocomplete="email" inputmode="email">${pickSelect('ra-pick', 'ra-to')}</span></label>
      <label class="check wide"><input type="checkbox" id="ra-ki" ${d.ki ? 'checked' : ''}> Wochenbriefing: oben eine kurze Zusammenfassung mit KI (Titel und Zahlen gehen an Anthropic, Namen und Abwesenheitsarten werden vorher ersetzt; jede Zahl wird geprüft)</label>
    </div>
    <div class="actions ra-actions">${m.edit ? '<button class="btn" data-action="ra-cancel">Abbrechen</button>' : ''}<button class="btn primary" data-action="ra-save">${ICON.check} ${m.edit ? 'Änderung speichern' : 'Abo anlegen'}</button></div>`
}

function aboRow(a, now) {
  const r = reportOf(a.report)
  const when = a.active === false ? '<span class="pill">pausiert</span>' : `${esc(rhythmText(a))}<br><span class="muted">nächster Versand ${formatDate(nextSlot(a, now) || now.day, { year: false })}</span>`
  const last = a.lastError ? `<span class="pill error" title="${esc(a.lastError)}">nicht gesendet</span><br><span class="muted">${esc(a.lastError.slice(0, 80))}</span>` : a.lastAt ? `${formatDate(dayAt(a.lastAt), { year: true })}` : '<span class="muted">noch nie</span>'
  const mine = !a.by || a.by.toLowerCase() === me()
  const confirming = app.ui.confirm === `ra-del-${a.id}`
  return `<tr><td><strong>${esc(r?.label || a.report)}</strong>${mine ? '' : `<br><span class="muted">sendet ${esc(a.byName || a.by)}</span>`}</td><td>${esc(parseAddresses(a.to).valid.join(', '))}</td><td>${when}</td><td>${last}</td>
    <td class="actions-cell"><button class="btn small" data-action="ra-now" data-id="${esc(a.id)}" title="Bericht jetzt erstellen und im Senden-Fenster öffnen">${ICON.send} Jetzt</button>
      ${mine ? '' : `<button class="btn small edit-only" data-action="ra-take" data-id="${esc(a.id)}" title="Ab jetzt aus deinem Postfach senden (z. B. wenn ${esc(a.byName || a.by)} nicht mehr da ist)">Übernehmen</button>`}
      <button class="btn small edit-only" data-action="ra-edit" data-id="${esc(a.id)}">Bearbeiten</button>
      <button class="btn small edit-only" data-action="ra-toggle" data-id="${esc(a.id)}">${a.active === false ? 'Fortsetzen' : 'Pausieren'}</button>
      <button class="btn small edit-only ${confirming ? 'danger confirm' : 'danger'}" data-action="ra-delete" data-id="${esc(a.id)}">${confirming ? 'Wirklich?' : 'Löschen'}</button></td></tr>`
}

function reportsModal(c, m) {
  const now = viennaNow()
  m.draft ||= { report: 'kennzahlen', rhythm: 'woche', weekday: 1, hour: 7, to: '' }
  const abos = doc().abos
  return modalFrame({
    title: 'Berichte automatisch per E-Mail',
    subtitle: 'z. B. jeden Montag die Kennzahlen an die Geschäftsführung',
    wide: true,
    body: `${
      canMail()
        ? ''
        : `<div class="banner warn-banner"><p>Automatisch senden geht nur mit Microsoft 365 (config.json: <code>features.mail</code> und die Berechtigung Mail.Send). Bis dahin erstellt „Jetzt“ den Bericht und öffnet dein E-Mail-Programm.</p></div>`
    }
      ${abos.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Bericht</th><th>An</th><th>Wann</th><th>Zuletzt</th><th></th></tr></thead><tbody>${abos.map((a) => aboRow(a, now)).join('')}</tbody></table></div>` : '<p class="empty">Noch kein Abo. Unten eines anlegen.</p>'}
      <h3 class="mc-head">${m.edit ? 'Abo bearbeiten' : 'Neues Abo'}</h3>
      <div class="edit-only">${form(m)}</div>
      <p class="note">Gesendet wird aus deinem Microsoft-365-Postfach${app.config.mail?.from ? ` (${esc(app.config.mail.from)})` : ''}, sobald du die App an dem Tag ab der Uhrzeit offen hast – am PC oder am Handy. Ein verpasster Termin wird einmal nachgeholt. Kennzahlen und Pläne enthalten personenbezogene Daten: nur an Personen senden, die sie brauchen.</p>`,
    foot: `<span></span><div class="actions"><button class="btn primary" data-action="close-modal">Fertig</button></div>`,
  })
}
registerModal('mail-reports', reportsModal, { module: null })

const aboOf = (id) => doc().abos.find((a) => a.id === id)

registerActions({
  'mail-reports-open': () => {
    if (!isAdmin()) return toast('Automatische Berichte richtet der Vollzugriff ein.')
    openModal({ type: 'mail-reports' })
  },
  'ra-now': async (el) => {
    const abo = aboOf(el.dataset.id)
    if (!abo) return
    el.disabled = true
    toast('Bericht wird erstellt …')
    try {
      const r = await buildReport(abo.report, { ki: abo.ki })
      openCompose({ to: parseAddresses(abo.to).valid.join('; '), subject: r.subject, text: r.text, files: r.files, origin: `Bericht „${reportOf(abo.report)?.label}“`, privacy: true })
    } catch (err) {
      el.disabled = false
      toast(`Bericht nicht erstellt: ${err.message}`)
    }
  },
})

registerActions(
  {
    'ra-save': () => {
      const m = app.ui.modal
      const to = parseAddresses(val('ra-to'))
      if (to.invalid.length) return toast(`Bitte prüfen: „${to.invalid[0]}“ ist keine gültige E-Mail-Adresse.`)
      if (!to.valid.length) return toast('Bitte mindestens eine Adresse unter „An“ eintragen.')
      const report = val('ra-report')
      const fields = { report, rhythm: val('ra-rhythm'), weekday: Number(val('ra-weekday')) || 1, hour: Number(val('ra-hour')), to: to.valid.join('; '), ki: report === 'briefing' && !!document.getElementById('ra-ki')?.checked }
      const existing = m.edit ? aboOf(m.edit) : null
      if (existing) Object.assign(existing, fields)
      else doc().abos.push({ id: uid('ra'), ...fields, active: true, since: viennaNow().day, by: me(), byName: app.user?.name || '' })
      persist()
      m.edit = null
      m.draft = null
      renderModal()
      toast(existing ? 'Abo geändert.' : `Abo angelegt: ${reportOf(fields.report)?.label}, ${rhythmText(fields)}.`)
    },
    'ra-edit': (el) => {
      const abo = aboOf(el.dataset.id)
      if (!abo) return
      Object.assign(app.ui.modal, { edit: abo.id, draft: { ...abo } })
      renderModal()
      document.getElementById('ra-to')?.focus()
    },
    'ra-take': (el) => {
      const abo = aboOf(el.dataset.id)
      if (!abo) return
      Object.assign(abo, { by: me(), byName: app.user?.name || '' })
      persist()
      renderModal()
      toast('Abo übernommen: wird ab jetzt aus deinem Postfach gesendet.')
    },
    'ra-cancel': () => {
      Object.assign(app.ui.modal, { edit: null, draft: null })
      renderModal()
    },
    'ra-toggle': (el) => {
      const abo = aboOf(el.dataset.id)
      if (!abo) return
      abo.active = abo.active === false
      // fortgesetzt: nicht rückwirkend nachholen
      if (abo.active) abo.since = viennaNow().day
      persist()
      renderModal()
    },
    'ra-delete': (el) => {
      if (!confirmStep(`ra-del-${el.dataset.id}`, renderModal)) return
      const d = doc()
      d.abos = d.abos.filter((a) => a.id !== el.dataset.id)
      persist()
      renderModal()
      toast('Abo gelöscht.')
    },
  },
  { edit: '*' },
)
