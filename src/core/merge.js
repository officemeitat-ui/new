// Dreiwege-Zusammenführung für gleichzeitiges Bearbeiten (zwei Disponent:innen
// speichern dieselbe Datei). base = zuletzt gemeinsamer Stand, local = eigene
// Änderungen, remote = Stand der anderen Person. Eigene Änderungen gewinnen
// nur dort, wo sie tatsächlich geändert wurden.
//
//   Listen mit id     je Eintrag; ändern beide denselben Eintrag, wird er Feld
//                     für Feld zusammengeführt; eine fremde Änderung schlägt
//                     ein eigenes Löschen (sonst ginge sie still verloren);
//                     eigene Umsortierung bleibt
//   Listen ohne id    als Menge (Texte, Protokolleinträge, Einteilungen): eigene
//                     Zugänge und Abgänge auf den fremden Stand
//   unbekannte Basis  bei Einträgen, die beide haben, gilt der gespeicherte Stand
//                     (ebenso, wenn beide denselben Eintrag neu anlegen, z. B. eine
//                     Standard-Checkliste)

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v)
const isEntityArray = (v) => Array.isArray(v) && v.every((x) => isPlainObject(x) && 'id' in x)

function mergeEntityArrays(base, local = [], remote = []) {
  const byId = (list) => new Map(list.map((x) => [x.id, x]))
  const b = byId(base || [])
  const l = byId(local)
  const r = byId(remote)
  // Reihenfolge: lokal umsortiert → lokale Reihenfolge, sonst die fremde; Neues der anderen Seite hinten an
  const order = (list) => list.filter((x) => b.has(x.id)).map((x) => x.id)
  const resorted = base && !same(order(local), order(base).filter((id) => l.has(id)))
  const ids = [...new Set(resorted ? [...local.map((x) => x.id), ...remote.map((x) => x.id)] : [...remote.map((x) => x.id), ...local.map((x) => x.id)])]
  const out = []
  for (const id of ids) {
    const bv = b.get(id)
    const lv = l.get(id)
    const rv = r.get(id)
    if (lv !== undefined && rv !== undefined) {
      out.push(b.has(id) ? mergeDoc(bv, lv, rv) : rv) // beide neu bzw. Basis unbekannt: gespeicherter Stand
      continue
    }
    if (lv !== undefined) {
      // nur lokal vorhanden: neu oder von der anderen Seite gelöscht
      if (!b.has(id) || !same(bv, lv)) out.push(lv) // lokal neu oder geändert → bleibt
      continue
    }
    // nur fremd vorhanden: dort neu, oder lokal gelöscht
    if (!b.has(id) || !same(bv, rv)) out.push(rv) // fremd neu oder fremd geändert → bleibt
  }
  return out
}

function mergeSets(base, local, remote) {
  const key = (x) => JSON.stringify(x)
  const b = new Set(base.map(key))
  const l = new Set(local.map(key))
  const removed = new Set([...b].filter((k) => !l.has(k)))
  const out = remote.filter((x) => !removed.has(key(x)))
  const have = new Set(out.map(key))
  for (const x of local) if (!b.has(key(x)) && !have.has(key(x))) out.push(x), have.add(key(x))
  return out
}

export function mergeDoc(base, local, remote) {
  if (same(local, base)) return remote
  if (same(remote, base) || same(local, remote)) return local
  if (local === undefined && base !== undefined) return remote // lokal gelöscht, fremd geändert → fremde Änderung bleibt
  if (isEntityArray(local) && isEntityArray(remote) && (base === undefined || isEntityArray(base))) return mergeEntityArrays(base, local, remote)
  if (Array.isArray(local) && Array.isArray(remote) && Array.isArray(base)) return mergeSets(base, local, remote)
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
