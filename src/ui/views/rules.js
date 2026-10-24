// Regeln & Feiertage: Grenzwerte, Regelkatalog (an/aus), Fahrzeit-Matrix,
// betriebsfreie Tage, Qualifikationen.

import { formatDate } from '../../core/dates.js'
import { austrianHolidays } from '../../core/holidays.js'
import { DEFAULT_RULES, RULES, travelKey } from '../../core/rules.js'
import { app, confirmStep, persist, registerActions, registerView, renderNow, toast } from '../context.js'
import { checked, esc, ICON, num, options, val } from '../shared.js'

export const RULE_FIELDS = [
  ['Arbeitszeit (AZG)', [
    ['dailyWarnH', 'Warnung ab Stunden pro Tag', 'Über 10 h nur als Überstunden zulässig. Fahrzeit zählt mit.'],
    ['maxDailyH', 'Höchstarbeitszeit pro Tag (h)', '§ 9 AZG: 12 h'],
    ['maxAvgWeeklyH', 'Warnung ab Stunden pro Woche', '§ 9 Abs 4 AZG: im Schnitt 48 h über 17 Wochen'],
    ['maxWeeklyH', 'Höchstarbeitszeit pro Woche (h)', '§ 9 AZG: 60 h'],
    ['breakAfterH', 'Pause ab Einsatzdauer (h)', '§ 11 AZG: bei mehr als 6 h'],
    ['breakMin', 'Pausendauer (min)', 'wird automatisch abgezogen'],
  ]],
  ['Ruhezeiten (AZG, ARG)', [
    ['minDailyRestH', 'Tägliche Ruhezeit (h)', '§ 12 AZG: mind. 11 h zwischen Dienstende und Dienstbeginn'],
    ['minWeeklyRestH', 'Wochenruhe (h)', '§§ 3, 4 ARG: 36 h, inkl. eines ganzen freien Tages'],
    ['nightStart', 'Nachtarbeit ab', '§ 12a AZG: 22:00', 'time'],
    ['nightEnd', 'Nachtarbeit bis', '05:00', 'time'],
  ]],
  ['Zuschläge, Fahrzeit & Anrechnung', [
    ['holidayBonusPct', 'Feiertagszuschlag (%)', 'Arbeit am Feiertag, z. B. 1,5 h → 3 h'],
    ['sundayBonusPct', 'Sonntagszuschlag (%)', 'laut Kollektivvertrag prüfen'],
    ['travelMin', 'Fahrzeit zwischen Objekten (min)', 'Pauschale, wenn unten keine Strecke hinterlegt ist; zählt als Arbeitszeit'],
    ['creditSpecialTasks', 'Sonderleistungen bei Feiertag/Urlaub anrechnen', 'z. B. „Blumen gießen“', 'checkbox'],
  ]],
  ['Automatik', [
    ['autoExtraHoursPerWeek', 'Max. Mehrstunden für Vertretungen (h/Woche)', 'Darüber plant die Automatik niemanden ein; manuell bleibt es möglich.'],
  ]],
  ['Jugendliche (KJBG)', [
    ['minor.maxDailyH', 'Höchstarbeitszeit pro Tag (h)', '§ 11 KJBG: 8 h'],
    ['minor.maxWeeklyH', 'Höchstarbeitszeit pro Woche (h)', '§ 11 KJBG: 40 h'],
    ['minor.minDailyRestH', 'Tägliche Ruhezeit (h)', '§ 16 KJBG: 12 h'],
    ['minor.nightStart', 'Nachtruhe ab', '§ 17 KJBG: 20:00', 'time'],
    ['minor.nightEnd', 'Nachtruhe bis', '06:00', 'time'],
  ]],
]

function ruleValue(path) {
  const [a, b] = path.split('.')
  const rules = { ...DEFAULT_RULES, ...app.data.rules }
  return b ? { ...DEFAULT_RULES.minor, ...(rules.minor || {}) }[b] : rules[a]
}

function rulesView(c) {
  const year = Number(c.monday.slice(0, 4))
  const disabled = new Set(app.data.rules?.disabledRules || [])
  const fieldsets = RULE_FIELDS.map(
    ([title, fields]) =>
      `<fieldset><legend>${title}</legend>${fields
        .map(([key, label, hint, type = 'number']) => {
          const id = `rule-${key.replace('.', '-')}`
          if (type === 'checkbox') return `<label class="check"><input type="checkbox" id="${id}" ${ruleValue(key) ? 'checked' : ''}><span>${label}<br><small class="muted">${hint}</small></span></label>`
          return `<div class="rule"><label for="${id}">${label}</label><input id="${id}" type="${type}" ${type === 'number' ? 'step="0.5" min="0"' : ''} value="${esc(ruleValue(key))}"><small>${hint}</small></div>`
        })
        .join('')}</fieldset>`,
  ).join('')
  const catalog = `<fieldset class="wide-fs"><legend>Regelkatalog</legend><p class="note">Jede Regel einzeln ein- oder ausschalten. Eigene Regeln lassen sich als Modul ergänzen (siehe docs/ERWEITERN.md).</p>
    <div class="rule-catalog">${RULES.map((r) => `<label class="check"><input type="checkbox" name="rule-enabled" value="${esc(r.id)}" ${disabled.has(r.id) ? '' : 'checked'}><span><strong>${esc(r.title)}</strong> <span class="muted">${esc(r.law)}</span><br><small class="muted">${esc(r.description)}</small></span></label>`).join('')}</div></fieldset>`

  const travel = Object.entries(app.data.travel || {})
  const objName = (id) => app.data.objects.find((o) => o.id === id)?.name || id
  const objOptions = app.data.objects.map((o) => [o.id, `${o.name}${o.region ? ` (${o.region})` : ''}`])
  const holidays = [...austrianHolidays(year), ...austrianHolidays(year + 1)]
  const free = [...(app.data.extraFreeDays || [])].sort((a, b) => a.date.localeCompare(b.date))
  return `<div class="section-head"><div><h2>Regeln & Feiertage</h2><p>Grundlage sind AZG, ARG und KJBG. Werte aus eurem Kollektivvertrag oder Betriebsvereinbarungen hier anpassen. Alle Markierungen und die Automatik richten sich danach.</p></div>
      <div class="actions edit-only"><button class="btn ${app.ui.confirm === 'rules-reset' ? 'danger confirm' : ''}" data-action="rules-reset">${app.ui.confirm === 'rules-reset' ? 'Wirklich zurücksetzen?' : 'Standardwerte'}</button><button class="btn primary" data-action="rules-save">Regeln speichern</button></div></div>
    <div class="rules">${fieldsets}</div>
    ${catalog}
    <div class="rules">
      <fieldset><legend>Fahrzeiten zwischen Objekten</legend>
        <p class="note">Abweichend von der Pauschale (${ruleValue('travelMin')} min). Gilt in beide Richtungen. Gleiche Adresse = 0 min.</p>
        <div class="hol-list">${travel.map(([k, min]) => `<span>${esc(objName(k.split('|')[0]))} ↔ ${esc(objName(k.split('|')[1]))}</span><span class="num">${min} min</span><button class="btn small danger edit-only" data-action="travel-delete" data-key="${esc(k)}">Entfernen</button>`).join('') || '<span class="muted">keine</span>'}</div>
        <div class="inline-form edit-only" style="border:0;padding:0"><label class="field"><span>Von</span><select id="tr-a">${options(objOptions, '')}</select></label><label class="field"><span>Nach</span><select id="tr-b">${options(objOptions, '')}</select></label><label class="field"><span>Minuten</span><input type="number" id="tr-min" min="0" step="5" value="15" style="width:6rem"></label><button class="btn" data-action="travel-add">${ICON.plus} Hinzufügen</button></div>
      </fieldset>
      <fieldset><legend>Gesetzliche Feiertage ${year}/${year + 1}</legend><div class="hol-list">${holidays.map((h) => `<span class="tabular">${formatDate(h.date, { year: true })}</span><span>${esc(h.name)}</span><span></span>`).join('')}</div>
        <p class="note">Österreich, § 7 ARG. Werden automatisch berechnet (Ostern, Pfingsten, Fronleichnam). Karfreitag ist seit 2019 kein Feiertag mehr.</p></fieldset>
      <fieldset><legend>Betriebsfreie Tage</legend>
        <p class="note">Zum Beispiel 24.12., 31.12. oder der Landespatron Hl. Rupert (24.9., Salzburg). Einsätze entfallen wie an Feiertagen, aber ohne Feiertagszuschlag.</p>
        <div class="hol-list">${free.map((d) => `<span class="tabular">${formatDate(d.date, { year: true })}</span><span>${esc(d.name)}</span><button class="btn small danger edit-only" data-action="freeday-delete" data-date="${esc(d.date)}">Entfernen</button>`).join('') || '<span class="muted">keine</span>'}</div>
        <div class="inline-form edit-only" style="border:0;padding:0"><label class="field"><span>Datum</span><input type="date" id="free-date"></label><label class="field"><span>Bezeichnung</span><input type="text" id="free-name" placeholder="z. B. Betriebsausflug"></label><button class="btn" data-action="freeday-add">${ICON.plus} Hinzufügen</button></div>
      </fieldset>
      <fieldset><legend>Qualifikationen</legend>
        <p class="note">Werden bei Leistungen als Voraussetzung und bei Mitarbeitenden als Fähigkeit hinterlegt. Mit Komma trennen.</p>
        <input type="text" id="skills-list" value="${esc((app.data.skills || []).join(', '))}">
        <div class="edit-only"><button class="btn" data-action="skills-save">Qualifikationen speichern</button></div>
      </fieldset>
    </div>`
}

registerView({ id: 'rules', order: 110, label: 'Regeln & Feiertage', group: 'stamm', render: rulesView })

registerActions(
  {
    'rules-save': () => {
      const rules = { ...DEFAULT_RULES, ...app.data.rules }
      rules.minor = { ...DEFAULT_RULES.minor, ...(rules.minor || {}) }
      for (const [, fields] of RULE_FIELDS) {
        for (const [key, , , type = 'number'] of fields) {
          const id = `rule-${key.replace('.', '-')}`
          const value = type === 'checkbox' ? checked(id) : type === 'time' ? val(id) : num(id)
          if (value === null || value === '') continue
          const [a, b] = key.split('.')
          if (b) rules[a][b] = value
          else rules[a] = value
        }
      }
      const enabled = new Set([...document.querySelectorAll('input[name="rule-enabled"]:checked')].map((el) => el.value))
      rules.disabledRules = RULES.map((r) => r.id).filter((id) => !enabled.has(id))
      app.data.rules = rules
      app.ui.confirm = null
      persist()
      renderNow()
      toast('Regeln gespeichert. Alle Markierungen wurden neu berechnet.')
    },
    'rules-reset': () => {
      if (!confirmStep('rules-reset')) return
      app.data.rules = { ...DEFAULT_RULES, minor: { ...DEFAULT_RULES.minor } }
      persist()
      renderNow()
    },
    'travel-add': () => {
      const a = val('tr-a')
      const b = val('tr-b')
      if (!a || !b || a === b) return toast('Bitte zwei verschiedene Objekte wählen.')
      app.data.travel = { ...(app.data.travel || {}), [travelKey(a, b)]: Math.max(0, Math.round(num('tr-min') ?? 0)) }
      persist()
      renderNow()
    },
    'travel-delete': (el) => {
      const travel = { ...(app.data.travel || {}) }
      delete travel[el.dataset.key]
      app.data.travel = travel
      persist()
      renderNow()
    },
    'freeday-add': () => {
      const date = val('free-date')
      if (!date) return toast('Bitte ein Datum wählen.')
      app.data.extraFreeDays = [...(app.data.extraFreeDays || []).filter((d) => d.date !== date), { date, name: val('free-name').trim() || 'betriebsfrei' }]
      persist()
      renderNow()
    },
    'freeday-delete': (el) => {
      app.data.extraFreeDays = app.data.extraFreeDays.filter((d) => d.date !== el.dataset.date)
      persist()
      renderNow()
    },
    'skills-save': () => {
      app.data.skills = val('skills-list').split(',').map((s) => s.trim()).filter(Boolean)
      persist()
      renderNow()
      toast('Qualifikationen gespeichert.')
    },
  },
  { edit: true },
)
