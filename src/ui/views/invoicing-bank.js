// Fakturierung → Reiter „Bank“: Kontoauszug einlesen (camt.053/052/054 oder CSV), Vorschau mit
// Spaltenzuordnung, Vorschläge je Eingang (sicher / wahrscheinlich / unsicher, mit Begründung),
// „Zuordnen“, „andere Rechnung“, „ignorieren“, „Alle sicheren übernehmen“. Gebuchte Zahlungen stehen
// bei der Rechnung (offene Posten), mit Verweis auf die Bankbuchung; „Lösen“ nimmt sie wieder heraus.

import { applyAllocation, cleanIban, dedupe, emptyBank, KEEP_MONTHS, nameScore, prune, readStatement, rememberIban, staleCredits, suggest, undoAllocation } from '../../core/bank.js'
import { formatDate, todayISO } from '../../core/dates.js'
import { isCancelled, openAmount, parseNumber, round2, settingsOf } from '../../core/invoicing.js'
import { app, canEdit, closeModal, openModal, persist, registerActions, registerModal, render, renderModal, renderNow, toast } from '../context.js'
import { esc, euro, modalFrame, options } from '../shared.js'

const MODULE = 'fakturierung'
const F = () => app.data.fakturierung
const B = () => {
  const d = F()
  d.bank ||= emptyBank()
  d.bank.tx ||= []
  d.bank.hashes ||= {}
  return d.bank
}
const S = () => settingsOf(F())
const editable = () => canEdit(MODULE) && !app.readOnly
const by = () => app.user?.name || 'Browser'
const money = (n) => euro(round2(n))
const docOf = (id) => F().documents.find((d) => d.id === id)
const txOf = (id) => B().tx.find((t) => t.id === id)
const ctx = () => ({ docs: F().documents, customers: F().customers, settings: S() })
const LEVEL_CLASS = { sicher: 'ok', wahrscheinlich: 'info', unsicher: 'warning' }
const shortIban = (iban) => (iban ? `${iban.slice(0, 4)} … ${iban.slice(-4)}` : '')
const day = (iso) => formatDate(iso, { year: true })

/** Offene Eingänge (für die Kennzahl am Reiter). */
export const openCredits = () => (F()?.bank?.tx || []).filter((t) => t.status === 'offen' && t.amount > 0)
export const staleBankCredits = (today) => (F()?.bank ? staleCredits(F().bank, today) : [])

// ---------------------------------------------------------------- Reiter

function allocText(allocations) {
  return allocations
    .map((a) => {
      const d = docOf(a.docId)
      return d ? `<button class="link-btn" data-action="fak-open" data-id="${esc(d.id)}">${esc(d.number)}</button> ${esc(d.recipient?.name || '')} · ${money(a.amount)}` : ''
    })
    .filter(Boolean)
    .join('<br>')
}

function creditCard(t, ed) {
  const s = suggest(t, ctx())
  const head = `<div class="bank-head"><span class="bank-amount pos">${money(t.amount)}</span><span class="muted">${esc(day(t.date))}</span>${t.batch ? `<span class="pill">Sammelgutschrift ${t.batch.n}/${t.batch.of}</span>` : ''}</div>
    <div class="bank-who"><strong>${esc(t.name || 'ohne Namen')}</strong>${t.iban ? ` <span class="muted">${esc(shortIban(t.iban))}</span>` : ''}</div>
    <div class="bank-text">${esc([t.reference, t.text].filter(Boolean).join(' · ') || '–')}</div>`
  const proposal = s.level
    ? `<div class="bank-proposal"><span class="pill ${LEVEL_CLASS[s.level]}">${esc(s.level)}</span> ${s.allocations.length ? allocText(s.allocations) : ''}<ul class="bank-why">${s.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>`
    : `<div class="bank-proposal"><span class="pill">kein Vorschlag</span><ul class="bank-why">${s.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>`
  const buttons = ed
    ? `<div class="bank-actions">${s.allocations.length ? `<button class="btn small primary" data-action="fak-bank-apply" data-id="${esc(t.id)}">Zuordnen</button>` : ''}<button class="btn small" data-action="fak-bank-assign-open" data-id="${esc(t.id)}">${s.allocations.length ? 'andere Rechnung' : 'Rechnung wählen'}</button><button class="btn small ghost" data-action="fak-bank-ignore" data-id="${esc(t.id)}" title="Kein Kundeneingang (z. B. Förderung, Rückerstattung): aus der Liste nehmen">ignorieren</button></div>`
    : ''
  return `<article class="bank-card level-${s.level || 'kein'}">${head}${proposal}${buttons}</article>`
}

export function bankTab() {
  const b = B()
  const ed = editable()
  const credits = b.tx.filter((t) => t.status === 'offen' && t.amount > 0).sort((x, y) => y.date.localeCompare(x.date))
  const sure = credits.filter((t) => suggest(t, ctx()).level === 'sicher')
  const done = b.tx.filter((t) => t.status === 'zugeordnet').sort((x, y) => (y.at || y.date).localeCompare(x.at || x.date))
  const ignored = b.tx.filter((t) => t.status === 'ignoriert')
  const debits = b.tx.filter((t) => t.status === 'abbuchung' || t.status === 'rueckbuchung').sort((x, y) => y.date.localeCompare(x.date))
  const sum = round2(credits.reduce((a, t) => a + t.amount, 0))
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  const upload = ed
    ? `<label class="btn primary bank-file">Kontoauszug einlesen<input type="file" id="fak-bank-file" accept=".xml,.csv,.txt,text/xml,application/xml,text/csv" data-change="fak-bank-file" hidden></label>`
    : ''
  return `<div class="filters">${upload}${ed && sure.length ? `<button class="btn" data-action="fak-bank-all">Alle sicheren übernehmen (${sure.length})</button>` : ''}<span class="spacer"></span><span class="muted small">camt.053/052 (XML) oder CSV aus George, ELBA, Bank Austria, BAWAG</span></div>
    <div class="impact-stats tc-stats">${tile('Eingänge offen', credits.length, credits.length ? 'warn' : '')}${tile('Summe offen', money(sum))}${tile('davon sicher zuordenbar', sure.length)}${tile('zugeordnet', done.length)}</div>
    ${credits.length ? `<h3>Eingänge zuordnen</h3><div class="bank-list">${credits.map((t) => creditCard(t, ed)).join('')}</div>` : `<p class="empty">${b.tx.length ? 'Alle Eingänge sind zugeordnet.' : 'Noch kein Kontoauszug eingelesen. Im Online-Banking den Auszug als camt.053 (XML) oder CSV herunterladen und hier einlesen.'}</p>`}
    ${done.length ? `<details class="bank-section" ${app.ui.fakBankDone ? 'open' : ''}><summary>Zugeordnet (${done.length})</summary><div class="table-wrap"><table class="data"><thead><tr><th>Datum</th><th class="num">Betrag</th><th>Von</th><th>Rechnung</th><th></th></tr></thead><tbody>${done
      .slice(0, 60)
      .map((t) => `<tr><td>${esc(day(t.date))}</td><td class="num">${money(t.amount)}</td><td>${esc(t.name || '')}</td><td>${allocText(t.allocations || [])}</td><td>${ed ? `<button class="btn small ghost" data-action="fak-bank-undo" data-id="${esc(t.id)}" title="Zahlung bei der Rechnung wieder entfernen">Lösen</button>` : ''}</td></tr>`)
      .join('')}</tbody></table></div></details>` : ''}
    ${ignored.length ? `<details class="bank-section"><summary>Ignoriert (${ignored.length})</summary><ul class="bank-plain">${ignored.map((t) => `<li>${esc(day(t.date))} · ${money(t.amount)} · ${esc(t.name || '')} <span class="muted">${esc(t.text || '')}</span>${ed ? ` <button class="link-btn" data-action="fak-bank-reopen" data-id="${esc(t.id)}">wieder zuordnen</button>` : ''}</li>`).join('')}</ul></details>` : ''}
    ${debits.length ? `<details class="bank-section"><summary>Abbuchungen und Rückbuchungen (${debits.length}, nur zur Ansicht)</summary><ul class="bank-plain">${debits.slice(0, 80).map((t) => `<li>${esc(day(t.date))} · <span class="${t.amount < 0 ? 'err-text' : ''}">${money(t.amount)}</span> · ${esc(t.name || '')} <span class="muted">${esc([t.reference, t.text].filter(Boolean).join(' · '))}</span>${t.status === 'rueckbuchung' ? ' <span class="pill warning">Rückbuchung</span>' : ''}</li>`).join('')}</ul></details>` : ''}
    <p class="note">Zuordnen bucht die Zahlung bei der Rechnung (Datum der Bank, Vermerk „Bank“); die offenen Posten und Mahnungen richten sich danach. Die IBAN des Zahlers wird beim Kunden gemerkt, damit die nächste Zahlung sicher erkannt wird. Bankbuchungen bleiben ${KEEP_MONTHS} Monate gespeichert; ein schon eingelesener Auszug wird erkannt und nicht doppelt übernommen.</p>`
}

// ---------------------------------------------------------------- Einlesen

const FIELDS = [
  ['date', 'Buchungsdatum'],
  ['valueDate', 'Valutadatum'],
  ['amount', 'Betrag (+/−)'],
  ['credit', 'Gutschrift (Haben)'],
  ['debit', 'Lastschrift (Soll)'],
  ['name', 'Name Zahler/Empfänger'],
  ['iban', 'IBAN'],
  ['text', 'Verwendungszweck/Text'],
  ['reference', 'Zahlungsreferenz'],
]

function importModal(c, m) {
  const r = m.result
  const tx = r.transactions
  const credits = tx.filter((t) => t.amount > 0)
  const { fresh, duplicates } = dedupe(tx, B().hashes)
  const csv = !String(r.format).startsWith('camt')
  const cols = csv && r.rows?.length ? (r.header ? r.rows[0] : r.rows[0].map((_, i) => `Spalte ${i + 1}`)) : []
  const mapping = csv
    ? `<details class="bank-map" ${r.ok && !m.mapOpen ? '' : 'open'}><summary>Spalten ${r.ok ? 'prüfen' : 'zuordnen'}</summary><div class="form-grid">${FIELDS.map(([k, label]) => `<label class="field"><span>${esc(label)}</span><select id="bm-${k}" data-change="fak-bank-map">${options([['', '–'], ...cols.map((h, i) => [String(i), h || `Spalte ${i + 1}`])], r.mapping?.[k] ?? '')}</select></label>`).join('')}</div></details>`
    : ''
  const preview = tx.slice(0, 8).map((t) => `<tr><td>${esc(day(t.date))}</td><td class="num ${t.amount < 0 ? 'err-text' : ''}">${money(t.amount)}</td><td>${esc(t.name || '')}</td><td class="muted">${esc([t.reference, t.text].filter(Boolean).join(' · ').slice(0, 90))}</td></tr>`).join('')
  const body = `<p><strong>${esc(r.label || r.format)}</strong>${r.account ? ` · Konto ${esc(r.account)}` : ''}${r.from ? ` · ${esc(day(r.from))}${r.to && r.to !== r.from ? ` – ${esc(day(r.to))}` : ''}` : ''} · <span class="muted">${esc(m.fileName || '')}</span></p>
    ${r.ok ? `<p>${tx.length} Buchungen: ${credits.length} Eingänge (${money(credits.reduce((a, t) => a + t.amount, 0))}), ${tx.length - credits.length} Abbuchungen. ${duplicates ? `<strong>${duplicates} schon eingelesen</strong> (werden übersprungen). ` : ''}Neu: ${fresh.length}.</p>` : '<p class="notice warn">Datum und Betrag nicht erkannt: bitte die Spalten zuordnen.</p>'}
    ${mapping}
    ${preview ? `<div class="table-wrap"><table class="data"><thead><tr><th>Datum</th><th class="num">Betrag</th><th>Name</th><th>Text</th></tr></thead><tbody>${preview}</tbody></table></div>${tx.length > 8 ? `<p class="muted small">… und ${tx.length - 8} weitere</p>` : ''}` : ''}`
  return modalFrame({
    title: 'Kontoauszug einlesen',
    body,
    wide: true,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="fak-bank-take" ${r.ok && fresh.length ? '' : 'disabled'}>${fresh.length ? `${fresh.length} ${fresh.length === 1 ? 'Buchung' : 'Buchungen'} übernehmen` : 'Nichts Neues'}</button></div>`,
  })
}
registerModal('fak-bank-import', importModal, { module: MODULE })

// ---------------------------------------------------------------- Von Hand zuordnen

function assignModal(c, m) {
  const t = txOf(m.id)
  if (!t) return ''
  const docs = F().documents
  const s = S()
  const open = docs
    .filter((d) => d.kind === 'rechnung' && d.number && !isCancelled(d, docs))
    .map((d) => ({ d, open: openAmount(d, docs, s), score: Math.max(nameScore(t.name, d.recipient?.name), cleanIban(t.iban) && (F().customers.find((cu) => cu.id === d.customerId)?.ibans || []).includes(cleanIban(t.iban)) ? 1 : 0) }))
    .filter((x) => x.open > 0.004 || m.sel?.[x.d.id])
    .sort((a, b) => b.score - a.score || String(a.d.dueDate).localeCompare(String(b.d.dueDate)))
  const sel = m.sel || (m.sel = Object.fromEntries(suggest(t, ctx()).allocations.map((a) => [a.docId, a.amount])))
  const sum = round2(Object.values(sel).reduce((a, v) => a + (Number(v) || 0), 0))
  const diff = round2(t.amount - sum)
  const q = String(m.q || '').toLowerCase()
  const rows = open
    .filter((x) => !q || [x.d.number, x.d.recipient?.name].some((v) => String(v || '').toLowerCase().includes(q)))
    .slice(0, 40)
    .map((x) => {
      const on = sel[x.d.id] !== undefined
      return `<tr><td><label class="check"><input type="checkbox" data-change="fak-bank-pick" data-doc="${esc(x.d.id)}" ${on ? 'checked' : ''}><span><strong>${esc(x.d.number)}</strong> ${esc(x.d.recipient?.name || '')}</span></label></td><td class="muted">${esc(formatDate(x.d.dueDate || x.d.date, { year: true }))}</td><td class="num">${money(x.open)}</td><td class="num">${on ? `<input type="text" inputmode="decimal" class="bank-amt" data-change="fak-bank-amt" data-doc="${esc(x.d.id)}" value="${esc(String(sel[x.d.id]).replace('.', ','))}">` : ''}</td></tr>`
    })
    .join('')
  return modalFrame({
    title: 'Eingang zuordnen',
    subtitle: `${money(t.amount)} vom ${esc(day(t.date))} · ${esc(t.name || '')}`,
    wide: true,
    body: `<p class="muted">${esc([t.reference, t.text].filter(Boolean).join(' · '))}</p>
      <label class="search-field"><input type="search" id="bank-q" value="${esc(m.q || '')}" placeholder="Rechnungsnummer oder Kunde suchen" data-input="fak-bank-q"></label>
      ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Rechnung</th><th>fällig</th><th class="num">offen</th><th class="num">zuordnen (€)</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine offenen Rechnungen gefunden.</p>'}
      <p class="${Math.abs(diff) > 0.009 ? 'err-text' : ''}">Zugeordnet ${money(sum)} von ${money(t.amount)}${Math.abs(diff) > 0.009 ? ` · ${diff > 0 ? `noch ${money(diff)} offen (der Rest geht als Überzahlung auf die letzte gewählte Rechnung)` : `${money(-diff)} zu viel`}` : ''}</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="fak-bank-assign-save" data-id="${esc(t.id)}" ${Object.keys(sel).length && diff >= -0.009 ? '' : 'disabled'}>Zuordnen</button></div>`,
  })
}
registerModal('fak-bank-assign', assignModal, { module: MODULE })

// ---------------------------------------------------------------- Aktionen

/** Zuordnung buchen und die IBAN beim Kunden merken. */
function book(t, allocations) {
  const touched = applyAllocation(t, allocations, F().documents, { by: by(), at: new Date().toISOString(), newId: () => `p${Math.random().toString(36).slice(2, 10)}`, settings: S() })
  const cust = F().customers.find((c) => c.id === touched[0]?.customerId)
  if (t.iban && cust) rememberIban(cust, t.iban)
  return touched
}

const keep = (t, fileName, at) => ({
  id: t.id,
  date: t.date,
  ...(t.valueDate && t.valueDate !== t.date ? { valueDate: t.valueDate } : {}),
  amount: t.amount,
  ...(t.currency && t.currency !== 'EUR' ? { currency: t.currency } : {}),
  name: String(t.name || '').slice(0, 120),
  iban: t.iban || '',
  text: String(t.text || '').slice(0, 300),
  reference: String(t.reference || '').slice(0, 140),
  ...(t.reversal ? { reversal: true } : {}),
  ...(t.batch ? { batch: t.batch } : {}),
  status: t.status,
  allocations: [],
  file: String(fileName || '').slice(0, 80),
  importedAt: at,
})

registerActions(
  {
    'fak-bank-file': async (el) => {
      const file = el.files?.[0]
      if (!file) return
      const text = await file.text()
      el.value = ''
      try {
        const result = readStatement(text)
        openModal({ type: 'fak-bank-import', text, fileName: file.name, result })
      } catch (err) {
        toast(`Kontoauszug nicht lesbar: ${err.message}`)
      }
    },
    'fak-bank-map': () => {
      const m = app.ui.modal
      m.mapOpen = true // Zuordnung bleibt aufgeklappt
      const mapping = { extraText: [] }
      for (const [k] of FIELDS) {
        const v = document.getElementById(`bm-${k}`)?.value
        if (v !== undefined && v !== '') mapping[k] = Number(v)
      }
      const result = readStatement(m.text, { mapping })
      m.result = { ...result, ok: mapping.date !== undefined && (mapping.amount !== undefined || mapping.credit !== undefined || mapping.debit !== undefined) && result.transactions.length > 0 }
      renderModal()
    },
    'fak-bank-take': () => {
      const m = app.ui.modal
      const b = B()
      const at = new Date().toISOString()
      const { fresh, duplicates } = dedupe(m.result.transactions, b.hashes)
      for (const t of fresh) {
        b.tx.push(keep(t, m.fileName, at))
        b.hashes[t.id] = t.date
      }
      prune(b, todayISO())
      const sure = fresh.filter((t) => t.status === 'offen' && suggest(t, ctx()).level === 'sicher').length
      closeModal()
      app.ui.fakTab = 'bank'
      persist()
      renderNow()
      toast(`${fresh.length} ${fresh.length === 1 ? 'Buchung' : 'Buchungen'} eingelesen${duplicates ? `, ${duplicates} schon vorhanden` : ''}. ${sure ? `${sure} sicher zuordenbar.` : ''}`)
    },
    'fak-bank-apply': (el) => {
      const t = txOf(el.dataset.id)
      if (!t) return
      const s = suggest(t, ctx())
      if (!s.allocations.length) return toast('Kein Vorschlag: bitte die Rechnung wählen.')
      const touched = book(t, s.allocations)
      persist()
      renderNow()
      const open = round2(touched.reduce((a, d) => a + openAmount(d, F().documents, S()), 0))
      toast(`${touched.map((d) => d.number).join(', ')}: ${open > 0.004 ? `Teilzahlung gebucht, offen ${money(open)}` : open < -0.004 ? `bezahlt, Überzahlung ${money(-open)}` : 'bezahlt'}.`)
    },
    'fak-bank-all': () => {
      let n = 0
      for (const t of B().tx.filter((x) => x.status === 'offen' && x.amount > 0)) {
        const s = suggest(t, ctx())
        if (s.level !== 'sicher' || !s.allocations.length) continue
        book(t, s.allocations)
        n++
      }
      persist()
      renderNow()
      toast(`${n} ${n === 1 ? 'Zahlung' : 'Zahlungen'} zugeordnet.`)
    },
    'fak-bank-ignore': (el) => {
      const t = txOf(el.dataset.id)
      if (!t) return
      Object.assign(t, { status: 'ignoriert', by: by(), at: new Date().toISOString() })
      persist()
      renderNow()
    },
    'fak-bank-reopen': (el) => {
      const t = txOf(el.dataset.id)
      if (!t) return
      Object.assign(t, { status: 'offen', by: by(), at: new Date().toISOString() })
      persist()
      renderNow()
    },
    'fak-bank-undo': (el) => {
      const t = txOf(el.dataset.id)
      if (!t) return
      undoAllocation(t, F().documents, { by: by() })
      persist()
      renderNow()
      toast('Zuordnung gelöst, die Zahlung ist bei der Rechnung wieder entfernt.')
    },
    'fak-bank-assign-open': (el) => openModal({ type: 'fak-bank-assign', id: el.dataset.id }),
    'fak-bank-pick': (el) => {
      const m = app.ui.modal
      const t = txOf(m.id)
      const id = el.dataset.doc
      if (el.checked) {
        const rest = round2(t.amount - Object.values(m.sel).reduce((a, v) => a + (Number(v) || 0), 0))
        const d = docOf(id)
        m.sel[id] = Math.max(0, Math.min(rest, openAmount(d, F().documents, S())))
      } else delete m.sel[id]
      renderModal()
    },
    'fak-bank-amt': (el) => {
      const m = app.ui.modal
      m.sel[el.dataset.doc] = round2(parseNumber(el.value))
      renderModal()
    },
    'fak-bank-q': (el) => {
      app.ui.modal.q = el.value
      renderModal()
      const i = document.getElementById('bank-q')
      i?.focus()
      i?.setSelectionRange(i.value.length, i.value.length)
    },
    'fak-bank-assign-save': (el) => {
      const m = app.ui.modal
      const t = txOf(el.dataset.id)
      const ids = Object.keys(m.sel)
      if (!t || !ids.length) return
      // Rest (zu wenig zugeordnet) als Überzahlung auf die letzte gewählte Rechnung
      const allocations = ids.map((docId) => ({ docId, amount: round2(m.sel[docId]) }))
      const rest = round2(t.amount - allocations.reduce((a, x) => a + x.amount, 0))
      if (rest > 0.004) allocations[allocations.length - 1].amount = round2(allocations.at(-1).amount + rest)
      try {
        book(t, allocations)
      } catch (err) {
        return toast(err.message)
      }
      closeModal()
      persist()
      renderNow()
      toast('Zahlung zugeordnet.')
    },
  },
  { edit: MODULE },
)

registerActions({
  'fak-bank-goto': () => {
    app.ui.view = 'fakturierung'
    app.ui.fakTab = 'bank'
    closeModal()
    render()
  },
})
