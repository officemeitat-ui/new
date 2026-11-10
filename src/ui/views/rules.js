// Regeln & Feiertage: Grenzwerte, Regelkatalog (an/aus), Fahrzeit-Matrix,
// betriebsfreie Tage, Qualifikationen.

import { formatDate } from '../../core/dates.js'
import { austrianHolidays } from '../../core/holidays.js'
import { estimateTravel, hasCoords } from '../../core/geo.js'
import { DEFAULT_HOLIDAY_RULE } from '../../core/plan.js'
import { mergeRules, resetRules, RULES, travelKey } from '../../core/rules.js'
import { makeBlackout, vacationSettings } from '../../core/urlaub.js'
import { findPlace } from '../../core/weather.js'
import { app, confirmStep, persist, registerActions, registerView, renderNow, toast } from '../context.js'
import { geocode } from '../geocode.js'
import { checked, esc, ICON, num, options, uid, val } from '../shared.js'

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
    ['minWeeklyRestH', 'Wochenruhe (h)', '§§ 3, 4 ARG: 36 h, inkl. eines ganzen freien Tages; Jugendliche (§ 19 KJBG): zwei zusammenhängende freie Tage mit dem Sonntag'],
    ['nightStart', 'Nachtzeit nach AZG ab', '§ 12a AZG: 22:00 (Nachtarbeitnehmer:in); der Nachtzuschlag gilt laut KV ab 21 Uhr', 'time'],
    ['nightEnd', 'Nachtzeit nach AZG bis', '05:00', 'time'],
  ]],
  ['Zuschläge, Fahrzeit & Anrechnung', [
    ['holidayBonusPct', 'Feiertagszuschlag (%)', 'ARG § 9: Feiertagsentgelt + Entgelt für die Arbeit = 100 %; im Wochenzettel z. B. 1,5 h → 3 h'],
    ['sundayBonusPct', 'Sonntagszuschlag (%)', 'KV: 100 % (Sonntag 6–21 Uhr)'],
    ['sundayBasis', 'Sonntagsarbeit erlaubt aufgrund', '§ 3 ARG: Wochenendruhe ab Samstag 13 Uhr (unbedingt nötige Reinigung 15 Uhr). Ausnahme eintragen (ARG-Verordnung, KV, Betriebsvereinbarung); je Objekt ergänzbar. Leer = Warnung bei jedem Sonntagseinsatz', 'text'],
    ['travelMin', 'Fahrzeit zwischen Objekten (min)', 'Pauschale, wenn unten keine Strecke hinterlegt ist und Koordinaten fehlen; zählt als Arbeitszeit'],
    ['travelFromDistance', 'Fahrzeit aus Entfernung schätzen', 'wenn beide Objekte Koordinaten haben: Luftlinie × 1,35 (Straße), durch die Geschwindigkeit, plus Zuschlag, auf 5 min aufgerundet', 'checkbox'],
    ['travelSpeedKmh', 'Durchschnittsgeschwindigkeit (km/h)', 'Stadt Salzburg rund 25–30, Umland 40–50'],
    ['travelBaseMin', 'Zuschlag je Fahrt (min)', 'Parken, Gehen, Ein- und Ausladen'],
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
    ['pay.ueSonntagnacht', 'Überstunden Sonntag Nacht', 'KV: 175 % (vor 6, ab 21 Uhr)'],
    ['pay.ueFeiertag', 'Überstunden Feiertag', 'KV: 100 % zusätzlich zum Feiertagsentgelt'],
    ['pay.ue11Tag', '11./12. Stunde', 'KV: 75 % (angeordnet)'],
    ['pay.ue11Nacht', '11./12. Stunde Nacht', 'KV: 125 %'],
    ['pay.ue11Sonntag', '11./12. Stunde Sonntag', 'KV: 175 %'],
    ['pay.ue11Sonntagnacht', '11./12. Stunde Sonntag Nacht', 'laut KV prüfen'],
    ['pay.ue11Feiertag', '11./12. Stunde Feiertag', 'KV: 125 %'],
    ['pay.nightPct', 'Nachtzuschlag Normal-/Mehrarbeitsstunden', 'KV: 50 %, Mo–Sa'],
    ['pay.nightFrom', 'Nachtzeit (Zuschlag) ab', 'KV: 21:00', 'time'],
    ['pay.nightTo', 'Nachtzeit (Zuschlag) bis', 'KV: 06:00', 'time'],
    ['pay.sundayFrom', 'Sonntagszuschlag ab', 'KV § 10: 06:00', 'time'],
    ['pay.sundayTo', 'Sonntagszuschlag bis', 'KV: 21:00; davor und danach gilt „Sonntag Nacht“', 'time'],
    ['pay.sundayNightPct', 'Sonntag Nacht, Normal-/Mehrarbeitsstunden (%)', 'KV: 150 % (davon der Sonntagszuschlag als Zeit, der Rest in Geld)'],
    ['pay.bonusAs', 'Sonn-/Feiertagszuschlag auf Normalstunden', 'als Zeit: im Wochenzettel und Zeitkonto (wie bisher)', 'select', [['zeit', 'als Zeitgutschrift'], ['geld', 'in Geld (Auszahlung)']]],
    ['pay.taxFreeHours', 'Steuerfreie Überstunden je Monat', '§ 68 Abs 2 EStG, 2026: 15 (sonst 10)'],
    ['pay.taxFreeMax', 'Steuerfrei höchstens (€/Monat)', '2026: 170 € (sonst 120 €)'],
    ['marginalLimitEur', 'Geringfügigkeitsgrenze (€/Monat)', '§ 5 Abs 2 ASVG: 2026 551,10 €; geprüft für „Geringfügig“ mit Stunden × Stundenlohn', 'euro'],
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

export const WEATHER_FIELDS = [
  ['weather.winterUntil', 'Winterdienst fertig bis', '§ 93 StVO: Gehsteige von 6 bis 22 Uhr geräumt und bei Glätte gestreut; je Objekt änderbar', 'time'],
  ['weather.winterMinutes', 'Winterdienst-Dauer je Objekt (min)', 'wenn beim Objekt nichts steht'],
  ['weather.snowCm', 'Winterdienst ab Neuschnee (cm)', 'Summe vom Vorabend 16 Uhr bis 22 Uhr des Tages'],
  ['weather.iceTempC', 'Glätte: Niederschlag bei höchstens (°C)', 'Regen oder Nieseln bei Frost: Winterdienst (streuen)'],
  ['weather.heatC', 'Hitze-Hinweis ab (°C)', 'Hitzeschutzverordnung: Pflichten ab Hitzewarnung gelb; vorher ein Hinweis laut Vorhersage'],
  ['weather.gustKmh', 'Hinweis ab Böen (km/h)', 'Arbeit im Freien und in der Höhe (Glas, Fassade, Leiter)'],
]

const locationsText = (list) => (list || []).map((l) => `${l.name} = ${l.lat}, ${l.lon}`).join('\n')

/** „Revier = Breite, Länge“ oder nur ein Ortsname (Land Salzburg) je Zeile → [{ name, lat, lon }]; Fehler als Text. */
export function parseLocations(text) {
  const list = []
  for (const line of String(text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    const m = line.match(/^(.+?)\s*[=:]\s*(.+)$/)
    // nur ein Name: Koordinaten aus der Ortsliste (Land Salzburg)
    const known = !m && findPlace(line)
    if (known) {
      list.push({ name: line, lat: known.lat, lon: known.lon })
      continue
    }
    const nums = (m?.[2].match(/-?\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(',', '.')))
    if (!m || nums.length !== 2) return { error: `„${line}“: Ort nicht in der Liste. Bitte als „Name = Breite, Länge“ schreiben, z. B. „Salzburg = 47.8095, 13.055“.` }
    const [lat, lon] = nums
    if (lat < 46 || lat > 49.1 || lon < 9.4 || lon > 17.2) return { error: `„${line}“: liegt nicht in Österreich (Breite 46–49, Länge 9,5–17).` }
    list.push({ name: m[1].trim(), lat, lon })
  }
  return list.length ? { list } : { error: 'Bitte mindestens einen Ort eintragen.' }
}

function weatherFieldset() {
  if (app.config?.weather === false) return ''
  const fields = WEATHER_FIELDS.map(([key, label, hint, type = 'number']) => {
    const id = `rule-${key.replace('.', '-')}`
    const input = type === 'number' ? 'type="number" step="0.5"' : `type="${type}"`
    return `<div class="rule"><label for="${id}">${label}</label><input id="${id}" ${input} value="${esc(ruleValue(key))}"><small>${hint}</small></div>`
  }).join('')
  return `<fieldset><legend>Wetter & Winterdienst</legend>${fields}
    <div class="rule"><label for="rule-weather-locations">Orte (Wetter und Schnee-Alarm)</label><textarea id="rule-weather-locations" rows="3" style="font-family:inherit;font-size:inherit">${esc(locationsText(ruleValue('weather').locations))}</textarea>
    <small>Je Zeile ein Ort. Für Orte im Land Salzburg genügt der Name (z. B. „Hallein“, „Obertrum“), sonst „Name = Breite, Länge“ (im Kartendienst Rechtsklick auf den Ort). Objekte nutzen den beim Objekt gewählten Ort, sonst den Ort ihres Reviers, sonst den ersten.</small></div>
    <p class="note">Vorhersage und amtliche Warnungen: GeoSphere Austria (Data Hub, CC BY 4.0).</p></fieldset>`
}

/** Urlaub: Sperrzeiten und wie viele höchstens gleichzeitig abwesend sein sollen (core/urlaub.js). */
function vacationFieldset() {
  const v = vacationSettings(app.data.rules)
  const list = [...(v.blackouts || [])].sort((a, b) => a.from.localeCompare(b.from))
  return `<fieldset><legend>Urlaub: Sperrzeiten und Höchstzahl</legend>
    <p class="note">Nur Hinweise beim Urlaubsantrag (Plan am Handy → „Zu erledigen“) und im Kalender der Abwesenheiten: Sperrzeit, wer schon weg ist, Resturlaub. Urlaub wird weiter vereinbart; die Sperrzeiten sehen die Mitarbeitenden am Handy beim Antrag.</p>
    <div class="rule"><label for="vac-max">Höchstens gleichzeitig abwesend (0 = keine Grenze)</label><input id="vac-max" type="number" min="0" step="1" value="${esc(String(v.maxParallel || 0))}"><small>Alle Arten (Urlaub, Krankenstand, Zeitausgleich …), alle aktiven Mitarbeitenden.</small></div>
    <div class="edit-only"><button class="btn small" data-action="vac-max-save">Höchstzahl speichern</button></div>
    <div class="hol-list">${list.map((b) => `<span class="tabular">${formatDate(b.from, { year: true })} – ${formatDate(b.to, { year: true })}</span><span>${esc(b.label)}</span><button class="btn small danger edit-only" data-action="vac-delete" data-id="${esc(b.id)}" aria-label="Sperrzeit ${esc(b.label)} entfernen">Entfernen</button>`).join('') || '<span class="muted">Keine Sperrzeiten.</span>'}</div>
    <div class="inline-form edit-only" style="border:0;padding:0"><label class="field"><span>Von</span><input type="date" id="vac-from"></label><label class="field"><span>Bis</span><input type="date" id="vac-to"></label><label class="field"><span>Grund</span><input type="text" id="vac-label" maxlength="80" placeholder="z. B. Grundreinigung Schulen"></label><button class="btn" data-action="vac-add">Sperrzeit hinzufügen</button></div>
  </fieldset>`
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
          const input = type === 'euro' ? 'type="number" step="0.01" min="0"' : type === 'number' ? 'type="number" step="0.5" min="0"' : `type="${type}"`
          return `<div class="rule"><label for="${id}">${label}</label><input id="${id}" ${input} value="${esc(ruleValue(key))}"><small>${hint}</small></div>`
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
    <div class="rules">${fieldsets}${weatherFieldset()}${wagesFieldset()}</div>
    ${catalog}
    <div class="rules">
      <fieldset><legend>Fahrzeiten zwischen Objekten</legend>
        <p class="note">Vorrang haben die Strecken hier. Sonst ${ruleValue('travelFromDistance') ? `schätzt die App aus den Koordinaten der Objekte (${ruleValue('travelSpeedKmh')} km/h, +${ruleValue('travelBaseMin')} min), ohne Koordinaten gilt` : 'gilt'} die Pauschale (${ruleValue('travelMin')} min). Gilt in beide Richtungen. Gleiche Adresse = 0 min.</p>
        <p>${app.data.objects.filter(hasCoords).length} von ${app.data.objects.length} Objekten haben Koordinaten. <button class="btn small edit-only" data-action="geo-all" title="Fehlende Koordinaten über OpenStreetMap aus den Adressen suchen (1 Anfrage je Sekunde)">Fehlende suchen (OpenStreetMap)</button></p>
        <div class="hol-list">${travel.map(([k, min]) => `<span>${esc(objName(k.split('|')[0]))} ↔ ${esc(objName(k.split('|')[1]))}</span><span class="num">${min} min</span><button class="btn small danger edit-only" data-action="travel-delete" data-key="${esc(k)}">Entfernen</button>`).join('') || '<span class="muted">keine</span>'}</div>
        <div class="inline-form edit-only" style="border:0;padding:0"><label class="field"><span>Von</span><select id="tr-a">${options(objOptions, '')}</select></label><label class="field"><span>Nach</span><select id="tr-b">${options(objOptions, '')}</select></label><label class="field"><span>Minuten</span><input type="number" id="tr-min" min="0" step="5" value="15" style="width:6rem"></label><button class="btn" data-action="travel-estimate" title="Aus den Koordinaten schätzen">Schätzen</button><button class="btn" data-action="travel-add">${ICON.plus} Hinzufügen</button></div>
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
      ${vacationFieldset()}
      <fieldset><legend>Qualifikationen</legend>
        <p class="note">Werden bei Leistungen als Voraussetzung und bei Mitarbeitenden als Fähigkeit hinterlegt. Mit Komma trennen.</p>
        <input type="text" id="skills-list" aria-label="Qualifikationen, mit Komma getrennt" value="${esc((app.data.skills || []).join(', '))}">
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
          const value = type === 'checkbox' ? checked(id) : type === 'time' || type === 'select' ? val(id) : type === 'text' ? val(id).trim() : num(id)
          if (value === null || (value === '' && type !== 'text')) continue
          const [a, b] = key.split('.')
          if (b) rules[a][b] = value
          else rules[a] = value
        }
      }
      if (document.getElementById('rule-weather-locations')) {
        for (const [key, , , type = 'number'] of WEATHER_FIELDS) {
          const id = `rule-${key.replace('.', '-')}`
          const value = type === 'time' ? val(id) : num(id)
          if (value !== null && value !== '') rules.weather[key.split('.')[1]] = value
        }
        const loc = parseLocations(val('rule-weather-locations'))
        if (loc.error) return toast(loc.error)
        rules.weather.locations = loc.list
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
      app.data.rules = resetRules(app.data.rules)
      persist()
      renderNow()
      toast('Regelwerte zurückgesetzt. Plan am Handy, Schnee-Alarm, Orte und Urlaubsregeln bleiben.')
    },
    'travel-estimate': () => {
      const o = (id) => app.data.objects.find((x) => x.id === id)
      const r = mergeRules(app.data.rules)
      const est = estimateTravel(o(val('tr-a')), o(val('tr-b')), { speedKmh: r.travelSpeedKmh, baseMin: r.travelBaseMin })
      if (!est) return toast('Für die Schätzung brauchen beide Objekte Koordinaten (Objekte & Leistungen → Objekt → Koordinaten).')
      document.getElementById('tr-min').value = est.minutes
      toast(`Rund ${String(est.km).replace('.', ',')} km Straße → ${est.minutes} min. Mit „Hinzufügen“ fest eintragen, sonst rechnet die App ohnehin so.`)
    },
    'geo-all': async (el) => {
      const missing = app.data.objects.filter((o) => !hasCoords(o) && o.address)
      if (!missing.length) return toast('Alle Objekte mit Adresse haben schon Koordinaten.')
      el.disabled = true
      let found = 0
      const notFound = []
      for (const [i, o] of missing.entries()) {
        el.textContent = `Suche ${i + 1} von ${missing.length} …`
        try {
          const hit = await geocode(o.address)
          if (hit) {
            Object.assign(o, { lat: hit.lat, lon: hit.lon })
            found++
          } else notFound.push(o.name)
        } catch (err) {
          notFound.push(o.name)
          if (i === 0) {
            toast(`Suche nicht möglich: ${err.message}`)
            break
          }
        }
      }
      if (found) persist()
      renderNow()
      toast(`${found} von ${missing.length} gefunden.${notFound.length ? ` Nicht gefunden: ${notFound.slice(0, 5).join(', ')}${notFound.length > 5 ? ' …' : ''} (Adresse genauer eintragen oder Koordinaten von Hand).` : ''}`)
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
    'vac-add': () => {
      const res = makeBlackout({ from: val('vac-from'), to: val('vac-to'), label: val('vac-label') }, { newId: () => uid('us') })
      if (res.error) return toast(res.error)
      const v = vacationSettings(app.data.rules)
      app.data.rules = { ...(app.data.rules || {}), vacation: { ...v, blackouts: [...(v.blackouts || []), res.blackout] } }
      persist()
      renderNow()
      toast(`Sperrzeit „${res.blackout.label}“ gespeichert. Am Handy sichtbar nach dem nächsten Veröffentlichen.`)
    },
    'vac-delete': (el) => {
      const v = vacationSettings(app.data.rules)
      app.data.rules = { ...(app.data.rules || {}), vacation: { ...v, blackouts: (v.blackouts || []).filter((b) => b.id !== el.dataset.id) } }
      persist()
      renderNow()
    },
    'vac-max-save': () => {
      const n = Math.max(0, Math.round(Number(val('vac-max')) || 0))
      app.data.rules = { ...(app.data.rules || {}), vacation: { ...vacationSettings(app.data.rules), maxParallel: n } }
      persist()
      renderNow()
      toast(n ? `Höchstens ${n} gleichzeitig abwesend.` : 'Keine Grenze für gleichzeitig Abwesende.')
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
  { edit: 'stammdaten' },
)
