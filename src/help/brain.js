// Cleos Datenwissen: versteht Fragen zum echten Betrieb und antwortet aus den Daten der App –
// ohne KI und ohne Netz, nur mit dem, was die eigene Rolle sehen darf.
//   „Wer arbeitet morgen?“ · „Wo ist Anna am Freitag?“ · „Wer putzt nächste Woche im Bürohaus?“
//   „Wer ist diese Woche krank?“ · „Was ist noch offen?“ · „Was steht heute an?“
//   „Ist der 8.12. ein Feiertag?“ · „Nummer von Ben“ · „Wer hat den Schlüssel vom Bürohaus?“
//   „Offene Reklamationen“ · „Wie viel Handtuchpapier haben wir?“ · „Stunden von Anna diese Woche“
//   „Anna ist morgen krank“ → Formular schon ausgefüllt (eintragen tut die Person selbst)
//   Rückfragen: „und morgen?“, „und Ben?“ greifen die letzte Frage auf.
// understand() ist rein (Text → Absicht), answer() baut die Antwort aus den übergebenen Daten
// (getestet in test/brain.test.js); help.js holt die Daten und zeigt die Antwort.

import { addDays, formatDate, formatHours, isoWeekday, lastOfMonth, mondayOf } from '../core/dates.js'
import { isActive, keysOf, objectKeys } from '../core/keys.js'
import { stockRows } from '../core/material.js'
import { normalize } from './match.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const pad = (n) => String(n).padStart(2, '0')
const WEEKDAYS = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag']
const WD_LABEL = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
const MONTHS = ['jaenner', 'februar', 'maerz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember']
const MONTH_LABEL = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const MAX_DAYS = 31

// Wörter, die nie ein Name sind (sonst wäre „Morgen“ eine Person namens Morgen …)
const NOT_NAME = new Set(
  'wer wo wann was wie welche welcher welches ist sind hat haben heute morgen uebermorgen gestern woche wochenende monat naechste naechsten diese dieser diesen letzte letzten kommende arbeitet arbeiten dienst einsatz einsaetze plan krank urlaub abwesend frei offen offene schicht und oder bei im in am um von bis der die das den dem des ein eine einer noch auch mal bitte cleo zeig zeige sag liste alle heuer jetzt gerade feiertag schluessel nummer telefon stunden reklamation reklamationen material lager objekt objekte kunde haus buero mit fuer'.split(' '),
)
// Allgemeine Wörter in Objektnamen: allein kein Treffer („Haus“, „Büro“, „Praxis“ …)
const GENERIC = new Set('buero bueros haus praxis objekt gmbh co kg og eu ag strasse gasse weg platz salzburg wohnanlage anlage stiege center zentrum firma halle markt filiale schule kindergarten'.split(' '))

// nur ganze Wörter: „Urlaubskalender“ ist keine Frage nach Urlaub
const ABSENCE_WORDS = [
  ['krankenstand', 'Krankenstand'], ['krank', 'Krankenstand'], ['kranke', 'Krankenstand'], ['krankgemeldet', 'Krankenstand'], ['krankgeschrieben', 'Krankenstand'],
  ['urlaub', 'Urlaub'], ['zeitausgleich', 'Zeitausgleich'], ['za', 'Zeitausgleich'], ['pflegefreistellung', 'Pflegefreistellung'], ['pflegeurlaub', 'Pflegefreistellung'],
]

// ---------------------------------------------------------------- Datum

/** Datumsangaben im Text → { from, to, label } oder null. today: „JJJJ-MM-TT“. */
export function parseWhen(raw, today) {
  // 12.11. / 12.11.2026 → Platzhalter „dJJJJMMTT“, damit die Reihenfolge erhalten bleibt
  const text = String(raw || '').replace(/(\d{1,2})\.\s?(\d{1,2})\.(\d{4}|\d{2})?/g, (m, d, mo, y) => {
    let year = y ? (y.length === 2 ? `20${y}` : y) : today.slice(0, 4)
    let iso = `${year}-${pad(mo)}-${pad(d)}`
    if (!y && iso < addDays(today, -60)) iso = `${Number(year) + 1}-${pad(mo)}-${pad(d)}` // „3.1.“ im Dezember: nächstes Jahr
    year = iso.slice(0, 4)
    return Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31 && iso <= lastOfMonth(iso) ? ` d${iso.replace(/-/g, '')} ` : m
  })
  const t = normalize(text).split(' ')
  const items = []
  const wd = isoWeekday(today)
  const week = (monday, label) => ({ from: monday, to: addDays(monday, 6), label })
  for (let i = 0; i < t.length; i++) {
    const w = t[i]
    const prev = t[i - 1] || ''
    const bis = prev === 'bis' || (t[i - 2] === 'bis' && /^(zum|zur|am|naechsten|kommenden)$/.test(prev))
    const add = (x) => items.push({ ...x, bis })
    if (w === 'heute') add({ from: today, to: today, label: 'heute' })
    else if (w === 'morgen' && prev !== 'guten') add({ from: addDays(today, 1), to: addDays(today, 1), label: 'morgen' })
    else if (w === 'uebermorgen') add({ from: addDays(today, 2), to: addDays(today, 2), label: 'übermorgen' })
    else if (w === 'gestern') add({ from: addDays(today, -1), to: addDays(today, -1), label: 'gestern' })
    else if (w === 'vorgestern') add({ from: addDays(today, -2), to: addDays(today, -2), label: 'vorgestern' })
    else if (/^d\d{8}$/.test(w)) {
      const d = `${w.slice(1, 5)}-${w.slice(5, 7)}-${w.slice(7, 9)}`
      add({ from: d, to: d, label: `am ${formatDate(d)}` })
    } else if (WEEKDAYS.includes(w.replace(/s$/, ''))) {
      const target = WEEKDAYS.indexOf(w.replace(/s$/, '')) + 1
      const back = /^(letzten|letzter|vorigen|voriger|vergangenen)$/.test(prev)
      const next = /^(naechsten|naechster|kommenden)$/.test(prev)
      let diff = (target - wd + 7) % 7
      if (back) diff = diff === 0 ? -7 : diff - 7
      else if (next && diff === 0) diff = 7
      const d = addDays(today, diff)
      add({ from: d, to: d, label: diff === 0 ? 'heute' : diff === 1 ? 'morgen' : `am ${WD_LABEL[target - 1]}, ${formatDate(d, { weekday: false })}` })
    } else if (w === 'woche' || w === 'kw') {
      if (/^(naechste|naechsten|kommende|kommenden)$/.test(prev)) add(week(addDays(mondayOf(today), 7), 'nächste Woche'))
      else if (/^(letzte|letzten|vorige|vorigen|vergangene|vergangenen)$/.test(prev)) add(week(addDays(mondayOf(today), -7), 'letzte Woche'))
      else if (/^(diese|dieser|diesen|die|aktuelle|aktuellen|der|ganze|ganzen)$/.test(prev)) add(week(mondayOf(today), 'diese Woche'))
    } else if (w === 'wochenende') {
      const sat = addDays(mondayOf(today), 5)
      const next = /^(naechste|naechsten|kommende|kommenden)$/.test(prev)
      add({ from: next ? addDays(sat, 7) : sat < today ? today : sat, to: addDays(sat, next ? 8 : 1), label: next ? 'nächstes Wochenende' : 'am Wochenende' })
    } else if (w === 'monat') {
      const first = `${today.slice(0, 7)}-01`
      if (/^(naechsten|naechster|kommenden)$/.test(prev)) {
        const n = addDays(lastOfMonth(first), 1)
        add({ from: n, to: lastOfMonth(n), label: 'nächsten Monat' })
      } else if (/^(diesen|diesem|dieser|im|den)$/.test(prev)) add({ from: first, to: lastOfMonth(first), label: 'diesen Monat' })
    } else if (MONTHS.includes(w) && /^(im|ab|fuer|bis)$/.test(prev)) {
      let first = `${today.slice(0, 4)}-${pad(MONTHS.indexOf(w) + 1)}-01`
      if (lastOfMonth(first) < today) first = `${Number(today.slice(0, 4)) + 1}${first.slice(4)}`
      add({ from: first, to: lastOfMonth(first), label: `im ${MONTH_LABEL[MONTHS.indexOf(w)]}` })
    }
  }
  if (!items.length) return null
  const [a, b] = items
  if (b?.bis) return { from: a.from, to: b.to < a.from ? a.from : b.to, label: `${a.label} bis ${b.label.replace(/^am /, '')}` }
  if (a.bis) return { from: today, to: a.to < today ? today : a.to, label: `bis ${a.label.replace(/^am /, '')}` }
  return { from: a.from, to: a.to, label: a.label }
}
// ---------------------------------------------------------------- Personen und Objekte

const words = (text) => ` ${normalize(text)} `

/** Personen im Text: [{ emp, score }] (3 ganzer Name, 2 Nachname, 1 Vorname), bester zuerst. */
export function findPeople(text, employees) {
  const n = words(text)
  const tokens = new Set(n.trim().split(' ').flatMap((w) => (w.length > 3 && w.endsWith('s') ? [w, w.slice(0, -1)] : [w])))
  const out = []
  for (const emp of employees) {
    const full = normalize(emp.name)
    if (!full) continue
    const parts = full.split(' ').filter((p) => p.length >= 3 && !NOT_NAME.has(p))
    let score = n.includes(` ${full} `) && parts.length > 1 ? 3 : 0
    if (!score) {
      const hit = parts.filter((p) => tokens.has(p))
      // „Huber, Anna“ und „Anna Huber“: der seltenere Teil zählt mehr – hier grob: zwei Teile = ganzer Name
      if (hit.length >= 2) score = 3
      else if (hit.length === 1) score = hit[0] === parts.at(-1) && parts.length > 1 ? 2 : 1
    }
    if (score) out.push({ emp, score })
  }
  // „Huber, Anna“: Vorname steht hinten – dann zählt der erste Teil als Nachname; nur Reihenfolge der Treffer
  return out.sort((a, b) => b.score - a.score)
}

/** Objekte im Text: [{ obj, score }], bester zuerst. */
export function findObjects(text, objects) {
  const n = words(text)
  const tokens = new Set(n.trim().split(' '))
  const out = []
  for (const obj of objects) {
    const full = normalize(obj.name)
    const short = normalize(obj.short || '')
    let score = (full && n.includes(` ${full} `) ? 4 : 0) || (short && short.length >= 2 && n.includes(` ${short} `) ? 4 : 0)
    if (!score) {
      const parts = full.split(' ').filter((p) => p.length >= 3 && !GENERIC.has(p) && !NOT_NAME.has(p) && !/^\d+$/.test(p))
      score = parts.filter((p) => tokens.has(p)).length * 1.5
    }
    if (score) out.push({ obj, score })
  }
  return out.sort((a, b) => b.score - a.score)
}

const best = (list) => (list.length ? list.filter((x) => x.score === list[0].score) : [])

// ---------------------------------------------------------------- Verstehen

const HOW_TO = /\b(wie|wo|wann|was) (kann|koennen|muss|muessen|soll|sollen|darf|duerfen) (ich|man|wir|du)\b|\b(wie|wo|wann) (trage|trag|mache|finde|lege|schreibe|erstelle|sehe|stelle|gebe|bekomme|schicke|sende|aendere|loesche|drucke|plane|richte|buche|melde)\b|\bwie (geht|funktioniert|klappt)\b|\bwas (ist|sind|bedeutet|heisst) (ein|eine|der|die|das)\b|\berklaer|\banleitung\b|\bwo (ist|sind|finde) (der|die|das) (knopf|button|menue|einstellung|ansicht)\b/
const QUESTION = /^(wer|wo|wann|was|welche|welcher|welches|wie|ist|sind|hat|haben|gibt|gibts|zeig|zeige|sag|liste|arbeitet|kommt|hab|habe|brauch|brauche|muss|wieviel|wieviele)\b/

/** Typ der Abwesenheit aus dem Text („krank“ → Krankenstand) oder ''. */
const absenceType = (n) => ABSENCE_WORDS.find(([w]) => n.includes(` ${w} `))?.[1] || ''

/**
 * Was will die Frage? → { kind, when, people, objects, type, text } oder null (dann Hilfe-Themen).
 * kinds: summary works person object open absent holiday contact keys complaints material hours absence-cmd
 * last: die vorige Absicht (für „und morgen?“).
 */
export function understand(text, { today, employees = [], objects = [], last = null } = {}) {
  const raw = String(text || '').trim()
  const n = words(raw)
  if (!raw || HOW_TO.test(n.trim())) return null
  const when = parseWhen(raw, today)
  const people = best(findPeople(raw, employees))
  const objs = best(findObjects(raw, objects))
  const person = people.length === 1 ? people[0].emp : null
  const object = objs.length === 1 ? objs[0].obj : null
  const ask = QUESTION.test(n.trim()) || raw.endsWith('?')
  const type = absenceType(n)
  const base = { when, people: people.map((p) => p.emp), objects: objs.map((o) => o.obj), person, object, type, text: raw }
  const is = (re) => re.test(n)

  // Rückfrage zuerst, wenn sie mit „und“ beginnt: „und Ben?“ bleibt bei der vorigen Frage
  if (last && /^ und\b/.test(n)) {
    const f = followUp(last, base, when, person, object, people, n)
    if (f) return f
  }

  // Befehl: „Anna ist morgen krank“, „Trag Ben bis Freitag Urlaub ein“
  if ((person || people.length > 1) && type && (!ask || /\b(trag|trage|eintragen|melde|meld)\b/.test(n)) && !/^ (wer|wann|ist|hat|wie|welche)\b/.test(n)) return { ...base, kind: 'absence-cmd' }

  if (is(/feiertag/) && (when || is(/\b(naechste|naechster|wann|welche|kommende)\b/))) return { ...base, kind: 'holiday' }
  // Wunschzeiten (core/wuensche.js): „Wer hat diese Woche Wunschfrei?“, „Welche Wünsche hat Anna?“
  if (is(/\b(wunschfrei|wunsch|wuensche|wunschzeiten|wunschzeit)\b/) && (ask || when || person)) return { ...base, kind: 'wishes' }
  if (is(/\b(telefon|telefonnummer|nummer|handynummer|tel|mail|email|e mail|mailadresse|erreiche|erreichen|anrufen)\b/) && (person || people.length > 1)) return { ...base, kind: 'contact' }
  if (is(/schluessel|transponder|chip|zutrittskarte/) && (ask || person || object)) return { ...base, kind: 'keys' }
  if (is(/\b(reklamation|reklamationen|beschwerde|beschwerden|maengel)\b/) && (ask || is(/\boffen/))) return { ...base, kind: 'complaints' }
  if (is(/\b(bestand|vorrat|haben wir|lagernd|nachbestellen|nachbestellt|ausgegangen)\b|\bwie ?viel\b.*\b(haben|da|lager|noch)\b/) && !is(/\bstunden\b/)) return { ...base, kind: 'material' }
  if (is(/\bstunden\b/) && (person || people.length > 1)) return { ...base, kind: 'hours' }
  if (is(/\b(steht|stehts) (heute |morgen )?an\b|\bwas (gibt es|gibts) (neues|heute)\b|\bwas ist (heute |morgen )?los\b|\b(lagebericht|ueberblick|tagesueberblick|zusammenfassung)\b|\bwas (ist|muss ich|soll ich) (heute )?(zu tun|tun|machen|erledigen)\b|\bwie (schaut|sieht) es (heute )?aus\b/)) return { ...base, kind: 'summary' }
  if (is(/\b(offen|offene|offenen|unbesetzt|unbesetzte|unbesetzten|luecke|luecken|einspringen|fehlt noch|nicht besetzt)\b/) && !is(/\b(rechnung|rechnungen|posten|reklamation)\b/)) return { ...base, kind: 'open' }
  if (type || is(/\b(abwesend|abwesenheit|abwesenheiten|fehlt|fehlen|frei hat|frei haben|nicht da|wieder da|zurueck|ausfall)\b/)) {
    if (ask || when || person) return { ...base, kind: 'absent' }
  }
  // Objekt vor Person – außer der Name passt besser zu einer Person („Wo ist Huber?“ bei „Praxis Dr. Huber“)
  if ((object || objs.length > 1) && (ask || when) && (!person || objs[0].score >= 3)) return { ...base, kind: 'object' }
  if ((person || people.length > 1) && (ask || when || is(/\b(plan|dienst|einsatz|einsaetze|arbeitet|schicht)\b/))) return { ...base, kind: 'person' }
  if (is(/\b(arbeitet|arbeiten|eingeteilt|dienst|im einsatz|unterwegs|putzt|putzen|reinigt|reinigen|schicht|einsaetze|einsatz)\b/) && (ask || when)) return { ...base, kind: object ? 'object' : 'works' }

  // Rückfrage: „und morgen?“, „und Ben?“, „am Freitag?“
  const short = n.trim().split(' ').length <= 5
  if (last && short) return followUp(last, base, when, person, object, people, n)
  return null
}

function followUp(last, base, when, person, object, people, n) {
  if (!(when || person || object || people.length > 1)) return last.kind === 'material' && /^ und\b/.test(n) ? { ...base, kind: 'material' } : null
  let kind = last.kind
  if (kind === 'works' && person) kind = 'person'
  else if (kind === 'works' && object) kind = 'object'
  else if (kind === 'person' && object && !person) kind = 'object'
  else if (kind === 'object' && person && !object) kind = 'person'
  if (kind === 'absence-cmd') return null
  return { ...last, ...base, kind, when: when || last.when, person: person || (object ? null : last.person), object: object || (person ? null : last.object), people: person || people.length ? base.people : last.people, type: last.type, followUp: true }
}

// ---------------------------------------------------------------- Antworten

/** Wer ist auf einem Einsatz? Eingeteilte (anwesend); in noch nicht geplanten Wochen die Stammkräfte. */
function crew(inst, d) {
  const assigned = d.state.assigned(inst.key).map((a) => a.employeeId).filter((id) => d.ctx.employeesById.has(id))
  const working = assigned.filter((id) => !d.absenceOf(id, inst.date))
  const planned = d.isPlanned(mondayOf(inst.date))
  const regulars = !planned && !assigned.length ? inst.regulars.filter((id) => d.ctx.employeesById.has(id) && !d.absenceOf(id, inst.date)) : []
  const people = working.length ? working : regulars
  return { people, pending: !working.length && regulars.length > 0, open: Math.max(0, (inst.staff || 1) - people.length), absent: assigned.filter((id) => !working.includes(id)) }
}

const dayOf = (inst) => (inst.status === 'cancelled' ? inst.origDate : inst.date)
const name = (d, id) => d.ctx.employeesById.get(id)?.name || '?'
const objName = (d, id) => d.ctx.objectsById?.get(id)?.name || d.objects?.find((o) => o.id === id)?.name || ''
const timeOf = (inst) => `${inst.startTime}–${inst.endTime}`
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

const btn = (label, action, data = {}, primary = false) =>
  `<button class="btn small${primary ? ' primary' : ''}" data-action="help-run" data-run="${esc(action)}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${esc(label)}</button>`
const row = (html, action = '', data = {}) =>
  action ? `<li><button class="cleo-row" data-action="help-run" data-run="${esc(action)}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${html}</button></li>` : `<li>${html}</li>`
function box(title, items, { more = 0, acts = [], note = '' } = {}) {
  return `<div class="cleo-answer cleo-data"><strong class="cleo-title">${title}</strong>${items.length ? `<ul class="cleo-list">${items.join('')}</ul>` : ''}${more ? `<p class="muted">… und ${more} weitere</p>` : ''}${note ? `<p class="cleo-tip">${note}</p>` : ''}${acts.length ? `<div class="cleo-acts">${acts.join('')}</div>` : ''}</div>`
}
const LIMIT = 10
const MATERIAL_FILLER = new Set('viel viele wieviel wieviele haben hast habt noch lager bestand vorrat nachbestellen nachbestellt bestellen bestellt lagernd ausgegangen welche welcher welches muss muessen werden wird sind gibt gibts zeig zeige material artikel davon etwas genug leer knapp aus'.split(' '))
const DENIED = { mood: 'hoppla', html: '<p>Das sieht deine Rolle nicht – da lässt mich die App nicht rein. Frag bitte das Büro.</p>' }

/** Einsätze im Zeitraum (ohne entfallene), sortiert. */
const shiftsIn = (d, from, to, pred = () => true) => d.instances.filter((i) => i.status !== 'cancelled' && i.date >= from && i.date <= to && pred(i)).sort((a, b) => a.start - b.start)

function clampRange(w) {
  if (addDays(w.from, MAX_DAYS - 1) < w.to) return { ...w, to: addDays(w.from, MAX_DAYS - 1), label: `${w.label} (die ersten ${MAX_DAYS} Tage)` }
  return w
}

/** Welche Tage braucht die Antwort? (help.js lädt sie vorher) */
export function rangeFor(u, today) {
  const week = { from: today, to: addDays(today, 6), label: 'in den nächsten 7 Tagen' }
  const day = { from: today, to: today, label: 'heute' }
  if (!u) return null
  if (['works', 'absent', 'summary'].includes(u.kind)) return clampRange(u.when || day)
  if (u.kind === 'person') return clampRange(u.when || { from: today, to: addDays(today, 13), label: 'heute', soonest: true })
  if (['object', 'open'].includes(u.kind)) return clampRange(u.when || week)
  if (u.kind === 'hours') return clampRange(u.when || { from: mondayOf(today), to: addDays(mondayOf(today), 6), label: 'diese Woche' })
  if (u.kind === 'wishes') return clampRange(u.when || { from: today, to: addDays(today, 13), label: 'in den nächsten 14 Tagen' })
  return u.when ? clampRange(u.when) : null
}

/**
 * Antwort auf eine verstandene Frage. d: { today, can, instances, state, ctx, absences, absenceOf(id, date),
 * isPlanned(monday), holidays(from, to), employees, objects, keys, complaints, material, todoCount, appointments }
 * → { mood, html }
 */
export function answer(u, d) {
  const can = d.can || {}
  const w = rangeFor(u, d.today)
  if (u.objects?.length > 1 && !u.object && !u.person && ['object', 'keys', 'complaints', 'open'].includes(u.kind)) {
    return { mood: 'denkt', html: `<p>Welches Objekt meinst du?</p><div class="cleo-chips">${u.objects.slice(0, 6).map((o) => `<button class="chip" data-action="help-ask" data-q="${esc(`${u.text} (${o.name})`)}">${esc(o.name)}</button>`).join('')}</div>` }
  }
  if (u.people?.length > 1 && !u.person && ['person', 'contact', 'hours', 'absence-cmd', 'absent', 'keys'].includes(u.kind)) {
    return { mood: 'denkt', html: `<p>Da gibt es mehrere – wen meinst du?</p><div class="cleo-chips">${u.people.slice(0, 6).map((e) => `<button class="chip" data-action="help-ask" data-q="${esc(`${u.text} (${e.name})`)}">${esc(e.name)}</button>`).join('')}</div>` }
  }
  switch (u.kind) {
    case 'works': {
      if (!can.plan) return DENIED
      const list = shiftsIn(d, w.from, w.to)
      const byEmp = new Map()
      let open = 0
      for (const i of list) {
        const c = crew(i, d)
        open += c.open
        for (const id of c.people) {
          if (!byEmp.has(id)) byEmp.set(id, [])
          byEmp.get(id).push({ i, pending: c.pending })
        }
      }
      if (!list.length) return { mood: 'schlaeft', html: `<p>${esc(cap(w.label))} steht laut Plan kein Einsatz an.</p>` }
      const rows = [...byEmp.entries()].sort((a, b) => a[1][0].i.start - b[1][0].i.start).map(([id, xs]) => {
        const first = xs[0].i
        const where = [...new Set(xs.map((x) => objName(d, x.i.objectId)))]
        const days = w.from === w.to ? '' : `${formatDate(first.date)} `
        return row(`<b>${esc(name(d, id))}</b> <span class="muted">${esc(days)}${esc(timeOf(first))} · ${esc(where.slice(0, 2).join(', '))}${where.length > 2 ? ` +${where.length - 2}` : ''}${xs.length > 1 ? ` · ${xs.length} Einsätze` : ''}${xs.some((x) => x.pending) ? ' · Stammkraft, Woche noch nicht geplant' : ''}</span>`, can.planEdit ? 'open-person' : '', { emp: id })
      })
      return {
        mood: 'liste',
        html: box(`${esc(cap(w.label))}: ${plural(byEmp.size, 'Person', 'Personen')} im Einsatz`, rows.slice(0, LIMIT), {
          more: Math.max(0, rows.length - LIMIT),
          note: open ? `${plural(open, 'Platz ist', 'Plätze sind')} noch offen.` : '',
          acts: [open && can.coverage ? btn('Offene besetzen', 'view', { view: 'coverage' }, true) : '', btn(w.from === w.to ? 'In der Zeitlinie' : 'Im Wochenplan', w.from === w.to ? 'goto-day' : 'view', w.from === w.to ? { date: w.from, view: 'timeline' } : { view: 'week' })].filter(Boolean),
        }),
      }
    }
    case 'person': {
      if (!can.plan) return DENIED
      const emp = u.person
      let list = shiftsIn(d, w.from, w.to, (i) => crew(i, d).people.includes(emp.id))
      let label = w.label
      // „Wo ist Anna?“ ohne Datum: heute, sonst der nächste Einsatz
      if (w.soonest) {
        const todays = list.filter((i) => i.date === d.today)
        if (todays.length) list = todays
        else if (list.length) {
          list = list.filter((i) => i.date === list[0].date)
          label = list[0].date === addDays(d.today, 1) ? 'morgen' : `am ${formatDate(list[0].date)}`
        }
      }
      const away = (d.absences || []).filter((a) => a.employeeId === emp.id && a.from <= w.to && a.to >= w.from)
      const awayText = away.map((a) => `${can.reasons ? a.type : 'abwesend'} ${a.from === a.to ? formatDate(a.from) : `${formatDate(a.from)}–${formatDate(a.to)}`}`).join(', ')
      if (!list.length) return { mood: away.length ? 'schlaeft' : 'denkt', html: box(`${esc(emp.name)}: ${w.soonest ? 'in den nächsten 14 Tagen' : esc(label)} kein Einsatz`, [], { note: away.length ? esc(`${emp.name.split(' ')[0]} ist ${awayText}.`) : '', acts: can.planEdit ? [btn('Dienstplan öffnen', 'open-person', { emp: emp.id })] : [] }) }
      const rows = list.map((i) => row(`<b>${esc(formatDate(i.date))} ${esc(timeOf(i))}</b> <span class="muted">${esc(objName(d, i.objectId))}${i.label ? ` · ${esc(i.label)}` : ''}${crew(i, d).pending ? ' · Stammkraft, Woche noch nicht geplant' : ''}</span>`, can.planEdit ? 'open-shift' : '', { key: i.key }))
      const minutes = list.reduce((m, i) => m + (i.end - i.start), 0)
      return {
        mood: 'zeigt',
        html: box(`${esc(emp.name)} ${esc(label)}: ${plural(list.length, 'Einsatz', 'Einsätze')}, ${formatHours(minutes)} h`, rows.slice(0, LIMIT), { more: Math.max(0, rows.length - LIMIT), note: away.length ? esc(`Achtung: ${awayText}.`) : '', acts: can.planEdit ? [btn('Dienstplan öffnen', 'open-person', { emp: emp.id })] : [] }),
      }
    }
    case 'object': {
      if (!can.plan) return DENIED
      const obj = u.object
      const list = shiftsIn(d, w.from, w.to, (i) => i.objectId === obj.id)
      if (!list.length) return { mood: 'denkt', html: `<p>Im <b>${esc(obj.name)}</b> steht ${esc(w.label)} laut Plan kein Einsatz an.</p>` }
      const rows = list.map((i) => {
        const c = crew(i, d)
        return row(`<b>${esc(formatDate(i.date))} ${esc(timeOf(i))}</b> <span class="muted">${esc(c.people.map((id) => name(d, id)).join(', ') || '—')}${c.open ? ` · <span class="flag error">${c.open} offen</span>` : ''}${c.pending ? ' · Stammkraft' : ''}${i.label ? ` · ${esc(i.label)}` : ''}</span>`, can.planEdit ? 'open-shift' : '', { key: i.key })
      })
      return { mood: 'wischt', html: box(`${esc(obj.name)} ${esc(w.label)}: ${plural(list.length, 'Einsatz', 'Einsätze')}`, rows.slice(0, LIMIT), { more: Math.max(0, rows.length - LIMIT) }) }
    }
    case 'open': {
      if (!can.plan) return DENIED
      const list = shiftsIn(d, w.from, w.to, (i) => !u.object || i.objectId === u.object.id)
        .map((i) => ({ i, c: crew(i, d) }))
        .filter((x) => x.c.open > 0)
      if (!list.length) return { mood: 'daumen', html: `<p>${esc(cap(w.label))} ist alles besetzt${u.object ? ` im ${esc(u.object.name)}` : ''}. Sauber!</p>` }
      const total = list.reduce((n, x) => n + x.c.open, 0)
      const rows = list.map(({ i, c }) => row(`<b>${esc(formatDate(i.date))} ${esc(timeOf(i))}</b> <span class="muted">${esc(objName(d, i.objectId))} · <span class="flag error">${c.open} offen</span>${c.absent.length ? ` · ${esc(c.absent.map((id) => name(d, id)).join(', '))} abwesend` : ''}</span>`, can.planEdit ? 'open-shift' : '', { key: i.key }))
      return { mood: 'zeigt', html: box(`${esc(cap(w.label))}: ${plural(total, 'Platz', 'Plätze')} offen`, rows.slice(0, LIMIT), { more: Math.max(0, rows.length - LIMIT), note: can.planEdit ? 'Tipp auf einen Einsatz: Ich zeige dir, wer einspringen kann.' : '', acts: can.coverage ? [btn('Vertretungen planen', 'view', { view: 'coverage' }, true)] : [] }) }
    }
    case 'absent': {
      if (!can.absences) return DENIED
      const list = (d.absences || []).filter((a) => a.from <= w.to && a.to >= w.from && (!u.person || a.employeeId === u.person.id) && (!u.type || !can.reasons || a.type === u.type)).sort((a, b) => a.from.localeCompare(b.from))
      const what = can.reasons && u.type ? { Krankenstand: 'im Krankenstand', Urlaub: 'auf Urlaub', Zeitausgleich: 'im Zeitausgleich', Pflegefreistellung: 'in Pflegefreistellung' }[u.type] : 'abwesend'
      if (u.person && !list.length) {
        const next = (d.absences || []).filter((a) => a.employeeId === u.person.id && a.from > w.to).sort((a, b) => a.from.localeCompare(b.from))[0]
        return { mood: 'daumen', html: `<p><b>${esc(u.person.name)}</b> ist ${esc(w.label)} nicht ${esc(what)}.${next ? ` Als Nächstes: ${esc(can.reasons ? next.type : 'abwesend')} ab ${esc(formatDate(next.from))}.` : ''}</p>` }
      }
      if (!list.length) return { mood: 'daumen', html: `<p>${esc(cap(w.label))} ist niemand ${esc(what)}.</p>` }
      const rows = list.map((a) => row(`<b>${esc(name(d, a.employeeId))}</b> <span class="muted">${esc(can.reasons ? a.type : 'abwesend')} · ${esc(a.from === a.to ? formatDate(a.from) : `${formatDate(a.from)}–${formatDate(a.to)}`)}</span>`))
      return { mood: 'liste', html: box(`${esc(cap(w.label))} ${esc(what)}: ${plural(list.length, 'Person', 'Personen')}`, rows.slice(0, LIMIT), { more: Math.max(0, rows.length - LIMIT), acts: can.absenceView ? [btn('Abwesenheiten öffnen', 'view', { view: 'absences' })] : [] }) }
    }
    case 'summary': {
      const lines = []
      const acts = []
      if (can.plan) {
        const list = shiftsIn(d, w.from, w.to)
        const people = new Set(list.flatMap((i) => crew(i, d).people))
        const open = list.reduce((n, i) => n + crew(i, d).open, 0)
        lines.push(`<li>${plural(list.length, 'Einsatz', 'Einsätze')} mit ${plural(people.size, 'Person', 'Personen')}</li>`)
        if (open) {
          lines.push(`<li><span class="flag error">${open}</span> ${open === 1 ? 'Platz ist' : 'Plätze sind'} noch offen</li>`)
          if (can.coverage) acts.push(btn('Vertretungen planen', 'view', { view: 'coverage' }, true))
        }
      }
      if (can.absences) {
        const away = (d.absences || []).filter((a) => a.from <= w.to && a.to >= w.from)
        if (away.length) lines.push(`<li>${plural(away.length, 'Person', 'Personen')} abwesend: ${esc(away.slice(0, 4).map((a) => name(d, a.employeeId)).join(', '))}${away.length > 4 ? ' …' : ''}</li>`)
      }
      for (const a of (d.appointments || []).slice(0, 3)) lines.push(`<li>Termin: ${esc(a.time ? `${a.time} ` : '')}${esc(a.title)}</li>`)
      if (d.todoCount) {
        lines.push(`<li>${plural(d.todoCount, 'Punkt wartet', 'Punkte warten')} in „Zu erledigen“</li>`)
        acts.push(btn('Zu erledigen', 'open-todo'))
      }
      if (!lines.length) return { mood: 'daumen', html: `<p>${esc(cap(w.label))} ist nichts offen – sauber!</p>` }
      return { mood: 'liste', html: box(`${esc(cap(w.label))} im Überblick`, lines, { acts }) }
    }
    case 'holiday': {
      if (w) {
        const list = d.holidays(w.from, w.to)
        if (w.from === w.to) return { mood: list.length ? 'feiert' : 'denkt', html: `<p>${esc(cap(w.label))} (${esc(formatDate(w.from, { year: true }))}) ist ${list.length ? `<b>${esc(list[0].name)}</b>${list[0].legal === false ? ' (betrieblich frei)' : ' – gesetzlicher Feiertag'}` : 'kein Feiertag'}.</p>` }
        return { mood: 'feiert', html: list.length ? box(`Feiertage ${esc(w.label)}`, list.map((h) => row(`<b>${esc(formatDate(h.date))}</b> <span class="muted">${esc(h.name)}</span>`))) : `<p>${esc(cap(w.label))} gibt es keinen Feiertag.</p>` }
      }
      const list = d.holidays(addDays(d.today, 1), addDays(d.today, 400)).slice(0, 3)
      if (!list.length) return { mood: 'denkt', html: '<p>Ich finde keinen Feiertag im nächsten Jahr.</p>' }
      return { mood: 'feiert', html: box(`Nächster Feiertag: ${esc(list[0].name)}, ${esc(formatDate(list[0].date, { year: true }))}`, list.slice(1).map((h) => row(`<span class="muted">danach</span> <b>${esc(formatDate(h.date))}</b> ${esc(h.name)}`)), { note: 'Wie die Einsätze an Feiertagen laufen (statt finden, entfallen, verschieben), stellst du je Leistung ein.' }) }
    }
    case 'contact': {
      if (!can.staff) return DENIED
      const e = u.person
      const lines = [e.phone && row(`Telefon: <a href="tel:${esc(e.phone.replace(/[^\d+]/g, ''))}">${esc(e.phone)}</a>`), e.email && row(`E-Mail: <a href="mailto:${esc(e.email)}">${esc(e.email)}</a>`), e.team && row(`Team: ${esc(e.team)}`)].filter(Boolean)
      if (!e.phone && !e.email) return { mood: 'hoppla', html: `<p>Bei <b>${esc(e.name)}</b> ist keine Telefonnummer und keine E-Mail hinterlegt (Mitarbeitende → bearbeiten).</p>` }
      return { mood: 'handy', html: box(esc(e.name), lines, { acts: [e.phone ? `<a class="btn small primary" href="tel:${esc(e.phone.replace(/[^\d+]/g, ''))}">Anrufen</a>` : ''].filter(Boolean) }) }
    }
    case 'keys': {
      if (!can.keys) return DENIED
      const book = d.keys || []
      if (u.object) {
        const list = objectKeys(book, u.object.id)
        if (!list.length) return { mood: 'haus', html: `<p>Für <b>${esc(u.object.name)}</b> ist kein Schlüssel im Schlüsselbuch.</p>` }
        return { mood: 'haus', html: box(`Schlüssel ${esc(u.object.name)}`, list.map((k) => row(`<b>${esc(k.label)}${k.no ? ` Nr. ${esc(k.no)}` : ''}</b> <span class="muted">bei ${esc(k.holderId ? name(d, k.holderId) : 'im Büro')}${k.due ? ` · zurück bis ${esc(formatDate(k.due))}` : ''}</span>`)), { acts: [btn('Schlüsselbuch', 'view', { view: 'schluessel' })] }) }
      }
      if (u.person) {
        const list = keysOf(book, u.person.id)
        if (!list.length) return { mood: 'haus', html: `<p><b>${esc(u.person.name)}</b> hat laut Schlüsselbuch keinen Schlüssel.</p>` }
        return { mood: 'haus', html: box(`${esc(u.person.name)} hat ${plural(list.length, 'Schlüssel', 'Schlüssel')}`, list.map((k) => row(`<b>${esc(objName(d, k.objectId))}</b> <span class="muted">${esc(k.label)}${k.no ? ` Nr. ${esc(k.no)}` : ''}</span>`))) }
      }
      const out = book.filter((k) => isActive(k) && k.holderId)
      return { mood: 'haus', html: `<p>${plural(out.length, 'Schlüssel ist', 'Schlüssel sind')} gerade ausgegeben. Frag mich z. B. „Wer hat den Schlüssel vom ${esc(d.objects?.[0]?.name || 'Bürohaus')}?“</p><div class="cleo-acts">${btn('Schlüsselbuch', 'view', { view: 'schluessel' })}</div>` }
    }
    case 'complaints': {
      if (!can.complaints) return DENIED
      const list = (d.complaints || []).filter((c) => c.status !== 'erledigt' && (!u.object || c.objectId === u.object.id)).sort((a, b) => String(a.due || '').localeCompare(String(b.due || '')))
      if (!list.length) return { mood: 'daumen', html: `<p>Keine offene Reklamation${u.object ? ` im ${esc(u.object.name)}` : ''}. Sauber!</p>` }
      const late = list.filter((c) => c.due && c.due < d.today).length
      return { mood: 'desinfektion', html: box(`${plural(list.length, 'offene Reklamation', 'offene Reklamationen')}${late ? ` · ${late} überfällig` : ''}`, list.slice(0, LIMIT).map((c) => row(`<b>${esc(objName(d, c.objectId))}</b> <span class="muted">${esc(c.kind || '')}${c.due ? ` · fällig ${esc(formatDate(c.due))}` : ''}${c.due && c.due < d.today ? ' · <span class="flag error">überfällig</span>' : ''}</span>`)), { more: Math.max(0, list.length - LIMIT), acts: [btn('Reklamationen', 'view', { view: 'reklamationen' }, true)] }) }
    }
    case 'material': {
      if (!can.material || !d.material) return DENIED
      const q = normalize(u.text).split(' ').filter((x) => x.length > 3 && !MATERIAL_FILLER.has(x))
      const all = stockRows(d.material)
      let list = q.length ? all.filter((r) => q.some((x) => normalize(r.article.name).includes(x.replace(/s$/, '')))) : all.filter((r) => r.status !== 'ok')
      if (q.length && !list.length) return { mood: 'denkt', html: `<p>Einen Artikel „${esc(q.join(' '))}“ finde ich im Lager nicht.</p><div class="cleo-acts">${btn('Material & Lager', 'view', { view: 'material' })}</div>` }
      if (!list.length) return { mood: 'daumen', html: `<p>Alles im grünen Bereich – kein Artikel unter dem Meldebestand.</p>` }
      list = list.slice(0, LIMIT)
      return { mood: 'liste', html: box(q.length ? 'Lagerbestand' : `${plural(list.length, 'Artikel muss', 'Artikel müssen')} nachbestellt werden`, list.map((r) => row(`<b>${esc(r.article.name)}</b> <span class="muted">${esc(String(r.total))} ${esc(r.article.unit || '')}${r.status === 'leer' ? ' · <span class="flag error">leer</span>' : r.status === 'niedrig' ? ' · nachbestellen' : ''}${r.open ? ` · ${esc(String(r.open))} bestellt` : ''}</span>`)), { acts: [btn('Material & Lager', 'view', { view: 'material' })] }) }
    }
    case 'hours': {
      if (!can.plan) return DENIED
      const list = shiftsIn(d, w.from, w.to, (i) => crew(i, d).people.includes(u.person.id))
      const minutes = list.reduce((m, i) => m + (i.end - i.start), 0)
      return { mood: 'zeigt', html: `<p><b>${esc(u.person.name)}</b> hat ${esc(w.label)} laut Plan <b>${formatHours(minutes)} Stunden</b> in ${plural(list.length, 'Einsatz', 'Einsätzen')}${u.person.weeklyHours ? ` (vereinbart ${esc(String(u.person.weeklyHours))} h je Woche)` : ''}.</p><p class="muted">Ist-Zeiten, Überstunden und Zuschläge stehen im Wochenzettel.</p>` }
    }
    case 'wishes': {
      if (!can.plan) return DENIED
      const kinds = { frei: 'Wunschfrei', frueh: 'lieber früh', spaet: 'lieber spät', mehr: 'mehr Stunden', weniger: 'weniger Stunden' }
      const weekly = (k) => k === 'mehr' || k === 'weniger'
      const list = (d.wishes || [])
        .filter((x) => x && kinds[x.kind] && (!u.person || x.empId === u.person.id) && (weekly(x.kind) ? x.date <= w.to && addDays(x.date, 6) >= w.from : x.date >= w.from && x.date <= w.to))
        .filter((x) => !/\bwunschfrei\b/.test(normalize(u.text)) || x.kind === 'frei')
        .sort((a, b) => a.date.localeCompare(b.date))
      const who = u.person ? ` von ${esc(u.person.name)}` : ''
      if (!list.length) return { mood: 'schlaeft', html: `<p>Keine Wünsche${who} ${esc(w.label)}.</p>`, }
      const acts = can.planEdit ? [btn('Wünsche öffnen', 'wish-open', {}, true)] : []
      return { mood: 'liste', html: box(`${plural(list.length, 'Wunsch', 'Wünsche')}${who} ${esc(w.label)}`, list.slice(0, LIMIT).map((x) => row(`<b>${esc(name(d, x.empId))}</b> <span class="muted">${esc(weekly(x.kind) ? `Woche ab ${formatDate(x.date)}` : formatDate(x.date))} · ${esc(kinds[x.kind])}${x.note ? ` · ${esc(x.note)}` : ''}</span>`)), { more: Math.max(0, list.length - LIMIT), acts, note: 'Wünsche sind keine Abwesenheit – die Automatik berücksichtigt sie beim Planen.' }) }
    }
    case 'absence-cmd': {
      const emp = u.person
      if (!can.planEdit) return { mood: 'hoppla', html: `<p>Abwesenheiten trägt das Büro ein. Sag bitte dort Bescheid, dass <b>${esc(emp.name)}</b> ${esc(u.when?.label || 'heute')} ${u.type === 'Urlaub' ? 'auf Urlaub' : 'abwesend'} ist.</p>` }
      const from = u.when?.from || d.today
      const to = u.when?.to || from
      return {
        mood: 'liste',
        html: box(`${esc(emp.name)} · ${esc(u.type)} · ${esc(from === to ? formatDate(from) : `${formatDate(from)}–${formatDate(to)}`)}`, [], {
          note: 'Soll ich das eintragen? Ich öffne das Formular schon ausgefüllt – du prüfst und speicherst. Danach zeige ich dir, welche Einsätze neu zu besetzen sind.',
          acts: [btn('Formular öffnen', 'open-absence-new', { emp: emp.id, date: from, to, type: u.type }, true)],
        }),
      }
    }
  }
  return null
}

const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1)

/** Beispiel-Fragen, die Cleo mit Daten beantwortet (je nach Rolle). */
export function dataExamples(can = {}, { person = '', object = '' } = {}) {
  return [
    can.plan && 'Wer arbeitet heute?',
    can.plan && 'Was ist diese Woche noch offen?',
    can.plan && person && `Wo ist ${person} morgen?`,
    can.absences && 'Wer ist diese Woche abwesend?',
    can.plan && object && `Wer putzt nächste Woche im ${object}?`,
    'Wann ist der nächste Feiertag?',
    can.complaints && 'Offene Reklamationen?',
    can.material && 'Was muss nachbestellt werden?',
    can.plan && 'Wer hat diese Woche Wunschfrei?',
  ].filter(Boolean)
}
