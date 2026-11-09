// Winterdienst-Protokoll am Handy (wetter-alarm.php?aktion=protokoll): Fotos vor dem
// Hochladen verkleinern (längste Seite 1600 px, JPEG), damit sie auch über langsames
// Netz und unter den Upload-Grenzen des Webspace ankommen. Ohne JavaScript oder bei
// einem Fehler wird das Formular ganz normal abgeschickt. Gilt für jedes Formular mit data-fotos-verkleinern (im
// Kundenbereich: Reklamation und Zusatzleistung anfragen, dort bis zu 3 Fotos in einem Feld).
;(() => {
  const forms = document.querySelectorAll('form[data-fotos-verkleinern]')
  if (!forms.length || !window.fetch || !window.FormData || !document.createElement('canvas').getContext) return
  const MAX = 1600

  const verkleinern = (datei) =>
    new Promise((fertig) => {
      if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(datei.type)) return fertig(datei)
      const url = URL.createObjectURL(datei)
      const bild = new Image()
      bild.onload = () => {
        const f = Math.min(1, MAX / Math.max(bild.naturalWidth, bild.naturalHeight))
        const c = document.createElement('canvas')
        c.width = Math.round(bild.naturalWidth * f)
        c.height = Math.round(bild.naturalHeight * f)
        c.getContext('2d').drawImage(bild, 0, 0, c.width, c.height)
        URL.revokeObjectURL(url)
        c.toBlob((blob) => fertig(blob ? new File([blob], datei.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : datei), 'image/jpeg', 0.8)
      }
      bild.onerror = () => {
        URL.revokeObjectURL(url)
        fertig(datei)
      }
      bild.src = url
    })

  for (const form of forms) form.addEventListener('submit', async (ev) => {
    const feld = form.querySelector('input[type=file]')
    if (!feld || !feld.files.length || form.dataset.laeuft) return
    ev.preventDefault()
    form.dataset.laeuft = '1'
    const knopf = form.querySelector('button[type=submit]')
    if (knopf) knopf.textContent = form.dataset.sendetext || 'Wird gespeichert …' // Aushang: in der Sprache der Seite
    try {
      const daten = new FormData(form)
      daten.delete(feld.name)
      for (const d of feld.files) daten.append(feld.name, await verkleinern(d))
      const antwort = await fetch(form.action || location.href, { method: 'POST', body: daten })
      const html = await antwort.text()
      document.open()
      document.write(html)
      document.close()
    } catch {
      delete form.dataset.laeuft
      form.submit()
    }
  })
})()
