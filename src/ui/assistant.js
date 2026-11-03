// KI-Assistent im Chat: Fenster mit Verlauf, Eingabe (Tastatur oder Sprache), Bestätigung jeder Änderung,
// Schnellstarts. Einstellungen (API-Schlüssel, Modell, Aufwand, Limits, Verbrauch) nur mit Vollzugriff.
// Gesprächsablauf: src/ai/agent.js (SDK und Werkzeuge werden erst beim ersten Senden geladen).

import { app, closeModal, onModalRender, openModal, registerActions, registerModal, renderModal, renderModalKeepingInput, toast, VIEWS } from './context.js'
import { esc, modalFrame, options, val } from './shared.js'

const SPARK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8l5.1-1.4z" fill="currentColor"/><path d="M13 1.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5L11 3.5l1.5-.5z" fill="currentColor"/></svg>'
const MODEL_INFO = {
  'claude-opus-5-5': 'Claude Opus 5.5 – am stärksten (empfohlen), $4 / $20 je Mio. Tokens',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 – schnell und günstiger, $2 / $10 je Mio. Tokens',
  'claude-haiku-5-5': 'Claude Haiku 5.5 – sehr günstig, für einfache Fragen, $0,10 / $0,50 je Mio. Tokens',
}
const EFFORT = [['low', 'schnell (wenig Nachdenken)'], ['medium', 'ausgewogen (empfohlen)'], ['high', 'gründlich (langsamer, teurer)']]
const STARTERS = ['Was steht heute an?', 'Wer arbeitet morgen und wo ist noch etwas offen?', 'Termin morgen um 12 Uhr in Salzburg mit ', ' ist ab heute bis Freitag krank', 'Reklamation: ']

const ai = () => (app.ui.ai ||= { log: [], history: [], busy: false, pending: null, status: null, statusError: '' })

export const assistantButton = ({ compact = false } = {}) => `<button class="btn ai-btn ${compact ? 'icon' : ''}" data-action="ai-open" title="KI-Assistent (Strg+J)" aria-label="KI-Assistent">${SPARK}${compact ? '' : '<span>Assistent</span>'}</button>`

/** Etwas Markdown: Absätze, Listen, **fett**, Links (sicher, nach dem Escapen). */
function rich(text) {
  const lines = esc(text).split('\n')
  let html = ''
  let list = false
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">Link</a>')
    const item = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line)
    if (item) {
      if (!list) html += '<ul>'
      list = true
      html += `<li>${item[1]}</li>`
      continue
    }
    if (list) html += '</ul>'
    list = false
    html += line.trim() ? `<p>${line}</p>` : ''
  }
  return html + (list ? '</ul>' : '')
}

function logHtml() {
  const s = ai()
  return s.log
    .map((e) => {
      if (e.role === 'user') return `<div class="ai-msg ai-user">${rich(e.text)}</div>`
      if (e.role === 'assistant') return `<div class="ai-msg ai-bot">${rich(e.text)}</div>`
      if (e.role === 'step') return `<div class="ai-step ${e.phase}">${esc(e.text)}</div>`
      if (e.role === 'error') return `<div class="ai-msg ai-error">${esc(e.text)}</div>`
      if (e.role === 'confirm') {
        const open = s.pending?.id === e.id
        return `<div class="ai-confirm ${e.answer || ''}"><strong>${esc(e.summary.title)}</strong>${e.summary.lines.map((l) => `<div>${esc(l)}</div>`).join('')}
          ${open ? `<div class="actions"><button class="btn" data-action="ai-decline">Abbrechen</button><button class="btn primary" data-action="ai-accept">Ausführen</button></div>` : `<div class="muted">${e.answer === 'ja' ? '✓ bestätigt' : '✗ abgebrochen'}</div>`}</div>`
      }
      return ''
    })
    .join('')
}

function assistantModal() {
  const s = ai()
  const st = s.status
  const ready = st?.aktiv
  const notice = s.statusError
    ? `<div class="banner warn-banner"><p>${esc(s.statusError)}</p></div>`
    : st && !st.eingerichtet
      ? `<div class="banner welcome"><p><strong>Der KI-Assistent ist noch nicht eingerichtet.</strong> ${st.vollzugriff ? 'Unter „Einstellungen“ den API-Schlüssel von Anthropic eintragen.' : 'Bitte das Büro (Vollzugriff) bitten, ihn einzurichten.'}</p></div>`
      : st && !st.aktiv
        ? '<div class="banner warn-banner"><p>Der KI-Assistent ist ausgeschaltet.</p></div>'
        : ''
  const empty = !s.log.length && ready
  return modalFrame({
    title: 'KI-Assistent',
    subtitle: st?.modellName ? `${esc(st.modellName)} · fragt vor jeder Änderung nach` : 'fragt vor jeder Änderung nach',
    wide: true,
    body: `${notice}
      <div class="ai-log" aria-live="polite">${empty ? `<div class="ai-intro"><p>Sag oder schreib, was zu tun ist, zum Beispiel:</p><div class="ai-starters">${STARTERS.map((x, i) => `<button class="btn small" data-action="ai-starter" data-i="${i}">${esc(x.trim() || x)}${x.endsWith(' ') ? '…' : ''}</button>`).join('')}</div></div>` : logHtml()}${s.busy && !s.pending ? '<div class="ai-step running"><span class="ai-dots"></span> arbeitet …</div>' : ''}</div>
      <div class="ai-input">
        <textarea id="ai-text" rows="2" placeholder="${ready ? 'z. B. „Termin morgen 12 Uhr in Salzburg mit Herrn Maier“' : 'noch nicht verfügbar'}" ${ready && !s.busy ? '' : 'disabled'} data-ai-enter="1"></textarea>
        ${speech() ? `<button class="btn icon ai-mic ${s.listening ? 'on' : ''}" data-action="ai-mic" title="Sprechen" aria-label="Sprechen" ${ready && !s.busy ? '' : 'disabled'}><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8" rx="2.5" fill="currentColor"/><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>` : ''}
        <button class="btn primary" data-action="ai-send" ${ready && !s.busy ? '' : 'disabled'}>Senden</button>
      </div>`,
    foot: `<div class="actions">${s.log.length && !s.busy ? '<button class="btn" data-action="ai-reset">Neues Gespräch</button>' : ''}${s.busy ? '<button class="btn" data-action="ai-stop">Stopp</button>' : ''}</div>
      <div class="actions">${st?.vollzugriff ? '<button class="btn" data-action="ai-settings">Einstellungen</button>' : ''}<button class="btn" data-action="close-modal">Schließen</button></div>`,
  })
}
registerModal('assistant', assistantModal)

// nach jedem Zeichnen: ans Ende scrollen, Enter sendet
onModalRender(($modal) => {
  const log = $modal.querySelector('.ai-log')
  if (log) log.scrollTop = log.scrollHeight
  const ta = $modal.querySelector('#ai-text')
  if (ta && !ta.dataset.bound) {
    ta.dataset.bound = '1'
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        send()
      }
    })
    if (!ai().busy) ta.focus({ preventScroll: true })
  }
})

const redraw = () => (app.ui.modal?.type === 'assistant' ? renderModalKeepingInput() : null)
const push = (entry) => {
  ai().log.push(entry)
  redraw()
}

async function loadStatus() {
  const s = ai()
  try {
    const { kiRequest } = await import('../ai/agent.js')
    s.status = await kiRequest('status')
    s.statusError = ''
  } catch (err) {
    s.status = null
    s.statusError = err.status === 401 ? 'Bitte neu anmelden (Microsoft), dann geht der Assistent.' : `Assistent nicht erreichbar: ${err.message}`
  }
  redraw()
}

function confirmInChat(summary) {
  const s = ai()
  const id = `c${Date.now()}`
  return new Promise((resolve) => {
    s.pending = { id, resolve }
    push({ role: 'confirm', id, summary: { title: summary.title || 'Ausführen?', lines: summary.lines || [] } })
  })
}

function answer(yes) {
  const s = ai()
  if (!s.pending) return
  const entry = s.log.find((e) => e.id === s.pending.id)
  if (entry) entry.answer = yes ? 'ja' : 'nein'
  const { resolve } = s.pending
  s.pending = null
  redraw()
  resolve(yes)
}

async function send(textArg) {
  const s = ai()
  const text = String(textArg ?? val('ai-text')).trim()
  if (!text || s.busy || !s.status?.aktiv) return
  const field = document.getElementById('ai-text')
  if (field) field.value = ''
  s.busy = true
  push({ role: 'user', text })
  const controller = new AbortController()
  s.abort = controller
  try {
    const { runTurn, TOOL_LABEL } = await import('../ai/agent.js')
    const view = VIEWS.find((v) => v.id === app.ui.view)?.label || ''
    const res = await runTurn({
      history: s.history,
      text,
      view,
      signal: controller.signal,
      confirm: confirmInChat,
      onStep: (e) => {
        if (e.type === 'text') return push({ role: 'assistant', text: e.text })
        const label = TOOL_LABEL[e.name] || e.name
        if (e.phase === 'done' && !['termin_erstellen', 'abwesenheit_eintragen', 'vertretungen_verteilen', 'einteilen', 'reklamation_erfassen', 'material_anfordern', 'email_senden'].includes(e.name)) push({ role: 'step', phase: 'done', text: `✓ ${label}` })
        else if (e.phase === 'done') push({ role: 'step', phase: 'done', text: `✓ ${label}: erledigt` })
        else if (e.phase === 'error') push({ role: 'step', phase: 'error', text: `${label}: ${e.error}` })
      },
    })
    s.history = res.history
    if (res.text) push({ role: 'assistant', text: res.text })
    if (res.stop === 'max_tokens') push({ role: 'error', text: 'Die Antwort wurde abgeschnitten. Bitte die Frage enger stellen.' })
  } catch (err) {
    if (s.pending) answer(false)
    const status = err?.status
    push({ role: 'error', text: controller.signal.aborted ? 'Gestoppt.' : status === 429 ? err.error?.error?.message || 'Tageslimit erreicht.' : status === 401 ? 'Anmeldung abgelaufen: bitte die App neu laden.' : status === 503 ? 'Der Assistent ist noch nicht eingerichtet.' : `Fehler: ${err?.error?.error?.message || err?.message || err}` })
  } finally {
    s.busy = false
    s.abort = null
    redraw()
  }
}

// ---------------------------------------------------------------- Sprache

const speech = () => typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

function listen() {
  const s = ai()
  const Rec = speech()
  if (!Rec) return toast('Spracheingabe gibt es in diesem Browser nicht. Am Handy geht das Mikrofon der Tastatur.')
  if (s.listening) return s.recognizer?.stop()
  const rec = new Rec()
  rec.lang = 'de-AT'
  rec.interimResults = true
  rec.continuous = false
  s.recognizer = rec
  s.listening = true
  redraw()
  let finalText = ''
  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (finalText += e.results[i][0].transcript) : (interim += e.results[i][0].transcript))
    const ta = document.getElementById('ai-text')
    if (ta) ta.value = `${finalText}${interim}`.trim()
  }
  rec.onerror = (e) => toast(e.error === 'not-allowed' ? 'Mikrofon nicht erlaubt (Browser-Einstellungen).' : `Spracheingabe: ${e.error}`)
  rec.onend = () => {
    s.listening = false
    s.recognizer = null
    redraw()
    if (finalText.trim()) send(finalText)
  }
  rec.start()
}

// ---------------------------------------------------------------- Einstellungen

function settingsModal() {
  const st = ai().status || {}
  const m = st.monat
  return modalFrame({
    title: 'KI-Assistent einrichten',
    subtitle: st.eingerichtet ? `eingerichtet · Schlüssel …${esc(st.schluesselEnde || '')}` : 'noch nicht eingerichtet',
    body: `<p class="note">Der Assistent nutzt die Claude-API von Anthropic. Den API-Schlüssel unter <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> anlegen (Firmenkonto, Zahlungsmittel hinterlegen, Ausgabenlimit setzen). Er wird nur am Webspace gespeichert (privat/ki.json), nie im Browser oder in SharePoint.</p>
      <div class="form-grid">
        <label class="field wide"><span>API-Schlüssel${st.eingerichtet ? ' (leer lassen = bleibt)' : ''}</span><input type="password" id="ais-key" autocomplete="off" placeholder="${st.eingerichtet ? `•••• ${esc(st.schluesselEnde || '')}` : 'sk-ant-…'}"></label>
        <label class="field wide"><span>Modell</span><select id="ais-model">${options(Object.entries(MODEL_INFO), st.modell || 'claude-opus-5-5')}</select></label>
        <label class="field"><span>Aufwand</span><select id="ais-effort">${options(EFFORT, st.aufwand || 'medium')}</select></label>
        <label class="field"><span>Anfragen je Person und Tag</span><input type="number" id="ais-lp" min="1" max="2000" value="${esc(st.limitPerson || 150)}"></label>
        <label class="field"><span>Anfragen gesamt je Tag</span><input type="number" id="ais-lg" min="1" max="20000" value="${esc(st.limitGesamt || 1500)}"></label>
        <label class="check"><input type="checkbox" id="ais-on" ${st.aktiv !== false ? 'checked' : ''}><span>eingeschaltet</span></label>
      </div>
      ${m ? `<section><h3>Verbrauch ${esc(m.monat)}</h3><p>${m.anfragen} Anfragen · ${Math.round((m.eingabe + m.cache) / 1000)} Tsd. Tokens gelesen (davon ${Math.round(m.cache / 1000)} Tsd. aus dem Zwischenspeicher) · ${Math.round(m.ausgabe / 1000)} Tsd. Tokens geschrieben · <strong>ca. $${Number(m.kosten).toFixed(2)}</strong></p><p class="note">Schätzung aus den Listenpreisen; maßgeblich ist die Abrechnung in der Anthropic Console.</p></section>` : ''}
      ${st.php?.zeitlimit && st.php.zeitlimit < 120 ? `<p class="note">PHP darf am Webspace nur ${st.php.zeitlimit} s rechnen; lange Aufgaben können abbrechen. Wenn möglich auf 180 s stellen.</p>` : ''}`,
    foot: `<button class="btn" data-action="ai-open">Zurück</button><div class="actions"><button class="btn primary" data-action="ai-settings-save">Speichern</button></div>`,
  })
}
registerModal('ai-settings', settingsModal)

// ---------------------------------------------------------------- Aktionen

registerActions({
  'ai-open': () => {
    openModal({ type: 'assistant' })
    if (!ai().status) loadStatus()
  },
  'ai-send': () => send(),
  'ai-starter': (el) => {
    const x = STARTERS[Number(el.dataset.i)]
    if (!x.endsWith(' ') && !x.startsWith(' ')) return send(x)
    renderModal()
    const ta = document.getElementById('ai-text')
    if (ta) {
      ta.value = x.trimStart()
      ta.focus()
      if (x.startsWith(' ')) ta.setSelectionRange(0, 0)
    }
  },
  'ai-accept': () => answer(true),
  'ai-decline': () => answer(false),
  'ai-stop': () => {
    const s = ai()
    if (s.pending) answer(false)
    s.abort?.abort()
  },
  'ai-reset': () => {
    Object.assign(ai(), { log: [], history: [], pending: null })
    renderModal()
  },
  'ai-mic': () => listen(),
  'ai-settings': () => openModal({ type: 'ai-settings' }),
  'ai-settings-save': async () => {
    try {
      const { kiRequest } = await import('../ai/agent.js')
      ai().status = await kiRequest('einrichten', { schluessel: val('ais-key').trim(), modell: val('ais-model'), aufwand: val('ais-effort'), limitPerson: Number(val('ais-lp')), limitGesamt: Number(val('ais-lg')), aktiv: document.getElementById('ais-on')?.checked })
      toast('Gespeichert. Der Assistent ist bereit.')
      openModal({ type: 'assistant' })
    } catch (err) {
      toast(`Nicht gespeichert: ${err.message}`)
    }
  },
})

// Strg+J öffnet den Assistenten
if (typeof document !== 'undefined')
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault()
      if (app.ui.modal?.type === 'assistant') closeModal()
      else {
        openModal({ type: 'assistant' })
        if (!ai().status) loadStatus()
      }
    }
  })
