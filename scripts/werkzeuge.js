// Die Werkzeuge (werkzeuge/<name>/index.html) kommen unverändert in die App.
// Beim Bau (und im Entwicklungs-Server) wird werkzeuge/bruecke.js als
// erstes Skript eingesetzt: Läuft ein Werkzeug in der Cleanos App, nutzt es
// deren Anmeldung (siehe dort). Außerdem bekommt die Kopie die Farben der App
// (Cleanos-Design nach www.cleanos.at) statt der leicht abweichenden Töne.
//
// Neue Fassung eines Werkzeugs: die index.html aus dem Webspace-Paket nach
// werkzeuge/<name>/ kopieren, fertig. Passt das Anmeldeverfahren nicht mehr
// zur Brücke, bricht der Bau mit einer Meldung ab, statt ein Werkzeug
// auszuliefern, das in der App stumm bleibt.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** name = Ordner unter werkzeuge/ (die Ansichten dazu: src/ui/views/tools.js) */
export const WERKZEUGE = [
  { name: 'wasserzaehler', label: 'Wasserzähler-Ablesung' },
  { name: 'objektkontrolle', label: 'Objektkontrolle' },
  { name: 'objektdoku', label: 'Objektdoku' },
  { name: 'mattenwechsel', label: 'Mattenwechsel' },
]

const SCRIPT = '<script src="../bruecke.js"></script>'

/** Prüft ein Werkzeug und setzt die Brücke ein. Wirft mit Erklärung, wenn es nicht passt. */
export function mitBruecke(html, name) {
  const fehler = []
  // Kopf des Dokuments (spätere „<head>“ stehen in Vorlagen für Bericht/PDF)
  const head = html.match(/^\s*(<!doctype[^>]*>\s*)?<html[^>]*>\s*<head[^>]*>/i)
  if (!head) fehler.push('Datei beginnt nicht mit <!DOCTYPE html><html><head>')
  if (!/\/oauth2\/v2\.0\/token/.test(html)) fehler.push('kein Token-Abruf bei Microsoft (oauth2/v2.0/token) gefunden')
  if (!/refresh_token/.test(html)) fehler.push('keine gemerkte Anmeldung (refresh_token) gefunden')
  if (!/["']cleanos\.[a-z0-9]+\.graph\.tok["']/.test(html)) fehler.push('Speicherschlüssel cleanos.<werkzeug>.graph.tok fehlt')
  const csp = html.match(/<meta[^>]+Content-Security-Policy[^>]+content="([^"]*)"/i)?.[1]
  if (csp && !/script-src[^;]*'self'/.test(csp)) fehler.push("die eigene CSP erlaubt kein Skript von 'self'")
  if (html.includes(SCRIPT)) fehler.push('Brücke ist schon eingesetzt (Datei aus dist/ statt aus dem Webspace-Paket?)')
  if (fehler.length) throw new Error(`Werkzeug „${name}“ passt nicht zur Brücke der App: ${fehler.join('; ')}. Siehe werkzeuge/LIESMICH.md.`)
  // vor jedem Skript des Werkzeugs: gleich nach <meta charset> (muss vorn stehen), sonst direkt nach <head>
  const at = head[0].length
  const charset = html.slice(at).match(/^\s*<meta charset=[^>]*>/i)
  const pos = at + (charset ? charset[0].length : 0)
  return `${html.slice(0, pos)}\n${SCRIPT}${html.slice(pos)}`
}

// Farben der Werkzeuge → Farben der App (themes/cleanos.css). Gilt für alles in der
// Datei: Oberfläche, Bericht und PDF verwenden dieselben Werte.
export const APP_FARBEN = {
  '#0f70b7': '#0c6cb4', // Blau → Cleanos-Blau
  '#0b5a94': '#0a5a96', // Blau dunkel
  '#a1c855': '#9cc654', // Grün → Cleanos-Grün
  '#6d9227': '#4e7a1e', // Grün dunkel (auf Weiß gut lesbar)
  '#f1f7e3': '#eef6e2', // Hellgrün
  '#2b2b2b': '#13232f', // Text
  '#595959': '#4b5b67', // Text leise
}
const FARBE = new RegExp(`#(${Object.keys(APP_FARBEN).map((f) => f.slice(1)).join('|')})(?![0-9a-f])`, 'gi')

/** Farben eines Werkzeugs auf die der App umstellen. */
export const inAppFarben = (html) => html.replace(FARBE, (f) => APP_FARBEN[f.toLowerCase()])

/** Werkzeug für die App: Brücke einsetzen, Farben der App. */
export const fuerApp = (html, name) => inAppFarben(mitBruecke(html, name))

/** Kopiert alle Werkzeuge mit Brücke nach dist/werkzeuge/. Liefert die Pfade. */
export async function werkzeugeBauen(root, dist) {
  const out = []
  await mkdir(join(dist, 'werkzeuge'), { recursive: true })
  await writeFile(join(dist, 'werkzeuge', 'bruecke.js'), await readFile(join(root, 'werkzeuge', 'bruecke.js')))
  for (const { name } of WERKZEUGE) {
    const html = await readFile(join(root, 'werkzeuge', name, 'index.html'), 'utf8')
    await mkdir(join(dist, 'werkzeuge', name), { recursive: true })
    await writeFile(join(dist, 'werkzeuge', name, 'index.html'), fuerApp(html, name))
    out.push(`werkzeuge/${name}/index.html`)
  }
  return out
}
