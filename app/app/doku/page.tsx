import Link from "next/link";
import { BookstackMigration } from "@/components/workspace/DocsUI";
import { requireAdmin } from "@/lib/auth";
import { bookstackConfigured, BookStackError, searchBookStack, type BookStackSearchHit } from "@/lib/bookstack";
import { listCustomers } from "@/lib/workspace/customers";
import { searchDocs } from "@/lib/workspace/docs";

const KIND_LABEL = { port: "Verkabelung", rack: "Patchschrank", page: "Seite", network: "Netzwerk" };

/** Eine Suche über die Doku aller Kunden – und, wenn verbunden, über BookStack. */
export default async function DokuSuchePage({ searchParams }: PageProps<"/app/doku">) {
  await requireAdmin();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  const [hits, customers] = await Promise.all([query ? searchDocs(query, undefined, 50) : Promise.resolve([]), listCustomers()]);
  let bookstackHits: BookStackSearchHit[] = [];
  let bookstackError: string | null = null;
  if (query && bookstackConfigured()) {
    try {
      bookstackHits = (await searchBookStack(query, 10)).filter((h) => h.type === "page");
    } catch (error) {
      bookstackError = error instanceof BookStackError ? error.message : "BookStack nicht erreichbar";
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Doku</h1>
      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={query}
          autoFocus
          placeholder="z. B. „Drucker 2. Stock“, „Gi1/0/12“, „VLAN 20“, „Backup“"
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base focus:border-brand focus:outline-none md:text-sm"
        />
        <button type="submit" className="rounded-xl bg-brand px-4 text-sm font-semibold text-white">
          Suchen
        </button>
      </form>

      {query && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-500">Im Arbeitsplatz ({hits.length})</h2>
          {hits.length === 0 ? (
            <p className="text-sm text-slate-500">Nichts gefunden.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              {hits.map((hit, i) => (
                <li key={i}>
                  <Link href={hit.href} className="block px-4 py-3 hover:bg-slate-50">
                    <span className="text-xs text-slate-500">
                      {hit.customerName} · {KIND_LABEL[hit.kind]}
                    </span>
                    <span className="block font-medium">{hit.title}</span>
                    <span className="block text-sm text-slate-600">{hit.detail}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {query && bookstackConfigured() && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-500">In BookStack ({bookstackHits.length})</h2>
          {bookstackError ? (
            <p className="text-sm text-red-700">{bookstackError}</p>
          ) : bookstackHits.length === 0 ? (
            <p className="text-sm text-slate-500">Nichts gefunden.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              {bookstackHits.map((hit) => (
                <li key={hit.id}>
                  <a href={hit.url} target="_blank" rel="noreferrer" className="block px-4 py-3 hover:bg-slate-50">
                    <span className="block font-medium">{hit.name}</span>
                    {hit.preview_html?.content && (
                      <span className="block text-sm text-slate-600">{hit.preview_html.content.replace(/<[^>]+>/g, "").slice(0, 200)}</span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!query && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-500">Dokumentation je Kunde</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {customers.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/app/kunden/${c.id}/doku`}
                  className="block rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200 hover:ring-brand"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!query && bookstackConfigured() && <BookstackMigration />}
    </div>
  );
}
