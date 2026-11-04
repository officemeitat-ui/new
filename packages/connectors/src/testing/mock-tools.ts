// Stand-in for a BookStack instance and the Atera API, for tests. Implements only the endpoints
// the connectors use (see bookstack.ts / atera.ts for the sources). Erasable TypeScript only, so
// `node mock-tools.ts` runs it directly (Playwright web server).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export const MOCK_BOOKSTACK_TOKEN = { id: "nexus-token", secret: "nexus-secret" };
export const MOCK_ATERA_KEY = "mock-atera-key";

export type MockToolsCall = { method: string; path: string };

type Page = {
  id: number;
  book_id: number;
  name: string;
  slug: string;
  markdown: string;
  draft?: boolean;
  updated_at: string;
};
type Ticket = {
  TicketID: number;
  TicketNumber: number;
  TicketTitle: string;
  TicketStatus: string;
  TicketType: string;
  CustomerID: number;
  CustomerName: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  comments: { Comment: string; IsInternal: boolean; Date: string }[];
};

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function sampleBooks() {
  return [
    { id: 1, name: "Firewalls", slug: "firewalls" },
    { id: 2, name: "Clients", slug: "clients" },
  ];
}

function samplePages(): Page[] {
  return [
    {
      id: 11,
      book_id: 1,
      name: "Securepoint Firmware-Update",
      slug: "securepoint-firmware-update",
      markdown:
        "# Securepoint Firmware-Update\n\nVor dem Update immer ein Konfigurations-Backup in der USC ziehen. Updates nur außerhalb der Geschäftszeiten, danach VPN-Tunnel prüfen.",
      updated_at: daysAgo(10),
    },
    {
      id: 12,
      book_id: 2,
      name: "Lenovo Docking Station",
      slug: "lenovo-docking-station",
      markdown:
        "# Lenovo Docking Station\n\nFlackernde Monitore an der Lenovo-Dock: Lenovo Vantage öffnen, Dock-Firmware aktualisieren und das DisplayLink-Paket neu installieren.",
      updated_at: daysAgo(3),
    },
    {
      id: 13,
      book_id: 2,
      name: "Entwurf Terra Server",
      slug: "entwurf-terra-server",
      markdown: "# Entwurf",
      draft: true,
      updated_at: daysAgo(1),
    },
  ];
}

function sampleTickets(): Ticket[] {
  return [
    {
      TicketID: 501,
      TicketNumber: 1042,
      TicketTitle: "HP-Drucker druckt nur leere Seiten",
      TicketStatus: "Resolved",
      TicketType: "Problem",
      CustomerID: 7,
      CustomerName: "Bäckerei Müller KG",
      CreatedDate: daysAgo(20),
      LastUpdatedDate: daysAgo(19),
      comments: [
        {
          Comment:
            "Seit heute kommen nur leere Seiten aus dem HP LaserJet. Bitte rasch melden: Anna Muster, 0664 123 45 67, anna.muster@baeckerei.example",
          IsInternal: false,
          Date: daysAgo(20),
        },
        {
          Comment:
            "Ursache: Schutzstreifen am neuen Toner nicht entfernt. Toner herausnehmen, Streifen abziehen, Testseite drucken – erledigt.",
          IsInternal: true,
          Date: daysAgo(19),
        },
      ],
    },
    {
      TicketID: 502,
      TicketNumber: 1043,
      TicketTitle: "ESET PROTECT meldet veralteten Agent",
      TicketStatus: "Closed",
      TicketType: "Incident",
      CustomerID: 8,
      CustomerName: "Kanzlei Berger & Partner",
      CreatedDate: daysAgo(15),
      LastUpdatedDate: daysAgo(14),
      comments: [
        {
          Comment:
            "Agent per Client-Task „Sicherheitsprodukt aktualisieren“ in ESET PROTECT neu verteilt; danach Status grün.",
          IsInternal: true,
          Date: daysAgo(14),
        },
      ],
    },
    {
      TicketID: 503,
      TicketNumber: 1044,
      TicketTitle: "Neuer Laptop für Buchhaltung",
      TicketStatus: "Open",
      TicketType: "Request",
      CustomerID: 7,
      CustomerName: "Bäckerei Müller KG",
      CreatedDate: daysAgo(1),
      LastUpdatedDate: daysAgo(1),
      comments: [],
    },
  ];
}

export type MockTools = {
  url: string;
  bookstackUrl: string;
  ateraUrl: string;
  calls: MockToolsCall[];
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

/** Starts the mock. `pageSize` limits listings, so paging is exercised. */
export async function startMockTools(
  options: { port?: number; pageSize?: number } = {},
): Promise<MockTools> {
  const calls: MockToolsCall[] = [];
  const books = sampleBooks();
  let pages = samplePages();
  let tickets = sampleTickets();
  const pageSize = options.pageSize ?? 500;

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      if (path === "/health") return res.end("ok");
      if (path === "/__calls") return json(res, 200, calls);
      // Test hooks: change, add or delete a page; reset everything.
      if (path === "/__bookstack/page" && req.method === "POST") {
        const change = JSON.parse(await readBody(req)) as Partial<Page> & { id: number };
        const existing = pages.find((p) => p.id === change.id);
        if (existing) Object.assign(existing, change, { updated_at: new Date().toISOString() });
        else
          pages.push({
            book_id: 1,
            name: `Seite ${change.id}`,
            slug: `seite-${change.id}`,
            markdown: "",
            ...change,
            updated_at: new Date().toISOString(),
          });
        return json(res, 200, { ok: true });
      }
      if (path === "/__bookstack/page" && req.method === "DELETE") {
        const id = Number(url.searchParams.get("id"));
        pages = pages.filter((p) => p.id !== id);
        return json(res, 200, { ok: true });
      }
      if (path === "/__reset" && req.method === "POST") {
        pages = samplePages();
        tickets = sampleTickets();
        calls.length = 0;
        return json(res, 200, { ok: true });
      }
      calls.push({ method: req.method ?? "GET", path: `${path}${url.search}` });

      // BookStack: Authorization: Token <id>:<secret>
      if (path.startsWith("/bookstack/api/")) {
        const expected = `Token ${MOCK_BOOKSTACK_TOKEN.id}:${MOCK_BOOKSTACK_TOKEN.secret}`;
        if (req.headers.authorization !== expected) {
          return json(res, 401, { error: { code: 401, message: "No authorization token found" } });
        }
        const count = Math.min(Number(url.searchParams.get("count") ?? 100), pageSize);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (path === "/bookstack/api/books") {
          return json(res, 200, { data: books.slice(offset, offset + count), total: books.length });
        }
        if (path === "/bookstack/api/pages") {
          const data = pages
            .slice(offset, offset + count)
            .map(({ markdown: _markdown, ...page }) => ({ ...page, template: false }));
          return json(res, 200, { data, total: pages.length });
        }
        const exported = /^\/bookstack\/api\/pages\/(\d+)\/export\/markdown$/.exec(path);
        if (exported) {
          const page = pages.find((p) => p.id === Number(exported[1]));
          if (!page) return json(res, 404, { error: { code: 404, message: "Not found" } });
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
          return res.end(page.markdown);
        }
        return json(res, 404, { error: { code: 404, message: "Not found" } });
      }

      // Atera: X-API-KEY, paging with Page/ItemsInPage.
      if (path.startsWith("/atera/api/v3/")) {
        if (req.headers["x-api-key"] !== MOCK_ATERA_KEY) {
          return json(res, 401, { Message: "Authorization has been denied for this request." });
        }
        if (path === "/atera/api/v3/tickets") {
          const status = url.searchParams.get("TicketStatus");
          const from = url.searchParams.get("DateFrom");
          const size = Math.min(Number(url.searchParams.get("ItemsInPage") ?? 20), 50, pageSize);
          const page = Math.max(1, Number(url.searchParams.get("Page") ?? 1));
          const matching = tickets.filter(
            (t) =>
              (!status || t.TicketStatus === status) &&
              (!from || t.CreatedDate.slice(0, 10) >= from),
          );
          const totalPages = Math.max(1, Math.ceil(matching.length / size));
          const items = matching
            .slice((page - 1) * size, page * size)
            .map(({ comments: _comments, ...ticket }) => ticket);
          return json(res, 200, {
            items,
            totalItemCount: matching.length,
            page,
            itemsInPage: size,
            totalPages,
            prevLink: "",
            nextLink: page < totalPages ? `${path}?Page=${page + 1}` : "",
          });
        }
        const comments = /^\/atera\/api\/v3\/tickets\/(\d+)\/comments$/.exec(path);
        if (comments) {
          const ticket = tickets.find((t) => t.TicketID === Number(comments[1]));
          if (!ticket) return json(res, 404, { Message: "Not found" });
          return json(res, 200, { items: ticket.comments, totalItemCount: ticket.comments.length });
        }
      }
      return json(res, 404, { error: "mock" });
    })();
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  const base = `http://localhost:${port}`;
  return {
    url: base,
    bookstackUrl: `${base}/bookstack`,
    ateraUrl: `${base}/atera/api/v3`,
    calls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// CLI: node mock-tools.ts (port from MOCK_TOOLS_PORT, default 4030)
if (import.meta.url === `file://${process.argv[1]}`) {
  const mock = await startMockTools({ port: Number(process.env.MOCK_TOOLS_PORT ?? 4030) });
  console.warn(`mock BookStack/Atera on ${mock.url}`);
}
