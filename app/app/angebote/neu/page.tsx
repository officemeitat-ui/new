import Link from "next/link";
import { NewQuoteForm } from "@/components/workspace/QuoteUI";
import { requireAdmin } from "@/lib/auth";
import { listServices } from "@/lib/workspace/catalog";
import { listCustomers } from "@/lib/workspace/customers";

export default async function NeuesAngebotPage({ searchParams }: PageProps<"/app/angebote/neu">) {
  await requireAdmin();
  const { kunde, bedarf, leistung } = await searchParams;
  const [customers, services] = await Promise.all([listCustomers(), listServices()]);
  return (
    <div className="space-y-4">
      <Link href="/app/angebote" className="text-sm text-slate-500 hover:text-slate-900">
        ← Angebote
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Neues Angebot</h1>
        <p className="text-sm text-slate-500">
          Claude wählt passende Leistungen aus dem Katalog und schreibt den Text. Preise und Summen rechnet der Arbeitsplatz selbst.
        </p>
      </div>
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <NewQuoteForm
          customers={customers.map((c) => ({ id: c.id, name: c.name }))}
          services={services.map((s) => ({ code: s.code, name: s.name, recurring: s.recurring }))}
          customerId={typeof kunde === "string" ? kunde : undefined}
          need={typeof bedarf === "string" ? bedarf : undefined}
          codes={typeof leistung === "string" ? [leistung] : Array.isArray(leistung) ? leistung : []}
        />
      </section>
    </div>
  );
}
