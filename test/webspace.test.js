import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { htaccessFor } from '../scripts/htaccess.js'

const swa = JSON.parse(readFileSync(new URL('../staticwebapp.config.json', import.meta.url), 'utf8'))
const route = (r) => swa.routes.find((x) => x.route === r).headers

test('Webspace: .htaccess übernimmt die Sicherheitsregeln aus staticwebapp.config.json', () => {
  const files = htaccessFor(swa)
  assert.deepEqual(Object.keys(files), ['.htaccess', 'app/.htaccess', 'werkzeuge/.htaccess', 'privat/.htaccess'])
  const root = files['.htaccess']
  for (const [name, value] of Object.entries(swa.globalHeaders)) assert.ok(root.includes(`Header always set ${name} "${value}"`), `App: ${name}`)
  assert.match(root, /Options -Indexes/)
  assert.match(root, /<Files "config.json">\s+Header set Cache-Control "no-store"/)
  assert.match(root, /<FilesMatch "\^\(index\\\.html\|sw\\\.js\|manifest\\\.webmanifest\)\$">\s+Header set Cache-Control "no-cache"/)
  assert.match(root, /<Files "staticwebapp.config.json">[\s\S]*Require all denied/)
  // Ladezeit: komprimiert, nur wenn die Module da sind (sonst kein Fehler 500)
  assert.match(root, /<IfModule mod_deflate\.c>\s+<IfModule mod_filter\.c>\s+AddOutputFilterByType DEFLATE text\/html text\/css text\/javascript /)
  assert.match(files['app/.htaccess'], /Header set Cache-Control "public, max-age=31536000, immutable"/)

  // Werkzeuge: eigene CSP (dürfen im Rahmen der App laufen), Kamera für Fotos
  const tools = files['werkzeuge/.htaccess']
  assert.ok(tools.includes(`Header always set Content-Security-Policy "${route('/werkzeuge/*')['Content-Security-Policy']}"`))
  assert.match(tools, /frame-ancestors 'self'/)
  assert.match(tools, /Header always set Permissions-Policy "camera=\(self\)/)
  assert.match(tools, /Header set Cache-Control "no-cache"/)
  // gleiche Art („always“) wie im Hauptordner, sonst stünde die CSP doppelt
  assert.ok(!/Header set Content-Security-Policy/.test(root + tools))
  // Schnee-Alarm: Einstellungen und Stand gesperrt (Apache 2.4 und älter)
  assert.match(files['privat/.htaccess'], /<IfModule mod_authz_core\.c>\s+Require all denied\s+<\/IfModule>/)
  assert.match(files['privat/.htaccess'], /<IfModule !mod_authz_core\.c>\s+Order allow,deny\s+Deny from all/)
})

test('Webspace: jeder Header-Block ist abgesichert, ungültige Werte brechen ab', () => {
  for (const text of Object.values(htaccessFor(swa))) {
    const outside = text.replace(/<IfModule mod_headers\.c>[\s\S]*?<\/IfModule>/g, '')
    assert.ok(!/Header /.test(outside), 'Header nur innerhalb von <IfModule mod_headers.c>')
  }
  const bad = structuredClone(swa)
  bad.globalHeaders['X-Test'] = 'a"b'
  assert.throws(() => htaccessFor(bad), /Anführungszeichen/)
})
