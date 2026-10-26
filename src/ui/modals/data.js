// Daten-Dialog: Ablageort, Datensicherung (JSON), Einspielen, Beispieldaten.

import { createDemoData } from '../../data/demo.js'
import { MODULE_DOCS } from '../../storage/data-service.js'
import { app, closeModal, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { seedDemoHistory } from '../planning.js'
import { download, esc, ICON, modalFrame, val } from '../shared.js'
import { copyText } from '../views/sheet.js'

const BACKUP_KEYS = ['version', 'employees', 'objects', 'tasks', 'skills', 'rules', 'extraFreeDays', 'travel', 'settings', 'absences', 'assignments', 'overrides', 'trips', 'published', 'payroll', 'logs', ...Object.keys(MODULE_DOCS)]

function backup() {
  return JSON.stringify(Object.fromEntries(BACKUP_KEYS.map((k) => [k, app.data[k]])), null, 1)
}

function dataModal() {
  const s = app.store
  const confirmReset = app.ui.confirm === 'reset'
  return modalFrame({
    title: 'Daten & Ablage',
    body: `<section><h3>Ablage</h3>
        <p>${s.kind === 'sharepoint' ? `Gespeichert in <strong>${esc(s.label)}</strong>. SharePoint führt für jede Datei einen Versionsverlauf.${s.webUrl ? ` <a href="${esc(s.webUrl)}" target="_blank" rel="noopener">Ordner öffnen</a>` : ''}` : `Gespeichert in <strong>diesem Browser</strong>${s.persistent ? '' : ' (nur bis zum Schließen, der Browser blockiert die Speicherung)'}. Für den Echtbetrieb in <code>config.json</code> auf SharePoint umstellen.`}</p>
        <p class="note">Dateien: daten/stammdaten.json, daten/abwesenheiten.json, daten/zeitkonto.json, daten/plaene/JJJJ/Woche.json, ${Object.values(MODULE_DOCS).map((m) => m.path).join(', ')}, exporte/…</p>
        ${app.service.denied?.size ? `<p class="note">Ohne Leserecht (bleibt leer, wird nicht gespeichert): ${esc([...app.service.denied].join(', '))}</p>` : ''}</section>
      <section><h3>Bisherige Werkzeuge</h3><p class="note">Wasserzähler-Ablesung, Prüfprotokoll und Objektdokumentation: Daten aus deren SharePoint-Ordnern übernehmen (wiederholbar, nichts doppelt).</p><button class="btn" data-action="legacy-open">${ICON.upload} Übernehmen</button></section>
      <section><h3>Datensicherung</h3><p class="note">Alle geladenen Daten als JSON (Stammdaten, Abwesenheiten, Zeitkonto, Zähler, Kontrollen, Objektmappe und die gerade geladenen Wochen).</p>
        <div class="actions">${app.config.features.download ? `<button class="btn" data-action="backup-download">${ICON.sheet} Herunterladen</button>` : ''}<button class="btn" data-action="backup-copy">${ICON.copy} Kopieren</button></div></section>
      <section class="edit-only"><h3>Daten einspielen</h3><p class="note">Eine Datensicherung einfügen oder als Datei wählen. Vorhandene Daten werden ersetzt; geladene Wochen werden überschrieben.</p>
        <input type="file" id="import-file" accept=".json,application/json">
        <textarea id="import-json" rows="4" placeholder="JSON hier einfügen"></textarea>
        <div class="actions"><button class="btn" data-action="backup-restore">Daten übernehmen</button>
        <button class="btn ${confirmReset ? 'danger confirm' : 'danger'}" data-action="reset-demo">${confirmReset ? 'Wirklich alles durch Beispieldaten ersetzen?' : 'Beispieldaten laden'}</button></div></section>`,
  })
}

registerModal('data', dataModal, { module: '*' })

registerActions({
  'open-data': () => openModal({ type: 'data' }),
  'backup-copy': () => copyText(backup()),
  'backup-download': () => download(`dienstplan-sicherung-${new Date().toISOString().slice(0, 10)}.json`, new Blob([backup()], { type: 'application/json' })),
})

registerActions(
  {
    'backup-restore': async () => {
      let text = val('import-json').trim()
      const file = document.getElementById('import-file')?.files?.[0]
      if (!text && file) text = await file.text()
      try {
        const parsed = JSON.parse(text)
        if (!Array.isArray(parsed.employees) || !Array.isArray(parsed.objects) || !Array.isArray(parsed.tasks)) throw new Error('format')
        for (const k of BACKUP_KEYS) if (parsed[k] !== undefined) app.data[k] = parsed[k]
        persist()
        closeModal()
        renderNow()
        toast('Daten übernommen.')
      } catch {
        toast('Das ist keine gültige Datensicherung. Bitte den kompletten JSON-Text einfügen.')
      }
    },
    'reset-demo': async () => {
      if (app.ui.confirm !== 'reset') {
        app.ui.confirm = 'reset'
        return renderModal()
      }
      const demo = createDemoData(app.ui.monday)
      for (const k of BACKUP_KEYS) app.data[k] = demo[k] ?? (k === 'published' || k === 'logs' ? {} : app.data[k])
      app.data.published = {}
      app.data.logs = {}
      delete app.data.payroll
      closeModal()
      await seedDemoHistory()
      renderNow()
      toast('Beispieldaten geladen: 4 veröffentlichte Wochen und die aktuelle Woche eingeteilt.')
    },
  },
  { edit: '*' },
)
