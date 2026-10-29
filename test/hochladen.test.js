import { test } from 'node:test'
import assert from 'node:assert/strict'

import { hochladeReihenfolge, zugang } from '../scripts/hochladen.js'

const DIST = ['index.html', 'sw.js', 'config.json', '.htaccess', 'manifest.webmanifest', 'app/app-ABC.js', 'app/.htaccess', 'vendor/msal-browser.min.js', 'werkzeuge/.htaccess', 'werkzeuge/bruecke.js', 'werkzeuge/wasserzaehler/index.html']

test('Hochladen: neue Bündel zuerst, dann Brücke und Werkzeuge, ganz zuletzt sw.js und index.html', () => {
  const r = hochladeReihenfolge(DIST)
  assert.deepEqual(r.slice(-3), ['config.json', 'sw.js', 'index.html'])
  assert.ok(r.indexOf('app/app-ABC.js') < r.indexOf('werkzeuge/bruecke.js'))
  assert.ok(r.indexOf('werkzeuge/bruecke.js') < r.indexOf('werkzeuge/wasserzaehler/index.html'))
  assert.equal(r.length, DIST.length)
})

test('Hochladen: config.json am Server bleibt (Einrichtung), außer ausdrücklich ersetzen', () => {
  assert.ok(!hochladeReihenfolge(DIST, { configAmServer: true }).includes('config.json'))
  assert.ok(hochladeReihenfolge(DIST, { configAmServer: true, configErsetzen: true }).includes('config.json'))
  assert.ok(hochladeReihenfolge(DIST, { configAmServer: false }).includes('config.json'))
})

test('Hochladen: Zugang aus hochladen.json und Umgebung, verschlüsselt als Vorgabe', () => {
  const z = zugang({ host: 'ftp.example.at', benutzer: 'web1', ordner: '/app' }, {})
  assert.deepEqual(z, { host: 'ftp.example.at', benutzer: 'web1', ordner: '/app', sicher: true, port: 21 })
  assert.equal(zugang({ host: 'a', benutzer: 'b', sicher: false }, {}).sicher, false)
  assert.equal(zugang({ host: 'a', benutzer: 'b' }, { FTP_SICHER: '0', FTP_HOST: 'c' }).host, 'c')
  assert.throws(() => zugang({}, {}), /fehlt host und benutzer/)
  assert.throws(() => zugang({ host: 'a', benutzer: 'b\r\nDELE x' }, {}), /Zeilenumbruch/)
})
