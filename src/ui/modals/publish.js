// Veröffentlichen-Dialog: Prüfung, Änderungen seit der letzten
// Veröffentlichung, Änderungsmitteilungen, Protokoll.

import { isoWeek } from '../../core/dates.js'
import { app, closeModal, openModal, registerActions, registerModal, toast } from '../context.js'
import { changedEmployees, changeMessage, publishWeek } from '../planning.js'
import { esc, ICON, modalFrame } from '../shared.js'
import { copyText } from '../views/sheet.js'

function publishModal(c) {
  const kw = isoWeek(c.monday).week
  const p = c.published
  const errors = c.validation.issues.filter((i) => i.severity === 'error')
  const changed = changedEmployees(c)
  const log = [...(app.data.logs?.[c.monday] || [])].reverse().slice(0, 40)
  const where = app.store.kind === 'sharepoint' ? 'in SharePoint (Ordner exporte)' : 'als Download'
  return modalFrame({
    title: `KW ${kw} veröffentlichen`,
    subtitle: p ? `Zuletzt veröffentlicht am ${new Date(p.publishedAt).toLocaleString('de-AT')} von ${esc(p.publishedBy)}` : 'Noch nicht veröffentlicht (Entwurf)',
    body: `
      <section><h3>Prüfung</h3>${
        errors.length
          ? `<p><span class="pill error">${errors.length} Verstöße</span> Bitte vorher im Prüfbericht ansehen. Veröffentlichen ist trotzdem möglich.</p>`
          : '<p><span class="pill ok">Keine Verstöße</span></p>'
      }</section>
      <section><h3>Was passiert</h3><ul class="plain">
        <li>Die Salden aller ${c.ctx.employees.length} Personen werden ins Zeitkonto übernommen.</li>
        ${app.config.features.excel ? `<li>Wochenpläne als Excel ${where}: eine Gesamtdatei${app.store.kind === 'sharepoint' ? ' und eine Datei je Person' : ''}.</li>` : ''}
        <li>Spätere Änderungen werden in der Wochenübersicht mit <span class="pill warning">geändert</span> markiert.</li>
      </ul></section>
      ${
        changed.length
          ? `<section><h3>Seit der letzten Veröffentlichung geändert (${changed.length})</h3><p class="note">Diese Personen informieren. Text kopieren und per Teams, SMS oder WhatsApp senden.</p>
        ${changed.map((e) => `<div class="person"><div class="pname">${esc(e.name)}<small>${esc(e.team || '')}</small></div><pre class="msg" id="msg-${esc(e.id)}">${esc(changeMessage(c, e))}</pre><div class="acts"><button class="btn small" data-action="copy-msg" data-emp="${esc(e.id)}">${ICON.copy} Kopieren</button></div></div>`).join('')}</section>`
          : ''
      }
      ${p?.files ? `<p><a href="${esc(p.files)}" target="_blank" rel="noopener">Exportordner in SharePoint öffnen</a></p>` : ''}
      <details><summary>Änderungsprotokoll dieser Woche (${(app.data.logs?.[c.monday] || []).length})</summary>
        ${log.length ? `<ul class="plain log">${log.map((l) => `<li><span class="muted">${new Date(l.at).toLocaleString('de-AT')} · ${esc(l.by)}</span> ${esc(l.text)}</li>`).join('')}</ul>` : '<p class="note">Noch keine Einträge.</p>'}
      </details>`,
    foot: `<span></span><div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary edit-only" data-action="publish-run">${ICON.send} ${p ? 'Erneut veröffentlichen' : 'Veröffentlichen'}</button></div>`,
  })
}

registerModal('publish', publishModal)

registerActions({
  'open-publish': () => openModal({ type: 'publish' }),
  'copy-msg': (el) => {
    const pre = document.getElementById(`msg-${el.dataset.emp}`)
    if (pre) copyText(pre.textContent)
  },
})

registerActions(
  {
    'publish-run': async (el) => {
      el.disabled = true
      el.textContent = 'Wird veröffentlicht …'
      try {
        const res = await publishWeek()
        closeModal()
        toast(`Veröffentlicht. ${res.files ? `${res.files} Excel-Dateien erstellt.` : ''}`)
      } catch (err) {
        el.disabled = false
        toast(`Veröffentlichen fehlgeschlagen: ${err.message}`)
      }
    },
  },
  { edit: true },
)
