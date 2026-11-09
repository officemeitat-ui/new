// Fahrerseite am Webspace (mattentour.php, Mattenwechsel P10b): Stopps ohne Neuladen umschalten (die ganze Tour steht
// auf der Seite, auch im Funkloch), Plus/Minus, Unterschrift mit dem Finger (Striche als Pfad „M12 30L14 31…“ im Feld
// 600 × 200, kein Bild), Fotos vor dem Senden verkleinern (längste Seite 1600 px, JPEG). Eingaben je Stopp merkt sich
// das Handy (localStorage), bis der Stopp gesendet ist; geht das Senden nicht (kein Netz), liegt die Meldung im
// Ausgang und wird nachgeschickt (beim Öffnen, wenn das Netz zurückkommt, alle 15 Sekunden, „Jetzt senden“). Jede
// Meldung hat eine eigene Kennung: der Webspace zählt sie nur einmal. Ohne JavaScript gehen die Formulare normal.
;(() => {
  const wurzel = document.querySelector('[data-mww-tour]')
  if (!wurzel || !window.fetch || !window.FormData) return
  const TOUR = wurzel.dataset.mwwTour
  let T = {}
  try {
    T = JSON.parse(wurzel.dataset.mwwTexte || '{}')
  } catch {
    T = {}
  }
  const AUSGANG = 'mww:ausgang'
  const ENTWURF = (stopp) => `mww:entwurf:${TOUR}:${stopp}`
  const FOTO_MAX = 8
  const ZEICHEN_MAX = 15000 // so viel nimmt mattentour.php als Unterschrift
  const speicher = {
    lesen(k, sonst) {
      try {
        const v = localStorage.getItem(k)
        return v ? JSON.parse(v) : sonst
      } catch {
        return sonst
      }
    },
    schreiben(k, v) {
      try {
        if (v === null) localStorage.removeItem(k)
        else localStorage.setItem(k, JSON.stringify(v))
        return true
      } catch {
        return false
      }
    },
  }
  const fuellen = (text, werte) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k in werte ? String(werte[k]) : m))
  const kennung = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')
  const codeFeld = wurzel.querySelector('input[name=p]')

  // ---------------------------------------------------------------- Stopps umschalten

  const teile = [...wurzel.querySelectorAll('[data-mww-teil]')]
  const zeige = (stopp, merken = true) => {
    for (const t of teile) t.classList.toggle('aktiv', t.dataset.mwwTeil === stopp)
    if (merken) {
      const url = new URL(location.href)
      url.searchParams.set('tour', TOUR)
      if (stopp) url.searchParams.set('stopp', stopp)
      else url.searchParams.delete('stopp')
      url.searchParams.delete('gesendet')
      history.pushState({ stopp }, '', url)
    }
    window.scrollTo(0, 0)
  }
  wurzel.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[data-mww-zu]')
    if (!a || ev.ctrlKey || ev.metaKey) return
    ev.preventDefault()
    zeige(a.dataset.mwwZu)
  })
  window.addEventListener('popstate', () => zeige(new URL(location.href).searchParams.get('stopp') || '', false))

  // ---------------------------------------------------------------- Plus/Minus

  for (const b of wurzel.querySelectorAll('[data-mww-schritt]')) {
    b.hidden = false
    b.addEventListener('click', () => {
      const feld = b.parentElement.querySelector('input[type=number]')
      feld.value = String(Math.max(0, Math.min(999, (Number(feld.value) || 0) + Number(b.dataset.mwwSchritt))))
      feld.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  // ---------------------------------------------------------------- Unterschrift

  const unterschriften = new Map() // Formular → { setzen(pfad) }
  for (const box of wurzel.querySelectorAll('[data-mww-unterschrift]')) {
    const canvas = box.querySelector('canvas')
    const feld = box.querySelector('input[name=unterschrift]')
    if (!canvas?.getContext || !window.PointerEvent) continue
    box.hidden = false
    box.closest('form').querySelector('[data-mww-ohne-skript]')?.setAttribute('hidden', '')
    const W = canvas.width
    const H = canvas.height
    const ctx = canvas.getContext('2d')
    const striche = []
    let strich = null
    const zeichnen = () => {
      ctx.clearRect(0, 0, W, H)
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#13232f'
      for (const s of striche) {
        ctx.beginPath()
        ctx.moveTo(s[0][0], s[0][1])
        for (const [x, y] of s.length > 1 ? s.slice(1) : [[s[0][0] + 0.5, s[0][1]]]) ctx.lineTo(x, y)
        ctx.stroke()
      }
    }
    const pfad = () => striche.map((s) => `M${s.map((p) => p.join(' ')).join('L')}${s.length === 1 ? `L${s[0].join(' ')}` : ''}`).join('')
    const punkt = (ev) => {
      const r = canvas.getBoundingClientRect()
      return [Math.max(0, Math.min(W, Math.round(((ev.clientX - r.left) / r.width) * W))), Math.max(0, Math.min(H, Math.round(((ev.clientY - r.top) / r.height) * H)))]
    }
    const fertig = () => {
      strich = null
      const p = pfad()
      feld.value = p.length <= ZEICHEN_MAX ? p : ''
      feld.dispatchEvent(new Event('input', { bubbles: true }))
    }
    canvas.addEventListener('pointerdown', (ev) => {
      if (pfad().length > ZEICHEN_MAX) return
      ev.preventDefault()
      try {
        canvas.setPointerCapture(ev.pointerId)
      } catch {
        // ohne Zeiger-Erfassung (z. B. sehr alte Browser) geht es trotzdem
      }
      strich = [punkt(ev)]
      striche.push(strich)
      zeichnen()
    })
    canvas.addEventListener('pointermove', (ev) => {
      if (!strich) return
      const p = punkt(ev)
      const [lx, ly] = strich[strich.length - 1]
      if (Math.abs(p[0] - lx) + Math.abs(p[1] - ly) < 3) return
      strich.push(p)
      zeichnen()
    })
    canvas.addEventListener('pointerup', fertig)
    canvas.addEventListener('pointercancel', fertig)
    box.querySelector('[data-mww-loeschen]').addEventListener('click', () => {
      striche.length = 0
      feld.value = ''
      zeichnen()
      feld.dispatchEvent(new Event('input', { bubbles: true }))
    })
    unterschriften.set(box.closest('form'), {
      setzen(p) {
        striche.length = 0
        for (const teil of String(p || '').split('M').filter(Boolean)) striche.push(teil.split('L').map((xy) => xy.trim().split(/\s+/).map(Number)))
        feld.value = String(p || '')
        zeichnen()
      },
    })
  }

  // ---------------------------------------------------------------- Entwürfe je Stopp, Fotos

  const formulare = [...wurzel.querySelectorAll('form[data-mww-stopp]')]
  const fotosImSpeicher = new Map() // Stopp → Fotos, die nicht ins Gerät passten (nur bis zum Neuladen)
  const felderVon = (form) => {
    const out = {}
    for (const el of form.elements) {
      if (!el.name || el.type === 'file' || (el.type === 'hidden' && !['unterschrift', 'meldung'].includes(el.name))) continue
      if (el.type === 'radio' || el.type === 'checkbox') {
        if (el.checked) out[el.name] = el.value
        else if (el.type === 'checkbox' && !(el.name in out)) out[el.name] = ''
      } else out[el.name] = el.value
    }
    return out
  }
  const entwurf = (stopp) => speicher.lesen(ENTWURF(stopp), null) || { felder: {}, fotos: [] }
  const fotosVon = (stopp) => [...(entwurf(stopp).fotos || []), ...(fotosImSpeicher.get(stopp) || [])]
  const merken = (form) => {
    const stopp = form.dataset.mwwStopp
    const e = entwurf(stopp)
    e.felder = felderVon(form)
    speicher.schreiben(ENTWURF(stopp), e)
  }
  const zeigeFotos = (form) => {
    const stopp = form.dataset.mwwStopp
    for (const box of form.querySelectorAll('[data-mww-fotos]')) {
      box.textContent = ''
      fotosVon(stopp)
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => f.lid === box.dataset.mwwFotos)
        .forEach(({ f, i }) => {
          const fig = document.createElement('figure')
          const img = document.createElement('img')
          img.src = f.data
          img.alt = f.name
          const weg = document.createElement('button')
          weg.type = 'button'
          weg.textContent = '×'
          weg.setAttribute('aria-label', T.foto_weg || 'Foto entfernen')
          weg.addEventListener('click', () => {
            const e = entwurf(stopp)
            const imGeraet = (e.fotos || []).length
            if (i < imGeraet) e.fotos.splice(i, 1)
            else fotosImSpeicher.get(stopp)?.splice(i - imGeraet, 1)
            speicher.schreiben(ENTWURF(stopp), e)
            zeigeFotos(form)
          })
          fig.append(img, weg)
          box.append(fig)
        })
    }
  }
  const verkleinern = (datei, max = 1600) =>
    new Promise((fertig) => {
      const url = URL.createObjectURL(datei)
      const bild = new Image()
      bild.onload = () => {
        const f = Math.min(1, max / Math.max(bild.naturalWidth, bild.naturalHeight))
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(bild.naturalWidth * f))
        c.height = Math.max(1, Math.round(bild.naturalHeight * f))
        const g = c.getContext('2d')
        g.fillStyle = '#fff'
        g.fillRect(0, 0, c.width, c.height)
        g.drawImage(bild, 0, 0, c.width, c.height)
        URL.revokeObjectURL(url)
        fertig(c.toDataURL('image/jpeg', 0.8))
      }
      bild.onerror = () => {
        URL.revokeObjectURL(url)
        fertig('')
      }
      bild.src = url
    })
  const meldeFehler = (form, text) => {
    const p = form.querySelector('[data-mww-fehler]')
    if (!p) return
    p.textContent = text || ''
    p.hidden = !text
    if (text) p.scrollIntoView({ block: 'center' })
  }

  for (const form of formulare) {
    const stopp = form.dataset.mwwStopp
    const e = speicher.lesen(ENTWURF(stopp), null)
    if (e?.felder) {
      for (const [name, wert] of Object.entries(e.felder)) {
        for (const el of form.querySelectorAll(`[name="${CSS.escape(name)}"]`)) {
          if (el.type === 'radio') el.checked = el.value === wert
          else if (el.type === 'checkbox') el.checked = !!wert
          else if (el.type !== 'file') el.value = wert
        }
      }
      if (e.felder.unterschrift) unterschriften.get(form)?.setzen(e.felder.unterschrift)
      if (e.felder.ausnahme) form.querySelector('details.mww-ausnahmen')?.setAttribute('open', '')
    }
    zeigeFotos(form)
    form.addEventListener('input', () => merken(form))
    form.addEventListener('change', async (ev) => {
      const feld = ev.target
      if (feld.type !== 'file' || !feld.dataset.mwwFoto) return merken(form)
      const dateien = [...feld.files]
      feld.value = ''
      for (const d of dateien) {
        if (fotosVon(stopp).length >= FOTO_MAX) {
          meldeFehler(form, T.foto_max)
          break
        }
        const data = await verkleinern(d)
        if (!data) continue
        const foto = { lid: feld.dataset.mwwFoto, name: `${String(d.name || 'foto').replace(/\.\w+$/, '')}.jpg`, data }
        const x = entwurf(stopp)
        x.felder = felderVon(form)
        x.fotos = [...(x.fotos || []), foto]
        if (!speicher.schreiben(ENTWURF(stopp), x)) {
          // Gerätespeicher voll: Foto nur bis zum Neuladen in dieser Seite
          fotosImSpeicher.set(stopp, [...(fotosImSpeicher.get(stopp) || []), foto])
          meldeFehler(form, T.foto_speicher)
        }
      }
      zeigeFotos(form)
    })
  }

  // ---------------------------------------------------------------- Senden und Ausgang

  const ausgang = () => speicher.lesen(AUSGANG, [])
  const blob = (dataUrl) => {
    const [kopf, b64] = String(dataUrl).split(',')
    const bin = atob(b64 || '')
    const buf = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
    return new Blob([buf], { type: (kopf.match(/data:([^;]+)/) || [])[1] || 'image/jpeg' })
  }
  const senden = async (m) => {
    const fd = new FormData()
    for (const [k, v] of m.felder) fd.append(k, v)
    for (const f of m.fotos || []) fd.append(`foto[${f.lid}][]`, blob(f.data), f.name)
    const res = await fetch(m.ziel || 'mattentour.php?aktion=meldung', { method: 'POST', body: fd, headers: { Accept: 'application/json' }, credentials: 'same-origin' })
    let json = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    return { status: res.status, json }
  }

  // Stopp im Gerät als erledigt zeigen (wartet auf Netz): Übersicht, Zähler, nächster Stopp
  const lokalFertig = () => new Set(ausgang().filter((m) => m.tour === TOUR && m.art === 'abschluss').map((m) => m.stopp))
  const offeneStopps = () => [...wurzel.querySelectorAll('[data-mww-stopp-li]')].filter((li) => !li.classList.contains('fertig')).map((li) => li.dataset.mwwStoppLi)
  const naechsterNach = (stopp) => {
    const alle = [...wurzel.querySelectorAll('[data-mww-stopp-li]')].map((li) => li.dataset.mwwStoppLi)
    const offen = new Set(offeneStopps())
    const i = alle.indexOf(stopp)
    return [...alle.slice(i + 1), ...alle.slice(0, Math.max(0, i + 1))].find((s) => s !== stopp && offen.has(s)) || ''
  }
  const pill = (text) => `<span class="pill warn">${text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])}</span>`
  const alsFertigZeigen = (stopp) => {
    const li = wurzel.querySelector(`[data-mww-stopp-li="${CSS.escape(stopp)}"]`)
    if (li && !li.classList.contains('fertig')) {
      li.classList.add('fertig')
      li.classList.remove('naechster')
      const p = li.querySelector('[data-mww-pill]')
      if (p) p.innerHTML = pill(T.wartet || '')
    }
    const form = wurzel.querySelector(`form[data-mww-stopp="${CSS.escape(stopp)}"]`)
    const teil = wurzel.querySelector(`[data-mww-teil="${CSS.escape(stopp)}"]`)
    if (form && teil) {
      const box = document.createElement('div')
      box.className = 'mww-fertig'
      box.innerHTML = `<h3>${pill(T.wartet || '')}</h3><p></p>`
      box.querySelector('p').textContent = T.gesendet || ''
      teil.querySelector('a[data-mww-unterwegs]')?.remove()
      form.replaceWith(box)
      const n = naechsterNach(stopp)
      const weiter = document.createElement('a')
      weiter.className = 'knopf'
      weiter.dataset.mwwZu = n
      weiter.href = `?tour=${encodeURIComponent(TOUR)}${n ? `&stopp=${encodeURIComponent(n)}` : ''}`
      weiter.textContent = n ? fuellen(T.naechster, { name: wurzel.querySelector(`[data-mww-stopp-li="${CSS.escape(n)}"] b`)?.textContent || '' }) : T.uebersicht || ''
      box.after(weiter)
    }
    zaehlen()
  }
  const zaehlen = () => {
    const alle = wurzel.querySelectorAll('[data-mww-stopp-li]').length
    const offen = offeneStopps()
    const fertig = alle - offen.length
    const setze = (k, v) => {
      const el = wurzel.querySelector(`[data-mww-zahl="${k}"]`)
      if (el) el.textContent = String(v)
    }
    setze('fertig', fertig)
    setze('offen', offen.length)
    const balken = wurzel.querySelector('[data-mww-balken]')
    if (balken) balken.style.width = `${alle ? Math.round((fertig / alle) * 100) : 0}%`
    // „Nächster Stopp“ und „Navigation starten“ in der Übersicht auf den nächsten offenen
    const knopf = wurzel.querySelector('[data-mww-naechster]')
    const naechster = offen[0] || ''
    for (const li of wurzel.querySelectorAll('[data-mww-stopp-li]')) li.classList.toggle('naechster', li.dataset.mwwStoppLi === naechster)
    if (knopf) {
      knopf.hidden = !naechster
      if (naechster) {
        knopf.dataset.mwwZu = naechster
        knopf.href = `?tour=${encodeURIComponent(TOUR)}&stopp=${encodeURIComponent(naechster)}`
        knopf.textContent = fuellen(T.naechster, { name: wurzel.querySelector(`[data-mww-stopp-li="${CSS.escape(naechster)}"] b`)?.textContent || '' })
        const navi = wurzel.querySelector('[data-mww-knoepfe] a[data-mww-unterwegs]')
        const ziel = wurzel.querySelector(`[data-mww-teil="${CSS.escape(naechster)}"] a[data-mww-unterwegs]`)
        if (navi && ziel) {
          navi.href = ziel.href
          navi.dataset.mwwUnterwegs = naechster
        }
      } else wurzel.querySelector('[data-mww-knoepfe] a[data-mww-unterwegs]')?.remove()
    }
  }

  const banner = wurzel.querySelector('[data-mww-ausgang]')
  let fehlerText = ''
  const zeigeAusgang = () => {
    const n = ausgang().length
    if (!banner) return
    banner.hidden = !n && !fehlerText
    banner.textContent = ''
    if (fehlerText) {
      const p = document.createElement('p')
      p.textContent = fehlerText
      banner.append(p)
    }
    if (!n) return
    const p = document.createElement('p')
    p.textContent = n === 1 ? T.ausgang || '' : fuellen(T.ausgang_n, { n })
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'klein'
    b.textContent = T.senden || ''
    b.addEventListener('click', () => nachsenden())
    banner.append(p, b)
  }

  let laeuft = false
  const nachsenden = async () => {
    if (laeuft) return
    laeuft = true
    try {
      for (const m of ausgang()) {
        let r
        try {
          r = await senden(m)
        } catch {
          break // noch kein Netz: später
        }
        if (r.status >= 500) break
        if (r.status !== 200 && r.status !== 409) fehlerText = `${T.nicht_gesendet || ''} ${r.json?.fehler || ''}`.trim()
        speicher.schreiben(AUSGANG, ausgang().filter((x) => x.id !== m.id))
      }
    } finally {
      laeuft = false
      zeigeAusgang()
    }
  }

  const einreihen = (m) => {
    const liste = ausgang().filter((x) => x.id !== m.id)
    if (!speicher.schreiben(AUSGANG, [...liste, m])) {
      // ohne Fotos versuchen (Speicher voll): der Abschluss soll nicht verloren gehen
      speicher.schreiben(AUSGANG, [...liste, { ...m, fotos: [] }])
    }
    zeigeAusgang()
  }

  // Formulare (Tour starten, Stopp abschließen): mit Skript senden, ohne Netz in den Ausgang
  for (const form of wurzel.querySelectorAll('form[data-mww-meldung]')) {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault()
      if (form.dataset.laeuft) return
      const stopp = form.dataset.mwwStopp || ''
      const art = form.querySelector('input[name=art]').value
      const e = stopp ? entwurf(stopp) : null
      const id = e?.felder?.meldung || form.querySelector('input[name=meldung]').value
      form.querySelector('input[name=meldung]').value = id
      form.querySelector('input[name=zeit]').value = String(Date.now())
      const felder = []
      for (const [k, v] of new FormData(form)) if (typeof v === 'string') felder.push([k, v])
      const m = { id, tour: TOUR, stopp, art, felder, fotos: stopp ? fotosVon(stopp) : [], ziel: form.getAttribute('action') }
      form.dataset.laeuft = '1'
      const knopf = form.querySelector('button[type=submit]')
      const vorher = knopf?.textContent
      if (knopf) knopf.textContent = T.gesendet_kurz || '…'
      meldeFehler(form, '')
      let r = null
      try {
        r = await senden(m)
      } catch {
        r = null
      }
      delete form.dataset.laeuft
      if (knopf) knopf.textContent = vorher
      if (r && (r.status === 200 || r.status === 409)) {
        if (stopp) speicher.schreiben(ENTWURF(stopp), null)
        location.assign(r.json?.weiter || `?tour=${encodeURIComponent(TOUR)}${stopp ? `&stopp=${encodeURIComponent(stopp)}` : ''}`)
        return
      }
      if (r && r.status < 500) {
        meldeFehler(form, r.json?.fehler || T.nicht_gesendet)
        return
      }
      // kein Netz (oder der Webspace antwortet nicht): im Gerät behalten und nachsenden
      einreihen(m)
      if (art === 'start') {
        form.remove()
        const p = wurzel.querySelector('[data-mww-tourstatus]')
        if (p) p.innerHTML = pill(T.wartet || '')
        return
      }
      speicher.schreiben(ENTWURF(stopp), null)
      const n = naechsterNach(stopp)
      alsFertigZeigen(stopp)
      zeige(n)
    })
  }

  // „Navigation starten“: Stopp ist unterwegs (Meldung nebenbei, ohne Netz im Ausgang)
  wurzel.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[data-mww-unterwegs]')
    if (!a || !codeFeld) return
    const id = kennung()
    const m = { id, tour: TOUR, stopp: a.dataset.mwwUnterwegs, art: 'unterwegs', felder: [['p', codeFeld.value], ['art', 'unterwegs'], ['tour', TOUR], ['stopp', a.dataset.mwwUnterwegs], ['meldung', id], ['zeit', String(Date.now())]], fotos: [] }
    senden(m).catch(() => einreihen(m))
  })

  for (const s of lokalFertig()) alsFertigZeigen(s)
  zeigeAusgang()
  if (ausgang().length) nachsenden()
  window.addEventListener('online', () => nachsenden())
  setInterval(() => {
    if (ausgang().length) nachsenden()
  }, 15000)
})()
