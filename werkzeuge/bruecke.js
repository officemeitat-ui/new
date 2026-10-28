/*
 * Brücke zwischen der Cleanos App und den Werkzeugen (Wasserzähler-Ablesung,
 * Objektkontrolle, Objektdoku, Mattenwechsel).
 *
 * Der Bau der App (scripts/werkzeuge.js) setzt diese Datei als erstes Skript
 * in jedes Werkzeug ein. Die Werkzeug-Dateien selbst bleiben unverändert.
 *
 * Läuft ein Werkzeug in der App (eingebettet, gleiche Adresse), holt es sich
 * die Anmeldung dort statt selbst bei Microsoft: Die Werkzeuge merken sich
 * ihre Anmeldung als „refresh“ unter cleanos.<werkzeug>.graph.tok und tauschen
 * ihn beim Token-Endpunkt von Microsoft gegen ein Zugriffstoken. Genau diese
 * zwei Stellen beantwortet hier die App:
 *   - localStorage cleanos.*.graph.tok  → gilt als angemeldet (Marke „cleanos-app“)
 *   - POST …/oauth2/v2.0/token mit dieser Marke → Token von der App (MSAL)
 * Alles andere (SharePoint, Fotos, PDF, offline) macht das Werkzeug wie immer.
 *
 * Allein geöffnet (kein Rahmen der App) tut diese Datei nichts.
 */
;(function () {
  'use strict'
  var app = null
  try {
    if (window.parent !== window && window.parent.werkzeugBruecke && window.parent.werkzeugBruecke.bruecke === 1) app = window.parent.werkzeugBruecke
  } catch (e) {
    app = null // anderer Ursprung: kein Zugriff, Werkzeug läuft für sich
  }
  window.CLEANOS_APP = app
  if (!app) return
  document.documentElement.classList.add('in-cleanos-app')

  // Anmeldung zur Microsoft-Seite geht im Rahmen nicht (Microsoft verbietet das Einbetten): die App übernimmt
  try {
    if (window.navigation && window.navigation.addEventListener)
      window.navigation.addEventListener('navigate', function (event) {
        var url = (event.destination && event.destination.url) || ''
        if (/^https:\/\/login\.microsoftonline\.com\//.test(url) && event.cancelable) {
          event.preventDefault()
          app.anmelden()
        }
      })
  } catch (e) {
    /* ältere Browser: der Knopf „Anmelden“ führt dann ins Leere, die App meldet sich selbst */
  }

  if (!app.angemeldet) return // Browser-Modus ohne Microsoft: Werkzeug arbeitet nur am Gerät

  var MARKE = 'cleanos-app'
  var TOKEN_KEY = /^cleanos\.[a-z0-9]+\.graph\.tok$/
  var proto = window.Storage.prototype
  var getItem = proto.getItem
  var setItem = proto.setItem
  var removeItem = proto.removeItem
  var isTokenKey = function (store, key) {
    return store === window.localStorage && TOKEN_KEY.test(String(key))
  }
  proto.getItem = function (key) {
    if (isTokenKey(this, key)) return JSON.stringify({ refresh: MARKE })
    return getItem.apply(this, arguments)
  }
  // eigene Anmeldung des Werkzeugs nicht speichern oder löschen: sie gehört der App
  proto.setItem = function (key) {
    if (isTokenKey(this, key)) return
    return setItem.apply(this, arguments)
  }
  proto.removeItem = function (key) {
    if (isTokenKey(this, key)) return
    return removeItem.apply(this, arguments)
  }

  var TOKEN_URL = /^https:\/\/login\.microsoftonline\.com\/[^/]+\/oauth2\/v2\.0\/token(\?|$)/
  var originalFetch = window.fetch
  var json = function (status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } })
  }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || ''
    if (TOKEN_URL.test(url) && init && init.body) {
      var body = new URLSearchParams(String(init.body))
      if (body.get('refresh_token') === MARKE) {
        return app.token(body.get('scope') || '').then(
          function (t) {
            return json(200, { token_type: 'Bearer', scope: t.scope, expires_in: t.expiresIn, ext_expires_in: t.expiresIn, access_token: t.accessToken, refresh_token: MARKE })
          },
          function (err) {
            // wie „kein Netz“: das Werkzeug arbeitet am Gerät weiter und vergisst die Anmeldung nicht;
            // die App zeigt, was fehlt (z. B. neu anmelden)
            throw new TypeError('Anmeldung über die Cleanos App gerade nicht möglich: ' + ((err && err.message) || err))
          },
        )
      }
    }
    return originalFetch.apply(this, arguments)
  }
})()
