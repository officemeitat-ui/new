// Lädt eine Bibliothek (UMD) erst, wenn sie gebraucht wird.
const loaded = new Map()

export function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const el = document.createElement('script')
        el.src = src
        el.onload = resolve
        el.onerror = () => {
          loaded.delete(src)
          reject(new Error(`${src} konnte nicht geladen werden`))
        }
        document.head.append(el)
      }),
    )
  }
  return loaded.get(src)
}
