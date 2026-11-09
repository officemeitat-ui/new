// Paket für die Steuerberatung (Kürzel stb-): Zeitraum wählen, Prüfliste ansehen, ZIP-Datei herunterladen oder per
// E-Mail an die Steuerberatung schicken. Inhalt je nach Rolle (nur, was die Person lesen darf):
//  - Ausgangsrechnungen.csv und die PDFs (abgelegtes PDF aus SharePoint, sonst neu erstellt),
//  - Eingangsrechnungen.csv und die Belege, Kassenbuch.csv mit dem Kassenbuch-PDF je Monat,
//  - Zahlungen.csv, Offene-Posten.csv (Stichtag Ende des Zeitraums), Umsatzsteuer-Übersicht (PDF),
//  - Inhalt.txt mit Summen, Hinweisen und SHA-256 je Datei.
// Mit Recht auf die Fakturierung wird die Übergabe vermerkt (fakturierung settings.stb.handovers, mit Fingerabdruck je
// Beleg): Ändert sich danach etwas im Zeitraum, meldet „Zu erledigen“ die Nachreichung; das Paket bietet dann „nur
// Nachreichung“ an. Erinnerung ab dem 10. des Folgemonats, wenn der Vormonat noch nicht übergeben ist (nur, wer das
// Paket schon nutzt). Rechenkern: core/steuerberatung.js.

import { CASH_EXPORT_COLUMNS, CASH_EXPORT_DEFAULT } from '../../core/cashbook.js'
import { exportCsv } from '../../core/invoicing.js'
import { purchaseCsv, toCsv } from '../../core/purchase.js'
import { sichPruefsumme } from '../../core/sicherung.js'
import {
  OPEN_COLS,
  PAYMENT_COLS,
  STB_PARTS,
  STB_REMIND_DAY,
  stbChanges,
  stbChecks,
  stbChoices,
  stbCsv,
  stbInhalt,
  stbLastHandover,
  stbMergePrints,
  stbOpenItems,
  stbPayments,
  stbPeriod,
  stbPrints,
  stbRecord,
  stbReminder,
  stbRows,
  stbSums,
} from '../../core/steuerberatung.js'
import { vatBasisOf, vatReturn, vatReturnFileName } from '../../core/vat-return.js'
import { cashbookDocument } from '../../export/cashbook-pdf.js'
import { vatReturnDocument } from '../../export/uva-pdf.js'
import { todayISO } from '../../core/dates.js'
import { app, canEdit, closeModal, openModal, persist, registerActions, registerModal, renderModal, renderModalKeepingInput, toast } from '../context.js'
import { loadScript } from '../load-script.js'
import { openCompose } from '../mailer.js'
import { registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, download, esc, ICON, modalFrame, uid, val } from '../shared.js'
import { belegBlob } from './einkauf-shared.js'
import { laeufeHooks } from './invoicing-laeufe.js'

const sees = (m) => !app.access || app.access.sees(m)
const mayUse = () => sees('fakturierung') || sees('einkauf')
const mayRecord = () => canEdit('fakturierung') && !app.readOnly
const fakSettings = () => app.data.fakturierung?.settings || {}
const company = () => fakSettings().sender?.name || app.config?.brand?.name || ''
const money = (n) => `${Number(n || 0).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const when = (iso) => (iso ? new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const csvBlob = (text) => new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' })
// Zustand dieser Sitzung (nichts davon wird gespeichert)
const RUN = { busy: false, step: '', done: 0, total: 0 }

/** Daten, soweit die Rolle sie lesen darf. */
function sources() {
  const fak = sees('fakturierung') ? app.data.fakturierung || { documents: [], customers: [], settings: {} } : null
  const ek = sees('einkauf')
  return { fak, einkauf: ek ? app.data.einkauf || { invoices: [], suppliers: [] } : null, kasse: ek ? app.data.kasse || { entries: [], closings: [] } : null, bank: fak?.bank || null, objectsById: new Map((app.data.objects || []).map((o) => [o.id, o])) }
}

/** Teile, die diese Person übergeben kann. */
const partsAvailable = () => Object.entries(STB_PARTS).filter(([id, p]) => (p.module === '*' ? mayUse() : sees(p.module)) && (id !== 'ka' || sees('einkauf'))).map(([id]) => id)

function state(m) {
  const p = stbPeriod(m.period) || stbPeriod(stbChoices(todayISO()).standard)
  const src = sources()
  const parts = partsAvailable()
  const rows = stbRows({ fak: parts.includes('ar') ? src.fak : null, einkauf: parts.includes('er') ? src.einkauf : null, kasse: parts.includes('ka') ? src.kasse : null, objectsById: src.objectsById }, p)
  const prints = stbPrints(rows)
  const last = stbLastHandover(fakSettings(), p)
  const changes = last ? stbChanges({ ...last, prints: last.prints || {} }, prints) : null
  return { p, src, parts, rows, prints, sums: stbSums(rows), checks: stbChecks(src, p), last, changes }
}

// ---------------------------------------------------------------- Dialog

function stbModal(c, m) {
  if (!mayUse()) return ''
  const s = state(m)
  const ch = stbChoices(todayISO())
  const opt = (list) => list.map((x) => `<option value="${esc(x.id)}" ${x.id === s.p.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')
  const chosen = new Set(m.parts || s.parts)
  const partRows = s.parts
    .map((id) => {
      const count = id === 'ar' ? s.sums.ar.count : id === 'er' ? s.sums.er.count : id === 'ka' ? s.sums.ka.count : null
      const sub = count === null ? '' : count ? `${plural(new Set((s.rows[id] || []).map((r) => r.number)).size, 'Beleg', 'Belege')}, netto ${money(s.sums[id].net)}` : 'keine im Zeitraum'
      return `<label class="check"><input type="checkbox" id="stb-part-${id}" ${chosen.has(id) ? 'checked' : ''} data-change="stb-redraw"> ${esc(STB_PARTS[id].label)}${sub ? ` <span class="muted">· ${esc(sub)}</span>` : ''}</label>`
    })
    .join('')
  const checks = s.checks.length
    ? `<ul class="stb-checks">${s.checks.map((x) => `<li><span class="pill ${x.level === 'warn' ? 'warning' : 'info'}">${x.level === 'warn' ? 'prüfen' : 'Hinweis'}</span> ${esc(x.text)}${x.lines?.length ? `<details><summary>Welche?</summary><ul>${x.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details>` : ''}</li>`).join('')}</ul>`
    : '<p class="ok-text">Keine offenen Punkte: Entwürfe festgeschrieben, Belege da, Kassenbuch abgeschlossen.</p>'
  const handed = s.last
    ? `<div class="banner ${s.changes?.count ? 'warn-banner' : 'info-banner'}"><p><strong>Schon übergeben</strong> am ${esc(when(s.last.at))}${s.last.by ? ` von ${esc(s.last.by)}` : ''}${s.last.partial ? ' (zuletzt eine Nachreichung)' : ''}.
        ${s.changes?.count ? `Seitdem ${plural(s.changes.count, 'Änderung', 'Änderungen')} im Zeitraum:` : 'Seitdem keine Änderung an den Buchungszeilen.'}</p>
        ${s.changes?.count ? `<ul>${s.changes.lines.slice(0, 12).map((l) => `<li>${esc(l)}</li>`).join('')}${s.changes.count > 12 ? `<li>… und ${s.changes.count - 12} weitere</li>` : ''}</ul>
        <label class="check"><input type="checkbox" id="stb-partial" ${m.partial !== false ? 'checked' : ''}> Nur die Nachreichung (neue und geänderte Belege, dazu die Liste der entfallenen)</label>` : ''}</div>`
    : ''
  const st = fakSettings().stb || {}
  const busy = RUN.busy ? `<p class="muted" role="status">${esc(RUN.step)}${RUN.total ? ` (${RUN.done}/${RUN.total})` : ''} …</p>` : ''
  return modalFrame({
    title: 'Paket für die Steuerberatung',
    subtitle: esc(`${s.p.label}${company() ? ` · ${company()}` : ''}`),
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Zeitraum</span><select id="stb-period" data-change="stb-period">
          <optgroup label="Monat">${opt(ch.months)}</optgroup><optgroup label="Quartal">${opt(ch.quarters)}</optgroup><optgroup label="Jahr">${opt(ch.years)}</optgroup></select></label>
      </div>
      ${handed}
      <h3>Inhalt</h3><div class="stb-parts">${partRows}</div>
      <h3>Prüfung vor der Übergabe</h3>${checks}
      <p class="note">Die CSV-Dateien sind dieselben wie bei „Export Steuerberatung“ (Semikolon, Dezimalbeistrich, Kontonummern laut Einstellungen). Dazu kommen die Belege als PDF bzw. Bild und eine Datei „Inhalt.txt“ mit Summen und Prüfsummen. ${mayRecord() ? 'Die Übergabe wird vermerkt; spätere Änderungen im Zeitraum meldet „Zu erledigen“ als Nachreichung.' : 'Ohne Recht auf die Fakturierung wird die Übergabe nicht vermerkt.'}</p>
      ${mayRecord() ? `<label class="check"><input type="checkbox" id="stb-record" ${m.record !== false ? 'checked' : ''}> Als übergeben vermerken (beim Herunterladen sofort, beim Senden nach dem Senden)</label>` : ''}
      ${mayRecord() ? `<details class="stb-settings"><summary>Einstellungen</summary><div class="form-grid">
        <label class="field"><span>E-Mail der Steuerberatung</span><input type="email" id="stb-email" value="${esc(st.email || '')}" placeholder="z. B. buchhaltung@steuerberatung.example" autocomplete="email"></label>
        <label class="field"><span>Erinnerung ab Tag des Folgemonats (0 = aus)</span><input type="number" id="stb-day" min="0" max="28" value="${esc(String(st.remindDay ?? STB_REMIND_DAY))}"></label>
        <div class="actions"><button class="btn small" data-action="stb-settings-save">Einstellungen speichern</button></div></div></details>` : ''}
      ${busy}`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">
      <button class="btn" data-action="stb-build" data-via="download" ${RUN.busy ? 'disabled' : ''}>${ICON.download} Herunterladen</button>
      <button class="btn primary" data-action="stb-build" data-via="mail" ${RUN.busy ? 'disabled' : ''}>${ICON.send} Per E-Mail an die Steuerberatung</button></div>`,
  })
}
registerModal('stb-paket', stbModal)

/** Auswahl aus dem Dialog (Zeitraum, Teile, Nachreichung) in den Dialog-Zustand übernehmen. */
function readForm(m) {
  if (document.getElementById('stb-period')) m.period = val('stb-period')
  const parts = partsAvailable().filter((id) => (document.getElementById(`stb-part-${id}`) ? checked(`stb-part-${id}`) : (m.parts || partsAvailable()).includes(id)))
  m.parts = parts
  if (document.getElementById('stb-partial')) m.partial = checked('stb-partial')
  if (document.getElementById('stb-record')) m.record = checked('stb-record')
  return m
}

// ---------------------------------------------------------------- Paket bauen

async function addFile(files, path, blob) {
  if (!blob) return
  const bytes = new Uint8Array(await blob.arrayBuffer())
  files.push({ path, bytes, sha: await sichPruefsumme(bytes) })
}

const ext = (path, fallback = 'pdf') => (String(path || '').match(/\.(\w{2,4})$/)?.[1] || fallback).toLowerCase()
const safe = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)

async function build(m) {
  const s = state(m)
  const parts = new Set(m.parts || s.parts)
  const partial = s.changes?.count && m.partial !== false ? { at: s.last.at, lines: s.changes.lines, keys: new Set([...s.changes.added, ...s.changes.changed]) } : null
  const want = (part, number) => !partial || partial.keys.has(`${part}|${number}`)
  const files = []
  const notes = []
  const progress = (step, done = 0, total = 0) => {
    Object.assign(RUN, { step, done, total })
    renderModalKeepingInput()
  }
  const logo = await loadLogo().catch(() => null)
  const brand = app.config.brand || {}

  // Ausgangsrechnungen
  if (parts.has('ar') && s.src.fak) {
    const rows = s.rows.ar.filter((r) => want('ar', r.number))
    if (rows.length) await addFile(files, 'Ausgangsrechnungen.csv', csvBlob(exportCsv(rows)))
    const numbers = new Set(rows.map((r) => r.number))
    const docs = (s.src.fak.documents || []).filter((d) => d.number && numbers.has(d.number) && ['rechnung', 'storno', 'korrektur'].includes(d.kind))
    let i = 0
    for (const d of docs) {
      progress('Rechnungen als PDF', ++i, docs.length)
      let blob = null
      try {
        if (d.archive?.path) blob = await app.store?.readBlob?.(d.archive.path)
      } catch {
        blob = null
      }
      if (!blob && laeufeHooks.docPdf) blob = await laeufeHooks.docPdf(d).catch(() => null)
      if (blob) await addFile(files, `Ausgangsrechnungen/${safe(`${d.number}_${d.recipient?.name || ''}`)}.pdf`, blob)
      else notes.push(`PDF zu ${d.number} fehlt`)
    }
  }
  // Eingangsrechnungen
  if (parts.has('er') && s.src.einkauf) {
    const rows = s.rows.er.filter((r) => want('er', r.number))
    if (rows.length) await addFile(files, 'Eingangsrechnungen.csv', csvBlob(purchaseCsv(rows)))
    const numbers = new Set(rows.map((r) => r.number))
    const invs = (s.src.einkauf.invoices || []).filter((x) => !x.cancelled && numbers.has(x.no || x.number))
    let i = 0
    for (const x of invs) {
      progress('Belege der Eingangsrechnungen', ++i, invs.length)
      if (!x.beleg) continue // steht schon in der Prüfliste („ohne Beleg“)
      const blob = await belegBlob(x.beleg).catch(() => null)
      if (blob) await addFile(files, `Eingangsrechnungen/${safe(`${x.no || x.id}_${x.supplier?.name || ''}_${x.number || ''}`)}.${ext(x.beleg?.path)}`, blob)
      else notes.push(`Beleg zu ${x.no || x.number} ließ sich nicht lesen${x.beleg.local ? ' (im Browser-Modus nicht gespeichert)' : ''}`)
    }
  }
  // Kassenbuch: CSV und das Kassenbuch je Monat als PDF
  if (parts.has('ka') && s.src.kasse) {
    const rows = s.rows.ka.filter((r) => want('ka', r.number))
    if (rows.length) await addFile(files, 'Kassenbuch.csv', csvBlob(toCsv(rows, CASH_EXPORT_COLUMNS, CASH_EXPORT_DEFAULT)))
    if (!partial) {
      const months = [...new Set(s.rows.ka.map((r) => r.date.slice(0, 7)))]
      for (const ym of months) {
        progress('Kassenbuch als PDF')
        const blob = await pdfBlob(cashbookDocument({ book: s.src.kasse, month: ym, brand, logo })).catch(() => null)
        if (blob) await addFile(files, `Kassenbuch/Kassenbuch_${ym}.pdf`, blob)
      }
    }
  }
  // Zahlungen, offene Posten, Umsatzsteuer (nicht bei der Nachreichung: die kommen mit dem nächsten Paket)
  if (!partial) {
    const sub = { fak: sees('fakturierung') ? s.src.fak : null, einkauf: sees('einkauf') ? s.src.einkauf : null }
    if (parts.has('zahlungen')) {
      const pay = stbPayments(sub, s.p)
      if (pay.length) await addFile(files, 'Zahlungen.csv', csvBlob(stbCsv(pay, PAYMENT_COLS)))
    }
    if (parts.has('op')) {
      const open = stbOpenItems(sub, s.p)
      if (open.length) await addFile(files, `Offene-Posten_${s.p.to}.csv`, csvBlob(stbCsv(open, OPEN_COLS)))
    }
    if (parts.has('uva') && s.p.kind !== 'jahr') {
      progress('Umsatzsteuer-Übersicht')
      const r = vatReturn({ docs: sub.fak ? sub.fak.documents || [] : null, settings: fakSettings(), purchase: sub.einkauf, cash: sees('einkauf') ? s.src.kasse : null, from: s.p.from, to: s.p.to, basis: vatBasisOf(fakSettings()) })
      const blob = await pdfBlob(vatReturnDocument({ r, label: s.p.label, company: company(), brand, logo })).catch(() => null)
      if (blob) await addFile(files, vatReturnFileName(r, 'pdf'), blob)
    }
  }
  if (partial && s.changes.removed.length) await addFile(files, 'Entfallen.txt', new Blob([`Nach der Übergabe vom ${when(s.last.at)} entfallen (storniert oder gelöscht):\r\n${s.changes.lines.filter((l) => l.endsWith('entfallen')).join('\r\n')}\r\n`], { type: 'text/plain' }))
  const at = new Date().toISOString()
  const checks = [...s.checks, ...notes.map((t) => ({ text: t }))]
  const inhalt = stbInhalt({ period: s.p, company: company(), by: app.user?.name || 'Browser', at, sums: partial ? null : s.sums, checks, files, partial })
  files.unshift({ path: 'Inhalt.txt', bytes: new TextEncoder().encode(inhalt), sha: '' })
  progress('ZIP-Datei')
  await loadScript('vendor/jszip.min.js')
  const zip = new globalThis.JSZip()
  for (const f of files) zip.file(f.path, f.bytes)
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/zip' })
  const name = `Steuerberatung_${s.p.id}${partial ? '_Nachreichung' : ''}${company() ? `_${safe(company()).slice(0, 30)}` : ''}.zip`
  return { s, blob, name, at, partial, files: files.length, notes }
}

/** Übergabe vermerken (nur mit Recht auf die Fakturierung). */
function record({ s, at, partial, files }, parts, wanted = true) {
  if (!wanted || !mayRecord() || !app.data.fakturierung) return false
  const settings = (app.data.fakturierung.settings ||= {})
  const prints = partial ? stbMergePrints(s.last.prints, s.prints, s.changes) : s.prints
  stbRecord(settings, {
    id: uid('stb'),
    from: s.p.from,
    to: s.p.to,
    label: s.p.label,
    at,
    by: app.user?.name || 'Browser',
    parts: [...parts].filter((p) => ['ar', 'er', 'ka'].includes(p)),
    files,
    partial: !!partial,
    sums: { ar: s.sums.ar, er: s.sums.er, ka: s.sums.ka },
    prints,
  })
  persist()
  return true
}

// ---------------------------------------------------------------- Zu erledigen

registerTodo({
  id: 'steuerberatung',
  module: 'fakturierung',
  title: 'Steuerberatung',
  compute: (today) => {
    if (!mayUse()) return []
    const settings = fakSettings()
    const out = []
    const remind = stbReminder(settings, today)
    if (remind) out.push({ id: `stb-faellig:${remind.id}`, kind: 'faellig', period: remind })
    // Nachreichung: Übergaben der letzten 24 Monate, an denen sich danach etwas geändert hat
    const src = sources()
    const seen = new Set()
    for (const h of [...(settings.stb?.handovers || [])].reverse()) {
      const key = `${h.from}|${h.to}`
      if (seen.has(key) || h.to < `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`) continue
      seen.add(key)
      const parts = new Set(h.parts || [])
      const rows = stbRows({ fak: parts.has('ar') ? src.fak : null, einkauf: parts.has('er') ? src.einkauf : null, kasse: parts.has('ka') ? src.kasse : null, objectsById: src.objectsById }, h)
      const ch = stbChanges(h, stbPrints(rows))
      if (ch.count) out.push({ id: `stb-nach:${h.id}:${ch.sig}`, kind: 'nach', handover: h, changes: ch })
    }
    return out
  },
  render: (items) =>
    items
      .map((x) =>
        x.kind === 'faellig'
          ? `<div class="todo-item"><span class="flag warning">!</span><div class="todo-text"><strong>${esc(x.period.label)}</strong> noch nicht an die Steuerberatung übergeben</div><button class="btn small primary" data-action="stb-open" data-period="${esc(x.period.id)}">Paket erstellen</button></div>`
          : `<div class="todo-item"><span class="flag warning">!</span><div class="todo-text"><strong>${esc(x.handover.label || `${x.handover.from} – ${x.handover.to}`)}</strong>: nach der Übergabe ${plural(x.changes.count, 'Beleg', 'Belege')} geändert<br><span class="muted">${esc(x.changes.lines.slice(0, 3).join(' · '))}${x.changes.count > 3 ? ' …' : ''}</span></div><button class="btn small primary" data-action="stb-open" data-from="${esc(x.handover.from)}" data-to="${esc(x.handover.to)}">Nachreichen</button></div>`,
      )
      .join(''),
})

/** Kennung des Zeitraums zu von/bis (Monat, Quartal, Jahr). */
function periodId(from, to) {
  if (from.slice(0, 7) === to.slice(0, 7)) return from.slice(0, 7)
  if (from.slice(5) === '01-01' && to.slice(5) === '12-31') return from.slice(0, 4)
  return `${from.slice(0, 4)}-Q${Math.floor((Number(from.slice(5, 7)) - 1) / 3) + 1}`
}

registerActions({
  'stb-open': (el) => {
    if (!mayUse()) return toast('Dafür fehlt das Recht auf Fakturierung oder Einkauf.')
    const d = el?.dataset || {}
    const period = d.period || (d.from && d.to ? periodId(d.from, d.to) : stbChoices(todayISO()).standard)
    openModal({ type: 'stb-paket', period })
  },
  'stb-period': () => {
    const m = app.ui.modal
    if (m?.type !== 'stb-paket') return
    readForm(m)
    m.partial = undefined
    renderModal()
  },
  'stb-redraw': () => {
    const m = app.ui.modal
    if (m?.type !== 'stb-paket') return
    readForm(m)
    renderModalKeepingInput()
  },
  'stb-settings-save': () => {
    if (!mayRecord()) return toast('Einstellungen nur mit Recht auf die Fakturierung.')
    const email = val('stb-email').trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Bitte eine gültige E-Mail-Adresse eintragen.')
    const day = Math.max(0, Math.min(28, Math.round(Number(val('stb-day')) || 0)))
    const settings = (app.data.fakturierung.settings ||= {})
    settings.stb = { ...(settings.stb || {}), email, remindDay: day }
    persist()
    toast('Gespeichert.')
    renderModalKeepingInput()
  },
  'stb-build': async (el) => {
    const m = app.ui.modal
    if (m?.type !== 'stb-paket' || RUN.busy) return
    readForm(m)
    if (!m.parts?.length) return toast('Bitte mindestens einen Teil auswählen.')
    RUN.busy = true
    let res = null
    try {
      res = await build(m)
    } catch (err) {
      toast(`Paket nicht erstellt: ${err.message}`)
    } finally {
      Object.assign(RUN, { busy: false, step: '', done: 0, total: 0 })
    }
    if (!res) return renderModalKeepingInput()
    const parts = new Set(m.parts)
    const via = el?.dataset?.via
    const sum = `${plural(res.files, 'Datei', 'Dateien')}${res.notes.length ? `, ${plural(res.notes.length, 'Hinweis', 'Hinweise')} in Inhalt.txt` : ''}`
    if (via === 'mail') {
      const st = fakSettings().stb || {}
      const s = res.s
      const text = [
        'Sehr geehrte Damen und Herren,',
        '',
        `anbei ${res.partial ? 'die Nachreichung zu' : 'die Unterlagen für'} ${s.p.label}${company() ? ` (${company()})` : ''}: Ausgangs- und Eingangsrechnungen mit Belegen, Kassenbuch, Zahlungen, offene Posten und die Umsatzsteuer-Übersicht, soweit vorhanden. Die Datei „Inhalt.txt“ im Paket listet alles mit Summen und Prüfsummen auf.`,
        res.notes.length ? `\nHinweis: ${res.notes.join('; ')}.` : '',
        '',
        'Mit freundlichen Grüßen',
        app.user?.name || '',
      ].join('\n')
      closeModal()
      openCompose({ to: st.email || '', subject: `${res.partial ? 'Nachreichung ' : ''}Buchhaltung ${s.p.label}${company() ? ` – ${company()}` : ''}`, text, files: [{ name: res.name, blob: res.blob, type: 'application/zip' }], origin: 'Paket für die Steuerberatung', privacy: true, onSent: () => record(res, parts, m.record !== false) })
      return
    }
    download(res.name, res.blob)
    const noted = record(res, parts, m.record !== false)
    toast(`Paket erstellt: ${sum}.${noted ? ' Übergabe vermerkt.' : ''}`)
    renderModalKeepingInput()
  },
})

