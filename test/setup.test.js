import { test } from 'node:test'
import assert from 'node:assert/strict'

import { configMitAnwendungsId, setupHtml } from '../src/ui/setup.js'

test('Einrichtung: config.json bekommt die Anwendungs-ID, sonst bleibt alles wie am Server', () => {
  const server = JSON.stringify({ brand: { app: 'Cleanos App' }, storage: 'sharepoint', sharepoint: { tenantId: 'a31131f2-4ccf-4eb2-ab3d-49c923c6bede', clientId: '', siteUrl: 'https://cleanconcept1.sharepoint.com' }, access: { planners: ['office@cleanos.at'] } })
  const neu = JSON.parse(configMitAnwendungsId(server, ' 0B1C2D3E-1234-4ABC-9DEF-0123456789AB '))
  assert.equal(neu.sharepoint.clientId, '0B1C2D3E-1234-4ABC-9DEF-0123456789AB')
  assert.equal(neu.sharepoint.siteUrl, 'https://cleanconcept1.sharepoint.com')
  assert.deepEqual(neu.access, { planners: ['office@cleanos.at'] })
  assert.throws(() => configMitAnwendungsId(server, 'cleanos-app'), /keine Anwendungs-ID/)
  assert.throws(() => configMitAnwendungsId(server, ''), /keine Anwendungs-ID/)
})

test('Einrichtung: Seite nennt die Umleitungsadresse dieser App und maskiert Werte', () => {
  const html = setupHtml({ brand: { app: 'Cleanos <App>' }, sharepoint: { tenantId: 'a31131f2-4ccf-4eb2-ab3d-49c923c6bede' } }, 'https://app.cleanos.at/')
  assert.match(html, /<code class="setup-value">https:\/\/app\.cleanos\.at\/<\/code>/)
  assert.match(html, /a31131f2-4ccf-4eb2-ab3d-49c923c6bede/)
  assert.match(html, /Cleanos &lt;App&gt;/)
  assert.match(html, /data-action="setup-config"/)
})
