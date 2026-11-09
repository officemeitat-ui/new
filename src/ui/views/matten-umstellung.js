// Mattenwechsel P16: Umstellung vom Werkzeug auf das Modul (nur Vollzugriff), jederzeit zurücknehmbar.
// Nach der Umstellung (matten.json → settings.cutover { at, by }):
//  - #matten (Lesezeichen, Startbildschirm, Links) öffnet das Modul (views/tools.js, VIEW_REDIRECTS),
//  - das Werkzeug heißt „Mattenwechsel (alt)“ und ist nur lesend: werkzeuge/bruecke.js sperrt das Schreiben nach
//    SharePoint (im Rahmen der App und im eigenen Fenster auf Geräten, auf denen die App die Umstellung gesehen hat),
//  - frühere Touren und Lieferscheine des Werkzeugs bleiben unverändert in SharePoint und im Werkzeug zu sehen.
// Kurzname: mwc-
import { emptyMatten, upgradeMatten } from '../../core/matten.js'
import { app, closeModal, confirmStep, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { esc, modalFrame } from '../shared.js'

const MODULE = 'matten'
const ALT_KEY = 'cleanos-app.matten-alt'
const mdoc = () => upgradeMatten((app.data.matten ||= emptyMatten()))
/** Umstellen darf nur Vollzugriff (Einstellungen für alle); im Browser-Modus ohne Rechte jeder. */
const mayCutover = () => !app.access || !!app.access.all
export const cutoverOf = () => mdoc().settings?.cutover?.at ? mdoc().settings.cutover : null

/** Stand vor dem Umstellen: was schon im Modul eingerichtet ist (Hinweise, kein Hindernis). */
export function readiness(doc = mdoc()) {
  const s = doc.settings || {}
  const active = (doc.placements || []).filter((p) => p.active !== false)
  return [
    { ok: active.length > 0, text: active.length ? `${active.length} Liegeplätze im Modul` : 'Noch keine Liegeplätze im Modul (Übernahme aus dem Werkzeug oder neu anlegen)' },
    { ok: active.some((p) => p.legacyId), text: active.some((p) => p.legacyId) ? `Übernahme aus dem Werkzeug: ${active.filter((p) => p.legacyId).length} Liegeplätze übernommen` : 'Keine Liegeplätze aus dem Werkzeug übernommen (falls das Werkzeug Daten hat: zuerst „Übernahme aus dem Werkzeug“)' },
    { ok: (s.drivers || []).length > 0, text: (s.drivers || []).length ? `${(s.drivers || []).length} Fahrer eingerichtet` : 'Noch keine Fahrer (Touren planen → Fahrer)' },
    { ok: !!(s.depot && s.depot.lat != null), text: s.depot?.lat != null ? `Betriebshof: ${s.depot.name || 'gesetzt'}` : 'Betriebshof fehlt (Touren planen → Betriebshof)' },
    { ok: !!s.officeEmail, text: s.officeEmail ? `Büro-E-Mail für Lieferscheine: ${s.officeEmail}` : 'Büro-E-Mail für Lieferscheine fehlt (Matten-Lieferscheine → Einstellungen)' },
  ]
}

function remember(at) {
  try {
    if (at) localStorage.setItem(ALT_KEY, at)
    else localStorage.removeItem(ALT_KEY)
  } catch {
    /* Speicher gesperrt */
  }
}

function cutoverModal() {
  const c = cutoverOf()
  const list = readiness()
    .map((r) => `<li class="${r.ok ? 'ok' : 'warn'}"><span class="pill ${r.ok ? 'ok' : 'warning'}">${r.ok ? 'erledigt' : 'offen'}</span> ${esc(r.text)}</li>`)
    .join('')
  const when = c ? new Date(c.at).toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' }) : ''
  const body = c
    ? `<p><strong>Umgestellt am ${esc(when)}${c.by ? ` von ${esc(c.by)}` : ''}.</strong> „Mattenwechsel“ (auch Lesezeichen mit #matten) öffnet das Modul. Das Werkzeug heißt „Mattenwechsel (alt)“ und ist nur zum Nachschlagen da: Es speichert nichts mehr in SharePoint.</p>
       <p class="note">Zurücknehmen macht das Werkzeug wieder voll nutzbar (Parallelbetrieb). Daten gehen dabei nicht verloren: Das Modul und das Werkzeug haben eigene Dateien.</p>`
    : `<p>Bis jetzt laufen Werkzeug und Modul parallel. Mit der Umstellung wird das Modul der eine Weg für den Mattenwechsel:</p>
       <ul class="mwc-effects">
         <li>„Mattenwechsel“ und Lesezeichen mit #matten öffnen das Modul.</li>
         <li>Das Werkzeug heißt „Mattenwechsel (alt)“ und ist nur lesend: frühere Touren und Lieferscheine bleiben sichtbar, neue Einträge speichert es nicht mehr.</li>
         <li>Nichts wird gelöscht oder verschoben; die Umstellung lässt sich jederzeit zurücknehmen.</li>
       </ul>
       <p class="note">Vorher die Fahrer und das Büro informieren: Touren laufen dann nur noch über „Matten-Touren“.</p>`
  return modalFrame({
    title: 'Umstellung auf das Mattenwechsel-Modul',
    subtitle: c ? 'umgestellt' : 'Parallelbetrieb',
    body: `${body}<h3>Stand im Modul</h3><ul class="mwc-ready">${list}</ul>`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">${
      !mayCutover()
        ? '<span class="muted">Umstellen darf nur Vollzugriff.</span>'
        : c
          ? '<button class="btn" data-action="mwc-undo">Umstellung zurücknehmen</button>'
          : app.ui.confirm === 'mwc-set-empty'
            ? '<span class="muted">Noch keine Liegeplätze im Modul.</span> <button class="btn danger" data-action="mwc-set">Trotzdem umstellen</button>'
            : '<button class="btn primary" data-action="mwc-set">Jetzt umstellen</button>'
    }</div>`,
  })
}
registerModal('mwc-cutover', cutoverModal, { module: MODULE })

registerActions(
  {
    'mwc-open': () => openModal({ type: 'mwc-cutover' }),
    'mwc-set': () => {
      if (!mayCutover()) return toast('Umstellen darf nur Vollzugriff.')
      if (!readiness()[0].ok && !confirmStep('mwc-set-empty', renderModal)) return
      const s = (mdoc().settings ||= {})
      s.cutover = { at: new Date().toISOString(), by: app.user?.name || '' }
      remember(s.cutover.at)
      persist()
      closeModal()
      toast('Umgestellt: „Mattenwechsel“ öffnet jetzt das Modul, das Werkzeug ist nur lesend.')
      renderNow()
    },
    'mwc-undo': () => {
      if (!mayCutover()) return toast('Zurücknehmen darf nur Vollzugriff.')
      const s = (mdoc().settings ||= {})
      delete s.cutover
      remember(null)
      persist()
      closeModal()
      toast('Umstellung zurückgenommen: Werkzeug und Modul laufen wieder parallel.')
      renderNow()
    },
  },
  { edit: MODULE },
)
