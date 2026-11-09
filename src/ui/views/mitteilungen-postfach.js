// Meine Mitteilungen: Mitteilungen des Büros an Personen mit Konto in der App (Postfach mitteilungen/konten/postfach.json,
// vom Büro geschrieben, views/mitteilungen.js). Zuordnung Konto → Person über die E-Mail im Stammblatt. Die Person liest
// den Text (in ihrer Sprache, wenn übersetzt, mit „Deutsch zeigen“), öffnet den Anhang und tippt „Gelesen“ bzw.
// „Verstanden“; gespeichert wird nur die eigene Bestätigung (mitteilungen/bestaetigungen/bestaetigungen.json), das Büro
// übernimmt sie beim Abholen. Auf der Startseite stehen offene Mitteilungen als eigene Karte (views/home.js →
// registerHomeCard). Im Paket für alle Rollen (views/lazy-alle.js), damit die Karte auch ohne Büro-Bereiche kommt.
// Kürzel: „mit-p-“.

import { formatDate, todayISO } from '../../core/dates.js'
import { confirmAccount, inboxFor } from '../../core/mitteilungen.js'
import { langInfo, langOf } from '../../core/sprachen.js'
import { MODULE_DOCS } from '../../storage/data-service.js'
import { app, persist, registerActions, registerView, renderNow, toast } from '../context.js'
import { esc, ICON } from '../shared.js'
import { registerHomeCard } from './home.js'
import { mitIcon, mitInboxAvailable } from './lazy.js'

const VIEW = 'mit-postfach'
const me = () => String(app.user?.email || '').trim().toLowerCase()
const inbox = () => inboxFor(app.data?.mitPostfach, app.data?.mitBestaetigt?.receipts || {}, me(), todayISO())
const myLang = () => langOf((app.data?.employees || []).find((e) => String(e.email || '').trim().toLowerCase() === me()))
const when = (iso) => (iso ? new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
const br = (s) => esc(s).replace(/\n/g, '<br>')

/** Eine Mitteilung als Karte: in der Sprache der Person (wenn übersetzt), Anhang, „Gelesen“ bzw. „Verstanden“. */
function card(m, { compact = false } = {}) {
  const lang = myLang()
  const u = lang !== 'de' && String(m.uebersetzt?.[lang]?.text || '').trim() ? m.uebersetzt[lang] : null
  const html = langInfo(lang).html
  const confirm = m.wichtig === 'bestaetigen'
  const titel = u?.titel || m.titel
  const done = m.done ? `<p class="mit-done"><span class="pill ok">${confirm ? 'Verstanden' : 'Gelesen'} ${esc(when(confirm ? m.receipt.bestaetigt : m.receipt.gelesen))}</span></p>` : `<p class="mit-acts"><button class="btn primary" data-action="mit-p-ok" data-id="${esc(m.id)}">${ICON.check} ${confirm ? 'Verstanden' : 'Gelesen'}</button>${confirm ? ' <span class="muted">bestätigt, dass du sie gelesen und verstanden hast</span>' : ''}</p>`
  return `<article class="mit-card${m.done ? '' : ' mit-card-open'}${m.reminded ? ' mit-card-reminded' : ''}" id="mit-p-${esc(m.id)}">
    <h3${u ? ` lang="${esc(html)}"` : ''}>${esc(titel)}</h3>
    <p class="mit-meta">${confirm ? '<span class="pill warning">Bestätigung nötig</span> ' : ''}${m.reminded ? '<span class="pill error">Erinnerung</span> ' : ''}<span class="muted">vom ${esc(formatDate(m.ab))}</span></p>
    ${compact && m.done ? '' : `<div class="mit-body"${u ? ` lang="${esc(html)}"` : ''}>${br(u ? u.text : m.text)}</div>`}
    ${u && !compact ? `<details class="mit-de"><summary>Deutsch zeigen</summary><div lang="de"><p><strong>${esc(m.titel)}</strong></p><p>${br(m.text)}</p></div></details>` : ''}
    ${m.anhang && !compact ? `<p><button class="btn small" data-action="mit-p-file" data-id="${esc(m.id)}">${ICON.download} Anhang: ${esc(m.anhang.name)}</button></p>` : ''}
    ${done}
  </article>`
}

function postfachView() {
  const list = inbox()
  if (!me()) return '<div class="section-head"><div><h2>Meine Mitteilungen</h2></div></div><p class="muted">Nur mit Anmeldung: Mitteilungen kommen an die E-Mail-Adresse des eigenen Kontos.</p>'
  const open = list.filter((m) => !m.done)
  return `<div class="section-head"><div><h2>Meine Mitteilungen</h2><p>Mitteilungen des Büros an dich. Bitte lesen und mit „Gelesen“ bzw. „Verstanden“ bestätigen; das Büro sieht nur den Zeitpunkt.</p></div></div>
    ${list.length ? `${open.map((m) => card(m)).join('')}${list.length > open.length ? `<details class="mit-old"${open.length ? '' : ' open'}><summary>Gelesen (${list.length - open.length})</summary>${list.filter((m) => m.done).map((m) => card(m)).join('')}</details>` : ''}` : '<p class="muted">Keine Mitteilungen für dich.</p>'}`
}

registerView({
  id: 'mit-postfach',
  order: 4,
  label: 'Meine Mitteilungen',
  group: 'start',
  section: 'start',
  module: '*',
  noWeek: true,
  icon: mitIcon,
  available: mitInboxAvailable,
  text: 'Mitteilungen des Büros an dich: lesen und bestätigen',
  badge: () => inbox().filter((m) => !m.done).length,
  render: postfachView,
})

// Startseite: offene Mitteilungen (die erinnerten zuerst), mit „Gelesen“ bzw. „Verstanden“ direkt dort
registerHomeCard({
  id: 'mit-postfach',
  available: () => !!me() && inbox().some((m) => !m.done),
  render: () => {
    const open = inbox().filter((m) => !m.done)
    return `<section class="home-mod mit-home" aria-label="Mitteilungen an dich"><header><h3>${open.length === 1 ? 'Eine Mitteilung an dich' : `${open.length} Mitteilungen an dich`}</h3><button class="btn small" data-action="view" data-view="${VIEW}">Alle Mitteilungen</button></header>${open
      .slice(0, 3)
      .map((m) => card(m))
      .join('')}${open.length > 3 ? `<p class="muted">und ${open.length - 3} weitere unter „Meine Mitteilungen“</p>` : ''}</section>`
  },
})

registerActions({
  'mit-p-ok': (el) => {
    const m = inbox().find((x) => x.id === el.dataset.id)
    if (!m) return toast('Diese Mitteilung gibt es nicht mehr.')
    if (app.readOnly || (app.service && !app.service.writable(MODULE_DOCS.mitBestaetigt.path))) return toast('Bestätigen geht nicht: Für dein Konto fehlt das Recht auf den Ordner „mitteilungen/bestaetigungen“ in SharePoint. Bitte im Büro melden.')
    const box = (app.data.mitBestaetigt ||= { receipts: {} })
    box.receipts = confirmAccount(box.receipts || {}, m.id, me(), { at: new Date().toISOString(), bestaetigen: m.wichtig === 'bestaetigen' })
    persist()
    renderNow()
    toast(m.wichtig === 'bestaetigen' ? 'Danke, „Verstanden“ ist vermerkt.' : 'Danke, ist vermerkt.')
  },
  'mit-p-file': async (el) => {
    const m = inbox().find((x) => x.id === el.dataset.id)
    if (!m?.anhang?.pfad || !app.store?.readBlob) return toast('Anhang nicht verfügbar.')
    const blob = await app.store.readBlob(m.anhang.pfad).catch(() => null)
    if (!blob) return toast('Anhang nicht gefunden (ohne Netz oder kein Recht auf den Ordner).')
    window.open(URL.createObjectURL(blob), '_blank', 'noopener')
  },
})
