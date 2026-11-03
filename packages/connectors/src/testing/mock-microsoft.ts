// Stand-in for the Microsoft identity platform and Microsoft Graph (Intune devices), for tests.
// Implements only the documented endpoints the connector uses; production code talks to the
// real services via MICROSOFT_LOGIN_URL / MICROSOFT_GRAPH_URL. Erasable TypeScript only, so
// `node mock-microsoft.ts` runs it directly (Playwright web server).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export const MOCK_DIRECTORY_TENANT_ID = "4b1c7a3e-2f6d-4e8a-9b0c-1d2e3f4a5b6c";

export type MockCall = { method: string; path: string };

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function sampleDevices() {
  const base = {
    managedDeviceOwnerType: "company",
    enrolledDateTime: daysAgo(200),
    totalStorageSpaceInBytes: 256_000_000_000,
    freeStorageSpaceInBytes: 120_000_000_000,
  };
  return [
    {
      ...base,
      id: "a1f0c2d4-0000-4000-8000-000000000001",
      deviceName: "LAPTOP-HUBER-01",
      userPrincipalName: "anna.huber@contoso.example",
      userDisplayName: "Anna Huber",
      operatingSystem: "Windows",
      osVersion: "10.0.26100.2314",
      complianceState: "compliant",
      lastSyncDateTime: daysAgo(0.1),
      isEncrypted: true,
      model: "Latitude 7450",
      manufacturer: "Dell Inc.",
      serialNumber: "5CG4211X7Q",
    },
    {
      ...base,
      id: "a1f0c2d4-0000-4000-8000-000000000002",
      deviceName: "LAPTOP-GRUBER-07",
      userPrincipalName: "karl.gruber@contoso.example",
      userDisplayName: "Karl Gruber",
      operatingSystem: "Windows",
      osVersion: "10.0.22631.4460",
      complianceState: "noncompliant",
      lastSyncDateTime: daysAgo(12),
      isEncrypted: false,
      model: "ThinkPad T14 Gen 4",
      manufacturer: "LENOVO",
      serialNumber: "PF4KX21A",
    },
    {
      ...base,
      id: "a1f0c2d4-0000-4000-8000-000000000003",
      deviceName: "iPhone von Maria",
      userPrincipalName: "maria.berger@contoso.example",
      userDisplayName: "Maria Berger",
      operatingSystem: "iOS",
      osVersion: "18.1",
      complianceState: "compliant",
      lastSyncDateTime: daysAgo(0.5),
      isEncrypted: true,
      model: "iPhone 15",
      manufacturer: "Apple",
      serialNumber: "F2LXK0Q1N7",
      managedDeviceOwnerType: "personal",
    },
    {
      ...base,
      id: "a1f0c2d4-0000-4000-8000-000000000004",
      deviceName: "MACBOOK-EMPFANG",
      userPrincipalName: "empfang@contoso.example",
      userDisplayName: "Empfang",
      operatingSystem: "macOS",
      osVersion: "15.1",
      complianceState: "inGracePeriod",
      lastSyncDateTime: daysAgo(2),
      isEncrypted: true,
      model: "MacBook Air (M3)",
      manufacturer: "Apple",
      serialNumber: "C02FQ1XZMD6T",
    },
  ];
}

export type MockMicrosoft = {
  url: string;
  loginUrl: string;
  graphUrl: string;
  calls: MockCall[];
  close: () => Promise<void>;
};

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let data = "";
  for await (const chunk of req) data += String(chunk);
  return data;
}

/**
 * Starts the mock. Options: `clientSecret` the token endpoint accepts, `pageSize` for paging.
 */
export async function startMockMicrosoft(
  options: { port?: number; clientSecret?: string; pageSize?: number } = {},
): Promise<MockMicrosoft> {
  const calls: MockCall[] = [];
  const devices = sampleDevices();
  const pageSize = options.pageSize ?? 100;
  let base = "";

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      if (path === "/health") return res.end("ok");
      if (path === "/__calls") return json(res, 200, calls);

      // Admin consent: https://learn.microsoft.com/graph/auth-v2-service#step-2-request-administrator-consent
      // The "administrator" agrees immediately (or declines with ?decline=1 in the redirect URI).
      const consent = /^\/login\/([^/]+)\/adminconsent$/.exec(path);
      if (consent && req.method === "GET") {
        const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
        const state = url.searchParams.get("state") ?? "";
        if (url.searchParams.get("mock_decline") === "1") {
          redirect.searchParams.set("error", "access_denied");
          redirect.searchParams.set("error_description", "The admin declined.");
        } else {
          redirect.searchParams.set("admin_consent", "True");
          redirect.searchParams.set("tenant", MOCK_DIRECTORY_TENANT_ID);
        }
        redirect.searchParams.set("state", state);
        res.writeHead(302, { location: redirect.toString() });
        return res.end();
      }

      // Token: https://learn.microsoft.com/graph/auth-v2-service#step-3-request-an-access-token
      const token = /^\/login\/([^/]+)\/oauth2\/v2\.0\/token$/.exec(path);
      if (token && req.method === "POST") {
        const form = new URLSearchParams(await readBody(req));
        calls.push({ method: "POST", path: "token" });
        if (
          form.get("grant_type") !== "client_credentials" ||
          form.get("scope") !== "https://graph.microsoft.com/.default" ||
          (options.clientSecret && form.get("client_secret") !== options.clientSecret) ||
          token[1] !== MOCK_DIRECTORY_TENANT_ID
        ) {
          return json(res, 400, { error: "invalid_client", error_description: "mock: rejected" });
        }
        return json(res, 200, {
          token_type: "Bearer",
          expires_in: 3599,
          ext_expires_in: 3599,
          access_token: `mock-token-${token[1]}`,
        });
      }

      if (!path.startsWith("/graph/v1.0/")) return json(res, 404, { error: { code: "NotFound" } });
      if (req.headers.authorization !== `Bearer mock-token-${MOCK_DIRECTORY_TENANT_ID}`) {
        return json(res, 401, { error: { code: "InvalidAuthenticationToken", message: "mock" } });
      }
      const graphPath = path.slice("/graph/v1.0".length);
      calls.push({ method: req.method ?? "GET", path: graphPath });

      if (graphPath === "/organization") {
        return json(res, 200, {
          value: [{ id: MOCK_DIRECTORY_TENANT_ID, displayName: "Contoso Test GmbH" }],
        });
      }
      if (graphPath === "/deviceManagement/managedDevices" && req.method === "GET") {
        const skip = Number(url.searchParams.get("skip") ?? 0);
        const page = devices.slice(skip, skip + pageSize);
        const next =
          skip + pageSize < devices.length
            ? `${base}/graph/v1.0/deviceManagement/managedDevices?skip=${skip + pageSize}`
            : undefined;
        return json(res, 200, { value: page, ...(next ? { "@odata.nextLink": next } : {}) });
      }
      const single =
        /^\/deviceManagement\/managedDevices\/([^/]+)(?:\/(syncDevice|rebootNow|remoteLock))?$/.exec(
          graphPath,
        );
      if (single) {
        const device = devices.find((d) => d.id === single[1]);
        if (!device)
          return json(res, 404, { error: { code: "ResourceNotFound", message: "mock" } });
        if (!single[2] && req.method === "GET") return json(res, 200, device);
        if (single[2] && req.method === "POST") {
          if (single[2] === "syncDevice") device.lastSyncDateTime = new Date().toISOString();
          res.writeHead(204);
          return res.end();
        }
      }
      return json(res, 404, { error: { code: "NotFound", message: "mock" } });
    })();
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  base = `http://localhost:${port}`;
  return {
    url: base,
    loginUrl: `${base}/login`,
    graphUrl: `${base}/graph/v1.0`,
    calls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// CLI: node mock-microsoft.ts (port from MOCK_MICROSOFT_PORT, default 4020)
if (import.meta.url === `file://${process.argv[1]}`) {
  const mock = await startMockMicrosoft({ port: Number(process.env.MOCK_MICROSOFT_PORT ?? 4020) });
  console.warn(`mock Microsoft on ${mock.url}`);
}
