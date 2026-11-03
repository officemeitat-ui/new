// Wetter & Winterdienst: Vorhersage und amtliche Warnungen (GeoSphere Austria)
// je Revier, Winterdienst per Klick anlegen, Hitze und Sturm für Arbeit im Freien.

import { addDays, formatDate, mondayOf, todayISO } from '../../core/dates.js'
import { WARN_LEVEL, warningText } from '../../core/weather.js'
import { app, canEdit, persist, recordUndo, registerActions, registerView, render, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { esc, ICON } from '../shared.js'
import { cancelWinterCall, createWinterCalls, nowcastFor, refreshNowcast, refreshWeather, weatherEnabled, weatherOverview, weatherRules, weatherState, winterOpen } from '../weather.js'
import { dayCards, hourlyChart, nowcastStrip } from '../weather-charts.js'
import { mountRadar, radarSlot, reloadRadar } from '../weather-radar.js'
import { KIND, nowcastHint } from '../../core/nowcast.js'
import { logSection } from '../winterlog.js'
import { alarmCard } from './weather-alarm.js'

const de = (x, digits = 0) => (x === null || x === undefined ? '–' : Number(x).toLocaleString('de-AT', { maximumFractionDigits: digits }).replace('-', '−'))
const dayName = (date, today) => (date === today ? 'Heute' : formatDate(date, { weekday: true }))
const pill = (w) => `<span class="pill wx-${WARN_LEVEL[w.level]}" title="${esc(w.text || '')}">${esc(warningText(w))}</span>`
const time = (ms) => new Date(ms).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })

function winterBlock(row, d, today, editable) {
  if (!d.objects.length) return ''
  if (!d.winter?.needed && !d.called.length) return ''
  const missing = d.objects.filter((o) => !d.called.includes(o))
  const reason = (d.winter?.reasons || []).join(', ')
  return `<div class="wx-winter ${d.winter?.needed ? 'need' : ''}">
    <p><strong>${ICON.snow} Winterdienst ${esc(dayName(d.date, today))}${reason ? `: ${esc(reason)}` : ''}</strong></p>
    ${d.called.length ? `<p class="note">Angelegt (${d.called.length}): ${d.called.map((o) => `${esc(o.short || o.name)}${editable ? ` <button class="link-btn" data-action="wx-cancel" data-date="${d.date}" data-obj="${esc(o.id)}" title="Winterdienst für dieses Objekt absagen">absagen</button>` : ''}`).join(' · ')}</p>` : ''}
    ${missing.length ? `<p>${missing.length} ${missing.length === 1 ? 'Objekt' : 'Objekte'} mit Winterdienst: ${missing.map((o) => esc(o.short || o.name)).join(', ')}</p>
      ${editable ? `<button class="btn primary" data-action="wx-create" data-date="${d.date}" data-loc="${esc(row.loc.name)}">${ICON.plus} Winterdienst für ${esc(dayName(d.date, today))} anlegen (${missing.length})</button>` : '<p class="note">Anlegen darf, wer die Einsatzplanung bearbeitet.</p>'}` : ''}
  </div>`
}

function outdoorList(row, d, today) {
  if (!row.outdoor || (!d.heat?.warning && !d.storm?.warning)) return ''
  const rows = []
  if (d.heat?.warning) rows.push(`<p><strong>${esc(warningText(d.heat.warning))} ${esc(dayName(d.date, today))}:</strong> Für Arbeit im Freien den Hitzeschutzplan umsetzen (Hitzeschutzverordnung): Trinkwasser, Schatten, zusätzliche Pausen, UV-Schutz, Arbeit möglichst in die Morgenstunden, Beschäftigte über die Warnung informieren.</p>`)
  if (d.storm?.warning) rows.push(`<p><strong>${esc(warningText(d.storm.warning))} ${esc(dayName(d.date, today))}:</strong> Arbeit im Freien und in der Höhe (Glas, Fassade, Leiter) prüfen oder verschieben.</p>`)
  return `<div class="wx-alert">${rows.join('')}<p class="note">Betroffene Einsätze (Leistungen „im Freien“) sind in der Wochenübersicht und im Prüfbericht markiert.</p></div>`
}

/** Grafik für einen Ort: Nowcast, Tageskarten, Stundenverlauf; Orte als Reiter mit „Regen in 20 Min.“. */
function graphSection(rows, today) {
  const withData = rows.filter((r) => r.entry)
  if (!withData.length) return ''
  const sel = withData.find((r) => r.loc.name === app.ui.weatherLoc) || withData[0]
  const now = Date.now()
  const nc = weatherState().nowcast
  const tabs =
    withData.length > 1
      ? `<div class="filters wx-tabs" aria-label="Ort">${withData
          .map((r) => {
            const hint = nowcastHint(nowcastFor(r.loc)?.steps, now)
            const short = hint.state === 'soon' || hint.state === 'now' ? ` <span class="wx-tab-hint ${hint.kind === KIND.snow ? 'snow' : ''}">${esc(hint.short)}</span>` : ''
            return `<button class="filter" data-action="wx-loc" data-loc="${esc(r.loc.name)}" aria-pressed="${r === sel}">${esc(r.loc.name)}${short}</button>`
          })
          .join('')}</div>`
      : ''
  const point = nowcastFor(sel.loc)
  const now3 = point ? nowcastStrip(point, { now }) : nc?.error ? `<div class="wx-now"><p class="muted">Nowcast: ${esc(nc.error)}</p></div>` : '<div class="wx-now"><p class="muted">Nowcast wird geladen …</p></div>'
  const dates = [today, addDays(today, 1), addDays(today, 2)]
  return `<section class="wx-graph">
    <div class="wx-graph-head"><h3>${esc(sel.loc.name)}: nächste Stunden und Tage</h3>${tabs}</div>
    ${now3}
    ${dayCards(sel.entry, sel.loc, dates, today)}
    <h4 class="wx-sub">Stundenverlauf</h4>
    ${hourlyChart(sel.entry, sel.loc, { now, cfg: weatherRules() })}
    <p class="note">Linie: Temperatur · Balken: Niederschlag je Stunde (blau Regen, lila Schnee) · darunter Böen in km/h mit Windrichtung${sel.entry.hours?.some((h) => h.snowLimit !== undefined) ? ', SFG = Schneefallgrenze' : ''} · dunkel: Nacht. GeoSphere rechnet rund 2½ Tage voraus.</p>
  </section>`
}

function radarSection() {
  // nach dem Zeichnen die Karte in den Platzhalter hängen (sie bleibt zwischen dem Neuzeichnen erhalten)
  queueMicrotask(mountRadar)
  return `<section class="wx-radar-card"><h3>Niederschlagsradar</h3><p class="muted">Letzte Stunden, jetzt und die nächsten Stunden: abspielen oder am Regler ziehen. Der Streifen darunter zeigt, wann es im Ausschnitt nass ist.</p>${radarSlot()}</section>`
}

function weatherView() {
  const today = todayISO()
  refreshWeather() // nur wenn älter als 30 min (z. B. Rolle ohne Einsatzplanung beim Start)
  refreshNowcast() // nur bei offener Ansicht, höchstens alle 10 min
  const st = weatherState()
  const editable = canEdit('planung') && !app.readOnly
  const rows = weatherOverview(today)
  const any = rows.some((r) => r.entry)
  const winterObjects = (app.data.objects || []).filter((o) => o.winter?.active).length
  const head = `<div class="section-head"><div><h2>Wetter & Winterdienst</h2><p>Vorhersage und amtliche Warnungen von GeoSphere Austria je Revier. Winterdienst (§ 93 StVO: Gehsteige 6–22 Uhr geräumt und gestreut) per Klick anlegen; Hitze- und Sturmwarnungen für Arbeit im Freien.</p></div>
    <div class="actions"><button class="btn" data-action="wx-refresh" ${st.loading ? 'disabled' : ''}>${ICON.refresh} ${st.loading ? 'Lädt …' : 'Aktualisieren'}</button></div></div>`
  const status = st.error
    ? `<div class="banner warn-banner"><p><strong>Wetterdaten nicht vollständig.</strong> ${esc(st.error)}${any ? ' Angezeigt wird der letzte Stand.' : ''}</p></div>`
    : !any ? `<div class="banner"><p>${st.loading ? 'Wetterdaten werden geladen …' : 'Noch keine Wetterdaten. „Aktualisieren“ lädt sie.'}</p></div>` : ''
  const hint = winterObjects ? '' : `<p class="note">Noch kein Objekt mit Winterdienst: unter <em>Objekte & Leistungen</em> beim Objekt „Winterdienst“ einschalten (Team, fertig bis, Dauer).</p>`
  const sections = rows
    .map((row) => {
      if (!row.entry) return `<section class="wx-loc"><h3>${esc(row.loc.name)}</h3><p class="muted">keine Daten</p></section>`
      const table = `<div class="table-wrap"><table class="data wx-table"><thead><tr><th>Tag</th><th>Temperatur</th><th>Niederschlag</th><th>Neuschnee</th><th>Böen</th><th>Warnungen</th></tr></thead><tbody>${row.days
        .map((d) => {
          const o = d.outlook
          if (!o || (!o.known && !o.warnings.length)) return `<tr><td>${esc(dayName(d.date, today))}</td><td colspan="5" class="muted">noch keine Vorhersage</td></tr>`
          return `<tr><td><strong>${esc(dayName(d.date, today))}</strong></td><td class="num">${de(o.tMin)} bis ${de(o.tMax)} °C</td><td class="num">${de(o.precip, 1)} mm</td><td class="num">${o.snow ? `${de(o.snow, 1)} cm` : '–'}</td><td class="num">${o.gust !== null ? `${de(o.gust)} km/h` : '–'}</td><td>${o.warnings.map(pill).join(' ') || '<span class="muted">keine</span>'}</td></tr>`
        })
        .join('')}</tbody></table></div>`
      const blocks = row.days.map((d) => winterBlock(row, d, today, editable) + outdoorList(row, d, today)).join('')
      return `<section class="wx-loc"><h3>${esc(row.loc.name)} <span class="muted">(${row.objects.length ? `${row.objects.length} ${row.objects.length === 1 ? 'Objekt' : 'Objekte'} mit Winterdienst` : 'ohne Winterdienst-Objekte'})</span></h3>${table}${blocks}
        <p class="note">Stand ${time(row.entry.at)} · ${esc(row.entry.source || 'GeoSphere')}${row.entry.partial ? ` · ${esc(row.entry.partial)}` : ''}</p></section>`
    })
    .join('')
  return `${head}${status}${hint}${graphSection(rows, today)}${radarSection()}${alarmCard()}${logSection(today)}${sections}
    <p class="note">Daten: <a href="https://data.hub.geosphere.at" target="_blank" rel="noopener">GeoSphere Austria</a> (CC BY 4.0), Warnungen je Gemeinde. Orte und Schwellen (Neuschnee, Glätte, Hitze, Böen) unter <em>Regeln & Feiertage</em>.</p>`
}

registerView({
  id: 'wetter',
  order: 47,
  label: 'Wetter & Winterdienst',
  group: 'plan',
  module: 'planung',
  noWeek: true,
  // Wochen von heute bis übermorgen laden (angelegter Winterdienst, auch über den Wochenwechsel)
  range: () => ({ from: todayISO(), to: addDays(todayISO(), 2) }),
  available: weatherEnabled,
  text: 'Vorhersage, Warnungen, Winterdienst',
  badge: () => winterOpen().length,
  render: weatherView,
})

registerTodo({
  id: 'winterdienst',
  module: 'planung',
  title: 'Winterdienst',
  compute: (today) => winterOpen(today).map((x) => ({ ...x, id: `${x.date}:${x.loc.name}:${x.objects.length}` })),
  render: (items) =>
    items
      .map((x) => `<div class="todo-item"><span class="flag warning">${x.objects.length}</span><div class="todo-text"><strong>Winterdienst ${esc(formatDate(x.date, { weekday: true }))}</strong> (${esc(x.loc.name)}): ${esc(x.reasons.join(', '))}<br><span class="muted">noch nicht angelegt: ${esc(x.objects.map((o) => o.short || o.name).join(', '))}</span></div><button class="btn small primary" data-action="view" data-view="wetter">Anlegen</button></div>`)
      .join(''),
})

registerActions({
  'wx-refresh': () => {
    refreshWeather({ force: true })
    refreshNowcast({ force: true })
    reloadRadar()
    renderNow()
  },
  'wx-loc': (el) => {
    app.ui.weatherLoc = el.dataset.loc
    renderNow()
  },
  'wx-create': async (el) => {
    const date = el.dataset.date
    await app.service.ensureWeeks([mondayOf(date)]).catch(() => {})
    const row = weatherOverview().find((r) => r.loc.name === el.dataset.loc)
    const d = row?.days.find((x) => x.date === date)
    if (!d) return
    const missing = d.objects.filter((o) => !d.called.includes(o))
    recordUndo(`Winterdienst ${formatDate(date)}`)
    const n = createWinterCalls(date, missing, (d.winter?.reasons || []).join(', ') || 'von Hand')
    app.ui.monday = mondayOf(date) // Wochenübersicht zeigt gleich die Woche des Einsatzes
    app.ui.month = null
    persist()
    await render()
    toast(`Winterdienst für ${n} ${n === 1 ? 'Objekt' : 'Objekte'} am ${formatDate(date)} angelegt${missing.some((o) => (o.winter?.team || []).length) ? ', Team eingeteilt' : ''}. In der Wochenübersicht prüfen.`)
  },
  'wx-cancel': (el) => {
    recordUndo('Winterdienst absagen')
    cancelWinterCall(el.dataset.date, el.dataset.obj)
    persist()
    renderNow()
    toast('Winterdienst für dieses Objekt abgesagt.')
  },
})
