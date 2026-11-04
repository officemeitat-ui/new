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

export const MOCK_SITE_ID =
  "contoso.sharepoint.com,1d2f5a6b-0000-4000-8000-00000000a001,2e3a4b5c-0000-4000-8000-00000000b001";
export const MOCK_DRIVE_ID = "b!mockDokumente";

type MockFile = {
  id: string;
  name: string;
  content: Uint8Array;
  version: number;
  changedAt: number;
  deleted: boolean;
  folder?: boolean;
  /** Pretend size, to test the size limit without sending megabytes. */
  declaredSize?: number;
};

const encode = (text: string) => new TextEncoder().encode(text);

function sampleLibrary(): MockFile[] {
  let seq = 0;
  const file = (name: string, content: string, extra: Partial<MockFile> = {}): MockFile => ({
    id: `item-${++seq}`,
    name,
    content: encode(content),
    version: 1,
    changedAt: seq,
    deleted: false,
    ...extra,
  });
  return [
    file("Archiv", "", { folder: true }),
    file(
      "Reinigungsplan Büro.md",
      "# Reinigungsplan Büro\n\nBüroflächen werden täglich gesaugt, Sanitärräume zweimal täglich gereinigt und desinfiziert.",
    ),
    file(
      "Hausordnung.txt",
      "Der Müllraum ist nur mit dem Schlüssel der Objektleitung zugänglich. Notfallnummer der Haustechnik: 0800 123 456.",
    ),
    file("Logo.png", "kein Text"),
    file("Grundriss Halle.pdf", "zu groß", { declaredSize: 50 * 1024 * 1024 }),
  ];
}

export type MockMicrosoft = {
  url: string;
  directoryId: string;
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
  options: { port?: number; clientSecret?: string; pageSize?: number; directoryId?: string } = {},
): Promise<MockMicrosoft> {
  /** Each mock can play its own Microsoft directory (one directory = one company). */
  const directoryId = options.directoryId ?? MOCK_DIRECTORY_TENANT_ID;
  const calls: MockCall[] = [];
  /** The person who signs in through the authorization code flow. */
  const signedIn = { admin: true, guest: false };
  const devices = sampleDevices();
  const library = sampleLibrary();
  let changeSeq = library.length;
  /** Delta tokens issued before this sequence are expired (410). */
  let expiredBefore = 0;
  const pageSize = options.pageSize ?? 100;
  let baseUrl = "";

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      if (path === "/health") return res.end("ok");
      if (path === "/__calls") return json(res, 200, calls);
      // Test hook: who signs in next (an administrator by default).
      if (path === "/__signin" && req.method === "POST") {
        Object.assign(signedIn, JSON.parse(await readBody(req)) as Partial<typeof signedIn>);
        return json(res, 200, signedIn);
      }
      // Test hooks: change or delete a file in the SharePoint library, expire delta tokens.
      if (path === "/__sharepoint/upsert" && req.method === "POST") {
        const { name, content } = JSON.parse(await readBody(req)) as {
          name: string;
          content: string;
        };
        const existing = library.find((f) => f.name === name);
        changeSeq += 1;
        if (existing) {
          existing.content = encode(content);
          existing.version += 1;
          existing.changedAt = changeSeq;
          existing.deleted = false;
        } else {
          library.push({
            id: `item-${changeSeq}`,
            name,
            content: encode(content),
            version: 1,
            changedAt: changeSeq,
            deleted: false,
          });
        }
        return json(res, 200, { ok: true });
      }
      if (path === "/__sharepoint/delete" && req.method === "POST") {
        const { name } = JSON.parse(await readBody(req)) as { name: string };
        const existing = library.find((f) => f.name === name);
        if (existing) {
          changeSeq += 1;
          existing.deleted = true;
          existing.changedAt = changeSeq;
        }
        return json(res, 200, { ok: Boolean(existing) });
      }
      if (path === "/__sharepoint/expire" && req.method === "POST") {
        expiredBefore = changeSeq + 1;
        return json(res, 200, { ok: true });
      }
      // Pre-authenticated download URL (no Authorization header, like the real one).
      const download = /^\/download\/([^/]+)$/.exec(path);
      if (download && req.method === "GET") {
        const file = library.find((f) => f.id === download[1] && !f.deleted);
        if (!file || url.searchParams.get("sig") !== `v${file.version}`) return json(res, 404, {});
        calls.push({ method: "GET", path: `download/${file.name}` });
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": String(file.content.byteLength),
        });
        return res.end(Buffer.from(file.content));
      }

      // Sign-in (authorization code flow): the "administrator" signs in at once.
      if (path === "/login/organizations/oauth2/v2.0/authorize" && req.method === "GET") {
        const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
        redirect.searchParams.set("code", `mock-code-${directoryId}`);
        redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
        res.writeHead(302, { location: redirect.toString() });
        return res.end();
      }
      if (path === "/login/organizations/oauth2/v2.0/token" && req.method === "POST") {
        const form = new URLSearchParams(await readBody(req));
        calls.push({ method: "POST", path: "token:authorization_code" });
        if (
          form.get("grant_type") !== "authorization_code" ||
          form.get("code") !== `mock-code-${directoryId}`
        ) {
          return json(res, 400, { error: "invalid_grant" });
        }
        return json(res, 200, {
          token_type: "Bearer",
          expires_in: 3599,
          access_token: `mock-user-${directoryId}`,
        });
      }
      // Admin consent: https://learn.microsoft.com/graph/auth-v2-service#step-2-request-administrator-consent
      // The "administrator" agrees immediately (or declines with ?decline=1 in the redirect URI).
      const consent = /^\/login\/([^/]+)\/adminconsent$/.exec(path);
      if (consent && req.method === "GET") {
        const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
        if (consent[1] !== directoryId) {
          redirect.searchParams.set("error", "invalid_tenant");
          redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
          res.writeHead(302, { location: redirect.toString() });
          return res.end();
        }
        const state = url.searchParams.get("state") ?? "";
        if (url.searchParams.get("mock_decline") === "1") {
          redirect.searchParams.set("error", "access_denied");
          redirect.searchParams.set("error_description", "The admin declined.");
        } else {
          redirect.searchParams.set("admin_consent", "True");
          redirect.searchParams.set("tenant", directoryId);
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
          token[1] !== directoryId
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
      // A signed-in user's token reads the organisation, the user and their directory roles
      // (delegated User.Read + RoleManagement.Read.Directory).
      if (req.headers.authorization === `Bearer mock-user-${directoryId}`) {
        if (path === "/graph/v1.0/organization") {
          return json(res, 200, { value: [{ id: directoryId, displayName: "Contoso Test GmbH" }] });
        }
        if (path === "/graph/v1.0/me") {
          return json(res, 200, { id: "mock-user", userType: signedIn.guest ? "Guest" : "Member" });
        }
        if (path === "/graph/v1.0/me/memberOf/microsoft.graph.directoryRole") {
          if (req.headers.consistencylevel !== "eventual") return json(res, 400, { error: {} });
          return json(res, 200, {
            value: signedIn.admin
              ? [{ roleTemplateId: "62e90394-69f5-4237-9190-012177145e10" }]
              : [{ roleTemplateId: "88d8e3e3-8f55-4a1e-953a-9b9898b8876b" }], // Directory Readers
          });
        }
      }
      if (req.headers.authorization !== `Bearer mock-token-${directoryId}`) {
        return json(res, 401, { error: { code: "InvalidAuthenticationToken", message: "mock" } });
      }
      const graphPath = path.slice("/graph/v1.0".length);
      calls.push({ method: req.method ?? "GET", path: graphPath });

      if (graphPath === "/sites" && req.method === "GET") {
        return json(res, 200, {
          value: [
            {
              id: MOCK_SITE_ID,
              displayName: "Contoso Team",
              webUrl: "https://contoso.sharepoint.com/sites/team",
            },
          ],
        });
      }
      if (graphPath === `/sites/${MOCK_SITE_ID}/drives` && req.method === "GET") {
        return json(res, 200, {
          value: [
            {
              id: MOCK_DRIVE_ID,
              name: "Dokumente",
              driveType: "documentLibrary",
              webUrl: "https://contoso.sharepoint.com/sites/team/Shared%20Documents",
            },
          ],
        });
      }
      if (graphPath === `/drives/${MOCK_DRIVE_ID}/root/delta` && req.method === "GET") {
        const token = Number(url.searchParams.get("token") ?? 0);
        if (token > 0 && token < expiredBefore) {
          return json(res, 410, {
            error: { code: "resyncChangesApplyDifferences", message: "mock" },
          });
        }
        const skip = Number(url.searchParams.get("skip") ?? 0);
        // A first enumeration lists all live items; later calls list everything changed since the token.
        const changed = library.filter((f) => (token === 0 ? !f.deleted : f.changedAt > token));
        const page = changed.slice(skip, skip + pageSize);
        const base = `${baseUrl}/graph/v1.0/drives/${MOCK_DRIVE_ID}/root/delta`;
        const more = skip + pageSize < changed.length;
        return json(res, 200, {
          value: page.map((f) =>
            f.deleted
              ? { id: f.id, name: f.name, deleted: { state: "deleted" } }
              : f.folder
                ? { id: f.id, name: f.name, folder: { childCount: 0 } }
                : {
                    id: f.id,
                    name: f.name,
                    size: f.declaredSize ?? f.content.byteLength,
                    cTag: `"c:{${f.id}},${f.version}"`,
                    eTag: `"{${f.id}},${f.version}"`,
                    webUrl: `https://contoso.sharepoint.com/sites/team/Shared%20Documents/${encodeURIComponent(f.name)}`,
                    file: { mimeType: "application/octet-stream" },
                    "@microsoft.graph.downloadUrl": `${baseUrl}/download/${f.id}?sig=v${f.version}`,
                  },
          ),
          ...(more
            ? { "@odata.nextLink": `${base}?token=${token}&skip=${skip + pageSize}` }
            : { "@odata.deltaLink": `${base}?token=${changeSeq}` }),
        });
      }
      if (graphPath === "/organization") {
        return json(res, 200, {
          value: [{ id: directoryId, displayName: "Contoso Test GmbH" }],
        });
      }
      if (graphPath === "/deviceManagement/managedDevices" && req.method === "GET") {
        const skip = Number(url.searchParams.get("skip") ?? 0);
        const page = devices.slice(skip, skip + pageSize);
        const next =
          skip + pageSize < devices.length
            ? `${baseUrl}/graph/v1.0/deviceManagement/managedDevices?skip=${skip + pageSize}`
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
  baseUrl = `http://localhost:${port}`;
  return {
    url: baseUrl,
    directoryId,
    loginUrl: `${baseUrl}/login`,
    graphUrl: `${baseUrl}/graph/v1.0`,
    calls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// CLI: node mock-microsoft.ts (port from MOCK_MICROSOFT_PORT, default 4020)
if (import.meta.url === `file://${process.argv[1]}`) {
  const mock = await startMockMicrosoft({ port: Number(process.env.MOCK_MICROSOFT_PORT ?? 4020) });
  console.warn(`mock Microsoft on ${mock.url}`);
}
