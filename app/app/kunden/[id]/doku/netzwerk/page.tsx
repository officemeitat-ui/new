import Link from "next/link";
import { notFound } from "next/navigation";
import { NetworkEditor } from "@/components/workspace/NetworkEditor";
import { requireAdmin } from "@/lib/auth";
import { getCustomer, listDevices } from "@/lib/workspace/customers";
import { loadNetwork } from "@/lib/workspace/network";

export default async function NetzwerkPage({ params }: PageProps<"/app/kunden/[id]/doku/netzwerk">) {
  await requireAdmin();
  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const [model, ateraDevices] = await Promise.all([loadNetwork(id), listDevices(id)]);
  return (
    <div className="space-y-4">
      <Link href={`/app/kunden/${customer.id}/doku`} className="text-sm text-slate-500 hover:text-slate-900">
        ← Dokumentation {customer.name}
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Netzwerk</h1>
        <p className="text-sm text-slate-500">Plan, Netze und Verbindungen – die Prüfung läuft sofort mit, während du einträgst.</p>
      </div>
      <NetworkEditor customerId={customer.id} initial={model} ateraDevices={ateraDevices.map((d) => ({ name: d.name, os: d.os }))} />
    </div>
  );
}
