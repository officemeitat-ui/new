import Link from "next/link";
import { notFound } from "next/navigation";
import { removePatchPort, removeRack, removeRackEntry } from "@/app/app/doku-actions";
import {
  BookstackPanel,
  NewPageForm,
  PatchImportForm,
  PatchPortForm,
  PatchTable,
  RackForm,
  RackItemForm,
} from "@/components/workspace/DocsUI";
import { requireAdmin } from "@/lib/auth";
import { bookstackConfigured, BookStackError, bookstackUrl, listBookPages, listBooks, type BookStackBook } from "@/lib/bookstack";
import { getCustomer } from "@/lib/workspace/customers";
import { listPages, listPorts, listRacks, PAGE_TEMPLATES, PATCH_FIELDS, RACK_ITEM_KINDS, type Rack } from "@/lib/workspace/docs";
import { shortDate } from "@/lib/workspace/format";

const TABS = [
  { id: "netzwerk", label: "Netzwerk" },
  { id: "seiten", label: "Seiten" },
  { id: "schrank", label: "Patchschrank" },
  { id: "verkabelung", label: "Verkabelung" },
  { id: "bookstack", label: "BookStack" },
];

const KIND_COLOR: Record<string, string> = {
  patchpanel: "bg-slate-200 text-slate-800",
  switch: "bg-sky-100 text-sky-900",
  router: "bg-indigo-100 text-indigo-900",
  firewall: "bg-red-100 text-red-900",
  server: "bg-emerald-100 text-emerald-900",
  nas: "bg-teal-100 text-teal-900",
  usv: "bg-amber-100 text-amber-900",
  ablage: "bg-stone-100 text-stone-700",
  kabelfuehrung: "bg-slate-100 text-slate-500",
  sonstiges: "bg-violet-100 text-violet-900",
};

/** Schrankansicht von oben (höchste HE) nach unten. */
function RackView({ rack }: { rack: Rack }) {
  const rows: React.ReactNode[] = [];
  for (let unit = rack.units; unit >= 1; ) {
    const item = rack.items.find((i) => i.unitStart + i.unitHeight - 1 === unit);
    if (item) {
      rows.push(
        <div key={unit} className="flex" style={{ height: `${item.unitHeight * 1.75}rem` }}>
          <span className="flex w-8 shrink-0 flex-col justify-between py-0.5 text-right text-[10px] text-slate-400 tabular-nums">
            <span>{unit}</span>
            {item.unitHeight > 1 && <span>{item.unitStart}</span>}
          </span>
          <div
            className={`ml-2 flex min-w-0 flex-1 items-center gap-2 rounded px-2 text-xs ring-1 ring-black/5 ${KIND_COLOR[item.kind] ?? KIND_COLOR.sonstiges}`}
          >
            <span className="shrink-0 font-semibold">{item.name}</span>
            <span className="min-w-0 truncate opacity-70">{[item.model, item.ip].filter(Boolean).join(" · ")}</span>
          </div>
        </div>,
      );
      unit -= item.unitHeight;
    } else {
      rows.push(
        <div key={unit} className="flex h-7">
          <span className="w-8 shrink-0 pt-1 text-right text-[10px] text-slate-300 tabular-nums">{unit}</span>
          <div className="ml-2 flex-1 border-b border-dashed border-slate-200" />
        </div>,
      );
      unit -= 1;
    }
  }
  return <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">{rows}</div>;
}

/** Niedrigste freie Höheneinheit als Vorschlag für das nächste Gerät. */
function nextFreeUnit(rack: Rack): number {
  for (let unit = 1; unit <= rack.units; unit++) {
    if (!rack.items.some((i) => unit >= i.unitStart && unit < i.unitStart + i.unitHeight)) return unit;
  }
  return 1;
}

export default async function KundenDokuPage({ params, searchParams }: PageProps<"/app/kunden/[id]/doku">) {
  await requireAdmin();
  const { id } = await params;
  const { tab: tabParam, bearbeiten } = await searchParams;
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const tab = TABS.find((t) => t.id === tabParam)?.id ?? "seiten";
  const [pages, racks, ports] = await Promise.all([listPages(id), listRacks(id), listPorts(id)]);
  const editing = typeof bearbeiten === "string" ? ports.find((p) => p.id === bearbeiten) : undefined;

  let books: BookStackBook[] = [];
  let bookPages: { id: number; name: string; slug: string }[] = [];
  let bookstackError: string | null = null;
  if (tab === "bookstack" && bookstackConfigured()) {
    try {
      books = await listBooks();
      if (customer.bookstackBookId) bookPages = await listBookPages(customer.bookstackBookId);
    } catch (error) {
      bookstackError = error instanceof BookStackError ? error.message : "BookStack nicht erreichbar";
    }
  }
  const linkedBook = books.find((b) => String(b.id) === customer.bookstackBookId);
  const counts: Record<string, number> = { seiten: pages.length, schrank: racks.length, verkabelung: ports.length };

  return (
    <div className="space-y-4">
      <Link href={`/app/kunden/${customer.id}`} className="text-sm text-slate-500 hover:text-slate-900">
        ← {customer.name}
      </Link>
      <h1 className="text-2xl font-bold">Dokumentation</h1>

      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 text-sm font-medium">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === "netzwerk" ? `/app/kunden/${customer.id}/doku/netzwerk` : `/app/kunden/${customer.id}/doku?tab=${t.id}`}
            className={`rounded-full px-3 py-1.5 whitespace-nowrap ${t.id === tab ? "bg-brand text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
          >
            {t.label}
            {counts[t.id] ? <span className="ml-1 opacity-70">{counts[t.id]}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "seiten" && (
        <div className="space-y-4">
          {pages.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
              Noch keine Seiten. Mit einer Vorlage anfangen – oder Seiten aus BookStack übernehmen.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              {pages.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/app/kunden/${customer.id}/doku/${p.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                  >
                    <span className="min-w-0 truncate font-medium">{p.title}</span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {p.source === "bookstack" ? "aus BookStack · " : ""}
                      {shortDate(p.updatedAt.slice(0, 10))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-3 font-semibold">Neue Seite</h2>
            <NewPageForm customerId={customer.id} templates={Object.keys(PAGE_TEMPLATES)} />
          </section>
        </div>
      )}

      {tab === "schrank" && (
        <div className="space-y-4">
          {racks.map((rack) => (
            <section key={rack.id} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">
                  {rack.name}
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    {[rack.location, `${rack.units} HE`, `${rack.items.reduce((sum, i) => sum + i.unitHeight, 0)} belegt`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </h2>
                <form action={removeRack}>
                  <input type="hidden" name="id" value={rack.id} />
                  <input type="hidden" name="customerId" value={customer.id} />
                  <button type="submit" className="text-xs text-slate-400 hover:text-red-600">
                    Schrank löschen
                  </button>
                </form>
              </div>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr] [&>*]:min-w-0">
                <RackView rack={rack} />
                <div className="space-y-3">
                  {rack.items.length > 0 && (
                    <ul className="divide-y divide-slate-100 text-sm">
                      {rack.items.map((item) => (
                        <li key={item.id} className="flex items-start gap-3 py-2">
                          <span className="w-14 shrink-0 text-xs text-slate-500 tabular-nums">
                            HE {item.unitStart}
                            {item.unitHeight > 1 && `–${item.unitStart + item.unitHeight - 1}`}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{item.name}</span>
                            <span className="block text-xs text-slate-500">
                              {[RACK_ITEM_KINDS[item.kind], item.model, item.ip, item.notes].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          <form action={removeRackEntry}>
                            <input type="hidden" name="id" value={item.id} />
                            <input type="hidden" name="customerId" value={customer.id} />
                            <button type="submit" className="text-xs text-slate-400 hover:text-red-600">
                              Ausbauen
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="mb-3 text-sm font-medium">Gerät einbauen</p>
                    <RackItemForm
                      customerId={customer.id}
                      rackId={rack.id}
                      kinds={Object.entries(RACK_ITEM_KINDS)}
                      freeUnit={nextFreeUnit(rack)}
                    />
                  </div>
                </div>
              </div>
            </section>
          ))}
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-3 font-semibold">{racks.length ? "Weiteren Schrank anlegen" : "Patchschrank anlegen"}</h2>
            <RackForm customerId={customer.id} />
          </section>
        </div>
      )}

      {tab === "verkabelung" && (
        <div className="space-y-4">
          {ports.length > 0 && (
            <div className="flex justify-end">
              <a
                href={`/app/kunden/${customer.id}/doku/export`}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
              >
                Patchliste als CSV
              </a>
            </div>
          )}
          {ports.length > 0 ? (
            <PatchTable customerId={customer.id} ports={ports} fields={PATCH_FIELDS} onDelete={removePatchPort} />
          ) : (
            <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
              Noch keine Anschlüsse. Einzeln erfassen oder die bestehende Excel-Liste übernehmen.
            </p>
          )}
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-3 font-semibold">{editing ? "Anschluss bearbeiten" : "Anschluss hinzufügen"}</h2>
            <PatchPortForm key={editing?.id ?? "neu"} customerId={customer.id} fields={PATCH_FIELDS} port={editing} />
          </section>
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-3 font-semibold">Liste aus Excel übernehmen</h2>
            <PatchImportForm customerId={customer.id} />
          </section>
        </div>
      )}

      {tab === "bookstack" && (
        <div className="space-y-4">
          {!bookstackConfigured() ? (
            <p className="rounded-2xl bg-white p-4 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
              BookStack ist nicht verbunden. In der Konfiguration <code>BOOKSTACK_URL</code>, <code>BOOKSTACK_TOKEN_ID</code> und{" "}
              <code>BOOKSTACK_TOKEN_SECRET</code> setzen (API-Token im BookStack-Profil anlegen).
            </p>
          ) : bookstackError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{bookstackError}</p>
          ) : (
            <>
              <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h2 className="mb-1 font-semibold">Verknüpfung</h2>
                <p className="mb-3 text-sm text-slate-600">
                  Die Verkabelung (Schränke und Patchliste) wird als Seite „Verkabelung und Patchschrank“ in das Buch geschrieben – gepflegt
                  wird sie hier. Bestehende Seiten lassen sich in den Arbeitsplatz übernehmen und dann auch am Handy lesen und durchsuchen.
                </p>
                <BookstackPanel
                  customerId={customer.id}
                  books={books.map((b) => ({ id: b.id, name: b.name }))}
                  linkedBookId={customer.bookstackBookId}
                  hasPublished={Boolean(customer.bookstackPageId)}
                />
              </section>
              {linkedBook && (
                <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                  <div className="mb-3 flex items-baseline justify-between gap-3">
                    <h2 className="font-semibold">{linkedBook.name}</h2>
                    <a
                      href={bookstackUrl(`/books/${linkedBook.slug}`)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-brand hover:underline"
                    >
                      In BookStack öffnen
                    </a>
                  </div>
                  {bookPages.length === 0 ? (
                    <p className="text-sm text-slate-500">Das Buch hat noch keine Seiten.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {bookPages.map((p) => (
                        <li key={p.id}>
                          <a
                            href={bookstackUrl(`/books/${linkedBook.slug}/page/${p.slug}`)}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-brand hover:underline"
                          >
                            {p.name}
                          </a>
                          {String(p.id) === customer.bookstackPageId && (
                            <span className="ml-2 text-xs text-slate-500">(aus dem Arbeitsplatz)</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
