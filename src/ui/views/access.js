// Berechtigungen: welche Microsoft-Gruppe welche Bereiche sieht und welche Rechte sie dafür in
// SharePoint braucht. Die Tabellen kommen aus denselben Regeln, nach denen die App liest und speichert
// (dataRights). Dazu für den Vollzugriff im Betrieb mit SharePoint:
//  - Gruppen je Rolle als Entwurf eintragen → fertiger Ausschnitt für config.json (access.groups)
//  - „Rechte prüfen“: echte Freigaben jedes Ordners gegen die Tabelle (core/rights-audit.js)
//  - „Abweichungen beheben“: fehlende Rechte vergeben, überzählige Freigaben entfernen – nach
//    Bestätigung je Ordner; Besitzer der Website und die eigenen Rechte bleiben immer.
//  - Reviere (core/reviere.js): je Revier eine Gruppe (access.reviere); Prüfung der Revier-Ordner der
//    Werkzeuge; alte Werkzeug-Ordner einmal in ihre Reviere verschieben (Umzug, Objektliste aufteilen).
// Aktionen und Dialoge mit dem Kürzel „acc-“.

import { todayISO } from '../../core/dates.js'
import { allRoles as rolesOf, MODULES, resolveAccess } from '../../core/access.js'
import { KONTROLLE_LIST, kontrolleRevierList, moveRows, moveTarget, REVIER_TOOLS, revierName, revierSetup, splitObjectList } from '../../core/reviere.js'
import { auditFolder, expectedRights, fixPlan, groupNames, summary } from '../../core/rights-audit.js'
import { folderRights, TOOL_FOLDERS, toolFolderRights } from '../../storage/data-service.js'
import { app, closeModal, openModal, registerActions, registerModal, registerView, renderNow, toast } from '../context.js'
import { esc, ICON, modalFrame } from '../shared.js'
import { copyText } from './sheet.js'

const list = (v) => (v === '*' ? 'alles' : (v || []).map((m) => MODULES[m] || m).join(', ') || '–')
const ids = (v) => [v || []].flat().join(',').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
const allRoles = () => rolesOf(app.config.access)
const spFolder = () => app.config.sharepoint?.folder || 'Plattform'
/** SharePoint-Ablage mit Freigaben (im Browser-Modus und ohne Netz: null). */
const sp = () => {
  const s = app.store?.remote || app.store
  return s?.kind === 'sharepoint' && typeof s.permissions === 'function' ? s : null
}
const mayAudit = () => !!(sp() && app.access?.all)
/** Vorschlag für den Gruppennamen in Entra ID: Cleanos_App_Buchhaltung … */
const UML = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' }
const groupName = (label) =>
  `Cleanos_App_${String(label)
    .replace(/\(.*?\)/g, '')
    .split(/[&/,]/)[0]
    .replace(/[äöüÄÖÜß]/g, (c) => UML[c])
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
    .replace(/[^A-Za-z0-9]/g, '')}`

/** Gruppen je Rolle: Entwurf (diese Sitzung) vor config.json. */
function groupsOf(id) {
  const draft = app.ui.accDraft?.[id]
  return draft !== undefined ? ids(draft) : ids(app.config.access?.groups?.[id])
}
const isDraft = (id) => app.ui.accDraft?.[id] !== undefined && ids(app.ui.accDraft[id]).join() !== ids(app.config.access?.groups?.[id]).join()
/** Gruppen je Revier: Entwurf vor config.json (access.reviere). → { Revier: [IDs] } */
function revierGroups() {
  const out = {}
  for (const [name, g] of Object.entries(app.config.access?.reviere || {})) out[name] = ids(g)
  for (const [name, g] of Object.entries(app.ui.accRevDraft || {})) out[name] = ids(g)
  return out
}
const revDraftChanged = () => Object.keys(app.ui.accRevDraft || {}).some((n) => ids(app.ui.accRevDraft[n]).join() !== ids(app.config.access?.reviere?.[n]).join())
const draftChanged = () => revDraftChanged() || Object.keys(app.ui.accDraft || {}).some((id) => ids(app.ui.accDraft[id]).join() !== ids(app.config.access?.groups?.[id]).join())
/** Reviere bekannt aus config und Objekten: { list: [{ name, folder, groups }], missing, active } */
const revierState = () => revierSetup({ reviere: revierGroups(), objects: app.data?.objects || [] })
const reviereList = () => revierState().list
/** Trennung je Revier eingerichtet: jedes Revier hat eine Gruppe (core/reviere.js revierSetup). */
const revierMode = () => app.config.tools !== false && revierState().active

/** Ordner, die geprüft werden: Hauptordner der App, ihre Unterordner, die Werkzeug-Ordner. */
function folderRows() {
  const base = spFolder()
  const rows = [{ path: base, label: 'Hauptordner der App – neue Unterordner erben seine Rechte' }]
  for (const [folder, label] of folderRights(null)) rows.push({ path: `${base}/${folder}`, label })
  if (app.config.tools !== false) for (const [folder, label] of TOOL_FOLDERS) rows.push({ path: folder, label, tool: true })
  if (revierMode()) for (const t of REVIER_TOOLS) for (const r of reviereList()) rows.push({ path: `${t.base}/${r.folder}`, label: `${t.label}: Revier ${r.name}`, tool: true, revier: r.name })
  return rows
}

/** Rollen mit Gruppen, Personen und dem Soll-Recht je Ordner (für core/rights-audit.js). */
function roleSpecs() {
  const access = app.config.access || {}
  const roles = allRoles()
  const base = spFolder()
  const reviere = revierMode() ? reviereList() : []
  const revierPaths = (r) => REVIER_TOOLS.map((t) => `${t.base}/${r.folder}`)
  const specs = Object.keys(roles).map((id) => {
    const ra = resolveAccess({ preview: id, access })
    const rights = { [base]: ra.all ? 'Bearbeiten' : '' }
    for (const [folder, , right] of folderRights(ra)) rights[`${base}/${folder}`] = right
    for (const [folder, , right] of toolFolderRights(ra, { reviere: !!reviere.length })) rights[folder] = right
    // Revier-Ordner: nur der Vollzugriff über die Rolle, alle anderen über die Gruppe ihres Reviers
    for (const r of reviere) for (const path of revierPaths(r)) rights[path] = ra.all ? 'Bearbeiten' : ''
    return { id, label: roles[id].label, groups: groupsOf(id), people: [...(id === 'disposition' ? access.planners || [] : []), ...(access.members?.[id] || [])], rights }
  })
  for (const r of reviere) specs.push({ id: `revier:${r.name}`, label: `Revier ${r.name}`, groups: r.groups, people: [], rights: Object.fromEntries(revierPaths(r).map((p) => [p, 'Bearbeiten'])) })
  return specs
}

// ------------------------------------------------ Ansicht

function accessView() {
  const access = app.config.access || {}
  const roles = allRoles()
  const people = (id) => [...(id === 'disposition' ? access.planners || [] : []), ...(access.members?.[id] || [])]
  const used = Object.keys(roles).filter((id) => groupsOf(id).length || people(id).length || ['disposition', 'objektmanagement', 'vorarbeiter', 'mattenwechsel', 'mattenfahrer'].includes(id))
  const roleAccess = Object.fromEntries(used.map((id) => [id, resolveAccess({ preview: id, access })]))
  const folders = folderRights(roleAccess[used[0]]).map(([folder, label]) => [folder, label])
  const me = app.user
  return `<div class="view-head"><h2>Berechtigungen</h2><p class="muted">Wer was sieht, richtet die IT über Microsoft-Gruppen ein. Die App liest nur die Ordner, die eine Gruppe braucht; die Rechte in SharePoint sichern die Daten zusätzlich ab, auch außerhalb der App.</p></div>
  <section class="table-wrap"><table class="data">
    <thead><tr><th>Rolle</th><th>Microsoft-Gruppe (Objekt-ID)</th><th>sieht</th><th>darf ändern</th></tr></thead>
    <tbody>${used
      .map((id) => {
        const r = roles[id]
        const g = groupsOf(id)
        const p = people(id)
        return `<tr><td><strong>${esc(r.label)}</strong><br><span class="muted">${esc(id)}</span></td>
          <td>${g.length ? g.map((x) => `<code>${esc(x)}</code>`).join('<br>') : '<span class="muted">noch keine Gruppe eingetragen</span>'}${isDraft(id) ? ' <span class="pill warning">Entwurf</span>' : ''}${p.length ? `<br><span class="muted">dazu: ${esc(p.join(', '))}</span>` : ''}</td>
          <td>${esc(list(r.modules))}</td><td>${esc(list(r.edit))}</td></tr>`
      })
      .join('')}</tbody></table></section>
  ${groupsCard(roles)}
  ${auditCard()}
  ${migrationCard()}
  <section class="table-wrap"><div class="table-head"><h3>Rechte in SharePoint je Ordner</h3><p class="muted">Bibliothek ${esc(app.config.sharepoint?.library || '')}, Ordner ${esc(spFolder())}. Jeden Ordner nur für diese Gruppen freigeben (Vererbung beenden). Den Hauptordner ${esc(spFolder())} nur für den Vollzugriff – neue Unterordner erben seine Rechte.</p></div><table class="data">
    <thead><tr><th>Ordner</th><th>Inhalt</th>${used.map((id) => `<th>${esc(roles[id].label)}</th>`).join('')}</tr></thead>
    <tbody>${folders
      .map(([folder, label], i) => `<tr><td><code>${esc(folder)}/</code></td><td>${esc(label)}</td>${used.map((id) => `<td>${esc(folderRights(roleAccess[id])[i][2] || '–')}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></section>
  <section class="table-wrap"><div class="table-head"><h3>Rechte in SharePoint für die Werkzeuge</h3><p class="muted">Wasserzähler-Ablesung, Objektkontrolle, Objektdoku und Mattenwechsel speichern selbst in diesen Ordnern der Bibliothek ${esc(app.config.sharepoint?.library || '')} (neben ${esc(spFolder())}). Vorschlag je Rolle; wer einen Ordner nicht öffnen darf, sieht im Werkzeug nichts davon.</p></div><table class="data">
    <thead><tr><th>Ordner</th><th>Inhalt</th>${used.map((id) => `<th>${esc(roles[id].label)}</th>`).join('')}</tr></thead>
    <tbody>${toolFolderRights(null)
      .map(([folder, label], i) => `<tr><td><code>${esc(folder)}/</code></td><td>${esc(label)}</td>${used.map((id) => `<td>${esc(toolFolderRights(roleAccess[id])[i][2] || '–')}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></section>
  ${me ? `<section class="banner"><p><strong>Deine Anmeldung:</strong> ${esc(me.name)} (${esc(me.email)}) · ${esc(app.access?.label || '')}<br>Gruppen im Microsoft-Konto: ${(me.groups || []).length ? me.groups.map((g) => `<code>${esc(g)}</code>`).join(' ') : 'keine übermittelt'}${me.groupsFrom ? ` <span class="muted">(${me.groupsFrom === 'graph' ? 'nicht im Token, bei Microsoft Graph nachgefragt' : 'ohne Netz: zuletzt gelesener Stand'})</span>` : ''}</p></section>` : ''}
  <p class="note">Gruppen eintragen: in <code>config.json</code> am Webspace (bzw. <code>config.production.json</code> vor dem Build) unter <code>access.groups</code> je Rolle die Objekt-ID der Microsoft-Gruppe, oder in Entra ID der Gruppe die App-Rolle zuweisen. Schritt für Schritt in docs/EINRICHTUNG.md, Abschnitt 11.</p>`
}

/** Gruppen je Rolle eintragen (Entwurf) und als Ausschnitt für config.json ausgeben. */
function groupsCard(roles) {
  if (!app.access?.all) return ''
  const known = knownGroups()
  return `<details class="card acc-groups" ${app.ui.accGroupsOpen || draftChanged() ? 'open' : ''}><summary data-action="acc-groups-toggle"><strong>Gruppen je Rolle eintragen</strong> <span class="muted">– Entwurf, wird erst mit config.json wirksam</span></summary>
    <p class="muted">Je Rolle eine eigene Sicherheitsgruppe in Entra ID anlegen (Vorschlag unten), ihre Objekt-ID hier eintragen, mit „Rechte prüfen“ ansehen, was sich ändert, dann den Ausschnitt in <code>config.json</code> am Webspace übernehmen. Mehrere Gruppen mit Komma trennen.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Rolle</th><th>Vorschlag in Entra ID</th><th>Objekt-ID der Gruppe</th></tr></thead><tbody>${Object.entries(roles)
      .map(([id, r]) => `<tr><td><strong>${esc(r.label)}</strong><br><span class="muted">${esc(id)}</span></td><td><code>${esc(groupName(r.label))}</code></td>
        <td><input type="text" class="acc-gid" data-role="${esc(id)}" data-change="acc-draft" list="acc-known" value="${esc(groupsOf(id).join(', '))}" placeholder="z. B. 1a2b3c4d-…" aria-label="Objekt-ID der Gruppe für ${esc(r.label)}" spellcheck="false"></td></tr>`)
      .join('')}</tbody></table></div>
    ${revierTable()}
    <datalist id="acc-known">${known.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</datalist>
    <div class="actions"><button class="btn" data-action="acc-snippet">${ICON.copy || ''} Ausschnitt für config.json</button>${draftChanged() ? '<button class="btn ghost" data-action="acc-draft-reset">Entwurf verwerfen</button>' : ''}</div>
  </details>`
}

/** Reviere: je Revier eine Gruppe (Leute vor Ort in diesem Revier); trennt die Daten in den Werkzeugen. */
function revierTable() {
  const list = reviereList()
  if (app.config.tools === false) return ''
  if (!list.length) return '<p class="muted">Reviere: noch keine. Sie kommen aus den Objekten (Feld „Revier“) oder aus <code>access.reviere</code>.</p>'
  const { missing } = revierState()
  const some = list.some((r) => r.groups.length)
  return `<h4>Reviere</h4><p class="muted">Je Revier eine Gruppe mit den Leuten vor Ort. Sobald jedes Revier eine Gruppe hat, legen Wasserzähler, Objektkontrolle und Objektdoku neue Daten im Ordner „Revier …“ ab, und jede Gruppe sieht nur ihre Reviere.</p>
    ${some && missing.length ? `<p class="acc-warn">Die Trennung je Revier wird erst aktiv, wenn jedes Revier eine Gruppe hat. Es fehlt noch: ${esc(missing.join(', '))}.</p>` : ''}
    <div class="table-wrap"><table class="data"><thead><tr><th>Revier</th><th>Vorschlag in Entra ID</th><th>Objekt-ID der Gruppe</th></tr></thead><tbody>${list
      .map((r) => `<tr><td><strong>${esc(r.name)}</strong><br><span class="muted">Ordner „${esc(r.folder)}“</span></td><td><code>${esc(groupName(`Revier ${r.name}`))}</code></td>
        <td><input type="text" class="acc-gid" data-revier="${esc(r.name)}" data-change="acc-rev-draft" list="acc-known" value="${esc(r.groups.join(', '))}" placeholder="z. B. 1a2b3c4d-…" aria-label="Objekt-ID der Gruppe für Revier ${esc(r.name)}" spellcheck="false"></td></tr>`)
      .join('')}</tbody></table></div>`
}

/** Gruppen, die die App schon kennt: aus der letzten Prüfung (mit Namen) und aus der eigenen Anmeldung. */
function knownGroups() {
  const out = new Map()
  for (const row of app.ui.accAudit?.rows || []) for (const i of row.result?.items || []) if (i.kind === 'group' && i.id && !out.has(i.id)) out.set(i.id, { id: i.id, name: i.name })
  for (const g of app.user?.groups || []) if (!out.has(String(g).toLowerCase())) out.set(String(g).toLowerCase(), { id: String(g).toLowerCase(), name: 'eine deiner Gruppen' })
  return [...out.values()]
}

const STATUS = { ok: ['ok', 'passt'], besitzer: ['na', 'Besitzer'], ich: ['na', 'du'], fehlt: ['error', 'fehlt'], zuwenig: ['warning', 'zu wenig'], zuviel: ['error', 'zu viel'], link: ['error', 'Link'] }

function auditCard() {
  if (!app.access?.all) return ''
  if (!sp()) return `<section class="card"><h3>Rechte in SharePoint prüfen</h3><p class="muted">Geht nur im Betrieb mit SharePoint (app.cleanos.at, angemeldet mit Vollzugriff).</p></section>`
  const a = app.ui.accAudit
  const busy = app.ui.accBusy
  const todo = (a?.rows || []).filter((r) => { const p = fixPlan(r.result); return p.create || p.grants.length || p.removes.length })
  return `<section class="table-wrap acc-audit"><div class="table-head"><h3>Rechte in SharePoint prüfen</h3>
    <p class="muted">Liest die echten Freigaben jedes Ordners und vergleicht sie mit den Tabellen unten${draftChanged() ? ' – <strong>mit den Gruppen aus deinem Entwurf</strong>' : ''}. Nur Besitzer der Website sehen alle Freigaben.</p>
    <div class="actions"><button class="btn${a ? '' : ' primary'}" data-action="acc-audit" ${busy ? 'disabled' : ''}>${ICON.refresh || ''} ${a ? 'Neu prüfen' : 'Rechte prüfen'}</button>${todo.length && !busy ? `<button class="btn primary" data-action="acc-fix-open">Abweichungen beheben …</button>` : ''}</div></div>
    ${busy ? `<p class="acc-busy" role="status">${esc(busy)}</p>` : ''}
    ${a ? `<table class="data"><thead><tr><th>Ordner</th><th>Ergebnis</th><th>Einzelheiten</th></tr></thead><tbody>${a.rows.map(auditRow).join('')}</tbody></table>
      <p class="muted">Geprüft ${esc(new Date(a.at).toLocaleString('de-AT'))}${a.draft ? ' mit dem Entwurf der Gruppen' : ''}.</p>` : ''}
    ${app.ui.accReport ? reportHtml(app.ui.accReport) : ''}
  </section>`
}

function auditRow(row) {
  const s = summary(row.result)
  const items = row.result?.error
    ? [`<li>${esc(row.result.error)}</li>`]
    : row.result?.partial
      ? ['<li>Du siehst hier nur deine eigenen Freigaben. Als Besitzer der Website anmelden (oder die IT prüfen lassen).</li>']
      : (row.result?.items || []).map((i) => `<li><span class="pill ${STATUS[i.status]?.[0] || ''}">${esc(STATUS[i.status]?.[1] || i.status)}</span> ${esc(i.text)}</li>`)
  return `<tr><td><code>${esc(row.path)}/</code><br><span class="muted">${esc(row.label)}</span>${row.webUrl ? `<br><a href="${esc(row.webUrl)}" target="_blank" rel="noopener">in SharePoint öffnen</a>` : ''}</td>
    <td><span class="pill ${s.cls === 'bad' ? 'error' : s.cls === 'warn' ? 'warning' : s.cls}">${esc(s.text)}</span></td>
    <td>${items.length ? `<ul class="acc-items">${items.join('')}</ul>` : '<span class="muted">keine Freigaben</span>'}</td></tr>`
}

function reportHtml(rep) {
  const bad = rep.lines.filter((l) => !l.ok)
  return `<div class="acc-report"><h4>Geändert ${esc(new Date(rep.at).toLocaleString('de-AT'))}</h4>
    <ul class="acc-items">${rep.lines.map((l) => `<li><span class="pill ${l.ok ? 'ok' : 'error'}">${l.ok ? 'erledigt' : 'nicht gegangen'}</span> <code>${esc(l.path)}/</code> ${esc(l.text)}</li>`).join('')}</ul>
    ${bad.length ? '<p class="note">Was nicht gegangen ist, in SharePoint von Hand erledigen: Ordner öffnen → „Zugriff verwalten“ (bzw. „Details“ → „Zugriff verwalten“), bei geerbten Rechten zuerst „Vererbung beenden“.</p>' : ''}
  </div>`
}

// ------------------------------------------------ Prüfen und beheben

async function runAudit(paths = null) {
  const store = sp()
  if (!store) return
  const exp = expectedRights(roleSpecs())
  const all = folderRows()
  const rows = paths ? all.filter((r) => paths.includes(r.path)) : all
  const prev = new Map((app.ui.accAudit?.rows || []).map((r) => [r.path, r]))
  // erst alles lesen: Gruppennamen gibt es nur dort, wo die Gruppe schon Rechte hat
  const got = new Map()
  for (const [n, row] of rows.entries()) {
    app.ui.accBusy = `Prüfe ${n + 1} von ${rows.length}: ${row.path} …`
    renderNow()
    try {
      got.set(row.path, (await store.permissions(row.path)) || { perms: null })
    } catch (err) {
      got.set(row.path, { error: `Nicht lesbar: ${err.message || err}` })
    }
  }
  const names = new Map([...(app.ui.accNames || new Map()), ...groupNames([...got.values()].map((g) => g.perms))])
  app.ui.accNames = names
  for (const row of rows) {
    const g = got.get(row.path)
    prev.set(row.path, g.error ? { ...row, result: { error: g.error } } : { ...row, webUrl: g.webUrl || null, result: auditFolder({ expected: exp.get(row.path) || new Map(), perms: g.perms, me: app.user?.email || '', names }) })
  }
  app.ui.accAudit = { at: new Date().toISOString(), draft: draftChanged(), rows: all.map((r) => prev.get(r.path)).filter(Boolean) }
  app.ui.accBusy = ''
  renderNow()
}

/** Ein Ordner: anlegen, vergeben (beendet die Vererbung), neu lesen, Überzähliges entfernen. */
async function fixFolder(store, row, exp, lines) {
  const say = (ok, text) => lines.push({ path: row.path, ok, text })
  const me = app.user?.email || ''
  const fresh = async () => {
    const got = await store.permissions(row.path)
    return auditFolder({ expected: exp.get(row.path) || new Map(), perms: got ? got.perms : null, me, names: app.ui.accNames || new Map() })
  }
  // frisch lesen: Änderungen am Hauptordner ändern auch, was die Unterordner (noch) erben
  let plan = fixPlan(await fresh())
  if (plan.create) {
    try {
      await store.ensureRootFolder(row.path)
      say(true, 'Ordner angelegt')
      plan = fixPlan(await fresh())
    } catch (err) {
      return say(false, `Ordner anlegen: ${err.message || err}`)
    }
  }
  const grants = plan.grants.length ? plan.grants : plan.removes.length && plan.anchor ? [plan.anchor] : []
  for (const g of grants) {
    try {
      await store.grant(row.path, g, g.right)
      say(true, g === plan.anchor ? `Vererbung beendet (${g.name}: ${g.right} bestätigt)` : `${g.name}: ${g.right} vergeben`)
    } catch (err) {
      say(false, `${g.name}: ${g.right} vergeben – ${err.message || err}`)
    }
  }
  if (!plan.removes.length) return
  // nach dem Vergeben sind die Freigaben eigene (nicht mehr geerbte) mit neuen Kennungen: neu lesen
  const again = fixPlan(await fresh())
  for (const r of again.removes) {
    try {
      await store.unshare(row.path, r.permId)
      say(true, `${r.name}: ${r.right} entfernt`)
    } catch (err) {
      say(false, `${r.name}: ${r.right} entfernen – ${err.status === 403 || err.status === 400 ? 'geerbt oder gesperrt' : err.message || err}`)
    }
  }
}

async function runFix(paths) {
  const store = sp()
  if (!store || !app.ui.accAudit) return
  const exp = expectedRights(roleSpecs())
  const lines = []
  const rows = app.ui.accAudit.rows.filter((r) => paths.includes(r.path))
  for (const [n, row] of rows.entries()) {
    app.ui.accBusy = `Ändere ${n + 1} von ${rows.length}: ${row.path} …`
    renderNow()
    try {
      await fixFolder(store, row, exp, lines)
    } catch (err) {
      lines.push({ path: row.path, ok: false, text: err.message || String(err) })
    }
  }
  app.ui.accReport = { at: new Date().toISOString(), lines }
  // alles neu prüfen: auch nicht angehakte Ordner erben ggf. geänderte Rechte des Hauptordners
  await runAudit()
  const failed = lines.filter((l) => !l.ok).length
  toast(failed ? `Rechte geändert, ${failed} Schritt${failed === 1 ? '' : 'e'} nicht gegangen – siehe Liste.` : 'Rechte angeglichen und neu geprüft.')
}

// ------------------------------------------------ Umzug alter Werkzeug-Ordner in Reviere

function migrationCard() {
  if (!revierMode() || !mayAudit()) return ''
  const m = app.ui.accMig
  const names = reviereList().map((r) => r.name)
  const busy = app.ui.accMigBusy
  const chosen = (m?.rows || []).filter((r) => r.choice).length
  const opt = (r) => `<option value="">bleibt (ohne Revier)</option>${names.map((n) => `<option value="${esc(n)}" ${r.choice === n ? 'selected' : ''}>Revier ${esc(n)}</option>`).join('')}`
  return `<section class="table-wrap acc-mig"><div class="table-head"><h3>Alte Werkzeug-Ordner in Reviere verschieben</h3>
    <p class="muted">Einmal nach dem Einrichten der Reviere: Ordner von Wasserzähler, Objektkontrolle und Objektdoku, die noch ohne Revier liegen, kommen in ihren Ordner „Revier …“. Fotos, PDFs und Verlauf ziehen mit; kopiert oder gelöscht wird nichts. Den Vorschlag macht die App über Name und Adresse der Objekte – bitte prüfen.</p>
    <div class="actions"><button class="btn${m ? '' : ' primary'}" data-action="acc-mig-scan" ${busy ? 'disabled' : ''}>${m ? 'Neu einlesen' : 'Ordner einlesen'}</button>${chosen && !busy ? `<button class="btn primary" data-action="acc-mig-open">${chosen === 1 ? '1 Ordner' : `${chosen} Ordner`} verschieben …</button>` : ''}</div></div>
    ${busy ? `<p class="acc-busy" role="status">${esc(busy)}</p>` : ''}
    ${
      m
        ? m.rows.length
          ? `<table class="data"><thead><tr><th>Werkzeug</th><th>Ordner</th><th>Revier</th><th>Vorschlag</th></tr></thead><tbody>${m.rows
              .map((r, i) => `<tr><td>${esc(r.label)}</td><td><code>${esc(r.path)}/</code></td><td><select data-change="acc-mig-choice" data-i="${i}" aria-label="Revier für ${esc(r.name)}">${opt(r)}</select></td><td>${r.suggestion ? `${esc(r.suggestion.object)}${r.suggestion.score < 3 ? ' <span class="muted">(ähnlich)</span>' : ''}` : '<span class="muted">kein passendes Objekt</span>'}</td></tr>`)
              .join('')}</tbody></table>`
          : '<p class="muted">Alle Ordner liegen schon in Revieren.</p>'
        : ''
    }
    ${app.ui.accMigReport ? reportHtml(app.ui.accMigReport) : ''}
  </section>`
}

async function scanMigration() {
  const store = sp()
  const listing = {}
  for (const t of REVIER_TOOLS) {
    app.ui.accMigBusy = `Lese ${t.label} …`
    renderNow()
    try {
      listing[t.base] = (await store.children(t.base)) || []
      for (const n of t.nested) listing[`${t.base}/${n}`] = (await store.children(`${t.base}/${n}`)) || []
    } catch (err) {
      listing[t.base] = []
      toast(`${t.label}: ${err.message || err}`)
    }
  }
  const names = new Set(reviereList().map((r) => r.name))
  const rows = moveRows(listing, app.data?.objects || []).map((r) => ({ ...r, choice: r.suggestion && names.has(r.suggestion.revier) ? r.suggestion.revier : '' }))
  app.ui.accMig = { at: new Date().toISOString(), rows }
  app.ui.accMigBusy = ''
  renderNow()
}

async function runMigration() {
  const store = sp()
  const rows = (app.ui.accMig?.rows || []).filter((r) => r.choice)
  const lines = []
  const done = []
  for (const [n, r] of rows.entries()) {
    app.ui.accMigBusy = `Verschiebe ${n + 1} von ${rows.length}: ${r.path} …`
    renderNow()
    const target = moveTarget(r, r.choice)
    try {
      await store.moveRoot(r.path, target)
      done.push(r)
      lines.push({ path: r.path, ok: true, text: `→ ${target}/` })
    } catch (err) {
      lines.push({ path: r.path, ok: false, text: `→ ${target}/: ${err.status === 409 ? 'dort gibt es schon einen Ordner mit diesem Namen – von Hand zusammenführen' : err.message || err}` })
    }
  }
  // Objektliste der Objektkontrolle: Einträge der umgezogenen Objekte in die Liste ihres Reviers
  const moved = done.filter((r) => r.tool === 'kontrolle').map((r) => ({ folder: r.name, revier: r.choice }))
  if (moved.length) {
    app.ui.accMigBusy = 'Teile die Objektliste der Objektkontrolle auf …'
    renderNow()
    try {
      const global = await store.readRoot(KONTROLLE_LIST)
      if (Array.isArray(global?.objekte) && global.objekte.length) {
        const { rest, byRevier } = splitObjectList(global.objekte, moved)
        const stand = todayISO()
        const key = (e) => `${String(e.kunde || '').trim()}|${String(e.objekt || '').trim()}`.toLowerCase()
        // erst die Listen der Reviere, dann die Gesamtliste: bricht es dazwischen ab, fehlt nichts
        for (const [revier, entries] of Object.entries(byRevier)) {
          const path = kontrolleRevierList(revier)
          const cur = (await store.readRoot(path))?.objekte || []
          await store.writeRootJson(path, { stand, objekte: [...cur, ...entries.filter((e) => !cur.some((c) => key(c) === key(e)))] })
          lines.push({ path, ok: true, text: `${entries.length === 1 ? '1 Objekt' : `${entries.length} Objekte`} in die Liste des Reviers` })
        }
        if (Object.keys(byRevier).length) await store.writeRootJson(KONTROLLE_LIST, { ...global, stand, objekte: rest })
      }
    } catch (err) {
      lines.push({ path: KONTROLLE_LIST, ok: false, text: `Objektliste nicht aufgeteilt: ${err.message || err}` })
    }
  }
  app.ui.accMigReport = { at: new Date().toISOString(), lines }
  await scanMigration()
  const failed = lines.filter((l) => !l.ok).length
  toast(failed ? `Verschoben, ${failed} Schritt${failed === 1 ? '' : 'e'} nicht gegangen – siehe Liste.` : 'Ordner verschoben. Danach die Rechte prüfen.')
}

function migModal() {
  const rows = (app.ui.accMig?.rows || []).filter((r) => r.choice)
  const by = new Map()
  for (const r of rows) by.set(r.choice, [...(by.get(r.choice) || []), r])
  return modalFrame({
    title: 'Werkzeug-Ordner in Reviere verschieben',
    wide: true,
    body: `<p>Die App verschiebt diese Ordner samt Inhalt in den Ordner ihres Reviers. <strong>Während des Umzugs bitte in Wasserzähler, Objektkontrolle und Objektdoku nichts abschließen.</strong> Danach im Werkzeug einmal „Abgleichen“ und hier „Rechte prüfen“.</p>
      ${[...by]
        .map(([revier, list]) => `<fieldset class="acc-fix"><legend><strong>Revier ${esc(revier)}</strong></legend><ul class="acc-items">${list.map((r) => `<li>${esc(r.label)}: <code>${esc(r.name)}</code> → <code>${esc(moveTarget(r, revier))}/</code></li>`).join('')}</ul></fieldset>`)
        .join('')}
      ${rows.some((r) => r.tool === 'kontrolle') ? '<p class="note">Die Einträge dieser Objekte wandern aus der gemeinsamen Objektliste der Objektkontrolle in die Liste ihres Reviers.</p>' : ''}`,
    foot: `<div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="acc-mig-run">Jetzt verschieben</button></div>`,
  })
}
registerModal('acc-mig', migModal, { module: 'stammdaten' })

// ------------------------------------------------ Dialoge

function fixModal() {
  const rows = (app.ui.accAudit?.rows || []).map((r) => ({ r, p: fixPlan(r.result) })).filter(({ p }) => p.create || p.grants.length || p.removes.length)
  const siteGroups = [...new Set(rows.flatMap(({ r, p }) => p.removes.filter((x) => (r.result.items.find((i) => i.key === x.key) || {}).kind === 'siteGroup').map((x) => x.name)))]
  const noGroup = roleSpecs().filter((s) => !s.groups.length && !s.people.length && Object.values(s.rights).some(Boolean)).map((s) => s.label)
  const step = (cls, text) => `<li><span class="pill ${cls}">${cls === 'ok' ? 'vergeben' : cls === 'info' ? 'anlegen' : 'entfernen'}</span> ${esc(text)}</li>`
  return modalFrame({
    title: 'Rechte in SharePoint angleichen',
    wide: true,
    body: `<p>Die App ändert die Freigaben der angehakten Ordner so, dass sie zu den Rollen passen. <strong>Besitzer der Website und deine eigenen Rechte bleiben immer.</strong> Es gehen keine Einladungs-Mails hinaus.</p>
      ${siteGroups.length ? `<p class="acc-warn">Website-Gruppen werden entfernt (${esc(siteGroups.join(', '))}): Wer <strong>nur</strong> über sie Zugriff hatte, verliert ihn in diesen Ordnern. Vorher alle Leute in die passenden Gruppen aufnehmen.</p>` : ''}
      ${noGroup.length ? `<p class="acc-warn">Ohne eingetragene Gruppe (bekommen nichts): ${esc(noGroup.join(', '))}.</p>` : ''}
      ${rows
        .map(({ r, p }) => `<fieldset class="acc-fix"><legend><label class="check"><input type="checkbox" name="acc-fix" value="${esc(r.path)}" checked><span><code>${esc(r.path)}/</code></span></label></legend><ul class="acc-items">
          ${p.create ? step('info', 'Ordner anlegen') : ''}${p.grants.map((g) => step('ok', `${g.name}: ${g.right}`)).join('')}${p.removes.map((x) => step('error', `${x.name}: ${x.right}`)).join('')}
          ${p.removes.length && !p.grants.length ? `<li class="muted">${p.anchor ? `Vorher wird „${esc(p.anchor.name)}“ ihr Recht noch einmal gegeben, damit der Ordner nicht mehr erbt.` : 'Erbt der Ordner noch Rechte, geht das Entfernen nicht – dann in SharePoint „Vererbung beenden“.'}</li>` : ''}</ul></fieldset>`)
        .join('')}`,
    foot: `<div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="acc-fix-run">Jetzt ändern</button></div>`,
  })
}
registerModal('acc-fix', fixModal, { module: 'stammdaten' })

function snippet() {
  const roles = allRoles()
  const groups = {}
  for (const id of Object.keys(roles)) {
    const g = groupsOf(id)
    if (g.length) groups[id] = g
  }
  const reviere = Object.fromEntries(Object.entries(revierGroups()).filter(([, g]) => g.length))
  return JSON.stringify({ access: { ...(app.config.access?.planners ? { planners: app.config.access.planners } : {}), groups, ...(Object.keys(reviere).length ? { reviere } : {}) } }, null, 2)
}

function snippetModal() {
  return modalFrame({
    title: 'Ausschnitt für config.json',
    wide: true,
    body: `<p>Diesen Teil in <code>config.json</code> am Webspace (app.cleanos.at) bei <code>"access"</code> übernehmen – oder vor dem Build in <code>config.production.json</code>. Danach die App neu laden; jede Rolle mit „Ansicht als“ und einem Testkonto prüfen.</p>
      <textarea id="acc-snippet-text" class="acc-snippet" rows="14" readonly spellcheck="false">${esc(snippet())}</textarea>`,
    foot: `<div class="actions"><button class="btn" data-action="close-modal">Schließen</button><button class="btn primary" data-action="acc-copy">${ICON.copy || ''} Kopieren</button></div>`,
  })
}
registerModal('acc-snippet', snippetModal, { module: 'stammdaten' })

// ------------------------------------------------ Aktionen

registerActions({
  'acc-groups-toggle': () => {
    app.ui.accGroupsOpen = !app.ui.accGroupsOpen
  },
  'acc-draft': (el) => {
    app.ui.accDraft = { ...(app.ui.accDraft || {}), [el.dataset.role]: el.value }
    app.ui.accGroupsOpen = true
    renderNow()
  },
  'acc-draft-reset': () => {
    app.ui.accDraft = {}
    app.ui.accRevDraft = {}
    renderNow()
  },
  'acc-rev-draft': (el) => {
    app.ui.accRevDraft = { ...(app.ui.accRevDraft || {}), [el.dataset.revier]: el.value }
    app.ui.accGroupsOpen = true
    renderNow()
  },
  'acc-snippet': () => openModal({ type: 'acc-snippet' }),
  'acc-mig-scan': async () => {
    if (!mayAudit()) return toast('Geht nur mit Vollzugriff im Betrieb mit SharePoint.')
    app.ui.accMigReport = null
    try {
      await scanMigration()
    } catch (err) {
      app.ui.accMigBusy = ''
      renderNow()
      toast(`Einlesen ging nicht: ${err.message || err}`)
    }
  },
  'acc-mig-choice': (el) => {
    const row = app.ui.accMig?.rows?.[Number(el.dataset.i)]
    if (row) row.choice = el.value
    renderNow()
  },
  'acc-mig-open': () => (mayAudit() ? openModal({ type: 'acc-mig' }) : toast('Geht nur mit Vollzugriff im Betrieb mit SharePoint.')),
  'acc-mig-run': async () => {
    closeModal()
    try {
      await runMigration()
    } catch (err) {
      app.ui.accMigBusy = ''
      renderNow()
      toast(`Verschieben ging nicht: ${err.message || err}`)
    }
  },
  'acc-copy': () => copyText(snippet(), document.getElementById('acc-snippet-text')),
  'acc-audit': async () => {
    if (!mayAudit()) return toast('Prüfen geht nur mit Vollzugriff im Betrieb mit SharePoint.')
    app.ui.accReport = null
    try {
      await runAudit()
    } catch (err) {
      app.ui.accBusy = ''
      renderNow()
      toast(`Prüfen ging nicht: ${err.message || err}`)
    }
  },
  'acc-fix-open': () => (mayAudit() ? openModal({ type: 'acc-fix' }) : toast('Ändern geht nur mit Vollzugriff im Betrieb mit SharePoint.')),
  'acc-fix-run': async () => {
    const paths = [...document.querySelectorAll('input[name="acc-fix"]:checked')].map((x) => x.value)
    if (!paths.length) return toast('Kein Ordner angehakt.')
    closeModal()
    try {
      await runFix(paths)
    } catch (err) {
      app.ui.accBusy = ''
      renderNow()
      toast(`Ändern ging nicht: ${err.message || err}`)
    }
  },
}, { edit: '*' })

registerView({ id: 'berechtigungen', order: 120, label: 'Berechtigungen', group: 'stamm', module: 'stammdaten', noWeek: true, render: accessView })
