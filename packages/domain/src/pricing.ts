import type { ModelPrice } from "@nexus/agents";
import { validationError } from "@nexus/core";
import { asc, eq, sql, type Database, type Tx } from "@nexus/db";
import { partners, priceTables } from "@nexus/db/schema";

/** Prices valid at `at` (latest valid_from ≤ at per model), keyed by model ID. */
export async function loadCurrentPrices(
  db: Database,
  at: Date = new Date(),
): Promise<Record<string, ModelPrice>> {
  const rows = await db
    .selectDistinctOn([priceTables.model], {
      model: priceTables.model,
      inputPerMTok: priceTables.inputPerMTok,
      outputPerMTok: priceTables.outputPerMTok,
      cacheReadPerMTok: priceTables.cacheReadPerMTok,
      cacheWritePerMTok: priceTables.cacheWritePerMTok,
    })
    .from(priceTables)
    .where(sql`${priceTables.validFrom} <= ${at.toISOString()}`)
    .orderBy(asc(priceTables.model), sql`${priceTables.validFrom} desc`);
  return Object.fromEntries(
    rows.map((row) => [
      row.model,
      {
        inputPerMTok: row.inputPerMTok,
        outputPerMTok: row.outputPerMTok,
        cacheReadPerMTok: row.cacheReadPerMTok,
        cacheWritePerMTok: row.cacheWritePerMTok,
      },
    ]),
  );
}

/**
 * EUR per USD for showing and billing costs in euros. Set by the partner (it bills its
 * customers in euros, possibly with a currency buffer); null means "show US dollars".
 */
export async function updatePartnerExchangeRate(
  tx: Tx,
  input: { partnerId: string; usdEurRate: number | null },
): Promise<void> {
  const rate = input.usdEurRate;
  if (rate !== null && !(Number.isFinite(rate) && rate > 0.1 && rate < 10)) {
    throw validationError("Bitte einen Kurs zwischen 0,1 und 10 angeben (Euro pro US-Dollar).");
  }
  await tx
    .update(partners)
    .set({ usdEurRate: rate === null ? null : Math.round(rate * 1e6) / 1e6 })
    .where(eq(partners.id, input.partnerId));
}
