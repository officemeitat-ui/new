// Lohnvorschuss (Überstunden & Auszahlung → „Vorschüsse“): Liste mit offenem Rest und nächster Rate, neuer Vorschuss mit
// Ratenplan (erste Rate, weitere Raten), Vereinbarung als PDF, „getilgt bzw. abgezogen“. Die Raten erscheinen im Export
// für das Lohnprogramm (Kennzahl „Rückzahlung Vorschuss“) und beim Austritt als Rest für die Endabrechnung.
// Rechenkern: core/vorschuss.js, PDF: export/vorschuss-pdf.js. Gespeichert in lohn/zeitkonto.json (advances).

import { formatDate, todayISO } from '../../core/dates.js'
import { advanceProblem, advanceState, planInstallments } from '../../core/vorschuss.js'
import { advanceDocument, advancePdfName } from '../../export/vorschuss-pdf.js'
import { app, canEdit, closeModal, confirmStep, openModal, persist, registerActions, registerModal, renderModal, renderNow, seesAccount, toast } from '../context.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { download, esc, euro, ICON, modalFrame, options, uid, val } from '../shared.js'

const MODULE = 'auswertung'
const list = () => (app.data.advances ||= [])
// nur wer Löhne sieht (Leserecht auf lohn/zeitkonto.json): Vollzugriff, Lohnverrechnung
const editable = () => canEdit(MODULE) && !app.readOnly && seesAccount()
const NO_RIGHT = 'Vorschüsse sieht nur, wer Löhne sehen darf (Lohnverrechnung, Vollzugriff).'
const empOf = (id) => app.data.employees.find((e) => e.id === id)
const eur = (v) => euro(Number(v) || 0)
const short = (d) => formatDate(d, { weekday: false, year: true })
const month = () => todayISO().slice(0, 7)
const monthLabel = (m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`
const company = () => {
  const s = app.data.fakturierung?.settings?.sender || {}
  return { name: s.name || app.config.brand?.name || '', address: s.address || '' }
}

function listModal() {
  if (!seesAccount()) return modalFrame({ title: 'Vorschüsse', body: `<p>${esc(NO_RIGHT)}</p>`, foot: '<button class="btn" data-action="close-modal">Schließen</button>' })
  const ed = editable()
  const now = month()
  const rows = [...list()]
    .sort((a, b) => Number(!!a.done) - Number(!!b.done) || b.date.localeCompare(a.date))
    .map((a) => {
      const st = advanceState(a, now)
      return `<tr><td><strong>${esc(empOf(a.empId)?.name || '(gelöscht)')}</strong>${a.note ? `<br><span class="muted">${esc(a.note)}</span>` : ''}</td><td>${esc(short(a.date))}</td><td class="num">${esc(eur(a.amount))}</td>
        <td class="num">${a.done ? `<span class="pill ok">erledigt ${esc(short(a.done.date))}</span>` : esc(eur(st.open))}</td><td>${st.next ? `${esc(monthLabel(st.next.month))}: ${esc(eur(st.next.amount))}` : '–'}</td>
        <td class="actions-cell"><button class="btn small" data-action="vs-pdf" data-id="${esc(a.id)}">PDF</button>${ed && !a.done ? ` <button class="btn small ghost" data-action="vs-done" data-id="${esc(a.id)}">${app.ui.confirm === `vs-done:${a.id}` ? 'Wirklich erledigt?' : 'erledigt'}</button>` : ''}${ed ? ` <button class="btn small ghost" data-action="vs-del" data-id="${esc(a.id)}">${app.ui.confirm === `vs-del:${a.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</td></tr>`
    })
    .join('')
  return modalFrame({
    title: 'Vorschüsse',
    wide: true,
    body: `<p class="note">Vorschuss auf den Lohn mit Rückzahlung in Raten: Die Raten stehen im „Export Lohnprogramm“ (Kennzahl „Rückzahlung Vorschuss“) als Abzug im jeweiligen Monat; beim Austritt zeigt „Eintritt &amp; Austritt“ den Rest für die Endabrechnung. Die Vereinbarung als PDF ausdrucken und von beiden unterschreiben lassen.</p>
      ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th>Ausgezahlt</th><th class="num">Betrag</th><th class="num">offen</th><th>nächste Rate</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Noch kein Vorschuss.</p>'}`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">${ed ? `<button class="btn primary" data-action="vs-new">${ICON.plus} Neuer Vorschuss</button>` : ''}</div>`,
  })
}
registerModal('vs-list', listModal, { module: MODULE })

function draftOf(m) {
  m.draft ||= { empId: m.empId || '', date: todayISO(), amount: '', firstMonth: month(), firstRate: '', rate: '', installments: [], note: '', iban: '', place: '', signer: app.user?.name || '' }
  return m.draft
}

function readForm(m) {
  const d = draftOf(m)
  if (!document.getElementById('vs-emp')) return d
  Object.assign(d, { empId: val('vs-emp'), date: val('vs-date'), amount: val('vs-amount'), firstMonth: val('vs-first'), firstRate: val('vs-firstrate'), rate: val('vs-rate'), note: val('vs-note').trim(), iban: val('vs-iban').trim(), place: val('vs-place').trim(), signer: val('vs-signer').trim() })
  d.installments = d.installments.map((x, i) => ({ month: val(`vs-i-m-${i}`) || x.month, amount: Number(String(val(`vs-i-a-${i}`)).replace(',', '.')) || 0 }))
  return d
}

function editModal(c, m) {
  if (!editable()) return modalFrame({ title: 'Neuer Vorschuss', body: `<p>${esc(NO_RIGHT)}</p>`, foot: '<button class="btn" data-action="close-modal">Schließen</button>' })
  const d = draftOf(m)
  const active = app.data.employees.filter((e) => !e.exitDate || e.exitDate >= todayISO()).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const inst = d.installments
    .map((x, i) => `<tr><td><input type="month" id="vs-i-m-${i}" value="${esc(x.month)}" aria-label="Monat ${i + 1}"></td><td><input type="number" id="vs-i-a-${i}" value="${esc(x.amount)}" step="0.01" min="0" aria-label="Betrag ${i + 1}"></td><td><button type="button" class="btn small ghost" data-action="vs-i-del" data-i="${i}" aria-label="Rate entfernen">✕</button></td></tr>`)
    .join('')
  const sum = d.installments.reduce((s, x) => s + (Number(x.amount) || 0), 0)
  return modalFrame({
    title: 'Neuer Vorschuss',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Person</span><select id="vs-emp">${options(active.map((e) => [e.id, e.name]), d.empId, { empty: '– Person –' })}</select></label>
        <label class="field"><span>Auszahlung am</span><input type="date" id="vs-date" value="${esc(d.date)}"></label>
        <label class="field"><span>Betrag (€)</span><input type="number" id="vs-amount" value="${esc(d.amount)}" step="0.01" min="0"></label>
        <label class="field"><span>Erste Rate im Monat</span><input type="month" id="vs-first" value="${esc(d.firstMonth)}"></label>
        <label class="field"><span>Erste Rate (€, optional anders)</span><input type="number" id="vs-firstrate" value="${esc(d.firstRate)}" step="0.01" min="0" placeholder="wie die weiteren"></label>
        <label class="field"><span>Weitere Raten (€ je Monat)</span><input type="number" id="vs-rate" value="${esc(d.rate)}" step="0.01" min="0"></label>
      </div>
      <p><button type="button" class="btn small" data-action="vs-plan">Raten berechnen</button></p>
      ${inst ? `<div class="table-wrap"><table class="data"><thead><tr><th>Monatsabrechnung</th><th>Betrag (€)</th><th></th></tr></thead><tbody>${inst}</tbody></table></div><p class="muted">Summe der Raten: ${esc(eur(sum))}</p>` : '<p class="muted">Noch keine Raten: Betrag und Raten eintragen, dann „Raten berechnen“ (danach einzeln änderbar).</p>'}
      <div class="form-grid">
        <label class="field wide"><span>Anmerkung (optional)</span><input type="text" id="vs-note" value="${esc(d.note)}"></label>
        <label class="field"><span>Bankkonto (nur fürs PDF, optional)</span><input type="text" id="vs-iban" value="${esc(d.iban)}" placeholder="AT.."></label>
        <label class="field"><span>Ort der Unterschrift</span><input type="text" id="vs-place" value="${esc(d.place)}" placeholder="z. B. Hallein"></label>
        <label class="field"><span>Unterschreibt für die Firma</span><input type="text" id="vs-signer" value="${esc(d.signer)}"></label>
      </div>
      <p class="note">Das Bankkonto wird nicht gespeichert, es steht nur im PDF. Die Raten gehen vom Netto ab; das Existenzminimum (§ 293 EO) bleibt geschützt.</p>`,
    foot: `<button class="btn" data-action="vs-open">Zurück</button><div class="actions"><button class="btn primary" data-action="vs-save">Speichern und PDF</button></div>`,
  })
}
registerModal('vs-edit', editModal, { module: MODULE })

async function pdfOf(a, extra = {}) {
  const emp = empOf(a.empId) || {}
  return pdfBlob(advanceDocument({ advance: a, emp: { name: emp.name, address: emp.address || '' }, company: company(), place: extra.place || '', iban: extra.iban || '', signer: extra.signer || '', brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) }))
}

registerActions({
  'vs-open': () => (seesAccount() ? openModal({ type: 'vs-list' }) : toast(NO_RIGHT)),
  'vs-pdf': async (el) => {
    const a = list().find((x) => x.id === el.dataset.id)
    if (a) download(advancePdfName(a, empOf(a.empId) || {}), await pdfOf(a))
  },
})

registerActions(
  {
    'vs-new': (el) => (editable() ? openModal({ type: 'vs-edit', empId: el?.dataset?.emp || '' }) : toast(NO_RIGHT)),
    'vs-plan': () => {
      const m = app.ui.modal
      const d = readForm(m)
      d.installments = planInstallments(d.amount, { firstMonth: d.firstMonth, firstRate: d.firstRate === '' ? null : d.firstRate, rate: d.rate || d.firstRate })
      if (!d.installments.length) toast('Bitte Betrag, ersten Monat und Rate eintragen.')
      renderModal()
    },
    'vs-i-del': (el) => {
      const d = readForm(app.ui.modal)
      d.installments.splice(Number(el.dataset.i), 1)
      renderModal()
    },
    'vs-save': async () => {
      if (!editable()) return toast(NO_RIGHT)
      const m = app.ui.modal
      const d = readForm(m)
      const a = { id: uid('vs'), empId: d.empId, date: d.date, amount: Number(String(d.amount).replace(',', '.')) || 0, installments: d.installments.filter((x) => x.month && x.amount > 0), note: d.note, done: null, createdAt: new Date().toISOString(), createdBy: app.user?.name || 'Browser' }
      const problem = advanceProblem(a)
      if (problem) return toast(problem)
      list().push(a)
      persist()
      const extra = { place: d.place, iban: d.iban, signer: d.signer }
      openModal({ type: 'vs-list' })
      renderNow()
      download(advancePdfName(a, empOf(a.empId) || {}), await pdfOf(a, extra))
      toast('Vorschuss gespeichert. Vereinbarung als PDF: ausdrucken und unterschreiben lassen.')
    },
    'vs-done': (el) => {
      if (!confirmStep(`vs-done:${el.dataset.id}`, renderModal)) return
      const a = list().find((x) => x.id === el.dataset.id)
      if (!a) return
      a.done = { date: todayISO(), note: 'getilgt bzw. bei der Endabrechnung abgezogen', by: app.user?.name || 'Browser' }
      persist()
      renderModal()
    },
    'vs-del': (el) => {
      if (!confirmStep(`vs-del:${el.dataset.id}`, renderModal)) return
      app.data.advances = list().filter((x) => x.id !== el.dataset.id)
      persist()
      renderModal()
    },
    'vs-close': () => closeModal(),
  },
  { edit: MODULE },
)
