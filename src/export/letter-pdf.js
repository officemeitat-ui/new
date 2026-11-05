// Geschäftsbrief als PDF (pdfmake) auf dem Briefpapier der Fakturierung: Kopf, Anschriftfeld für das Fensterkuvert,
// Datum und Kundennummer rechts, Betreff, Text. Dazu das Sammel-PDF eines Serienbriefs zum Drucken: jeder Brief
// beginnt auf einer neuen Seite mit dem Briefpapier der ersten Seite, die Seitenzahl zählt je Brief.
// Briefe: core/letters.js, Briefpapier: export/letterhead.js, Kopf und Anschrift wie bei Rechnungen (invoice-pdf.js).

import { deDate, settingsOf } from '../core/invoicing.js'
import { addressAndFacts, logoBlock, senderBlock, shell } from './invoice-pdf.js'
import { pageSetup } from './letterhead.js'
import { inkColors } from './pdf-parts.js'

/** Inhalt eines Briefs (ohne Seitenrahmen). letter: Brief mit aufgelösten Platzhaltern (resolveLetter). */
function letterContent(letter, { page, sender, brand, logo, colors }) {
  const rec = letter.recipient || {}
  const facts = [
    ['Datum', deDate(letter.date)],
    ['Kundennummer', rec.customerNo || ''],
    ['Objekt', letter.objectName || ''],
    ['Bearbeitet von', letter.author || ''],
  ]
  return [
    page.head(logoBlock(logo, brand, sender, colors), senderBlock(sender, colors)),
    addressAndFacts({ recipient: { name: rec.name, address: rec.address } }, sender, facts, colors, page),
    { text: letter.subject || '', bold: true, fontSize: page.lh.fontSize + 2, color: colors.ink, margin: [0, 26, 0, 12] },
    // Brieftext etwas größer als die Belege (Grundgröße + 1 pt, Standard 10 pt)
    { text: String(letter.text || '').replace(/\r\n/g, '\n').replace(/\s+$/, ''), fontSize: page.lh.fontSize + 1, lineHeight: 1.25 },
  ].filter(Boolean)
}

/**
 * Ein Brief als pdfmake-Dokument. settings: Einstellungen der Fakturierung (Absender, Briefpapier), letterhead:
 * geladene Bilder (Standard: setLetterheadImages), logo wie bei den Belegen.
 */
export function letterDocument({ letter, settings = {}, brand = {}, logo = null, letterhead }) {
  const s = settingsOf({ settings })
  const page = pageSetup(s, { images: letterhead, colors: inkColors(brand) })
  const sender = s.sender
  const content = letterContent(letter, { page, sender, brand, logo, colors: page.colors })
  return shell(content, { title: `Brief: ${letter.subject || ''}`.trim(), sender, bank: s.bank, colors: page.colors, draft: false, page })
}

/**
 * Mehrere Briefe in einem PDF (Serienbrief zum Drucken). starts: erste Seite jedes Briefs (pageStarts aus den
 * Seitenzahlen der einzelnen Briefe); ohne starts zählt die Seitenzahl über das ganze PDF und nur die allererste
 * Seite hat das Briefpapier der ersten Seite.
 */
export function lettersDocument({ letters = [], settings = {}, brand = {}, logo = null, letterhead, starts = null, title = 'Serienbrief' }) {
  const s = settingsOf({ settings })
  const page = pageSetup(s, { images: letterhead, colors: inkColors(brand), starts })
  const sender = s.sender
  const content = letters.flatMap((l, i) => page.wrap(letterContent(l, { page, sender, brand, logo, colors: page.colors }), { pageBreak: i > 0 }))
  return shell(content, { title, sender, bank: s.bank, colors: page.colors, draft: false, page: { ...page, wrap: (c) => c } })
}
