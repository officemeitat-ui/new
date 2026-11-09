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
// Die Werkzeuge in eigenem Speicher: Er bleibt bei App-Updates erhalten, damit
// ein Werkzeug auch dann ohne Netz startet (Keller), wenn die App neu ist.
const WERKZEUGE = 'werkzeuge-1'

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

// Werkzeug: zuerst aus dem Netz (immer die neue Fassung), ohne Netz die zuletzt geholte
async function werkzeugHolen(request) {
  const cache = await caches.open(WERKZEUGE)
  try {
    const response = await fetch(request)
    if (response.ok && response.type === 'basic') cache.put(request, response.clone())
    return response
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true })
    if (cached) return cached
    throw err
  }
}

// Die App meldet nach dem Start die Werkzeuge der eigenen Rolle: Was noch nicht
// im Speicher liegt, wird jetzt geholt – nicht erst beim ersten Öffnen, das im
// Keller ohne Netz passieren kann. Vorhandenes erneuert werkzeugHolen beim Öffnen.
async function werkzeugeVorhalten(urls) {
  const cache = await caches.open(WERKZEUGE)
  for (const url of urls) {
    const request = new Request(new URL(url, self.registration.scope).href)
    if (await cache.match(request)) continue
    try {
      const response = await fetch(request)
      if (response.ok && response.type === 'basic') await cache.put(request, response)
    } catch (err) {
      // kein Netz: beim nächsten Start
    }
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'werkzeuge-vorhalten' && Array.isArray(event.data.urls)) event.waitUntil(werkzeugeVorhalten(event.data.urls))
})

// Die App-Seite selbst: der Ordner des Service Workers (start_url './') oder index.html darin.
// Nur diese Navigationen landen als index.html im Speicher. Andere Seiten am selben
// Webspace (mein-plan.php, kunden.php, wetter-alarm.php, wetter.php …) gehen am
// Service Worker vorbei: Sonst läge ihr HTML als index.html im Speicher und erschiene
// ohne Netz statt der App.
function istAppSeite(url) {
  const ordner = new URL(self.registration.scope).pathname
  return url.pathname === ordner || url.pathname === ordner + 'index.html'
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
  // Werkzeuge (eigene Seiten im Rahmen der App): zuerst aus dem Netz, ohne Netz die zuletzt geladene Fassung
  if (url.pathname.includes('/werkzeuge/')) return event.respondWith(werkzeugHolen(request))
  // Seite und Konfiguration: immer zuerst aus dem Netz (Anmeldung, aktuelle Einstellungen).
  // Andere Seiten (*.php am Webspace, Abmelden …) nicht abfangen: Der Browser lädt sie selbst.
  if (request.mode === 'navigate') {
    if (istAppSeite(url)) event.respondWith(networkFirst(request, './index.html'))
    return
  }
  if (url.pathname.endsWith('/config.json')) return event.respondWith(networkFirst(request))
  // Gebündelte Dateien, Bibliotheken, Logo, Schriften: aus dem Speicher
  if (/\\/(app|vendor|assets|themes)\\//.test(url.pathname)) return event.respondWith(cacheFirst(request))
})
`
}
