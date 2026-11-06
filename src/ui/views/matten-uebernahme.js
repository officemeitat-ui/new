// Übernahme aus dem Werkzeug Mattenwechsel (P5, docs/MATTENWECHSEL-PLAN.md Abschnitt 4.3): Reiter „Übernahme aus dem
// Werkzeug“ in „Matten-Liegeplätze“, nur Vollzugriff. Ablauf:
//   1. Sicherung: Standorte.json, Kunden.json und die Liste der Tour-Dateien nach Mattenwechsel/_Sicherung/<Datum>/
//      (vorhandene Sicherung desselben Tages bleibt, nichts wird ersetzt); danach erst lesen.
//   2. Vorschau mit Zuordnung von Hand: Kunden (Vorschlag über Kundennummer, sonst Namen; fehlende nur auf Klick
//      anlegen), Objekte (je Kunde und Adresse; vorhandenes App-Objekt oder neu), Mattentypen (Größe/Farbe → Artikel).
//   3. Übernehmen: Liegeplätze mit legacyId, letzter Wechsel aus allen Touren; ein zweiter Lauf ändert nichts.
// Im Browser-Modus (ohne SharePoint) lassen sich die Dateien des Werkzeugs bzw. seine Sicherung „Alles sichern“ wählen.
// Die Dateien des Werkzeugs werden nie geschrieben. Rechenkern: core/matten-import.js.

import { formatDate, todayISO } from '../../core/dates.js'
import { applyImport, backupFolder, isTourFile, planImport, TOOL_PATHS, toolDataFromFiles, toolList } from '../../core/matten-import.js'
import { customerName, emptyMatten, intervalText, matTypes, typeLabel, upgradeMatten } from '../../core/matten.js'
import { app, confirmStep, persist, registerActions, renderNow, toast } from '../context.js'
import { esc, ICON, options, uid } from '../shared.js'

const S = () => (app.ui.mwImp ||= { choices: { customers: {}, objects: {}, mats: {} } })
/** Übernahme: nur Vollzugriff (schreibt Liegeplätze, Objekte und Kunden der Fakturierung). */
export const mayImport = () => (!app.access || !!app.access.all) && !app.readOnly
/** SharePoint-Ablage (ohne die Warteschlange des Geräts): liest und sichert ab der Bibliothek. */
const sp = () => {
  const s = app.store?.remote || app.store
  return s?.kind === 'sharepoint' && typeof s.readBlob === 'function' ? s : null
}
const doc = () => upgradeMatten((app.data.matten ||= emptyMatten()))
const short = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const fakData = () => app.data.fakturierung || null

function currentPlan() {
  const st = S()
  return planImport({ tool: st.tool, customers: fakData()?.customers || [], objects: app.data.objects || [], articles: fakData()?.articles || [], doc: doc(), choices: st.choices })
}

// ---------------------------------------------------------------- Lesen und sichern

const parse = (txt) => JSON.parse(String(txt || '').replace(/^﻿/, ''))

/** Werkzeug-Daten aus SharePoint lesen und vorher sichern. Liefert { tool, files, backup } oder wirft. */
async function readFromSharePoint(store, onStep = () => {}) {
  const date = todayISO()
  const folder = backupFolder(date)
  const backup = { folder, written: [], existed: [], missing: [] }
  const raw = {}
  for (const [key, path, name] of [
    ['standorte', TOOL_PATHS.standorte, 'Standorte.json'],
    ['kunden', TOOL_PATHS.kunden, 'Kunden.json'],
  ]) {
    onStep(`${name} lesen …`)
    const blob = await store.readBlob(path, { root: true })
    if (!blob) {
      backup.missing.push(path)
      continue
    }
    const txt = await blob.text()
    raw[key] = parse(txt)
    const res = await store.writeRootNew(`${folder}/${name}`, blob, 'application/json')
    ;(res ? backup.written : backup.existed).push(name)
  }
  onStep('Touren suchen …')
  const list = (await store.listTree(TOOL_PATHS.touren, { depth: 5, skip: ['Fotos'] })).filter((f) => isTourFile(f.name))
  const listing = { stand: new Date().toISOString(), ordner: TOOL_PATHS.touren, dateien: list.map((f) => ({ pfad: f.path, groesse: f.size, geaendert: f.modified })) }
  const res = await store.writeRootNew(`${folder}/Touren-Liste.json`, new Blob([JSON.stringify(listing, null, 1)], { type: 'application/json' }), 'application/json')
  ;(res ? backup.written : backup.existed).push('Touren-Liste.json')
  const touren = []
  const broken = []
  for (let i = 0; i < list.length; i += 4) {
    onStep(`Touren lesen: ${Math.min(i + 4, list.length)} von ${list.length} …`)
    const part = await Promise.all(list.slice(i, i + 4).map((f) => store.readRoot(f.path).catch(() => null)))
    part.forEach((t, j) => (t && Array.isArray(t.halte) ? touren.push(t) : broken.push(list[i + j].path)))
  }
  return { tool: { standorte: toolList(raw.standorte, 'standorte'), kunden: toolList(raw.kunden, 'kunden'), touren }, files: { tours: list.length, broken }, backup }
}

// ---------------------------------------------------------------- Ansicht

const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`

function intro() {
  const store = sp()
  const st = S()
  const how = store
    ? `<p><button class="btn primary" data-action="mw-imp-read" ${st.busy ? 'disabled' : ''}>${ICON.download} Sichern und Daten des Werkzeugs lesen</button>${st.busy ? ` <span class="muted">${esc(st.busy)}</span>` : ''}</p>`
    : `<p class="muted">Ohne SharePoint (Browser-Modus): die Dateien des Werkzeugs wählen – Standorte.json, Kunden.json und Tour-Dateien – oder die Sicherung aus dem Werkzeug („Alles sichern“).</p>
       <label class="btn"><input type="file" accept="application/json,.json" multiple hidden data-change="mw-imp-files">${ICON.upload} Dateien des Werkzeugs wählen</label>`
  return `<section class="mw-imp">
    <h3>Übernahme aus dem Werkzeug Mattenwechsel</h3>
    <p>Übernimmt die Liegeplätze des Werkzeugs (Datei Standorte.json) einmalig in dieses Modul: Kunden der Fakturierung zuordnen, Liegeplätze je Kunde und Adresse zu Objekten zusammenfassen, Matten den Mattentypen zuordnen und den letzten Wechsel aus allen Touren in SharePoint holen.</p>
    <ol class="mw-steps"><li><strong>Sicherung</strong> nach <code>${esc(TOOL_PATHS.sicherung)}/&lt;Datum&gt;/</code>, dann lesen</li><li><strong>Vorschau</strong> mit Zuordnung von Hand</li><li><strong>Übernehmen</strong> – ein zweiter Lauf ändert nichts</li></ol>
    ${how}
    <p class="note">Die Dateien des Werkzeugs werden nur gelesen, nie geändert. Alte Touren und Lieferscheine bleiben, wo sie sind; sie werden nicht zu Belegen und nicht verrechnet. Das Werkzeug läuft bis zur Umstellung parallel weiter.</p>
  </section>`
}

export function importTab() {
  if (!mayImport()) return '<p class="empty">Die Übernahme darf nur der Vollzugriff ausführen.</p>'
  const st = S()
  if (!st.tool) return intro()
  const plan = currentPlan()
  const fakCustomers = [...(fakData()?.customers || [])].sort((a, b) => customerName(a).localeCompare(customerName(b), 'de'))
  const objects = [...(app.data.objects || [])].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const types = matTypes(fakData()?.articles || []).filter((a) => a.active !== false)
  const tours = st.tool.touren || []
  const dates = tours.map((t) => t.datum).filter(Boolean).sort()
  const b = st.backup
  const source = `<div class="banner"><p><strong>Gelesen:</strong> ${plural(plan.counts.standorte, 'Liegeplatz', 'Liegeplätze')} (Standorte.json), ${plural(toolList(st.tool.kunden, 'kunden').length, 'Kunde', 'Kunden')} (Kunden.json), ${plural(tours.length, 'Tour', 'Touren')}${dates.length ? ` vom ${short(dates[0])} bis ${short(dates.at(-1))}` : ''} mit ${plural(plan.counts.wechsel, 'gewechseltem Liegeplatz', 'gewechselten Liegeplätzen')}.${st.files?.broken?.length ? ` ${plural(st.files.broken.length, 'Tour-Datei', 'Tour-Dateien')} nicht lesbar.` : ''}<br>
      ${b ? `<strong>Sicherung:</strong> <code>${esc(b.folder)}/</code>${b.written.length ? ` – neu: ${esc(b.written.join(', '))}` : ''}${b.existed.length ? ` – von heute schon vorhanden: ${esc(b.existed.join(', '))}` : ''}${b.missing.length ? ` – nicht gefunden: ${esc(b.missing.join(', '))}` : ''}` : '<strong>Browser-Modus:</strong> keine Sicherung nötig, die gewählten Dateien bleiben unverändert.'}</p>
      <button class="btn small" data-action="mw-imp-reset">Neu lesen</button></div>`
  const result = st.result ? `<div class="banner welcome"><p><strong>Übernommen:</strong> ${plural(st.result.placements, 'Liegeplatz', 'Liegeplätze')} neu, ${plural(st.result.updated, 'Liegeplatz', 'Liegeplätze')} aktualisiert, ${plural(st.result.customers, 'Kunde', 'Kunden')} und ${plural(st.result.objects, 'Objekt', 'Objekte')} angelegt, ${plural(st.result.areas, 'Gebiet', 'Gebiete')}.</p></div>` : ''
  const c = plan.counts
  const tiles = `<div class="impact-stats tc-stats">${tile('neu', c.neu)}${tile('aktualisieren', c.aktualisieren)}${tile('schon übernommen', c.gleich)}${tile('ohne Kunde', c.ohneKunde, c.ohneKunde ? 'err' : '')}</div>`

  // 1. Kunden
  const missingCust = plan.customers.filter((r) => !r.choice && !r.suggestion)
  const custRows = plan.customers
    .map((r) => {
      const list = [['neu', '+ neu anlegen'], ...fakCustomers.map((x) => [x.id, x.customerNo ? `${customerName(x)} (${x.customerNo})` : customerName(x)])]
      return `<tr><td><strong>${esc(r.name)}</strong>${r.nr ? `<br><span class="muted">Kundennummer ${esc(r.nr)}</span>` : ''}</td><td class="num">${r.count}</td>
        <td><select data-change="mw-imp-choice" data-kind="customers" data-key="${esc(r.key)}" aria-label="Kunde in der Fakturierung für ${esc(r.name)}">${options(list, r.choice, { empty: '– nicht übernehmen –' })}</select></td>
        <td>${r.suggestion ? `<span class="pill ok">${esc(r.suggestion.how)}</span>` : '<span class="pill warning">kein Vorschlag</span>'}</td></tr>`
    })
    .join('')
  const custSection = `<section class="mw-block"><h3>1. Kunden zuordnen</h3><p class="muted">Vorschlag über die Kundennummer, sonst über den Namen. Neue Kunden legt die Übernahme nur an, wenn „neu anlegen“ gewählt ist; ohne Kunde bleiben die Liegeplätze draußen.</p>
    <div class="table-wrap"><table class="data mw-imp-table"><thead><tr><th>Kunde im Werkzeug</th><th class="num">Liegeplätze</th><th>Kunde in der Fakturierung</th><th>Vorschlag</th></tr></thead><tbody>${custRows}</tbody></table></div>
    ${missingCust.length ? `<button class="btn small" data-action="mw-imp-new-customers">${ICON.plus} ${plural(missingCust.length, 'fehlenden Kunden', 'fehlende Kunden')} neu anlegen</button>` : ''}</section>`

  // 2. Objekte
  const objRows = plan.objects
    .map((r) => {
      const list = [['neu', `+ neu anlegen: ${r.newName}`], ...objects.map((o) => [o.id, o.address ? `${o.name} – ${o.address}` : o.name])]
      return `<tr><td><strong>${esc(r.address || 'ohne Adresse')}</strong></td><td>${esc(r.customerName)}</td><td class="num">${r.count}</td>
        <td><select data-change="mw-imp-choice" data-kind="objects" data-key="${esc(r.key)}" aria-label="Objekt für ${esc(r.address)}">${options(list, r.choice)}</select>${r.conflict ? `<br><small class="muted">Das Objekt gehört in der Fakturierung zu ${esc(r.conflict)}; die Zuordnung dort bleibt.</small>` : ''}</td>
        <td>${r.suggestion ? `<span class="pill ok">${esc(r.suggestion.how)}</span>` : '<span class="pill info">neu</span>'}</td></tr>`
    })
    .join('')
  const objSection = `<section class="mw-block"><h3>2. Objekte</h3><p class="muted">Liegeplätze desselben Kunden an derselben Adresse werden ein Objekt. Vorhandene App-Objekte mit dieser Adresse werden wiederverwendet, sonst neu angelegt und dem Kunden zugeordnet.</p>
    <div class="table-wrap"><table class="data mw-imp-table"><thead><tr><th>Adresse</th><th>Kunde</th><th class="num">Liegeplätze</th><th>Objekt in der App</th><th>Vorschlag</th></tr></thead><tbody>${objRows}</tbody></table></div></section>`

  // 3. Mattentypen
  const matRows = plan.mats
    .map((r) => `<tr><td>${esc(r.groesse || 'ohne Größe')}</td><td>${esc(r.farbe || 'ohne Farbe')}</td><td class="num">${r.qty}</td><td class="num">${r.count}</td>
      <td><select data-change="mw-imp-choice" data-kind="mats" data-key="${esc(r.key)}" aria-label="Mattentyp für ${esc([r.groesse, r.farbe].join(' '))}">${options(types.map((a) => [a.id, typeLabel(a)]), r.choice, { empty: '– Mattentyp fehlt –' })}</select></td>
      <td>${r.choice ? `<span class="pill ok">${esc(r.suggestion && r.suggestion.id === r.choice ? r.suggestion.how : 'von Hand')}</span>` : '<span class="pill warning">fehlt</span>'}</td></tr>`)
    .join('')
  const missingTypes = plan.missingTypes.length
    ? `<div class="banner warn-banner"><p><strong>${plural(plan.missingTypes.length, 'Mattentyp fehlt', 'Mattentypen fehlen')}:</strong> ${esc(plan.missingTypes.map((r) => [r.groesse, r.farbe].filter(Boolean).join(' ')).join(' · '))}. Diese Matten kommen mit Größe und Farbe herüber und stehen als „Mattentyp fehlt“ in der Liste. Nach dem Anlegen in der Fakturierung (Artikelgruppe „Matten“) die Übernahme noch einmal ausführen: sie trägt die Typen nach.</p>${app.access?.sees?.('fakturierung') !== false ? '<button class="btn small" data-action="mw-types-goto">Mattentypen in der Fakturierung</button>' : ''}</div>`
    : ''
  const matSection = `<section class="mw-block"><h3>3. Mattentypen</h3>${missingTypes}
    <div class="table-wrap"><table class="data mw-imp-table"><thead><tr><th>Größe</th><th>Farbe</th><th class="num">Stück</th><th class="num">Liegeplätze</th><th>Mattentyp</th><th>Zuordnung</th></tr></thead><tbody>${matRows}</tbody></table></div></section>`

  // 4. Liegeplätze im Einzelnen
  const ACTION = { neu: ['info', 'neu'], aktualisieren: ['warning', 'aktualisieren'], gleich: ['ok', 'schon übernommen'], 'ohne-kunde': ['na', 'ohne Kunde'] }
  const detail = plan.rows
    .map((r) => {
      const s = r.standort
      const [cls, label] = ACTION[r.action]
      const why = r.action === 'aktualisieren' ? [r.newer ? 'jüngerer Wechsel' : '', r.fill ? 'Mattentyp nachgetragen' : ''].filter(Boolean).join(', ') : ''
      return `<tr><td>${esc(s.id)}</td><td><strong>${esc(s.position || 'Liegeplatz')}</strong>${s.pruefen ? ' <span class="pill warning">zu prüfen</span>' : ''}${s.aktiv === false ? ' <span class="pill na">inaktiv</span>' : ''}</td><td>${esc(s.kunde || '')}</td><td>${esc([s.strasse, [s.plz, s.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</td>
        <td>${esc((s.matten || []).map((m) => `${m.anzahl || 0}× ${[m.groesse, m.farbe].filter(Boolean).join(' ')}${m.eigentum === 'kunde' ? ' (Kunde)' : ''}`).join(' · '))}</td><td>${esc(intervalText((Number(s.intervallWochen) || 4) * 7))}</td>
        <td>${r.last ? esc(short(r.last.date)) : '<span class="muted">keiner</span>'}</td><td><span class="pill ${cls}">${esc(label)}</span>${why ? `<br><span class="muted">${esc(why)}</span>` : ''}</td></tr>`
    })
    .join('')
  const detailSection = `<details class="mw-block mw-imp-detail"><summary><strong>4. Liegeplätze im Einzelnen (${plan.rows.length})</strong></summary>
    <div class="table-wrap"><table class="data mw-imp-table"><thead><tr><th>Nr.</th><th>Liegeplatz</th><th>Kunde</th><th>Adresse</th><th>Matten</th><th>Intervall</th><th>letzter Wechsel</th><th>Ergebnis</th></tr></thead><tbody>${detail}</tbody></table></div></details>`

  const confirm = app.ui.confirm === 'mw-imp-run'
  const run = plan.changes
    ? `<div class="mw-imp-run"><button class="btn primary" data-action="mw-imp-run">${confirm ? 'Wirklich übernehmen?' : `Übernehmen: ${plural(c.neu, 'Liegeplatz', 'Liegeplätze')} neu${c.aktualisieren ? `, ${c.aktualisieren} aktualisieren` : ''}`}</button>
        <span class="muted">${[c.neueKunden ? plural(c.neueKunden, 'neuer Kunde', 'neue Kunden') : '', c.neueObjekte ? plural(c.neueObjekte, 'neues Objekt', 'neue Objekte') : '', c.neueGebiete ? plural(c.neueGebiete, 'neues Gebiet', 'neue Gebiete') : '', c.pruefen ? `${c.pruefen} zu prüfen` : '', c.ohneTyp ? `${c.ohneTyp} mit fehlendem Mattentyp` : ''].filter(Boolean).join(' · ')}</span></div>`
    : `<p class="banner"><strong>Nichts zu übernehmen:</strong> ${c.gleich ? 'alle Liegeplätze mit Kunde sind schon übernommen, ein weiterer Lauf ändert nichts.' : 'keine Liegeplätze mit zugeordnetem Kunden.'}</p>`
  return `<section class="mw-imp">${source}${result}${tiles}${custSection}${objSection}${matSection}${detailSection}${run}</section>`
}

// ---------------------------------------------------------------- Aktionen

registerActions(
  {
    'mw-imp-read': async () => {
      const store = sp()
      if (!store) return toast('Im Browser-Modus bitte die Dateien des Werkzeugs wählen.')
      const st = S()
      if (st.busy) return
      st.busy = 'Sicherung …'
      renderNow()
      try {
        const res = await readFromSharePoint(store, (t) => {
          st.busy = t
          renderNow()
        })
        Object.assign(st, res, { result: null })
        toast(`Gesichert und gelesen: ${plural(res.tool.standorte.length, 'Liegeplatz', 'Liegeplätze')}, ${plural(res.tool.touren.length, 'Tour', 'Touren')}.`)
      } catch (err) {
        toast(`Übernahme abgebrochen (nichts geändert): ${err.message}`)
      } finally {
        st.busy = ''
        renderNow()
      }
    },
    'mw-imp-files': async (el) => {
      const files = [...(el.files || [])]
      if (!files.length) return
      const read = []
      for (const f of files) {
        try {
          read.push({ name: f.name, json: parse(await f.text()) })
        } catch {
          toast(`${f.name}: keine lesbare JSON-Datei.`)
        }
      }
      const tool = toolDataFromFiles(read)
      if (!tool.standorte.length) return toast('Keine Liegeplätze gefunden: bitte Standorte.json oder die Sicherung des Werkzeugs („Alles sichern“) wählen.')
      Object.assign(S(), { tool, files: { tours: tool.touren.length, broken: [] }, backup: null, result: null })
      renderNow()
    },
    'mw-imp-reset': () => {
      const st = S()
      Object.assign(st, { tool: null, files: null, backup: null, result: null })
      renderNow()
    },
    'mw-imp-choice': (el) => {
      const st = S()
      st.choices[el.dataset.kind] ||= {}
      st.choices[el.dataset.kind][el.dataset.key] = el.value
      st.result = null
      renderNow()
    },
    // fehlende Kunden: erst auf Klick anlegen
    'mw-imp-new-customers': () => {
      const st = S()
      for (const r of currentPlan().customers) if (!r.choice && !r.suggestion) st.choices.customers[r.key] = 'neu'
      renderNow()
    },
    'mw-imp-run': () => {
      const st = S()
      const plan = currentPlan()
      if (!plan.changes) return toast('Nichts zu ändern: alles ist schon übernommen.')
      if (!confirmStep('mw-imp-run')) return
      const fak = fakData()
      if (!fak) return toast('Die Fakturierung ist nicht geladen (Kunden). Bitte später noch einmal.')
      const res = applyImport(plan, { doc: doc(), customers: fak.customers || [], objects: app.data.objects || [], articles: fak.articles || [], newId: uid, now: new Date().toISOString(), user: app.user?.name || 'Browser' })
      app.data.matten = res.doc
      if (res.summary.objects) app.data.objects = res.objects
      if (res.summary.customers || res.summary.links) fak.customers = res.customers
      st.result = res.summary
      persist()
      renderNow()
      toast(`Übernommen: ${plural(res.summary.placements, 'Liegeplatz', 'Liegeplätze')} neu, ${res.summary.updated} aktualisiert.`)
    },
  },
  { edit: '*' },
)
