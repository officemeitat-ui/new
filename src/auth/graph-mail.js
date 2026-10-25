// E-Mail mit Anhang über Microsoft Graph senden (aus dem Postfach der
// angemeldeten Person oder aus einem freigegebenen Postfach, z. B.
// dienstplan@firma.at). Braucht die delegierte Berechtigung Mail.Send bzw.
// Mail.Send.Shared (siehe docs/EINRICHTUNG.md).

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const recipients = (list) => (Array.isArray(list) ? list : String(list || '').split(/[,;\s]+/)).filter(Boolean).map((address) => ({ emailAddress: { address } }))

/**
 * @param getToken  Funktion, die ein Graph-Token liefert
 * @param mail      { to, cc?, bcc?, subject, text, attachments: [{ name, blob, type }] }; to/cc/bcc: Adresse, Liste oder „a@x.at, b@y.at“
 * @param from      optional: freigegebenes Postfach
 */
export async function sendMail(getToken, { to, cc = [], bcc = [], subject, text, attachments = [] }, { from = '', fetchImpl = fetch } = {}) {
  const message = {
    subject,
    body: { contentType: 'Text', content: text },
    toRecipients: recipients(to),
    ...(recipients(cc).length ? { ccRecipients: recipients(cc) } : {}),
    ...(recipients(bcc).length ? { bccRecipients: recipients(bcc) } : {}),
    attachments: await Promise.all(
      attachments.map(async (a) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.type || a.blob.type || 'application/pdf', contentBytes: await blobToBase64(a.blob) })),
    ),
  }
  const url = from ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail` : 'https://graph.microsoft.com/v1.0/me/sendMail'
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).error?.message || ''
    } catch {
      /* keine Details */
    }
    if (res.status === 403) throw new Error(`Keine Berechtigung zum Senden (Mail.Send${from ? '.Shared' : ''} freigeben). ${detail}`)
    throw new Error(`E-Mail nicht gesendet (${res.status}). ${detail}`)
  }
}
