import "server-only";
import { workspace } from "@/config/workspace";
import { type DomainCheck } from "@/lib/checks/domain";
import { isCheckError } from "@/lib/checks/run";
import { listLearners, orgName } from "@/lib/awareness/store";
import { db } from "@/lib/db";
import { checkResults, dueRecords } from "@/lib/workspace/records";

// Alle Fristen an einem Ort: Lizenzen, Verträge (Kündigungstermin), Garantien, Domains, Backup-Tests, Zertifikate, Schulungen.

export type Deadline = {
  key: string;
  customerId: string | null;
  customerName: string;
  kind: string;
  label: string;
  title: string | null;
  dueAt: string;
  href: string;
};

export async function allDeadlines(days: number, now = new Date()): Promise<Deadline[]> {
  const until = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const items: Deadline[] = [];

  for (const r of await dueRecords(until)) {
    items.push({
      key: `record:${r.id}`,
      customerId: r.customerId,
      customerName: r.customerName,
      kind: r.kindLabel,
      label: r.dueLabel,
      title: r.title,
      dueAt: r.dueAt,
      href: `/app/kunden/${r.customerId}/doku/eintraege/${r.kind}/${r.id}`,
    });
  }

  const names = new Map(
    ((await (await db()).execute("SELECT id, name FROM customers")).rows as unknown as { id: string; name: string }[]).map((c) => [
      String(c.id),
      String(c.name),
    ]),
  );
  for (const check of await checkResults()) {
    const result = check.result && !isCheckError(check.result) ? (check.result as DomainCheck) : null;
    const validTo = result?.tls?.validTo.slice(0, 10);
    if (!validTo || validTo > until) continue;
    items.push({
      key: `cert:${check.id}`,
      customerId: check.customerId,
      customerName: names.get(check.customerId) ?? "",
      kind: "Zertifikat",
      label: "Zertifikat läuft ab",
      title: result!.tls!.host,
      dueAt: validTo,
      href: `/app/kunden/${check.customerId}/doku/eintraege/domain/${check.id}`,
    });
  }

  const orgs = await (await db()).execute("SELECT DISTINCT org FROM awareness_learners WHERE disabled_at IS NULL");
  for (const row of orgs.rows) {
    const org = String(row.org);
    const expiring = (await listLearners(org, now)).filter((l) => !l.disabled && l.validUntil && l.validUntil.slice(0, 10) <= until);
    if (!expiring.length) continue;
    const first = expiring.map((l) => l.validUntil!.slice(0, 10)).sort()[0];
    items.push({
      key: `schulung:${org}`,
      customerId: org === "intern" ? null : org,
      customerName: (await orgName(org)) ?? workspace.company,
      kind: "Schulung",
      label: "Schulung auffrischen",
      title: `${expiring.length} ${expiring.length === 1 ? "Person" : "Personen"}`,
      dueAt: first,
      href: `/app/awareness/${org}`,
    });
  }
  return items.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}
