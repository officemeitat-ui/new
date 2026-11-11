// Fotos und Dateien, die ohne Netz aufgenommen wurden: Die Ablage (storage/offline.js) stellt sie in die
// Warteschlange im Gerät und gibt { queued: true } zurück; das Modul merkt sich am Eintrag
// { path, name, …, queued: true } („wartet auf Netz“). Holt der Abgleich die Datei später nach, muss der
// Vermerk weg und die SharePoint-Adresse (url) dazu. Welches Modul die Datei hat, weiß hier niemand:
// gesucht wird nach dem Pfad in allen Daten (ui/context.js: uploadDone).

/**
 * Datei-Vermerke mit diesem Pfad in den Daten als hochgeladen vermerken: `queued` weg, `url` dazu.
 * Gesucht wird in allen Objekten und Listen (auch verschachtelt, z. B. Foto je Mangel in einem Raum);
 * getroffen ist, was `path` trägt und noch wartet (`queued`) oder noch keine `url` hat. Andere Dateien
 * und schon hochgeladene bleiben unverändert. Ändert die Daten an Ort und Stelle; liefert die Zahl der Treffer.
 */
export function markUploaded(data, path, url = null) {
  if (!path || !data || typeof data !== 'object') return 0
  let hits = 0
  const seen = new WeakSet()
  const walk = (x) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return
    seen.add(x)
    if (Array.isArray(x)) {
      for (const v of x) walk(v)
      return
    }
    if (x.path === path && (x.queued || !x.url)) {
      delete x.queued
      if (url) x.url = url
      hits++
    }
    for (const v of Object.values(x)) walk(v)
  }
  walk(data)
  return hits
}

/** Dateien, die noch auf das Hochladen warten ({ queued: true }), in den Daten: [{ path, … }]. */
export function queuedFiles(data) {
  const out = []
  const seen = new WeakSet()
  const walk = (x) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return
    seen.add(x)
    if (!Array.isArray(x) && x.queued && typeof x.path === 'string') out.push(x)
    for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v)
  }
  walk(data)
  return out
}
