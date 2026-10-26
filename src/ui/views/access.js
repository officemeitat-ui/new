// Berechtigungen: welche Microsoft-Gruppe welche Bereiche sieht und welche
// Rechte sie dafür in SharePoint braucht. Nur zur Ansicht – eingestellt wird
// in Entra ID (Gruppen, App-Rollen) und in config.production.json
// (access.groups); die Tabelle kommt aus denselben Regeln, nach denen die App
// liest und speichert (dataRights).

import { DEFAULT_ROLES, MODULES, resolveAccess } from '../../core/access.js'
import { folderRights } from '../../storage/data-service.js'
import { app, registerView } from '../context.js'
import { esc } from '../shared.js'

const list = (v) => (v === '*' ? 'alles' : (v || []).map((m) => MODULES[m] || m).join(', ') || '–')

function accessView() {
  const access = app.config.access || {}
  const roles = { ...DEFAULT_ROLES, ...(access.roles || {}) }
  const groups = access.groups || {}
  const people = (id) => [...(id === 'disposition' ? access.planners || [] : []), ...(access.members?.[id] || [])]
  const used = Object.keys(roles).filter((id) => (groups[id] || []).length || people(id).length || ['disposition', 'objektmanagement', 'vorarbeiter'].includes(id))
  const roleAccess = Object.fromEntries(used.map((id) => [id, resolveAccess({ preview: id, access })]))
  const folders = folderRights(roleAccess[used[0]]).map(([folder, label]) => [folder, label])
  const ids = (id) => [groups[id] || []].flat().filter(Boolean)
  const me = app.user
  return `<div class="view-head"><h2>Berechtigungen</h2><p class="muted">Wer was sieht, richtet die IT über Microsoft-Gruppen ein. Die App liest nur die Ordner, die eine Gruppe braucht; die Rechte in SharePoint sichern die Daten zusätzlich ab, auch außerhalb der App.</p></div>
  <section class="table-wrap"><table class="data">
    <thead><tr><th>Rolle</th><th>Microsoft-Gruppe (Objekt-ID)</th><th>sieht</th><th>darf ändern</th></tr></thead>
    <tbody>${used
      .map((id) => {
        const r = roles[id]
        const g = ids(id)
        const p = people(id)
        return `<tr><td><strong>${esc(r.label)}</strong><br><span class="muted">${esc(id)}</span></td>
          <td>${g.length ? g.map((x) => `<code>${esc(x)}</code>`).join('<br>') : '<span class="muted">noch keine Gruppe eingetragen</span>'}${p.length ? `<br><span class="muted">dazu: ${esc(p.join(', '))}</span>` : ''}</td>
          <td>${esc(list(r.modules))}</td><td>${esc(list(r.edit))}</td></tr>`
      })
      .join('')}</tbody></table></section>
  <section class="table-wrap"><h3>Rechte in SharePoint je Ordner</h3><p class="muted">Bibliothek ${esc(app.config.sharepoint?.library || '')}, Ordner ${esc(app.config.sharepoint?.folder || '')}. Jeden Ordner nur für diese Gruppen freigeben (Vererbung beenden).</p><table class="data">
    <thead><tr><th>Ordner</th><th>Inhalt</th>${used.map((id) => `<th>${esc(roles[id].label)}</th>`).join('')}</tr></thead>
    <tbody>${folders
      .map(([folder, label], i) => `<tr><td><code>${esc(folder)}/</code></td><td>${esc(label)}</td>${used.map((id) => `<td>${esc(folderRights(roleAccess[id])[i][2] || '–')}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></section>
  ${me ? `<section class="banner"><p><strong>Deine Anmeldung:</strong> ${esc(me.name)} (${esc(me.email)}) · ${esc(app.access?.label || '')}<br>Gruppen im Microsoft-Konto: ${(me.groups || []).length ? me.groups.map((g) => `<code>${esc(g)}</code>`).join(' ') : 'keine übermittelt'}</p></section>` : ''}
  <p class="note">Gruppen eintragen: in <code>config.production.json</code> unter <code>access.groups</code> je Rolle die Objekt-ID der Microsoft-Gruppe, oder in Entra ID der Gruppe die App-Rolle zuweisen. Schritt für Schritt in docs/EINRICHTUNG.md.</p>`
}

registerView({ id: 'berechtigungen', order: 120, label: 'Berechtigungen', group: 'stamm', module: 'stammdaten', noWeek: true, render: accessView })
