// Laufzeit-Konfiguration aus config.json (liegt neben index.html und kann
// ohne neuen Build geändert werden). Fehlende Werte kommen aus DEFAULT_CONFIG.

export const DEFAULT_CONFIG = {
  brand: {
    name: 'Einsatzplaner',
    product: 'Dienstplan',
    tagline: 'Gebäudereinigung',
    logo: '',
    theme: '',
  },
  storage: 'local', // 'local' | 'sharepoint'
  sharepoint: {
    tenantId: '',
    clientId: '',
    siteUrl: '',
    library: 'Dokumente',
    folder: 'Dienstplan-App',
    refreshSeconds: 60,
  },
  access: {
    // E-Mail-Adressen mit Bearbeitungsrecht. Leer = alle angemeldeten Personen dürfen planen.
    planners: [],
  },
  mail: {
    from: '', // optional: freigegebenes Postfach für den Versand, z. B. dienstplan@firma.at
  },
  demo: true, // im Browser-Modus mit Beispieldaten starten
  migrateLegacy: true, // Daten des ersten Prototyps (einsatzplaner.data.v1) übernehmen
}

function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra ?? base
  const out = { ...base }
  for (const [k, v] of Object.entries(extra)) out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? deepMerge(base[k], v) : v
  return out
}

export async function loadConfig(url = 'config.json') {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return DEFAULT_CONFIG
    return deepMerge(DEFAULT_CONFIG, await res.json())
  } catch {
    return DEFAULT_CONFIG
  }
}

export function applyBrand(brand) {
  if (brand.theme) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `themes/${brand.theme}.css`
    document.head.append(link)
    document.documentElement.dataset.brand = brand.theme
  }
  document.title = `${brand.product} · ${brand.name}`
}
