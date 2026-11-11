import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createDevServer } from '../scripts/serve.js'

test('Webserver: Startseite, Werkzeugordner und Bibliotheken auch unter Windows', async (t) => {
  const server = createDevServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const get = (path) => new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port: server.address().port, path }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }))
    }).on('error', reject).end()
  })
  const home = await get('/')
  assert.equal(home.status, 200)
  assert.match(home.type, /text\/html/)
  assert.match(home.body, /src\/ui\/app.js/)
  for (const path of ['/werkzeuge/wasserzaehler/', '/werkzeuge/wasserzaehler/index.html']) {
    const tool = await get(path)
    assert.equal(tool.status, 200, path)
    assert.ok(tool.body.includes('<script src="../bruecke.js"></script>'), 'Anmeldebrücke eingesetzt')
  }
  assert.equal((await get('/vendor/jszip.min.js')).status, 200)
  assert.equal((await get('/nicht-vorhanden')).status, 404)
  for (const path of ['/%', '/%E0%A4%A', '/%00']) assert.equal((await get(path)).status, 400, path)
  for (const path of ['/%2e%2e%2fpackage.json', '/%2e%2e%5cpackage.json', '/%5c..%5cpackage.json']) {
    assert.equal((await get(path)).status, 403, path)
  }
  assert.equal((await get('/')).status, 200, 'Server antwortet nach ungültigen Anfragen weiterhin')
})

test('Webserver: Vorschau bleibt im gewählten Ausgabeordner', async (t) => {
  const server = createDevServer({ base: fileURLToPath(new URL('../assets', import.meta.url)) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/%2e%2e%2fpackage.json`)
  assert.equal(response.status, 403)
})
