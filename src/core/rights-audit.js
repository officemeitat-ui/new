// Rechte-Prüfung: Stimmen die Freigaben der SharePoint-Ordner mit den Rollen der App überein?
// Reine Logik ohne Netz (Test: test/rights-audit.test.js); lesen und ändern über die Ablage
// (storage/docstore-sharepoint.js: permissions, grant, unshare), Oberfläche in ui/views/access.js.
//
// Freigabe (Microsoft Graph, driveItem/permissions):
//   { id, roles: ['read'|'write'|'owner'], link?: { scope, type },
//     grantedToV2?: { group?: { id, displayName }, siteGroup?|sharePointGroup?: { id, displayName },
//                     user?: { id, displayName, email }, siteUser?: { loginName, displayName } } }
// SharePoint liefert `inheritedFrom` nicht: Ob ein Ordner noch erbt, sieht man erst, wenn das Entfernen
// scheitert. Darum wird vor dem Entfernen einmal etwas vergeben (das beendet die Vererbung, die bisherigen
// Rechte bleiben als eigene Rechte stehen) und die Liste danach neu gelesen.
//
// Soll je Ordner: Map Schlüssel → { kind: 'group'|'user', id, want: 'Lesen'|'Bearbeiten', roles: [Rollen] }
// Schlüssel: „g:<Gruppen-ID>“ (Entra ID, klein) oder „u:<E-Mail>“ (klein).

export const LEVEL = { '': 0, Lesen: 1, Bearbeiten: 2, Besitzer: 3 }
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const lower = (s) => String(s || '').trim().toLowerCase()
const guidOf = (s) => (String(s || '').match(GUID)?.[0] || '').toLowerCase()

/** Recht einer Freigabe: Besitzer > Bearbeiten > Lesen; unbekannte Rollen zählen vorsichtshalber als Bearbeiten. */
export function rightOf(roles = []) {
  const r = roles.map(lower)
  if (r.includes('owner') || r.some((x) => /full ?control|vollzugriff/.test(x))) return 'Besitzer'
  if (r.includes('write') || r.some((x) => !['read', 'write', 'owner'].includes(x))) return 'Bearbeiten'
  return r.includes('read') ? 'Lesen' : 'Bearbeiten'
}

/**
 * Wem gilt eine Freigabe? { key, kind: 'group'|'siteGroup'|'user'|'link'|'other', id, name, right, permId, scope? }
 * Sicherheitsgruppen und Microsoft-365-Gruppen erkennt die App an der Gruppen-ID (group.id oder im
 * Anmeldenamen „c:0t.c|tenant|<ID>“ bzw. „c:0o.c|federateddirectoryclaimprovider|<ID>“).
 */
export function principalOf(p = {}) {
  const right = rightOf(p.roles)
  const base = { permId: p.id, right }
  if (p.link) {
    const scope = lower(p.link.scope) || 'users'
    return { ...base, key: `l:${p.id}`, kind: 'link', id: p.id, scope, name: scope === 'anonymous' ? 'Freigabelink für jeden mit dem Link' : scope === 'organization' ? 'Freigabelink für alle in der Firma' : 'Freigabelink für bestimmte Personen' }
  }
  const g = p.grantedToV2 || p.grantedTo || {}
  const login = String(g.siteUser?.loginName || '')
  if (g.group?.id || /^c:0[to]\.c\|/i.test(login)) {
    const id = guidOf(g.group?.id) || guidOf(login)
    const owners = /_o$/i.test(login)
    return { ...base, key: `g:${id}`, kind: 'group', id, name: g.group?.displayName || g.siteUser?.displayName || id, ...(owners ? { owners: true } : {}) }
  }
  const sg = g.sharePointGroup || g.siteGroup
  if (sg) return { ...base, key: `s:${sg.id ?? sg.displayName}`, kind: 'siteGroup', id: String(sg.id ?? ''), name: sg.displayName || 'SharePoint-Gruppe' }
  const mail = lower(g.user?.email) || lower(login.match(/\|([^|]+@[^|]+)$/)?.[1])
  if (g.user || mail) return { ...base, key: mail ? `u:${mail}` : `x:${g.user?.id}`, kind: 'user', id: mail || String(g.user?.id || ''), name: g.user?.displayName || g.siteUser?.displayName || mail }
  return { ...base, key: `x:${p.id}`, kind: 'other', id: String(p.id || ''), name: 'Unbekannte Freigabe' }
}

/**
 * Soll-Rechte je Ordner aus den Rollen.
 *  roles: [{ id, label, groups: [IDs], people: [E-Mails], rights: { Ordnerpfad: 'Lesen'|'Bearbeiten'|'' } }]
 * → Map Ordnerpfad → Map Schlüssel → { kind, id, want, roles }
 */
export function expectedRights(roles = []) {
  const out = new Map()
  for (const role of roles) {
    const principals = [...(role.groups || []).map((id) => ({ kind: 'group', id: lower(id), key: `g:${lower(id)}` })), ...(role.people || []).map((m) => ({ kind: 'user', id: lower(m), key: `u:${lower(m)}` }))].filter((x) => x.id)
    for (const [path, want] of Object.entries(role.rights || {})) {
      if (!out.has(path)) out.set(path, new Map())
      if (!want) continue
      const map = out.get(path)
      for (const pr of principals) {
        const cur = map.get(pr.key) || { ...pr, want: '', roles: [] }
        if (LEVEL[want] > LEVEL[cur.want]) cur.want = want
        if (!cur.roles.includes(role.label)) cur.roles.push(role.label)
        map.set(pr.key, cur)
      }
    }
  }
  return out
}

/**
 * Ein Ordner: Ist gegen Soll.
 *  expected: Map Schlüssel → { kind, id, want, roles } (aus expectedRights)
 *  perms:    Freigaben aus Graph (null = Ordner fehlt)
 *  me:       E-Mail der angemeldeten Person (ihre eigenen Rechte bleiben unangetastet)
 * → { missing, partial, ok, items: [{ status, key, name, kind, have, want, roles, perms: [{ permId, right }], text }] }
 * status: ok | fehlt | zuwenig | zuviel | link | besitzer | ich
 */
export function auditFolder({ expected = new Map(), perms, me = '', names = new Map() }) {
  const nameOf = (e, f) => f?.name || names.get(e.id) || e.id
  if (perms == null) return { missing: true, partial: false, ok: false, items: [...expected.values()].filter((e) => e.want).map((e) => ({ status: 'fehlt', key: e.key, kind: e.kind, id: e.id, name: nameOf(e), have: '', want: e.want, roles: e.roles, perms: [], text: `${who({ ...e, name: nameOf(e) })} braucht ${e.want} – der Ordner fehlt noch` })) }
  const found = new Map()
  for (const p of perms) {
    const pr = principalOf(p)
    const cur = found.get(pr.key) || { ...pr, perms: [] }
    cur.perms.push({ permId: pr.permId, right: pr.right })
    if (LEVEL[pr.right] > LEVEL[cur.right]) cur.right = pr.right
    found.set(pr.key, cur)
  }
  const items = []
  const mine = `u:${lower(me)}`
  for (const [key, e] of expected) {
    if (!e.want) continue
    const f = found.get(key)
    const have = f?.right || ''
    const name = nameOf(e, f)
    const base = { key, kind: e.kind, id: e.id, name, have, want: e.want, roles: e.roles, perms: f?.perms || [] }
    if (have === 'Besitzer' || LEVEL[have] === LEVEL[e.want]) items.push({ ...base, status: 'ok', text: `${who({ ...e, name })}: ${have}` })
    else if (!have) items.push({ ...base, status: 'fehlt', text: `${who({ ...e, name })} braucht ${e.want}, hat keinen Zugriff` })
    else if (LEVEL[have] < LEVEL[e.want]) items.push({ ...base, status: 'zuwenig', text: `${who({ ...e, name })} braucht ${e.want}, hat nur ${have}` })
    else items.push({ ...base, status: 'zuviel', text: `${who({ ...e, name })} braucht nur ${e.want}, hat ${have}` })
  }
  for (const [key, f] of found) {
    if (expected.get(key)?.want) continue
    const base = { key, kind: f.kind, id: f.id, name: f.name, have: f.right, want: '', roles: [], perms: f.perms }
    if (f.right === 'Besitzer') items.push({ ...base, status: 'besitzer', text: `${label(f)}: Besitzer (bleibt)` })
    else if (key === mine) items.push({ ...base, status: 'ich', text: `${label(f)} (du selbst): ${f.right} – bleibt, damit du dich nicht aussperrst` })
    else if (f.kind === 'link') items.push({ ...base, status: 'link', text: `${f.name}: ${f.right} – sollte weg` })
    else items.push({ ...base, status: 'zuviel', text: `${label(f)} hat ${f.right}, braucht keinen Zugriff${f.kind === 'siteGroup' ? ' (alle in dieser Gruppe der Website)' : ''}` })
  }
  // Wer nicht Besitzer ist, bekommt von Graph nur die eigenen Freigaben: dann ist das Bild unvollständig
  const partial = !perms.some((p) => rightOf(p.roles) === 'Besitzer')
  const ok = !partial && items.every((i) => ['ok', 'besitzer', 'ich'].includes(i.status))
  return { missing: false, partial, ok, items }
}

// Name unbekannt (Gruppe hat noch nirgends Rechte): gekürzte ID, dazu die Rollen
const shortId = (s) => (GUID.test(s) && String(s).length === 36 ? `${String(s).slice(0, 8)}…` : s)
const who = (e) => `${e.kind === 'user' ? 'Person' : 'Gruppe'} „${shortId(e.name || e.id)}“${e.roles?.length ? ` (${e.roles.join(', ')})` : ''}`

/** Namen der Gruppen aus allen gelesenen Freigaben (Graph liefert sie nur dort, wo die Gruppe Rechte hat). */
export function groupNames(permLists = []) {
  const out = new Map()
  for (const perms of permLists) for (const p of perms || []) {
    const pr = principalOf(p)
    if (pr.kind === 'group' && pr.id && pr.name && pr.name !== pr.id) out.set(pr.id, pr.name)
  }
  return out
}
const label = (f) => (f.kind === 'siteGroup' ? `Website-Gruppe „${f.name}“` : f.kind === 'group' ? `Gruppe „${f.name}“` : f.kind === 'user' ? `Person „${f.name}“` : f.name)

/**
 * Was zu tun ist, damit der Ordner passt.
 * → { create, grants: [{ key, kind, id, right, name }], removes: [{ permId, key, name, right }], anchor }
 *  anchor: Freigabe, die vor dem Entfernen noch einmal vergeben wird, um die Vererbung zu beenden
 *  (nur nötig, wenn sonst nichts vergeben wird). Besitzer, die eigene Person und unvollständige Bilder: nie.
 */
export function fixPlan(result) {
  const plan = { create: !!result?.missing, grants: [], removes: [], anchor: null }
  if (!result || result.partial) return plan
  for (const i of result.items) {
    if (i.status === 'fehlt' || i.status === 'zuwenig') plan.grants.push({ key: i.key, kind: i.kind, id: i.id, right: i.want, name: i.name })
    else if (i.status === 'zuviel' && i.want) {
      // zu viel bei einer Rolle: die höheren Freigaben weg, das richtige Recht (falls nicht schon da) neu
      for (const p of i.perms) if (LEVEL[p.right] > LEVEL[i.want] && p.right !== 'Besitzer') plan.removes.push({ permId: p.permId, key: i.key, name: i.name, right: p.right })
      if (!i.perms.some((p) => p.right === i.want)) plan.grants.push({ key: i.key, kind: i.kind, id: i.id, right: i.want, name: i.name })
    } else if (i.status === 'zuviel' || i.status === 'link') for (const p of i.perms) if (p.right !== 'Besitzer') plan.removes.push({ permId: p.permId, key: i.key, name: i.name, right: p.right })
  }
  if (plan.removes.length && !plan.grants.length) {
    const a = result.items.find((i) => i.status === 'ok' && i.want && i.have === i.want && (i.kind === 'group' || i.kind === 'user'))
    plan.anchor = a ? { key: a.key, kind: a.kind, id: a.id, right: a.want, name: a.name } : null
  }
  return plan
}

/** Kurzfassung eines Ordners für die Liste. */
export function summary(result) {
  if (!result) return { cls: '', text: 'nicht geprüft' }
  if (result.error) return { cls: 'warn', text: 'nicht lesbar' }
  if (result.partial) return { cls: 'warn', text: 'nur teilweise sichtbar' }
  const n = result.items.filter((i) => !['ok', 'besitzer', 'ich'].includes(i.status)).length
  if (result.missing) return { cls: 'warn', text: 'Ordner fehlt' }
  return n ? { cls: 'bad', text: n === 1 ? '1 Abweichung' : `${n} Abweichungen` } : { cls: 'ok', text: 'passt' }
}
