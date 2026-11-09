// Mattenwechsel im Kundenbereich: was der Webspace je Link bekommt – Lieferscheine (PDF ohne Preise, wie beim Versand)
// und der nächste Wechsel je Liegeplatz (nur der Tag). Später geladen mit dem Paket des Büros (views/lazy-buero.js);
// der Kundenbereich (views/customer-portal.js, immer geladen) ruft es über portalHooks auf, damit der Start schlank
// bleibt. Rechte prüft der Kundenbereich vor dem Aufruf (Fakturierung bzw. Mattenwechsel lesen).
// Rechenkern: core/customer-matten.js.

import { nextExchanges, noteEntry, noteSigText, portalNotes } from '../../core/customer-matten.js'
import { deliveryNoteSettings } from '../../core/customer-portal.js'
import { todayISO } from '../../core/dates.js'
import { sha256Hex } from '../../core/staffplan.js'
import { app, ensureView } from '../context.js'
import { tourStore } from '../matten-tourablage.js'
import { portalHooks } from './customer-portal.js'
import { laeufeHooks } from './invoicing-laeufe.js'

/**
 * Lieferscheine des Mattenwechsels für einen Link: je festgeschriebenem, nicht storniertem Lieferschein der gewählten
 * Kunden an den Objekten des Links, was der Webspace speichert (ohne Preise), samt PDF (make).
 */
async function mattenNotes(link, { today = todayISO() } = {}) {
  if (!laeufeHooks.docPdf) await ensureView('fakturierung')
  const docs = app.data.fakturierung?.documents
  if (!docs) return []
  const s = deliveryNoteSettings(link)
  const out = []
  for (const x of portalNotes(docs, { customerIds: s.customerIds, objectIds: link.objectIds || [], months: s.months, today })) {
    const sig = (await sha256Hex(noteSigText(x))).slice(0, 32)
    out.push({ ...noteEntry(x, { sig }), make: () => laeufeHooks.docPdf(x) })
  }
  return out
}

/**
 * Nächster Mattenwechsel je Liegeplatz für Links: Map Link → Liste. Mit den gespeicherten Einsätzen und, wenn lesbar,
 * dem Stand der Touren (gemeinsame Touren-Ablage, wie die Büro-Übersicht); ohne Touren nur mit den Einsätzen.
 */
async function mattenNext(links, { today = todayISO() } = {}) {
  let tours = []
  const st = tourStore()
  try {
    if (st && !st.loaded) await st.load({ today })
    tours = st ? st.tours() : []
  } catch {
    tours = st?.tours() || []
  }
  const objectsById = new Map((app.data.objects || []).map((o) => [o.id, o]))
  return new Map(links.map((link) => [link.id, nextExchanges({ doc: app.data.matten, jobs: app.data.mattenJobs || [], tours, customerIds: deliveryNoteSettings(link).customerIds, objectIds: link.objectIds || [], today, objectsById })]))
}

Object.assign(portalHooks, { mattenNotes, mattenNext })
