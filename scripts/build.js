// Erstellt dist/ zum Hochladen auf den Webserver (z. B. dienstplan.cleanos.at).
// Aufruf: npm run build
import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VENDOR } from './vendor.js'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const dist = join(root, 'dist')

await rm(dist, { recursive: true, force: true })
await mkdir(join(dist, 'vendor'), { recursive: true })
for (const item of ['index.html', 'config.json', 'staticwebapp.config.json', 'src', 'themes', 'assets']) {
  await cp(join(root, item), join(dist, item), { recursive: true }).catch((err) => {
    if (err.code !== 'ENOENT') throw err
  })
}
for (const [target, source] of Object.entries(VENDOR)) await cp(join(root, source), join(dist, target))
console.log('dist/ erstellt. Inhalt auf den Webserver laden; config.json vorher anpassen.')
