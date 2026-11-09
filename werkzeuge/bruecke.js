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
 * Allein geöffnet (kein Rahmen der App) tut diese Datei nichts – außer beim Mattenwechsel nach der Umstellung auf
 * das Modul der App: Dann ist das Werkzeug „Mattenwechsel (alt)“ nur lesend (im Rahmen und im eigenen Fenster):
 * Lesen aus SharePoint geht, Schreiben (PUT, POST, PATCH, DELETE an Microsoft Graph) beantwortet die Brücke mit
 * „nur lesend“; im eigenen Fenster steht oben ein Hinweis (im Rahmen zeigt ihn die App).
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

  // Mattenwechsel (alt): nach der Umstellung auf das Modul nur lesend. Im Rahmen fragt die Brücke die App; im eigenen
  // Fenster (gleiche Adresse, eigene Anmeldung) gilt, was die App auf diesem Gerät zuletzt gesehen hat.
  var pfad = String((window.location && window.location.pathname) || '')
  var alterMattenwechsel = /\/werkzeuge\/mattenwechsel\//.test(pfad)
  var nurLesen = function () {
    if (!alterMattenwechsel) return false
    try {
      if (app) return !!(app.nurLesen && app.nurLesen(pfad))
      return !!window.localStorage.getItem('cleanos-app.matten-alt')
    } catch (e) {
      return false
    }
  }
  var GRAPH = /^https:\/\/graph\.microsoft\.com\//
  var schreibt = function (input, init) {
    var method = String((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase()
    var url = typeof input === 'string' ? input : (input && input.url) || ''
    return GRAPH.test(url) && method !== 'GET' && method !== 'HEAD'
  }
  var gesperrt = function () {
    return new Response(JSON.stringify({ error: { code: 'nurLesen', message: 'Mattenwechsel (alt) ist nur lesend: Der Mattenwechsel läuft jetzt im Modul der Cleanos App.' } }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }
  if (alterMattenwechsel) {
    var hinweis = function () {
      // im Rahmen zeigt die App den Hinweis über dem Werkzeug
      if (app || !nurLesen() || document.getElementById('cleanos-nur-lesen')) return
      var el = document.createElement('div')
      el.id = 'cleanos-nur-lesen'
      el.setAttribute('role', 'status')
      el.textContent = 'Mattenwechsel (alt): nur zum Nachschlagen. Neue Wechsel, Touren und Lieferscheine im Mattenwechsel-Modul der Cleanos App – Änderungen hier werden nicht gespeichert.'
      el.style.cssText = 'position:sticky;top:0;z-index:99999;background:#fff4d6;color:#4a3500;border-bottom:1px solid #c79a00;padding:8px 12px;font:14px/1.4 system-ui,sans-serif'
      document.body.insertBefore(el, document.body.firstChild)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hinweis)
    else hinweis()
  }
  if (!app) {
    if (alterMattenwechsel) {
      var eigenesFetch = window.fetch
      window.fetch = function (input, init) {
        if (schreibt(input, init) && nurLesen()) return Promise.resolve(gesperrt())
        return eigenesFetch.apply(this, arguments)
      }
    }
    return
  }
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

  // „Gerät sperren“ u. ä.: localStorage.clear() / sessionStorage.clear() löschte im Rahmen den Speicher der ganzen
  // App (gleicher Ursprung: Anmeldung, Einstellungen, die anderen Werkzeuge). Im Rahmen entfernt clear() nur die
  // eigenen Schlüssel des Werkzeugs (cleanos.<werkzeug>.…, gemerkt beim Lesen und Schreiben in diesem Fenster).
  var EIGEN = /^cleanos\.([a-z0-9]+)\./
  var eigene = {}
  var merke = function (key) {
    var m = EIGEN.exec(String(key))
    if (m) eigene[m[1]] = true
  }
  var sproto = window.Storage.prototype
  var sGet = sproto.getItem
  var sSet = sproto.setItem
  var sKey = sproto.key
  var sRemove = sproto.removeItem
  sproto.getItem = function (key) {
    merke(key)
    return sGet.apply(this, arguments)
  }
  sproto.setItem = function (key) {
    merke(key)
    return sSet.apply(this, arguments)
  }
  sproto.clear = function () {
    var weg = []
    for (var i = 0; i < this.length; i++) {
      var k = sKey.call(this, i)
      var m = EIGEN.exec(String(k))
      if (m && eigene[m[1]]) weg.push(k)
    }
    for (var j = 0; j < weg.length; j++) sRemove.call(this, weg[j])
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
    if (schreibt(input, init) && nurLesen()) return Promise.resolve(gesperrt())
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
