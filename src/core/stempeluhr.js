// Stempeluhr am Tablet (mein-plan.php?tablet=…): für Objekte, in denen die Leute kein eigenes Handy benutzen.
// Im Objekt hängt ein Tablet (oder ein altes Handy); jede Person tippt ihre PIN, sieht ihren Namen und tippt
// „Kommen“ bzw. „Gehen“. Es entstehen dieselben Stempelungen wie mit dem QR-Code (core/timeclock.js).
//
// Gespeichert bei den Regeln (rules.portal): tablets { Objekt-ID: Code des Tablets }, pins { Mitarbeiter-ID: PIN }.
// Der Webspace bekommt nur Hashwerte (zeiterfassung.tablet in privat/mitarbeiter.json):
//   geraete { SHA-256(Code): { id, name } }
//   pins    { SHA-256(„Schlüssel:PIN“): { hash: SHA-256(Link-Code der Person), name } }
// Der Code des Tablets wirkt wie ein Passwort (Einrichtungs-Link, einmal am Tablet geöffnet).

import { isLang } from './sprachen.js'
import { sha256Hex } from './staffplan.js'

export const PIN_LENGTH = 4

const validPin = (pin) => typeof pin === 'string' && /^[1-9]\d{3}$/.test(pin)

/** Leicht zu erraten: lauter gleiche Ziffern, zwei gleiche Paare (1212), Reihen (1234, 4321, 2468), Jahreszahlen. */
export function weakPin(pin) {
  const d = [...String(pin)].map(Number)
  if (d.length !== PIN_LENGTH || d.some((x) => !Number.isInteger(x))) return true
  if (new Set(d).size === 1) return true
  if (d[0] === d[2] && d[1] === d[3]) return true
  if (d[0] === d[3] && d[1] === d[2]) return true
  const step = d[1] - d[0]
  if (step !== 0 && d[2] - d[1] === step && d[3] - d[2] === step) return true
  const n = Number(pin)
  return n >= 1930 && n <= 2039
}

/** Neue PIN (4 Ziffern, die erste nicht 0), die noch niemand hat und die nicht leicht zu erraten ist. */
export function newPin(taken = new Set(), random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  for (let i = 0; i < 5000; i++) {
    const b = random(2)
    const n = (b[0] << 8) | b[1]
    if (n >= 63000) continue // 63000 = 7 × 9000: jede PIN gleich wahrscheinlich
    const pin = String(1000 + (n % 9000))
    if (!taken.has(pin) && !weakPin(pin)) return pin
  }
  throw new Error('Keine freie PIN gefunden.')
}

/**
 * PINs für genau diese Personen: vorhandene gültige bleiben, wer keine hat, bekommt eine; PINs anderer (ausgetreten,
 * ohne Link) fallen weg. Jede PIN gibt es nur einmal.
 */
export function completePins(pins = {}, empIds = [], random) {
  const out = {}
  const taken = new Set()
  for (const id of empIds) {
    if (!validPin(pins[id]) || taken.has(pins[id])) continue
    out[id] = pins[id]
    taken.add(pins[id])
  }
  for (const id of empIds) {
    if (out[id]) continue
    out[id] = newPin(taken, random)
    taken.add(out[id])
  }
  return out
}

/** Einrichtungs-Link für ein Tablet (einmal am Tablet öffnen, es merkt sich den Code). */
export const tabletLink = (address, code) => `${String(address).replace(/\/?$/, '/')}mein-plan.php?tablet=${encodeURIComponent(code)}`

/**
 * Teil „tablet“ der Einstellungen für den Webspace, nur Hashwerte; null ohne Tablet. employees: wer stempeln darf
 * (mit persönlichem Link und PIN); Tablets gelöschter Objekte fallen weg.
 */
export async function tabletFile({ portal, employees = [], objects = [], sha = sha256Hex }) {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const geraete = {}
  for (const [id, code] of Object.entries(portal.tablets || {})) {
    if (byId.has(id) && typeof code === 'string' && code.length >= 16) geraete[await sha(code)] = { id, name: byId.get(id).name }
  }
  if (!Object.keys(geraete).length || !portal.key) return null
  const pins = {}
  for (const e of employees) {
    const pin = portal.pins?.[e.id]
    const code = portal.codes?.[e.id]
    if (!validPin(pin) || !code) continue
    pins[await sha(`${portal.key}:${pin}`)] = { hash: await sha(code), name: e.name }
  }
  return { pinLaenge: PIN_LENGTH, geraete, pins }
}

/** Wann sich ein Tablet zuletzt gemeldet hat (Unix-Sekunden) als Text mit Ton: ok, info oder warning. */
export function seenText(seen, now = Date.now() / 1000) {
  if (!(Number(seen) > 0)) return { text: 'noch nicht geöffnet', tone: 'info' }
  const min = Math.max(0, Math.floor((now - seen) / 60))
  if (min < 20) return { text: 'aktiv', tone: 'ok' }
  if (min < 120) return { text: `zuletzt vor ${min} Minuten`, tone: 'ok' }
  const h = Math.floor(min / 60)
  if (h < 48) return { text: `zuletzt vor ${h} Stunden`, tone: 'info' }
  return { text: `zuletzt vor ${Math.floor(h / 24)} Tagen`, tone: 'warning' }
}

const PIN_TEXTS = {
  de: {
    betreff: 'Deine PIN für die Stempeluhr',
    text: 'Hallo {name},\n\nfür die Stempeluhr am Tablet im Objekt ({produkt}) ist das deine PIN: {pin}\n\nPIN eintippen, deinen Namen prüfen, dann „Kommen erfassen“ tippen. Nach der Arbeit wieder die PIN eintippen und „Gehen erfassen“ tippen.\n\nDie PIN ist nur für dich, bitte gib sie niemandem weiter.',
  },
  bks: {
    betreff: 'Tvoj PIN za prijavu dolaska',
    text: 'Zdravo, {name},\n\nza prijavu dolaska i odlaska na tabletu u objektu ({produkt}) ovo je tvoj PIN: {pin}\n\nUkucaj PIN, provjeri svoje ime, zatim dodirni „Zabilježi dolazak“. Poslije posla ponovo ukucaj PIN i dodirni „Zabilježi odlazak“.\n\nPIN je samo za tebe, ne daji ga nikome.',
  },
  ro: {
    betreff: 'Codul tău PIN pentru pontaj',
    text: 'Bună, {name},\n\npentru pontajul pe tableta din obiectiv ({produkt}) acesta este codul tău PIN: {pin}\n\nTastează codul PIN, verifică numele tău, apoi atinge „Înregistrează sosirea”. După lucru tastează din nou codul PIN și atinge „Înregistrează plecarea”.\n\nCodul PIN este doar pentru tine, te rugăm să nu-l dai nimănui.',
  },
  tr: {
    betreff: 'Mesai kaydı için PIN kodun',
    text: 'Merhaba {name},\n\nobjedeki tablette mesai kaydı için ({produkt}) PIN kodun: {pin}\n\nPIN kodunu gir, adını kontrol et, sonra “Gelişi kaydet”e dokun. İşten sonra PIN kodunu tekrar gir ve “Çıkışı kaydet”e dokun.\n\nPIN sadece senin için, lütfen kimseyle paylaşma.',
  },
  hu: {
    betreff: 'A PIN-kódod az időrögzítéshez',
    text: 'Szia {name}!\n\nAz objektumban lévő táblagépen ({produkt}) ez a PIN-kódod az időrögzítéshez: {pin}\n\nÍrd be a PIN-kódot, ellenőrizd a nevedet, aztán koppints az „Érkezés rögzítése” gombra. Munka után írd be újra a PIN-kódot, és koppints a „Távozás rögzítése” gombra.\n\nA PIN-kód csak neked szól, kérjük, ne add oda senkinek.',
  },
  en: {
    betreff: 'Your PIN for the time clock',
    text: 'Hello {name},\n\nthis is your PIN for the time clock on the tablet at the site ({produkt}): {pin}\n\nEnter the PIN, check your name, then tap “Clock in”. After work enter the PIN again and tap “Clock out”.\n\nThe PIN is only for you, please do not share it.',
  },
}

const fill = (text, values) => text.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m))

/** Nachricht mit der PIN in der Sprache der Person: { subject, text }. */
export function pinMessage(lang, { name, pin, product }) {
  const t = PIN_TEXTS[isLang(lang) ? lang : 'de']
  const v = { name, pin, produkt: product }
  return { subject: fill(t.betreff, v), text: fill(t.text, v) }
}

export const PIN_MESSAGE_LANGS = Object.keys(PIN_TEXTS)
