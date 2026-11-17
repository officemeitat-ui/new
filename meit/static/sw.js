/* ME-IT Cockpit – Service Worker: macht das Cockpit installierbar und startet auch bei schlechtem Netz.
   Gespeichert wird NUR die Oberfläche. Antworten von /api/ (Kundendaten) werden nie zwischengespeichert. */
"use strict";
const CACHE = "meit-shell-__VERSION__";
const SHELL = ["/", "/static/app.js", "/static/style.css", "/brand/logo", "/brand/icon.png",
  "/brand/fonts/Roboto-Regular.woff2", "/brand/fonts/Roboto-Medium.woff2", "/brand/fonts/Roboto-Bold.woff2"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("meit-shell-") && k !== CACHE)
    .map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/portal") || url.pathname === "/sw.js") return;
  // Netz zuerst (immer aktuelle Version), bei Ausfall die gespeicherte Oberfläche
  event.respondWith(fetch(req).then((res) => {
    if (res.ok && (req.mode === "navigate" || SHELL.includes(url.pathname))) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "/" : req, copy));
    }
    return res;
  }).catch(() => caches.match(req.mode === "navigate" ? "/" : req).then((hit) => hit || Response.error())));
});
