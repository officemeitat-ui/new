// Kleiner XML-Leser (ohne DOM, läuft im Browser und in Node): genug für E-Rechnungen (ZUGFeRD/Factur-X/
// XRechnung als CII oder UBL) und Tabellen-Exporte. Namensräume werden ignoriert (nur der lokale Name zählt).

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
export const unescapeXml = (s) =>
  String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENT[e.toLowerCase()] ?? m
  })

const local = (name) => name.slice(name.indexOf(':') + 1)

/** XML-Text → Wurzelknoten { name, attrs, children, text } (name ohne Präfix). Wirft bei kaputtem XML. */
export function parseXml(text) {
  const s = String(text || '').replace(/^﻿/, '')
  const root = { name: '#root', attrs: {}, children: [], text: '' }
  const stack = [root]
  let i = 0
  while (i < s.length) {
    const lt = s.indexOf('<', i)
    if (lt < 0) {
      stack.at(-1).text += unescapeXml(s.slice(i))
      break
    }
    if (lt > i) stack.at(-1).text += unescapeXml(s.slice(i, lt))
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4)
      i = end < 0 ? s.length : end + 3
    } else if (s.startsWith('<![CDATA[', lt)) {
      const end = s.indexOf(']]>', lt + 9)
      stack.at(-1).text += s.slice(lt + 9, end < 0 ? s.length : end)
      i = end < 0 ? s.length : end + 3
    } else if (s[lt + 1] === '?' || s[lt + 1] === '!') {
      const end = s.indexOf('>', lt + 1)
      i = end < 0 ? s.length : end + 1
    } else if (s[lt + 1] === '/') {
      const end = s.indexOf('>', lt)
      const name = local(s.slice(lt + 2, end).trim())
      // bis zum passenden offenen Element schließen (verzeiht fehlende Endtags)
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k
          break
        }
      }
      i = end < 0 ? s.length : end + 1
    } else {
      // Tag mit Attributen; „>“ in Attributwerten beachten
      let j = lt + 1
      let quote = ''
      while (j < s.length) {
        const ch = s[j]
        if (quote) {
          if (ch === quote) quote = ''
        } else if (ch === '"' || ch === "'") quote = ch
        else if (ch === '>') break
        j++
      }
      const raw = s.slice(lt + 1, j)
      const selfClose = raw.endsWith('/')
      const body = selfClose ? raw.slice(0, -1) : raw
      const m = /^([^\s/>]+)/.exec(body)
      if (!m) throw new Error(`XML: ungültiges Element an Stelle ${lt}`)
      const node = { name: local(m[1]), attrs: {}, children: [], text: '' }
      for (const a of body.slice(m[1].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) node.attrs[local(a[1])] = unescapeXml(a[3] ?? a[4] ?? '')
      stack.at(-1).children.push(node)
      if (!selfClose) stack.push(node)
      i = j + 1
    }
  }
  const top = root.children.find((c) => c.name)
  if (!top) throw new Error('XML: kein Inhalt')
  return top
}

/** Kinder mit Namen (lokal), auch über einen Pfad „A/B/C“. */
export function findAll(node, path) {
  let list = [node]
  for (const part of String(path).split('/').filter(Boolean)) list = list.flatMap((n) => (n?.children || []).filter((c) => c.name === part))
  return list
}
export const find = (node, path) => findAll(node, path)[0] || null
/** Text eines Pfads (getrimmt) oder ''. */
export const textAt = (node, path) => (find(node, path)?.text || '').trim()
/** Alle Nachfahren mit Namen (Tiefensuche). */
export function descendants(node, name, out = []) {
  for (const c of node?.children || []) {
    if (c.name === name) out.push(c)
    descendants(c, name, out)
  }
  return out
}
