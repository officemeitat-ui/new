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
  constructor({ getToken, siteUrl, library = 'Dokumente', folder = 'Dienstplan-App', shareFolders = ['objekte', 'daten', 'plaene', 'fahrzeuge', 'personal', 'lohn'], fetchImpl = globalThis.fetch.bind(globalThis) }) {
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
    return this.#download(path, meta)
  }

  async #download(path, meta) {
    const res = await this.fetch(meta['@microsoft.graph.downloadUrl'])
    if (!res.ok) throw new GraphError(res.status, `Datei ${path} konnte nicht gelesen werden`)
    return { data: await res.json(), etag: meta.eTag, modifiedBy: meta.lastModifiedBy?.user?.displayName || null, modifiedAt: meta.lastModifiedDateTime || null }
  }

  /**
   * Mehrere GET-Anfragen in einer: Graph $batch (je 20). Liefert Map id → { status, body }.
   * Einzelne gedrosselte Antworten (429/503) werden nach Retry-After nochmals gestellt.
   */
  async #batch(requests) {
    const out = new Map()
    const chunks = []
    for (let i = 0; i < requests.length; i += 20) chunks.push(requests.slice(i, i + 20))
    await Promise.all(
      chunks.map(async (chunk) => {
        let todo = chunk
        for (let attempt = 0; todo.length; attempt++) {
          const res = await this.#request('POST', '/$batch', { body: JSON.stringify({ requests: todo.map((r) => ({ id: r.id, method: 'GET', url: r.url })) }), headers: { 'Content-Type': 'application/json' } })
          const answers = (await res.json()).responses || []
          const again = []
          let wait = 0
          for (const a of answers) {
            if ((a.status === 429 || a.status === 503) && attempt < 3) {
              again.push(todo.find((t) => t.id === a.id))
              const h = a.headers || {}
              const after = h['Retry-After'] ?? h['retry-after']
              wait = Math.max(wait, after !== undefined && after !== '' && Number.isFinite(Number(after)) ? Number(after) : 2 ** attempt)
            } else out.set(a.id, a)
          }
          todo = again.filter(Boolean)
          if (todo.length) await sleep(wait * 1000)
        }
      }),
    )
    return out
  }

  /**
   * Viele Dateien auf einmal lesen: Metadaten gebündelt (eine Anfrage je 20 Dateien),
   * Inhalte parallel. Liefert Map Pfad → { doc } (null = gibt es nicht) oder { error } je Datei.
   */
  async readMany(paths) {
    const metas = await this.#batch(paths.map((path, i) => ({ id: String(i + 1), url: this.#itemUrl(path) })))
    const out = new Map()
    await Promise.all(
      paths.map(async (path, i) => {
        const a = metas.get(String(i + 1))
        try {
          if (!a) throw new GraphError(0, `Keine Antwort für ${path}`)
          if (a.status === 404) return out.set(path, { doc: null })
          if (a.status >= 400) throw new GraphError(a.status, a.body?.error?.message || `Graph-Fehler ${a.status}`, a.body)
          out.set(path, { doc: await this.#download(path, a.body) })
        } catch (error) {
          out.set(path, { error })
        }
      }),
    )
    return out
  }

  /** eTags vieler Dateien in einer Anfrage (je 20): Map Pfad → eTag, null (gibt es nicht) oder undefined (gerade nicht lesbar). */
  async etagsOf(paths) {
    const answers = await this.#batch(paths.map((path, i) => ({ id: String(i + 1), url: `${this.#itemUrl(path)}?$select=eTag` })))
    const out = new Map()
    paths.forEach((path, i) => {
      const a = answers.get(String(i + 1))
      out.set(path, a && a.status < 300 ? (a.body?.eTag ?? null) : a?.status === 404 ? null : undefined)
    })
    return out
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
   * skip: Ordnernamen, die übersprungen werden (z. B. Fotos). Liefert [{ path, name, size, modified, etag }].
   */
  async listTree(dir, { depth = 4, skip = ['Fotos'] } = {}) {
    const out = []
    const walk = async (path, level) => {
      let url = `/drives/${this.driveId}/root:/${encodePath(path)}:/children?$select=name,folder,file,size,lastModifiedDateTime,eTag&$top=999`
      while (url) {
        const res = await this.#request('GET', url, { okStatuses: [403, 404] })
        if (!res.ok) return
        const page = await res.json()
        for (const item of page.value || []) {
          const child = `${path}/${item.name}`
          if (item.folder) {
            if (level < depth && !skip.includes(item.name)) await walk(child, level + 1)
          } else out.push({ path: child, name: item.name, size: item.size, modified: item.lastModifiedDateTime, etag: item.eTag ?? null })
        }
        url = page['@odata.nextLink'] || null
      }
    }
    await walk(dir.replace(/^\/|\/$/g, ''), 1)
    return out
  }

  /** Dateien unter einem Unterordner des App-Ordners, Pfade wie bei read() (z. B. 'daten/plaene/2026/2026-01-05.json'). */
  async listDocs(prefix) {
    const base = this.folder.replace(/^\/|\/$/g, '')
    const files = await this.listTree(`${base}/${prefix}`, { depth: 3, skip: [] })
    return files.map((f) => f.path.slice(base.length + 1))
  }

  /**
   * Dateien direkt in einem Ordner des App-Ordners mit eTag, in einer Anfrage je 999 Dateien (z. B. die Touren eines
   * Jahres, matten/touren/2026): [{ path, etag, modified }]; Ordner fehlt → []. So liest die App nur Dateien, deren
   * eTag sich geändert hat.
   */
  async listFiles(prefix) {
    const dir = String(prefix).replace(/^\/|\/$/g, '')
    const out = []
    let url = `${this.#itemUrl(dir)}:/children?$select=name,file,eTag,lastModifiedDateTime&$top=999`
    while (url) {
      const res = await this.#request('GET', url, { okStatuses: [404] })
      if (res.status === 404) return []
      const page = await res.json()
      for (const item of page.value || []) if (item.file || (!item.folder && item.eTag)) out.push({ path: `${dir}/${item.name}`, etag: item.eTag ?? null, modified: item.lastModifiedDateTime || null })
      url = page['@odata.nextLink'] || null
    }
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
    return this.#ensurePath(`${this.folder}/${dir}`)
  }

  async #ensurePath(full) {
    const parts = full.split('/').filter(Boolean)
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

  // ------------------------------------------------ Freigaben (Rechte-Prüfung, core/rights-audit.js)
  // Pfade ab der Bibliothek (z. B. „Plattform/lohn“ oder „Objektdoku“). Nur Besitzer der Website sehen alle Freigaben.

  async #rootItem(path) {
    const res = await this.#request('GET', `/drives/${this.driveId}/root:/${encodePath(path)}?$select=id,name,webUrl`, { okStatuses: [404] })
    return res.status === 404 ? null : res.json()
  }

  /** Freigaben eines Ordners: { id, webUrl, perms: [Graph-Freigaben] } oder null, wenn es ihn nicht gibt. */
  async permissions(path) {
    const item = await this.#rootItem(path)
    if (!item) return null
    const perms = []
    let url = `/drives/${this.driveId}/items/${item.id}/permissions`
    while (url) {
      const page = await this.#json('GET', url)
      perms.push(...(page.value || []))
      url = page['@odata.nextLink'] || null
    }
    return { id: item.id, webUrl: item.webUrl, perms }
  }

  /**
   * Recht vergeben, ohne Einladungs-Mail: Gruppe über ihre Objekt-ID, Person über die E-Mail.
   * Beim ersten Mal endet damit die Vererbung; die bisherigen Rechte bleiben als eigene stehen
   * (retainInheritedPermissions bleibt bewusst beim Standard, sonst wären auch die Besitzer weg).
   */
  async grant(path, { kind, id }, right) {
    const item = await this.#rootItem(path)
    if (!item) throw new GraphError(404, `Ordner ${path} nicht gefunden`)
    const recipient = kind === 'group' ? { objectId: id } : { email: id }
    const body = { recipients: [recipient], roles: [right === 'Bearbeiten' ? 'write' : 'read'], requireSignIn: true, sendInvitation: false }
    return this.#json('POST', `/drives/${this.driveId}/items/${item.id}/invite`, { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
  }

  /** Freigabe entfernen (nur eigene, nicht geerbte Freigaben eines Ordners lassen sich entfernen). */
  async unshare(path, permId) {
    const item = await this.#rootItem(path)
    if (!item) return
    await this.#request('DELETE', `/drives/${this.driveId}/items/${item.id}/permissions/${encodeURIComponent(permId)}`, { okStatuses: [404] })
  }

  /** Unterordner und Dateien eines Ordners ab der Bibliothek: [{ name, folder, id }] oder null, wenn es ihn nicht gibt. */
  async children(path) {
    const out = []
    let url = `/drives/${this.driveId}/root:/${encodePath(path)}:/children?$select=id,name,folder,file&$top=999`
    while (url) {
      const res = await this.#request('GET', url, { okStatuses: [404] })
      if (res.status === 404) return null
      const page = await res.json()
      for (const it of page.value || []) out.push({ name: it.name, folder: !!it.folder, id: it.id })
      url = page['@odata.nextLink'] || null
    }
    return out
  }

  /**
   * Ordner oder Datei (Pfad ab der Bibliothek) in einen anderen Ordner verschieben; der Zielordner wird
   * angelegt. Kennungen, Fotos und Verlauf bleiben (Graph: parentReference ändern). Gibt es dort schon
   * etwas mit diesem Namen, kommt ein Fehler mit status 409 – nichts wird überschrieben.
   */
  async moveRoot(path, toParent) {
    const item = await this.#rootItem(path)
    if (!item) throw new GraphError(404, `${path} nicht gefunden`)
    await this.#ensurePath(toParent)
    const parent = await this.#rootItem(toParent)
    if (await this.#rootItem(`${toParent}/${item.name}`)) throw new GraphError(409, `${toParent}/${item.name} gibt es schon`)
    const res = await this.#request('PATCH', `/drives/${this.driveId}/items/${item.id}`, {
      body: JSON.stringify({ parentReference: { id: parent.id } }),
      headers: { 'Content-Type': 'application/json' },
      okStatuses: [409],
    })
    if (res.status === 409) throw new GraphError(409, `${toParent}/${item.name} gibt es schon`)
    return res.json()
  }

  /** JSON-Datei ab der Bibliothek schreiben (z. B. Objektliste eines Reviers der Objektkontrolle). */
  async writeRootJson(path, data) {
    await this.#ensurePath(path.split('/').slice(0, -1).join('/'))
    const res = await this.#request('PUT', `/drives/${this.driveId}/root:/${encodePath(path)}:/content`, { body: JSON.stringify(data, null, 1), headers: { 'Content-Type': 'application/json' } })
    return res.json()
  }

  /**
   * Datei ab der Bibliothek neu anlegen, ohne eine vorhandene zu ersetzen (z. B. Sicherung vor der Übernahme
   * des Mattenwechsels nach Mattenwechsel/_Sicherung/<Datum>/). Liefert { webUrl } oder null, wenn es sie schon gibt.
   */
  async writeRootNew(path, body, contentType = 'application/octet-stream') {
    await this.#ensurePath(path.split('/').slice(0, -1).join('/'))
    const res = await this.#request('PUT', `/drives/${this.driveId}/root:/${encodePath(path)}:/content?@microsoft.graph.conflictBehavior=fail`, { body, headers: { 'Content-Type': contentType }, okStatuses: [409] })
    if (res.status === 409) return null
    const item = await res.json()
    return { webUrl: item.webUrl || null }
  }

  /** Datei ab der Bibliothek: { itemId, webUrl, size } oder null, wenn es sie nicht gibt (z. B. vor einer Ablage prüfen). */
  async rootFile(path) {
    const res = await this.#request('GET', `/drives/${this.driveId}/root:/${encodePath(path)}?$select=id,webUrl,size,file`, { okStatuses: [404] })
    if (res.status === 404) return null
    const item = await res.json()
    return { itemId: item.id || '', webUrl: item.webUrl || '', size: item.size || 0 }
  }

  /**
   * Datei ab der Bibliothek ablegen, ohne eine vorhandene zu ersetzen (z. B. Lieferschein-PDF nach
   * Mattenwechsel/Kunden/…): gibt es sie schon, bleibt sie, wie sie ist (kein Doppel, kein Überschreiben).
   * Liefert { itemId, webUrl, existed }.
   */
  async uploadRoot(path, blob, contentType = 'application/octet-stream') {
    await this.#ensurePath(path.split('/').slice(0, -1).join('/'))
    const res = await this.#request('PUT', `/drives/${this.driveId}/root:/${encodePath(path)}:/content?@microsoft.graph.conflictBehavior=fail`, { body: blob, headers: { 'Content-Type': contentType }, okStatuses: [409] })
    if (res.status === 409) {
      const had = await this.rootFile(path)
      return { itemId: had?.itemId || '', webUrl: had?.webUrl || '', existed: true }
    }
    const item = await res.json()
    return { itemId: item.id || '', webUrl: item.webUrl || '', existed: false }
  }

  /** Ordner ab der Bibliothek anlegen, falls er fehlt (z. B. ein Modulordner vor dem ersten Speichern). */
  async ensureRootFolder(path) {
    await this.#ensurePath(path)
  }

  /** Datei (z. B. Excel-Wochenplan) hochladen, vorhandene Datei wird ersetzt. */
  async upload(path, blob, contentType = 'application/octet-stream') {
    const item = await this.#put(path, blob, contentType)
    return { webUrl: item.webUrl, downloaded: false }
  }
}
