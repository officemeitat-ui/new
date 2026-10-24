// Speichert Daten im Browser (localStorage). Für den Prototyp ausreichend;
// im Echtbetrieb gehört das in eine Datenbank mit Benutzerverwaltung.

const DATA_KEY = 'einsatzplaner.data.v1'
const PREFS_KEY = 'einsatzplaner.prefs.v1'

function read(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export const loadData = () => read(DATA_KEY)
export const saveData = (data) => write(DATA_KEY, data)
export const loadPrefs = () => read(PREFS_KEY) || {}
export const savePrefs = (prefs) => write(PREFS_KEY, prefs)
