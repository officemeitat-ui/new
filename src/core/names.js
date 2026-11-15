// Namen aus eingefügten Listen zuordnen (Unterweisungen, Schlüsselliste): Groß/klein, Akzente und Leerzeichen
// egal, „Nachname Vorname“, fehlende Namensteile und ein, zwei vertippte Buchstaben – aber nur, wenn es eindeutig ist.

/** Vergleichsschlüssel: nur Buchstaben und Ziffern, klein, ohne Akzente („Öznur Kandemir“ → „oznurkandemir“). */
export const nameKey = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')

/** Schlüssel für Überschriften: wie nameKey, „ue“ wie „ü“ („Durchgefuehrt von“ = „durchgeführt von“). */
export const headKey = (s) => nameKey(s).replace(/ue/g, 'u')

export function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

/**
 * Zuordnung zu einem geschriebenen Namen: genau (auch „Nachname Vorname“), sonst eindeutig ähnlich – alle Namensteile
 * kommen vor („Ion Kast“ → „Ion Constantin Kast“) oder ein, zwei Buchstaben anders („Mariana“ → „Marianna“).
 * list: [{ name, … }] oder mit names(item) → mehrere Schreibweisen je Eintrag (z. B. Name und Kurzname eines Objekts).
 * → (geschrieben) => { emp: Eintrag, exact } oder null (auch wenn mehrere passen würden).
 */
export function nameMatcher(list = [], names = (x) => [x.name]) {
  const people = list.map((item) => {
    const keys = new Set()
    const partSets = []
    for (const n of names(item)) {
      const parts = String(n || '').trim().split(/\s+/).map(nameKey).filter(Boolean)
      if (!parts.length) continue
      partSets.push(parts)
      keys.add(parts.join(''))
      if (parts.length >= 2) {
        keys.add([...parts.slice(1), parts[0]].join(''))
        keys.add([parts.at(-1), ...parts.slice(0, -1)].join(''))
      }
    }
    return { emp: item, partSets, keys: [...keys] }
  })
  const exact = new Map()
  for (const p of people) for (const k of p.keys) if (!exact.has(k)) exact.set(k, p.emp)
  const only = (hits) => (hits.length === 1 ? { emp: hits[0].emp, exact: false } : null)
  return (written) => {
    const parts = String(written || '').trim().split(/\s+/).map(nameKey).filter(Boolean)
    const key = parts.join('')
    if (!key) return null
    if (exact.has(key)) return { emp: exact.get(key), exact: true }
    if (parts.length >= 2) {
      const sub = only(people.filter((p) => p.partSets.some((set) => parts.every((x) => set.includes(x)))))
      if (sub) return sub
    }
    const limit = key.length >= 14 ? 2 : key.length >= 6 ? 1 : 0
    if (!limit) return null
    let best = Infinity
    let hits = []
    for (const p of people) {
      if (!p.keys.length) continue
      const d = Math.min(...p.keys.map((k) => editDistance(key, k)))
      if (d < best) [best, hits] = [d, [p]]
      else if (d === best) hits.push(p)
    }
    return best <= limit ? only(hits) : null
  }
}
