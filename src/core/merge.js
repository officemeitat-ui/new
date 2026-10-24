// Dreiwege-Zusammenführung für gleichzeitiges Bearbeiten (zwei Disponent:innen
// speichern dieselbe Datei). base = zuletzt gemeinsamer Stand, local = eigene
// Änderungen, remote = Stand der anderen Person. Eigene Änderungen gewinnen
// nur dort, wo sie tatsächlich geändert wurden.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v)
const isEntityArray = (v) => Array.isArray(v) && v.every((x) => isPlainObject(x) && 'id' in x)

function mergeEntityArrays(base = [], local = [], remote = []) {
  const byId = (list) => new Map(list.map((x) => [x.id, x]))
  const b = byId(base)
  const l = byId(local)
  const r = byId(remote)
  const ids = [...new Set([...remote.map((x) => x.id), ...local.map((x) => x.id)])]
  const out = []
  for (const id of ids) {
    const inBase = b.has(id)
    const lv = l.get(id)
    const rv = r.get(id)
    const localChanged = inBase ? !same(b.get(id), lv) : lv !== undefined
    if (localChanged) {
      if (lv !== undefined) out.push(lv) // lokal geändert oder neu
      continue // lokal gelöscht
    }
    if (rv !== undefined) out.push(rv)
  }
  return out
}

export function mergeDoc(base, local, remote) {
  if (same(local, base)) return remote
  if (same(remote, base)) return local
  if (isEntityArray(local) && isEntityArray(remote) && (base === undefined || isEntityArray(base))) return mergeEntityArrays(base, local, remote)
  if (isPlainObject(local) && isPlainObject(remote)) {
    const b = isPlainObject(base) ? base : {}
    const out = {}
    for (const key of new Set([...Object.keys(remote), ...Object.keys(local)])) {
      const merged = mergeDoc(b[key], local[key], remote[key])
      if (merged !== undefined) out[key] = merged
    }
    return out
  }
  return local
}
