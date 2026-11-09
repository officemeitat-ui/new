// Mattenwechsel: Routing über den Webspace – Google (Entscheidung E8 der Geschäftsführung vom 9.11.2026) und
// OpenRouteService (HeiGIT, auf OpenStreetMap; kostenlose Wahl, Zusatz vom 9.11.2026). Büro-Seite des Durchreichers
// routing.php am Webspace (Muster ki.php). Hier: die angemeldeten Anbieter mit dem Microsoft-Token der Person, der
// Stand vom Webspace je Anbieter (eingerichtet, Limits, Nutzung) und der Dialog „Routing“ in der Tourenplanung: Anbieter
// eingebaut, OpenRouteService oder Google (matten/matten.json → settings.routing.provider), Schlüssel je Anbieter (geht
// nur an routing.php?aktion=einrichten und liegt nur dort in privat/routing.json; angezeigt nur „…abcd“), Monats- und
// Tageslimit je Anbieter, Nutzung des Monats (bei Google mit grober Kostenschätzung, bei OpenRouteService 0 € laut
// Gratis-Kontingent) und je eine kurze Einrichtungsanleitung. Einrichten nur mit Vollzugriff (prüft auch routing.php).
// Rechenkern: core/routing.js (createGoogleProvider, createOrsProvider), core/matten-tour.js (retimeTour, routeRetime).
// Aktionen und Dialog mit dem Kürzel „mwg-“; die Knöpfe an der Tour und bei „Nicht eingeplant“ (mwg-retime, mwg-geo)
// stehen in views/matten-planung.js.

import { MONTH_LONG } from '../core/dates.js'
import { emptyMatten, upgradeMatten } from '../core/matten.js'
import { createGoogleProvider, createOrsProvider, GOOGLE_KEY_PATTERN, GOOGLE_LIMITS, GOOGLE_PRICES, googleCost, ORS_ATTRIBUTION, ORS_FREE, ORS_KEY_PATTERN, ORS_LIMITS, registerRoutingProvider } from '../core/routing.js'
import { app, closeModal, confirmStep, openModal, persist, registerActions, registerModal, renderModalKeepingInput, renderNow, toast } from './context.js'
import { geocode } from './geocode.js'
import { esc, modalFrame, options, val } from './shared.js'

const MODULE = 'matten'
const doc = () => upgradeMatten((app.data.matten ||= emptyMatten()))
const settings = () => (doc().settings ||= {})
/** Einstellungen des Routings in matten.json (Anbieter und Schätzwerte des eingebauten Anbieters; kein Schlüssel). */
export const routingSettings = () => settings().routing || {}
/** Gewählter Anbieter: 'luftlinie' (eingebaut) | 'ors' | 'google'. */
export const chosenName = () => {
  const p = routingSettings().provider
  return p === 'google' || p === 'ors' ? p : 'luftlinie'
}
/** Ist Google als Anbieter gewählt? */
export const googleChosen = () => chosenName() === 'google'
const voll = () => !app.access || !!app.access.all
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const usd = (x) => `${(Number(x) || 0).toFixed(2).replace('.', ',')} US-Dollar`
const monthText = (ym) => (/^\d{4}-\d{2}$/.test(ym || '') ? `${MONTH_LONG[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}` : 'diesem Monat')
const asOf = () => GOOGLE_PRICES.asOf.split('-').reverse().map(Number).join('. ')

const getToken = async () => (app.auth ? await app.auth.getToken() : '')
/** Der Google-Anbieter der App: Anfragen an routing.php mit dem Microsoft-Token der angemeldeten Person. */
export const google = registerRoutingProvider('google', createGoogleProvider({ getToken }))
/** Der OpenRouteService-Anbieter der App (routing.php?anbieter=ors, eigener Schlüssel, eigene Limits). */
export const ors = registerRoutingProvider('ors', createOrsProvider({ getToken }))
const WEB = { ors, google }
/** Der gewählte Anbieter am Webspace (Google bzw. OpenRouteService) oder null (eingebaut). */
export const chosenProvider = () => WEB[chosenName()] || null
/** Name eines Anbieters für Texte: „Google“, „OpenRouteService“ bzw. „eingebaut (Luftlinie)“. */
export const providerText = (name) => WEB[name]?.short || 'eingebaut (Luftlinie)'
/** Beschriftung in der Auswahl. */
const TITLES = { luftlinie: 'Eingebaut (Luftlinie, kostenlos)', ors: 'OpenRouteService (kostenlos, OpenStreetMap)', google: 'Google (echte Fahrzeiten, über den Webspace)' }
/** Genauigkeit eines Treffers von OpenRouteService als Text. */
const PRECISION = { hausnummer: 'auf die Hausnummer genau', interpoliert: 'Hausnummer geschätzt', strasse: 'nur die Straße', ort: 'nur der Ort' }

const states = { google: { at: 0, loading: null }, ors: { at: 0, loading: null } }

/** Stand eines Anbieters vom Webspace lesen (eine Anfrage an routing.php, nicht an den Anbieter); maxAge: jünger als so viele ms → gespeicherter. */
export function providerStatus(p, { maxAge = 0 } = {}) {
  const state = states[p.name]
  if (state.loading) return state.loading
  if (state.at && Date.now() - state.at < maxAge) return Promise.resolve(p.status())
  state.loading = p.refresh().finally(() => {
    state.at = Date.now()
    state.loading = null
  })
  return state.loading
}

/** Stand des Google-Anbieters (wie providerStatus). */
export const googleStatus = (opts) => providerStatus(google, opts)
/** Stand des gewählten Anbieters am Webspace (eingebaut: nichts zu lesen). */
export const routingStatus = (opts) => (chosenProvider() ? providerStatus(chosenProvider(), opts) : Promise.resolve(null))

/** Für die Ansicht: ist ein Anbieter am Webspace gewählt, seinen Stand im Hintergrund lesen (höchstens jede Minute), danach onDone. */
export function watchRoutingStatus(onDone) {
  const p = chosenProvider()
  const state = p && states[p.name]
  if (!p || state.loading || (state.at && Date.now() - state.at < 60_000)) return
  providerStatus(p).then(() => onDone?.())
}

/** Nutzung des Monats als Text: „Routen 12, Adressen 3: 15 von 1000 Anfragen im November 2026, heute 4 von 100“. */
export function usageText(st = google.status()) {
  const n = st?.nutzung
  if (!n) return ''
  return `Routen ${n.routen}, Adressen ${n.geocode}: ${n.anfragen} von ${st.limitMonat || n.limitMonat} Anfragen im ${monthText(n.monat)}, heute ${n.heute} von ${st.limitTag || n.limitTag}`
}

/** Zeile über den Touren (HTML), nur wenn Google bzw. OpenRouteService gewählt ist: womit gerechnet wird, sonst warum nicht. */
export function routingLine({ ed = false } = {}) {
  const p = chosenProvider()
  if (!p) return ''
  const st = p.status()
  if (p.ready()) return `<p class="note mwg-line">${esc(p.label)} eingerichtet: beim Vorschlag legt ${esc(p.short)} je Tour Reihenfolge und Fahrzeiten fest, die Zuteilung auf die Fahrer macht die App (${esc(usageText(st))}).</p>`
  if (!st && !p.lastError()) return `<p class="note mwg-line">${esc(p.label)}: Stand vom Webspace wird gelesen …</p>`
  return `<div class="banner warn-banner mwg-line" role="status"><p><strong>${esc(p.label)} gewählt, aber ${esc(p.why())}.</strong> Bis dahin rechnet der eingebaute Anbieter (Luftlinie).</p>${ed ? '<button class="btn small" data-action="mwg-open">Routing</button>' : ''}</div>`
}

/**
 * Koordinaten zu einer Adresse: über den gewählten Anbieter (Google bzw. OpenRouteService), wenn eingerichtet (eine
 * Anfrage), sonst – auch wenn er ausfällt – über OpenStreetMap. Liefert { lat, lon, label, quality ('google' | 'ors' |
 * 'adresse'), source, precisionText?, notice? } oder null.
 */
export async function findCoords(address) {
  let notice = ''
  const p = chosenProvider()
  if (p) {
    await providerStatus(p, { maxAge: 60_000 })
    if (p.ready()) {
      try {
        const hit = await p.geocode(address)
        if (!hit) return null
        const precisionText = PRECISION[hit.precision] ? `${PRECISION[hit.precision]}${hit.partial ? ', Treffer unsicher – bitte prüfen' : ''}` : ''
        return { ...hit, source: p.short, ...(precisionText ? { precisionText } : {}) }
      } catch (err) {
        notice = `${p.short}: ${err.message} – Suche über OpenStreetMap.`
      }
    } else notice = `${p.label} ${p.why()} – Suche über OpenStreetMap.`
  }
  const hit = await geocode(address)
  return hit ? { ...hit, quality: 'adresse', source: 'OpenStreetMap', ...(notice ? { notice } : {}) } : null
}

// ---------------------------------------------------------------- Dialog „Routing“

function draft(m) {
  if (!m.d) m.d = { provider: chosenName() }
  return m.d
}

const ORS_HELP = [
  'Auf openrouteservice.org kostenlos registrieren (Firmen-E-Mail, ohne Kreditkarte).',
  'Im Dashboard einen Schlüssel erzeugen (kostenloser Plan „Standard“) und kopieren.',
  'Den Schlüssel hier eintragen und „OpenRouteService“ wählen. Er geht nur an den Webspace (routing.php) und steht nie in der App oder in SharePoint.',
  'Auf openrouteservice.org die Nutzungsbedingungen lesen: Ist die Gratis-Nutzung für Firmen erlaubt? (Rechtsprüfung Punkt 40)',
]

const HELP = [
  'Ein Google-Cloud-Projekt mit Abrechnung anlegen (console.cloud.google.com, Firmenkonto).',
  'Unter „APIs und Dienste“ die „Routes API“ und die „Geocoding API“ aktivieren.',
  'Einen API-Schlüssel erstellen und beschränken: nur diese zwei APIs, nur die IP-Adresse des Webspace (steht im World4You-Kundenbereich, sonst beim Support erfragen).',
  'Unter „Abrechnung → Budgets und Benachrichtigungen“ eine Budget-Warnung einrichten (z. B. 5 €).',
  'Unter „Google Maps Platform → Quotas“ für die Routes API ein Tageslimit setzen (z. B. 150 am Tag): so bleibt es sicher unter den 5000 Gratis-Anfragen im Monat, und Google lehnt weitere Anfragen ab, statt sie zu verrechnen.',
  'Den Schlüssel hier eintragen und „Google“ wählen. Er geht nur an den Webspace (routing.php) und steht nie in der App oder in SharePoint.',
]

/** Felder je Anbieter im Dialog (Google mit den bisherigen Kennungen). */
const FIELDS = {
  google: { key: 'mwg-key', month: 'mwg-month', day: 'mwg-day', confirm: 'mwg-remove', limits: GOOGLE_LIMITS, pattern: GOOGLE_KEY_PATTERN, placeholder: 'beginnt mit AIza', bad: 'Der API-Schlüssel sieht nicht richtig aus (39 Zeichen, beginnt mit AIza).', label: 'API-Schlüssel', none: 'Google-Routing ist am Webspace noch nicht eingerichtet.' },
  ors: { key: 'mwg-ors-key', month: 'mwg-ors-month', day: 'mwg-ors-day', confirm: 'mwg-remove:ors', limits: ORS_LIMITS, pattern: ORS_KEY_PATTERN, placeholder: 'Schlüssel von openrouteservice.org', bad: 'Der Schlüssel von OpenRouteService sieht nicht richtig aus (40 bis 200 Zeichen, Buchstaben und Ziffern ohne Leerzeichen).', label: 'Schlüssel (API-Key)', none: 'OpenRouteService ist am Webspace noch nicht eingerichtet.' },
}

/** Abschnitt eines Anbieters im Dialog: Stand, Schlüssel, Limits, Nutzung, Kosten, Anleitung. */
function providerSection(p) {
  const f = FIELDS[p.name]
  const st = p.status()
  const err = p.lastError()
  const keyOk = !!st?.vollzugriff && !app.readOnly
  const dis = keyOk ? '' : 'disabled'
  const statusHtml =
    !st && !err
      ? '<p class="muted">Stand vom Webspace wird gelesen …</p>'
      : !st
        ? `<div class="banner warn-banner"><p><strong>routing.php nicht erreichbar:</strong> ${esc(err?.message || '')}. ${err?.status === 401 ? 'Bitte neu anmelden.' : 'routing.php mit dem Paket hochladen (Hauptordner).'}</p></div>`
        : st.eingerichtet
          ? `<p class="mwg-state"><span class="mw-st st-erledigt">eingerichtet</span> ${st.schluesselEnde ? `Schlüssel …${esc(st.schluesselEnde)}` : 'Schlüssel am Webspace'}${st.geaendert ? `, geändert ${esc(new Date(st.geaendert).toLocaleDateString('de-AT'))}` : ''}</p>`
          : `<p class="mwg-state"><span class="mw-st st-nachzuholen">noch kein Schlüssel</span> ${esc(f.none)}</p>`
  const fields = st
    ? `<div class="form-grid">
          <label class="field wide"><span>${esc(f.label)}${st.eingerichtet ? ' (leer lassen = bleibt)' : ''}</span><input type="password" id="${f.key}" autocomplete="off" spellcheck="false" placeholder="${st.eingerichtet ? `…${esc(st.schluesselEnde || '')}` : esc(f.placeholder)}" ${dis}></label>
          <label class="field"><span>Anfragen je Monat höchstens</span><input type="number" id="${f.month}" min="1" max="100000" step="1" inputmode="numeric" value="${esc(st.limitMonat ?? f.limits.month)}" ${dis}></label>
          <label class="field"><span>Anfragen je Tag höchstens</span><input type="number" id="${f.day}" min="1" max="10000" step="1" inputmode="numeric" value="${esc(st.limitTag ?? f.limits.day)}" ${dis}></label>
        </div>
        ${keyOk ? '' : '<p class="muted">Schlüssel und Limits richtet nur Vollzugriff ein.</p>'}`
    : ''
  const n = st?.nutzung
  const counts = n ? `<p>${esc(plural(n.routen, 'Route', 'Routen'))} (Tourvorschläge und Neurechnen), ${esc(plural(n.geocode, 'Adresse', 'Adressen'))} gesucht: <strong>${n.anfragen} von ${st.limitMonat}</strong> Anfragen im Monat, heute ${n.heute} von ${st.limitTag}.</p>` : ''
  const confirmRemove = app.ui.confirm === f.confirm
  const remove = keyOk && st?.eingerichtet ? `<p class="actions mwg-keyrow"><button class="btn small ${confirmRemove ? 'danger confirm' : 'ghost'}" data-action="mwg-remove" data-provider="${p.name}">${confirmRemove ? 'Wirklich entfernen?' : 'Schlüssel entfernen'}</button></p>` : ''
  if (p.name === 'ors') {
    return `<section class="mwg-provider" aria-label="OpenRouteService"><h3 class="mwg-h">OpenRouteService am Webspace</h3>
      <p class="muted">HeiGIT gGmbH (Heidelberg), Routen auf OpenStreetMap; kostenloser Schlüssel, keine Kreditkarte.</p>
      ${statusHtml}${fields}${remove}
      <section class="mwg-usage" aria-label="Nutzung OpenRouteService">${n ? `<h4>Nutzung im ${esc(monthText(n.monat))}</h4>${counts}` : ''}
        <p>Kosten: <strong>0 €</strong> (Gratis-Kontingent laut Anbieter, z. B. rund ${ORS_FREE.directions} Routen und ${ORS_FREE.optimization} Optimierungen am Tag – bitte auf openrouteservice.org prüfen, auch ob die Nutzung für Firmen erlaubt ist).</p></section>
      <h4 class="mwg-h">So wird OpenRouteService eingerichtet</h4>
      <ol class="mwg-steps">${ORS_HELP.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      <p class="note">Datenschutz: An OpenRouteService (Server in Deutschland) gehen die Koordinaten von Betriebshof und Stopps, Arbeitszeit und Zeitfenster je Stopp und die Arbeitszeit des Fahrers (bei „Koordinaten suchen“ die Adresse), keine Namen. Vorher Punkt 40 der Rechtsprüfung klären.</p>
      <p class="muted mwg-attr">${esc(ORS_ATTRIBUTION)}</p></section>`
  }
  const cost = n ? googleCost(n) : null
  const usage = n ? `<section class="mwg-usage" aria-label="Nutzung"><h4>Nutzung im ${esc(monthText(n.monat))}</h4>${counts}<p>Geschätzte Kosten: <strong>${esc(usd(cost.total))}</strong>${cost.total ? '' : ' (innerhalb der Gratis-Anfragen)'}.</p></section>` : ''
  const prices = `<p class="note">Preise laut Google, Stand ${esc(asOf())} – bitte im Google-Konto prüfen: Compute Routes ab ${GOOGLE_PRICES.routes.per1000} US-Dollar je 1000 Anfragen über ${GOOGLE_PRICES.routes.free} Gratis-Anfragen im Monat, Geocoding ${GOOGLE_PRICES.geocode.per1000} US-Dollar je 1000 über ${GOOGLE_PRICES.geocode.free} Gratis-Anfragen im Monat. Das Monatslimit von ${GOOGLE_LIMITS.month} hält die Nutzung im Gratis-Kontingent; ein Tageslimit im Google-Konto (Quotas) verhindert Kosten auch bei einem Fehler.</p>`
  return `<section class="mwg-provider" aria-label="Google"><h3 class="mwg-h">Google am Webspace</h3>
      ${statusHtml}${fields}${remove}${usage}${prices}
      <h4 class="mwg-h">So wird Google eingerichtet</h4>
      <ol class="mwg-steps">${HELP.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      <p class="note">Datenschutz: An Google gehen nur die Koordinaten von Betriebshof und Stopps (bei „Koordinaten suchen“ die Adresse), keine Namen von Kunden oder Fahrern. Vorher Punkt 39 der Rechtsprüfung klären.</p></section>`
}

registerModal(
  'mwg-routing',
  (c, m) => {
    const d = draft(m)
    const mayChoose = voll() && !app.readOnly
    const keyOk = Object.values(WEB).some((p) => !!p.status()?.vollzugriff) && !app.readOnly
    return modalFrame({
      title: 'Routing: Reihenfolge und Fahrzeiten',
      wide: true,
      body: `<p>Der eingebaute Anbieter schätzt die Fahrzeiten aus der Luftlinie (kostenlos). Mit OpenRouteService (kostenlos, auf OpenStreetMap) oder Google kommen echte Fahrzeiten und Strecken: die Zuteilung auf die Fahrer macht weiter die App, der Anbieter legt je Tour die Reihenfolge fest. Fällt er aus (kein Schlüssel, Limit, keine Verbindung), rechnet der eingebaute Anbieter mit einem Hinweis.</p>
        <div class="form-grid">
          <label class="field wide"><span>Anbieter</span><select id="mwg-provider" ${mayChoose ? '' : 'disabled'}>${options(
            ['luftlinie', 'ors', 'google'].map((k) => [k, TITLES[k]]),
            d.provider,
          )}</select></label>
        </div>
        ${providerSection(ors)}
        ${providerSection(google)}`,
      foot: `<div class="actions"></div><div class="actions"><button class="btn" data-action="close-modal">${mayChoose || keyOk ? 'Abbrechen' : 'Schließen'}</button>${mayChoose || keyOk ? '<button class="btn primary" data-action="mwg-save">Speichern</button>' : ''}</div>`,
    })
  },
  { module: MODULE },
)

function openRouting() {
  openModal({ type: 'mwg-routing' })
  // beide Anbieter lesen, einmal neu zeichnen (die Abschnitte erscheinen zusammen)
  Promise.all(Object.values(WEB).map((p) => providerStatus(p))).then(() => {
    if (app.ui.modal?.type === 'mwg-routing') renderModalKeepingInput()
  })
}

/** Schlüssel und Limits eines Anbieters speichern, wenn geändert (nur Vollzugriff); false bei Fehler (Meldung gezeigt). */
async function saveProvider(p) {
  const f = FIELDS[p.name]
  const st = p.status()
  if (!document.getElementById(f.key)) return true
  const key = val(f.key).trim()
  const month = Math.round(Number(val(f.month)))
  const day = Math.round(Number(val(f.day)))
  const fail = (text) => {
    toast(text)
    return false
  }
  if (key && !f.pattern.test(key)) return fail(f.bad)
  const limitsChanged = st && document.getElementById(f.month) && (month !== st.limitMonat || day !== st.limitTag)
  if (limitsChanged && (!(month >= 1 && month <= 100000) || !(day >= 1 && day <= 10000))) return fail(`Limits${p.name === 'google' ? '' : ` für ${p.short}`}: je Monat 1 bis 100000, je Tag 1 bis 10000 Anfragen.`)
  if (st?.vollzugriff && (key || limitsChanged)) {
    if (!key && !st.eingerichtet) return fail(p.name === 'google' ? 'Bitte zuerst den API-Schlüssel eintragen.' : `Bitte zuerst den Schlüssel von ${p.short} eintragen.`)
    try {
      await p.setup({ ...(key ? { schluessel: key } : {}), limitMonat: month, limitTag: day })
      states[p.name].at = Date.now()
    } catch (err) {
      return fail(`Nicht gespeichert${p.name === 'google' ? '' : ` (${p.short})`}: ${err.message}`)
    }
  }
  return true
}

async function saveRouting() {
  const m = app.ui.modal
  if (m?.type !== 'mwg-routing') return
  const d = draft(m)
  const picked = val('mwg-provider')
  const provider = picked === 'google' || picked === 'ors' ? picked : 'luftlinie'
  for (const p of Object.values(WEB)) if (!(await saveProvider(p))) return
  if (provider !== chosenName()) {
    if (!voll()) return toast('Den Anbieter wählt nur Vollzugriff.')
    settings().routing = { ...routingSettings(), provider }
    persist()
  }
  d.provider = provider
  closeModal()
  renderNow()
  const p = WEB[provider]
  const now = p?.status()
  toast(!p ? 'Gespeichert: der eingebaute Anbieter rechnet (Luftlinie).' : now?.eingerichtet ? `Gespeichert: ${p.short} rechnet Reihenfolge und Fahrzeiten (Schlüssel …${now.schluesselEnde || ''}).` : `Gespeichert. ${p.short} ist gewählt, aber noch nicht eingerichtet: bis dahin rechnet der eingebaute Anbieter.`)
}

async function removeKey(name) {
  const p = WEB[name] || google
  if (!confirmStep(FIELDS[p.name].confirm, renderModalKeepingInput)) return
  try {
    await p.setup({ entfernen: true })
    states[p.name].at = Date.now()
    renderModalKeepingInput()
    toast(`Schlüssel${p.name === 'google' ? '' : ` von ${p.short}`} am Webspace entfernt: bis zu einem neuen rechnet der eingebaute Anbieter.`)
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
    'mwg-remove': (el) => removeKey(el?.dataset?.provider),
  },
  { edit: '*' },
)
