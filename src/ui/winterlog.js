// Winterdienst-Protokoll in der App: Einträge vom Handy (Link aus dem Schnee-Alarm)
// übernehmen, die Fotos dabei nach SharePoint legen, in der App eintragen,
// Übersicht je Tag und Objekt, fehlende Protokolle unter „Zu erledigen“ und
// das PDF je Monat als Nachweis (core/winterlog.js, export/winter-pdf.js).

import { addDays, formatDate, mondayOf, MONTH_LONG, todayISO } from '../core/dates.js'
import { viennaParts, viennaTime } from '../core/weather.js'
import { entriesFor, logKey, logRows, missingLogs, newFromServer, photoPath, STREUMITTEL, workText } from '../core/winterlog.js'
import { winterLogDocument, winterLogPdfName } from '../export/winter-pdf.js'
import { app, canEdit, closeModal, confirmStep, onModalRender, openModal, persist, recordUndo, registerActions, registerModal, renderModal, renderNow, toast } from './context.js'
import { registerTodo } from './modals/todo.js'
import { loadLogo, pdfBlob } from './pdf.js'
import { checked, download, esc, ICON, modalFrame, options, uid, val } from './shared.js'
import { alarmSettings } from './views/weather-alarm.js'
import { weatherRules } from './weather.js'

const logOf = () => (app.data.winterlog ||= {})
const editable = () => canEdit('planung') && !app.readOnly
const empName = (id) => app.data.employees.find((e) => e.id === id)?.name || ''
const objOf = (id) => app.data.objects.find((o) => o.id === id)
const timeOf = (iso) => {
  const p = viennaParts(iso)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

// ---------------------------------------------------------------- Vom Handy übernehmen

const sync = { at: 0, running: false, error: '', pending: 0 }

async function serverJson(url) {
  const res = await fetch(url, { headers: { 'X-Schluessel': alarmSettings().key }, cache: 'no-store' })
  if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('wetter-alarm.php fehlt am Webspace')
  const json = await res.json()
  if (!res.ok) throw new Error(json.fehler || `Antwort ${res.status}`)
  return json
}

async function serverPhoto(datei) {
  const res = await fetch(`wetter-alarm.php?aktion=foto&datei=${encodeURIComponent(datei)}`, { headers: { 'X-Schluessel': alarmSettings().key }, cache: 'no-store' })
  if (!res.ok) throw new Error(`Foto ${datei}: Antwort ${res.status}`)
  return res.blob()
}

/** Protokolle vom Webspace holen und übernehmen (Fotos nach SharePoint). Höchstens alle 3 Minuten, force: sofort. */
export async function syncFromPhones({ force = false } = {}) {
  const a = alarmSettings()
  if (!a.enabled || !a.key || sync.running || (!force && Date.now() - sync.at < 180e3)) return 0
  sync.running = true
  sync.at = Date.now()
  let taken = 0
  try {
    const { eintraege } = await serverJson('wetter-alarm.php?aktion=protokolle')
    const neu = newFromServer(eintraege, logOf())
    sync.pending = neu.length
    if (neu.length && editable()) {
      await app.service.ensureWeeks([...new Set(neu.map((e) => mondayOf(e.date)))])
      for (const e of newFromServer(eintraege, logOf())) {
        const o = objOf(e.objectId)
        if (app.store.kind === 'sharepoint') {
          for (const f of e.fotos) {
            try {
              const path = photoPath(e, f.datei, o?.name || e.object)
              const up = await app.store.upload(path, await serverPhoto(f.datei), 'image/jpeg')
              Object.assign(f, { pfad: path, url: up.webUrl || '' })
            } catch {
              /* bleibt am Webspace, nächster Versuch beim PDF */
            }
          }
        }
        logOf()[logKey(e)] = e
        taken++
      }
      sync.pending = 0
      persist()
      toast(`${taken} ${taken === 1 ? 'Protokoll' : 'Protokolle'} vom Handy übernommen${app.store.kind === 'sharepoint' ? ', Fotos in SharePoint' : ''}.`)
    }
    sync.error = ''
  } catch (err) {
    sync.error = err.message || String(err)
  }
  sync.running = false
  if (app.ui.view === 'wetter') renderNow()
  return taken
}

// ---------------------------------------------------------------- Fotos

async function photoBlob(f) {
  if (f.pfad && app.store.kind === 'sharepoint' && app.store.readBlob) {
    try {
      return await app.store.readBlob(f.pfad)
    } catch {
      /* sonst vom Webspace */
    }
  }
  if (alarmSettings().key) return serverPhoto(f.datei)
  throw new Error('Foto nicht erreichbar')
}

/** Foto als data-URL (verkleinert, JPEG) für das PDF. */
async function photoDataUrl(f, max = 1000) {
  const blob = await photoBlob(f)
  const bmp = await createImageBitmap(blob)
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * s)
  c.height = Math.round(bmp.height * s)
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.8)
}

// ---------------------------------------------------------------- Übersicht in „Wetter & Winterdienst“

export function logSection(today = todayISO()) {
  if (!(app.data.objects || []).some((o) => o.winter?.active) && !Object.keys(logOf()).length) return ''
  syncFromPhones()
  const from = addDays(today, -13)
  const rows = new Map()
  for (const [key, call] of Object.entries(app.data.winter || {})) {
    const [date, objectId] = key.split('|')
    if (call && !call.cancelled && date >= from && date <= today) rows.set(`${date}|${objectId}`, { date, objectId, call })
  }
  for (const e of Object.values(logOf())) if (e.date >= from && e.date <= today) rows.set(`${e.date}|${e.objectId}`, { ...(rows.get(`${e.date}|${e.objectId}`) || {}), date: e.date, objectId: e.objectId })
  const list = [...rows.values()].sort((a, b) => b.date.localeCompare(a.date) || (objOf(a.objectId)?.name || '').localeCompare(objOf(b.objectId)?.name || ''))
  const ed = editable()
  const body = list
    .map((r) => {
      const o = objOf(r.objectId)
      const entries = entriesFor(logOf(), r.date, r.objectId)
      const status = entries.length
        ? entries.map((e) => `<span class="pill ok">${esc(timeOf(e.at))} ${esc(e.person || '')}: ${esc(workText(e))}</span>${e.fotos?.length ? ` <button class="link-btn" data-action="winterlog-fotos" data-key="${esc(logKey(e))}">${e.fotos.length} ${e.fotos.length === 1 ? 'Foto' : 'Fotos'}</button>` : ''}${e.notiz ? ` <span class="muted">${esc(e.notiz)}</span>` : ''}`).join('<br>')
        : `<span class="pill error">kein Protokoll</span>`
      return `<tr><td>${esc(formatDate(r.date))}</td><td><strong>${esc(o?.short || o?.name || r.objectId)}</strong></td><td>${status}</td><td class="actions">${ed ? `<button class="btn small" data-action="winterlog-add" data-date="${esc(r.date)}" data-obj="${esc(r.objectId)}">Eintragen</button>` : ''}</td></tr>`
    })
    .join('')
  const months = [...new Set([today.slice(0, 7), addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7), ...Object.values(logOf()).map((e) => e.date.slice(0, 7))])].sort().reverse()
  const a = alarmSettings()
  const syncLine = a.enabled
    ? `<p class="note">${sync.error ? `<span class="pill warning">Protokolle vom Handy: ${esc(sync.error)}</span>` : sync.pending && !ed ? `${sync.pending} neue Protokolle vom Handy warten auf die Übernahme (Disposition).` : `Protokolle vom Handy werden beim Öffnen übernommen${sync.at ? `, zuletzt ${new Date(sync.at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} Uhr` : ''}.`}</p>`
    : '<p class="note">Am Handy eintragen geht über den Schnee-Alarm (Knopf „Protokoll“). Ohne Alarm hier eintragen.</p>'
  return `<section class="wx-loc wx-log"><h3>${ICON.check} Winterdienst-Protokoll <span class="muted">(14 Tage)</span></h3>
    <p class="note">Nachweis: wer wann wo geräumt und gestreut hat (§ 93 StVO). Fehlt nach dem Einsatz ein Protokoll, steht es unter „Zu erledigen“.</p>
    ${list.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Tag</th><th>Objekt</th><th>Protokoll</th><th></th></tr></thead><tbody>${body}</tbody></table></div>` : '<p class="muted">Noch kein Winterdienst in den letzten 14 Tagen.</p>'}
    ${syncLine}
    <div class="toolbar">${ed ? `<button class="btn" data-action="winterlog-add">${ICON.plus} Eintragen</button>` : ''}${a.enabled ? `<button class="btn" data-action="winterlog-sync">${ICON.refresh} Vom Handy holen</button>` : ''}
      <label class="field inline"><span>PDF</span><select id="wl-month">${options(months.map((m) => [m, `${MONTH_LONG[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`]), months[0])}</select></label><button class="btn" data-action="winterlog-pdf">${ICON.sheet || ''} PDF-Nachweis</button></div>
  </section>`
}

// ---------------------------------------------------------------- Eintrag im Einsatz-Dialog

/** Block im Einsatz-Dialog eines Winterdienst-Einsatzes: Protokoll und „Erledigt eintragen“. */
export function winterLogBlock(inst) {
  if (inst.category !== 'winter') return ''
  const entries = entriesFor(logOf(), inst.origDate, inst.objectId)
  const emp = (app.data.assignments?.[inst.key] || [])[0]?.employeeId || ''
  return `<section><h3>Protokoll</h3>${entries.length ? `<ul class="wx-log-list">${entries.map((e) => `<li><strong>${esc(timeOf(e.at))}</strong> ${esc(e.person || '')}: ${esc(workText(e))}${e.fotos?.length ? `, ${e.fotos.length} ${e.fotos.length === 1 ? 'Foto' : 'Fotos'}` : ''}${e.notiz ? ` · ${esc(e.notiz)}` : ''} <span class="muted">(${esc(e.quelle)})</span></li>`).join('')}</ul>` : '<p class="note">Noch kein Protokoll.</p>'}
    ${editable() ? `<button class="btn primary" data-action="winterlog-add" data-date="${esc(inst.origDate)}" data-obj="${esc(inst.objectId)}" data-emp="${esc(emp)}">${ICON.check} Erledigt eintragen</button>` : ''}</section>`
}

function addModal(c, m) {
  const objects = (app.data.objects || []).filter((o) => o.winter?.active)
  const list = objects.length ? objects : app.data.objects
  const date = m.date || todayISO()
  const objectId = m.objectId || ''
  const team = objOf(objectId)?.winter?.team || []
  const emp = m.emp || team[0] || ''
  const people = [...new Set([...team, ...app.data.employees.map((e) => e.id)])].map((id) => [id, empName(id)]).filter(([, n]) => n)
  return modalFrame({
    title: 'Winterdienst eintragen',
    subtitle: 'Nachweis: geräumt und gestreut',
    body: `<div class="form-grid">
      <label class="field"><span>Tag</span><input type="date" id="wl-date" value="${esc(date)}"></label>
      <label class="field"><span>Erledigt um</span><input type="time" id="wl-time" value="${esc(m.time || timeOf(new Date().toISOString()))}"></label>
      <label class="field wide"><span>Objekt</span><select id="wl-obj">${options(list.map((o) => [o.id, `${o.name}${o.address ? `, ${o.address}` : ''}`]), objectId, { empty: '– wählen –' })}</select></label>
      <label class="field wide"><span>Durchgeführt von</span><select id="wl-emp">${options(people, emp, { empty: '– wählen –' })}</select></label>
      <label class="check"><input type="checkbox" id="wl-geraeumt" checked><span>Geräumt</span></label>
      <label class="check"><input type="checkbox" id="wl-gestreut" checked><span>Gestreut</span></label>
      <label class="check"><input type="checkbox" id="wl-kontrolle"><span>Nur kontrolliert, nichts nötig</span></label>
      <label class="field"><span>Streumittel</span><select id="wl-mittel">${options(STREUMITTEL.map((x) => [x, x || '–']), 'Splitt')}</select></label>
      <label class="field wide"><span>Notiz</span><input type="text" id="wl-notiz" maxlength="500" placeholder="z. B. Eisplatte beim Eingang, nachstreuen"></label>
    </div><p class="note">Fotos gehen am Handy über den Link „Protokoll“ aus dem Schnee-Alarm.</p>`,
    foot: `<span></span><div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="winterlog-save">Speichern</button></div>`,
  })
}
registerModal('winterlog-add', addModal, { module: 'planung' })

function photosModal(c, m) {
  const e = logOf()[m.key]
  if (!e) return null
  return modalFrame({
    title: `Fotos: ${objOf(e.objectId)?.name || e.object}`,
    subtitle: `${formatDate(e.date)} ${timeOf(e.at)} · ${esc(e.person || '')} · ${esc(workText(e))}`,
    body: `<div class="wl-photos">${e.fotos.map((f) => `<figure><img data-wl-foto="${esc(f.datei)}" alt="Foto ${esc(f.datei)}"><figcaption>${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">in SharePoint öffnen</a>` : esc(f.datei)}</figcaption></figure>`).join('')}</div>
      ${editable() ? `<p><button class="btn small danger ${app.ui.confirm === `wl-del:${m.key}` ? 'confirm' : ''}" data-action="winterlog-delete" data-key="${esc(m.key)}">${app.ui.confirm === `wl-del:${m.key}` ? 'Eintrag wirklich löschen?' : 'Eintrag löschen'}</button></p>` : ''}`,
  })
}
registerModal('winterlog-fotos', photosModal, { module: 'planung' })

// Fotos nachladen, sobald der Dialog steht (vom Webspace oder aus SharePoint)
onModalRender(($modal) => {
  const m = app.ui.modal
  if (m?.type !== 'winterlog-fotos') return
  const e = logOf()[m.key]
  for (const img of $modal.querySelectorAll('img[data-wl-foto]')) {
    const f = e?.fotos.find((x) => x.datei === img.dataset.wlFoto)
    if (!f) continue
    photoBlob(f)
      .then((b) => (img.src = URL.createObjectURL(b)))
      .catch(() => img.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Foto nicht erreichbar (Webspace oder SharePoint).' })))
  }
})

// ---------------------------------------------------------------- Zu erledigen

registerTodo({
  id: 'winterprotokoll',
  module: 'planung',
  title: 'Winterdienst-Protokoll',
  compute: () => missingLogs({ winter: app.data.winter, log: logOf(), objects: app.data.objects, weatherRules: weatherRules() }).map((x) => ({ ...x, id: `${x.date}|${x.object.id}` })),
  render: (items) =>
    items
      .map((x) => `<div class="todo-item"><span class="flag warning">!</span><div class="todo-text"><strong>${esc(x.object.short || x.object.name)}</strong>: Winterdienst ${esc(formatDate(x.date))} ohne Protokoll<br><span class="muted">fertig bis ${esc(x.until)} Uhr; Nachweis für § 93 StVO</span></div><button class="btn small primary" data-action="winterlog-add" data-date="${esc(x.date)}" data-obj="${esc(x.object.id)}">Eintragen</button></div>`)
      .join(''),
})

// ---------------------------------------------------------------- Aktionen

registerActions({
  'winterlog-fotos': (el) => openModal({ type: 'winterlog-fotos', key: el.dataset.key }),
  'winterlog-sync': async () => {
    const n = await syncFromPhones({ force: true })
    if (!n && !sync.error) toast('Keine neuen Protokolle vom Handy.')
  },
  'winterlog-pdf': async (el) => {
    const month = document.getElementById('wl-month')?.value || todayISO().slice(0, 7)
    el.disabled = true
    try {
      const photos = new Map()
      for (const r of logRows(logOf(), { from: `${month}-01`, to: `${month}-31` })) {
        for (const f of r.fotos || []) {
          try {
            photos.set(f.datei, await photoDataUrl(f))
          } catch {
            /* fehlt im PDF, steht als Dateiname dabei */
          }
        }
      }
      const doc = winterLogDocument({ month, log: logOf(), objects: app.data.objects, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null), photos })
      const blob = await pdfBlob(doc)
      const name = winterLogPdfName(month)
      if (app.store.kind === 'sharepoint') {
        await app.store.upload(`exporte/Winterdienst/${month}/${name}`, blob, 'application/pdf')
        toast(`PDF-Nachweis in SharePoint: exporte/Winterdienst/${month}/${name}`)
      }
      if (app.config.features?.download !== false) download(name, blob)
    } catch (err) {
      toast(`PDF nicht erstellt: ${err.message || err}`)
    } finally {
      el.disabled = false
    }
  },
})

registerActions(
  {
    'winterlog-add': (el) => openModal({ type: 'winterlog-add', date: el.dataset.date, objectId: el.dataset.obj, emp: el.dataset.emp }),
    'winterlog-save': async () => {
      const date = val('wl-date')
      const objectId = val('wl-obj')
      const time = val('wl-time')
      const geraeumt = checked('wl-geraeumt')
      const gestreut = checked('wl-gestreut')
      const kontrolle = checked('wl-kontrolle')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !objectId) return toast('Bitte Tag und Objekt wählen.')
      if (!/^\d{2}:\d{2}$/.test(time)) return toast('Bitte die Uhrzeit eintragen.')
      if (!geraeumt && !gestreut && !kontrolle) return toast('Bitte ankreuzen: geräumt, gestreut oder nur kontrolliert.')
      await app.service.ensureWeeks([mondayOf(date)]).catch(() => {})
      const o = objOf(objectId)
      const e = {
        id: uid('a'),
        date,
        objectId,
        object: o?.name || '',
        address: o?.address || '',
        person: empName(val('wl-emp')),
        at: new Date(viennaTime(date, time)).toISOString(),
        geraeumt,
        gestreut,
        kontrolle: kontrolle && !geraeumt && !gestreut,
        mittel: gestreut ? val('wl-mittel') : '',
        notiz: val('wl-notiz').trim().slice(0, 500),
        fotos: [],
        lage: app.data.winter?.[`${date}|${objectId}`]?.reason || '',
        quelle: 'App',
        by: app.user?.name || 'Browser',
        entered: new Date().toISOString(),
      }
      recordUndo('Winterdienst-Protokoll')
      logOf()[logKey(e)] = e
      persist()
      closeModal()
      renderNow()
      toast(`Protokoll gespeichert: ${o?.short || o?.name || ''} ${formatDate(date)} ${time} Uhr.`)
    },
    'winterlog-delete': (el) => {
      const key = el.dataset.key
      if (!confirmStep(`wl-del:${key}`, renderModal)) return
      recordUndo('Protokoll gelöscht')
      delete logOf()[key]
      persist()
      closeModal()
      renderNow()
    },
  },
  { edit: 'planung' },
)
