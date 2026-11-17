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
    email TEXT,
    phone TEXT,
    company TEXT,
    link TEXT,
    message TEXT,
    answers TEXT NOT NULL,
    score INTEGER,
    qualified INTEGER,
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
  `CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    status TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    notes TEXT,
    lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
    phone TEXT,
    started_at TEXT,
    ended_at TEXT,
    duration_seconds INTEGER,
    ended_reason TEXT,
    summary TEXT,
    transcript TEXT,
    recording_url TEXT,
    cost REAL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    message_id TEXT UNIQUE,
    lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
    from_address TEXT NOT NULL,
    from_name TEXT,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    received_at TEXT NOT NULL,
    category TEXT,
    summary TEXT,
    status TEXT NOT NULL,
    reply_subject TEXT,
    reply_body TEXT,
    error TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    contact TEXT NOT NULL,
    contact_name TEXT,
    lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
    mode TEXT NOT NULL,
    last_inbound_at TEXT,
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(channel, contact)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    external_id TEXT UNIQUE,
    delivery_error TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    email_id TEXT REFERENCES emails(id) ON DELETE SET NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    file_name TEXT,
    content_type TEXT,
    size INTEGER,
    sha256 TEXT UNIQUE,
    content BLOB,
    doc_type TEXT,
    supplier TEXT,
    invoice_number TEXT,
    invoice_date TEXT,
    due_date TEXT,
    gross_cents INTEGER,
    net_cents INTEGER,
    vat_cents INTEGER,
    currency TEXT,
    paid INTEGER,
    description TEXT,
    month TEXT NOT NULL,
    note TEXT,
    exported_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_month ON receipts(month, invoice_date)`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_email ON receipts(email_id)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_funnel_stage ON leads(funnel, stage)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)`,
  `CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_at)`,
  `CREATE INDEX IF NOT EXISTS idx_calls_created ON calls(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status, received_at)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_activities_lead ON activities(lead_id, created_at)`,
];

// Spalten, die nach der ersten Version dazugekommen sind. Bestehende Datenbanken werden beim Start ergänzt.
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: "appointments", column: "external_id", definition: "TEXT" },
  { table: "appointments", column: "sync_error", definition: "TEXT" },
  { table: "appointments", column: "confirmation_sent_at", definition: "TEXT" },
  { table: "appointments", column: "confirmation_channel", definition: "TEXT" },
  { table: "appointments", column: "reminder_sent_at", definition: "TEXT" },
  { table: "appointments", column: "reminder_channel", definition: "TEXT" },
  { table: "appointments", column: "notify_error", definition: "TEXT" },
  { table: "emails", column: "kind", definition: "TEXT NOT NULL DEFAULT 'eingang'" },
  { table: "emails", column: "thread_message_id", definition: "TEXT" },
  { table: "emails", column: "external_id", definition: "TEXT" },
  { table: "emails", column: "conversation_id", definition: "TEXT" },
  { table: "emails", column: "draft_id", definition: "TEXT" },
  { table: "emails", column: "draft_created_at", definition: "TEXT" },
  { table: "emails", column: "filed_to", definition: "TEXT" },
];

async function addMissingColumns(client: Client): Promise<void> {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const info = await client.execute(`PRAGMA table_info(${table})`);
    if (!info.rows.some((row) => row.name === column)) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

const globalForDb = globalThis as unknown as { dbReady?: Promise<Client> };

async function init(): Promise<Client> {
  if (url.startsWith("file:")) {
    mkdirSync(path.dirname(url.slice("file:".length)), { recursive: true });
  }
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
  await client.execute("PRAGMA foreign_keys = ON");
  await client.batch(SCHEMA, "write");
  await addMissingColumns(client);
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
