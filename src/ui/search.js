// Schnellsuche (Strg+K oder Lupe): Ansichten (auch die Werkzeuge), Mitarbeitende,
// Objekte und Fahrzeuge in einem Feld. Zeigt nur, was die Rolle sehen darf.
// Suchen in den Werkzeugen (Zählstellen, Kontrollen, Akten) geht dort selbst.

import { typeOf } from '../core/anlagen.js'
import { ACTIONS, app, closeModal, openModal, registerActions, registerModal, renderModal, renderNow, sectionLabel, sectionOf, visibleViews } from './context.js'
import { quickResults } from './quick.js'
import { esc, ICON, modalFrame } from './shared.js'

// weitere Suchwörter je Ansicht (so wie man sie im Büro nennt)
const KEYWORDS = {
  assistenz: 'digitale Mitarbeiter Disponent Vorschläge Automatik erledigen',
  anleitung: 'Hilfe Handbuch Cleo Erklärung Anleitung Wie geht das FAQ',
  kennzahlen: 'Dashboard KPI Statistik Auswertung Umsatz Krankenstand Auslastung Diagramm',
  week: 'Dienstplan Einsatzplan Woche',
  timeline: 'Tag Tagesplan Gantt Balken',
  termine: 'Kalender Outlook Besprechung Begehung Meeting',
  coverage: 'Vertretung Krankenstand Ersatz offen',
  absences: 'Urlaub Krank Krankenstand Zeitausgleich',
  zeiten: 'Zeiterfassung Stempeln QR Ist Kommen Gehen Arbeitszeit',
  sheet: 'Stundenzettel Wochenzettel Arbeitszeit',
  wetter: 'Radar Regen Schnee Glätte Winterdienst Vorhersage',
  waste: 'Müll Tonnen Abfall',
  reklamationen: 'Beschwerde Mangel Kunde',
  nachweis: 'Leistungsnachweis Kunde Bericht',
  schluessel: 'Schlüssel Transponder Code',
  anlagen: 'Anlage Prüfung Prüffrist Feuerlöscher Rauchmelder Rauchwarnmelder Notbeleuchtung Spielplatz Lift Aufzug Blitzschutz Wartung Hausbetreuung',
  zaehler: 'Wasserzähler Ablesung Zählerstand',
  kontrolle: 'Prüfprotokoll Qualitätskontrolle',
  matten: 'Matten Mattenwechsel Tour Lieferschein',
  material: 'Lager Bestand Bestellung Reinigungsmittel',
  fahrzeuge: 'Auto Reifen Pickerl Service Werkstatt',
  fakturierung: 'Rechnung Angebot Mahnung Faktura Zahlung offene Posten Brief Serienbrief Briefpapier Weiterverrechnung',
  einkauf: 'Eingangsrechnung Lieferant Kreditor Verbindlichkeiten Überweisung SEPA Vorsteuer Beleg Einkauf',
  kassenbuch: 'Kasse Kassabuch Bargeld Barzahlung Kassensturz Kassenstand Registrierkasse',
  umsatzsteuer: 'UVA Umsatzsteuervoranmeldung Vorsteuer Zahllast Gutschrift Finanzamt U30 Kennzahl Steuer',
  kalkulation: 'Preis Angebot Leistungswert',
  payroll: 'Lohn Monatsabschluss',
  overtime: 'Überstunden Mehrarbeit Auszahlung',
  staff: 'Personal Mitarbeiter Team',
  sites: 'Objekte Kunden Leistungen Adressen',
  berechtigungen: 'Rechte Gruppen Rollen',
}
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const sees = (m) => !app.access || app.access.sees(m)

function results(q) {
  const n = norm(q.trim())
  if (!n) return []
  const hit = (...texts) => texts.some((t) => norm(t).includes(n))
  const out = []
  // Befehle zuerst: „termin“ → Neuer Termin, „urlaub“ → Abwesenheit eintragen
  out.push(...quickResults(hit))
  for (const v of visibleViews()) if (hit(v.label, v.text, KEYWORDS[v.id], sectionLabel(sectionOf(v)))) out.push({ group: 'Ansicht', label: v.label, sub: sectionLabel(sectionOf(v)), action: 'view', data: { view: v.id } })
  if (sees('planung') || sees('stammdaten'))
    for (const e of app.data.employees) if (hit(e.name, e.personnelNo, e.team)) out.push({ group: 'Mitarbeitende', label: e.name, sub: [e.personnelNo, e.team].filter(Boolean).join(' · '), action: sees('planung') ? 'open-person' : 'emp-edit', data: sees('planung') ? { emp: e.id } : { id: e.id } })
  if (sees('stammdaten')) for (const o of app.data.objects) if (hit(o.name, o.short, o.address)) out.push({ group: 'Objekte', label: o.name, sub: o.address || '', action: 'search-goto-sites', data: { id: o.id } })
  // Einkauf: Lieferanten und Eingangsrechnungen (Eingangsnummer, Rechnungsnummer)
  if (sees('einkauf')) {
    for (const x of app.data.einkauf?.suppliers || []) if (hit(x.name, x.supplierNo, x.city, x.uid, x.customerNo)) out.push({ group: 'Lieferanten', label: x.name || x.supplierNo, sub: [x.supplierNo, x.city].filter(Boolean).join(' · '), action: 'ek-sup-open', data: { id: x.id } })
    for (const x of app.data.einkauf?.invoices || []) if (hit(x.no, x.number, x.number?.replace(/[\s/-]/g, ''))) out.push({ group: 'Eingangsrechnungen', label: x.no, sub: [x.supplier?.name, x.number ? `Nr. ${x.number}` : ''].filter(Boolean).join(' · '), action: 'ek-inv-open', data: { id: x.id } })
  }
  // Anlagen & Prüffristen: Art, Standort, Hersteller, Seriennummer, Fremdfirma
  if (sees('anlagen'))
    for (const x of app.data.anlagen?.items || []) {
      const type = typeOf(app.data.anlagen, x.typeId)?.name || ''
      const obj = app.data.objects.find((o) => o.id === x.objectId)?.name || ''
      if (hit(x.label, x.serial, x.maker, x.company, `${type} ${obj}`)) out.push({ group: 'Anlagen', label: `${type}: ${x.label}`, sub: obj, action: 'anl-edit-open', data: { id: x.id } })
    }
  if (sees('fahrzeuge'))
    for (const v of app.data.fahrzeuge?.vehicles || []) {
      const driver = app.data.employees.find((e) => e.id === v.driverId)?.name || ''
      if (hit(v.plate, v.plate?.replace(/[\s-]/g, ''), v.label, driver)) out.push({ group: 'Fahrzeuge', label: v.plate, sub: [v.label, driver].filter(Boolean).join(' · '), action: 'veh-edit-open', data: { id: v.id } })
    }
  return out.slice(0, 40)
}

function searchModal(c, m) {
  const list = results(m.q || '')
  const sel = Math.min(m.sel || 0, Math.max(0, list.length - 1))
  let group = ''
  const items = list
    .map((r, i) => {
      const head = r.group !== group ? `<li class="search-group">${esc((group = r.group))}</li>` : ''
      return `${head}<li><button type="button" class="search-hit ${i === sel ? 'sel' : ''}" data-action="search-go" data-i="${i}"><strong>${esc(r.label)}</strong>${r.sub ? ` <span class="muted">${esc(r.sub)}</span>` : ''}</button></li>`
    })
    .join('')
  return modalFrame({
    title: 'Suchen',
    body: `<label class="search-field">${ICON.search}<input type="search" id="search-q" value="${esc(m.q || '')}" placeholder="Person, Objekt, Kennzeichen, Ansicht oder Werkzeug …" autocomplete="off" data-input="search-q"></label>
      <ul class="search-list" role="listbox">${items || (m.q ? '<li class="muted">Nichts gefunden.</li>' : '<li class="muted">Tippen zum Suchen. Pfeiltasten und Enter wählen.</li>')}</ul>`,
  })
}

registerModal('search', searchModal)

function go(r) {
  if (!r) return
  closeModal()
  const el = document.createElement('button')
  for (const [k, v] of Object.entries(r.data)) el.dataset[k] = v
  ACTIONS[r.action]?.(el)
}

function openSearch() {
  openModal({ type: 'search', q: '' })
  document.getElementById('search-q')?.focus()
}

registerActions({
  'open-search': openSearch,
  'search-q': (el) => {
    app.ui.modal.q = el.value
    app.ui.modal.sel = 0
    const pos = el.selectionStart
    renderModal()
    const input = document.getElementById('search-q')
    input?.focus()
    input?.setSelectionRange(pos, pos)
  },
  'search-go': (el) => go(results(app.ui.modal.q || '')[Number(el.dataset.i)]),
  'search-goto-sites': () => {
    app.ui.view = 'sites'
    renderNow()
  },
})

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    openSearch()
    return
  }
  if (app.ui.modal?.type !== 'search') return
  const list = results(app.ui.modal.q || '')
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    app.ui.modal.sel = Math.max(0, Math.min(list.length - 1, (app.ui.modal.sel || 0) + (e.key === 'ArrowDown' ? 1 : -1)))
    for (const [i, b] of [...document.querySelectorAll('.search-hit')].entries()) b.classList.toggle('sel', i === app.ui.modal.sel)
    document.querySelector('.search-hit.sel')?.scrollIntoView({ block: 'nearest' })
  } else if (e.key === 'Enter' && e.target.id === 'search-q') {
    e.preventDefault()
    go(list[app.ui.modal.sel || 0])
  }
})

export const searchButton = () => `<button class="btn icon" data-action="open-search" title="Suchen (Strg+K)" aria-label="Suchen">${ICON.search}</button>`
