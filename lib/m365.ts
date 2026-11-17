import "server-only";
import { refreshAccessToken } from "@/lib/entra";
import { GRAPH_URL } from "@/lib/graph";
import { microsoftRefreshToken, saveMicrosoftToken } from "@/lib/users";

// OneDrive und SharePoint mit den Rechten der angemeldeten Person (delegierter Zugriff aus der Microsoft-Anmeldung).
// Der Arbeitsplatz sieht nur, was die Person selbst sehen darf – keine mandantenweiten App-Rechte.

export class M365Error extends Error {
  constructor(
    message: string,
    readonly needsLogin = false,
  ) {
    super(message);
  }
}

export type DriveFile = {
  id: string;
  driveId: string | null;
  name: string;
  webUrl: string;
  folder: boolean;
  size: number | null;
  modified: string | null;
  modifiedBy: string | null;
  location: string | null;
  summary: string | null;
};

const tokens = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(userId: string): Promise<string> {
  const cached = tokens.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const refresh = await microsoftRefreshToken(userId);
  if (!refresh) throw new M365Error("Für OneDrive und SharePoint bitte einmal mit Microsoft anmelden.", true);
  try {
    const fresh = await refreshAccessToken(refresh);
    if (fresh.refreshToken && fresh.refreshToken !== refresh) await saveMicrosoftToken(userId, fresh.refreshToken, fresh.scope);
    tokens.set(userId, { token: fresh.accessToken, expiresAt: Date.now() + fresh.expiresIn * 1000 });
    return fresh.accessToken;
  } catch (error) {
    throw new M365Error(
      `Der Microsoft-Zugriff ist abgelaufen – bitte erneut mit Microsoft anmelden (${error instanceof Error ? error.message : String(error)}).`,
      true,
    );
  }
}

async function graph<T>(userId: string, path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(userId);
  let response: Response;
  try {
    response = await fetch(path.startsWith("http") ? path : `${GRAPH_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new M365Error(`Microsoft 365 nicht erreichbar (${error instanceof Error ? error.message : String(error)})`);
  }
  if (response.status === 401) {
    tokens.delete(userId);
    throw new M365Error("Microsoft hat den Zugriff abgelehnt – bitte erneut mit Microsoft anmelden.", true);
  }
  if (response.status === 403) throw new M365Error("Keine Berechtigung für diesen Ordner bzw. diese Website.");
  if (response.status === 404) throw new M365Error("Nicht gefunden – stimmt der Link, und hast du Zugriff darauf?");
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new M365Error(`Microsoft 365: HTTP ${response.status}${detail ? ` – ${detail.slice(0, 160)}` : ""}`);
  }
  return (await response.json()) as T;
}

type GraphItem = {
  id: string;
  name: string;
  webUrl: string;
  size?: number;
  folder?: unknown;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName?: string } };
  parentReference?: { driveId?: string; path?: string; siteId?: string };
};

const toFile = (item: GraphItem, summary: string | null = null): DriveFile => ({
  id: item.id,
  driveId: item.parentReference?.driveId ?? null,
  name: item.name,
  webUrl: item.webUrl,
  folder: Boolean(item.folder),
  size: item.size ?? null,
  modified: item.lastModifiedDateTime ?? null,
  modifiedBy: item.lastModifiedBy?.user?.displayName ?? null,
  location: item.parentReference?.path?.replace(/^\/drive(s\/[^/]+)?\/root:?/, "") || null,
  summary: summary ? summary.replace(/<\/?c0>/g, "").replace(/<ddd\/>/g, "…") : null,
});

/** Volltextsuche über OneDrive und SharePoint (Microsoft Search) – optional nur innerhalb einer SharePoint-Website. */
export async function searchFiles(userId: string, query: string, options: { sitePath?: string; size?: number } = {}): Promise<DriveFile[]> {
  const text = query.trim();
  if (!text) return [];
  const queryString = options.sitePath ? `${text} path:"${options.sitePath.replace(/"/g, "")}"` : text;
  type SearchResponse = {
    value?: { hitsContainers?: { hits?: { summary?: string; resource: GraphItem }[] }[] }[];
  };
  const data = await graph<SearchResponse>(userId, "/search/query", {
    method: "POST",
    body: JSON.stringify({
      requests: [{ entityTypes: ["driveItem"], query: { queryString }, from: 0, size: options.size ?? 15 }],
    }),
  });
  return (data.value?.[0]?.hitsContainers ?? []).flatMap((c) => c.hits ?? []).map((hit) => toFile(hit.resource, hit.summary ?? null));
}

/** Ordner-Link (aus OneDrive/SharePoint kopiert, auch Freigabelink) in Laufwerk und Element auflösen. */
export async function resolveFolderLink(
  userId: string,
  url: string,
): Promise<{ driveId: string; itemId: string; name: string; url: string }> {
  const clean = url.trim();
  if (!/^https:\/\/[^/]+\.(sharepoint\.com|sharepoint\.de|1drv\.ms|onedrive\.live\.com)\//i.test(clean)) {
    throw new M365Error("Bitte einen Link aus OneDrive bzw. SharePoint einfügen (https://…sharepoint.com/…)");
  }
  const encoded = `u!${Buffer.from(clean).toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-")}`;
  const item = await graph<GraphItem>(userId, `/shares/${encoded}/driveItem`);
  if (!item.folder) throw new M365Error("Der Link zeigt auf eine Datei – bitte den Link zum Ordner verwenden.");
  if (!item.parentReference?.driveId) throw new M365Error("Microsoft hat kein Laufwerk zum Ordner geliefert");
  return { driveId: item.parentReference.driveId, itemId: item.id, name: item.name, url: item.webUrl };
}

/** Inhalt eines Ordners: Ordner zuerst, dann die zuletzt geänderten Dateien. */
export async function listFolder(userId: string, driveId: string, itemId: string): Promise<DriveFile[]> {
  const select = "id,name,webUrl,size,folder,lastModifiedDateTime,lastModifiedBy,parentReference";
  const data = await graph<{ value: GraphItem[] }>(
    userId,
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children?$top=200&$select=${select}`,
  );
  return data.value
    .map((item) => toFile(item))
    .sort(
      (a, b) =>
        Number(b.folder) - Number(a.folder) || (b.modified ?? "").localeCompare(a.modified ?? "") || a.name.localeCompare(b.name, "de"),
    );
}
