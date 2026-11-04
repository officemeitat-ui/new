import { GraphError, isDirectoryTenantId } from "./graph";

/**
 * Proves which Microsoft directory an administrator belongs to, before admin consent is
 * requested for it (authorization code flow, https://learn.microsoft.com/graph/auth-v2-user).
 * The directory comes from Microsoft (token endpoint + GET /organization, delegated User.Read),
 * never from a URL parameter.
 */
export type SignInConfig = {
  clientId: string;
  clientSecret: string;
  loginUrl: string;
  graphUrl: string;
  fetch?: typeof fetch;
};

const TIMEOUT_MS = 20_000;

export function signInUrl(config: SignInConfig, input: { redirectUri: string; state: string }) {
  const url = new URL(`${config.loginUrl.replace(/\/+$/, "")}/organizations/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", "User.Read");
  url.searchParams.set("state", input.state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function directoryOfSignedInUser(
  config: SignInConfig,
  input: { code: string; redirectUri: string },
): Promise<string> {
  const doFetch = config.fetch ?? fetch;
  const failed = () =>
    new GraphError(
      401,
      "signin_failed",
      "Die Anmeldung bei Microsoft hat nicht geklappt. Bitte versuchen Sie es erneut.",
    );
  const tokenResponse = await doFetch(
    `${config.loginUrl.replace(/\/+$/, "")}/organizations/oauth2/v2.0/token`,
    {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
        scope: "User.Read",
      }),
    },
  ).catch(() => {
    throw failed();
  });
  const token = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenResponse.ok || !token.access_token) throw failed();

  const orgResponse = await doFetch(`${config.graphUrl.replace(/\/+$/, "")}/organization`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
  }).catch(() => {
    throw failed();
  });
  const org = (await orgResponse.json().catch(() => ({}))) as { value?: { id?: string }[] };
  const id = org.value?.[0]?.id;
  if (!orgResponse.ok || !id || !isDirectoryTenantId(id)) throw failed();
  return id;
}
