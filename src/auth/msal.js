// Anmeldung mit dem Microsoft-365-Konto (Entra ID) über MSAL.js.
// Die App bekommt nur ein delegiertes Token: sie darf in SharePoint genau
// das, was die angemeldete Person auch selbst darf.

import { loadScript } from '../ui/load-script.js'

export const GRAPH_SCOPES = ['User.Read', 'Sites.ReadWrite.All']

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
  const account = result?.account || pca.getActiveAccount() || pca.getAllAccounts()[0]
  if (!account) {
    await pca.loginRedirect({ scopes })
    return new Promise(() => {}) // Seite wird zur Anmeldung umgeleitet
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
    user: { name: account.name || account.username, email: (account.username || '').toLowerCase() },
    getToken,
    signOut: () => pca.logoutRedirect({ account }),
  }
}
