// SEPA-Überweisungsauftrag als Datei (ISO 20022 pain.001, „Customer Credit Transfer Initiation“) für das
// Business-Banking (George Business, ELBA, BusinessNet …): ausgewählte Eingangsrechnungen in einem Sammelauftrag.
// Standard ist pain.001.001.09 (SEPA-Regelwerk ab November 2025), auf Wunsch die ältere Fassung pain.001.001.03.
// Reine Funktion, getestet in test/sepa-transfer.test.js.
//
// Regeln (EPC SEPA Credit Transfer Implementation Guidelines, Stuzza):
//  - Zeichensatz: lateinische Grundzeichen a–z A–Z 0–9 / - ? : ( ) . , ' + und Leerzeichen; Umlaute werden umschrieben
//    (ä → ae …), alles andere entfällt.
//  - Längen: Namen 70, Verwendungszweck 140, Kennungen (MsgId, PmtInfId, EndToEndId) 35 Zeichen.
//  - Beträge in Euro mit zwei Nachkommastellen, 0,01 bis 999.999.999,99; CtrlSum = Summe aller Beträge.
//  - IBAN mit Prüfziffer (mod 97); BIC optional (innerhalb des EWR nicht nötig).

import { ibanValid, round2 } from './invoicing.js'

const MAP = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', '&': '+', é: 'e', è: 'e', á: 'a', à: 'a', ó: 'o', ú: 'u', í: 'i', č: 'c', š: 's', ž: 'z', ć: 'c', đ: 'd', Č: 'C', Š: 'S', Ž: 'Z' }

/** Text in den SEPA-Zeichensatz bringen und kürzen. */
export function sepaText(text, max = 140) {
  const s = String(text ?? '')
    .replace(/[äöüÄÖÜß&éèáàóúíčšžćđČŠŽ]/g, (ch) => MAP[ch])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s.slice(0, max).trim()
}

/** Kennung (MsgId, EndToEndId): nur Buchstaben, Ziffern und Bindestrich, höchstens 35 Zeichen. */
export const sepaId = (text) => String(text ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 35) || 'NOTPROVIDED'

const cleanIban = (s) => String(s || '').replace(/\s+/g, '').toUpperCase()
const cleanBic = (s) => String(s || '').replace(/\s+/g, '').toUpperCase()
export const bicValid = (bic) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(cleanBic(bic))
const xml = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch])
const amountText = (n) => round2(n).toFixed(2)
const cents = (n) => Math.round(round2(n) * 100)

/** Was gegen die Datei spricht: [Text]. Leer = in Ordnung. */
export function sepaProblems({ debtor = {}, payments = [], date = '' } = {}) {
  const out = []
  if (!sepaText(debtor.name, 70)) out.push('Name des Auftraggebers (eigene Firma) fehlt.')
  if (!ibanValid(debtor.iban)) out.push('Die IBAN des eigenen Kontos ist ungültig oder fehlt.')
  if (debtor.bic && !bicValid(debtor.bic)) out.push('Der BIC des eigenen Kontos ist ungültig.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) out.push('Ausführungsdatum fehlt.')
  if (!payments.length) out.push('Keine Zahlung ausgewählt.')
  for (const p of payments) {
    const who = p.name || p.ref || '?'
    if (!sepaText(p.name, 70)) out.push(`${who}: Name des Empfängers fehlt.`)
    if (!ibanValid(p.iban)) out.push(`${who}: IBAN ${p.iban ? `„${p.iban}“ ` : ''}ist ungültig oder fehlt.`)
    if (p.bic && !bicValid(p.bic)) out.push(`${who}: BIC „${p.bic}“ ist ungültig.`)
    const a = round2(p.amount)
    if (!(a >= 0.01) || a > 999999999.99) out.push(`${who}: Betrag ${String(p.amount)} ist nicht möglich.`)
  }
  return out
}

/**
 * Überweisungsdatei erzeugen. debtor: { name, iban, bic }; payments: [{ id, name, iban, bic, amount, text, ref }];
 * date: Ausführungstag (JJJJ-MM-TT); msgId: eindeutige Kennung des Auftrags; version '09' (Standard) oder '03'.
 * Liefert { xml, count, sum, msgId } oder wirft mit allen Problemen.
 */
export function sepaTransfer({ debtor, payments, date, msgId, createdAt = new Date(), version = '09', batch = true }) {
  const problems = sepaProblems({ debtor, payments, date })
  if (problems.length) throw new Error(problems.join(' '))
  const v = version === '03' ? '03' : '09'
  const ns = `urn:iso:std:iso:20022:tech:xsd:pain.001.001.${v}`
  const count = payments.length
  const sum = payments.reduce((s, p) => s + cents(p.amount), 0) / 100
  const id = sepaId(msgId || `EK-${createdAt.toISOString().replace(/\D/g, '').slice(0, 14)}`)
  const created = createdAt.toISOString().slice(0, 19)
  const bicTag = v === '09' ? 'BICFI' : 'BIC'
  const agent = (bic) => (bic ? `<FinInstnId><${bicTag}>${xml(cleanBic(bic))}</${bicTag}></FinInstnId>` : '<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>')
  const exec = v === '09' ? `<ReqdExctnDt><Dt>${date}</Dt></ReqdExctnDt>` : `<ReqdExctnDt>${date}</ReqdExctnDt>`
  const name = xml(sepaText(debtor.name, 70))
  const tx = payments
    .map((p, i) => {
      const e2e = sepaId(p.ref || p.id || `${id}-${i + 1}`)
      return [
        '<CdtTrfTxInf>',
        `<PmtId><InstrId>${xml(sepaId(`${id.slice(0, 30)}-${i + 1}`))}</InstrId><EndToEndId>${xml(e2e)}</EndToEndId></PmtId>`,
        `<Amt><InstdAmt Ccy="EUR">${amountText(p.amount)}</InstdAmt></Amt>`,
        p.bic ? `<CdtrAgt>${agent(p.bic)}</CdtrAgt>` : '',
        `<Cdtr><Nm>${xml(sepaText(p.name, 70))}</Nm></Cdtr>`,
        `<CdtrAcct><Id><IBAN>${xml(cleanIban(p.iban))}</IBAN></Id></CdtrAcct>`,
        sepaText(p.text) ? `<RmtInf><Ustrd>${xml(sepaText(p.text, 140))}</Ustrd></RmtInf>` : '',
        '</CdtTrfTxInf>',
      ].join('')
    })
    .join('\n      ')
  const doc = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="${ns}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${xml(id)}</MsgId>
      <CreDtTm>${created}</CreDtTm>
      <NbOfTxs>${count}</NbOfTxs>
      <CtrlSum>${amountText(sum)}</CtrlSum>
      <InitgPty><Nm>${name}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${xml(sepaId(`${id.slice(0, 32)}-1`))}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>${batch ? 'true' : 'false'}</BtchBookg>
      <NbOfTxs>${count}</NbOfTxs>
      <CtrlSum>${amountText(sum)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      ${exec}
      <Dbtr><Nm>${name}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${xml(cleanIban(debtor.iban))}</IBAN></Id></DbtrAcct>
      <DbtrAgt>${agent(debtor.bic)}</DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      ${tx}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`
  return { xml: doc, count, sum, msgId: id }
}

export const sepaFileName = (date, msgId) => `Ueberweisungen_${date}_${sepaId(msgId).slice(-8)}.xml`
