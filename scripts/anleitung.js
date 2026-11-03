#!/usr/bin/env node
// Anleitung als Markdown: docs/ANLEITUNG.md aus den Hilfe-Themen (src/help/topics.js), dieselben
// Texte wie in der App (Ansicht „Anleitung“) und bei Cleo. Aufruf: npm run anleitung
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GLOSSARY, TOPICS } from '../src/help/topics.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const CHAPTERS = [
  ['start', 'Start & Übersicht'],
  ['planung', 'Planung'],
  ['einsatz', 'Einsätze & Zeiten'],
  ['objekte', 'Objekte & Kunden'],
  ['betrieb', 'Material & Fuhrpark'],
  ['finanzen', 'Finanzen'],
  ['verwaltung', 'Verwaltung'],
  ['allgemein', 'Bedienung & Allgemeines'],
]

// Bezeichnungen der Ansichten aus den registerView-Aufrufen (ohne Browser)
export function viewLabels(dir = join(root, 'src/ui')) {
  const labels = {}
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (p.endsWith('.js'))
        for (const m of readFileSync(p, 'utf8').matchAll(/registerView\(\{[\s\S]*?id: '([^']+)'[\s\S]*?label: '([^']+)'/g)) labels[m[1]] ||= m[2]
    }
  }
  walk(dir)
  return labels
}

export function markdown(topics = TOPICS, glossary = GLOSSARY, labels = viewLabels()) {
  const out = []
  const anchor = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  out.push('# Cleanos App – Anleitung', '')
  out.push('Alle Funktionen der Cleanos App, kurz erklärt und Schritt für Schritt. Dieselben Texte stehen in der App unter **Anleitung** (Menü ganz oben); Cleo, das Maskottchen unten rechts, beantwortet Fragen dazu direkt – auch ohne Internet. Was eine Rolle nicht sehen darf, zeigt die App ihr nicht an.', '')
  out.push(`*Erzeugt aus \`src/help/topics.js\` mit \`npm run anleitung\` · ${topics.length} Themen, ${glossary.length} Begriffe.*`, '')
  out.push('## Inhalt', '')
  for (const [id, label] of CHAPTERS) {
    const n = topics.filter((t) => t.section === id).length
    if (n) out.push(`- [${label}](#${anchor(label)}) (${n})`)
  }
  out.push('- [Begriffe](#begriffe)', '')
  for (const [id, label] of CHAPTERS) {
    const list = topics.filter((t) => t.section === id)
    if (!list.length) continue
    out.push(`## ${label}`, '')
    for (const t of list) {
      out.push(`### ${t.title}`, '')
      if (t.view && labels[t.view]) out.push(`*In der App: ${labels[t.view]}*`, '')
      out.push(t.answer, '')
      if (t.steps?.length) {
        t.steps.forEach((s, i) => out.push(`${i + 1}. ${s}`))
        out.push('')
      }
      if (t.tips?.length) {
        for (const s of t.tips) out.push(`> Tipp: ${s}`)
        out.push('')
      }
      if (t.roles) out.push(`*${t.roles}*`, '')
    }
  }
  out.push('## Begriffe', '')
  for (const g of [...glossary].sort((a, b) => a.term.localeCompare(b.term, 'de'))) out.push(`- **${g.term}:** ${g.text}`)
  out.push('')
  return out.join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(root, 'docs/ANLEITUNG.md'), markdown())
  console.log(`docs/ANLEITUNG.md geschrieben: ${TOPICS.length} Themen, ${GLOSSARY.length} Begriffe.`)
}
