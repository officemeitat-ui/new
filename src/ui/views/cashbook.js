// Kassenbuch (Modul „Einkauf & Kasse“): Bareinnahmen und -ausgaben mit fortlaufender Nummer und laufendem Stand
// (nie negativ), Beleg als Foto oder PDF, Storno statt Ändern oder Löschen, Anfangsbestand, Kassensturz mit
// Stückelung und Differenzbuchung (Tagesabschluss), Monatsabschluss mit PDF, Export für die Steuerberatung, Hinweis
// zur Registrierkassenpflicht. Barzahlung einer Ausgangsrechnung (Fakturierung) bzw. Eingangsrechnung (Einkauf)
// wird dort als Zahlung vermerkt. Datei einkauf/kassenbuch.json; Rechenkern core/cashbook.js.

import {
  addEntry,
  balanceAt,
  CASH_TYPES,
  cashExportRows,
  cashProblems,
  cashSales,
  cashSettings,
  CASH_EXPORT_COLUMNS,
  CASH_EXPORT_DEFAULT,
  closeMonth,
  closedDay,
  countCash,
  daysSinceCount,
  dueClosing,
  firstOpenMonth,
  lockedUntil,
  monthReport,
  openingAllowed,
  openingBalance,
  resolveCashDuplicates,
  RKSV,
  RKSV_HINT,
  stornoEntry,
} from '../../core/cashbook.js'
import { addDays, firstOfMonth, formatDate, todayISO } from '../../core/dates.js'
import { openAmount, openItems, parseNumber, paymentEntries, round2, settingsOf as invoicingSettings } from '../../core/invoicing.js'
import { openOf, payables, purchasePaymentEntries, removePayment, toCsv } from '../../core/purchase.js'
import { cashbookDocument, cashbookPdfName, cashbookPdfPath, monthName } from '../../export/cashbook-pdf.js'
import { app, canEdit, closeModal, confirmStep, dataStamp, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, download, esc, ICON, menu, modalFrame, options, val } from '../shared.js'
import { belegChip, by, cashCategories, E, editable, K, money, MODULE, newId, nowIso, openBeleg, plural, sees, storeBeleg } from './einkauf-shared.js'

const ICON_CASH = '<rect x="3" y="6.5" width="18" height="12" rx="2"/><circle cx="12" cy="12.5" r="2.6"/><path d="M6.5 9.5v6M17.5 9.5v6"/>'
const day = (iso) => (iso ? formatDate(iso, { year: true }) : '')
const num = (id) => parseNumber(val(id))
const numText = (n) => (n || n === 0 ? round2(n).toFixed(2).replace('.', ',') : '')
const month = () => (/^\d{4}-\d{2}$/.test(app.ui.kbMonth || '') ? app.ui.kbMonth : todayISO().slice(0, 7))
const opts = () => ({ newId: () => newId('k'), now: nowIso(), by: by(), today: todayISO() })
const entryOf = (id) => K().entries.find((e) => e.id === id)
const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01]

/** Dialog neu zeichnen, ohne dass der Fokus verloren geht (nach dem Tabulator steht er schon im nächsten Feld). */
function redraw() {
  setTimeout(() => {
    const id = document.activeElement?.id
    renderModal()
    if (id) document.getElementById(id)?.focus({ preventScroll: true })
  }, 0)
}

function commit(message) {
  persist()
  renderNow()
  if (message) toast(message)
}

/** Doppelte Nummern (zwei Geräte gleichzeitig, zusammengeführt) gleich bereinigen. */
function checkNumbers() {
  if (!editable() || !app.data.kasse) return
  const r = resolveCashDuplicates(K(), { now: nowIso(), by: by() })
  if (r.length)
    setTimeout(() => {
      persist()
      toast(`Doppelt vergebene Kassenbuch-Nummer bereinigt: ${r.map((x) => `${x.from} → ${x.to}`).join(', ')}`)
      renderNow()
    }, 0)
}

let cache = { key: '', value: null }
function status() {
  const key = `${dataStamp()}|${todayISO()}`
  if (cache.key === key) return cache.value
  const b = app.data.kasse
  const today = todayISO()
  const value = b?.entries?.length
    ? { balance: balanceAt(b), closing: dueClosing(b, today), sinceCount: daysSinceCount(b, today), problems: cashProblems(b).filter((p) => p.level === 'error'), sales: cashSales(b, today.slice(0, 4)) }
    : { balance: 0, closing: '', sinceCount: 0, problems: [], sales: { gross: 0, net: 0, over: false } }
  cache = { key, value }
  return value
}

// ---------------------------------------------------------------- Ansicht

function cashbookView() {
  checkNumbers()
  const b = K()
  const s = cashSettings(b)
  const ed = editable()
  const st = status()
  const m = month()
  const r = monthReport(b, m)
  const lastCount = [...(b.counts || [])].sort((x, y) => String(x.date).localeCompare(String(y.date)) || String(x.at).localeCompare(String(y.at))).at(-1)
  const lock = lockedUntil(b)
  const months = [...new Set([todayISO().slice(0, 7), ...b.entries.map((e) => String(e.date).slice(0, 7))])].sort().reverse()
  const byId = new Map(b.entries.map((e) => [e.id, e]))
  const rows = r.rows
    .map(({ entry: e, balance, cancelled }) => {
      const label = e.type !== 'buchung' && CASH_TYPES[e.type] && e.type !== 'storno' ? `<span class="pill">${esc(CASH_TYPES[e.type])}</span> ` : ''
      const storno = e.type === 'storno' ? ` <span class="pill warning" title="${esc(e.reason || '')}">Storno zu Nr. ${esc(byId.get(e.cancels)?.no || '?')}</span>` : cancelled ? ' <span class="pill">storniert</span>' : ''
      const ref = e.ref ? ` <span class="muted">${e.ref.type === 'ausgang' ? 'Ausgangsrechnung' : 'Eingangsrechnung'} ${esc(e.ref.number || '')}</span>` : ''
      const canStorno = ed && e.type !== 'storno' && !cancelled
      return `<tr class="${cancelled ? 'kb-cancelled' : ''}"><td>${e.no}</td><td>${day(e.date)}</td><td>${label}${esc(e.text)}${storno}${ref}<br><span class="muted">${esc([e.account ? `Konto ${e.account}` : '', e.rate ? `${e.rate} % (${money(e.vat)})` : '', e.receipt ? `Beleg ${e.receipt}` : ''].filter(Boolean).join(' · '))}</span></td>
        <td class="num">${e.kind === 'einnahme' ? money(e.amount) : ''}</td><td class="num">${e.kind === 'ausgabe' ? money(e.amount) : ''}</td><td class="num"><strong>${money(balance)}</strong></td>
        <td class="actions-cell">${belegChip(e.beleg, 'kb-beleg', { id: e.id })}${ed && !e.beleg ? `<label class="btn small ghost" title="Beleg nachreichen (Foto oder PDF)">${ICON.camera}<input type="file" accept="image/*,application/pdf" data-change="kb-beleg-file" data-id="${esc(e.id)}" hidden></label>` : ''}${canStorno ? `<button class="btn small ghost" data-action="kb-storno-open" data-id="${esc(e.id)}">Storno</button>` : ''}</td></tr>`
    })
    .join('')
  const tile = (label, value, cls = '', sub = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<small class="muted">${sub}</small>` : ''}</div>`
  return `<div class="section-head"><div><h2>Kassenbuch</h2>
      <p>Bareinnahmen und -ausgaben, täglich einzeln, mit Beleg. Einträge werden nicht geändert oder gelöscht, sondern storniert. Der Kassenstand kann nie unter null fallen.</p></div>
      <div class="actions">${ed ? `<button class="btn primary" data-action="kb-new" data-kind="einnahme">${ICON.plus} Einnahme</button><button class="btn primary" data-action="kb-new" data-kind="ausgabe">${ICON.plus} Ausgabe</button><button class="btn" data-action="kb-count-open">Kassensturz</button>` : ''}${menu({
        label: 'Mehr',
        icon: ICON.more,
        single: false,
        items: [
          ed && openingAllowed(b) && { label: 'Anfangsbestand', action: 'kb-opening-open', hint: 'Kassenstand beim Start' },
          ed && { label: 'Monatsabschluss', action: 'kb-close-open', hint: firstOpenMonth(b) ? `offen: ${monthName(firstOpenMonth(b))}` : '' },
          { label: `PDF ${monthName(m)}`, action: 'kb-pdf', data: { month: m } },
          { label: 'Export Steuerberatung', action: 'kb-export-open', hint: 'CSV wie die Fakturierung' },
          ed && { label: 'Einstellungen', action: 'kb-settings-open', hint: 'Kassenkonto, Kassendifferenzen' },
          { label: 'Einkauf', action: 'view', data: { view: 'einkauf' } },
        ],
      })}</div></div>
    ${st.problems.length ? `<div class="banner warn-banner"><p><strong>Bitte prüfen:</strong> ${st.problems.map((p) => esc(p.text)).join(' ')}</p></div>` : ''}
    ${st.sales.over ? `<div class="banner warn-banner"><p><strong>Registrierkassenpflicht prüfen:</strong> Barumsätze ${esc(todayISO().slice(0, 4))} bisher ${money(st.sales.net)} netto (Grenze ${money(RKSV.cash)} bei mehr als ${money(RKSV.turnover)} Jahresumsatz). ${esc(RKSV_HINT)}</p></div>` : `<details class="kb-rksv"><summary>Registrierkasse: Hinweis (§ 131b BAO)</summary><p>${esc(RKSV_HINT)} Barumsätze ${esc(todayISO().slice(0, 4))} laut Kassenbuch: ${money(st.sales.net)} netto.</p></details>`}
    ${!b.entries.length && ed ? `<div class="banner welcome"><p><strong>Kassenbuch beginnen:</strong> zuerst das Bargeld in der Kasse zählen und als Anfangsbestand eintragen (z. B. Endbestand aus orgaMAX), dann jede Einnahme und Ausgabe am selben Tag mit Beleg.</p><button class="btn primary" data-action="kb-opening-open">Anfangsbestand eintragen</button></div>` : ''}
    <div class="impact-stats tc-stats">${tile('Kassenstand', money(st.balance), st.balance < 0 ? 'err' : '', s.name)}${tile(`Einnahmen ${esc(monthName(m))}`, money(r.sumIn))}${tile(`Ausgaben ${esc(monthName(m))}`, money(r.sumOut))}${tile('Letzter Kassensturz', lastCount ? day(lastCount.date) : '–', st.sinceCount > 7 ? 'warn' : '', lastCount ? `Differenz ${money(lastCount.diff)}` : 'noch keiner')}${tile('Abgeschlossen bis', lock ? monthName(lock) : '–', st.closing ? 'warn' : '', st.closing ? `${monthName(st.closing)} abschließen` : closedDay(b) ? `Tag ${day(closedDay(b))}` : '')}</div>
    <div class="filters"><label class="field inline"><span>Monat</span><select id="kb-month" data-change="kb-month">${options(months.map((x) => [x, monthName(x)]), m)}</select></label><span class="spacer"></span>${r.closed ? `<span class="pill ok">abgeschlossen ${day(String(r.closed.at).slice(0, 10))}</span>` : ''}<button class="btn small" data-action="kb-pdf" data-month="${m}">${ICON.download} PDF</button></div>
    <div class="table-wrap"><table class="data kb-table"><thead><tr><th>Nr.</th><th>Datum</th><th>Text</th><th class="num">Einnahme</th><th class="num">Ausgabe</th><th class="num">Stand</th><th></th></tr></thead><tbody>
      <tr class="kb-opening"><td></td><td>${day(`${m}-01`)}</td><td><em>Anfangsbestand des Monats</em></td><td></td><td></td><td class="num">${money(r.opening)}</td><td></td></tr>
      ${rows || '<tr><td colspan="7" class="muted">Keine Einträge in diesem Monat.</td></tr>'}
      <tr class="kb-sum"><td></td><td></td><td><strong>Summe ${esc(monthName(m))}</strong></td><td class="num"><strong>${money(r.sumIn)}</strong></td><td class="num"><strong>${money(r.sumOut)}</strong></td><td class="num"><strong>${money(r.closing)}</strong></td><td></td></tr></tbody></table></div>
    ${r.counts.length ? `<h3>Kassenstürze</h3><ul>${r.counts.map((c) => `<li>${day(c.date)}: gezählt ${money(c.counted)}, laut Kassenbuch ${money(c.expected)}, Differenz <strong>${money(c.diff)}</strong>${c.closesDay ? ' · Tag abgeschlossen' : ''}${c.by ? ` · ${esc(c.by)}` : ''}</li>`).join('')}</ul>` : ''}
    <p class="note">§ 131 BAO: Bareingänge und -ausgänge täglich einzeln festhalten; der ursprüngliche Inhalt eines Eintrags muss erkennbar bleiben. Darum gibt es kein Ändern und Löschen, nur das Storno mit eigener Nummer. Jeder Eintrag und jeder Monatsabschluss trägt eine Prüfsumme. Belege liegen in SharePoint unter einkauf/kassenbuch/ (7 Jahre aufbewahren).</p>`
}

registerView({
  id: 'kassenbuch',
  order: 66,
  label: 'Kassenbuch',
  group: 'auswertung',
  section: 'finanzen',
  module: MODULE,
  icon: ICON_CASH,
  noWeek: true,
  text: 'Bareinnahmen und -ausgaben, Kassenstand, Kassensturz',
  badge: () => {
    const st = status()
    return (st.closing ? 1 : 0) + st.problems.length
  },
  render: cashbookView,
})

// ---------------------------------------------------------------- Dialog: Einnahme / Ausgabe

/** Offene Ausgangsrechnungen (Fakturierung) bzw. Eingangsrechnungen (Einkauf) zum Verknüpfen. */
function refOptions(kind) {
  if (kind === 'einnahme') {
    if (!sees('fakturierung') || !canEdit('fakturierung') || !app.data.fakturierung) return []
    const f = app.data.fakturierung
    return openItems(f.documents || [], todayISO(), invoicingSettings(f)).map((x) => ({ id: x.doc.id, number: x.doc.number, label: `${x.doc.number} ${x.doc.recipient?.name || ''} · offen ${money(x.open)}`, open: x.open, name: x.doc.recipient?.name || '' }))
  }
  return payables(E().invoices, todayISO()).map((x) => ({ id: x.inv.id, number: x.inv.no, label: `${x.inv.no} ${x.inv.supplier?.name || ''} · offen ${money(x.open)}`, open: x.open, name: x.inv.supplier?.name || '', ext: x.inv.number }))
}

function entryModal(c, m) {
  const kind = m.kind === 'ausgabe' ? 'ausgabe' : 'einnahme'
  const d = (m.draft ||= { date: todayISO(), kind, category: kind === 'einnahme' ? 'verkauf' : '', rate: kind === 'einnahme' ? 20 : 20, account: kind === 'einnahme' ? '4000' : '', text: '', amount: '', receipt: '', refId: '' })
  const cats = cashCategories(kind)
  const refs = ['rechnung', 'eingang'].includes(d.category) ? refOptions(kind) : []
  const bal = balanceAt(K())
  const pending = m.file
  return modalFrame({
    title: kind === 'einnahme' ? 'Bareinnahme' : 'Barausgabe',
    subtitle: `Kassenstand ${money(bal)}`,
    body: `<div class="form-grid">
        <label class="field"><span>Datum</span><input type="date" id="kb-date" value="${esc(d.date)}" max="${todayISO()}"></label>
        <label class="field"><span>Betrag brutto (€)</span><input type="text" inputmode="decimal" id="kb-amount" value="${esc(d.amount)}" data-change="kb-redraw"></label>
        <label class="field wide"><span>Kategorie</span><select id="kb-cat" data-change="kb-cat">${options(cats.map((x) => [x.id, x.name]), d.category, { empty: '– wählen –' })}</select></label>
        ${refs.length ? `<label class="field wide"><span>${kind === 'einnahme' ? 'Ausgangsrechnung (Fakturierung)' : 'Eingangsrechnung (Einkauf)'}</span><select id="kb-ref" data-change="kb-ref">${options(refs.map((x) => [x.id, x.label]), d.refId, { empty: '– ohne Bezug –' })}</select></label>` : ['rechnung', 'eingang'].includes(d.category) ? `<p class="wide muted">${kind === 'einnahme' ? 'Keine offene Ausgangsrechnung (oder kein Recht auf die Fakturierung).' : 'Keine offene Eingangsrechnung.'}</p>` : ''}
        <label class="field wide"><span>Text (wofür, von wem)</span><input type="text" id="kb-text" value="${esc(d.text)}" placeholder="${kind === 'einnahme' ? 'z. B. Barzahlung Sonderreinigung Fam. Beispiel' : 'z. B. Reinigungsmittel Baumarkt'}"></label>
        <label class="field"><span>USt-Satz</span><select id="kb-rate" data-change="kb-redraw">${options([20, 13, 10, 0].map((v) => [String(v), `${v} %`]), String(d.rate ?? 0))}</select></label>
        <label class="field"><span>darin Steuer (€)</span><input type="text" inputmode="decimal" id="kb-vat" value="${esc(d.vatManual ? d.vat : numText(d.rate && parseNumber(d.amount) ? parseNumber(d.amount) - parseNumber(d.amount) / (1 + d.rate / 100) : 0))}" data-change="kb-vat"></label>
        <label class="field"><span>Gegenkonto</span><input type="text" id="kb-account" value="${esc(d.account)}"></label>
        <label class="field"><span>Belegnummer</span><input type="text" id="kb-receipt" value="${esc(d.receipt)}" placeholder="z. B. Kassabon 4711"></label>
      </div>
      <div class="ek-beleg-bar"><label class="btn">${ICON.camera} Foto vom Beleg<input type="file" accept="image/*" capture="environment" data-change="kb-file" hidden></label><label class="btn">${ICON.upload} PDF oder Bild<input type="file" accept="application/pdf,image/*" data-change="kb-file" hidden></label><span class="muted small">${pending ? `Beleg bereit: ${esc(pending.name)}` : 'Beleg: jede Barzahlung braucht einen Beleg'}</span></div>
      <p class="muted">${kind === 'ausgabe' ? `Reicht der Kassenstand nicht, wird nichts gebucht (ein Stand unter null ist nicht möglich). Zuerst z. B. die Abhebung vom Bankkonto als Einnahme buchen.` : 'Barzahlung einer Rechnung: die Zahlung wird bei der Rechnung vermerkt.'} ${esc(lockedUntil(K()) ? `Abgeschlossen bis ${monthName(lockedUntil(K()))}.` : '')}</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="kb-save" data-kind="${kind}">Buchen</button></div>`,
  })
}
registerModal('kb-entry', entryModal, { module: MODULE })

function readEntry(d) {
  if (!document.getElementById('kb-date')) return d
  Object.assign(d, { date: val('kb-date'), amount: val('kb-amount'), category: val('kb-cat'), text: val('kb-text'), rate: Number(val('kb-rate')), account: val('kb-account'), receipt: val('kb-receipt'), refId: document.getElementById('kb-ref') ? val('kb-ref') : d.refId })
  if (d.vatManual) d.vat = val('kb-vat')
  return d
}

// ---------------------------------------------------------------- Dialoge: Storno, Kassensturz, Anfangsbestand, Abschluss, Export, Einstellungen

function stornoModal(c, m) {
  const e = entryOf(m.id)
  if (!e) return ''
  return modalFrame({
    title: `Storno Nr. ${e.no}`,
    subtitle: `${esc(e.text)} · ${e.kind === 'einnahme' ? 'Einnahme' : 'Ausgabe'} ${money(e.amount)} am ${day(e.date)}`,
    body: `<p>Das Storno ist ein neuer Eintrag mit eigener Nummer (Gegenbuchung). Nr. ${e.no} bleibt unverändert sichtbar.${e.ref ? ` Die Zahlung bei der ${e.ref.type === 'ausgang' ? 'Ausgangsrechnung' : 'Eingangsrechnung'} ${esc(e.ref.number || '')} wird entfernt.` : ''}</p>
      <div class="form-grid"><label class="field"><span>Datum des Stornos</span><input type="date" id="ks-date" value="${todayISO()}" max="${todayISO()}"></label><label class="field wide"><span>Grund</span><input type="text" id="ks-reason" placeholder="z. B. Betrag vertippt, doppelt gebucht"></label></div>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn danger" data-action="kb-storno" data-id="${esc(e.id)}">Stornieren</button></div>`,
  })
}
registerModal('kb-storno', stornoModal, { module: MODULE })

function countModal(c, m) {
  const date = m.date || todayISO()
  const expected = balanceAt(K(), date)
  const denoms = DENOMS.map((v) => `<label class="kb-denom"><span>${v >= 1 ? `${v} €` : `${Math.round(v * 100)} ct`}</span><input type="number" min="0" step="1" inputmode="numeric" id="kc-d-${String(v).replace('.', '_')}" data-input="kb-denom" aria-label="Anzahl ${v >= 1 ? `${v} Euro` : `${Math.round(v * 100)} Cent`}"></label>`).join('')
  return modalFrame({
    title: 'Kassensturz',
    subtitle: `laut Kassenbuch ${money(expected)}`,
    body: `<div class="form-grid"><label class="field"><span>Datum</span><input type="date" id="kc-date" value="${esc(date)}" max="${todayISO()}" data-change="kb-count-date"></label><label class="field"><span>Gezählt (€)</span><input type="text" inputmode="decimal" id="kc-counted" placeholder="${esc(numText(expected))}"></label>
        <label class="check wide"><input type="checkbox" id="kc-close" checked><span>Tagesabschluss: danach keine Buchung mehr mit diesem Datum</span></label>
        <label class="field wide"><span>Notiz</span><input type="text" id="kc-note" placeholder="z. B. gezählt mit Frau Beispiel"></label></div>
      <details class="kb-denoms"><summary>Scheine und Münzen zählen</summary><div class="kb-denom-grid">${denoms}</div></details>
      <p class="muted">Eine Differenz wird gebucht (Überschuss als Einnahme, Fehlbetrag als Ausgabe auf das Konto für Kassendifferenzen ${esc(cashSettings(K()).diffAccount || '–')}). Danach stimmt der Kassenstand mit dem Bargeld überein.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="kb-count">Kassensturz buchen</button></div>`,
  })
}
registerModal('kb-count', countModal, { module: MODULE })

function openingModal() {
  return modalFrame({
    title: 'Anfangsbestand',
    subtitle: 'erster Eintrag des Kassenbuchs',
    body: `<div class="form-grid"><label class="field"><span>Datum</span><input type="date" id="ko-date" value="${todayISO()}" max="${todayISO()}"></label><label class="field"><span>Betrag (€)</span><input type="text" inputmode="decimal" id="ko-amount" placeholder="gezähltes Bargeld"></label><label class="field wide"><span>Herkunft</span><input type="text" id="ko-note" placeholder="z. B. Endbestand orgaMAX 31.10.2026"></label></div>
      <p class="muted">Beim Umstieg: der Kassenstand aus dem alten Kassenbuch (orgaMAX) bzw. das gezählte Bargeld. Den Anfangsbestand gibt es nur einmal; ein falscher wird storniert und neu eingetragen.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="kb-opening">Eintragen</button></div>`,
  })
}
registerModal('kb-opening', openingModal, { module: MODULE })

function closeMonthModal(c, m) {
  const b = K()
  const due = firstOpenMonth(b) || addDays(firstOfMonth(todayISO()), -1).slice(0, 7)
  const ym = m.month || due
  const r = monthReport(b, ym)
  const ok = ym < todayISO().slice(0, 7)
  return modalFrame({
    title: `Monatsabschluss ${monthName(ym)}`,
    subtitle: `${plural(r.rows.length, 'Eintrag', 'Einträge')}`,
    body: `<dl class="ek-dl"><dt>Anfangsbestand</dt><dd>${money(r.opening)}</dd><dt>Einnahmen</dt><dd>${money(r.sumIn)}</dd><dt>Ausgaben</dt><dd>${money(r.sumOut)}</dd><dt>Endbestand</dt><dd><strong>${money(r.closing)}</strong></dd><dt>Kassenstürze</dt><dd>${r.counts.length || 'keiner'}</dd></dl>
      ${ok ? '' : '<p class="warn-text">Abschließen geht erst nach dem Monatsende.</p>'}
      <p class="muted">Nach dem Abschluss ist der Monat gesperrt: keine Buchung und kein Storno mehr mit einem Datum in diesem Monat (Korrekturen im offenen Monat). Das PDF wird erstellt${app.store?.kind === 'sharepoint' ? ' und unter einkauf/kassenbuch/ abgelegt' : ''}.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="kb-close" data-month="${ym}" ${ok ? '' : 'disabled'}>Abschließen</button></div>`,
  })
}
registerModal('kb-close', closeMonthModal, { module: MODULE })

function exportModal() {
  const today = todayISO()
  return modalFrame({
    title: 'Kassenbuch exportieren',
    subtitle: 'CSV für die Steuerberatung (BMD, RZL u. a.)',
    body: `<div class="form-grid"><label class="field"><span>von</span><input type="date" id="kx-from" value="${esc(app.ui.kbExFrom || `${addDays(firstOfMonth(today), -1).slice(0, 8)}01`)}"></label><label class="field"><span>bis</span><input type="date" id="kx-to" value="${esc(app.ui.kbExTo || addDays(firstOfMonth(today), -1))}"></label></div>
      <p class="muted">Eine Zeile je Eintrag (Belegart KA): Kassenbuch-Nummer, Datum, Kassenkonto, Gegenkonto, Text, Steuersatz, Steuercode (UST/VST), Netto, Steuer, Brutto (Einnahme positiv, Ausgabe negativ), Beleg, Storno zu. Strichpunkt und Dezimalkomma wie der Export der Fakturierung.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn" data-action="mail-export" data-of="kb-export" data-subject="Kassenbuch" title="Als Anhang per E-Mail senden">${ICON.send} Per E-Mail</button><button class="btn primary" data-action="kb-export">${ICON.download} CSV herunterladen</button></div>`,
  })
}
registerModal('kb-export', exportModal, { module: MODULE })

function settingsModal() {
  const s = cashSettings(K())
  return modalFrame({
    title: 'Kassenbuch: Einstellungen',
    body: `<div class="form-grid"><label class="field"><span>Name der Kasse</span><input type="text" id="kset-name" value="${esc(s.name)}"></label><label class="field"><span>Kassenkonto</span><input type="text" id="kset-account" value="${esc(s.account)}"></label><label class="field"><span>Konto für Kassendifferenzen</span><input type="text" id="kset-diff" value="${esc(s.diffAccount)}"></label></div>
      <p class="muted">Kontonummern mit der Steuerberatung abstimmen (Vorschlag: Kassa 2700, Kassendifferenzen 7890).</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="kb-settings-save">Speichern</button></div>`,
  })
}
registerModal('kb-settings', settingsModal, { module: MODULE })

// ---------------------------------------------------------------- Verknüpfte Zahlungen

/** Storno einer Barzahlung: Zahlung bei der Ausgangs- bzw. Eingangsrechnung entfernen. Liefert einen Hinweis oder ''. */
function unlinkPayment(e) {
  if (!e.ref) return ''
  if (e.ref.type === 'eingang') {
    const inv = E().invoices.find((x) => x.id === e.ref.id)
    if (inv && removePayment(inv, (p) => p.cash === e.id, { by: by(), at: nowIso(), text: `Barzahlung storniert (Kassenbuch Nr. ${e.no})` })) return ` Zahlung bei ${inv.no} entfernt.`
    return ''
  }
  const f = app.data.fakturierung
  const doc = f?.documents?.find((x) => x.id === e.ref.id)
  if (!doc) return ''
  if (!canEdit('fakturierung')) return ` Bitte die Zahlung bei ${e.ref.number} in der Fakturierung entfernen.`
  const ids = new Set((doc.payments || []).filter((p) => p.cash === e.id).map((p) => p.id))
  if (!ids.size) return ''
  doc.payments = doc.payments.filter((p) => !ids.has(p.id) && !ids.has(p.ref))
  doc.history = [...(doc.history || []), { at: nowIso(), by: by(), text: `Barzahlung storniert (Kassenbuch Nr. ${e.no})` }]
  return ` Zahlung bei ${doc.number} entfernt.`
}

async function monthPdf(ym) {
  return pdfBlob(cashbookDocument({ book: K(), month: ym, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) }))
}

// ---------------------------------------------------------------- Aktionen

registerActions({
  'kb-month': (el) => {
    app.ui.kbMonth = el.value
    renderNow()
  },
  'kb-beleg': (el) => openBeleg(entryOf(el.dataset.id)?.beleg),
  'kb-pdf': async (el) => {
    const ym = el.dataset.month || month()
    download(cashbookPdfName(ym), await monthPdf(ym))
  },
  'kb-export-open': () => openModal({ type: 'kb-export' }),
  'kb-export': () => {
    const from = val('kx-from')
    const to = val('kx-to')
    if (!from || !to || to < from) return toast('Bitte einen gültigen Zeitraum wählen.')
    app.ui.kbExFrom = from
    app.ui.kbExTo = to
    const rows = cashExportRows(K(), { from, to })
    if (!rows.length) return toast('Keine Einträge in diesem Zeitraum.')
    download(`Kassenbuch_${from}_${to}.csv`, new Blob([`﻿${toCsv(rows, CASH_EXPORT_COLUMNS, CASH_EXPORT_DEFAULT)}`], { type: 'text/csv;charset=utf-8' }))
    closeModal()
    toast(`${plural(rows.length, 'Eintrag', 'Einträge')} exportiert.`)
  },
  'kb-denom': () => {
    let sum = 0
    for (const v of DENOMS) sum += (Number(val(`kc-d-${String(v).replace('.', '_')}`)) || 0) * v
    const el = document.getElementById('kc-counted')
    if (el) el.value = numText(round2(sum))
  },
})

registerActions(
  {
    'kb-new': (el) => openModal({ type: 'kb-entry', kind: el.dataset.kind }),
    'kb-redraw': () => {
      readEntry(app.ui.modal.draft)
      redraw()
    },
    'kb-vat': () => {
      const d = app.ui.modal.draft
      d.vatManual = true
      readEntry(d)
    },
    'kb-cat': () => {
      const m = app.ui.modal
      const d = readEntry(m.draft)
      const cat = cashCategories(m.kind).find((x) => x.id === d.category)
      if (cat) Object.assign(d, { account: cat.account, rate: cat.vat ?? 0, vatManual: false })
      if (!['rechnung', 'eingang'].includes(d.category)) d.refId = ''
      redraw()
    },
    'kb-ref': () => {
      const m = app.ui.modal
      const d = readEntry(m.draft)
      const ref = refOptions(m.kind).find((x) => x.id === d.refId)
      if (ref) Object.assign(d, { amount: numText(ref.open), text: m.kind === 'einnahme' ? `Barzahlung ${ref.name} Rechnung ${ref.number}` : `Zahlung ${ref.name} Rechnung ${ref.ext || ref.number}`, receipt: ref.number, rate: 0, vatManual: false })
      redraw()
    },
    'kb-file': (el) => {
      const file = el.files?.[0]
      if (!file) return
      readEntry(app.ui.modal.draft)
      app.ui.modal.file = file
      renderModal()
    },
    'kb-save': async (el) => {
      const m = app.ui.modal
      const kind = el.dataset.kind
      const d = readEntry(m.draft)
      const ref = d.refId ? refOptions(kind).find((x) => x.id === d.refId) : null
      const draft = { date: d.date, kind, amount: d.amount, text: d.text, rate: d.rate, account: d.account, category: d.category, receipt: d.receipt, ...(d.vatManual ? { vat: d.vat } : {}), ...(ref ? { ref: { type: kind === 'einnahme' ? 'ausgang' : 'eingang', id: ref.id, number: ref.number } } : {}) }
      if (ref && round2(parseNumber(d.amount)) > ref.open + 0.004) return toast(`Der Betrag ist höher als offen (${money(ref.open)}).`)
      let entry
      try {
        entry = addEntry(K(), draft, opts())
      } catch (err) {
        return toast(err.message)
      }
      let note = ''
      if (ref && kind === 'einnahme') {
        const f = app.data.fakturierung
        const doc = f.documents.find((x) => x.id === ref.id)
        const entries = paymentEntries(doc, f.documents, invoicingSettings(f), { id: newId('p'), date: entry.date, amount: entry.amount, note: `bar (Kassenbuch Nr. ${entry.no})`, cash: entry.id, by: by(), at: nowIso() }, { newId: () => newId('p') })
        doc.payments = [...(doc.payments || []), ...entries]
        doc.history = [...(doc.history || []), { at: nowIso(), by: by(), text: `Barzahlung ${money(entry.amount)} (Kassenbuch Nr. ${entry.no})${entries[1] ? `, Skonto ${money(entries[1].amount)}` : ''}` }]
        note = openAmount(doc, f.documents, invoicingSettings(f)) <= 0.004 ? ` ${doc.number} ist bezahlt.` : ` Bei ${doc.number} vermerkt.`
      }
      if (ref && kind === 'ausgabe') {
        const inv = E().invoices.find((x) => x.id === ref.id)
        const entries = purchasePaymentEntries(inv, { id: newId('zp'), date: entry.date, amount: entry.amount, method: 'bar', cash: entry.id, note: `bar, Kassenbuch Nr. ${entry.no}`, by: by(), at: nowIso() }, { newId: () => newId('zp') })
        inv.payments = [...(inv.payments || []), ...entries]
        inv.history = [...(inv.history || []), { at: nowIso(), by: by(), text: `Barzahlung ${money(entry.amount)} (Kassenbuch Nr. ${entry.no})` }]
        note = openOf(inv) <= 0.004 ? ` ${inv.no} ist bezahlt.` : ` Bei ${inv.no} vermerkt.`
      }
      if (m.file) {
        const beleg = await storeBeleg(m.file, (ext) => `einkauf/kassenbuch/${entry.date.slice(0, 4)}/Kassenbeleg_${entry.no}_${entry.date}.${ext}`)
        if (beleg) entry.beleg = beleg
      }
      closeModal()
      commit(`Nr. ${entry.no} gebucht, Kassenstand ${money(balanceAt(K()))}.${note}${entry.beleg ? '' : ' Beleg fehlt noch.'}`)
    },
    'kb-beleg-file': async (el) => {
      const file = el.files?.[0]
      const e = entryOf(el.dataset.id)
      if (!file || !e) return
      const beleg = await storeBeleg(file, (ext) => `einkauf/kassenbuch/${e.date.slice(0, 4)}/Kassenbeleg_${e.no}_${e.date}.${ext}`)
      if (!beleg) return
      e.beleg = beleg // der Beleg zählt nicht zur Prüfsumme: nachreichen ändert den Eintrag nicht
      commit(`Beleg zu Nr. ${e.no} abgelegt.`)
    },
    'kb-storno-open': (el) => openModal({ type: 'kb-storno', id: el.dataset.id }),
    'kb-storno': (el) => {
      const e = entryOf(el.dataset.id)
      let s
      try {
        s = stornoEntry(K(), e.id, { reason: val('ks-reason'), date: val('ks-date') }, opts())
      } catch (err) {
        return toast(err.message)
      }
      const note = unlinkPayment(e)
      closeModal()
      commit(`Nr. ${e.no} storniert (Storno Nr. ${s.no}).${note}`)
    },
    'kb-count-open': () => openModal({ type: 'kb-count' }),
    'kb-count-date': (el) => {
      app.ui.modal.date = el.value
      renderModal()
    },
    'kb-count': () => {
      const counted = val('kc-counted').trim()
      let r
      try {
        r = countCash(K(), { date: val('kc-date'), counted, note: val('kc-note').trim(), closesDay: checked('kc-close') }, opts())
      } catch (err) {
        return toast(err.message)
      }
      closeModal()
      commit(r.entry ? `Kassensturz: Differenz ${money(r.count.diff)} als Nr. ${r.entry.no} gebucht.` : 'Kassensturz: Bargeld stimmt mit dem Kassenbuch überein.')
    },
    'kb-opening-open': () => openModal({ type: 'kb-opening' }),
    'kb-opening': () => {
      try {
        openingBalance(K(), { date: val('ko-date'), amount: val('ko-amount'), note: val('ko-note').trim() }, opts())
      } catch (err) {
        return toast(err.message)
      }
      closeModal()
      commit(`Anfangsbestand eingetragen, Kassenstand ${money(balanceAt(K()))}.`)
    },
    'kb-close-open': () => openModal({ type: 'kb-close' }),
    'kb-close': async (el) => {
      const ym = el.dataset.month
      if (!confirmStep(`kb-close:${ym}`, renderModal)) return
      try {
        closeMonth(K(), ym, opts())
      } catch (err) {
        return toast(err.message)
      }
      closeModal()
      commit(`${monthName(ym)} abgeschlossen.`)
      try {
        const blob = await monthPdf(ym)
        if (app.store?.kind === 'sharepoint') await app.store.upload(cashbookPdfPath(ym), blob, 'application/pdf')
        else download(cashbookPdfName(ym), blob)
      } catch (err) {
        toast(`PDF nicht abgelegt: ${err.message}`)
      }
    },
    'kb-settings-open': () => openModal({ type: 'kb-settings' }),
    'kb-settings-save': () => {
      const b = K()
      b.settings = { ...b.settings, name: val('kset-name').trim() || 'Hauptkasse', account: val('kset-account').trim(), diffAccount: val('kset-diff').trim() }
      closeModal()
      commit('Einstellungen gespeichert.')
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Zu erledigen

registerTodo({
  id: 'kassenbuch',
  module: MODULE,
  title: 'Kassenbuch',
  compute: () => {
    if (!app.data?.kasse?.entries?.length) return []
    const st = status()
    const out = []
    if (st.closing) out.push({ id: `close:${st.closing}`, kind: 'close', month: st.closing })
    if (st.sinceCount > 7) out.push({ id: `count:${Math.floor(st.sinceCount / 7)}`, kind: 'count', days: st.sinceCount })
    for (const p of st.problems) out.push({ id: `p:${p.text.slice(0, 40)}`, kind: 'problem', text: p.text })
    if (st.sales.over) out.push({ id: `rksv:${todayISO().slice(0, 4)}`, kind: 'rksv', net: st.sales.net })
    return out
  },
  render: (items) =>
    items
      .map((x) =>
        x.kind === 'close'
          ? `<div class="todo-item"><span class="flag warning">1</span><div class="todo-text"><strong>Kassenbuch ${esc(monthName(x.month))} abschließen</strong> (Monatsabschluss, PDF)</div><button class="btn small primary" data-action="kb-goto" data-v="close">Abschließen</button></div>`
          : x.kind === 'count'
            ? `<div class="todo-item"><span class="flag">!</span><div class="todo-text"><strong>Kassensturz</strong> seit ${x.days} Tagen nicht gemacht (Bargeld zählen)</div><button class="btn small" data-action="kb-goto" data-v="count">Kassensturz</button></div>`
            : x.kind === 'rksv'
              ? `<div class="todo-item"><span class="flag error">!</span><div class="todo-text"><strong>Registrierkassenpflicht prüfen:</strong> Barumsätze ${money(x.net)} netto im Jahr (über ${money(RKSV.cash)})</div><button class="btn small" data-action="kb-goto" data-v="">Kassenbuch</button></div>`
              : `<div class="todo-item"><span class="flag error">!</span><div class="todo-text"><strong>Kassenbuch:</strong> ${esc(x.text)}</div><button class="btn small" data-action="kb-goto" data-v="">Ansehen</button></div>`,
      )
      .join(''),
})

registerActions({
  'kb-goto': (el) => {
    closeModal()
    app.ui.view = 'kassenbuch'
    renderNow()
    if (el.dataset.v === 'close' && editable()) openModal({ type: 'kb-close' })
    if (el.dataset.v === 'count' && editable()) openModal({ type: 'kb-count' })
  },
})
