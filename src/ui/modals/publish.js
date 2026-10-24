// Veröffentlichen-Dialog: Prüfung, Änderungen seit der letzten
// Veröffentlichung, Änderungsmitteilungen, Protokoll.

import { saldoCorrections } from '../../core/attention.js'
import { isoWeek, todayISO } from '../../core/dates.js'
import { app, empName, openModal, registerActions, registerModal, toast } from '../context.js'
import { changedEmployees, changeMessage, currentSaldi, publishWeek } from '../planning.js'
import { esc, ICON, modalFrame, saldoClass, signed } from '../shared.js'
import { copyText } from '../views/sheet.js'

function publishModal(c) {
  const kw = isoWeek(c.monday).week
  const p = c.published
  const errors = c.validation.issues.filter((i) => i.severity === 'error')
  const changed = changedEmployees(c)
  const log = [...(app.data.logs?.[c.monday] || [])].reverse().slice(0, 40)
  const where = app.store.kind === 'sharepoint' ? 'in SharePoint (Ordner exporte)' : 'als Download'
  const correction = !!p && changed.length > 0
  const deltas = correction && p.saldi ? saldoCorrections(p.saldi, currentSaldi(c)) : []
  const earlier = p?.corrections || []
  const correctionSection = correction
    ? `<section><h3>Nachträgliche Änderung${c.monday <= todayISO() ? ' (rückwirkend)' : ''}</h3>${
        deltas.length
          ? `<div class="table-wrap"><table class="data"><thead><tr><th>Mitarbeiter:in</th><th>Saldo bisher</th><th>Saldo neu</th><th>Korrektur</th></tr></thead><tbody>${deltas
              .map((d) => `<tr><td>${esc(empName(d.empId))}</td><td class="num">${signed(d.before)}</td><td class="num">${signed(d.after)}</td><td class="num saldo ${saldoClass(d.delta)}"><strong>${signed(d.delta)}</strong></td></tr>`)
              .join('')}</tbody></table></div>`
          : '<p class="note">Die Salden bleiben gleich (z. B. Krankenstand nach dem Ausfallprinzip angerechnet). Geändert hat sich nur der Wochenplan.</p>'
      }</section>`
    : ''
  const earlierSection = earlier.length
    ? `<details><summary>Bisher gebuchte Korrekturen (${earlier.length})</summary><ul class="plain log">${earlier
        .map((x) => `<li><span class="muted">${new Date(x.at).toLocaleString('de-AT')} · ${esc(x.by)}</span> ${esc(empName(x.empId))}: ${signed(x.delta)} h</li>`)
        .join('')}</ul></details>`
    : ''
  return modalFrame({
    title: correction ? `KW ${kw}: Korrektur buchen` : `KW ${kw} veröffentlichen`,
    subtitle: p ? `Zuletzt veröffentlicht am ${new Date(p.publishedAt).toLocaleString('de-AT')} von ${esc(p.publishedBy)}` : 'Noch nicht veröffentlicht (Entwurf)',
    body: `
      <section><h3>Prüfung</h3>${
        errors.length
          ? `<p><span class="pill error">${errors.length} Verstöße</span> Bitte vorher im Prüfbericht ansehen. Veröffentlichen ist trotzdem möglich.</p>`
          : '<p><span class="pill ok">Keine Verstöße</span></p>'
      }</section>
      ${correctionSection}
      <section><h3>Was passiert</h3><ul class="plain">
        ${correction ? '<li>Die neuen Salden ersetzen die bisherigen im Zeitkonto. Die Unterschiede erscheinen in der Monatsauswertung unter „Nachträgliche Korrekturen“ für die Lohnverrechnung.</li>' : `<li>Die Salden aller ${c.ctx.employees.length} Personen werden ins Zeitkonto übernommen.</li>`}
        ${app.config.features.excel ? `<li>Wochenpläne als Excel ${where}: eine Gesamtdatei${app.store.kind === 'sharepoint' ? ' und eine Datei je Person' : ''}.</li>` : ''}
        ${app.config.features.pdf && app.store.kind === 'sharepoint' ? '<li>Wochenpläne als PDF in SharePoint: alle in einer Datei und je Person eine Datei (Ordner PDF).</li>' : ''}
        <li>Danach öffnet sich der Versand: PDF je Person, Teilen (z. B. WhatsApp)${app.config.features.mail && app.store.kind === 'sharepoint' ? ' oder E-Mail' : ''}.</li>
        <li>Spätere Änderungen werden in der Wochenübersicht mit <span class="pill warning">geändert</span> markiert.</li>
      </ul></section>
      ${
        changed.length
          ? `<section><h3>Seit der letzten Veröffentlichung geändert (${changed.length})</h3><p class="note">Diese Personen informieren. Text kopieren und per Teams, SMS oder WhatsApp senden.</p>
        ${changed.map((e) => `<div class="person"><div class="pname">${esc(e.name)}<small>${esc(e.team || '')}</small></div><pre class="msg" id="msg-${esc(e.id)}">${esc(changeMessage(c, e))}</pre><div class="acts"><button class="btn small" data-action="copy-msg" data-emp="${esc(e.id)}">${ICON.copy} Kopieren</button></div></div>`).join('')}</section>`
          : ''
      }
      ${earlierSection}
      ${p?.files ? `<p><a href="${esc(p.files)}" target="_blank" rel="noopener">Exportordner in SharePoint öffnen</a></p>` : ''}
      <details><summary>Änderungsprotokoll dieser Woche (${(app.data.logs?.[c.monday] || []).length})</summary>
        ${log.length ? `<ul class="plain log">${log.map((l) => `<li><span class="muted">${new Date(l.at).toLocaleString('de-AT')} · ${esc(l.by)}</span> ${esc(l.text)}</li>`).join('')}</ul>` : '<p class="note">Noch keine Einträge.</p>'}
      </details>`,
    foot: `${p ? `<button class="btn" data-action="open-send">${ICON.send} Versand an Mitarbeitende</button>` : '<span></span>'}<div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary edit-only" data-action="publish-run">${ICON.send} ${correction ? 'Korrektur buchen' : p ? 'Erneut veröffentlichen' : 'Veröffentlichen'}</button></div>`,
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
        openModal({ type: 'send' })
        toast(`${res.corrections ? `Korrektur gebucht: ${res.corrections} Saldo-Änderungen.` : 'Veröffentlicht.'} ${res.files ? `${res.files} ${res.files === 1 ? 'Datei' : 'Dateien'} erstellt.` : ''}${res.fileError ? ` Dateiexport fehlgeschlagen: ${res.fileError}` : ''}`)
      } catch (err) {
        el.disabled = false
        toast(`Veröffentlichen fehlgeschlagen: ${err.message}`)
      }
    },
  },
  { edit: true },
)
