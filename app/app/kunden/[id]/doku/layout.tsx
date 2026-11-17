import { Suspense } from "react";
import { DokuNav, type DokuNavItem } from "@/components/workspace/DokuNav";
import { VaultGate } from "@/components/workspace/VaultGate";
import { RECORD_LAYOUTS } from "@/config/records";
import { requireAdmin } from "@/lib/auth";
import { bookstackConfigured } from "@/lib/bookstack";
import { countDocs } from "@/lib/workspace/docs";
import { countRecords } from "@/lib/workspace/records";

const GROUPS: Record<string, string> = {
  kontakt: "Firma",
  standort: "Firma",
  vertrag: "Firma",
  geraet: "Technik",
  wlan: "Netzwerk",
  domain: "Dienste",
  m365: "Dienste",
  anwendung: "Dienste",
  backup: "Dienste",
  lizenz: "Firma",
};

export default async function KundenDokuLayout({ children, params }: LayoutProps<"/app/kunden/[id]/doku">) {
  await requireAdmin();
  const { id } = await params;
  const [records, docs] = await Promise.all([countRecords(id), countDocs(id)]);
  const base = `/app/kunden/${id}/doku`;
  const entry = (kind: string): DokuNavItem => {
    const layout = RECORD_LAYOUTS.find((l) => l.kind === kind)!;
    return { href: `${base}/eintraege/${kind}`, label: layout.plural, count: records[kind], group: GROUPS[kind] ?? "Weitere" };
  };
  const items: DokuNavItem[] = [
    { href: base, label: "Übersicht", group: "Firma" },
    entry("kontakt"),
    entry("standort"),
    entry("vertrag"),
    entry("lizenz"),
    { href: `/app/checklisten?kunde=${id}`, label: "Checklisten", group: "Firma" },
    entry("geraet"),
    { href: `${base}?tab=schrank`, label: "Patchschrank", count: docs.schrank, group: "Technik" },
    { href: `${base}?tab=verkabelung`, label: "Verkabelung", count: docs.verkabelung, group: "Technik" },
    { href: `${base}/netzwerk`, label: "Netzplan & VLANs", group: "Netzwerk" },
    entry("wlan"),
    entry("domain"),
    entry("m365"),
    entry("anwendung"),
    entry("backup"),
    { href: `${base}?tab=seiten`, label: "Seiten", count: docs.seiten, group: "Wissen" },
    ...(bookstackConfigured() ? [{ href: `${base}?tab=bookstack`, label: "BookStack", group: "Wissen" }] : []),
  ];
  return (
    <VaultGate>
      <div className="lg:grid lg:grid-cols-[13rem_1fr] lg:gap-6">
        <Suspense>
          <DokuNav items={items} />
        </Suspense>
        <div className="min-w-0 space-y-4">{children}</div>
      </div>
    </VaultGate>
  );
}
