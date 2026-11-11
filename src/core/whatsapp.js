// WhatsApp aus der App, ohne Konto bei Meta und ohne Kosten: der Link wa.me öffnet WhatsApp (App am Handy, WhatsApp
// Web bzw. Desktop am PC) mit fertigem Text, auf Wunsch gleich beim richtigen Kontakt. Senden tippt die Person selbst.
// Dateien (PDF) gehen am Handy über „Teilen“ (ui/whatsapp.js); wa.me selbst kann keine Anhänge.

/**
 * Telefonnummer für wa.me: nur Ziffern mit Ländervorwahl, ohne „+“ und führende Nullen.
 * „0664 123 45 67“ → „436641234567“ (Ländervorwahl country, Vorgabe Österreich), „+49 …“/„0049 …“ bleiben.
 * Unbrauchbar (zu kurz, zu lang, Buchstaben) → ''.
 */
export function waNumber(raw, country = '43') {
  let s = String(raw ?? '').trim()
  if (!s || /[a-z]/i.test(s.replace(/\b(tel|mobil|handy)\b\.?:?/gi, ''))) return ''
  s = s.replace(/\(0\)/g, '').replace(/[^\d+]/g, '')
  if (s.startsWith('+')) s = s.slice(1)
  else if (s.startsWith('00')) s = s.slice(2)
  else if (s.startsWith('0')) s = String(country) + s.slice(1)
  return /^[1-9]\d{7,14}$/.test(s) ? s : ''
}

/** Link zu WhatsApp mit Text; ohne (brauchbare) Nummer wählt die Person den Kontakt in WhatsApp. */
export const waUrl = (phone = '', text = '') => {
  const n = waNumber(phone)
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

/** Erste brauchbare Nummer aus mehreren Feldern (z. B. Mobil vor Telefon). */
export const firstNumber = (...list) => list.map((x) => waNumber(x)).find(Boolean) || ''

// ---------------------------------------------------------------- Was darf per WhatsApp hinaus?
// Entschieden am 11.11.2026: alles, was Mitarbeitende betrifft (Wochen- und Stundenpläne, Plan am Handy, Müllpläne,
// Touren, Mitteilungen, Unterweisungen), ja; alles aus den Finanzen nein – Rechnungen, Angebote, Lieferscheine,
// Mahnungen, Auszahlungen, Lohn, Kassenbuch, Eingangsrechnungen, Umsatzsteuer. Neue Knöpfe nennen ihre Art (kind).

export const WA_EMPLOYEE_KINDS = ['wochenplan', 'plan-link', 'muellplan', 'matten-tour', 'fahrer-link', 'mitteilung', 'unterweisung', 'bewerbung-link']
export const WA_FINANCE_KINDS = ['rechnung', 'angebot', 'lieferschein', 'mahnung', 'gutschrift', 'auszahlung', 'lohn', 'kassenbuch', 'eingangsrechnung', 'umsatzsteuer', 'sepa', 'steuerberatung']

/** Darf diese Art per WhatsApp geteilt werden? Finanzen nie; sonst nur, was ausdrücklich für Mitarbeitende freigegeben ist. */
export const mayWhatsApp = (kind) => !WA_FINANCE_KINDS.includes(kind) && WA_EMPLOYEE_KINDS.includes(kind)
