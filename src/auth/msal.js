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

/** Graph-Berechtigungen je nach Konfiguration (E-Mail-Versand und Kalender optional). */
export function scopesFor(config = {}) {
  const scopes = [...GRAPH_SCOPES]
  if (config.features?.mail) scopes.push(config.mail?.from ? 'Mail.Send.Shared' : 'Mail.Send')
  if (config.features?.calendar) scopes.push('Calendars.ReadWrite')
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
      if (err instanceof InteractionRequiredAuthError) {
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
