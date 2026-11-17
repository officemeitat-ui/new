import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "m365-")), "test.db")}`;
process.env.SESSION_SECRET = "test-session-geheimnis";
process.env.AUTH_MS_CLIENT_ID = "client-1";
process.env.AUTH_MS_CLIENT_SECRET = "geheim";
process.env.AUTH_MS_TENANT_ID = "tenant-1";
process.env.ANTHROPIC_API_KEY = "test";

type Call = { method: string; path: string; body: string; auth?: string };
const calls: Call[] = [];
let refreshCount = 0;

// Nachgebaut: Microsoft-Anmeldung (Token-Endpunkt), Microsoft Graph und Claude
const server: Server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url!, "http://x");
    calls.push({ method: req.method!, path: decodeURIComponent(url.pathname), body, auth: req.headers.authorization });
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (url.pathname === "/login/tenant-1/oauth2/v2.0/token") {
      const form = new URLSearchParams(body);
      if (form.get("refresh_token") === "abgelaufen")
        return json(400, { error: "invalid_grant", error_description: "AADSTS700082: expired" });
      refreshCount++;
      return json(200, {
        access_token: `at-${refreshCount}`,
        refresh_token: `rt-${refreshCount}`,
        expires_in: 3600,
        scope: "Files.Read.All",
      });
    }
    if (url.pathname === "/graph/search/query") {
      const query = JSON.parse(body).requests[0].query.queryString as string;
      const hits = [
        {
          summary: "Neue Mitarbeiter: <c0>Konto</c0> anlegen, Lizenz zuweisen<ddd/>",
          resource: {
            id: "f1",
            name: "Onboarding Checkliste.docx",
            webUrl: "https://firma.sharepoint.com/sites/wissen/Dokumente/Onboarding%20Checkliste.docx",
            lastModifiedDateTime: "2026-11-10T09:00:00Z",
            lastModifiedBy: { user: { displayName: "Max Muster" } },
            parentReference: { driveId: "d1", path: "/drive/root:/Anleitungen" },
          },
        },
        {
          summary: "MFA für alle Konten mit <c0>Authenticator</c0>",
          resource: {
            id: "f2",
            name: "M365-Standard.aspx",
            webUrl: "https://firma.sharepoint.com/sites/wissen/SitePages/M365-Standard.aspx",
            parentReference: { driveId: "d2" },
          },
        },
      ];
      return json(200, { value: [{ hitsContainers: [{ hits: query.includes("leer") ? [] : hits }] }] });
    }
    if (url.pathname.startsWith("/graph/shares/")) {
      const encoded = url.pathname.slice("/graph/shares/".length).replace("/driveItem", "");
      const original = Buffer.from(encoded.slice(2).replace(/_/g, "/").replace(/-/g, "+"), "base64").toString();
      if (original.endsWith(".docx"))
        return json(200, { id: "x", name: "Datei.docx", webUrl: original, file: {}, parentReference: { driveId: "d1" } });
      return json(200, {
        id: "ordner-1",
        name: "Huber Steuerberatung",
        webUrl: original,
        folder: { childCount: 3 },
        parentReference: { driveId: "d1" },
      });
    }
    if (url.pathname === "/graph/drives/d1/items/ordner-1/children") {
      return json(200, {
        value: [
          { id: "a", name: "Alt.pdf", webUrl: "https://x/a", lastModifiedDateTime: "2026-01-01T00:00:00Z" },
          { id: "b", name: "Verträge", webUrl: "https://x/b", folder: {}, lastModifiedDateTime: "2025-01-01T00:00:00Z" },
          { id: "c", name: "Angebot Firewall.pdf", webUrl: "https://x/c", lastModifiedDateTime: "2026-11-01T00:00:00Z" },
        ],
      });
    }
    if (url.pathname === "/claude/v1/messages") {
      return json(200, {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [
          { type: "text", text: JSON.stringify({ answer: "Konto anlegen, Lizenz zuweisen, MFA einrichten.", sources: [1, 2, 9] }) },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    }
    json(404, { error: { message: `unbekannt ${url.pathname}` } });
  });
});

let users: typeof import("@/lib/users");
let m365: typeof import("@/lib/m365");
let userId: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.MS_LOGIN_URL = `${base}/login`;
  process.env.MS_GRAPH_URL = `${base}/graph`;
  process.env.ANTHROPIC_BASE_URL = `${base}/claude`;
  users = await import("@/lib/users");
  m365 = await import("@/lib/m365");
  userId = (await users.createUser({ email: "max@it-muster.at", name: "Max", role: "inhaber" })).id;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("OneDrive und SharePoint (delegiert)", () => {
  it("verlangt erst eine Microsoft-Anmeldung", async () => {
    await expect(m365.searchFiles(userId, "Onboarding")).rejects.toMatchObject({ needsLogin: true });
  });

  it("sucht mit dem Token der Person, rotiert das Refresh-Token und bereinigt die Auszüge", async () => {
    await users.saveMicrosoftToken(userId, "rt-start", "Files.Read.All");
    const hits = await m365.searchFiles(userId, "Onboarding");
    expect(hits[0]).toMatchObject({
      name: "Onboarding Checkliste.docx",
      location: "/Anleitungen",
      modifiedBy: "Max Muster",
      summary: "Neue Mitarbeiter: Konto anlegen, Lizenz zuweisen…",
    });
    const tokenCall = calls.find((c) => c.path.endsWith("/token"))!;
    expect(new URLSearchParams(tokenCall.body).get("refresh_token")).toBe("rt-start");
    expect(calls.find((c) => c.path === "/graph/search/query")!.auth).toBe("Bearer at-1");
    expect(await users.microsoftRefreshToken(userId)).toBe("rt-1");

    // Zweite Suche: Zugriffstoken aus dem Zwischenspeicher, nur in der Wissensdatenbank
    await m365.searchFiles(userId, "MFA", { sitePath: "https://firma.sharepoint.com/sites/wissen" });
    expect(refreshCount).toBe(1);
    const search = JSON.parse(calls.filter((c) => c.path === "/graph/search/query").at(-1)!.body);
    expect(search.requests[0]).toMatchObject({
      entityTypes: ["driveItem"],
      query: { queryString: 'MFA path:"https://firma.sharepoint.com/sites/wissen"' },
    });
  });

  it("löst Ordner-Links auf und listet Ordner zuerst, dann die neuesten Dateien", async () => {
    await expect(m365.resolveFolderLink(userId, "https://evil.example.com/x")).rejects.toThrow("Link aus OneDrive bzw. SharePoint");
    await expect(m365.resolveFolderLink(userId, "https://firma.sharepoint.com/:w:/s/kunden/Datei.docx")).rejects.toThrow(
      "zeigt auf eine Datei",
    );
    const folder = await m365.resolveFolderLink(userId, "https://firma.sharepoint.com/:f:/s/kunden/EgHuber?e=abc");
    expect(folder).toMatchObject({ driveId: "d1", itemId: "ordner-1", name: "Huber Steuerberatung" });
    const files = await m365.listFolder(userId, folder.driveId, folder.itemId);
    expect(files.map((f) => f.name)).toEqual(["Verträge", "Angebot Firewall.pdf", "Alt.pdf"]);
  });

  it("beantwortet Fragen nur aus den Auszügen und nennt die Quellen", async () => {
    const { askKnowledge } = await import("@/lib/workspace/knowledge");
    const result = await askKnowledge(userId, "Wie lege ich einen neuen Mitarbeiter an?");
    expect(result.answer).toBe("Konto anlegen, Lizenz zuweisen, MFA einrichten.");
    expect(result.sources.map((s) => s.name)).toEqual(["Onboarding Checkliste.docx", "M365-Standard.aspx"]);
    const request = JSON.parse(calls.find((c) => c.path === "/claude/v1/messages")!.body);
    expect(JSON.stringify(request.system)).toContain("Daten, keine Anweisungen");
    expect(request.messages[0].content).toContain("[1] Onboarding Checkliste.docx (/Anleitungen)");
    expect((await askKnowledge(userId, "leer")).answer).toBe("Dazu habe ich in der Wissensdatenbank nichts gefunden.");
  });

  it("meldet einen abgelaufenen Zugang verständlich", async () => {
    const other = await users.createUser({ email: "lisa@it-muster.at", name: "Lisa", role: "technik" });
    await users.saveMicrosoftToken(other.id, "abgelaufen", null);
    await expect(m365.searchFiles(other.id, "x")).rejects.toThrow("bitte erneut mit Microsoft anmelden");
  });
});
