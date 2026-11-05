// Fakturierung → „Stammdaten ▾“ → Textbausteine und Zahlungsbedingungen (wie die Kleinstammdaten in orgaMAX):
// Textbausteine je Belegart und Stelle (Einleitung, Schlusstext, E-Mail, Mahnung, Position) mit einem Standard,
// Platzhalter wie {Anrede} oder {Fällig}; Zahlungsbedingungen mit Tagen, Skonto und eigenem Text, eine als Standard.
// Dazu das Menü „Textbaustein“ neben Textfeldern (Beleg, E-Mail, Mahnung): Baustein laden, Platzhalter einfügen.
// Daten: fakturierung.json → textBlocks[], paymentTerms[] (Datenmodell in core/invoicing.js).

import { blocksFor, fillPlaceholders, parseNumber, PLACEHOLDERS, round2, settingsOf, termsLabel, termsTextOf, TEXT_KINDS, TEXT_PLACES, unknownPlaceholders } from '../../core/invoicing.js'
import { addDays, todayISO } from '../../core/dates.js'
import { app, canEdit, closeModal, confirmStep, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { checked, esc, ICON, menu, modalFrame, options, uid, val } from '../shared.js'

const MODULE = 'fakturierung'
const F = () => {
  const d = app.data.fakturierung
  d.textBlocks ||= []
  d.paymentTerms ||= []
  return d
}
const editable = () => canEdit(MODULE) && !app.readOnly
const short = (s, n = 60) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// ---------------------------------------------------------------- Menü „Textbaustein“ neben Textfeldern

/**
 * Menü neben einem Textfeld: passende Textbausteine laden (ersetzt den Text) und Platzhalter an der
 * Schreibmarke einfügen. target: id des Textfelds; kind/place: Belegart und Stelle; fill: Platzhalter beim
 * Laden gleich auflösen (E-Mail, Mahnung: der Text geht so hinaus).
 */
export function textMenu({ target, kind, place, fill = false, label = 'Textbaustein', withBlocks = true }) {
  const list = withBlocks ? blocksFor(F().textBlocks, kind, place) : []
  return menu({
    label,
    btn: 'small ghost',
    cls: 'fak-textmenu',
    single: false,
    items: [
      withBlocks && { heading: list.length ? 'Textbaustein laden' : 'Noch keine Textbausteine' },
      ...list.map((b) => ({ label: `${esc(b.name || 'ohne Name')}${b.isDefault ? ' (Standard)' : ''}`, hint: esc(short(b.text)), action: 'fak-tb-insert', data: { target, id: b.id, fill: fill ? '1' : '' } })),
      withBlocks && !list.length && editable() && { label: 'Textbausteine verwalten', action: 'fak-tab', data: { v: 'texte' }, hint: 'Stammdaten → Textbausteine' },
      { heading: 'Platzhalter einfügen' },
      ...PLACEHOLDERS.map(([k, hint]) => ({ label: `{${esc(k)}}`, hint: esc(hint), action: 'fak-ph-insert', data: { target, ph: k } })),
    ],
  })
}

/** Kopf eines Textfelds mit dem Menü daneben. */
export const textFieldHead = (label, forId, menuHtml) => `<div class="fak-field-head"><label for="${forId}">${label}</label>${menuHtml}</div>`

// ---------------------------------------------------------------- Reiter Textbausteine

export function textsTab() {
  const d = F()
  const ed = editable()
  const kind = app.ui.fakTextKind || ''
  const list = d.textBlocks
    .filter((b) => !kind || b.kind === kind)
    .slice()
    .sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.place).localeCompare(String(b.place)) || (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || String(a.name).localeCompare(String(b.name), 'de'))
  const rows = list
    .map((b) => `<tr class="clickable" data-action="fak-text-open" data-id="${esc(b.id)}"><td><strong>${esc(b.name || 'ohne Name')}</strong>${b.isDefault ? ' <span class="pill ok">Standard</span>' : ''}</td><td>${esc(TEXT_KINDS[b.kind] || (b.kind === 'mail' ? 'E-Mail (alle)' : b.kind || 'alle'))}</td><td>${esc(TEXT_PLACES[b.place || 'intro'] || b.place)}</td><td class="muted">${esc(short(b.text, 90))}</td></tr>`)
    .join('')
  const kinds = [...new Set(d.textBlocks.map((b) => b.kind).filter(Boolean))]
  return `<div class="filters">${kinds.length > 1 ? `<label class="field inline"><span>Belegart</span><select id="fak-text-kind" data-change="fak-text-kind">${options(kinds.map((k) => [k, TEXT_KINDS[k] || k]), kind, { empty: 'alle' })}</select></label>` : ''}<span class="spacer"></span>
      ${ed && !d.textBlocks.length ? '<button class="btn small" data-action="fak-text-starter">Übliche Texte anlegen</button>' : ''}${ed ? `<button class="btn small" data-action="fak-text-open">${ICON.plus} Textbaustein</button>` : ''}</div>
    ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Belegart</th><th>Stelle</th><th>Text</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Noch keine Textbausteine. Ohne eigene Bausteine gelten die Texte aus den Einstellungen.</p>'}
    <p class="note">Je Belegart und Stelle kann ein Baustein der Standard sein: er steht in jedem neuen Beleg (bzw. in der E-Mail oder Mahnung). Im Beleg lädt „Textbaustein“ neben Einleitung und Schlusstext einen anderen. Platzhalter wie {Anrede} oder {Fällig} werden beim Festschreiben bzw. beim Senden ersetzt.</p>
    <details class="fak-ph-list"><summary>Platzhalter</summary><dl>${PLACEHOLDERS.map(([k, hint]) => `<dt><code>{${esc(k)}}</code></dt><dd>${esc(hint)}</dd>`).join('')}</dl></details>`
}

function textModal(c, m) {
  const x = m.id ? F().textBlocks.find((b) => b.id === m.id) : null
  m.draft ||= structuredClone(x || { id: uid('tb'), name: '', kind: m.kind || 'rechnung', place: m.place || 'intro', text: '', isDefault: false })
  const v = m.draft
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const unknown = unknownPlaceholders(v.text)
  const kindOpts = [...Object.entries(TEXT_KINDS), ['mail', 'E-Mail (alle Belegarten)']]
  return modalFrame({
    title: x ? x.name || 'Textbaustein' : 'Neuer Textbaustein',
    subtitle: 'Text für Belege, E-Mails oder Mahnungen',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Name</span><input type="text" id="ft-name" value="${esc(v.name)}" placeholder="z. B. Rechnung freundlich" ${dis}></label>
        <label class="field"><span>Belegart</span><select id="ft-kind" ${dis}>${options(kindOpts, v.kind || 'alle')}</select></label>
        <label class="field"><span>Stelle</span><select id="ft-place" ${dis}>${options(Object.entries(TEXT_PLACES), v.place || 'intro')}</select></label>
        <label class="check"><input type="checkbox" id="ft-default" ${v.isDefault ? 'checked' : ''} ${dis}><span>Standard für diese Belegart und Stelle</span></label>
        <div class="field wide">${textFieldHead('Text', 'ft-text', ed ? textMenu({ target: 'ft-text', withBlocks: false, label: 'Platzhalter' }) : '')}<textarea id="ft-text" rows="7" data-input="fak-text-check" ${dis}>${esc(v.text)}</textarea></div>
      </div>
      <div id="ft-check">${unknownHtml(unknown)}</div>
      <p class="note">Platzhalter in geschweiften Klammern, z. B. „{Anrede},“ am Anfang eines Briefs oder einer E-Mail. Mahnungstexte stehen im Schreiben selbst, E-Mail-Texte im Text der E-Mail.</p>`,
    foot: `<div class="actions">${ed && x ? `<button class="btn danger" data-action="fak-text-del" data-id="${esc(x.id)}">${app.ui.confirm === `fak-tdel:${x.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</div><div class="actions"><button class="btn" data-action="close-modal">Schließen</button>${ed ? '<button class="btn primary" data-action="fak-text-save">Speichern</button>' : ''}</div>`,
  })
}
registerModal('fak-text', textModal, { module: MODULE })

const unknownHtml = (list) => (list.length ? `<p class="warn-text">Unbekannte Platzhalter: ${esc(list.join(', '))}. Sie bleiben so im Text stehen.</p>` : '')

// ---------------------------------------------------------------- Reiter Zahlungsbedingungen

export function termsTab() {
  const d = F()
  const ed = editable()
  const used = (id) => d.customers.filter((cu) => cu.termsId === id).length
  const rows = d.paymentTerms
    .map((t) => `<tr class="clickable" data-action="fak-terms-open" data-id="${esc(t.id)}"><td><strong>${esc(t.name || termsLabel(t))}</strong>${t.isDefault ? ' <span class="pill ok">Standard</span>' : ''}</td><td class="num">${Number(t.days) || 0}</td><td>${parseNumber(t.skontoPercent) > 0 ? `${String(parseNumber(t.skontoPercent)).replace('.', ',')} % binnen ${Number(t.skontoDays) || 0} Tagen` : '–'}</td><td class="muted">${esc(short(t.text, 70))}</td><td class="num">${used(t.id) || ''}</td></tr>`)
    .join('')
  return `<div class="filters"><span class="spacer"></span>${ed && !d.paymentTerms.length ? '<button class="btn small" data-action="fak-terms-starter">Übliche Bedingungen anlegen</button>' : ''}${ed ? `<button class="btn small" data-action="fak-terms-open">${ICON.plus} Zahlungsbedingung</button>` : ''}</div>
    ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Zahlungsbedingung</th><th class="num">Tage netto</th><th>Skonto</th><th>eigener Text</th><th class="num">Kunden</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">Noch keine Zahlungsbedingungen. Es gilt das Zahlungsziel aus den Einstellungen (${settingsOf(d).paymentDays} Tage) bzw. beim Kunden.</p>`}
    <p class="note">Die Standard-Bedingung gilt für alle Kunden ohne eigene. Im Beleg ist sie wählbar; beim Festschreiben steht der Text mit Skontobetrag und Datum auf der Rechnung, z. B. „Zahlbar binnen 30 Tagen netto, bei Zahlung binnen 8 Tagen 2 % Skonto (€ 23,52)“. Zahlt der Kunde in der Frist brutto minus Skonto, gilt die Rechnung als bezahlt; das Skonto wird bei der Zahlung vermerkt und mindert im Export die Umsatzsteuer.</p>`
}

function termsModal(c, m) {
  const x = m.id ? F().paymentTerms.find((t) => t.id === m.id) : null
  m.draft ||= structuredClone(x || { id: uid('zb'), name: '', days: settingsOf(F()).paymentDays, skontoPercent: '', skontoDays: '', text: '', isDefault: !F().paymentTerms.length })
  const v = m.draft
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const used = x ? F().customers.filter((cu) => cu.termsId === x.id).length : 0
  return modalFrame({
    title: x ? x.name || termsLabel(x) : 'Neue Zahlungsbedingung',
    subtitle: 'Zahlungsziel und Skonto',
    wide: true,
    body: `<div class="form-grid">
        <label class="field wide"><span>Name</span><input type="text" id="fz-name" value="${esc(v.name)}" placeholder="z. B. 30 Tage netto, 8 Tage 2 %" ${dis}></label>
        <label class="field"><span>Zahlungsziel (Tage netto)</span><input type="number" id="fz-days" min="0" value="${esc(v.days ?? '')}" data-input="fak-terms-preview" ${dis}></label>
        <label class="field"><span>Skonto (%)</span><input type="text" inputmode="decimal" id="fz-pct" value="${esc(String(v.skontoPercent ?? '').replace('.', ','))}" placeholder="0" data-input="fak-terms-preview" ${dis}></label>
        <label class="field"><span>Skonto binnen (Tagen)</span><input type="number" id="fz-sdays" min="0" value="${esc(v.skontoDays ?? '')}" data-input="fak-terms-preview" ${dis}></label>
        <label class="check"><input type="checkbox" id="fz-default" ${v.isDefault ? 'checked' : ''} ${dis}><span>Standard für Kunden ohne eigene Bedingung</span></label>
        <div class="field wide">${textFieldHead('Eigener Text (optional)', 'fz-text', ed ? textMenu({ target: 'fz-text', withBlocks: false, label: 'Platzhalter' }) : '')}<textarea id="fz-text" rows="2" data-input="fak-terms-preview" placeholder="leer: Text mit Skontobetrag und Datum wird erzeugt" ${dis}>${esc(v.text || '')}</textarea></div>
      </div>
      <div id="fz-preview">${termsPreview(v)}</div>
      ${used ? `<p class="muted">Bei ${used} Kunden eingetragen.</p>` : ''}`,
    foot: `<div class="actions">${ed && x ? `<button class="btn danger" data-action="fak-terms-del" data-id="${esc(x.id)}">${app.ui.confirm === `fak-zdel:${x.id}` ? (used ? `Bei ${used} Kunden eingetragen – trotzdem löschen?` : 'Wirklich löschen?') : 'Löschen'}</button>` : ''}</div><div class="actions"><button class="btn" data-action="close-modal">Schließen</button>${ed ? '<button class="btn primary" data-action="fak-terms-save">Speichern</button>' : ''}</div>`,
  })
}
registerModal('fak-terms', termsModal, { module: MODULE })

/** Vorschau: so steht die Bedingung auf einer Rechnung über 1.200,00 € brutto von heute. */
function termsPreview(t) {
  const today = todayISO()
  const pct = parseNumber(t.skontoPercent)
  const sample = { kind: 'rechnung', date: today, dueDate: addDays(today, Number(t.days) || 0), total: { net: 1000, vat: 200, gross: 1200, groups: [] }, skonto: pct > 0 ? { percent: pct, days: Number(t.skontoDays) || 0 } : null }
  const text = termsTextOf(sample, settingsOf(F()), t) || `Bitte überweisen Sie € 1.200,00 bis ${sample.dueDate.split('-').reverse().join('.')} ohne Abzug.`
  return `<div class="fak-preview"><span class="muted">So steht es auf einer Rechnung über € 1.200,00:</span><p>${esc(text)}</p>${unknownHtml(unknownPlaceholders(t.text))}</div>`
}

function readTerms(m) {
  const v = m.draft
  if (!document.getElementById('fz-name')) return v
  Object.assign(v, { name: val('fz-name').trim(), days: val('fz-days') === '' ? '' : Math.max(0, Number(val('fz-days')) || 0), skontoPercent: round2(Math.max(0, parseNumber(val('fz-pct')))), skontoDays: val('fz-sdays') === '' ? '' : Math.max(0, Number(val('fz-sdays')) || 0), text: val('fz-text').trim(), isDefault: checked('fz-default') })
  return v
}

// ---------------------------------------------------------------- Vorlagen zum Start

const STARTER_TERMS = [
  { name: '14 Tage netto', days: 14, skontoPercent: 0, skontoDays: 0, isDefault: true },
  { name: '30 Tage netto', days: 30, skontoPercent: 0, skontoDays: 0 },
  { name: '30 Tage netto, 8 Tage 2 % Skonto', days: 30, skontoPercent: 2, skontoDays: 8 },
  { name: 'sofort ohne Abzug', days: 0, skontoPercent: 0, skontoDays: 0 },
]
const STARTER_TEXTS = [
  { name: 'Rechnung mit Anrede', kind: 'rechnung', place: 'intro', text: '{Anrede},\nfür unsere Leistungen im Zeitraum {Zeitraum} erlauben wir uns zu verrechnen:' },
  { name: 'Rechnung Dank', kind: 'rechnung', place: 'outro', text: 'Vielen Dank für Ihren Auftrag und die gute Zusammenarbeit.' },
  { name: 'Angebot mit Anrede', kind: 'angebot', place: 'intro', text: '{Anrede},\nvielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen an:' },
  { name: 'Angebot Gültigkeit', kind: 'angebot', place: 'outro', text: 'Dieses Angebot gilt bis {Gültig}. Wir freuen uns auf Ihren Auftrag.' },
  { name: 'E-Mail Rechnung', kind: 'rechnung', place: 'mail', text: '{Anrede},\n\nanbei erhalten Sie unsere Rechnung {Belegnummer} über {Betrag}, zahlbar bis {Fällig}.\n\nMit freundlichen Grüßen\n{Benutzer}\n{Firma}' },
  { name: 'E-Mail Angebot', kind: 'angebot', place: 'mail', text: '{Anrede},\n\nanbei erhalten Sie unser Angebot {Belegnummer}. Es gilt bis {Gültig}.\n\nMit freundlichen Grüßen\n{Benutzer}\n{Firma}' },
  { name: 'Mahnung freundlich', kind: 'mahnung', place: 'reminder', text: 'zu unserer Rechnung {Belegnummer} vom {Datum} konnten wir noch keinen Zahlungseingang feststellen. Bitte überweisen Sie {Offen} bis {Frist}.' },
]

// ---------------------------------------------------------------- Aktionen

/** Text an der Schreibmarke einfügen (Feld behält die Position auch ohne Fokus). */
function insertAt(el, text) {
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  el.value = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`
  el.focus()
  el.setSelectionRange(start + text.length, start + text.length)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Platzhalter-Werte für den Dialog, aus dem der Baustein geladen wird (E-Mail, Mahnung). */
export const fillHooks = { context: () => ({}) }

registerActions({
  'fak-text-kind': () => {
    app.ui.fakTextKind = val('fak-text-kind')
    renderNow()
  },
  'fak-text-open': (el) => openModal({ type: 'fak-text', id: el.dataset.id || '', kind: el.dataset.kind || '', place: el.dataset.place || '' }),
  'fak-terms-open': (el) => openModal({ type: 'fak-terms', id: el.dataset.id || '' }),
  'fak-text-check': () => {
    const box = document.getElementById('ft-check')
    if (box) box.innerHTML = unknownHtml(unknownPlaceholders(val('ft-text')))
  },
  'fak-terms-preview': () => {
    const m = app.ui.modal
    if (m?.type !== 'fak-terms') return
    readTerms(m)
    const box = document.getElementById('fz-preview')
    if (box) box.innerHTML = termsPreview(m.draft)
  },
})

registerActions(
  {
    'fak-tb-insert': (el) => {
      const field = document.getElementById(el.dataset.target)
      const b = F().textBlocks.find((x) => x.id === el.dataset.id)
      if (!field || !b) return
      field.value = el.dataset.fill ? fillPlaceholders(b.text, fillHooks.context(el.dataset.target)) : b.text
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.focus()
    },
    'fak-ph-insert': (el) => {
      const field = document.getElementById(el.dataset.target)
      if (field) insertAt(field, `{${el.dataset.ph}}`)
    },
    'fak-text-save': () => {
      const m = app.ui.modal
      const v = Object.assign(m.draft, { name: val('ft-name').trim(), kind: val('ft-kind'), place: val('ft-place'), text: val('ft-text'), isDefault: checked('ft-default') })
      if (!v.name) return toast('Bitte einen Namen eintragen.')
      if (!v.text.trim()) return toast('Bitte einen Text eintragen.')
      const d = F()
      // nur ein Standard je Belegart und Stelle
      if (v.isDefault) for (const b of d.textBlocks) if (b.id !== v.id && b.kind === v.kind && (b.place || 'intro') === v.place) b.isDefault = false
      const i = d.textBlocks.findIndex((b) => b.id === v.id)
      if (i >= 0) d.textBlocks[i] = { ...d.textBlocks[i], ...structuredClone(v) }
      else d.textBlocks.push(structuredClone(v))
      closeModal()
      persist()
      renderNow()
      toast(`Textbaustein „${v.name}“ gespeichert.`)
    },
    'fak-text-del': (el) => {
      if (!confirmStep(`fak-tdel:${el.dataset.id}`, renderModal)) return
      F().textBlocks = F().textBlocks.filter((b) => b.id !== el.dataset.id)
      closeModal()
      persist()
      renderNow()
      toast('Textbaustein gelöscht.')
    },
    'fak-terms-save': () => {
      const m = app.ui.modal
      const v = readTerms(m)
      if (!v.name) v.name = termsLabel(v)
      if (v.days === '') return toast('Bitte das Zahlungsziel in Tagen eintragen.')
      if (v.skontoPercent >= 100) return toast('Skonto muss unter 100 % liegen.')
      if (v.skontoPercent > 0 && !(Number(v.skontoDays) >= 0 && v.skontoDays !== '')) return toast('Bitte die Skontofrist in Tagen eintragen.')
      if (v.skontoPercent > 0 && Number(v.skontoDays) > Number(v.days)) return toast('Die Skontofrist liegt nach dem Zahlungsziel.')
      const d = F()
      if (v.isDefault) for (const t of d.paymentTerms) if (t.id !== v.id) t.isDefault = false
      const i = d.paymentTerms.findIndex((t) => t.id === v.id)
      if (i >= 0) d.paymentTerms[i] = { ...d.paymentTerms[i], ...structuredClone(v) }
      else d.paymentTerms.push(structuredClone(v))
      closeModal()
      persist()
      renderNow()
      toast(`Zahlungsbedingung „${v.name}“ gespeichert.`)
    },
    'fak-terms-del': (el) => {
      if (!confirmStep(`fak-zdel:${el.dataset.id}`, renderModal)) return
      F().paymentTerms = F().paymentTerms.filter((t) => t.id !== el.dataset.id)
      for (const cu of F().customers) if (cu.termsId === el.dataset.id) cu.termsId = ''
      closeModal()
      persist()
      renderNow()
      toast('Zahlungsbedingung gelöscht. Betroffene Kunden haben jetzt die Standard-Bedingung.')
    },
    'fak-terms-starter': () => {
      const d = F()
      for (const t of STARTER_TERMS) d.paymentTerms.push({ id: uid('zb'), text: '', ...t })
      persist()
      renderNow()
      toast(`${STARTER_TERMS.length} übliche Zahlungsbedingungen angelegt („14 Tage netto“ als Standard).`)
    },
    'fak-text-starter': () => {
      const d = F()
      for (const t of STARTER_TEXTS) d.textBlocks.push({ id: uid('tb'), isDefault: false, ...t })
      persist()
      renderNow()
      toast(`${STARTER_TEXTS.length} Textbausteine angelegt (noch keiner als Standard: zum Verwenden öffnen und „Standard“ anhaken).`)
    },
  },
  { edit: MODULE },
)
