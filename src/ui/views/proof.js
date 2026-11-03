// Leistungsnachweis (Auswertung): je Objekt und Monat, was laut Plan geleistet wurde, mit den Zeiten
// aus der Zeiterfassung und dem Winterdienst-Protokoll. PDF je Objekt, alle als ZIP, Versand per E-Mail
// an den Kunden (Adresse am Objekt) mit Vermerk, wann an wen. Rechenkern: core/proof.js.
// Versand-Vermerke und Einstellungen in nachweise/versand.json.

import { sendMail } from '../../auth/graph-mail.js'
import { addDays, firstOfMonth, formatDate, formatHours, lastOfMonth, todayISO } from '../../core/dates.js'
import { monthName } from '../../core/payout.js'
import { NAME_MODES, objectsWithWork, PROOF_STATUS, proofFor, proofMailText, sentKey } from '../../core/proof.js'
import { absMinutes } from '../../core/timeclock.js'
import { logRows } from '../../core/winterlog.js'
import { proofDocument, proofPdfName } from '../../export/proof-pdf.js'
import { app, canEdit, closeModal, computeRange, ensureRange, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { loadScript } from '../load-script.js'
import { canMail } from '../modals/send.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, download, esc, ICON, modalFrame, options, rowMenu, val } from '../shared.js'
import { syncStamps } from '../timeclock.js'

const ICON_PROOF = '<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5M8.5 14.5l2.3 2.3 4.7-4.8"/>'
const doc = () => {
  const d = (app.data.nachweise ||= { sent: {}, settings: {} })
  d.sent ||= {}
  d.settings ||= {}
  return d
}
const settings = () => ({ names: 'keine', times: true, signature: true, ...doc().settings })
const objOf = (id) => app.data.objects.find((o) => o.id === id)
const emailOk = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim())
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** Gewählter Monat: Standard der Vormonat (Nachweis nach Monatsende). */
function month() {
  if (/^\d{4}-\d{2}$/.test(app.ui.proofMonth || '')) return app.ui.proofMonth
  return addDays(firstOfMonth(todayISO()), -1).slice(0, 7)
}
const range = () => ({ from: `${month()}-01`, to: lastOfMonth(`${month()}-01`) })

function proofs() {
  const { from, to } = range()
  const r = computeRange(from, to)
  const s = settings()
  const ids = objectsWithWork(r.instances, { from, to })
  const winterByObject = new Map()
  for (const w of logRows(app.data.winterlog || {}, { from, to, objectsById: r.ctx.objectsById })) winterByObject.set(w.objectId, [...(winterByObject.get(w.objectId) || []), w])
  return app.data.objects
    .filter((o) => ids.has(o.id) || winterByObject.has(o.id))
    .map((object) => ({ object, proof: proofFor({ objectId: object.id, from, to, instances: r.instances, state: r.state, stamps: app.data.stamps || {}, employeesById: r.ctx.employeesById, today: todayISO(), now: absMinutes(new Date().toISOString()), names: s.names }), winter: winterByObject.get(object.id) || [] }))
}

const lastSent = (objectId) => (doc().sent[sentKey(month(), objectId)] || []).at(-1) || null

async function pdfFor(p, logo) {
  const s = settings()
  const { from, to } = range()
  return pdfBlob(proofDocument({ object: p.object, monthLabel: monthName(month()), from, to, proof: p.proof, winter: p.winter, withTimes: s.times, withNames: s.names !== 'keine', withSignature: s.signature, brand: app.config.brand || {}, logo }))
}

// ---------------------------------------------------------------- Ansicht

function proofView() {
  const s = settings()
  const list = proofs()
  const q = String(app.ui.proofSearch || '').trim().toLowerCase()
  const shown = list.filter((p) => !q || p.object.name.toLowerCase().includes(q))
  const withMail = list.filter((p) => emailOk(p.object.proofEmail))
  const sentCount = list.filter((p) => lastSent(p.object.id)).length
  const open = list.reduce((n, p) => n + p.proof.totals.open, 0)
  const rows = shown
    .map(({ object: o, proof: { totals: t }, winter }) => {
      const sent = lastSent(o.id)
      const share = t.done ? Math.round((t.confirmed / t.done) * 100) : 0
      return `<tr><td><strong>${esc(o.name)}</strong>${o.address ? `<br><span class="muted">${esc(o.address)}</span>` : ''}</td>
        <td class="num">${t.done}${t.planned ? ` <span class="muted">+${t.planned} geplant</span>` : ''}</td><td class="num">${t.cancelled || ''}</td>
        <td class="num">${t.open ? `<span class="pill error">${t.open}</span>` : ''}</td><td class="num">${formatHours(t.planMinutes)}</td>
        <td class="num">${t.confirmed ? `${t.confirmed} (${share} %)` : '–'}</td><td class="num">${winter.length || ''}</td>
        <td>${o.proofEmail ? esc(o.proofEmail) : '<span class="muted">–</span>'}</td>
        <td>${sent ? `<span class="pill ok">${formatDate(sent.at.slice(0, 10))}</span>` : ''}</td>
        <td class="actions-cell"><button class="btn small" data-action="proof-open" data-obj="${esc(o.id)}">Ansehen</button> ${rowMenu([{ label: 'PDF herunterladen', icon: ICON.download, action: 'proof-pdf', data: { obj: o.id } }, { label: 'Per E-Mail senden', icon: ICON.send, action: 'proof-mail-open', data: { obj: o.id } }], `Nachweis für ${o.name || 'Objekt'}`)}</td></tr>`
    })
    .join('')
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  return `<div class="section-head"><div><h2>Leistungsnachweis</h2><p>Für Kunden: was im Objekt im Monat geleistet wurde, mit den Zeiten aus der Zeiterfassung im Objekt und dem Winterdienst-Protokoll. PDF je Objekt oder alle als ZIP, Versand per E-Mail.</p></div>
      <div class="actions"><button class="btn" data-action="proof-zip" ${list.length ? '' : 'disabled'}>${ICON.download} Alle als ZIP</button>${canMail() ? `<button class="btn primary" data-action="proof-mail-all" ${withMail.length ? '' : 'disabled'} title="an alle Objekte mit E-Mail-Adresse">${ICON.send} Alle mit E-Mail senden (${withMail.length})</button>` : ''}</div></div>
    <div class="filters">
      <label class="field inline"><span>Monat</span><input type="month" id="proof-month" value="${month()}" data-change="proof-month"></label>
      <label class="field inline"><span>Namen</span><select id="proof-names" data-change="proof-settings">${options(Object.entries(NAME_MODES), s.names)}</select></label>
      <label class="check"><input type="checkbox" id="proof-times" ${s.times ? 'checked' : ''} data-change="proof-settings"><span>erfasste Zeiten</span></label>
      <label class="check"><input type="checkbox" id="proof-sign" ${s.signature ? 'checked' : ''} data-change="proof-settings"><span>Feld für Unterschrift</span></label>
      <label class="field inline"><span>Suche</span><input type="search" id="proof-search" value="${esc(app.ui.proofSearch || '')}" data-input="proof-search" placeholder="Objekt"></label>
    </div>
    <div class="impact-stats tc-stats">${tile('Objekte', list.length)}${tile('mit E-Mail-Adresse', withMail.length)}${tile('versendet', `${sentCount} von ${list.length}`)}${tile('nicht besetzt', open, open ? 'err' : '')}</div>
    ${open ? `<div class="banner warn-banner"><p><strong>${plural(open, 'Einsatz', 'Einsätze')} ohne Besetzung</strong> in diesem Monat: Im Nachweis steht dann „nicht besetzt“. Vor dem Versand im Plan prüfen (nachtragen oder absagen).</p></div>` : ''}
    ${rows ? `<div class="table-wrap"><table class="data proof-table"><thead><tr><th>Objekt</th><th class="num">erbracht</th><th class="num">entfallen</th><th class="num">nicht besetzt</th><th class="num">Stunden</th><th class="num">mit Zeiterfassung</th><th class="num">Winterdienst</th><th>E-Mail</th><th>versendet</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine Einsätze in diesem Monat.</p>'}
    <p class="note">Die E-Mail-Adresse für den Nachweis steht beim Objekt (Objekte &amp; Leistungen → Objekt bearbeiten) oder wird beim ersten Versand gemerkt. Namen der Mitarbeitenden nur, wenn mit dem Kunden so vereinbart.</p>`
}

registerView({
  id: 'nachweis',
  order: 58,
  label: 'Leistungsnachweis',
  group: 'auswertung',
  module: 'planung',
  icon: ICON_PROOF,
  noWeek: true,
  text: 'Nachweis für Kunden je Objekt und Monat',
  range,
  render: proofView,
})

// ---------------------------------------------------------------- Vorschau und E-Mail

function previewModal(c, m) {
  const p = proofs().find((x) => x.object.id === m.objectId)
  if (!p) return ''
  const s = settings()
  const { rows, totals: t } = p.proof
  const showTimes = s.times && rows.some((r) => r.ist.length)
  const body = rows
    .map((r) => `<tr class="${r.status === 'entfallen' ? 'muted' : ''}"><td>${formatDate(r.date)}</td><td>${esc(r.time)}</td><td>${esc(r.label)}${r.category === 'sonder' ? ' <span class="pill info">Sonderleistung</span>' : ''}</td>
      <td><span class="pill ${r.status === 'offen' ? 'error' : r.status === 'entfallen' ? '' : r.status === 'geplant' ? 'info' : 'ok'}">${PROOF_STATUS[r.status]}</span>${r.reason ? ` <span class="muted">${esc(r.reason)}</span>` : ''}</td>
      ${showTimes ? `<td>${r.ist.map((x) => `${x.in}–${x.out || '…'}`).join('<br>')}</td>` : ''}${s.names !== 'keine' ? `<td>${esc(r.persons.join(', '))}</td>` : ''}</tr>`)
    .join('')
  return modalFrame({
    title: `Leistungsnachweis ${p.object.name}`,
    subtitle: `${monthName(month())} · ${t.done} erbracht${t.cancelled ? ` · ${t.cancelled} entfallen` : ''}${t.confirmed ? ` · ${t.confirmed} mit Zeiterfassung` : ''} · ${formatHours(t.planMinutes)} h`,
    wide: true,
    body: `${rows.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Datum</th><th>Zeit laut Plan</th><th>Leistung</th><th>Status</th>${showTimes ? '<th>erfasst im Objekt</th>' : ''}${s.names !== 'keine' ? '<th>Personal</th>' : ''}</tr></thead><tbody>${body}</tbody></table></div>` : '<p class="empty">Keine Einsätze.</p>'}
      ${p.winter.length ? `<h3>Winterdienst laut Protokoll</h3><p>${p.winter.map((w) => `${formatDate(w.date)} ${esc(w.time)}`).join(' · ')}</p>` : ''}`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions"><button class="btn" data-action="proof-pdf" data-obj="${esc(p.object.id)}">${ICON.download} PDF</button><button class="btn primary" data-action="proof-mail-open" data-obj="${esc(p.object.id)}">${ICON.send} E-Mail</button></div>`,
  })
}
registerModal('proof', previewModal)

function mailModal(c, m) {
  const p = proofs().find((x) => x.object.id === m.objectId)
  if (!p) return ''
  const brand = app.config.brand || {}
  m.text ??= proofMailText({ objectName: p.object.name, monthLabel: monthName(month()), totals: p.proof.totals, company: brand.name || '', sender: app.user?.name || '' })
  const sent = doc().sent[sentKey(month(), p.object.id)] || []
  const mayRemember = canEdit('stammdaten') && !app.readOnly
  return modalFrame({
    title: `Nachweis senden: ${p.object.name}`,
    subtitle: monthName(month()),
    wide: true,
    body: `<div class="form-grid">
        <label class="field wide"><span>An (E-Mail des Kunden)</span><input type="email" id="pm-to" value="${esc(m.to ?? p.object.proofEmail ?? '')}" placeholder="z. B. hausverwaltung@beispiel.at"></label>
        <label class="field wide"><span>Betreff</span><input type="text" id="pm-subject" value="${esc(m.subject ?? `Leistungsnachweis ${monthName(month())} – ${p.object.name}`)}"></label>
        <label class="field wide"><span>Text</span><textarea id="pm-text" rows="9">${esc(m.text)}</textarea></label>
        ${mayRemember ? `<label class="check"><input type="checkbox" id="pm-remember" ${p.object.proofEmail ? '' : 'checked'}><span>Adresse beim Objekt speichern</span></label>` : ''}
      </div>
      ${sent.length ? `<p class="muted">Schon gesendet: ${sent.map((x) => `${formatDate(x.at.slice(0, 10))} an ${esc(x.to)}${x.via === 'mailto' ? ' (E-Mail-Programm)' : ''}`).join(' · ')}</p>` : ''}
      <p class="note">${canMail() ? 'Geht aus deinem Postfach, das PDF hängt an.' : 'Öffnet dein E-Mail-Programm; das PDF wird heruntergeladen und muss angehängt werden.'}</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="proof-mail-send" data-obj="${esc(p.object.id)}">${ICON.send} ${canMail() ? 'Senden' : 'Im E-Mail-Programm öffnen'}</button></div>`,
  })
}
registerModal('proof-mail', mailModal)

function noteSent(objectId, to, via) {
  const key = sentKey(month(), objectId)
  doc().sent[key] = [...(doc().sent[key] || []), { at: new Date().toISOString(), to, via, by: app.user?.name || '' }]
}

function rememberEmail(objectId, to) {
  if (!canEdit('stammdaten') || app.readOnly) return
  app.data.objects = app.data.objects.map((o) => (o.id === objectId ? { ...o, proofEmail: to } : o))
}

// ---------------------------------------------------------------- Aktionen

registerActions({
  'proof-month': async () => {
    app.ui.proofMonth = val('proof-month')
    await ensureRange(range().from, range().to).catch(() => {})
    renderNow()
  },
  'proof-settings': () => {
    Object.assign(doc().settings, { names: val('proof-names'), times: checked('proof-times'), signature: checked('proof-sign') })
    persist()
    renderNow()
  },
  'proof-search': () => {
    app.ui.proofSearch = val('proof-search')
    renderNow()
    const el = document.getElementById('proof-search')
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  },
  'proof-open': (el) => openModal({ type: 'proof', objectId: el.dataset.obj }),
  'proof-pdf': async (el) => {
    const p = proofs().find((x) => x.object.id === el.dataset.obj)
    if (p) download(proofPdfName(p.object.name, month()), await pdfFor(p, await loadLogo().catch(() => null)))
  },
  'proof-zip': async (el) => {
    el.disabled = true
    try {
      await syncStamps().catch(() => {})
      await loadScript('vendor/jszip.min.js')
      const zip = new globalThis.JSZip()
      const logo = await loadLogo().catch(() => null)
      const list = proofs()
      for (const [i, p] of list.entries()) {
        toast(`PDF ${i + 1} von ${list.length} …`)
        zip.file(proofPdfName(p.object.name, month()), await pdfFor(p, logo))
      }
      download(`Leistungsnachweise_${month()}.zip`, await zip.generateAsync({ type: 'blob' }))
      toast(`${plural(list.length, 'Nachweis', 'Nachweise')} als ZIP.`)
    } finally {
      el.disabled = false
    }
  },
  'proof-mail-open': (el) => openModal({ type: 'proof-mail', objectId: el.dataset.obj }),
  'proof-mail-send': async (el) => {
    const p = proofs().find((x) => x.object.id === el.dataset.obj)
    const to = val('pm-to').trim()
    if (!emailOk(to)) return toast('Bitte eine gültige E-Mail-Adresse eintragen.')
    const subject = val('pm-subject').trim() || `Leistungsnachweis ${monthName(month())}`
    const text = val('pm-text')
    el.disabled = true
    try {
      const pdf = await pdfFor(p, await loadLogo().catch(() => null))
      const name = proofPdfName(p.object.name, month())
      if (canMail()) {
        await sendMail(app.auth.getToken, { to, subject, text, attachments: [{ name, blob: pdf, type: 'application/pdf' }] }, { from: app.config.mail?.from || '' })
        noteSent(p.object.id, to, 'graph')
      } else {
        download(name, pdf)
        location.href = `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?${new URLSearchParams({ subject, body: `${text}\n\n(PDF bitte anhängen: ${name})` }).toString().replace(/\+/g, '%20')}`
        noteSent(p.object.id, to, 'mailto')
      }
      if (document.getElementById('pm-remember')?.checked) rememberEmail(p.object.id, to)
      persist()
      closeModal()
      renderNow()
      toast(canMail() ? `Nachweis an ${to} gesendet.` : `E-Mail an ${to} vorbereitet; das PDF liegt im Download-Ordner.`)
    } catch (err) {
      el.disabled = false
      toast(`Nicht gesendet: ${err.message}`)
    }
  },
  'proof-mail-all': async (el) => {
    const list = proofs().filter((p) => emailOk(p.object.proofEmail) && !lastSent(p.object.id))
    if (!list.length) return toast('Alle Objekte mit E-Mail-Adresse haben den Nachweis für diesen Monat schon bekommen.')
    if (app.ui.confirm !== 'proof-all') {
      app.ui.confirm = 'proof-all'
      return toast(`${plural(list.length, 'Nachweis', 'Nachweise')} an die hinterlegten Adressen senden? Zum Bestätigen noch einmal klicken.`)
    }
    app.ui.confirm = null
    el.disabled = true
    await syncStamps().catch(() => {})
    const logo = await loadLogo().catch(() => null)
    const brand = app.config.brand || {}
    let ok = 0
    const failed = []
    for (const p of list) {
      try {
        const text = proofMailText({ objectName: p.object.name, monthLabel: monthName(month()), totals: p.proof.totals, company: brand.name || '', sender: app.user?.name || '' })
        await sendMail(app.auth.getToken, { to: p.object.proofEmail, subject: `Leistungsnachweis ${monthName(month())} – ${p.object.name}`, text, attachments: [{ name: proofPdfName(p.object.name, month()), blob: await pdfFor(p, logo), type: 'application/pdf' }] }, { from: app.config.mail?.from || '' })
        noteSent(p.object.id, p.object.proofEmail, 'graph')
        ok++
        toast(`${ok} von ${list.length} gesendet …`)
      } catch (err) {
        failed.push(`${p.object.name}: ${err.message}`)
      }
    }
    persist()
    renderNow()
    toast(failed.length ? `${ok} gesendet, ${failed.length} nicht: ${failed[0]}` : `${plural(ok, 'Nachweis', 'Nachweise')} gesendet.`)
  },
})
