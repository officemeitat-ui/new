import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
/** A transaction handle. All tenant-scoped work happens inside one (see context.ts). */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export function createDatabase(url: string, options: { max?: number } = {}): DatabaseHandle {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  const db = drizzle({ client: pool, schema, casing: "snake_case" });
  return { db, pool, close: () => pool.end() };
}

const globalForDb = globalThis as unknown as { __nexusDb?: DatabaseHandle };

/**
 * Process-wide database handle. Kept on globalThis so Next.js hot reloads in development
 * do not open a new pool on every change.
 */
export function getDatabase(url: string = requireDatabaseUrl()): DatabaseHandle {
  globalForDb.__nexusDb ??= createDatabase(url);
  return globalForDb.__nexusDb;
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ist nicht gesetzt (siehe .env.example).");
  return url;
}
