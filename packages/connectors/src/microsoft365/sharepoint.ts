import { GraphError, type GraphClient } from "./graph";

/**
 * SharePoint document libraries via Microsoft Graph v1.0.
 * - Sites: https://learn.microsoft.com/graph/api/site-search
 * - Libraries: https://learn.microsoft.com/graph/api/drive-list
 * - Changes: https://learn.microsoft.com/graph/api/driveitem-delta
 * - Content: https://learn.microsoft.com/graph/api/driveitem-get-content
 * Application permission: Sites.Read.All (ADR 0008).
 */

export type SharePointSite = { id: string; name: string; webUrl: string };
export type SharePointLibrary = { id: string; name: string; webUrl: string };

/** https://learn.microsoft.com/graph/api/resources/driveitem – the fields we use. */
export type DriveItem = {
  id: string;
  name?: string;
  size?: number;
  cTag?: string;
  eTag?: string;
  webUrl?: string;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  deleted?: { state?: string };
  "@microsoft.graph.downloadUrl"?: string;
};

export async function searchSites(graph: GraphClient, query: string): Promise<SharePointSite[]> {
  const q = query.trim().slice(0, 100);
  const result = await graph.request<{
    value?: { id: string; displayName?: string; name?: string; webUrl?: string }[];
  }>("GET", `/sites?search=${encodeURIComponent(q || "*")}`);
  return (result.value ?? []).slice(0, 25).map((site) => ({
    id: site.id,
    name: site.displayName ?? site.name ?? site.webUrl ?? site.id,
    webUrl: site.webUrl ?? "",
  }));
}

const SITE_ID = /^[\w.,:-]+$/;
const DRIVE_ID = /^[\w!-]+$/;

export async function listLibraries(
  graph: GraphClient,
  siteId: string,
): Promise<SharePointLibrary[]> {
  if (!SITE_ID.test(siteId)) throw new GraphError(400, "invalid_site", "Ungültige Website.");
  const result = await graph.request<{
    value?: { id: string; name?: string; webUrl?: string; driveType?: string }[];
  }>("GET", `/sites/${siteId}/drives`); // validated above; raw commas as in the Graph docs
  return (result.value ?? []).map((drive) => ({
    id: drive.id,
    name: drive.name ?? drive.id,
    webUrl: drive.webUrl ?? "",
  }));
}

export type DeltaPage = {
  items: DriveItem[];
  /** More pages of the current set. */
  nextLink?: string;
  /** Set on the last page: where to ask for later changes. */
  deltaLink?: string;
};

/**
 * One page of changes. Start with `startUrl = null` (full enumeration) or a stored deltaLink.
 * A 410 Gone means the stored state is too old: the caller restarts with a full enumeration.
 */
export async function deltaPage(
  graph: GraphClient,
  driveId: string,
  url: string | null,
): Promise<DeltaPage> {
  if (!DRIVE_ID.test(driveId)) throw new GraphError(400, "invalid_drive", "Ungültige Bibliothek.");
  const page = await graph.request<{
    value?: DriveItem[];
    "@odata.nextLink"?: string;
    "@odata.deltaLink"?: string;
  }>("GET", url ?? `/drives/${driveId}/root/delta`); // driveId validated above
  return {
    items: page.value ?? [],
    ...(page["@odata.nextLink"] ? { nextLink: page["@odata.nextLink"] } : {}),
    ...(page["@odata.deltaLink"] ? { deltaLink: page["@odata.deltaLink"] } : {}),
  };
}

/** Content of a file; uses the pre-authenticated download URL from the delta item. */
export async function downloadItem(
  graph: GraphClient,
  driveId: string,
  item: DriveItem,
  maxBytes: number,
): Promise<Uint8Array> {
  const url =
    item["@microsoft.graph.downloadUrl"] ??
    (
      await graph.request<DriveItem>(
        "GET",
        `/drives/${driveId}/items/${encodeURIComponent(item.id)}`,
      )
    )["@microsoft.graph.downloadUrl"];
  if (!url) throw new GraphError(404, "no_download", "Die Datei kann nicht geladen werden.");
  return graph.download(url, maxBytes);
}
