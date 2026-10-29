import "server-only";
import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import path from "node:path";

// Lokal eine SQLite-Datei, in Produktion z. B. Turso (DATABASE_URL=libsql://…).
const url = process.env.DATABASE_URL || "file:data/app.db";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    funnel TEXT NOT NULL,
    stage TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    company TEXT,
    link TEXT,
    message TEXT,
    answers TEXT NOT NULL,
    score INTEGER NOT NULL,
    qualified INTEGER NOT NULL,
    value INTEGER,
    source TEXT,
    briefing TEXT,
    followup TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_leads_funnel_stage ON leads(funnel, stage)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_activities_lead ON activities(lead_id, created_at)`,
];

const globalForDb = globalThis as unknown as { dbReady?: Promise<Client> };

async function init(): Promise<Client> {
  if (url.startsWith("file:")) {
    mkdirSync(path.dirname(url.slice("file:".length)), { recursive: true });
  }
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
  await client.execute("PRAGMA foreign_keys = ON");
  await client.batch(SCHEMA, "write");
  return client;
}

/** Liefert den Datenbank-Client; das Schema wird beim ersten Zugriff angelegt. */
export function db(): Promise<Client> {
  globalForDb.dbReady ??= init().catch((error) => {
    globalForDb.dbReady = undefined;
    throw error;
  });
  return globalForDb.dbReady;
}
