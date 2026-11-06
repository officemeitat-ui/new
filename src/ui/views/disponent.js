// Digitale Mitarbeiter: vier Routinen, die die Daten der App wie eine Bürokraft durchgehen und
// fertige Arbeitsschritte vorbereiten. Die Person entscheidet: „Ausführen“ (mit einem Klick, in
// der Planung mit Rückgängig), „Öffnen“ (selbst erledigen), „Später“ (bis morgen) oder „Ablehnen“.
//
//   Disponent    Vertretungen bei Abwesenheiten, offene Einsätze dieser und nächster Woche,
//                Woche veröffentlichen, Prüfbericht mit Fehlern
//   Buchhaltung  Daueraufträge abrechnen, überfällige Rechnungen mahnen, Leistungsnachweise
//   Lager        Bestellvorschläge je Lieferant, offene Anforderungen aus den Objekten
//   Fristen      ablaufende Unterweisungen (Schulungstermin vorschlagen), Fahrzeuge (Werkstatt),
//                überfällige Reklamationen, Anlagen-Prüfungen und offene Mängel je Objekt (nur „Öffnen“)
//
// Ein Vorschlag verschwindet von selbst, wenn die Lage erledigt ist (die Daten ändern sich), und
// kommt mit neuer Kennung wieder, wenn sich etwas Wesentliches ändert (z. B. mehr offene Einsätze).
// Entscheidungen „Ablehnen“/„Später“ gelten für alle (assistenz/entscheidungen.json).
//
// Bewusst ohne KI-Modell: die Regeln sind nachvollziehbar und kosten nichts; über „KI fragen“ kann
// der KI-Assistent einen Vorschlag mit der Person besprechen.

import { addDays, formatDate, isoWeek, mondayOf, todayISO } from '../../core/dates.js'
import { anlagenRows, attention as anlagenAttention, isUrgent as anlagenUrgent } from '../../core/anlagen.js'
import { isOverdue as complaintOverdue } from '../../core/complaints.js'
import { paymentReminders } from '../../core/fak-laeufe.js'
import { isInvoice, nextReminder, openItems, periodOf, settingsOf } from '../../core/invoicing.js'
import { isOpenRequest, orderSuggestions } from '../../core/material.js'
import { dueList, typesOf } from '../../core/trainings.js'
import { openTasks, taskLabel } from '../../core/vehicle-dues.js'
import { ACTIONS, app, canEdit, compute, ensureRange, memo, openModal, persist, registerActions, registerView, render, renderNow, toast } from '../context.js'
import { canMail } from '../modals/send.js'
import { todo } from '../modals/todo.js'
import { planWeek } from '../planning.js'
import { esc, ICON } from '../shared.js'

export const AGENTS = [
  { id: 'disponent', name: 'Disponent', role: 'plant Vertretungen und offene Einsätze, erinnert ans Veröffentlichen', module: 'planung' },
  { id: 'buchhaltung', name: 'Buchhaltung', role: 'rechnet Daueraufträge ab, bereitet Mahnungen und Leistungsnachweise vor', module: 'fakturierung' },
  { id: 'lager', name: 'Lager', role: 'bestellt nach, was unter dem Mindestbestand ist, und hat Anforderungen im Blick', module: 'material' },
  { id: 'fristen', name: 'Fristen', role: 'achtet auf Unterweisungen, Fahrzeuge, Prüffristen der Anlagen und überfällige Reklamationen', module: '*' },
]

const doc = () => (app.data.assistenz ||= { decided: {} })
const decided = () => (doc().decided ||= {})
const by = () => app.user?.name || 'Büro'
const sees = (m) => !app.access || app.access.sees(m)
const edits = (m) => canEdit(m)
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const objName = (id) => app.data.objects.find((o) => o.id === id)?.name || ''
const empName = (id) => app.data.employees.find((e) => e.id === id)?.name || '?'

// ---------------------------------------------------------------- Routinen

function disponent(today) {
  if (!edits('planung')) return []
  const out = []
  const t = todo()
  for (const x of t.absences) {
    const a = x.absence
    out.push({
      id: `abw:${a.id}:${x.count}`,
      agent: 'disponent',
      prio: a.from <= addDays(today, 2) ? 1 : 2,
      title: `Vertretung für ${empName(a.employeeId)} (${a.type} ${formatDate(a.from)}${a.to !== a.from ? `–${formatDate(a.to)}` : ''})`,
      text: `${plural(x.count, 'Einsatz ist', 'Einsätze sind')} betroffen, zusammen ${Math.round((x.minutes / 60) * 10) / 10} h${x.stillAssigned ? `, davon ${x.stillAssigned} noch mit ${empName(a.employeeId).split(' ')[0]} eingeteilt` : ''}. Ich verteile sie regelkonform (Ruhezeiten, Wochenstunden, Revier, Einschulung).`,
      run: { label: 'Vertretungen verteilen', action: 'impact-auto', data: { id: a.id } },
      open: { label: 'Selbst planen', action: 'open-impact', data: { id: a.id } },
    })
  }
  for (const monday of [mondayOf(today), addDays(mondayOf(today), 7)]) {
    const c = compute(monday)
    const open = c.week.filter((i) => i.status !== 'cancelled' && i.date >= today && i.date <= c.sunday && c.state.count(i.key) < i.staff)
    if (open.length) {
      const { week } = isoWeek(monday)
      out.push({
        id: `offen:${monday}:${open.length}`,
        agent: 'disponent',
        prio: monday === mondayOf(today) ? 1 : 3,
        title: `KW ${week}: ${plural(open.length, 'offener Einsatz', 'offene Einsätze')} besetzen`,
        text: `Zuerst Stammkräfte, dann Vertretungen mit freien Stunden; fixierte Einteilungen bleiben. Erster offener: ${formatDate(open[0].date)} ${open[0].startTime} ${objName(open[0].objectId)}.`,
        run: { label: 'Woche planen', fn: 'planen', data: { monday } },
        open: { label: 'Vertretungen ansehen', view: 'coverage', monday },
      })
    }
    const pub = app.data.published?.[monday]
    const assigned = c.week.some((i) => c.state.count(i.key) > 0)
    if (!pub && assigned && monday > mondayOf(today) && addDays(monday, -3) <= today) {
      const { week } = isoWeek(monday)
      out.push({
        id: `pub:${monday}`,
        agent: 'disponent',
        prio: 2,
        title: `KW ${week} veröffentlichen`,
        text: `Die Woche beginnt am ${formatDate(monday)} und ist noch Entwurf. Nach dem Veröffentlichen bekommen alle ihren Plan (Handy, PDF, Kalender-Abo).`,
        run: { label: 'Veröffentlichen …', fn: 'publish', data: { monday } },
      })
    }
  }
  for (const w of t.weeks.filter((x) => x.started)) {
    out.push({
      id: w.id,
      agent: 'disponent',
      prio: 2,
      title: `KW ${isoWeek(w.monday).week}: Änderungen nach dem Veröffentlichen buchen`,
      text: `${plural(w.changed.length, 'Person hat', 'Personen haben')} seit dem Veröffentlichen einen geänderten Plan (Zeitkonto, Plan am Handy).`,
      run: { label: 'Korrektur buchen …', fn: 'publish', data: { monday: w.monday } },
    })
  }
  return out
}

function buchhaltung(today) {
  const d = app.data.fakturierung
  if (!d || !edits('fakturierung')) return []
  const out = []
  const settings = settingsOf(d)
  const ym = today.slice(0, 7)
  const have = new Set((d.documents || []).map((x) => x.source?.key).filter(Boolean))
  const due = (d.recurring || []).filter((r) => r.active !== false && periodOf(r, ym) && !have.has(`rec:${r.id}:${ym}`))
  if (due.length) {
    const label = new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('de-AT', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    out.push({
      id: `dauer:${ym}:${due.length}`,
      agent: 'buchhaltung',
      prio: 2,
      title: `${plural(due.length, 'Dauerauftrag', 'Daueraufträge')} für ${label} abrechnen`,
      text: `Ich lege die Rechnungsentwürfe an (mit Wertsicherung, wo vereinbart). Festschreiben und Versenden bleibt bei dir.`,
      lines: due.slice(0, 5).map((r) => r.title || objName(r.objectId)),
      run: { label: 'Entwürfe erstellen', action: 'fak-run', data: { ym } },
      open: { label: 'Daueraufträge', view: 'fakturierung', fakTab: 'dauer' },
    })
  }
  const docs = d.documents || []
  // freundliche erste Erinnerung per E-Mail: eigener Vorschlag mit Freigabe (Mahnlauf-Dialog „nur Zahlungserinnerungen“)
  const ready = canMail() ? paymentReminders(docs, d.customers || [], today, settings).ready : []
  if (ready.length)
    out.push({
      id: `erinnern:${today}:${ready.map((x) => x.doc.id).join(',')}`,
      agent: 'buchhaltung',
      prio: 2,
      title: `${plural(ready.length, 'Zahlungserinnerung', 'Zahlungserinnerungen')} bereit`,
      text: 'Freundlich per E-Mail mit PDF, ohne Zinsen und Gebühr. Ich zeige dir die Liste; gesendet wird erst, wenn du freigibst.',
      lines: ready.slice(0, 5).map((x) => `${x.doc.number} ${x.doc.recipient?.name || ''}`.trim()),
      run: { label: 'Prüfen und senden …', action: 'fak-erinnern-open' },
      open: { label: 'Offene Posten', view: 'fakturierung', fakTab: 'offen' },
    })
  const readyIds = new Set(ready.map((x) => x.doc.id))
  const remind = docs.filter((x) => isInvoice(x) && x.number && !readyIds.has(x.id) && nextReminder(x, today, settings))
  if (remind.length) {
    out.push({
      id: `mahn:${today.slice(0, 7)}:${remind.map((x) => `${x.id}${(x.reminders || []).length}`).join(',')}`,
      agent: 'buchhaltung',
      prio: 2,
      title: `${plural(remind.length, 'Rechnung ist', 'Rechnungen sind')} überfällig`,
      text: 'Mahnungen sind fällig (Mahnstufe nach Einstellung, mit Zinsen und Pauschale ab der 2. Stufe).',
      lines: remind.slice(0, 5).map((x) => `${x.number} ${x.recipient?.name || ''}`.trim()),
      open: { label: 'Offene Posten', view: 'fakturierung', fakTab: 'offen' },
    })
  }
  // Zahlungseingänge aus dem Kontoauszug, die noch keiner Rechnung zugeordnet sind
  const credits = (d.bank?.tx || []).filter((t) => t.status === 'offen' && t.amount > 0)
  if (credits.length) {
    const sum = credits.reduce((n, t) => n + t.amount, 0)
    out.push({
      id: `bank:${credits.map((t) => t.hash || t.id).join(',')}`,
      agent: 'buchhaltung',
      prio: credits.some((t) => (t.date || today) < addDays(today, -7)) ? 1 : 2,
      title: `${plural(credits.length, 'Zahlungseingang', 'Zahlungseingänge')} zuordnen (${sum.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })})`,
      text: 'Aus dem eingelesenen Kontoauszug. Sichere Zuordnungen (Rechnungsnummer und Betrag passen) lassen sich mit einem Klick übernehmen.',
      lines: credits.slice(0, 5).map((t) => `${t.date ? formatDate(t.date) : ''} ${t.name || ''} ${t.amount.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}`.trim()),
      open: { label: 'Bankabgleich', view: 'fakturierung', fakTab: 'bank' },
    })
  }
  const items = openItems(docs, today, settings)
  const sum = items.reduce((s, x) => s + (x.open || 0), 0)
  if (items.length && !remind.length && items.some((x) => x.overdueDays > 0)) {
    out.push({ id: `op:${items.length}`, agent: 'buchhaltung', prio: 3, title: `${items.length} offene Posten (${sum.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })})`, text: 'Zahlungseingänge prüfen.', open: { label: 'Offene Posten', view: 'fakturierung', fakTab: 'offen' } })
  }
  // Leistungsnachweise des Vormonats: noch nicht versendet
  if (sees('planung') && app.data.nachweise && Number(today.slice(8, 10)) <= 15) {
    const prev = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)
    const withMail = app.data.objects.filter((o) => !o.inactive && o.proofEmail)
    const missing = withMail.filter((o) => !Object.keys(app.data.nachweise.sent || {}).some((k) => k.startsWith(prev) && k.includes(o.id)))
    if (missing.length)
      out.push({
        id: `nachweis:${prev}:${missing.length}`,
        agent: 'buchhaltung',
        prio: 3,
        title: `Leistungsnachweise ${prev.slice(5)}/${prev.slice(0, 4)}: ${plural(missing.length, 'Objekt', 'Objekte')} noch nicht versendet`,
        text: 'Für diese Objekte ist eine E-Mail-Adresse für den Nachweis hinterlegt.',
        lines: missing.slice(0, 5).map((o) => o.name),
        open: { label: 'Leistungsnachweis', view: 'nachweis' },
      })
  }
  return out
}

function lager() {
  const m = app.data.material
  if (!m || !edits('material')) return []
  const out = []
  const sup = (id) => (m.suppliers || []).find((s) => s.id === id)?.name || 'ohne Lieferant'
  const art = (id) => (m.articles || []).find((a) => a.id === id)?.name || ''
  for (const g of orderSuggestions(m)) {
    out.push({
      id: `best:${g.supplierId}:${g.lines.map((l) => `${l.articleId}${l.qty}`).join(',')}`,
      agent: 'lager',
      prio: g.lines.some((l) => l.total <= 0) ? 1 : 2,
      title: `Bestellung bei ${sup(g.supplierId)} (${plural(g.lines.length, 'Artikel', 'Artikel')}${g.sum ? `, ${g.sum.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}` : ''})`,
      text: 'Unter dem Mindestbestand (offene Bestellungen eingerechnet), aufgerundet auf die Packungsgröße.',
      lines: g.lines.slice(0, 6).map((l) => `${art(l.articleId)}: ${l.qty} (Bestand ${l.total}, Mindestbestand ${l.min})`),
      run: g.supplierId ? { label: 'Bestellung vorbereiten', action: 'mat-order-from', data: { supplier: g.supplierId } } : null,
      open: { label: 'Material & Lager', view: 'material' },
    })
  }
  const req = (m.requests || []).filter(isOpenRequest)
  if (req.length)
    out.push({
      id: `anf:${req.map((r) => r.id).join(',')}`,
      agent: 'lager',
      prio: 2,
      title: `${plural(req.length, 'Anforderung', 'Anforderungen')} aus den Objekten`,
      text: 'Ausgeben oder bestellen.',
      lines: req.slice(0, 5).map((r) => `${objName(r.objectId) || r.objectName || 'Objekt'}: ${(r.lines || []).map((l) => (l.articleId ? `${Number(l.qty) > 0 ? `${l.qty} × ` : ''}${art(l.articleId)}` : l.text || '')).filter(Boolean).join(', ') || r.note || 'ohne Angabe'}`),
      open: { label: 'Anforderungen', view: 'material' },
    })
  return out
}

function fristen(today) {
  const out = []
  const u = app.data.unterweisungen
  if (u && edits('unterweisungen')) {
    const list = dueList({ doc: u, employees: app.data.employees.filter((e) => !e.inactive), today, warnDays: 30 })
    const types = new Map(typesOf(u).map((t) => [t.id, t]))
    const byType = new Map()
    for (const x of list) {
      const id = x.type?.id || x.typeId
      if (!id) continue
      if (!byType.has(id)) byType.set(id, [])
      byType.get(id).push(x)
    }
    for (const [typeId, rows] of byType) {
      const type = types.get(typeId) || rows[0].type || { name: typeId }
      const ids = [...new Set(rows.map((r) => r.emp?.id || r.empId).filter(Boolean))]
      if (!ids.length) continue
      const expired = rows.filter((r) => r.state === 'abgelaufen' || r.state === 'fehlt').length
      // Schulungen und Kurse: gemeinsamer Termin; Kontrollen und Dokumente (Führerschein, Aufenthaltstitel): einzeln prüfen
      const training = ['unterweisung', 'kurs'].includes(type.kind || 'unterweisung')
      out.push({
        id: `unt:${typeId}:${ids.join(',')}`,
        agent: 'fristen',
        prio: expired ? 1 : 2,
        title: `${type.name}: ${plural(ids.length, 'Person', 'Personen')} ${expired ? `(davon ${expired} abgelaufen oder fehlend)` : 'bald fällig'}`,
        text: training ? 'Ich schlage einen gemeinsamen Schulungstermin vor (Teilnehmende vorausgefüllt). In der Unterweisung danach unterschreiben alle am Tablet.' : 'Bitte Nachweis ansehen und neues Ablaufdatum eintragen.',
        lines: ids.slice(0, 8).map(empName),
        run: training && edits('termine') ? { label: 'Schulungstermin anlegen …', fn: 'schulung', data: { title: `Unterweisung: ${type.name}`, ids: ids.join(',') } } : null,
        open: { label: 'Unterweisungen', view: 'unterweisungen' },
      })
    }
  }
  const fz = app.data.fahrzeuge
  if (fz && edits('fahrzeuge'))
    for (const v of fz.vehicles || []) {
      const tasks = openTasks(fz, v, today).filter((d) => ['abgelaufen', 'nachfrist', 'faellig'].includes(d.status))
      if (!tasks.length) continue
      out.push({
        id: `fz:${v.id}:${tasks.map((d) => `${d.kind || d.task}${d.status}`).join(',')}`,
        agent: 'fristen',
        prio: tasks.some((d) => d.status === 'abgelaufen') ? 1 : 2,
        title: `${v.plate}: ${tasks.map((d) => taskLabel(v, d.task || d)).join(', ')}`,
        text: 'Werkstatttermin vereinbaren; mehrere Aufgaben gehen in einem Termin.',
        open: { label: 'Fahrzeuge & Reifen', view: 'fahrzeuge' },
      })
    }
  // Anlagen & Prüffristen: je Objekt fällige Prüfungen und offene Mängel; nur Vorschlag mit „Öffnen“, nichts automatisch
  const an = app.data.anlagen
  if (an && edits('anlagen'))
    for (const g of anlagenAttention(anlagenRows({ doc: an, objects: app.data.objects, today }))) {
      const overdue = g.due.filter((r) => r.state === 'ueberfaellig').length
      const defects = g.defects.flatMap((r) => r.defects.map((c) => ({ r, c })))
      const when = (r) => (r.state === 'ueberfaellig' ? `überfällig seit ${formatDate(r.next)}` : r.next ? `fällig am ${formatDate(r.next)}` : 'noch keine Prüfung')
      const name = (r) => `${r.type?.name || 'Anlage'} (${r.item.label})`
      out.push({
        id: `anl:${g.objectId}:${g.due.map((r) => `${r.item.id}${r.state}${r.next}`).join(',')}:${defects.map((x) => x.c.id).join(',')}`,
        agent: 'fristen',
        prio: anlagenUrgent(g) ? 1 : 2,
        title: `${g.object?.name || objName(g.objectId) || 'Objekt'}: ${[g.due.length ? `${plural(g.due.length, 'Prüfung', 'Prüfungen')} fällig${overdue ? ` (davon ${overdue} überfällig)` : ''}` : '', defects.length ? plural(defects.length, 'Mangel offen', 'Mängel offen') : ''].filter(Boolean).join(', ')}`,
        text: 'Eigene Prüfungen einplanen, bei Fremdfirmen den Termin vereinbaren, offene Mängel beheben lassen. Ich ändere dabei nichts selbst.',
        lines: [...g.due.map((r) => `${name(r)}: ${when(r)}${r.item.by === 'fremd' && r.item.company ? `, ${r.item.company}` : ''}`), ...defects.map(({ r, c }) => `${name(r)}: ${c.defects || 'Mangel'} (seit ${formatDate(c.date)})`)].slice(0, 6),
        open: { label: 'Öffnen', action: 'anl-goto', data: { obj: g.objectId, status: 'bedarf' } },
      })
    }
  const rek = app.data.reklamationen
  if (rek && edits('reklamationen')) {
    const late = (rek.items || []).filter((c) => complaintOverdue(c, today))
    if (late.length)
      out.push({
        id: `rek:${late.map((c) => c.id).join(',')}`,
        agent: 'fristen',
        prio: 1,
        title: `${plural(late.length, 'Reklamation ist', 'Reklamationen sind')} überfällig`,
        text: 'Die Frist für die Maßnahme ist vorbei: Kunde wartet auf Rückmeldung.',
        lines: late.slice(0, 5).map((c) => `${objName(c.objectId)}: ${c.kind || ''}`),
        open: { label: 'Reklamationen', view: 'reklamationen' },
      })
  }
  return out
}

/** Alle offenen Vorschläge (ohne abgelehnte und zurückgestellte), wichtigste zuerst. */
export function proposals(today = todayISO()) {
  return memo(app.cur, `assistenz:${today}:${app.access?.label || ''}:${JSON.stringify(decided())}`, () => {
    const all = []
    const safe = (fn) => {
      try {
        all.push(...fn(today))
      } catch (err) {
        console.warn('Digitale Mitarbeiter:', err)
      }
    }
    safe(disponent)
    safe(buchhaltung)
    safe(lager)
    safe(fristen)
    const dec = decided()
    return all.filter((p) => {
      const d = dec[p.id]
      if (!d) return true
      if (d.status === 'abgelehnt') return false
      if (d.status === 'spaeter') return d.until <= today
      return false
    }).sort((a, b) => a.prio - b.prio)
  })
}

// ---------------------------------------------------------------- Ansicht

const AGENT_ICON = {
  disponent: '<path d="M4 6h9M8 12h12M6 18h8"/><circle cx="18" cy="6" r="2.5"/>',
  buchhaltung: '<path d="M6 2.5h9l4 4V21l-2.2-1.4L14.6 21l-2.3-1.4L10 21l-2.2-1.4L5.6 21V3.5a1 1 0 0 1 .4-1z"/><path d="M9 8h4M9 11.5h6M9 15h6"/>',
  lager: '<path d="M3 8.5 12 4l9 4.5v10L12 23l-9-4.5z"/><path d="M3 8.5 12 13l9-4.5M12 13v10"/>',
  fristen: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4.2l2.8 1.8M9.5 2.5h5"/>',
}
const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

function card(p) {
  const prio = p.prio === 1 ? '<span class="pill error">dringend</span>' : p.prio === 2 ? '<span class="pill warning">bald</span>' : ''
  return `<article class="dm-card" data-prio="${p.prio}">
    <header><h4>${esc(p.title)}</h4>${prio}</header>
    <p>${esc(p.text)}</p>
    ${p.lines?.length ? `<ul class="dm-lines">${p.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    <div class="dm-actions">
      ${p.run ? `<button class="btn primary small" data-action="dm-run" data-id="${esc(p.id)}">${ICON.check} ${esc(p.run.label)}</button>` : ''}
      ${p.open ? `<button class="btn small" data-action="dm-open" data-id="${esc(p.id)}">${esc(p.open.label)}</button>` : ''}
      <button class="btn small ghost" data-action="dm-later" data-id="${esc(p.id)}" title="Bis morgen ausblenden">Später</button>
      <button class="btn small ghost" data-action="dm-reject" data-id="${esc(p.id)}" title="Diesen Vorschlag nicht mehr zeigen (kommt wieder, wenn sich die Lage ändert)">Ablehnen</button>
      ${app.config?.assistant !== false ? `<button class="btn small ghost" data-action="dm-ai" data-id="${esc(p.id)}" title="Mit dem KI-Assistenten besprechen">KI fragen</button>` : ''}
    </div>
  </article>`
}

function visibleAgents() {
  return AGENTS.filter((a) => (a.module === '*' ? true : edits(a.module)))
}

function assistenzView() {
  const list = proposals()
  const agents = visibleAgents()
  const urgent = list.filter((p) => p.prio === 1).length
  const done = Object.values(decided()).filter((d) => d.status === 'erledigt' && d.at?.slice(0, 10) === todayISO()).length
  const cols = agents
    .map((a) => {
      const mine = list.filter((p) => p.agent === a.id)
      return `<section class="dm-agent">
        <header>${svg(AGENT_ICON[a.id])}<div><h3>${esc(a.name)}</h3><small>${esc(a.role)}</small></div><span class="flag ${mine.length ? 'error' : 'ok'}">${mine.length || '✓'}</span></header>
        ${mine.length ? mine.map(card).join('') : '<p class="muted dm-empty">Nichts zu tun.</p>'}
      </section>`
    })
    .join('')
  return `<div class="section-head"><div><h2>Digitale Mitarbeiter</h2>
      <p>Vier Routinen gehen laufend die Daten durch und bereiten fertige Arbeitsschritte vor. Du entscheidest: „Ausführen“ erledigt es mit einem Klick (in der Planung mit Rückgängig), „Später“ blendet bis morgen aus, „Ablehnen“ bis sich die Lage ändert.</p></div>
      <div class="actions"><span class="muted">${list.length ? `${plural(list.length, 'Vorschlag', 'Vorschläge')}${urgent ? `, ${urgent} dringend` : ''}` : 'alles erledigt'}${done ? ` · heute ${done} ausgeführt` : ''}</span></div></div>
    <div class="dm-grid">${cols}</div>`
}

registerView({
  id: 'assistenz',
  order: 1,
  label: 'Digitale Mitarbeiter',
  group: 'start',
  module: '*',
  section: 'start',
  noWeek: true,
  icon: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/><path d="M18.5 3.5l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>',
  text: 'Vorbereitete Arbeit zur Freigabe',
  available: () => visibleAgents().some((a) => a.module !== '*') || edits('unterweisungen') || edits('fahrzeuge') || edits('reklamationen') || edits('anlagen'),
  badge: () => proposals().filter((p) => p.prio === 1).length,
  render: assistenzView,
})

// ---------------------------------------------------------------- Ausführen

const byId = (id) => proposals().find((p) => p.id === id)

function remember(id, status, extra = {}) {
  decided()[id] = { status, by: by(), at: new Date().toISOString(), ...extra }
  // alte Entscheidungen (über 60 Tage) entfernen, damit die Datei klein bleibt
  const limit = addDays(todayISO(), -60)
  for (const [k, v] of Object.entries(decided())) if ((v.at || '').slice(0, 10) < limit) delete decided()[k]
  persist()
}

function dispatch(action, data = {}) {
  const el = document.createElement('button')
  for (const [k, v] of Object.entries(data)) el.dataset[k] = v
  return ACTIONS[action]?.(el)
}

async function goTo(open) {
  if (open.monday) app.ui.monday = open.monday
  if (open.fakTab) app.ui.fakTab = open.fakTab
  app.ui.view = open.view
  await render()
}

const RUN = {
  planen: async ({ monday }) => {
    app.ui.monday = monday
    await render()
    planWeek(false)
  },
  publish: async ({ monday }) => {
    app.ui.monday = monday
    await render()
    openModal({ type: 'publish' })
  },
  schulung: ({ title, ids }) => {
    const list = ids.split(',').filter(Boolean)
    // nächster Werktag, 07:00
    let date = addDays(todayISO(), 1)
    while ([0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay())) date = addDays(date, 1)
    openModal({ type: 'appt', date, time: '07:00', minutes: 60, kind: 'schulung', title, employeeIds: list })
  },
}

registerActions({
  'dm-run': async (el) => {
    const p = byId(el.dataset.id)
    if (!p?.run) return
    if (p.run.fn) await RUN[p.run.fn](p.run.data || {})
    else await dispatch(p.run.action, p.run.data)
    // Dialoge (Veröffentlichen, Termin, Bestellung) entscheiden selbst; sonst gilt es als erledigt
    if (!app.ui.modal) remember(p.id, 'erledigt')
    renderNow()
  },
  'dm-open': async (el) => {
    const p = byId(el.dataset.id)
    if (!p?.open) return
    if (p.open.action) return dispatch(p.open.action, p.open.data)
    await goTo(p.open)
  },
  'dm-later': (el) => {
    remember(el.dataset.id, 'spaeter', { until: addDays(todayISO(), 1) })
    renderNow()
    toast('Bis morgen ausgeblendet.')
  },
  'dm-reject': (el) => {
    remember(el.dataset.id, 'abgelehnt')
    renderNow()
    toast('Abgelehnt. Kommt wieder, wenn sich die Lage ändert.')
  },
  'dm-ai': (el) => {
    const p = byId(el.dataset.id)
    if (!p) return
    openModal({ type: 'assistant', prefill: `Der digitale Mitarbeiter „${AGENTS.find((a) => a.id === p.agent)?.name}“ schlägt vor: ${p.title}. ${p.text}${p.lines?.length ? ` (${p.lines.join('; ')})` : ''} Was meinst du, und was soll ich tun?` })
  },
})

/** Für die Übersicht: Anzahl je digitalem Mitarbeiter. */
export function proposalSummary() {
  const list = proposals()
  return visibleAgents().map((a) => ({ ...a, count: list.filter((p) => p.agent === a.id).length, urgent: list.filter((p) => p.agent === a.id && p.prio === 1).length }))
}

// Wochen der nächsten 14 Tage für die Routinen laden (still, im Hintergrund)
export const prepare = () => ensureRange(mondayOf(todayISO()), addDays(mondayOf(todayISO()), 13)).catch(() => {})
