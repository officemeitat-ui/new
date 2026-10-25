// Übernahme aus den bisherigen Werkzeugen (Wasserzähler-Ablesung,
// Prüfprotokoll, Objektdokumentation). Mit SharePoint werden deren Ordner in
// der Bibliothek direkt gelesen, sonst die gewählten JSON-Dateien. Vorher
// steht da, was übernommen wird; ein zweiter Abgleich verdoppelt nichts.

import { classifyLegacy, LEGACY_SOURCES, planLegacyImport, scanLegacy } from '../../core/legacy.js'
import { app, canEdit, closeModal, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { esc, ICON, modalFrame } from '../shared.js'

/** „1 Kunde“, „3 Kunden“ */
const n = (count, one, many) => `${count} ${count === 1 ? one : many}`

const sources = () => ({ ...LEGACY_SOURCES, ...(app.config.sharepoint?.sources || {}) })
const isSharePoint = () => app.store?.kind === 'sharepoint'

function current() {
  return { objects: app.data.objects, mappe: app.data.mappe, kontrolle: app.data.kontrolle, zaehler: app.data.zaehler }
}

const plan = (found) => planLegacyImport(found, current(), { checklistId: app.data.kontrolle?.checklists?.[0]?.id || 'objektkontrolle', photoUrl: (p) => app.store?.rootUrl?.(p) || null })

/** Was die Rolle übernehmen darf (fehlende Rechte werden genannt, nicht still übergangen). */
function allowed() {
  return { zaehler: canEdit('zaehler'), kontrolle: canEdit('kontrolle'), mappe: canEdit('objektmappe'), objects: canEdit('stammdaten') }
}

function legacyModal(c, m) {
  const src = sources()
  const found = m.found
  const p = found ? plan(found) : null
  const may = allowed()
  const rows = p
    ? [
        ['Zählerstände', found.water.length ? `${n(found.water.length, 'Jahresliste', 'Jahreslisten')} → ${n(p.stats.water.meters, 'neue Zählstelle', 'neue Zählstellen')}, ${n(p.stats.water.readings, 'neue Ablesung', 'neue Ablesungen')}, ${n(p.stats.water.photos, 'Foto', 'Fotos')}` : 'keine Jahreslisten', may.zaehler, found.water.length],
        ['Kundenstamm', found.customers.length ? n(found.customers.length, 'Kunde', 'Kunden') : 'keiner gefunden', may.mappe, found.customers.length],
        ['Objekte der Objektkontrolle', found.objects.length ? `${n(found.objects.length, 'Objekt', 'Objekte')} (Kunde, Nummer, E-Mail Hausverwaltung)` : 'keine', may.mappe, found.objects.length],
        ['Kontrollen', found.inspections.length ? `${n(found.inspections.length, 'Protokoll', 'Protokolle')} mit Fotos und Unterschriften` : 'keine', may.kontrolle, found.inspections.length],
        ['Objektakten', found.akten.length ? `${n(found.akten.length, 'Akte', 'Akten')} (Leistungsverzeichnis, Kontakte, Zugang, Fotos, Verlauf)` : 'keine', may.mappe, found.akten.length],
        ['Bereichsvorlagen', found.templates.length ? n(found.templates.length, 'Vorlage', 'Vorlagen') : 'keine', may.mappe, found.templates.length],
      ]
    : []
  const blocked = p && p.objects.length && !may.objects
  return modalFrame({
    title: 'Aus den bisherigen Werkzeugen übernehmen',
    subtitle: 'Wasserzähler-Ablesung, Prüfprotokoll (Objektkontrolle), Objektdokumentation',
    wide: true,
    body: `${isSharePoint()
      ? `<section><h3>Direkt aus SharePoint</h3><p class="note">Gesucht wird in derselben Bibliothek: „${esc(src.wasserzaehler)}“, „${esc(src.pruefprotokoll)}“, „${esc(src.objektdoku)}“ und „Stammdaten“. Die Werkzeuge können parallel weiterlaufen: ein neuer Abgleich übernimmt nur Neues und ersetzt Geändertes.</p>
          <button class="btn primary" data-action="legacy-scan" ${m.scanning ? 'disabled' : ''}>${ICON.search} ${m.scanning ? `Suche … ${m.progress || ''}` : 'In SharePoint suchen'}</button></section>`
      : '<p class="note">Im Browser-Modus die JSON-Dateien wählen (aus SharePoint heruntergeladen oder Sicherungen der Werkzeuge). Mit SharePoint sucht die App die Ordner selbst.</p>'}
      <section><h3>${isSharePoint() ? 'Oder Dateien wählen' : 'Dateien wählen'}</h3><input type="file" accept=".json,application/json" multiple data-change="legacy-files"></section>
      ${m.error ? `<p class="check error">${esc(m.error)}</p>` : ''}
      ${p ? `<section><h3>Gefunden${m.files ? ` in ${n(m.files, 'Datei', 'Dateien')}` : ''}</h3><div class="table-wrap"><table class="data"><thead><tr><th>Bereich</th><th>Übernahme</th><th>Recht</th></tr></thead><tbody>${rows
          .map(([label, text, ok, n]) => `<tr><td><strong>${label}</strong></td><td>${esc(text)}</td><td>${n ? (ok ? '<span class="pill ok">wird übernommen</span>' : '<span class="pill warning">kein Schreibrecht</span>') : ''}</td></tr>`)
          .join('')}</tbody></table></div>
        ${p.objects.length ? `<p class="note">${p.objects.length === 1 ? '1 Objekt gibt es im Dienstplan noch nicht und wird' : `${p.objects.length} Objekte gibt es im Dienstplan noch nicht und werden`} angelegt: ${esc(p.objects.slice(0, 8).map((o) => o.name).join(', '))}${p.objects.length > 8 ? ' …' : ''}. Danach bei Bedarf unter „Objekte &amp; Leistungen“ zusammenführen oder umbenennen.</p>` : ''}
        ${found.unknown.length ? `<p class="note">${n(found.unknown.length, 'Datei', 'Dateien')} nicht erkannt (übersprungen).</p>` : ''}
        ${blocked ? '<p class="check error">Für neue Objekte braucht es das Recht „Stammdaten“ (Disposition). Bitte die Disposition, die Übernahme zu starten.</p>' : ''}</section>` : ''}`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions"><button class="btn primary" data-action="legacy-apply" ${p && !blocked && rows.some(([, , ok, n]) => ok && n) ? '' : 'disabled'}>Übernehmen</button></div>`,
  })
}

registerModal('legacy', legacyModal)

registerActions({
  'legacy-open': () => openModal({ type: 'legacy' }),
  'legacy-scan': async () => {
    const m = app.ui.modal
    m.scanning = true
    m.error = null
    renderModal()
    try {
      const res = await scanLegacy(app.store, sources(), {
        onProgress: (done, total) => {
          m.progress = `${done}/${total}`
          const btn = document.querySelector('[data-action="legacy-scan"]')
          if (btn) btn.textContent = `Suche … ${m.progress}`
        },
      })
      m.found = classifyLegacy(res.files)
      m.files = res.files.length
      if (!res.files.length) m.error = 'In diesen Ordnern wurde nichts gefunden (oder dein Konto hat keinen Zugriff). Ordnernamen in config.json → sharepoint.sources prüfen.'
    } catch (err) {
      m.error = `SharePoint konnte nicht gelesen werden: ${err.message}`
    }
    m.scanning = false
    renderModal()
  },
  'legacy-files': async (el) => {
    const m = app.ui.modal
    const files = []
    for (const f of el.files || []) {
      try {
        files.push({ path: f.name, data: JSON.parse((await f.text()).replace(/^﻿/, '')) })
      } catch {
        m.error = `„${f.name}“ ist kein gültiges JSON.`
      }
    }
    m.found = classifyLegacy(files)
    m.files = files.length
    renderModal()
  },
  'legacy-apply': () => {
    const m = app.ui.modal
    if (!m.found) return
    const may = allowed()
    const p = plan(m.found)
    if (p.objects.length) {
      if (!may.objects) return toast('Für neue Objekte braucht es das Recht „Stammdaten“.')
      app.data.objects.push(...p.objects)
    }
    const done = []
    if (may.zaehler && m.found.water.length) {
      app.data.zaehler = p.zaehler
      done.push(`${n(p.stats.water.meters, 'Zählstelle', 'Zählstellen')}, ${n(p.stats.water.readings, 'Ablesung', 'Ablesungen')} neu`)
    }
    if (may.kontrolle && m.found.inspections.length) {
      app.data.kontrolle = p.kontrolle
      done.push(n(p.stats.inspections, 'Kontrolle', 'Kontrollen'))
    }
    if (may.mappe && (m.found.customers.length || m.found.objects.length || m.found.akten.length || m.found.templates.length)) {
      app.data.mappe = p.mappe
      done.push([m.found.customers.length ? n(m.found.customers.length, 'Kunde', 'Kunden') : '', p.stats.akten ? n(p.stats.akten, 'Akte', 'Akten') : '', p.stats.objects ? `Objektdaten zu ${n(p.stats.objects, 'Objekt', 'Objekten')}` : ''].filter(Boolean).join(', '))
    }
    persist()
    closeModal()
    renderNow()
    toast(`Übernommen: ${done.filter(Boolean).join(' · ') || 'nichts Neues'}${p.objects.length ? ` · ${n(p.objects.length, 'Objekt', 'Objekte')} angelegt` : ''}.`)
  },
})
