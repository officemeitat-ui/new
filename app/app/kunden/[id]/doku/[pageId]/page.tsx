import Link from "next/link";
import { notFound } from "next/navigation";
import { removeDocPage } from "@/app/app/doku-actions";
import { PageEditor } from "@/components/workspace/DocsUI";
import { requireAdmin } from "@/lib/auth";
import { getCustomer } from "@/lib/workspace/customers";
import { getPage, looksLikeSecret } from "@/lib/workspace/docs";
import { renderMarkdown } from "@/lib/workspace/markdown";

export default async function DokuSeitePage({ params, searchParams }: PageProps<"/app/kunden/[id]/doku/[pageId]">) {
  await requireAdmin();
  const { id, pageId } = await params;
  const { bearbeiten } = await searchParams;
  const [customer, page] = await Promise.all([getCustomer(id), getPage(pageId)]);
  if (!customer || !page || page.customerId !== customer.id) notFound();
  const editing = bearbeiten === "1";

  return (
    <div className="space-y-4">
      <Link href={`/app/kunden/${customer.id}/doku`} className="text-sm text-slate-500 hover:text-slate-900">
        ← Dokumentation {customer.name}
      </Link>

      {editing ? (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          {page.format === "html" && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Diese Seite kam als HTML aus BookStack. Beim Speichern wird sie zu Markdown – die Formatierung kann sich ändern.
            </p>
          )}
          <PageEditor page={{ id: page.id, title: page.title, content: page.content }} />
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
            <Link href={`/app/kunden/${customer.id}/doku/${page.id}`} className="text-sm text-slate-500 hover:text-slate-900">
              Fertig – Ansicht
            </Link>
            <form action={removeDocPage}>
              <input type="hidden" name="id" value={page.id} />
              <button type="submit" className="text-sm text-red-600 hover:underline">
                Seite löschen
              </button>
            </form>
          </div>
        </section>
      ) : (
        <article className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 md:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-2xl font-bold">{page.title}</h1>
            <Link
              href={`/app/kunden/${customer.id}/doku/${page.id}?bearbeiten=1`}
              className="text-sm font-medium text-brand hover:underline"
            >
              Bearbeiten
            </Link>
          </div>
          {looksLikeSecret(page.content) && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Auf dieser Seite steht anscheinend ein Passwort. Bitte nach Keeper verschieben und hier nur darauf verweisen.
            </p>
          )}
          {page.format === "html" ? (
            // HTML aus BookStack abgeschottet anzeigen: keine Skripte, kein Zugriff auf die App.
            <iframe
              title={page.title}
              sandbox=""
              srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;line-height:1.6;color:#0f172a;margin:0}table{border-collapse:collapse}td,th{border:1px solid #e2e8f0;padding:.3rem .5rem}img{max-width:100%}</style>${page.content}`}
              className="mt-4 h-[70vh] w-full rounded-lg ring-1 ring-slate-200"
            />
          ) : (
            <div className="doc-content mt-4" dangerouslySetInnerHTML={{ __html: renderMarkdown(page.content) }} />
          )}
        </article>
      )}
    </div>
  );
}
