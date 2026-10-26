// Installierbare App (PWA): Manifest und Service Worker für dist/.
// Der Service Worker hält die gebündelten Dateien vor (schneller Start, auch
// bei schlechtem Netz). Daten kommen weiterhin live aus SharePoint.

/** Web-App-Manifest aus config.json (brand). */
export function manifestFor(config) {
  const b = config.brand || {}
  const icons = (b.appIcons || []).map((src) => {
    const size = src.match(/(\d{2,4})(?=\.png$)/)?.[1]
    return { src, sizes: size ? `${size}x${size}` : 'any', type: 'image/png', purpose: 'any' }
  })
  const largest = icons.at(-1)
  if (largest) icons.push({ ...largest, purpose: 'maskable' })
  return {
    name: b.app || `${b.name || 'Einsatzplaner'} ${b.product || 'Dienstplan'}`.trim(),
    // Name unter dem Symbol am Startbildschirm: kurz halten
    short_name: b.app && b.app.length <= 12 ? b.app : b.product || 'Dienstplan',
    description: b.tagline || 'Einsatzplanung',
    lang: 'de-AT',
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: b.colors?.primary || '#1d4ea6',
    icons,
  }
}

/** Quelltext des Service Workers. `precache`: Dateien mit Hash (bleiben gültig, bis sich der Inhalt ändert). */
export function serviceWorkerSource({ version, precache }) {
  return `// Service Worker des Dienstplans (erzeugt mit npm run build, Version ${version})
const CACHE = 'dienstplan-${version}'
const PRECACHE = ${JSON.stringify(precache)}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dienstplan-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok && response.type === 'basic') cache.put(fallbackUrl || request, response.clone())
    return response
  } catch (err) {
    const cached = await cache.match(fallbackUrl || request)
    if (cached) return cached
    throw err
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok && response.type === 'basic') (await caches.open(CACHE)).put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/.auth/')) return
  // Seite und Konfiguration: immer zuerst aus dem Netz (Anmeldung, aktuelle Einstellungen)
  if (request.mode === 'navigate') return event.respondWith(networkFirst(request, './index.html'))
  if (url.pathname.endsWith('/config.json')) return event.respondWith(networkFirst(request))
  // Gebündelte Dateien, Bibliotheken, Logo, Schriften: aus dem Speicher
  if (/\\/(app|vendor|assets|themes)\\//.test(url.pathname)) return event.respondWith(cacheFirst(request))
})
`
}
