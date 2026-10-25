// Regeln & Feiertage: Grenzwerte, Regelkatalog (an/aus), Fahrzeit-Matrix,
// betriebsfreie Tage, Qualifikationen.

import { formatDate } from '../../core/dates.js'
import { austrianHolidays } from '../../core/holidays.js'
import { DEFAULT_HOLIDAY_RULE } from '../../core/plan.js'
import { DEFAULT_RULES, mergeRules, RULES, travelKey } from '../../core/rules.js'
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
    ['holidayBonusPct', 'Feiertagszuschlag (%)', 'ARG § 9: Feiertagsentgelt + Entgelt für die Arbeit = 100 %; im Wochenzettel z. B. 1,5 h → 3 h'],
    ['sundayBonusPct', 'Sonntagszuschlag (%)', 'laut Kollektivvertrag prüfen'],
    ['travelMin', 'Fahrzeit zwischen Objekten (min)', 'Pauschale, wenn unten keine Strecke hinterlegt ist; zählt als Arbeitszeit'],
    ['creditSpecialTasks', 'Sonderleistungen bei Feiertag/Urlaub anrechnen', 'z. B. „Blumen gießen“', 'checkbox'],
  ]],
  ['Überstunden & Mehrarbeit (AZG, KV Gebäudereinigung)', [
    ['pay.fullTimeWeeklyH', 'Normalarbeitszeit Vollzeit (h/Woche)', 'KV: 40 h. Teilzeit: bis hierher Mehrarbeit, darüber Überstunden'],
    ['pay.dailyNormalH', 'Tägliche Normalarbeitszeit (h)', '§§ 3, 4 AZG: 8 h, bei anderer Verteilung 9 h; darüber Überstunden'],
    ['pay.longDayH', 'Eigener Satz ab Stunde', 'KV: angeordnete 11. und 12. Stunde (also ab 10 h)'],
    ['pay.mehrPct', 'Mehrarbeitszuschlag (%)', '§ 19d AZG, KV: 25 %'],
    ['pay.mehrBalanceMonths', 'Ausgleich der Mehrarbeit binnen (Monate)', '1:1 ausgeglichen = zuschlagsfrei (KV: 3 Monate)'],
    ['pay.mehrMode', 'Mehrarbeit standardmäßig', 'je Person und Monat änderbar', 'select', [['zeitkonto', 'ins Zeitkonto (ausgleichen)'], ['auszahlen', 'auszahlen mit Zuschlag']]],
    ['pay.ueMode', 'Überstunden standardmäßig', '§ 10 AZG: Geld oder Zeitausgleich 1:1,5', 'select', [['auszahlen', 'auszahlen'], ['za', 'Zeitausgleich 1:1,5'], ['mix', 'Zeitausgleich 1:1 + Zuschlag in Geld']]],
  ]],
  ['Zuschläge in % (KV Gebäudereinigung 2026)', [
    ['pay.ueTag', 'Überstunden', 'KV: 50 %'],
    ['pay.ueNacht', 'Überstunden Nacht', 'KV: 100 %'],
    ['pay.ueSonntag', 'Überstunden Sonntag', 'KV: 150 %'],
    ['pay.ueFeiertag', 'Überstunden Feiertag', 'KV: 100 % zusätzlich zum Feiertagsentgelt'],
    ['pay.ue11Tag', '11./12. Stunde', 'KV: 75 % (angeordnet)'],
    ['pay.ue11Nacht', '11./12. Stunde Nacht', 'KV: 125 %'],
    ['pay.ue11Sonntag', '11./12. Stunde Sonntag', 'laut KV prüfen'],
    ['pay.ue11Feiertag', '11./12. Stunde Feiertag', 'KV: 125 %'],
    ['pay.nightPct', 'Nachtzuschlag Normal-/Mehrarbeitsstunden', 'KV: 50 %, Mo–Sa'],
    ['pay.nightFrom', 'Nachtzeit (Zuschlag) ab', 'KV: 21:00', 'time'],
    ['pay.nightTo', 'Nachtzeit (Zuschlag) bis', 'KV: 06:00', 'time'],
    ['pay.bonusAs', 'Sonn-/Feiertagszuschlag auf Normalstunden', 'als Zeit: im Wochenzettel und Zeitkonto (wie bisher)', 'select', [['zeit', 'als Zeitgutschrift'], ['geld', 'in Geld (Auszahlung)']]],
    ['pay.taxFreeHours', 'Steuerfreie Überstunden je Monat', '§ 68 Abs 2 EStG, 2026: 15 (sonst 10)'],
    ['pay.taxFreeMax', 'Steuerfrei höchstens (€/Monat)', '2026: 170 € (sonst 120 €)'],
  ]],
  ['Automatik', [
    ['autoExtraHoursPerWeek', 'Max. Mehrstunden für Vertretungen (h/Woche)', 'Darüber plant die Automatik niemanden ein; manuell bleibt es möglich.'],
    ['dueLeadDays', 'Periodische Leistungen zuteilen (Tage vorher)', '14-tägige, monatliche, quartalsweise Leistungen ohne Besetzung erscheinen ab dann unter „Zu erledigen“'],
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
  const rules = mergeRules(app.data.rules)
  return b ? rules[a]?.[b] : rules[a]
}

function wagesFieldset() {
  const wages = mergeRules(app.data.rules).wages
  return `<fieldset><legend>KV-Stundenlöhne (€)</legend>
    ${Object.keys(wages).map((g) => `<div class="rule"><label for="rule-wages-${g}">Lohngruppe ${esc(g)}</label><input id="rule-wages-${g}" type="number" step="0.01" min="0" value="${esc(wages[g])}"><small></small></div>`).join('')}
    <p class="note">Lohnordnung Denkmal-, Fassaden- und Gebäudereinigung ab 1.1.2026. Die Lohngruppe steht bei der Person, ein eigener Stundenlohn (Überzahlung) geht vor.</p></fieldset>`
}

function rulesView(c) {
  const year = Number(c.monday.slice(0, 4))
  const disabled = new Set(app.data.rules?.disabledRules || [])
  const fieldsets = RULE_FIELDS.map(
    ([title, fields]) =>
      `<fieldset><legend>${title}</legend>${fields
        .map(([key, label, hint, type = 'number', choices]) => {
          const id = `rule-${key.replace('.', '-')}`
          if (type === 'select') return `<div class="rule"><label for="${id}">${label}</label><select id="${id}">${options(choices, ruleValue(key))}</select><small>${hint}</small></div>`
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
  const closedTasks = app.data.tasks.filter((t) => t.holidayRule === 'entfaellt').length
  return `<div class="section-head"><div><h2>Regeln & Feiertage</h2><p>Grundlage sind AZG, ARG und KJBG. Werte aus eurem Kollektivvertrag oder Betriebsvereinbarungen hier anpassen. Alle Markierungen und die Automatik richten sich danach.</p></div>
      <div class="actions edit-only"><button class="btn ${app.ui.confirm === 'rules-reset' ? 'danger confirm' : ''}" data-action="rules-reset">${app.ui.confirm === 'rules-reset' ? 'Wirklich zurücksetzen?' : 'Standardwerte'}</button><button class="btn primary" data-action="rules-save">Regeln speichern</button></div></div>
    <div class="rules">${fieldsets}${wagesFieldset()}</div>
    ${catalog}
    <div class="rules">
      <fieldset><legend>Fahrzeiten zwischen Objekten</legend>
        <p class="note">Abweichend von der Pauschale (${ruleValue('travelMin')} min). Gilt in beide Richtungen. Gleiche Adresse = 0 min.</p>
        <div class="hol-list">${travel.map(([k, min]) => `<span>${esc(objName(k.split('|')[0]))} ↔ ${esc(objName(k.split('|')[1]))}</span><span class="num">${min} min</span><button class="btn small danger edit-only" data-action="travel-delete" data-key="${esc(k)}">Entfernen</button>`).join('') || '<span class="muted">keine</span>'}</div>
        <div class="inline-form edit-only" style="border:0;padding:0"><label class="field"><span>Von</span><select id="tr-a">${options(objOptions, '')}</select></label><label class="field"><span>Nach</span><select id="tr-b">${options(objOptions, '')}</select></label><label class="field"><span>Minuten</span><input type="number" id="tr-min" min="0" step="5" value="15" style="width:6rem"></label><button class="btn" data-action="travel-add">${ICON.plus} Hinzufügen</button></div>
      </fieldset>
      <fieldset><legend>Gesetzliche Feiertage ${year}/${year + 1}</legend><div class="hol-list">${holidays.map((h) => `<span class="tabular">${formatDate(h.date, { year: true })}</span><span>${esc(h.name)}</span><span></span>`).join('')}</div>
        <p class="note">Österreich, § 7 ARG. Werden automatisch berechnet (Ostern, Pfingsten, Fronleichnam). Karfreitag ist seit 2019 kein Feiertag mehr.</p>
        <p class="note">An Feiertagen wird gearbeitet: die Einsätze finden statt, mit Feiertagszuschlag (${ruleValue('holidayBonusPct')} %). Je Leistung lässt sich „verschieben“ oder „entfällt (Kunde geschlossen)“ wählen.</p>
        ${closedTasks ? `<div class="edit-only"><button class="btn ${app.ui.confirm === 'holiday-all-work' ? 'primary confirm' : ''}" data-action="holiday-all-work">${app.ui.confirm === 'holiday-all-work' ? `Wirklich ${closedTasks} Leistungen umstellen?` : `${closedTasks} ${closedTasks === 1 ? 'Leistung entfällt' : 'Leistungen entfallen'} an Feiertagen: alle auf „findet statt“ stellen`}</button></div>` : ''}</fieldset>
      <fieldset><legend>Betriebsfreie Tage</legend>
        <p class="note">Tage, an denen der Betrieb geschlossen ist, z. B. Betriebsausflug oder Hl. Rupert (24.9., Salzburg), wenn frei gegeben wird. An diesen Tagen entfallen alle Einsätze, ohne Zuschlag. Einzelne Einsätze lassen sich im Einsatz mit „Trotzdem stattfinden“ einplanen.</p>
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
      const rules = structuredClone(mergeRules(app.data.rules))
      for (const g of Object.keys(rules.wages)) {
        const wage = num(`rule-wages-${g}`)
        if (wage !== null) rules.wages[g] = wage
      }
      for (const [, fields] of RULE_FIELDS) {
        for (const [key, , , type = 'number'] of fields) {
          const id = `rule-${key.replace('.', '-')}`
          const value = type === 'checkbox' ? checked(id) : type === 'time' || type === 'select' ? val(id) : num(id)
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
    'holiday-all-work': () => {
      if (!confirmStep('holiday-all-work')) return
      const list = app.data.tasks.filter((t) => t.holidayRule === 'entfaellt')
      for (const t of list) t.holidayRule = DEFAULT_HOLIDAY_RULE
      persist()
      renderNow()
      toast(`${list.length} Leistungen finden an Feiertagen jetzt statt, mit Feiertagszuschlag. Mit „Woche planen“ einteilen.`)
    },
    'rules-reset': () => {
      if (!confirmStep('rules-reset')) return
      app.data.rules = structuredClone(DEFAULT_RULES)
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
