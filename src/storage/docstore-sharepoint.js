// Ablage in einer SharePoint-Dokumentbibliothek über Microsoft Graph.
// Jede Datei hat einen eTag; beim Speichern wird If-Match gesendet, damit
// niemand unbemerkt die Änderungen einer anderen Person überschreibt.
// SharePoint führt automatisch einen Versionsverlauf je Datei.

import { ConflictError } from './docstore-local.js'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const encodePath = (path) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class GraphError extends Error {
  constructor(status, message, body) {
    super(message)
    this.name = 'GraphError'
    this.status = status
    this.body = body
  }
}

export class SharePointDocStore {
  /**
   * @param {object} opts
   * @param {() => Promise<string>} opts.getToken  liefert ein Access Token für Graph
   * @param {string} opts.siteUrl   z. B. https://firma.sharepoint.com/sites/Dienstplan
   * @param {string} opts.library   Name der Dokumentbibliothek, z. B. "Dokumente"
   * @param {string} opts.folder    Ordner in der Bibliothek, z. B. "Dienstplan-App"
   */
  constructor({ getToken, siteUrl, library = 'Dokumente', folder = 'Dienstplan-App', fetchImpl = globalThis.fetch.bind(globalThis) }) {
    this.kind = 'sharepoint'
    this.getToken = getToken
    this.siteUrl = siteUrl
    this.library = library
    this.folder = folder.replace(/^\/|\/$/g, '')
    this.fetch = fetchImpl
    this.driveId = null
    this.label = 'SharePoint'
    this.knownFolders = new Set()
  }

  async #request(method, url, { body, headers = {}, okStatuses = [] } = {}) {
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken()
      const res = await this.fetch(url.startsWith('http') ? url : GRAPH + url, { method, body, headers: { Authorization: `Bearer ${token}`, ...headers } })
      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        await sleep((Number(res.headers.get('Retry-After')) || 2 ** attempt) * 1000)
        continue
      }
      if (res.ok || okStatuses.includes(res.status)) return res
      let detail = null
      try {
        detail = await res.json()
      } catch {
        /* kein JSON */
      }
      throw new GraphError(res.status, detail?.error?.message || `Graph-Fehler ${res.status}`, detail)
    }
  }

  async #json(method, url, opts) {
    const res = await this.#request(method, url, opts)
    return res.status === 204 ? null : res.json()
  }

  async init() {
    const u = new URL(this.siteUrl)
    const site = await this.#json('GET', `/sites/${u.hostname}:${u.pathname.replace(/\/$/, '') || '/'}`)
    const drives = await this.#json('GET', `/sites/${site.id}/drives?$select=id,name,webUrl`)
    const drive = drives.value.find((d) => d.name === this.library) || drives.value.find((d) => ['Dokumente', 'Documents', 'Freigegebene Dokumente', 'Shared Documents'].includes(d.name))
    if (!drive) throw new Error(`Dokumentbibliothek „${this.library}“ nicht gefunden. Vorhanden: ${drives.value.map((d) => d.name).join(', ')}`)
    this.driveId = drive.id
    this.label = `SharePoint · ${site.displayName || u.pathname} · ${drive.name}/${this.folder}`
    this.webUrl = `${drive.webUrl}/${encodePath(this.folder)}`
    return { site: site.displayName }
  }

  #itemUrl(path) {
    return `/drives/${this.driveId}/root:/${encodePath(`${this.folder}/${path}`)}`
  }

  async #meta(path) {
    const res = await this.#request('GET', this.#itemUrl(path), { okStatuses: [404] })
    return res.status === 404 ? null : res.json()
  }

  async read(path) {
    const meta = await this.#meta(path)
    if (!meta) return null
    const res = await this.fetch(meta['@microsoft.graph.downloadUrl'])
    if (!res.ok) throw new GraphError(res.status, `Datei ${path} konnte nicht gelesen werden`)
    return { data: await res.json(), etag: meta.eTag, modifiedBy: meta.lastModifiedBy?.user?.displayName || null, modifiedAt: meta.lastModifiedDateTime || null }
  }

  async etagOf(path) {
    return (await this.#meta(path))?.eTag ?? null
  }

  async #ensureFolder(dir) {
    const parts = `${this.folder}/${dir}`.split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      const parent = current
      current = current ? `${current}/${part}` : part
      if (this.knownFolders.has(current)) continue
      const url = parent ? `/drives/${this.driveId}/root:/${encodePath(parent)}:/children` : `/drives/${this.driveId}/root/children`
      await this.#request('POST', url, {
        body: JSON.stringify({ name: part, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
        headers: { 'Content-Type': 'application/json' },
        okStatuses: [409],
      })
      this.knownFolders.add(current)
    }
  }

  async #put(path, body, contentType, headers = {}, query = '') {
    const url = `${this.#itemUrl(path)}:/content${query}`
    const opts = { body, headers: { 'Content-Type': contentType, ...headers }, okStatuses: [404, 409, 412] }
    let res = await this.#request('PUT', url, opts)
    if (res.status === 404) {
      await this.#ensureFolder(path.split('/').slice(0, -1).join('/'))
      res = await this.#request('PUT', url, opts)
    }
    if (res.status === 409 || res.status === 412) throw new ConflictError(path)
    if (res.status === 404) throw new GraphError(404, `Ordner für ${path} nicht gefunden`)
    return res.json()
  }

  async write(path, data, etag) {
    const body = JSON.stringify(data, null, 1)
    const item = etag
      ? await this.#put(path, body, 'application/json', { 'If-Match': etag })
      : await this.#put(path, body, 'application/json', {}, '?@microsoft.graph.conflictBehavior=fail')
    return item.eTag
  }

  /** Datei (z. B. Excel-Wochenplan) hochladen, vorhandene Datei wird ersetzt. */
  async upload(path, blob, contentType = 'application/octet-stream') {
    const item = await this.#put(path, blob, contentType)
    return { webUrl: item.webUrl, downloaded: false }
  }
}
