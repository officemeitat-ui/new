import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firstNumber, waNumber, waUrl } from '../src/core/whatsapp.js'

test('WhatsApp: Nummer mit Ländervorwahl, Schreibweisen aus Österreich und Deutschland', () => {
  assert.equal(waNumber('0664 123 45 67'), '436641234567')
  assert.equal(waNumber('+43 (0) 664 / 123 45-67'), '436641234567')
  assert.equal(waNumber('0043 664 1234567'), '436641234567')
  assert.equal(waNumber('+49 171 2345678'), '491712345678')
  assert.equal(waNumber('Mobil: 0699 11223344'), '4369911223344')
  assert.equal(waNumber('0171 2345678', '49'), '491712345678')
  assert.equal(waNumber(''), '')
  assert.equal(waNumber('12345'), '', 'zu kurz')
  assert.equal(waNumber('bitte anrufen'), '')
  assert.equal(firstNumber('', 'kein', '0664 1234567'), '436641234567')
})

test('WhatsApp: Link mit Text, ohne Nummer wählt man den Kontakt', () => {
  assert.equal(waUrl('0664 1234567', 'Hallo & Tour Mo 16.11.'), 'https://wa.me/436641234567?text=Hallo%20%26%20Tour%20Mo%2016.11.')
  assert.equal(waUrl('', 'Hi'), 'https://wa.me/?text=Hi')
  assert.equal(waUrl('0664 1234567'), 'https://wa.me/436641234567')
})

test('WhatsApp: Mitarbeiter-Sachen ja, Finanzen nie, Unbekanntes nicht', async () => {
  const { mayWhatsApp } = await import('../src/core/whatsapp.js')
  for (const k of ['wochenplan', 'plan-link', 'muellplan', 'matten-tour', 'fahrer-link', 'mitteilung']) assert.equal(mayWhatsApp(k), true, k)
  for (const k of ['rechnung', 'angebot', 'lieferschein', 'mahnung', 'auszahlung', 'lohn', 'kassenbuch']) assert.equal(mayWhatsApp(k), false, k)
  assert.equal(mayWhatsApp('irgendwas'), false)
})
