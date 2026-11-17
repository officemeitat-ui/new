import "server-only";
import { DEFAULT_SERVICES, type PackageId, PACKAGES } from "@/config/services";
import { db } from "@/lib/db";

// Leistungskatalog und gebuchte Leistungen je Kunde (daraus der monatliche wiederkehrende Umsatz, MRR).

export type Service = {
  code: string;
  name: string;
  description: string;
  unit: string;
  price: number;
  recurring: boolean;
  keywords: string;
  active: boolean;
};

export type BookedService = {
  code: string;
  name: string;
  unit: string;
  quantity: number;
  price: number;
  recurring: boolean;
  monthly: number;
};

export type ContractProfile = {
  industry: string | null;
  employees: number | null;
  package: PackageId;
  contractEnd: string | null;
};

const toService = (r: Record<string, unknown>): Service => ({
  code: String(r.code),
  name: String(r.name),
  description: String(r.description),
  unit: String(r.unit),
  price: Number(r.price_cents) / 100,
  recurring: Boolean(r.recurring),
  keywords: String(r.keywords ?? ""),
  active: Boolean(r.active),
});

/** Fehlende Katalog-Leistungen anlegen (angepasste Preise bleiben unverändert). */
export async function ensureServices(now = new Date()) {
  const client = await db();
  for (const s of DEFAULT_SERVICES) {
    await client.execute({
      sql: `INSERT OR IGNORE INTO services (code, name, description, unit, price_cents, recurring, keywords, active, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      args: [s.code, s.name, s.description, s.unit, Math.round(s.price * 100), s.recurring ? 1 : 0, s.keywords, now.toISOString()],
    });
  }
}

export async function listServices(includeInactive = false): Promise<Service[]> {
  await ensureServices();
  const result = await (
    await db()
  ).execute(`SELECT * FROM services${includeInactive ? "" : " WHERE active = 1"} ORDER BY recurring DESC, name`);
  return result.rows.map((r) => toService(r as Record<string, unknown>));
}

export async function serviceMap(): Promise<Map<string, Service>> {
  return new Map((await listServices(true)).map((s) => [s.code, s]));
}

export async function updateService(
  code: string,
  fields: { price?: number; active?: boolean; name?: string; description?: string },
  now = new Date(),
) {
  const client = await db();
  if (fields.price !== undefined) {
    if (!Number.isFinite(fields.price) || fields.price < 0) throw new Error("Ungültiger Preis");
    await client.execute({
      sql: "UPDATE services SET price_cents = ?, updated_at = ? WHERE code = ?",
      args: [Math.round(fields.price * 100), now.toISOString(), code],
    });
  }
  if (fields.active !== undefined) {
    await client.execute({
      sql: "UPDATE services SET active = ?, updated_at = ? WHERE code = ?",
      args: [fields.active ? 1 : 0, now.toISOString(), code],
    });
  }
  if (fields.name) await client.execute({ sql: "UPDATE services SET name = ? WHERE code = ?", args: [fields.name.trim(), code] });
  if (fields.description)
    await client.execute({ sql: "UPDATE services SET description = ? WHERE code = ?", args: [fields.description.trim(), code] });
}

// ── Vertrag und gebuchte Leistungen ──

export async function contractProfile(customerId: string): Promise<ContractProfile> {
  const result = await (
    await db()
  ).execute({ sql: "SELECT industry, employees, package, contract_end FROM customers WHERE id = ?", args: [customerId] });
  const r = result.rows[0];
  const pkg = String(r?.package ?? "keins");
  return {
    industry: (r?.industry as string | null) ?? null,
    employees: r?.employees === null || r?.employees === undefined ? null : Number(r.employees),
    package: (pkg in PACKAGES ? pkg : "keins") as PackageId,
    contractEnd: (r?.contract_end as string | null) ?? null,
  };
}

export async function saveContractProfile(customerId: string, profile: ContractProfile) {
  if (profile.employees !== null && (!Number.isInteger(profile.employees) || profile.employees < 0 || profile.employees > 100_000)) {
    throw new Error("Mitarbeiterzahl ungültig");
  }
  if (profile.contractEnd && !/^\d{4}-\d{2}-\d{2}$/.test(profile.contractEnd)) throw new Error("Vertragsende bitte als Datum");
  await (
    await db()
  ).execute({
    sql: "UPDATE customers SET industry = ?, employees = ?, package = ?, contract_end = ? WHERE id = ?",
    args: [profile.industry || null, profile.employees, profile.package, profile.contractEnd || null, customerId],
  });
}

export async function bookedServices(customerId: string): Promise<BookedService[]> {
  const services = await serviceMap();
  const result = await (await db()).execute({ sql: "SELECT * FROM customer_services WHERE customer_id = ?", args: [customerId] });
  return result.rows
    .map((r) => {
      const service = services.get(String(r.code));
      const price = r.price_cents !== null && r.price_cents !== undefined ? Number(r.price_cents) / 100 : (service?.price ?? 0);
      const quantity = Number(r.quantity);
      return {
        code: String(r.code),
        name: service?.name ?? String(r.code),
        unit: service?.unit ?? "",
        quantity,
        price,
        recurring: service?.recurring ?? false,
        monthly: service?.recurring ? Math.round(quantity * price * 100) / 100 : 0,
      };
    })
    .sort((a, b) => b.monthly - a.monthly);
}

/** Leistung buchen bzw. Menge ändern (0 = entfernen). */
export async function setBookedService(
  customerId: string,
  code: string,
  quantity: number,
  priceOverride: number | null = null,
  now = new Date(),
) {
  const client = await db();
  if (quantity <= 0) {
    await client.execute({ sql: "DELETE FROM customer_services WHERE customer_id = ? AND code = ?", args: [customerId, code] });
    return;
  }
  await client.execute({
    sql: `INSERT INTO customer_services (customer_id, code, quantity, price_cents, since) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(customer_id, code) DO UPDATE SET quantity = excluded.quantity, price_cents = excluded.price_cents`,
    args: [customerId, code, quantity, priceOverride === null ? null : Math.round(priceOverride * 100), now.toISOString().slice(0, 10)],
  });
}

/** MRR je Kunde (nur wiederkehrende Leistungen). */
export async function mrrByCustomer(): Promise<Map<string, number>> {
  const services = await serviceMap();
  const result = await (await db()).execute("SELECT * FROM customer_services");
  const totals = new Map<string, number>();
  for (const r of result.rows) {
    const service = services.get(String(r.code));
    if (!service?.recurring) continue;
    const price = r.price_cents !== null && r.price_cents !== undefined ? Number(r.price_cents) / 100 : service.price;
    totals.set(String(r.customer_id), (totals.get(String(r.customer_id)) ?? 0) + Number(r.quantity) * price);
  }
  return totals;
}

export const eur = (value: number, digits = 2) =>
  new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
