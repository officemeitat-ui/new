import Link from "next/link";
import { notFound } from "next/navigation";
import { Poster } from "@/components/awareness/Poster";
import { PrintButtons } from "@/components/awareness/PrintButton";
import { requireAdmin } from "@/lib/auth";
import { fillPlaceholders, orgContacts, orgName } from "@/lib/awareness/store";

export default async function AushangPage({ params }: PageProps<"/app/awareness/[org]/aushang">) {
  await requireAdmin();
  const { org } = await params;
  const name = await orgName(org);
  if (!name) notFound();
  const contacts = await orgContacts(org);
  return (
    <div className="space-y-4">
      <PrintButtons />
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/app/awareness/${org}`} className="text-sm text-slate-500 hover:text-slate-900">
          ← {name}
        </Link>
        <button type="button" data-print className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
          Drucken
        </button>
      </div>
      <Poster fill={(text) => fillPlaceholders(text, name, contacts)} />
    </div>
  );
}
