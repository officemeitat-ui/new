// Mattenwechsel: Google-Routing (Entscheidung E8 der Geschäftsführung vom 9.11.2026), Büro-Seite des Durchreichers
// routing.php am Webspace (Muster ki.php). Hier: der angemeldete Google-Anbieter mit dem Microsoft-Token der Person,
// der Stand vom Webspace (eingerichtet, Limits, Nutzung) und der Dialog „Routing“ in der Tourenplanung: Anbieter
// eingebaut oder Google (matten/matten.json → settings.routing.provider), API-Schlüssel (geht nur an
// routing.php?aktion=einrichten und liegt nur dort in privat/routing.json; angezeigt nur „…abcd“), Monats- und
// Tageslimit, Nutzung des Monats mit grober Kostenschätzung und eine kurze Einrichtungsanleitung. Einrichten nur mit
// Vollzugriff (prüft auch routing.php). Rechenkern: core/routing.js (createGoogleProvider), core/matten-tour.js
// (retimeTour, googleRetime). Aktionen und Dialog mit dem Kürzel „mwg-“; die Knöpfe an der Tour und bei „Nicht
// eingeplant“ (mwg-retime, mwg-geo) stehen in views/matten-planung.js.

import { MONTH_LONG } from '../core/dates.js'
import { emptyMatten, upgradeMatten } from '../core/matten.js'
import { createGoogleProvider, GOOGLE_KEY_PATTERN, GOOGLE_LIMITS, GOOGLE_PRICES, googleCost, registerRoutingProvider } from '../core/routing.js'
import { app, closeModal, confirmStep, openModal, persist, registerActions, registerModal, renderModalKeepingInput, renderNow, toast } from './context.js'
import { geocode } from './geocode.js'
import { esc, modalFrame, options, val } from './shared.js'

const MODULE = 'matten'
const doc = () => upgradeMatten((app.data.matten ||= emptyMatten()))
const settings = () => (doc().settings ||= {})
/** Einstellungen des Routings in matten.json (Anbieter und Schätzwerte des eingebauten Anbieters; kein Schlüssel). */
export const routingSettings = () => settings().routing || {}
/** Ist Google als Anbieter gewählt? */
export const googleChosen = () => routingSettings().provider === 'google'
const voll = () => !app.access || !!app.access.all
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const usd = (x) => `${(Number(x) || 0).toFixed(2).replace('.', ',')} US-Dollar`
const monthText = (ym) => (/^\d{4}-\d{2}$/.test(ym || '') ? `${MONTH_LONG[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}` : 'diesem Monat')
const asOf = () => GOOGLE_PRICES.asOf.split('-').reverse().map(Number).join('. ')

/** Der Google-Anbieter der App: Anfragen an routing.php mit dem Microsoft-Token der angemeldeten Person. */
export const google = registerRoutingProvider('google', createGoogleProvider({ getToken: async () => (app.auth ? await app.auth.getToken() : '') }))

const state = { at: 0, loading: null }

/** Stand vom Webspace lesen (eine Anfrage an routing.php, nicht an Google); maxAge: jünger als so viele ms → gespeicherter. */
export function googleStatus({ maxAge = 0 } = {}) {
  if (state.loading) return state.loading
  if (state.at && Date.now() - state.at < maxAge) return Promise.resolve(google.status())
  state.loading = google.refresh().finally(() => {
    state.at = Date.now()
    state.loading = null
  })
  return state.loading
}

/** Für die Ansicht: ist Google gewählt, den Stand im Hintergrund lesen (höchstens jede Minute), danach onDone. */
export function watchGoogleStatus(onDone) {
  if (!googleChosen() || state.loading || (state.at && Date.now() - state.at < 60_000)) return
  googleStatus().then(() => onDone?.())
}

/** Nutzung des Monats als Text: „Routen 12, Adressen 3: 15 von 1000 Anfragen im November 2026, heute 4 von 100“. */
export function usageText(st = google.status()) {
  const n = st?.nutzung
  if (!n) return ''
  return `Routen ${n.routen}, Adressen ${n.geocode}: ${n.anfragen} von ${st.limitMonat || n.limitMonat} Anfragen im ${monthText(n.monat)}, heute ${n.heute} von ${st.limitTag || n.limitTag}`
}

/** Zeile über den Touren (HTML), nur wenn Google gewählt ist: womit gerechnet wird, sonst warum nicht. */
export function googleLine({ ed = false } = {}) {
  if (!googleChosen()) return ''
  const st = google.status()
  if (google.ready()) return `<p class="note mwg-line">Google-Routing eingerichtet: beim Vorschlag legt Google je Tour Reihenfolge und Fahrzeiten fest, die Zuteilung auf die Fahrer macht die App (${esc(usageText(st))}).</p>`
  if (!st && !google.lastError()) return '<p class="note mwg-line">Google-Routing: Stand vom Webspace wird gelesen …</p>'
  return `<div class="banner warn-banner mwg-line" role="status"><p><strong>Google-Routing gewählt, aber ${esc(google.why())}.</strong> Bis dahin rechnet der eingebaute Anbieter (Luftlinie).</p>${ed ? '<button class="btn small" data-action="mwg-open">Routing</button>' : ''}</div>`
}

/**
 * Koordinaten zu einer Adresse: über Google, wenn gewählt und eingerichtet (eine Anfrage), sonst – auch wenn Google
 * ausfällt – über OpenStreetMap. Liefert { lat, lon, label, quality ('google' | 'adresse'), source, notice? } oder null.
 */
export async function findCoords(address) {
  let notice = ''
  if (googleChosen()) {
    await googleStatus({ maxAge: 60_000 })
    if (google.ready()) {
      try {
        const hit = await google.geocode(address)
        return hit ? { ...hit, source: 'Google' } : null
      } catch (err) {
        notice = `Google: ${err.message} – Suche über OpenStreetMap.`
      }
    } else notice = `Google-Routing ${google.why()} – Suche über OpenStreetMap.`
  }
  const hit = await geocode(address)
  return hit ? { ...hit, quality: 'adresse', source: 'OpenStreetMap', ...(notice ? { notice } : {}) } : null
}

// ---------------------------------------------------------------- Dialog „Routing“

function draft(m) {
  if (!m.d) m.d = { provider: routingSettings().provider === 'google' ? 'google' : 'luftlinie' }
  return m.d
}

const HELP = [
  'Ein Google-Cloud-Projekt mit Abrechnung anlegen (console.cloud.google.com, Firmenkonto).',
  'Unter „APIs und Dienste“ die „Routes API“ und die „Geocoding API“ aktivieren.',
  'Einen API-Schlüssel erstellen und beschränken: nur diese zwei APIs, nur die IP-Adresse des Webspace (steht im World4You-Kundenbereich, sonst beim Support erfragen).',
  'Unter „Abrechnung → Budgets und Benachrichtigungen“ eine Budget-Warnung einrichten (z. B. 5 €).',
  'Den Schlüssel hier eintragen und „Google“ wählen. Er geht nur an den Webspace (routing.php) und steht nie in der App oder in SharePoint.',
]

registerModal(
  'mwg-routing',
  (c, m) => {
    const d = draft(m)
    const mayChoose = voll() && !app.readOnly
    const st = google.status()
    const err = google.lastError()
    const keyOk = !!st?.vollzugriff && !app.readOnly
    const dis = keyOk ? '' : 'disabled'
    const loading = !st && !err
    const statusHtml = loading
      ? '<p class="muted">Stand vom Webspace wird gelesen …</p>'
      : !st
        ? `<div class="banner warn-banner"><p><strong>routing.php nicht erreichbar:</strong> ${esc(err?.message || '')}. ${err?.status === 401 ? 'Bitte neu anmelden.' : 'routing.php mit dem Paket hochladen (Hauptordner).'}</p></div>`
        : st.eingerichtet
          ? `<p class="mwg-state"><span class="mw-st st-erledigt">eingerichtet</span> ${st.schluesselEnde ? `Schlüssel …${esc(st.schluesselEnde)}` : 'Schlüssel am Webspace'}${st.geaendert ? `, geändert ${esc(new Date(st.geaendert).toLocaleDateString('de-AT'))}` : ''}</p>`
          : '<p class="mwg-state"><span class="mw-st st-nachzuholen">noch kein Schlüssel</span> Google-Routing ist am Webspace noch nicht eingerichtet.</p>'
    const n = st?.nutzung
    const cost = n ? googleCost(n) : null
    const usage = n
      ? `<section class="mwg-usage" aria-label="Nutzung"><h4>Nutzung im ${esc(monthText(n.monat))}</h4>
        <p>${esc(plural(n.routen, 'Route', 'Routen'))} (Tourvorschläge und Neurechnen), ${esc(plural(n.geocode, 'Adresse', 'Adressen'))} gesucht: <strong>${n.anfragen} von ${st.limitMonat}</strong> Anfragen im Monat, heute ${n.heute} von ${st.limitTag}.</p>
        <p>Geschätzte Kosten: <strong>${esc(usd(cost.total))}</strong>${cost.total ? '' : ' (innerhalb der Gratis-Anfragen)'}.</p></section>`
      : ''
    const prices = `<p class="note">Preise laut Google, Stand ${esc(asOf())} – bitte im Google-Konto prüfen: Compute Routes ab ${GOOGLE_PRICES.routes.per1000} US-Dollar je 1000 Anfragen über ${GOOGLE_PRICES.routes.free} Gratis-Anfragen im Monat, Geocoding ${GOOGLE_PRICES.geocode.per1000} US-Dollar je 1000 über ${GOOGLE_PRICES.geocode.free} Gratis-Anfragen im Monat. Das Monatslimit von ${GOOGLE_LIMITS.month} hält die Nutzung im Gratis-Kontingent.</p>`
    const help = `<ol class="mwg-steps">${HELP.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`
    const confirmRemove = app.ui.confirm === 'mwg-remove'
    return modalFrame({
      title: 'Routing: Reihenfolge und Fahrzeiten',
      wide: true,
      body: `<p>Der eingebaute Anbieter schätzt die Fahrzeiten aus der Luftlinie (kostenlos). Mit Google kommen echte Fahrzeiten und Strecken: die Zuteilung auf die Fahrer macht weiter die App, Google legt je Tour die Reihenfolge fest. Fällt Google aus (kein Schlüssel, Limit, keine Verbindung), rechnet der eingebaute Anbieter mit einem Hinweis.</p>
        <div class="form-grid">
          <label class="field wide"><span>Anbieter</span><select id="mwg-provider" ${mayChoose ? '' : 'disabled'}>${options(
            [
              ['luftlinie', 'Eingebaut (Luftlinie, kostenlos)'],
              ['google', 'Google (echte Fahrzeiten, über den Webspace)'],
            ],
            d.provider,
          )}</select></label>
        </div>
        <h3 class="mwg-h">Google am Webspace</h3>
        ${statusHtml}
        ${
          st
            ? `<div class="form-grid">
          <label class="field wide"><span>API-Schlüssel${st.eingerichtet ? ' (leer lassen = bleibt)' : ''}</span><input type="password" id="mwg-key" autocomplete="off" spellcheck="false" placeholder="${st.eingerichtet ? `…${esc(st.schluesselEnde || '')}` : 'beginnt mit AIza'}" ${dis}></label>
          <label class="field"><span>Anfragen je Monat höchstens</span><input type="number" id="mwg-month" min="1" max="100000" step="1" inputmode="numeric" value="${esc(st.limitMonat ?? GOOGLE_LIMITS.month)}" ${dis}></label>
          <label class="field"><span>Anfragen je Tag höchstens</span><input type="number" id="mwg-day" min="1" max="10000" step="1" inputmode="numeric" value="${esc(st.limitTag ?? GOOGLE_LIMITS.day)}" ${dis}></label>
        </div>
        ${keyOk ? '' : '<p class="muted">Schlüssel und Limits richtet nur Vollzugriff ein.</p>'}`
            : ''
        }
        ${usage}
        ${prices}
        <h3 class="mwg-h">So wird Google eingerichtet</h3>
        ${help}
        <p class="note">Datenschutz: An Google gehen nur die Koordinaten von Betriebshof und Stopps (bei „Koordinaten suchen“ die Adresse), keine Namen von Kunden oder Fahrern. Vorher Punkt 39 der Rechtsprüfung klären.</p>`,
      foot: `<div class="actions">${keyOk && st?.eingerichtet ? `<button class="btn ${confirmRemove ? 'danger confirm' : 'ghost'}" data-action="mwg-remove">${confirmRemove ? 'Wirklich entfernen?' : 'Schlüssel entfernen'}</button>` : ''}</div><div class="actions"><button class="btn" data-action="close-modal">${mayChoose || keyOk ? 'Abbrechen' : 'Schließen'}</button>${mayChoose || keyOk ? '<button class="btn primary" data-action="mwg-save">Speichern</button>' : ''}</div>`,
    })
  },
  { module: MODULE },
)

function openRouting() {
  openModal({ type: 'mwg-routing' })
  googleStatus().then(() => {
    if (app.ui.modal?.type === 'mwg-routing') renderModalKeepingInput()
  })
}

async function saveRouting() {
  const m = app.ui.modal
  if (m?.type !== 'mwg-routing') return
  const d = draft(m)
  const provider = val('mwg-provider') === 'google' ? 'google' : 'luftlinie'
  const st = google.status()
  const key = val('mwg-key').trim()
  const month = Math.round(Number(val('mwg-month')))
  const day = Math.round(Number(val('mwg-day')))
  if (key && !GOOGLE_KEY_PATTERN.test(key)) return toast('Der API-Schlüssel sieht nicht richtig aus (39 Zeichen, beginnt mit AIza).')
  const limitsChanged = st && document.getElementById('mwg-month') && (month !== st.limitMonat || day !== st.limitTag)
  if (limitsChanged && (!(month >= 1 && month <= 100000) || !(day >= 1 && day <= 10000))) return toast('Limits: je Monat 1 bis 100000, je Tag 1 bis 10000 Anfragen.')
  if (st?.vollzugriff && (key || limitsChanged)) {
    if (!key && !st.eingerichtet) return toast('Bitte zuerst den API-Schlüssel eintragen.')
    try {
      await google.setup({ ...(key ? { schluessel: key } : {}), limitMonat: month, limitTag: day })
      state.at = Date.now()
    } catch (err) {
      return toast(`Nicht gespeichert: ${err.message}`)
    }
  }
  if (provider !== (routingSettings().provider === 'google' ? 'google' : 'luftlinie')) {
    if (!voll()) return toast('Den Anbieter wählt nur Vollzugriff.')
    settings().routing = { ...routingSettings(), provider }
    persist()
  }
  d.provider = provider
  closeModal()
  renderNow()
  const now = google.status()
  toast(provider === 'google' ? (now?.eingerichtet ? `Gespeichert: Google rechnet Reihenfolge und Fahrzeiten (Schlüssel …${now.schluesselEnde || ''}).` : 'Gespeichert. Google ist gewählt, aber noch nicht eingerichtet: bis dahin rechnet der eingebaute Anbieter.') : 'Gespeichert: der eingebaute Anbieter rechnet (Luftlinie).')
}

async function removeKey() {
  if (!confirmStep('mwg-remove', renderModalKeepingInput)) return
  try {
    await google.setup({ entfernen: true })
    state.at = Date.now()
    renderModalKeepingInput()
    toast('Schlüssel am Webspace entfernt: bis zu einem neuen rechnet der eingebaute Anbieter.')
  } catch (err) {
    toast(`Nicht entfernt: ${err.message}`)
  }
}

registerActions({
  'mwg-open': () => openRouting(),
})

registerActions(
  {
    'mwg-save': () => saveRouting(),
    'mwg-remove': () => removeKey(),
  },
  { edit: '*' },
)
