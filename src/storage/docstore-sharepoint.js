// Ablage in einer SharePoint-Dokumentbibliothek über Microsoft Graph.
// Jede Datei hat einen eTag; beim Speichern wird If-Match gesendet, damit
// niemand unbemerkt die Änderungen einer anderen Person überschreibt.
// SharePoint führt automatisch einen Versionsverlauf je Datei.

import { ConflictError } from './docstore-local.js'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const encodePath = (path) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Freigabe-ID für /shares: „u!“ + Base64url der Adresse. */
const shareId = (url) => `u!${btoa(unescape(encodeURIComponent(url))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')}`

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
  constructor({ getToken, siteUrl, library = 'Dokumente', folder = 'Dienstplan-App', shareFolders = ['daten', 'zaehler', 'kontrolle', 'objektmappe', 'fahrzeuge'], fetchImpl = globalThis.fetch.bind(globalThis) }) {
    this.kind = 'sharepoint'
    this.getToken = getToken
    this.siteUrl = siteUrl
    this.library = library
    this.folder = folder.replace(/^\/|\/$/g, '')
    this.fetch = fetchImpl
    this.driveId = null
    this.label = 'SharePoint'
    this.knownFolders = new Set()
    this.pendingFolders = new Map() // gleichzeitige Speichervorgänge legen einen Ordner nur einmal an
    this.shareFolders = shareFolders
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
    const path = u.pathname.replace(/\/$/, '')
    try {
      // Website auf der Tenant-Wurzel: /sites/<host> ohne Doppelpunkt
      const site = await this.#json('GET', path ? `/sites/${u.hostname}:${path}` : `/sites/${u.hostname}`)
      const drives = await this.#json('GET', `/sites/${site.id}/drives?$select=id,name,webUrl`)
      // Bibliothek über den Anzeigenamen oder den letzten Teil der Adresse finden
      const urlName = (d) => decodeURIComponent((d.webUrl || '').split('/').pop() || '')
      const drive = drives.value.find((d) => d.name === this.library || urlName(d) === this.library) || drives.value.find((d) => ['Dokumente', 'Documents', 'Freigegebene Dokumente', 'Shared Documents'].includes(d.name))
      if (!drive) throw new Error(`Dokumentbibliothek „${this.library}“ nicht gefunden. Vorhanden: ${drives.value.map((d) => d.name).join(', ')}`)
      this.driveId = drive.id
      this.driveWebUrl = drive.webUrl
      this.label = `SharePoint · ${site.displayName || u.pathname} · ${drive.name}/${this.folder}`
      this.webUrl = `${drive.webUrl}/${encodePath(this.folder)}`
      return { site: site.displayName }
    } catch (err) {
      if (!(err instanceof GraphError) || ![403, 404].includes(err.status)) throw err
      return this.#initFromShare(err)
    }
  }

  /**
   * Nur Ordner freigegeben (kein Zugriff auf die Website, z. B. Ableser):
   * Laufwerk über die Freigabe-Adresse eines erreichbaren Ordners finden.
   */
  async #initFromShare(original) {
    const base = `${this.siteUrl.replace(/\/$/, '')}/${this.library}/${this.folder}`
    for (const sub of ['', ...this.shareFolders]) {
      try {
        const item = await this.#json('GET', `/shares/${shareId(sub ? `${base}/${sub}` : base)}/driveItem?$select=id,name,webUrl,parentReference`)
        this.driveId = item.parentReference.driveId
        this.driveWebUrl = `${this.siteUrl.replace(/\/$/, '')}/${this.library}`
        this.label = `SharePoint · ${this.library}/${this.folder}`
        this.webUrl = sub ? item.webUrl.replace(new RegExp(`/${encodeURIComponent(sub)}$`), '') : item.webUrl
        this.folderOnly = true
        return { site: null }
      } catch (err) {
        if (!(err instanceof GraphError) || ![403, 404].includes(err.status)) throw err
      }
    }
    throw original
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

  /** Datei löschen (landet im Papierkorb der Website); fehlt sie schon, ist das kein Fehler. */
  async remove(path) {
    await this.#request('DELETE', this.#itemUrl(path), { okStatuses: [404] })
  }

  /** Datei als Blob (z. B. Foto fürs PDF); null, wenn es sie nicht gibt. root: Pfad ab der Bibliothek statt ab dem App-Ordner. */
  async readBlob(path, { root = false } = {}) {
    const meta = root ? await this.#rootMeta(path) : await this.#meta(path)
    if (!meta) return null
    const res = await this.fetch(meta['@microsoft.graph.downloadUrl'])
    if (!res.ok) throw new GraphError(res.status, `Datei ${path} konnte nicht gelesen werden`)
    return res.blob()
  }

  async #rootMeta(path) {
    const res = await this.#request('GET', `/drives/${this.driveId}/root:/${encodePath(path)}`, { okStatuses: [403, 404] })
    return res.ok ? res.json() : null
  }

  /** JSON-Datei ab der Bibliothek lesen (z. B. Daten der bisherigen Werkzeuge); null, wenn nicht vorhanden oder gesperrt. */
  async readRoot(path) {
    const meta = await this.#rootMeta(path)
    if (!meta?.['@microsoft.graph.downloadUrl']) return null
    const res = await this.fetch(meta['@microsoft.graph.downloadUrl'])
    if (!res.ok) return null
    try {
      return JSON.parse((await res.text()).replace(/^\uFEFF/, ''))
    } catch {
      return null
    }
  }

  /**
   * Dateien eines Ordners (ab der Bibliothek) samt Unterordnern.
   * skip: Ordnernamen, die übersprungen werden (z. B. Fotos). Liefert [{ path, name, size, modified }].
   */
  async listTree(dir, { depth = 4, skip = ['Fotos'] } = {}) {
    const out = []
    const walk = async (path, level) => {
      let url = `/drives/${this.driveId}/root:/${encodePath(path)}:/children?$select=name,folder,file,size,lastModifiedDateTime&$top=999`
      while (url) {
        const res = await this.#request('GET', url, { okStatuses: [403, 404] })
        if (!res.ok) return
        const page = await res.json()
        for (const item of page.value || []) {
          const child = `${path}/${item.name}`
          if (item.folder) {
            if (level < depth && !skip.includes(item.name)) await walk(child, level + 1)
          } else out.push({ path: child, name: item.name, size: item.size, modified: item.lastModifiedDateTime })
        }
        url = page['@odata.nextLink'] || null
      }
    }
    await walk(dir.replace(/^\/|\/$/g, ''), 1)
    return out
  }

  /** Adresse einer Datei ab der Bibliothek zum Öffnen im Browser. */
  rootUrl(path) {
    return this.driveWebUrl ? `${this.driveWebUrl}/${encodePath(path)}` : null
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
      if (!this.pendingFolders.has(current)) this.pendingFolders.set(current, this.#createFolder(parent, part, current).finally(() => this.pendingFolders.delete(current)))
      await this.pendingFolders.get(current)
    }
  }

  async #createFolder(parent, part, current) {
    // erst nachsehen: ohne Recht an der Bibliothekswurzel liefert Anlegen 403 statt 409
    const exists = await this.#request('GET', `/drives/${this.driveId}/root:/${encodePath(current)}`, { okStatuses: [404] })
    if (exists.status === 404) {
      const url = parent ? `/drives/${this.driveId}/root:/${encodePath(parent)}:/children` : `/drives/${this.driveId}/root/children`
      await this.#request('POST', url, {
        body: JSON.stringify({ name: part, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
        headers: { 'Content-Type': 'application/json' },
        okStatuses: [409],
      })
    }
    this.knownFolders.add(current)
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
