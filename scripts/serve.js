// Minimaler Webserver ohne Abhängigkeiten: `npm start`, dann http://localhost:8080
// Liefert den Quellcode direkt aus; vendor/ kommt aus node_modules.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VENDOR } from './vendor.js'
import { fuerApp } from './werkzeuge.js'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' }

export function createDevServer({ base = root } = {}) {
  let sdkBundle = null
  return createServer(async (req, res) => {
    let path
    try {
      // URL-Pfade verwenden auch unter Windows Schrägstriche. Fehlerhafte
      // Prozentzeichen dürfen den Server nicht durch eine abgelehnte Promise beenden.
      path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replaceAll('\\', '/')
      if (path.includes('\0')) throw new Error('Ungültiger Pfad')
    } catch {
      res.writeHead(400).end('Ungültiger Pfad')
      return
    }
    if (path.split('/').includes('..')) {
      res.writeHead(403).end()
      return
    }
    const rel = path === '/' ? 'index.html' : path.endsWith('/') ? `${path.slice(1)}index.html` : path.slice(1)
    const file = VENDOR[rel] && base === root ? resolve(root, VENDOR[rel]) : resolve(base, rel)
    const within = relative(base, file)
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
      res.writeHead(403).end()
      return
    }
    try {
      // npm-Pakete im Browser (KI-Assistent: Anthropic-SDK): diese eine Datei bei Bedarf bündeln
      if (base === root && rel === 'src/ai/sdk.js') {
        sdkBundle ||= import('esbuild').then((esbuild) => esbuild.build({ entryPoints: [file], bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'error' })).then((r) => r.outputFiles[0].contents)
        res.writeHead(200, { 'content-type': types['.js'], 'cache-control': 'no-store' }).end(Buffer.from(await sdkBundle))
        return
      }
      let body = await readFile(file)
      // Werkzeuge aus dem Quellordner: Anmeldebrücke wie beim Bau einsetzen
      const tool = base === root && rel.match(/^werkzeuge\/([a-z0-9-]+)\/index\.html$/)
      if (tool) body = fuerApp(body.toString('utf8'), tool[1])
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body)
    } catch {
      res.writeHead(404).end('Nicht gefunden')
    }
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2] ? resolve(root, process.argv[2]) : root
  const port = Number(process.env.PORT) || 8080
  createDevServer({ base }).listen(port, () => console.log(`Dienstplan läuft auf http://localhost:${port}`))
}
