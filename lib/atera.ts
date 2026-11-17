import "server-only";

// Atera (RMM/PSA) über die REST-API v3. API-Schlüssel: Atera → Admin → API (in allen bezahlten Tarifen).
// Feldnamen laut Atera-API v3; vor dem Livegang mit der eigenen Instanz prüfen (Cockpit → Arbeitsplatz → „Jetzt abgleichen“).

const API_URL = process.env.ATERA_API_URL || "https://app.atera.com/api/v3";
const PAGE_SIZE = 50;

export class AteraError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function ateraConfigured(): boolean {
  return Boolean(process.env.ATERA_API_KEY);
}

export type AteraCustomer = { CustomerID: number; CustomerName: string };
export type AteraTicket = {
  TicketID: number;
  TicketTitle: string;
  TicketStatus: string;
  TicketPriority?: string;
  TicketType?: string;
  CustomerID?: number;
  CustomerName?: string;
  EndUserFirstName?: string;
  EndUserLastName?: string;
  EndUserEmail?: string;
  EndUserPhone?: string;
  TechnicianFullName?: string;
  TicketCreatedDate?: string;
  TicketResolvedDate?: string;
  LastEndUserCommentTimestamp?: string;
  LastTechnicianCommentTimestamp?: string;
};
export type AteraAlert = {
  AlertID: number;
  Title: string;
  Severity?: string;
  Created?: string;
  DeviceName?: string;
  CustomerID?: number;
  CustomerName?: string;
  AlertMessage?: string;
  AdditionalInfo?: string;
  TicketID?: number | null;
  Archived?: boolean;
};
export type AteraAgent = {
  AgentID: number;
  CustomerID?: number;
  CustomerName?: string;
  MachineName?: string;
  AgentName?: string;
  OS?: string;
  Online?: boolean;
  LastSeen?: string;
  CurrentLoggedUsers?: string;
  AppViewUrl?: string;
};
export type TicketComment = { date: string | null; author: string; text: string; fromCustomer: boolean; internal: boolean };

type Page<T> = { items?: T[]; totalPages?: number; page?: number };

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const key = process.env.ATERA_API_KEY;
  if (!key) throw new AteraError("Atera ist nicht verbunden (ATERA_API_KEY fehlt)");
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "X-API-KEY": key, Accept: "application/json", "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new AteraError(`Atera nicht erreichbar (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new AteraError(
      response.status === 401 || response.status === 403
        ? "Atera lehnt den API-Schlüssel ab"
        : `Atera: HTTP ${response.status}${detail ? ` – ${detail}` : ""}`,
      response.status,
    );
  }
  return response;
}

async function all<T>(path: string, params: Record<string, string> = {}, maxPages = 40): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const query = new URLSearchParams({ ...params, page: String(page), itemsInPage: String(PAGE_SIZE) });
    const data = (await (await request(`${path}?${query}`)).json()) as Page<T>;
    items.push(...(data.items ?? []));
    if (!data.items?.length || page >= (data.totalPages ?? 1)) break;
  }
  return items;
}

export const listAteraCustomers = () => all<AteraCustomer>("/customers");
export const listAteraTickets = (status: "Open" | "Pending") => all<AteraTicket>("/tickets", { ticketStatus: status });
export const listAteraAlerts = async () => (await all<AteraAlert>("/alerts", {}, 20)).filter((a) => !a.Archived);
export const listAteraAgents = () => all<AteraAgent>("/agents");

export async function getAteraTicket(id: string): Promise<AteraTicket | null> {
  try {
    return (await (await request(`/tickets/${encodeURIComponent(id)}`)).json()) as AteraTicket;
  } catch (error) {
    if (error instanceof AteraError && error.status === 404) return null;
    throw error;
  }
}

/** HTML aus Kommentaren entfernen (Atera speichert E-Mail-Antworten oft als HTML). */
export function plainText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function ateraTicketComments(id: string): Promise<TicketComment[]> {
  type Raw = Record<string, unknown>;
  const items = await all<Raw>(`/tickets/${encodeURIComponent(id)}/comments`, {}, 5);
  const str = (value: unknown) => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));
  return items.map((c) => {
    const fromCustomer = Boolean(c.EnduserID ?? c.EndUserID) && !c.TechnicianContactID;
    const name = [str(c.FirstName), str(c.LastName)].join(" ").trim() || str(c.TechnicianFullName);
    return {
      date: str(c.Date ?? c.CreatedDate) || null,
      author: name || (fromCustomer ? "Kunde" : "Technik"),
      text: plainText(str(c.Comment ?? c.CommentText)),
      fromCustomer,
      internal: Boolean(c.IsInternal),
    };
  });
}

/** Ticketstatus in Atera ändern (Open, Pending, Resolved, Closed). */
export async function updateAteraTicketStatus(id: string, status: string): Promise<void> {
  await request(`/tickets/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ TicketStatus: status }) });
}
