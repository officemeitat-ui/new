// Beispieldaten für den Posteingang (Browser-Modus, erfunden): ein „Beispiel-Postfach“ mit Nachrichten als .eml-Text
// (läuft damit durch denselben Leser wie abgelegte Dateien) und eine kleine Ablage mit zwei bereits bearbeiteten
// Einträgen. Absender und Adressen sind ausgedacht (Domains .example), passend zu den Beispielkunden der Fakturierung.

// Ohne Import aus core/dates.js: Die Datei wird auch einzeln nachgeladen (Posteingang im Browser-Modus); ein
// gemeinsamer Import teilte sonst den Start der App in eine Datei mehr auf.
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const todayISO = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(new Date())

const utf8 = (s) => {
  const bytes = new TextEncoder().encode(s)
  let out = ''
  for (const b of bytes) out += String.fromCharCode(b)
  return out
}
const b64 = (s) => btoa(utf8(s))
const word = (s) => `=?UTF-8?B?${b64(s)}?=`
const wrap = (s, n = 76) => s.match(new RegExp(`.{1,${n}}`, 'g')).join('\r\n')

/** Text als quoted-printable (UTF-8), Zeilen höchstens 76 Zeichen. */
function qp(s) {
  const lines = []
  for (const line of s.split('\n')) {
    let enc = ''
    for (const ch of utf8(line)) {
      const c = ch.charCodeAt(0)
      enc += c > 126 || c === 61 ? `=${c.toString(16).toUpperCase().padStart(2, '0')}` : ch
    }
    let rest = enc
    while (rest.length > 75) {
      let cut = 75
      while (rest[cut - 1] === '=' || rest[cut - 2] === '=') cut--
      lines.push(`${rest.slice(0, cut)}=`)
      rest = rest.slice(cut)
    }
    lines.push(rest)
  }
  return lines.join('\r\n')
}

const rfcDate = (day, hm) => {
  const d = new Date(`${day}T${hm}:00+01:00`)
  return d.toUTCString().replace('GMT', '+0000')
}

/** Kleines PDF „Rechnung“ (eine Seite, Text). */
function invoicePdf(no) {
  const stream = `BT /F1 18 Tf 60 780 Td (Rechnung ${no}) Tj 0 -28 Td /F1 11 Tf (Hygiene-Grosshandel Beispiel GmbH, Industriestrasse 4, 5020 Salzburg) Tj 0 -18 Td (20 Kanister Allzweckreiniger 10 l) Tj 0 -18 Td (Netto 412,50 EUR, USt 20 % 82,50 EUR, Brutto 495,00 EUR) Tj ET`
  return `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`
}

function mail({ id, from, subject, date, text, html = '', attachments = [], plain = 'qp' }) {
  const head = [`From: ${from}`, 'To: Büro <office@reinigung-beispiel.example>', `Subject: ${subject}`, `Date: ${date}`, `Message-ID: <${id}@demo.example>`, 'MIME-Version: 1.0']
  const textPart = plain === 'b64' ? ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(text))] : ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', qp(text)]
  let body = textPart
  if (html) body = ['Content-Type: multipart/alternative; boundary="alt-' + id + '"', '', `--alt-${id}`, ...textPart, `--alt-${id}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', qp(html), `--alt-${id}--`]
  if (attachments.length)
    body = [
      `Content-Type: multipart/mixed; boundary="mix-${id}"`,
      '',
      'Dies ist eine Nachricht im MIME-Format.',
      `--mix-${id}`,
      ...body,
      ...attachments.flatMap((a) => [`--mix-${id}`, `Content-Type: ${a.type}; name="${a.name}"`, `Content-Disposition: attachment; filename="${a.name}"`, 'Content-Transfer-Encoding: base64', '', wrap(btoa(a.data))]),
      `--mix-${id}--`,
    ]
  return [...head, ...body, ''].join('\r\n')
}

/** Nachrichten des Beispiel-Postfachs als .eml-Text (neueste zuerst). */
export function demoMails(today = todayISO()) {
  const d = (n) => addDays(today, -n)
  return [
    mail({
      id: 'demo-rek-1',
      from: 'Paul Muster <objekte@hv-beispiel.example>',
      subject: 'Reklamation Stiegenhaus Wohnanlage Lehen',
      date: rfcDate(d(0), '07:42'),
      text: 'Sehr geehrte Damen und Herren,\n\ndas Stiegenhaus der Wohnanlage Lehen wurde gestern nicht gereinigt: im 2. und 3. Stock liegt Laub, die Glastür beim Eingang ist voller Fingerabdrücke.\nBitte um Nachreinigung bis morgen und kurze Rückmeldung.\n\nMit freundlichen Grüßen\nPaul Muster\nHausverwaltung Beispiel GmbH\nTel. 0662 000 001',
      html: '<p>Sehr geehrte Damen und Herren,</p><p>das Stiegenhaus der <b>Wohnanlage Lehen</b> wurde gestern nicht gereinigt: im 2. und 3. Stock liegt Laub, die Glastür beim Eingang ist voller Fingerabdrücke.<br>Bitte um Nachreinigung bis morgen und kurze Rückmeldung.</p><p>Mit freundlichen Grüßen<br>Paul Muster</p>',
    }),
    mail({
      id: 'demo-krank-1',
      from: 'Markus Huber <markus.huber@mail.example>',
      subject: 'Krankmeldung',
      date: rfcDate(d(0), '06:10'),
      text: 'Hallo,\n\nich bin ab heute krank und kann nicht in die Arbeit kommen. Die Bestätigung schicke ich nach.\n\nLG Markus',
    }),
    mail({
      id: 'demo-zusatz-1',
      from: 'Max Beispiel <rechnung@autohaus-beispiel.example>',
      subject: word('Zusätzliche Grundreinigung Schauraum'),
      date: rfcDate(d(1), '16:05'),
      plain: 'b64',
      text: 'Guten Tag,\n\nkönnten Sie zusätzlich zur laufenden Reinigung eine Grundreinigung des Schauraums im Autohaus Maxglan machen? Am besten an einem Samstag, wenn wir geschlossen haben.\nBitte um ein kurzes Angebot.\n\nDanke und schöne Grüße\nMax Beispiel',
    }),
    mail({
      id: 'demo-anfrage-1',
      from: 'Sabine Leitgeb <office@kanzlei-leitgeb.example>',
      subject: 'Anfrage Büroreinigung',
      date: rfcDate(d(1), '11:20'),
      text: 'Sehr geehrte Damen und Herren,\n\nwir suchen für unsere Kanzlei in der Linzer Gasse 12, 5020 Salzburg (rund 180 m², 6 Büros, Besprechungsraum, Küche, 2 WC) eine Reinigungsfirma, zweimal pro Woche am Abend.\nBitte um ein unverbindliches Angebot und einen Termin zur Besichtigung.\n\nMit freundlichen Grüßen\nMag. Sabine Leitgeb\nKanzlei Leitgeb\nTel. 0662 555 0101',
    }),
    mail({
      id: 'demo-rechnung-1',
      from: '"Hygiene-Großhandel Beispiel" <rechnung@hygiene-beispiel.example>',
      subject: 'Ihre Rechnung 2026-1187',
      date: rfcDate(d(2), '09:30'),
      text: 'Sehr geehrte Kundin, sehr geehrter Kunde,\n\nim Anhang erhalten Sie die Rechnung 2026-1187 zu Ihrer Bestellung.\nZahlbar innerhalb von 30 Tagen, bei Zahlung binnen 10 Tagen 2 % Skonto.\n\nIhr Team vom Hygiene-Großhandel',
      attachments: [{ name: 'Rechnung_2026-1187.pdf', type: 'application/pdf', data: invoicePdf('2026-1187') }],
    }),
    mail({
      id: 'demo-termin-1',
      from: 'Paul Muster <objekte@hv-beispiel.example>',
      subject: 'Termin Begehung Versicherungsbüro Lehen',
      date: rfcDate(d(2), '14:12'),
      text: `Hallo,\n\nkönnen wir für das Versicherungsbüro Lehen eine gemeinsame Begehung machen? Mir würde ${addDays(today, 8).split('-').reverse().join('.')} um 10:00 Uhr passen.\n\nLG Paul Muster`,
    }),
    mail({
      id: 'demo-kuendigung-1',
      from: 'Max Beispiel <rechnung@autohaus-beispiel.example>',
      subject: 'Kündigung Reinigungsvertrag',
      date: rfcDate(d(3), '10:01'),
      text: 'Sehr geehrte Damen und Herren,\n\nhiermit kündigen wir den Reinigungsvertrag für das Autohaus Maxglan fristgerecht zum nächstmöglichen Termin. Grund: Wir übersiedeln den Standort.\nBitte um schriftliche Bestätigung.\n\nMit freundlichen Grüßen\nMax Beispiel',
    }),
    mail({
      id: 'demo-bewerbung-1',
      from: `${word('Jelena Marić')} <j.maric@mail.example>`,
      subject: 'Bewerbung als Reinigungskraft',
      date: rfcDate(d(3), '19:45'),
      text: 'Sehr geehrte Damen und Herren,\n\nich bewerbe mich als Reinigungskraft in Teilzeit (etwa 20 Stunden pro Woche) im Raum Salzburg Stadt. Ich habe drei Jahre Erfahrung in der Büroreinigung und einen Führerschein B.\nIch freue mich auf Ihre Rückmeldung.\n\nJelena Marić\nTel. 0660 000 0042',
    }),
    mail({
      id: 'demo-newsletter-1',
      from: 'Branchenbrief <newsletter@reinigungsbrief.example>',
      subject: 'Newsletter November: Neuheiten aus der Branche',
      date: rfcDate(d(4), '08:00'),
      text: 'Lesen Sie in dieser Ausgabe: neue Normen für Hygieneartikel, Messe-Rückblick und Tipps für den Winter.\nAbmelden: Link am Ende dieser Nachricht.',
    }),
  ]
}

/** Ablage des Posteingangs mit zwei bearbeiteten Einträgen (ohne Mailtext, wie im Betrieb). */
export function createPosteingangDemo(today = todayISO()) {
  const at = (n, hm) => `${addDays(today, -n)}T${hm}:00.000Z`
  return {
    items: [
      { id: 'pe-demo00000000001', msgId: 'demo-alt-1@demo.example', source: 'graph', from: 'Paul Muster <objekte@hv-beispiel.example>', subject: 'Rückfrage Leistungsnachweis Oktober', date: at(9, '08:15'), art: 'sonstiges', artBy: 'person', status: 'erledigt', seenAt: at(9, '08:20'), seenBy: 'Beispieldaten', by: 'Beispieldaten', at: at(8, '09:00') },
      { id: 'pe-demo00000000002', msgId: 'demo-alt-2@demo.example', source: 'graph', from: 'Werbung <info@werbung.example>', subject: 'Sonderangebot Arbeitskleidung', date: at(7, '12:00'), art: 'sonstiges', artBy: 'regel', status: 'ignoriert', seenAt: at(7, '12:05'), seenBy: 'Beispieldaten', by: 'Beispieldaten', at: at(7, '12:06') },
    ],
    settings: {},
  }
}
