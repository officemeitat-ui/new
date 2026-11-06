// Kosten weiterverrechnen (Einkauf & Kasse ↔ Fakturierung): Dialog „Weiterverrechnen“ an einer Eingangsrechnung oder
// Barausgabe (Kunde der Fakturierung, Objekt, Kosten netto, Aufschlag, Text; „nicht verrechnen“), Zustand als Hinweis in
// Listen und Dialogen, Stand für Rollen ohne Fakturierung (billed). Die Übernahme in eine Rechnung und die Liste
// „Offene Weiterverrechnungen“ stehen in invoicing.js. Rechenkern: core/recharge.js.
//
// Rechte: Ändern nur mit Schreibrecht auf Einkauf & Kasse; Kunden kommen aus der Fakturierung – wer sie nicht lesen
// darf, sieht nur den gespeicherten Stand (Kunde als Name, „verrechnet mit …“ aus billed) und kann nichts zuordnen.

import { customerForObject, customerName, deDate, parseNumber, round2, settingsOf as invoicingSettings } from '../../core/invoicing.js'
import { markupDefault, RECHARGE_STATE, rechargeAmount, rechargeSources, rechargeState, removeRecharge, reopenRecharge, setRecharge, syncBilled } from '../../core/recharge.js'
import { app, canEdit, closeModal, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { esc, modalFrame, options, val } from '../shared.js'
import { by, money, nowIso, sees } from './einkauf-shared.js'

const MODULE = 'einkauf'
const STATE_CLASS = { offen: 'info', entwurf: 'warning', verrechnet: 'ok', nicht: '' }
const numText = (n) => (n || n === 0 ? round2(n).toFixed(2).replace('.', ',') : '')

/** Belege der Fakturierung, wenn lesbar (sonst null: Stand aus billed). */
export const fakDocs = () => (sees('fakturierung') && app.data.fakturierung ? app.data.fakturierung.documents || [] : null)
const fak = () => (sees('fakturierung') ? app.data.fakturierung || null : null)
/** Daten des Einkaufs, soweit die Rolle sie lesen darf. */
export const einkaufData = () => (sees('einkauf') ? { purchase: app.data.einkauf || null, cash: app.data.kasse || null } : { purchase: null, cash: null })
/** Eingaben ändern: Schreibrecht auf Einkauf & Kasse und Kunden der Fakturierung lesbar. */
const mayEdit = () => canEdit(MODULE) && !app.readOnly && !!fak()

const sourceOf = (type, id) => rechargeSources(einkaufData()).find((s) => s.type === type && s.id === id) || null
const stateOf = (src) => (src ? rechargeState(src, fakDocs()) : null)

/** Kurzer Hinweis für Listen (Eingangsrechnungen, Kassenbuch); leer ohne Weiterverrechnung. */
export function rechargePill(type, id) {
  const src = sourceOf(type, id)
  const st = stateOf(src)
  if (!st) return ''
  const label = st.state === 'verrechnet' ? `verrechnet ${st.number}` : st.state === 'nicht' ? 'nicht verrechnen' : `weiterverrechnen: ${RECHARGE_STATE[st.state]}`
  return `<span class="pill ${STATE_CLASS[st.state]}" title="Weiterverrechnung an ${esc(src.recharge.customer || 'Kunde')}">${esc(label)}</span>`
}

/** Knopf für eine Zeile (Kassenbuch): Zustand als Knopf, sonst „weiterverrechnen“ (nur mit Recht). */
export function rechargeButton(type, id) {
  const src = sourceOf(type, id)
  if (!src) return ''
  const st = stateOf(src)
  if (!st && !mayEdit()) return ''
  const label = !st ? 'weiterverrechnen' : st.state === 'verrechnet' ? `verrechnet ${st.number}` : RECHARGE_STATE[st.state]
  return `<button class="btn small ghost fwv-btn" data-action="fwv-open" data-type="${esc(type)}" data-id="${esc(id)}" title="Kosten an einen Kunden weiterverrechnen">${esc(label)}</button>`
}

/** Abschnitt im Dialog der Eingangsrechnung. */
export function rechargeBlock(type, id) {
  const src = sourceOf(type, id)
  if (!src) return ''
  const st = stateOf(src)
  const r = src.recharge
  const ed = mayEdit()
  if (!st) {
    if (!ed) return ''
    return `<div class="fwv-block"><h4>Weiterverrechnung</h4><p class="muted">Material oder Subunternehmer für einen Kunden? Die Kosten mit Aufschlag in seine nächste Rechnung übernehmen.</p><button class="btn small" data-action="fwv-open" data-type="${esc(type)}" data-id="${esc(id)}">Weiterverrechnen</button></div>`
  }
  const a = rechargeAmount(r)
  const doc = st.state === 'verrechnet' ? (sees('fakturierung') && st.docId ? `<button class="link-btn" data-action="fak-open" data-id="${esc(st.docId)}">${esc(st.number)}</button>` : esc(st.number)) : ''
  const what = st.state === 'nicht' ? `nicht verrechnen: ${esc(r.reason || '')}` : `an ${esc(r.customer || 'Kunde')}: ${money(a.cost)} + ${String(a.markup).replace('.', ',')} % = <strong>${money(a.net)}</strong> netto`
  return `<div class="fwv-block"><h4>Weiterverrechnung</h4><p><span class="pill ${STATE_CLASS[st.state]}">${esc(RECHARGE_STATE[st.state])}</span> ${what}${doc ? ` · Rechnung ${doc}${st.date ? ` vom ${esc(deDate(st.date))}` : ''}` : ''}</p>
    ${st.state === 'entwurf' ? '<p class="muted">Steht in einem Rechnungsentwurf; verrechnet ist sie mit dem Festschreiben.</p>' : ''}
    <button class="btn small" data-action="fwv-open" data-type="${esc(type)}" data-id="${esc(id)}">${ed && ['offen', 'nicht'].includes(st.state) ? 'Ändern' : 'Ansehen'}</button></div>`
}

/**
 * Beleg stornieren erlaubt? Steht die Weiterverrechnung schon in einem Entwurf oder in einer Rechnung, zuerst dort
 * zurücknehmen (sonst verrechnet die Rechnung Kosten, die es nicht mehr gibt). Liefert den Hinweis oder ''.
 */
export function rechargeLock(type, id) {
  const st = stateOf(sourceOf(type, id))
  if (st?.state === 'verrechnet') return `Weiterverrechnet mit ${st.number}: zuerst die Rechnung stornieren, dann den Beleg.`
  if (st?.state === 'entwurf') return 'Steht als Weiterverrechnung in einem Rechnungsentwurf: zuerst dort die Position entfernen.'
  return ''
}

/**
 * Stand der Fakturierung in den Einkauf schreiben (für Rollen ohne Fakturierung). Nur mit Schreibrecht auf Einkauf &
 * Kasse und lesbarer Fakturierung; liefert die Zahl der Änderungen (danach persist()).
 */
export function syncRechargeBilled() {
  if (!canEdit(MODULE) || app.readOnly || !fakDocs() || !app.data.einkauf) return 0
  return syncBilled({ purchase: app.data.einkauf, cash: app.data.kasse || null, docs: fakDocs() })
}

// ---------------------------------------------------------------- Dialog

function form(m, src) {
  const f = fak()
  const s = f ? invoicingSettings(f) : {}
  const r = src.recharge || {}
  const customers = (f?.customers || []).filter((c) => c.active !== false || c.id === r.customerId).sort((a, b) => customerName(a).localeCompare(customerName(b), 'de'))
  const suggested = !r.customerId && src.objectId && f ? customerForObject(f, src.objectId)?.id || '' : ''
  const d = (m.draft ||= { customerId: r.customerId || suggested, objectId: r.objectId || src.objectId || '', amount: numText(r.amount ?? src.net), markup: String(r.markup ?? markupDefault(s)).replace('.', ','), text: r.text || '' })
  return `<div class="form-grid">
      <label class="field wide"><span>Weiterverrechnen an (Kunde der Fakturierung)</span><select id="fwv-customer">${options(customers.map((c) => [c.id, `${customerName(c)}${c.customerNo ? ` (${c.customerNo})` : ''}`]), d.customerId, { empty: '– Kunde wählen –' })}</select></label>
      <label class="field"><span>Objekt (optional)</span><select id="fwv-object">${options((app.data.objects || []).map((o) => [o.id, o.name]), d.objectId, { empty: '– ohne –' })}</select></label>
      <label class="field"><span>Kosten netto (€)</span><input type="text" inputmode="decimal" id="fwv-amount" value="${esc(d.amount)}" data-input="fwv-calc"></label>
      <label class="field"><span>Aufschlag (%)</span><input type="text" inputmode="decimal" id="fwv-markup" value="${esc(d.markup)}" data-input="fwv-calc"></label>
      <label class="field wide"><span>Text der Position (leer: Leistung des Belegs)</span><input type="text" id="fwv-text" value="${esc(d.text)}" placeholder="${esc(src.text || 'z. B. Reinigungsmittel lt. Beleg')}"></label>
    </div>
    <p class="fwv-sum" id="fwv-sum" aria-live="polite">${sumText(d)}</p>
    <p class="muted">Ganzer Beleg: ${money(src.net)} netto. Für einen Teil nur diesen Betrag eintragen. Die Umsatzsteuer richtet sich nach der Rechnung an den Kunden (auch Reverse Charge), nicht nach dem Beleg.</p>
    <details class="fwv-skip"${r.status === 'nicht' ? ' open' : ''}><summary>Nicht verrechnen</summary>
      <div class="form-grid"><label class="field wide"><span>Grund</span><input type="text" id="fwv-reason" value="${esc(r.reason || '')}" placeholder="z. B. im Pauschalpreis enthalten, Kulanz"></label></div>
      <button class="btn small" data-action="fwv-skip" data-type="${esc(src.type)}" data-id="${esc(src.id)}">Nicht verrechnen</button></details>`
}

const sumText = (d) => {
  const a = rechargeAmount({ amount: d.amount, markup: d.markup })
  return `In die Rechnung: ${money(a.cost)} + ${String(a.markup).replace('.', ',')} % Aufschlag = <strong>${money(a.net)} netto</strong>`
}

function readForm(m) {
  if (!document.getElementById('fwv-customer')) return m.draft
  Object.assign(m.draft, { customerId: val('fwv-customer'), objectId: val('fwv-object'), amount: val('fwv-amount'), markup: val('fwv-markup'), text: val('fwv-text').trim() })
  return m.draft
}

function rechargeModal(c, m) {
  const src = sourceOf(m.srcType, m.id)
  if (!src) return ''
  const st = stateOf(src)
  const r = src.recharge
  const head = src.type === 'einkauf' ? `${src.ref} · ${src.supplier || ''}${src.number ? ` · Nr. ${src.number}` : ''}` : `${src.ref} · ${src.text}`
  const info = `<p class="muted">${esc(head)}${src.date ? ` vom ${esc(deDate(src.date))}` : ''} · ${money(src.net)} netto</p>`
  const canChange = mayEdit() && (!st || ['offen', 'nicht'].includes(st.state))
  if (!canChange) {
    const a = rechargeAmount(r || {})
    const why = !fak() ? '<p class="muted">Kunden und Rechnungen stehen in der Fakturierung; dafür braucht es das Recht, sie zu sehen.</p>' : !canEdit(MODULE) || app.readOnly ? '<p class="muted">Nur Leserechte für Einkauf & Kasse.</p>' : st?.state === 'entwurf' ? '<p class="muted">Steht in einem Rechnungsentwurf: dort die Position entfernen, um etwas zu ändern.</p>' : st?.state === 'verrechnet' ? '<p class="muted">Verrechnet. Wird die Rechnung storniert, ist sie wieder offen.</p>' : ''
    return modalFrame({
      title: 'Weiterverrechnung',
      body: `${info}${r ? `<dl class="ek-dl"><dt>Zustand</dt><dd><span class="pill ${STATE_CLASS[st.state]}">${esc(RECHARGE_STATE[st.state])}</span>${st.number ? ` ${esc(st.number)}` : ''}</dd>${st.state === 'nicht' ? `<dt>Grund</dt><dd>${esc(r.reason || '')}</dd>` : `<dt>Kunde</dt><dd>${esc(r.customer || '–')}</dd><dt>Betrag</dt><dd>${money(a.cost)} + ${String(a.markup).replace('.', ',')} % = <strong>${money(a.net)}</strong> netto</dd>${r.text ? `<dt>Text</dt><dd>${esc(r.text)}</dd>` : ''}`}</dl>` : '<p>Keine Weiterverrechnung.</p>'}${why}`,
      foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">${st?.state === 'verrechnet' && st.docId && sees('fakturierung') ? `<button class="btn" data-action="fak-open" data-id="${esc(st.docId)}">Rechnung ${esc(st.number)}</button>` : ''}</div>`,
    })
  }
  return modalFrame({
    title: r ? 'Weiterverrechnung ändern' : 'Kosten weiterverrechnen',
    subtitle: esc(head),
    body: `${info}${st?.state === 'nicht' ? `<p><span class="pill">nicht verrechnen</span> ${esc(r.reason || '')}</p>` : ''}${form(m, src)}`,
    foot: `${r ? `<button class="btn danger" data-action="fwv-remove" data-type="${esc(src.type)}" data-id="${esc(src.id)}">${app.ui.confirm === `fwv-del:${src.id}` ? 'Wirklich entfernen?' : 'Entfernen'}</button>` : '<span></span>'}<div class="actions">${st?.state === 'nicht' ? `<button class="btn" data-action="fwv-reopen" data-type="${esc(src.type)}" data-id="${esc(src.id)}">Wieder offen</button>` : ''}<button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="fwv-save" data-type="${esc(src.type)}" data-id="${esc(src.id)}">Speichern</button></div>`,
  })
}
registerModal('fwv-edit', rechargeModal, { module: MODULE })

function done(message) {
  closeModal()
  persist()
  renderNow()
  toast(message)
}

/** Quelle und Zustand zu einem Knopf; null mit Meldung, wenn es den Beleg nicht mehr gibt. */
function picked(el) {
  const src = sourceOf(el.dataset.type, el.dataset.id)
  if (!src) toast('Beleg nicht gefunden (storniert?).')
  return src
}

registerActions({
  'fwv-open': (el) => openModal({ type: 'fwv-edit', srcType: el.dataset.type, id: el.dataset.id }),
  'fwv-calc': () => {
    const m = app.ui.modal
    if (m?.type !== 'fwv-edit' || !m.draft) return
    const box = document.getElementById('fwv-sum')
    if (box) box.innerHTML = sumText(readForm(m))
  },
})

registerActions(
  {
    'fwv-save': (el) => {
      const m = app.ui.modal
      const src = picked(el)
      if (!src || !m?.draft) return
      const d = readForm(m)
      const cu = (fak()?.customers || []).find((c) => c.id === d.customerId)
      try {
        setRecharge(src.target, { ...d, amount: parseNumber(d.amount), markup: parseNumber(d.markup) }, { state: stateOf(src)?.state || null, net: src.net, customerName: cu ? customerName(cu) : '', by: by(), at: nowIso() })
      } catch (err) {
        return toast(err.message)
      }
      done(`Weiterverrechnung an ${cu ? customerName(cu) : 'den Kunden'} gespeichert: ${money(rechargeAmount(src.target.recharge).net)} netto. Sie steht in der Fakturierung unter „Weiterverrechnung“.`)
    },
    'fwv-skip': (el) => {
      const src = picked(el)
      if (!src) return
      try {
        setRecharge(src.target, { status: 'nicht', reason: val('fwv-reason') }, { state: stateOf(src)?.state || null, by: by(), at: nowIso() })
      } catch (err) {
        return toast(err.message)
      }
      done('Auf „nicht verrechnen“ gesetzt.')
    },
    'fwv-reopen': (el) => {
      const src = picked(el)
      if (!src) return
      reopenRecharge(src.target, { by: by(), at: nowIso() })
      app.ui.modal.draft = null
      persist()
      renderModal()
      renderNow()
      toast('Weiterverrechnung wieder offen.')
    },
    'fwv-remove': (el) => {
      const src = picked(el)
      if (!src) return
      const st = stateOf(src)
      if (st && !['offen', 'nicht'].includes(st.state)) return toast(st.state === 'verrechnet' ? 'Schon verrechnet: bleibt stehen.' : 'Steht in einem Rechnungsentwurf: dort zuerst die Position entfernen.')
      if (app.ui.confirm !== `fwv-del:${src.id}`) {
        app.ui.confirm = `fwv-del:${src.id}`
        readForm(app.ui.modal)
        return renderModal()
      }
      app.ui.confirm = null
      removeRecharge(src.target, { state: st?.state || null })
      done('Weiterverrechnung entfernt.')
    },
  },
  { edit: MODULE },
)
