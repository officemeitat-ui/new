import { GraphError, isDirectoryTenantId } from "./graph";

/**
 * Proves which Microsoft directory the person belongs to and that they are allowed to grant
 * admin consent there, before consent is requested (authorization code flow,
 * https://learn.microsoft.com/graph/auth-v2-user). The directory comes from Microsoft (token
 * endpoint + GET /organization), never from a URL parameter.
 *
 * Admin check (security review): GET /me (userType must be Member – no guests) and
 * GET /me/memberOf/microsoft.graph.directoryRole (delegated RoleManagement.Read.Directory;
 * with User.Read alone roles come back without roleTemplateId). Only Global Administrator and
 * Privileged Role Administrator may grant application permissions of Microsoft Graph.
 * Role IDs: https://learn.microsoft.com/entra/identity/role-based-access-control/permissions-reference
 */
export const CONSENT_ADMIN_ROLES = new Set([
  "62e90394-69f5-4237-9190-012177145e10", // Global Administrator
  "e8611ab8-c189-46e8-94e1-60213ab1f814", // Privileged Role Administrator
]);
const SCOPE = "User.Read RoleManagement.Read.Directory";
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
  url.searchParams.set("scope", SCOPE);
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
        scope: SCOPE,
      }),
    },
  ).catch(() => {
    throw failed();
  });
  const token = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenResponse.ok || !token.access_token) throw failed();

  const graph = config.graphUrl.replace(/\/+$/, "");
  const get = async (path: string, extra: Record<string, string> = {}) => {
    const response = await doFetch(`${graph}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${token.access_token}`,
        accept: "application/json",
        ...extra,
      },
    }).catch(() => {
      throw failed();
    });
    if (!response.ok) throw failed();
    return (await response.json().catch(() => ({}))) as Record<string, unknown>;
  };

  const org = (await get("/organization")) as { value?: { id?: string }[] };
  const id = org.value?.[0]?.id;
  if (!id || !isDirectoryTenantId(id)) throw failed();

  const notAdmin = new GraphError(
    403,
    "not_admin",
    "Verbinden darf nur ein Globaler Administrator oder Administrator für privilegierte Rollen dieses Microsoft-365-Verzeichnisses (kein Gastkonto).",
  );
  const me = (await get("/me?$select=id,userType")) as { userType?: string };
  if (me.userType !== "Member") throw notAdmin;
  let next: string | null =
    "/me/memberOf/microsoft.graph.directoryRole?$select=roleTemplateId&$count=true";
  for (let page = 0; next && page < 5; page++) {
    const roles = (await get(next, { consistencylevel: "eventual" })) as {
      value?: { roleTemplateId?: string | null }[];
      "@odata.nextLink"?: string;
    };
    if (
      roles.value?.some(
        (role) => role.roleTemplateId && CONSENT_ADMIN_ROLES.has(role.roleTemplateId),
      )
    ) {
      return id;
    }
    // Follow the next page only on Graph itself.
    const link = roles["@odata.nextLink"];
    next = link?.startsWith(`${graph}/`) ? link.slice(graph.length) : null;
  }
  throw notAdmin;
}
