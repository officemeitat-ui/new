// Anmeldung mit dem Microsoft-365-Konto (Entra ID) über MSAL.js.
// Die App bekommt nur ein delegiertes Token: sie darf in SharePoint genau
// das, was die angemeldete Person auch selbst darf.

import { loadScript } from '../ui/load-script.js'

export const GRAPH_SCOPES = ['User.Read', 'Sites.ReadWrite.All']

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

export async function signIn({ tenantId, clientId, redirectUri = `${location.origin}${location.pathname}`, scopes = GRAPH_SCOPES }) {
  if (!tenantId || !clientId) throw new Error('In config.json fehlen sharepoint.tenantId oder sharepoint.clientId.')
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

  return {
    // roles: App-Rollen aus Entra ID (Unternehmensanwendung → Benutzer und Gruppen)
    user: { name: account.name || account.username, email: (account.username || '').toLowerCase(), roles: account.idTokenClaims?.roles || [] },
    getToken,
    signOut: () => pca.logoutRedirect({ account }),
  }
}
