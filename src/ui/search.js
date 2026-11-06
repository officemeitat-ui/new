// Schnellsuche (Strg+K oder Lupe): Ansichten (auch die Werkzeuge), Mitarbeitende,
// Objekte und Fahrzeuge in einem Feld. Zeigt nur, was die Rolle sehen darf.
// Suchen in den Werkzeugen (Zählstellen, Kontrollen, Akten) geht dort selbst.

import { typeOf } from '../core/anlagen.js'
import { isStoff } from '../core/arbeitsschutz.js'
import { inScope, scopeObjectIds } from '../core/zufriedenheit.js'
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
  regie: 'Regiebericht Regie Regiestunden Sonderleistung Grundreinigung Wasserschaden Zusatzarbeiten Unterschrift Auftrag',
  arbeitsschutz: 'Arbeitsschutz Arbeitsstoff Arbeitsstoffverzeichnis Gefahrstoff Chemikalie Sicherheitsdatenblatt SDB Betriebsanweisung Evaluierung Gefährdungsbeurteilung Maßnahme GHS Piktogramm ASchG Sicherheitsfachkraft',
  zaehler: 'Wasserzähler Ablesung Zählerstand',
  kontrolle: 'Prüfprotokoll Qualitätskontrolle',
  qualitaet: 'Qualität Qualitätsmessung Stichprobe EN 13549 AQL Kennzahl Raumgruppe Nachkontrolle Messung Bericht',
  zufriedenheit: 'Kundenzufriedenheit Zufriedenheit Umfrage Kundenumfrage NPS Weiterempfehlung Bewertung Sterne Feedback Rückmeldung Rückruf',
  matten: 'Matten Mattenwechsel Tour Lieferschein Werkzeug',
  'mw-liegeplaetze': 'Matten Mattenwechsel Liegeplatz Liegeplätze Schmutzfangmatte Fußmatte Intervall Gebiet Tourrunde Übernahme',
  'mw-touren': 'Matten Mattenwechsel Tour Touren Fahrer Lieferschein Stopp Liegeplatz Unterschrift Navigation Ladeliste',
  'mw-planung': 'Matten Mattenwechsel Tour Touren planen Tourenplanung Route Reihenfolge Fahrer Fahrzeug Ladeliste freigeben Betriebshof',
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
  bewerber: 'Bewerbung Bewerber Bewerberin Personalsuche AMS Inserat Lebenslauf Vorstellungsgespräch Absage Zusage',
  eintritt: 'Eintritt Austritt Onboarding Neueintritt Kündigung Checkliste Anmeldung Abmeldung ÖGK Dienstzettel Einschulung Dienstzeugnis',
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
  // Mattenwechsel: Liegeplätze (Name, Nummer aus dem Werkzeug, Kunde, Objekt)
  if (sees('matten'))
    for (const p of app.data.matten?.placements || []) {
      const obj = app.data.objects.find((o) => o.id === p.objectId)?.name || ''
      if (hit(p.name, p.legacyId, `${p.customer?.name || ''} ${obj}`, `Matte ${p.name}`, `Liegeplatz ${obj}`)) out.push({ group: 'Liegeplätze (Matten)', label: p.name, sub: [p.customer?.name, obj].filter(Boolean).join(' · '), action: 'mw-edit-open', data: { id: p.id } })
    }
  // Regieberichte: Nummer, Leistung, Auftraggeber, Objekt
  if (sees('regie'))
    for (const x of app.data.regie?.reports || []) {
      const obj = app.data.objects.find((o) => o.id === x.objectId)?.name || ''
      if (hit(x.no, x.title, x.orderedBy, x.orderRef, `${obj} ${x.title || ''}`)) out.push({ group: 'Regieberichte', label: `${x.no}: ${x.title || 'Sonderleistung'}`, sub: [obj, x.date ? x.date.split('-').reverse().join('.') : ''].filter(Boolean).join(' · '), action: 'reg-open', data: { id: x.id } })
    }
  // Qualitätsmessung: Objekte mit Raumgruppen („qualität lehen“ findet das Versicherungsbüro)
  if (sees('qualitaet'))
    for (const x of app.data.qualitaet?.objects || []) {
      const obj = app.data.objects.find((o) => o.id === x.objectId)
      if (obj && hit(`Qualitätsmessung ${obj.name}`, `Qualität ${obj.name}`, (x.groups || []).map((g) => g.name).join(' '))) out.push({ group: 'Qualitätsmessung', label: obj.name, sub: (x.groups || []).map((g) => `${g.name} ${g.rooms}`).join(' · '), action: 'qm-goto', data: { obj: obj.id } })
    }
  // Arbeitsschutz: Arbeitsstoffe (Produkt, Hersteller), Betriebsanweisungen, Evaluierungen (auch nach Gefahren)
  if (sees('arbeitsschutz')) {
    for (const a of app.data.material?.articles || []) if (isStoff(a) && hit(a.name, a.haz?.product, a.haz?.maker)) out.push({ group: 'Arbeitsstoffe', label: a.haz?.product || a.name, sub: [a.haz?.maker, a.haz?.use].filter(Boolean).join(' · '), action: 'asch-stoff-open', data: { id: a.id } })
    for (const b of app.data.arbeitsschutz?.instructions || []) if (hit(b.title, b.area)) out.push({ group: 'Betriebsanweisungen', label: b.title, sub: b.area || '', action: 'asch-ba-open', data: { id: b.id } })
    for (const ev of app.data.arbeitsschutz?.evaluations || []) if (ev.active !== false && hit(ev.title, ...(ev.hazards || []).map((h) => h.text))) out.push({ group: 'Evaluierung', label: ev.title, sub: `${(ev.hazards || []).length} Gefahren`, action: 'asch-eval-open', data: { id: ev.id } })
  }
  // Kundenzufriedenheit: Kunden (Links) mit Antworten, nur im eigenen Bereich („zufriedenheit lehen“)
  if (sees('zufriedenheit')) {
    const scope = scopeObjectIds({ all: !app.access || !!app.access.all, groups: app.user?.groups || [], reviere: app.config?.access?.reviere || {}, objects: app.data.objects })
    const seen = new Set()
    for (const a of app.data.zufriedenheit?.answers || []) {
      if (seen.has(a.linkId) || !inScope(a, scope) || !hit(`Kundenzufriedenheit ${a.linkTitle}`, `Zufriedenheit ${a.linkTitle}`, `Umfrage ${a.linkTitle}`)) continue
      seen.add(a.linkId)
      out.push({ group: 'Kundenzufriedenheit', label: a.linkTitle || 'Kunde', sub: 'Auswertung je Kunde', action: 'kz-goto', data: { link: a.linkId } })
    }
  }
  // Bewerbungen: Name, Telefon, E-Mail (nur wer Bewerbungen sieht)
  if (sees('bewerber'))
    for (const x of app.data.bewerbung?.applicants || []) if (hit(x.name, x.phone, x.email, `Bewerbung ${x.name}`)) out.push({ group: 'Bewerbungen', label: x.name, sub: [x.region, x.hours ? `${x.hours} h` : ''].filter(Boolean).join(' · '), action: 'bew-edit-open', data: { id: x.id } })
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
