// Service Worker des Arbeitsplatzes: macht die App installierbar und zeigt ohne Netz eine verständliche Seite.
// Bewusst kein Zwischenspeichern von Daten – Kunden-, Ticket- und Aufgabendaten bleiben nur auf dem Server.

const OFFLINE_HTML = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title><style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:22rem;padding:2rem;text-align:center}button{margin-top:1rem;background:#4f46e5;color:#fff;border:0;border-radius:.75rem;padding:.75rem 1.25rem;font-size:1rem}</style></head>
<body><main><h1>Keine Verbindung</h1><p>Der Arbeitsplatz braucht Internet. Sobald du wieder online bist, geht es weiter.</p>
<button onclick="location.reload()">Erneut versuchen</button></main></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  event.respondWith(fetch(request).catch(() => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
