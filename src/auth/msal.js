// Anmeldung mit dem Microsoft-365-Konto (Entra ID) über MSAL.js.
// Die App bekommt nur ein delegiertes Token: sie darf in SharePoint genau
// das, was die angemeldete Person auch selbst darf.

import { loadScript } from '../ui/load-script.js'

export const GRAPH_SCOPES = ['User.Read', 'Sites.ReadWrite.All']

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Nur interne Konten: das Konto muss aus dem eigenen Tenant stammen. Gäste
 * (B2B, Heimat-Tenant woanders) und fremde Konten werden abgewiesen, außer
 * allowGuests ist gesetzt. Liefert einen Text, wenn die Anmeldung nicht passt.
 */
export function accountProblem(account, tenantId, { allowGuests = false } = {}) {
  if (!account || !GUID.test(tenantId || '')) return ''
  const tid = String(account.tenantId || account.idTokenClaims?.tid || '').toLowerCase()
  const home = String(account.homeAccountId || '').split('.')[1]?.toLowerCase() || tid
  const own = String(tenantId).toLowerCase()
  if (tid && tid !== own) return 'Dieses Konto gehört nicht zur Firma. Bitte mit dem Firmenkonto anmelden.'
  const claims = account.idTokenClaims || {}
  // Gäste erkennt man an fremdem Heimat-Mandanten, am Anspruch idp (anderer Identitätsanbieter) oder acct = 1 (optional im Token)
  const guest = (home && home !== own) || !!claims.idp || Number(claims.acct) === 1
  if (!allowGuests && guest) return 'Gastkonten sind gesperrt. Bitte mit dem eigenen Firmenkonto anmelden.'
  return ''
}

/** Microsoft-Gruppen aus dem Token (Objekt-IDs). Bei sehr vielen Gruppen fehlt die Liste („overage“). */
export function groupsOf(account) {
  const claims = account?.idTokenClaims || {}
  return { groups: Array.isArray(claims.groups) ? claims.groups : [], overage: !!claims._claim_names?.groups || !!claims.hasgroups }
}

/**
 * Gruppen der angemeldeten Person über Microsoft Graph (/me/transitiveMemberOf, Recht User.Read):
 * für den Fall, dass das Token keine Gruppen enthält (Token-Konfiguration ohne „groups“) oder zu viele
 * („overage“). Auch verschachtelte Gruppen zählen. Ohne Netz der zuletzt gelesene Stand (höchstens 14 Tage).
 * → { groups: [IDs], from: 'graph' | 'gemerkt' } oder null
 */
export async function memberGroups(getToken, { userId = '', fetchImpl = globalThis.fetch.bind(globalThis), storage = globalThis.localStorage, now = Date.now() } = {}) {
  const key = `cleanos-gruppen:${userId}`
  try {
    const ids = []
    let url = 'https://graph.microsoft.com/v1.0/me/transitiveMemberOf'
    for (let page = 0; url && page < 20; page++) {
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${await getToken()}` } })
      if (!res.ok) throw new Error(`Graph ${res.status}`)
      const body = await res.json()
      for (const o of body.value || []) if (o.id && (!o['@odata.type'] || o['@odata.type'] === '#microsoft.graph.group')) ids.push(String(o.id).toLowerCase())
      url = body['@odata.nextLink'] || null
    }
    try {
      storage?.setItem(key, JSON.stringify({ ids, at: now }))
    } catch {
      /* privater Modus */
    }
    return { groups: ids, from: 'graph' }
  } catch {
    try {
      const saved = JSON.parse(storage?.getItem(key) || 'null')
      if (saved && Array.isArray(saved.ids) && now - saved.at < 14 * 864e5) return { groups: saved.ids, from: 'gemerkt' }
    } catch {
      /* nichts gemerkt */
    }
    return null
  }
}

/**
 * Graph-Berechtigungen je nach Konfiguration (E-Mail-Versand, Kalender und Posteingang optional). Posteingang: nur
 * lesen, eigenes Postfach Mail.Read, Sammelpostfach (config.posteingang.mailbox) Mail.Read.Shared.
 */
export function scopesFor(config = {}) {
  const scopes = [...GRAPH_SCOPES]
  if (config.features?.mail) scopes.push(config.mail?.from ? 'Mail.Send.Shared' : 'Mail.Send')
  if (config.features?.calendar) scopes.push('Calendars.ReadWrite')
  if (config.features?.posteingang) scopes.push(String(config.posteingang?.mailbox || '').trim() ? 'Mail.Read.Shared' : 'Mail.Read')
  return scopes
}

/**
 * Ist die Seite selbst schon durch die Microsoft-Anmeldung des Hostings
 * geschützt (Azure Static Web Apps), steht dort, wer angemeldet ist. Damit
 * meldet MSAL dieselbe Person ohne zweite Eingabe an.
 */
async function hostLogin() {
  try {
    const res = await fetch('/.auth/me', { credentials: 'same-origin', headers: { accept: 'application/json' } })
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return ''
    return (await res.json()).clientPrincipal?.userDetails || ''
  } catch {
    return ''
  }
}

// Fehler beim stillen Token-Holen, nach denen eine normale Anmeldung hilft (kein Netzfehler)
const REAUTH_CODES = new Set(['monitor_window_timeout', 'timed_out', 'block_iframe_reload', 'login_required', 'consent_required', 'interaction_required', 'hash_empty_error', 'hash_does_not_contain_known_properties', 'no_tokens_found', 'refresh_token_expired', 'bad_token'])
/** Hilft eine normale Anmeldung (Weiterleitung zu Microsoft)? Netzfehler (offline) nicht. */
export const needsReauth = (err) => !!err && REAUTH_CODES.has(err.errorCode)
const REAUTH_KEY = 'cleanos-reauth'
const REAUTH_HINT = 'Die Anmeldung bei Microsoft ließ sich nicht still erneuern. Bitte „Erneut versuchen“. Klappt es wieder nicht: in diesem Browser Cookies für login.microsoftonline.com erlauben oder einmal abmelden und neu anmelden.'
/** Gegen Schleifen: höchstens eine Weiterleitung je Minute. */
function reauthJustTried(now = Date.now()) {
  try {
    return now - Number(sessionStorage.getItem(REAUTH_KEY) || 0) < 60000
  } catch {
    return false
  }
}
function markReauth() {
  try {
    sessionStorage.setItem(REAUTH_KEY, String(Date.now()))
  } catch {
    /* ohne Speicher */
  }
}

export async function signIn({ tenantId, clientId, allowGuests = false, redirectUri = `${location.origin}${location.pathname}`, scopes = GRAPH_SCOPES }) {
  if (!GUID.test(tenantId || '')) throw new Error('In config.json fehlt sharepoint.tenantId (Verzeichnis-ID des Microsoft-365-Tenants).')
  if (!GUID.test(clientId || '')) throw Object.assign(new Error('Die App ist noch nicht bei Microsoft registriert: In config.json fehlt sharepoint.clientId (Anwendungs-ID aus Entra ID, Einrichtung Schritt 2).'), { unregistered: true, redirectUri })
  await loadScript('vendor/msal-browser.min.js')
  const { PublicClientApplication, InteractionRequiredAuthError } = globalThis.msal
  const pca = new PublicClientApplication({
    auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, redirectUri, postLogoutRedirectUri: redirectUri },
    cache: { cacheLocation: 'localStorage' },
  })
  await pca.initialize()
  const result = await pca.handleRedirectPromise()
  let account = result?.account || pca.getActiveAccount() || pca.getAllAccounts()[0]
  if (!account) {
    const loginHint = await hostLogin()
    if (loginHint) {
      try {
        account = (await pca.ssoSilent({ scopes, loginHint })).account
      } catch {
        /* still nicht möglich (z. B. Drittanbieter-Cookies gesperrt): normale Anmeldung */
      }
    }
    if (!account) {
      await pca.loginRedirect({ scopes, ...(loginHint ? { loginHint } : {}) })
      return new Promise(() => {}) // Seite wird zur Anmeldung umgeleitet
    }
  }
  const problem = accountProblem(account, tenantId, { allowGuests })
  if (problem) throw Object.assign(new Error(problem), { signOut: () => pca.logoutRedirect({ account }) })
  pca.setActiveAccount(account)

  async function getToken() {
    try {
      return (await pca.acquireTokenSilent({ scopes, account })).accessToken
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError || needsReauth(err)) {
        // stilles Erneuern ging nicht (abgelaufen, Cookies gesperrt, Zeitüberschreitung im unsichtbaren Fenster):
        // einmal zur normalen Anmeldung – mit bestehender Microsoft-Sitzung geht das ohne Eingabe
        if (reauthJustTried()) throw Object.assign(new Error(REAUTH_HINT), { cause: err })
        markReauth()
        await pca.acquireTokenRedirect({ scopes, account })
        return new Promise(() => {})
      }
      throw err
    }
  }

  const { groups, overage } = groupsOf(account)
  return {
    // roles: App-Rollen aus Entra ID (Unternehmensanwendung → Benutzer und Gruppen); groups: Microsoft-Gruppen (Token-Konfiguration)
    user: { id: account.homeAccountId || '', name: account.name || account.username, email: (account.username || '').toLowerCase(), roles: account.idTokenClaims?.roles || [], groups, groupsOverage: overage },
    getToken,
    /** Token für weitere Rechte (Werkzeuge: Mail.Send, Kalender, Azure Maps …), still; wirft, wenn Zustimmung oder Anmeldung fehlt. */
    tokenFor: async (wanted) => {
      const res = await pca.acquireTokenSilent({ scopes: wanted, account })
      return { accessToken: res.accessToken, expiresOn: res.expiresOn, scopes: res.scopes || wanted }
    },
    /** Erneut bei Microsoft anmelden (ganze Seite), danach zurück in die App. */
    reauth: (wanted = scopes) => pca.acquireTokenRedirect({ scopes: wanted, account }),
    signOut: () => pca.logoutRedirect({ account }),
  }
}
