// Minimaler Webserver ohne Abhängigkeiten: `npm start`, dann http://localhost:8080
// Liefert den Quellcode direkt aus; vendor/ kommt aus node_modules.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VENDOR } from './vendor.js'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const base = process.argv[2] ? join(root, process.argv[2]) : root
const port = Number(process.env.PORT) || 8080
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  const rel = path === '/' ? 'index.html' : path.slice(1)
  const file = VENDOR[rel] && base === root ? join(root, VENDOR[rel]) : join(base, rel)
  if (!file.startsWith(root)) {
    res.writeHead(403).end()
    return
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body)
  } catch {
    res.writeHead(404).end('Nicht gefunden')
  }
}).listen(port, () => console.log(`Dienstplan läuft auf http://localhost:${port}`))
