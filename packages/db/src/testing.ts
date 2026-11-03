import pg from "pg";
import { createDatabase, type DatabaseHandle } from "./client";
import { runMigrations } from "./migrations";

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgres://nexus:nexus@localhost:5432/nexus_test";

/**
 * Resets the test database and applies all migrations once per test run.
 * The test role must not be a superuser, otherwise Row Level Security would be bypassed.
 */
export async function resetTestDatabase(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
    );
    if (rows[0]?.rolsuper || rows[0]?.rolbypassrls) {
      throw new Error(
        "Die Test-Datenbankrolle darf weder SUPERUSER noch BYPASSRLS haben – sonst greift RLS nicht.",
      );
    }
    // Drops everything this role created (tables, functions, the drizzle schema),
    // but keeps extensions such as pgvector that the superuser installed.
    await client.query("DROP OWNED BY CURRENT_USER CASCADE");
  } finally {
    await client.end();
  }
  await runMigrations(TEST_DATABASE_URL);
}

export function openTestDatabase(): DatabaseHandle {
  return createDatabase(TEST_DATABASE_URL, { max: 4 });
}
