// Aushang (QR) im Objekt: Abschnitt „Aushang (QR)“ im Kundenbereich. Je Objekt ein QR-Code zum Aushängen (Stiegenhaus,
// Büro des Kunden); Hausbewohner, Hausverwaltung und Mitarbeitende des Kunden melden darüber ohne Anmeldung ein Problem
// (kunden.php?q=CODE). Hier: einschalten, Bezeichnung, Code neu erzeugen (der alte gilt sofort nicht mehr), Aushang als
// PDF (A4, großer QR-Code, Deutsch und Englisch), Seite ansehen, Link kopieren. Übertragen an den Webspace mit demselben
// Schlüssel wie der Kundenbereich (aktion=aushang: alle eingeschalteten, nur Kennung, Hashwert, Bezeichnung, Objekt).
// Die Meldungen holt der Kundenbereich mit seinen ab (views/customer-portal.js, syncReports); sie werden Reklamationen mit
// Eingang „Aushang (QR)“ (core/aushang.js), die öffentliche Antwort für den Statuslink steht im Reklamations-Dialog.
//
// Später geladen mit dem Paket des Büros (views/lazy-buero.js); der Kundenbereich (immer geladen) zeigt den Abschnitt über
// portalHooks. Wer: wie der Kundenbereich (Vollzugriff und Rollen, die Reklamationen oder die Einsatzplanung bearbeiten).
// Daten: kundenbereich/kundenbereich.json → aushang: [{ id, objectId, title, token, active, createdAt, createdBy,
// changedAt, changedBy, renewedAt, publishedAt, error }]. Rechenkern: core/aushang.js, PDF: export/aushang-pdf.js.

import { AUSHANG_SOURCE, defaultPosterTitle, newPosterId, posterActive, posterLink, posterOf, posterPayload, posterState } from '../../core/aushang.js'
import { newCode, sha256Hex } from '../../core/staffplan.js'
import { posterDocument, posterPdfName } from '../../export/aushang-pdf.js'
import { app, closeModal, confirmStep, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, download, esc, ICON, modalFrame, options, rowMenu, val } from '../shared.js'
import { portalAddress, portalCall, portalHooks, portalManage, portalReady } from './customer-portal.js'

const MODULES = ['reklamationen', 'planung']
const kb = () => (app.data.kundenbereich ||= { links: [], settings: {} })
const posters = () => (kb().aushang ||= [])
const posterById = (id) => posters().find((p) => p.id === id)
const objOf = (id) => app.data.objects.find((o) => o.id === id)
const editable = () => portalManage() && !app.readOnly
const by = () => app.user?.name || 'Browser'
const nowIso = () => new Date().toISOString()
const urlOf = (p) => posterLink(portalAddress(), p.token)
const openOf = (p) => (app.data.reklamationen?.items || []).filter((c) => c.portal?.aushang === p.id && c.status !== 'erledigt').length
const pub = { running: false, error: '' }

/**
 * Alle eingeschalteten Aushänge an den Webspace (ersetzt dort die Liste: ausgeschaltete und alte Codes gelten danach
 * nicht mehr). pending: nur, wenn etwas noch nicht übertragen ist (beim Übertragen des Kundenbereichs).
 */
export async function publishPosters({ pending = false } = {}) {
  if (!portalReady()) throw new Error('Der Kundenbereich ist aus: zuerst unter „Einstellungen“ einschalten und übertragen.')
  if (pending && !posters().some((p) => ['neu', 'fehler', 'aus-offen'].includes(posterState(p).key))) return null
  if (pub.running) throw new Error('Übertragung läuft schon.')
  pub.running = true
  try {
    const list = posters().filter(posterActive)
    const aushaenge = await Promise.all(list.map(async (p) => posterPayload(p, await sha256Hex(p.token))))
    const res = await portalCall('aushang', { body: { aushaenge } })
    const now = nowIso()
    for (const p of posters()) Object.assign(p, { publishedAt: now, error: '' })
    pub.error = ''
    persist()
    return res
  } catch (err) {
    pub.error = err.message || String(err)
    for (const p of posters()) if (posterState(p).key !== 'aktiv' && posterState(p).key !== 'aus') p.error = pub.error
    throw err
  } finally {
    pub.running = false
  }
}

async function publishNow(done) {
  try {
    const r = await publishPosters()
    toast(`${done} ${r ? `Übertragen (${r.aushaenge} ${r.aushaenge === 1 ? 'Aushang' : 'Aushänge'} aktiv).` : ''}`.trim())
  } catch (err) {
    toast(`${done} Noch nicht übertragen: ${err.message}`)
  }
  if (app.ui.view === 'kundenbereich') renderNow()
}

// ---------------------------------------------------------------- Abschnitt im Kundenbereich

function posterRow(p) {
  const st = posterState(p)
  const cls = { aktiv: 'ok', neu: 'info', fehler: 'error', 'aus-offen': 'warning', aus: '' }[st.key]
  const obj = objOf(p.objectId)
  const open = openOf(p)
  const items = [
    { label: 'Bearbeiten', icon: ICON.gear, action: 'ah-edit', data: { id: p.id } },
    ...(p.active ? [{ label: 'Seite ansehen', icon: ICON.right, action: 'ah-open', data: { id: p.id } }, { label: 'Link kopieren', icon: ICON.copy, action: 'ah-copy', data: { id: p.id } }] : []),
    '-',
    { label: 'Code neu erzeugen (alter gilt nicht mehr)', icon: ICON.refresh, action: 'ah-renew', data: { id: p.id } },
    p.active ? { label: 'Ausschalten', icon: ICON.lock, action: 'ah-toggle', data: { id: p.id } } : { label: 'Einschalten', icon: ICON.check, action: 'ah-toggle', data: { id: p.id } },
  ]
  return `<tr><td><strong>${esc(p.title || 'ohne Bezeichnung')}</strong><br><span class="muted">${esc(obj?.name || 'Objekt (gelöscht)')}${obj?.address ? `, ${esc(obj.address)}` : ''}</span></td>
    <td>${open ? `<span class="pill warning">${open} offen</span>` : '<span class="muted">keine offen</span>'}</td>
    <td><span class="pill ${cls}">${esc(st.label)}</span>${p.publishedAt && p.active ? `<br><span class="muted">seit ${esc(new Date(p.publishedAt).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' }))}</span>` : ''}${p.error ? `<br><span class="err-text">${esc(p.error)}</span>` : ''}</td>
    <td class="actions-cell">${p.active ? `<button class="btn small" data-action="ah-pdf" data-id="${esc(p.id)}">${ICON.download} PDF</button> ` : ''}${editable() ? rowMenu(items, `Aushang ${p.title || ''}`) : ''}</td></tr>`
}

/** Abschnitt „Aushang (QR)“ in der Ansicht Kundenbereich (über portalHooks.aushangSection). */
function aushangSection() {
  const ed = editable()
  const ready = portalReady()
  const list = [...posters()].sort((a, b) => Number(!!b.active) - Number(!!a.active) || String(a.title).localeCompare(String(b.title), 'de'))
  const active = list.filter(posterActive)
  const pending = list.some((p) => ['neu', 'fehler', 'aus-offen'].includes(posterState(p).key))
  return `<section class="kb-aushang" id="kb-aushang"><div class="section-head"><div><h3>Aushang (QR)</h3>
      <p>Je Objekt ein QR-Code zum Aushängen im Stiegenhaus oder im Büro des Kunden: Hausbewohner, Hausverwaltung und Mitarbeitende des Kunden melden darüber ohne Anmeldung ein Problem (Text, freiwillig Foto und Kontakt). Die Meldung kommt als Reklamation mit Eingang „${esc(AUSHANG_SOURCE)}“; die meldende Person sieht über ihren Statuslink nur den Stand und die öffentliche Antwort.</p></div>
      <div class="actions">${ed && ready ? `${pending ? `<button class="btn" data-action="ah-publish" ${pub.running ? 'disabled' : ''}>${ICON.refresh} Jetzt übertragen</button>` : ''}${active.length > 1 ? `<button class="btn" data-action="ah-pdf">${ICON.download} Alle als PDF</button>` : ''}<button class="btn primary" data-action="ah-new">${ICON.plus} Aushang einrichten</button>` : ''}</div></div>
    ${pub.error ? `<div class="banner warn-banner"><p>Aushang an den Webspace: ${esc(pub.error)}</p></div>` : ''}
    ${!ready ? '<p class="note">Erst den Kundenbereich einschalten und übertragen (Einstellungen); der Aushang nutzt denselben Webspace.</p>' : ''}
    ${list.length ? `<div class="table-wrap"><table class="data ah-table"><thead><tr><th>Aushang / Objekt</th><th>Meldungen</th><th>Stand</th><th></th></tr></thead><tbody>${list.map(posterRow).join('')}</tbody></table></div>` : `<p class="empty">Noch kein Aushang.${ed && ready ? ' Mit „Aushang einrichten“ für ein Objekt beginnen.' : ''}</p>`}
    <p class="note">Der Code im Aushang ist ein eigener je Objekt (nicht der Link des Kundenbereichs); die Seite zeigt nur die Bezeichnung, Logo und das Formular, keine Nachweise, Rechnungen oder Termine. „Code neu erzeugen“ macht den alten Aushang sofort ungültig: danach das PDF neu drucken.</p></section>`
}
portalHooks.aushangSection = aushangSection
portalHooks.aushangPublish = () => publishPosters({ pending: true })

// ---------------------------------------------------------------- Dialog

function draft() {
  const m = app.ui.modal
  if (!m.draft) {
    const p = m.id ? posterById(m.id) : null
    m.draft = p ? { id: p.id, objectId: p.objectId, title: p.title, active: !!p.active } : { id: '', objectId: '', title: '', active: true }
  }
  return m.draft
}

function readDraft() {
  const d = draft()
  if (!document.getElementById('ah-title')) return d
  const objectId = d.id ? d.objectId : val('ah-object')
  // Bezeichnung vorschlagen, solange sie nicht von Hand geändert wurde
  const title = val('ah-title').trim()
  d.title = objectId !== d.objectId && (!title || title === defaultPosterTitle(objOf(d.objectId))) ? defaultPosterTitle(objOf(objectId)) : title
  d.objectId = objectId
  d.active = checked('ah-active')
  return d
}

function posterModal() {
  const d = draft()
  const free = [...app.data.objects].filter((o) => !posterOf(posters(), o.id) || o.id === d.objectId).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const obj = objOf(d.objectId)
  return modalFrame({
    title: d.id ? `Aushang bearbeiten: ${d.title || 'ohne Bezeichnung'}` : 'Aushang (QR) einrichten',
    body: `<div class="form-grid">
        ${d.id ? `<p class="field wide"><span>Objekt</span><strong>${esc(obj?.name || 'Objekt (gelöscht)')}</strong></p>` : `<label class="field wide"><span>Objekt</span><select id="ah-object" data-change="ah-object">${options(free.map((o) => [o.id, `${o.name}${o.address ? `, ${o.address}` : ''}`]), d.objectId, { empty: '– Objekt wählen –' })}</select></label>`}
        <label class="field wide"><span>Bezeichnung auf Aushang und Seite (frei wählbar)</span><input type="text" id="ah-title" maxlength="120" value="${esc(d.title)}" placeholder="z. B. Wohnanlage Musterstraße 5"></label>
        <label class="check wide"><input type="checkbox" id="ah-active" ${d.active ? 'checked' : ''}><span><strong>Eingeschaltet</strong>: Der QR-Code öffnet das Meldeformular. Ausgeschaltet gilt er nicht mehr (Seite „nicht gefunden“).</span></label>
      </div>
      <p class="note">Die Seite zeigt nur diese Bezeichnung, Logo bzw. Firmenname und das Formular: Kategorie (Reinigung nicht erledigt, Verschmutzung, Schaden/Defekt, Müll, Winterdienst, Sonstiges), Ort im Objekt, Text, Foto und Kontakt freiwillig, „Rückmeldung gewünscht“. Auf Deutsch und Englisch, ohne Anmeldung, ohne Tracking.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="ah-save">${ICON.send} Speichern und übertragen</button></div>`,
  })
}
registerModal('ah-edit', posterModal, { module: MODULES })

// ---------------------------------------------------------------- Aktionen

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Link kopiert.')
  } catch {
    toast(text)
  }
}

async function pdf(list) {
  if (!list.length) return toast('Kein Aushang eingeschaltet.')
  const s = kb().settings || {}
  const doc = posterDocument({ posters: list, address: portalAddress(), brand: app.config.brand || {}, logo: await loadLogo().catch(() => null), phone: s.phone || '' })
  download(posterPdfName(list), await pdfBlob(doc))
  if (list.some((p) => posterState(p).key !== 'aktiv')) toast('Hinweis: Noch nicht übertragen – der Code gilt erst nach „Jetzt übertragen“.')
}

registerActions(
  {
    'ah-new': () => openModal({ type: 'ah-edit' }),
    'ah-edit': (el) => openModal({ type: 'ah-edit', id: el.dataset.id }),
    'ah-object': () => {
      readDraft()
      renderModal()
    },
    'ah-save': async (el) => {
      const d = readDraft()
      if (!d.objectId) return toast('Bitte ein Objekt wählen.')
      if (!d.title) return toast('Bitte eine Bezeichnung eingeben (z. B. Wohnanlage Musterstraße 5).')
      const now = nowIso()
      let p = d.id ? posterById(d.id) : null
      if (p) Object.assign(p, { title: d.title, active: d.active, changedAt: now, changedBy: by() })
      else {
        if (posterOf(posters(), d.objectId)) return toast('Für dieses Objekt gibt es schon einen Aushang.')
        p = { id: newPosterId(), objectId: d.objectId, title: d.title, token: newCode(), active: d.active, createdAt: now, createdBy: by(), changedAt: now, changedBy: by(), publishedAt: null, error: '' }
        posters().push(p)
      }
      persist()
      closeModal()
      renderNow()
      el.disabled = true
      await publishNow(d.id ? 'Gespeichert.' : 'Aushang eingerichtet.')
    },
    'ah-toggle': async (el) => {
      const p = posterById(el.dataset.id)
      if (!p) return
      Object.assign(p, { active: !p.active, changedAt: nowIso(), changedBy: by() })
      persist()
      renderNow()
      await publishNow(p.active ? `Eingeschaltet: „${p.title}“.` : `Ausgeschaltet: Der Aushang „${p.title}“ gilt nicht mehr.`)
    },
    'ah-renew': async (el) => {
      const p = posterById(el.dataset.id)
      if (!p) return
      if (!confirmStep(`ah-renew-${p.id}`)) return toast(`Neuer Code für „${p.title}“: Der bisherige Aushang gilt danach nicht mehr. Zum Bestätigen noch einmal klicken.`)
      const now = nowIso()
      Object.assign(p, { token: newCode(), active: true, renewedAt: now, renewedBy: by(), changedAt: now, changedBy: by() })
      persist()
      renderNow()
      await publishNow('Neuer Code erzeugt: bitte den Aushang neu drucken und tauschen.')
    },
    'ah-publish': async (el) => {
      el.disabled = true
      await publishNow('')
    },
    'ah-pdf': async (el) => {
      const p = el.dataset.id ? posterById(el.dataset.id) : null
      await pdf(p ? [p].filter(posterActive) : posters().filter(posterActive).sort((a, b) => String(a.title).localeCompare(String(b.title), 'de')))
    },
    'ah-open': (el) => {
      const p = posterById(el.dataset.id)
      if (p && posterActive(p)) window.open(urlOf(p), '_blank', 'noopener')
    },
    'ah-copy': (el) => {
      const p = posterById(el.dataset.id)
      if (p && posterActive(p)) copyText(urlOf(p))
    },
  },
  { edit: MODULES },
)
