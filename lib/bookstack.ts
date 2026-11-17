import "server-only";

// BookStack (Wiki für Dokumentation) über die REST-API. API-Token: im eigenen BookStack-Profil unter „API-Tokens“
// (der Benutzer braucht die Berechtigung „Zugriff auf die System-API“). Auth-Header: „Token <ID>:<Geheimnis>“.

export class BookStackError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type BookStackBook = { id: number; name: string; slug: string; description?: string };
export type BookStackPageSummary = {
  id: number;
  name: string;
  slug: string;
  book_id: number;
  chapter_id: number;
  draft?: boolean;
  updated_at?: string;
};
export type BookStackPage = BookStackPageSummary & { html?: string; markdown?: string; book_slug?: string };
export type BookStackSearchHit = {
  type: string;
  id: number;
  name: string;
  url?: string;
  book_id?: number;
  preview_html?: { name?: string; content?: string };
};

const base = () => (process.env.BOOKSTACK_URL ?? "").replace(/\/+$/, "");

export function bookstackConfigured(): boolean {
  return Boolean(process.env.BOOKSTACK_URL && process.env.BOOKSTACK_TOKEN_ID && process.env.BOOKSTACK_TOKEN_SECRET);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!bookstackConfigured()) throw new BookStackError("BookStack ist nicht verbunden (BOOKSTACK_URL und Token fehlen)");
  let response: Response;
  try {
    response = await fetch(`${base()}/api${path}`, {
      ...init,
      headers: {
        Authorization: `Token ${process.env.BOOKSTACK_TOKEN_ID}:${process.env.BOOKSTACK_TOKEN_SECRET}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new BookStackError(`BookStack nicht erreichbar (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!response.ok) {
    const detail = await response
      .json()
      .then((data: { error?: { message?: string } }) => data.error?.message)
      .catch(() => undefined);
    throw new BookStackError(
      response.status === 401 || response.status === 403
        ? "BookStack lehnt den API-Token ab (Berechtigung „Zugriff auf die System-API“?)"
        : `BookStack: HTTP ${response.status}${detail ? ` – ${detail}` : ""}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export async function listBooks(): Promise<BookStackBook[]> {
  const data = await request<{ data: BookStackBook[] }>("/books?count=500&sort=+name");
  return data.data;
}

/** Seiten eines Buchs (ohne Entwürfe), in der Reihenfolge von BookStack. */
export async function listBookPages(bookId: number | string): Promise<BookStackPageSummary[]> {
  const params = new URLSearchParams({ count: "500", sort: "+priority", "filter[book_id]": String(bookId) });
  const data = await request<{ data: BookStackPageSummary[] }>(`/pages?${params}`);
  return data.data.filter((p) => !p.draft);
}

export async function getBookPage(id: number | string): Promise<BookStackPage> {
  return request<BookStackPage>(`/pages/${encodeURIComponent(String(id))}`);
}

export async function searchBookStack(query: string, count = 10): Promise<BookStackSearchHit[]> {
  const params = new URLSearchParams({ query, count: String(count) });
  const data = await request<{ data: BookStackSearchHit[] }>(`/search?${params}`);
  return data.data;
}

/** Legt eine Seite an oder aktualisiert sie (wenn pageId gesetzt ist und es sie noch gibt). Liefert die Seiten-ID. */
export async function upsertBookPage(input: {
  bookId: number | string;
  pageId?: string | null;
  name: string;
  markdown: string;
}): Promise<number> {
  if (input.pageId) {
    try {
      const page = await request<BookStackPage>(`/pages/${encodeURIComponent(input.pageId)}`, {
        method: "PUT",
        body: JSON.stringify({ name: input.name, markdown: input.markdown }),
      });
      return page.id;
    } catch (error) {
      // Seite wurde in BookStack gelöscht → neu anlegen
      if (!(error instanceof BookStackError && error.status === 404)) throw error;
    }
  }
  const page = await request<BookStackPage>("/pages", {
    method: "POST",
    body: JSON.stringify({ book_id: Number(input.bookId), name: input.name, markdown: input.markdown }),
  });
  return page.id;
}

/** Link zum Buch bzw. zur Seite in BookStack. */
export function bookstackUrl(path: string): string {
  return `${base()}${path}`;
}
