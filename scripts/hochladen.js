// Lädt dist/ per FTP auf den Webspace (z. B. World4You, app.cleanos.at).
//
// Aufruf:  npm run hochladen                  baut und lädt hoch
//          node scripts/hochladen.js --probe  nur anmelden und den Ordner zeigen
//
// Zugang: hochladen.json im Projektordner (liegt nicht im Repository):
//   { "host": "ftp.example.at", "benutzer": "…", "ordner": "/app", "sicher": true }
// oder Umgebungsvariablen FTP_HOST, FTP_BENUTZER, FTP_ORDNER, FTP_SICHER=0.
// Das Passwort kommt aus FTP_PASSWORT oder wird abgefragt; gespeichert wird es nie.
//
// - Verschlüsselt (FTPS) als Vorgabe. Kann der Server das nicht, bricht das
//   Hochladen mit Erklärung ab, statt das Passwort offen zu schicken
//   ("sicher": false nur, wenn der Anbieter wirklich kein FTPS kann).
// - Reihenfolge: zuerst alles mit Hash im Namen und die Werkzeuge, ganz
//   zuletzt sw.js und index.html. Wer während des Hochladens öffnet, bekommt
//   die alte oder die neue App, nie eine halbe.
// - config.json am Server bleibt, wenn es sie schon gibt: Dort steht die
//   Anwendungs-ID aus der Einrichtung. Mit --config wird sie ersetzt.
// - Nur Betrieb: Ein Bau mit Beispieldaten (Browser-Modus) wird nicht
//   hochgeladen, außer mit --demo.
// - --aufraeumen: alte Bündel in app/ löschen, die der neue Bau nicht braucht.

import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, posix, relative, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const dist = join(root, 'dist')

/** Reihenfolge des Hochladens: neue Bündel und Bibliotheken, Anmeldebrücke, Werkzeuge, übrige Dateien, config.json (je nach Lage), sw.js, index.html. */
export function hochladeReihenfolge(dateien, { configAmServer = false, configErsetzen = false } = {}) {
  const rang = (d) =>
    /^(app|vendor|assets|themes)\//.test(d) ? 0 : d === 'werkzeuge/bruecke.js' ? 1 : d.startsWith('werkzeuge/') ? 2 : d === 'config.json' ? 4 : d === 'sw.js' ? 5 : d === 'index.html' ? 6 : 3
  return dateien
    .filter((d) => d !== 'config.json' || !configAmServer || configErsetzen)
    .sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
}

/** Zugangsdaten aus hochladen.json und Umgebung (Umgebung gewinnt). */
export function zugang(datei = {}, env = process.env) {
  const z = {
    host: env.FTP_HOST || datei.host || '',
    benutzer: env.FTP_BENUTZER || datei.benutzer || '',
    ordner: env.FTP_ORDNER || datei.ordner || '/',
    sicher: env.FTP_SICHER ? env.FTP_SICHER !== '0' : datei.sicher !== false,
    port: Number(env.FTP_PORT || datei.port || 21),
  }
  const fehlt = ['host', 'benutzer'].filter((k) => !z[k])
  if (fehlt.length) throw new Error(`Für das Hochladen fehlt ${fehlt.join(' und ')}: in hochladen.json eintragen (Vorlage in docs/EINRICHTUNG.md, Schritt 4) oder FTP_HOST / FTP_BENUTZER setzen.`)
  if (/[\r\n]/.test(z.host + z.benutzer + z.ordner)) throw new Error('Zugangsdaten mit Zeilenumbruch sind ungültig.')
  return z
}

async function dateienIn(dir, basis = dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await dateienIn(p, basis)))
    else if (e.isFile()) out.push(relative(basis, p).split(sep).join('/'))
  }
  return out
}

function frage(text, verdeckt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (verdeckt) rl._writeToOutput = (s) => rl.output.write(s.includes(text) ? s : '')
    rl.question(text, (antwort) => {
      rl.close()
      if (verdeckt) process.stdout.write('\n')
      resolve(antwort)
    })
  })
}

async function main(args) {
  const { Client } = await import('basic-ftp')
  const datei = existsSync(join(root, 'hochladen.json')) ? JSON.parse(readFileSync(join(root, 'hochladen.json'), 'utf8')) : {}
  const z = zugang(datei)
  const probe = args.includes('--probe')

  if (!probe) {
    if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ fehlt: zuerst npm run build (npm run hochladen baut selbst).')
    const config = JSON.parse(readFileSync(join(dist, 'config.json'), 'utf8'))
    if (config.storage !== 'sharepoint' && !args.includes('--demo'))
      throw new Error('dist/ ist ein Bau für den Browser-Modus (Beispieldaten), nicht für den Betrieb. Fehlt config.production.json? Siehe docs/EINRICHTUNG.md, Schritt 3. (Absichtlich so hochladen: --demo)')
  }

  const passwort = process.env.FTP_PASSWORT || (await frage(`FTP-Passwort für ${z.benutzer}@${z.host}: `, true))
  const client = new Client(30000)
  try {
    try {
      await client.access({ host: z.host, port: z.port, user: z.benutzer, password: passwort, secure: z.sicher })
    } catch (err) {
      if (z.sicher && /TLS|SSL|AUTH|534|530 Please login with USER and PASS|not understood/i.test(String(err.message)))
        throw new Error(`Verschlüsselte Verbindung (FTPS) nicht möglich: ${err.message}. Unterstützt der Anbieter FTPS? Erst dort nachsehen; nur wenn nicht: "sicher": false in hochladen.json.`)
      throw err
    }
    await client.ensureDir(z.ordner)
    const basis = await client.pwd()
    const amServer = new Set((await client.list()).map((f) => f.name))

    if (probe) {
      console.log(`Verbunden mit ${z.host}${z.sicher ? ' (verschlüsselt)' : ' (UNVERSCHLÜSSELT)'}, Ordner ${basis}: ${[...amServer].sort().join(', ') || '(leer)'}`)
      return
    }

    const dateien = await dateienIn(dist)
    const configAmServer = amServer.has('config.json')
    const reihe = hochladeReihenfolge(dateien, { configAmServer, configErsetzen: args.includes('--config') })
    let ordner = ''
    for (const [i, d] of reihe.entries()) {
      const dir = posix.dirname(d) === '.' ? '' : posix.dirname(d)
      if (dir !== ordner) {
        await client.cd(basis)
        if (dir) await client.ensureDir(dir) // wechselt hinein
        ordner = dir
      }
      await client.uploadFrom(join(dist, ...d.split('/')), posix.basename(d))
      process.stdout.write(`\r${i + 1}/${reihe.length} ${d}`.padEnd(70).slice(0, 90))
    }
    process.stdout.write('\n')

    let geloescht = 0
    if (args.includes('--aufraeumen')) {
      await client.cd(basis)
      const neu = new Set(dateien.filter((d) => d.startsWith('app/')).map((d) => d.slice(4)))
      if (neu.size) {
        await client.cd('app')
        for (const f of await client.list()) if (f.isFile && !neu.has(f.name) && f.name !== '.htaccess') { await client.remove(f.name); geloescht++ }
      }
    }

    const config = JSON.parse(readFileSync(join(dist, 'config.json'), 'utf8'))
    console.log(`Hochgeladen: ${reihe.length} Dateien nach ${z.host}${basis}${geloescht ? `, ${geloescht} alte Bündel gelöscht` : ''}.`)
    if (configAmServer && !args.includes('--config')) console.log('config.json am Server blieb unverändert (dort steht die Einrichtung). Ersetzen: --config')
    else if (!config.sharepoint?.clientId) console.log('Hinweis: In config.json fehlt noch die Anwendungs-ID. Die App zeigt dann die Einrichtungsschritte (docs/EINRICHTUNG.md, Schritt 4).')
  } finally {
    client.close()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main(process.argv.slice(2)).catch((err) => {
    console.error(`Hochladen fehlgeschlagen: ${err.message}`)
    process.exitCode = 1
  })
