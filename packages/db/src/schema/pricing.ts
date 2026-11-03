import { numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id } from "./_columns";

/**
 * Model prices in USD per million tokens with a validity date (ADR 0006). Global reference
 * data, not tenant data: no tenant_id and no RLS. Only migrations and system jobs write here.
 */
export const priceTables = pgTable(
  "price_tables",
  {
    id: id(),
    model: text().notNull(),
    inputPerMTok: numeric({ precision: 12, scale: 6, mode: "number" }).notNull(),
    outputPerMTok: numeric({ precision: 12, scale: 6, mode: "number" }).notNull(),
    cacheReadPerMTok: numeric({ precision: 12, scale: 6, mode: "number" }).notNull(),
    cacheWritePerMTok: numeric({ precision: 12, scale: 6, mode: "number" }).notNull(),
    validFrom: timestamp({ withTimezone: true }).notNull(),
    source: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("price_tables_model_valid_from_uq").on(t.model, t.validFrom)],
);
