import "server-only";
import { db } from "@/lib/db";
import { emptyModel, NetworkModelSchema, type NetworkModel } from "@/lib/network/model";
import { docKey, seal, unseal } from "@/lib/workspace/vault";

export { emptyModel };

// Netzwerkdokumentation je Kunde – als ein verschlüsseltes Dokument gespeichert (WAN, Netze, Geräte, Verbindungen).

export async function loadNetwork(customerId: string): Promise<NetworkModel> {
  const key = await docKey();
  const client = await db();
  const row = (await client.execute({ sql: "SELECT data FROM network_models WHERE customer_id = ?", args: [customerId] })).rows[0];
  if (!row) return emptyModel();
  const parsed = NetworkModelSchema.safeParse(JSON.parse(unseal(key, row.data) ?? "{}"));
  return parsed.success ? parsed.data : emptyModel();
}

export async function saveNetwork(customerId: string, model: unknown, now = new Date()): Promise<NetworkModel> {
  const parsed = NetworkModelSchema.parse(model);
  // Verbindungen zu gelöschten Geräten und Verweise auf gelöschte Netze aufräumen
  const deviceIds = new Set(parsed.devices.map((d) => d.id));
  const networkIds = new Set(parsed.networks.map((n) => n.id));
  const clean: NetworkModel = {
    ...parsed,
    wan: { ...parsed.wan, firewallId: parsed.wan.firewallId && deviceIds.has(parsed.wan.firewallId) ? parsed.wan.firewallId : undefined },
    devices: parsed.devices.map((d) => ({ ...d, networkId: d.networkId && networkIds.has(d.networkId) ? d.networkId : undefined })),
    links: parsed.links
      .filter((l) => deviceIds.has(l.from) && deviceIds.has(l.to))
      .map((l) => ({
        ...l,
        untagged: l.untagged && networkIds.has(l.untagged) ? l.untagged : undefined,
        tagged: (l.tagged ?? []).filter((id) => networkIds.has(id)),
      })),
  };
  const key = await docKey();
  const client = await db();
  await client.execute({
    sql: `INSERT INTO network_models (customer_id, data, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(customer_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    args: [customerId, seal(key, JSON.stringify(clean)), now.toISOString()],
  });
  return clean;
}
