"""SQLite-Datenbank: Schema und kleine Hilfsfunktionen (keine ORM-Abhängigkeit)."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    industry TEXT DEFAULT '',
    employees INTEGER DEFAULT 0,
    package TEXT DEFAULT 'keins',
    mrr REAL DEFAULT 0,
    contract_end TEXT DEFAULT '',
    booked_services TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'neu',
    priority TEXT DEFAULT 'normal',
    category TEXT DEFAULT '',
    solution TEXT DEFAULT '',
    ai_suggestion TEXT DEFAULT '',
    time_spent_min INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'pc',
    os TEXT DEFAULT '',
    serial TEXT DEFAULT '',
    purchase_date TEXT DEFAULT '',
    warranty_end TEXT DEFAULT '',
    last_seen TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kb_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    embedding TEXT DEFAULT '',
    embedding_model TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    unit TEXT DEFAULT 'Pauschal',
    price REAL DEFAULT 0,
    recurring INTEGER DEFAULT 0,
    keywords TEXT DEFAULT '',
    active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    need TEXT DEFAULT '',
    items TEXT DEFAULT '[]',
    total_once REAL DEFAULT 0,
    total_monthly REAL DEFAULT 0,
    text TEXT DEFAULT '',
    status TEXT DEFAULT 'entwurf',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    answers TEXT DEFAULT '{}',
    score REAL DEFAULT 0,
    level TEXT DEFAULT '',
    report TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    provider TEXT DEFAULT '',
    input TEXT DEFAULT '',
    output TEXT DEFAULT '',
    ok INTEGER DEFAULT 1,
    duration_ms INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT DEFAULT 'manuell',
    direction TEXT DEFAULT 'in',
    external_id TEXT DEFAULT '',
    from_name TEXT DEFAULT '',
    from_email TEXT DEFAULT '',
    to_email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    company TEXT DEFAULT '',
    subject TEXT DEFAULT '',
    body TEXT DEFAULT '',
    attachments TEXT DEFAULT '[]',
    category TEXT DEFAULT '',
    status TEXT DEFAULT 'neu',
    ai_result TEXT DEFAULT '',
    draft_reply TEXT DEFAULT '',
    note TEXT DEFAULT '',
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    linked_type TEXT DEFAULT '',
    linked_id INTEGER,
    reply_to_id INTEGER,
    sent_at TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT DEFAULT '',
    company TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    source TEXT DEFAULT '',
    need TEXT DEFAULT '',
    stage TEXT DEFAULT 'neu',
    score INTEGER DEFAULT 0,
    qualification TEXT DEFAULT '{}',
    notes TEXT DEFAULT '',
    followups INTEGER DEFAULT 0,
    last_contact_at TEXT DEFAULT '',
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    vendor TEXT DEFAULT '',
    invoice_no TEXT DEFAULT '',
    invoice_date TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'EUR',
    category TEXT DEFAULT '',
    status TEXT DEFAULT 'offen',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mrr_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    customer_name TEXT DEFAULT '',
    old_mrr REAL DEFAULT 0,
    new_mrr REAL DEFAULT 0,
    reason TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS qbrs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    period TEXT DEFAULT '',
    health_score INTEGER DEFAULT 0,
    text TEXT DEFAULT '',
    next_steps TEXT DEFAULT '[]',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT DEFAULT 'technik',
    password_hash TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    last_login_at TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT NOT NULL,
    ref_type TEXT DEFAULT '',
    ref_id INTEGER,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    week TEXT NOT NULL,
    goals TEXT DEFAULT '{}',
    review_note TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE(user_id, week)
);

CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    ticket_id INTEGER,
    user_id INTEGER,
    date TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    description TEXT DEFAULT '',
    billable INTEGER DEFAULT 1,
    rate REAL DEFAULT 0,
    invoice_id INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT DEFAULT '',
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    customer_name TEXT DEFAULT '',
    period TEXT DEFAULT '',
    date TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    items TEXT DEFAULT '[]',
    net REAL DEFAULT 0,
    vat_rate REAL DEFAULT 20,
    vat REAL DEFAULT 0,
    gross REAL DEFAULT 0,
    status TEXT DEFAULT 'entwurf',
    note TEXT DEFAULT '',
    paid_at TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_time_open ON time_entries(customer_id, invoice_id);

CREATE TABLE IF NOT EXISTS portal_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name TEXT DEFAULT '',
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    last_login_at TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_sessions (
    token_hash TEXT PRIMARY KEY,
    portal_user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    vendor TEXT DEFAULT '',
    kind TEXT DEFAULT 'lizenz',
    quantity REAL DEFAULT 1,
    unit_cost REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    billing_cycle TEXT DEFAULT 'monat',
    renewal_date TEXT DEFAULT '',
    auto_renew INTEGER DEFAULT 1,
    notice_days INTEGER DEFAULT 30,
    billable INTEGER DEFAULT 1,
    per_user INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscription_billing (
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    invoice_id INTEGER NOT NULL,
    PRIMARY KEY (subscription_id, period)
);

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    title TEXT DEFAULT '',
    filename TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    ref_type TEXT DEFAULT '',
    ref_id INTEGER,
    folder TEXT DEFAULT '',
    local_path TEXT DEFAULT '',
    size INTEGER DEFAULT 0,
    sha256 TEXT DEFAULT '',
    remote TEXT DEFAULT '',
    remote_url TEXT DEFAULT '',
    remote_id TEXT DEFAULT '',
    remote_status TEXT DEFAULT '',
    remote_error TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_ref ON documents(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS bank_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_date TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'EUR',
    partner TEXT DEFAULT '',
    iban TEXT DEFAULT '',
    text TEXT DEFAULT '',
    reference TEXT DEFAULT '',
    dedupe_key TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'offen',
    match_note TEXT DEFAULT '',
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    receipt_id INTEGER REFERENCES receipts(id) ON DELETE SET NULL,
    suggestion TEXT DEFAULT '',
    import_file TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    transaction_id INTEGER REFERENCES bank_transactions(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_bank_status ON bank_transactions(status);

CREATE TABLE IF NOT EXISTS maintenance_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    template TEXT DEFAULT '',
    title TEXT NOT NULL,
    checklist TEXT DEFAULT '[]',
    interval TEXT DEFAULT 'monat',
    next_due TEXT NOT NULL,
    lead_days INTEGER DEFAULT 3,
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    estimate_min INTEGER DEFAULT 15,
    active INTEGER DEFAULT 1,
    last_done_at TEXT DEFAULT '',
    last_result TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS maintenance_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
    title TEXT DEFAULT '',
    due_date TEXT NOT NULL,
    status TEXT DEFAULT 'offen',
    result TEXT DEFAULT '',
    checklist TEXT DEFAULT '[]',
    note TEXT DEFAULT '',
    minutes INTEGER DEFAULT 0,
    done_at TEXT DEFAULT '',
    done_by INTEGER,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mruns_task ON maintenance_runs(task_id, status);

CREATE TABLE IF NOT EXISTS sepa_mandates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    reference TEXT NOT NULL UNIQUE,
    signed_on TEXT NOT NULL,
    holder TEXT DEFAULT '',
    iban TEXT NOT NULL,
    bic TEXT DEFAULT '',
    scheme TEXT DEFAULT 'CORE',
    kind TEXT DEFAULT 'wiederkehrend',
    status TEXT DEFAULT 'aktiv',
    used_at TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sepa_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    msg_id TEXT NOT NULL UNIQUE,
    collection_date TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    total REAL DEFAULT 0,
    format TEXT DEFAULT '',
    status TEXT DEFAULT 'erstellt',
    xml TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS remote_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT DEFAULT 'atera',
    started_at TEXT NOT NULL,
    ended_at TEXT DEFAULT '',
    minutes INTEGER DEFAULT 0,
    technician TEXT DEFAULT '',
    device TEXT DEFAULT '',
    customer_hint TEXT DEFAULT '',
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    maintenance_run_id INTEGER REFERENCES maintenance_runs(id) ON DELETE SET NULL,
    time_entry_id INTEGER REFERENCES time_entries(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'offen',
    note TEXT DEFAULT '',
    dedupe_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rsessions_customer ON remote_sessions(customer_id, started_at);

CREATE TABLE IF NOT EXISTS csat_surveys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    email TEXT DEFAULT '',
    token TEXT NOT NULL UNIQUE,
    sent_at TEXT DEFAULT '',
    rating INTEGER,
    comment TEXT DEFAULT '',
    rated_at TEXT DEFAULT '',
    channel TEXT DEFAULT '',
    followup_ticket_id INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    note TEXT DEFAULT '',
    started_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task TEXT DEFAULT '',
    model TEXT DEFAULT '',
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read INTEGER DEFAULT 0,
    cache_write INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_type TEXT NOT NULL,
    ref_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT DEFAULT 'application/octet-stream',
    size INTEGER DEFAULT 0,
    sha256 TEXT DEFAULT '',
    path TEXT NOT NULL,
    source TEXT DEFAULT 'team',
    customer_visible INTEGER DEFAULT 1,
    message_id INTEGER,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_ref ON attachments(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS m365_tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
    tenant_id TEXT DEFAULT '',
    display_name TEXT DEFAULT '',
    domain TEXT DEFAULT '',
    status TEXT DEFAULT 'ausstehend',
    consent_state TEXT DEFAULT '',
    consented_at TEXT DEFAULT '',
    last_sync TEXT DEFAULT '',
    error TEXT DEFAULT '',
    snapshot TEXT DEFAULT '',
    sku_map TEXT DEFAULT '{}',
    ignored TEXT DEFAULT '[]',
    tickets TEXT DEFAULT '{}',
    score_history TEXT DEFAULT '[]',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS m365_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    object_id TEXT NOT NULL,
    upn TEXT DEFAULT '',
    display_name TEXT DEFAULT '',
    enabled INTEGER DEFAULT 1,
    user_type TEXT DEFAULT 'Member',
    licenses TEXT DEFAULT '[]',
    last_sign_in TEXT DEFAULT '',
    mfa INTEGER,
    mfa_methods TEXT DEFAULT '[]',
    admin_roles TEXT DEFAULT '[]',
    rules TEXT DEFAULT '[]',
    department TEXT DEFAULT '',
    job_title TEXT DEFAULT '',
    created_dt TEXT DEFAULT '',
    synced_at TEXT DEFAULT '',
    UNIQUE(customer_id, object_id)
);

CREATE TABLE IF NOT EXISTS staff_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    person TEXT NOT NULL,
    email TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    details TEXT DEFAULT '{}',
    checklist TEXT DEFAULT '[]',
    status TEXT DEFAULT 'offen',
    ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
    subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
    license_adjusted INTEGER DEFAULT 0,
    requested_by TEXT DEFAULT '',
    completed_at TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_customer ON staff_changes(customer_id, status);

CREATE TABLE IF NOT EXISTS ms_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key INTEGER NOT NULL UNIQUE,
    upn TEXT DEFAULT '',
    display_name TEXT DEFAULT '',
    refresh_token TEXT DEFAULT '',
    list_id TEXT DEFAULT '',
    options TEXT DEFAULT '{}',
    connected_at TEXT DEFAULT '',
    last_sync TEXT DEFAULT '',
    error TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS todo_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key INTEGER NOT NULL,
    ref TEXT NOT NULL,
    task_id TEXT NOT NULL,
    list_id TEXT DEFAULT '',
    title TEXT DEFAULT '',
    due TEXT DEFAULT '',
    state TEXT DEFAULT 'offen',
    meta TEXT DEFAULT '{}',
    synced_at TEXT DEFAULT '',
    UNIQUE(user_key, ref)
);

CREATE TABLE IF NOT EXISTS backup_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    job_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    source TEXT DEFAULT 'allgemein',
    host TEXT DEFAULT '',
    sender TEXT DEFAULT '',
    expected_hours INTEGER DEFAULT 24,
    active INTEGER DEFAULT 1,
    last_status TEXT DEFAULT '',
    last_at TEXT DEFAULT '',
    last_success_at TEXT DEFAULT '',
    ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES backup_jobs(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    at TEXT NOT NULL,
    subject TEXT DEFAULT '',
    details TEXT DEFAULT '',
    message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_job ON backup_runs(job_id, at);

CREATE TABLE IF NOT EXISTS domain_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    domain TEXT NOT NULL UNIQUE,
    source TEXT DEFAULT 'manuell',
    last_check TEXT DEFAULT '',
    score INTEGER,
    result TEXT DEFAULT '',
    ignored TEXT DEFAULT '[]',
    tickets TEXT DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL UNIQUE,
    hint TEXT DEFAULT '',
    expires_at TEXT DEFAULT '',
    uses INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    hostname TEXT NOT NULL,
    serial TEXT DEFAULT '',
    token_hash TEXT NOT NULL UNIQUE,
    agent_version TEXT DEFAULT '',
    enrolled_at TEXT DEFAULT '',
    last_seen TEXT DEFAULT '',
    last_ip TEXT DEFAULT '',
    data TEXT DEFAULT '',
    ignored TEXT DEFAULT '[]',
    active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_devices_customer ON agent_devices(customer_id);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_external ON messages(external_id);
CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_assets_customer ON assets(customer_id);
"""

# Felder, die über die API geschrieben werden dürfen (Whitelist gegen SQL-Injection).
WRITABLE_FIELDS: dict[str, set[str]] = {
    "customers": {
        "name", "contact_name", "email", "phone", "address", "industry", "employees",
        "package", "mrr", "contract_end", "booked_services", "notes", "last_qbr_at", "uid", "supplier_no", "keeper_url",
        "bookstack_url", "index_clause", "index_base_month", "index_base_value", "mrr_next", "mrr_next_from",
    },
    "tickets": {
        "customer_id", "title", "description", "status", "priority", "category",
        "solution", "ai_suggestion", "time_spent_min", "resolved_at", "assigned_to", "first_response_at",
    },
    "assets": {
        "customer_id", "name", "type", "os", "serial", "purchase_date", "warranty_end",
        "last_seen", "notes", "external_id", "remote_url", "keeper_url",
    },
    "kb_articles": {"title", "content", "tags", "embedding", "embedding_model", "public", "source", "external_id",
                    "external_url", "synced_at"},
    "ai_usage": {"task", "model", "input_tokens", "output_tokens", "cache_read", "cache_write", "cost_usd"},
    "attachments": {"ref_type", "ref_id", "filename", "content_type", "size", "sha256", "path", "source",
                    "customer_visible", "message_id"},
    "csat_surveys": {"ticket_id", "customer_id", "email", "token", "sent_at", "rating", "comment", "rated_at", "channel",
                     "followup_ticket_id"},
    "timers": {"user_id", "ticket_id", "customer_id", "note", "started_at"},
    "remote_sessions": {"source", "started_at", "ended_at", "minutes", "technician", "device", "customer_hint",
                        "customer_id", "asset_id", "maintenance_run_id", "time_entry_id", "status", "note", "dedupe_key"},
    "services": {"code", "name", "description", "unit", "price", "recurring", "keywords", "active"},
    "quotes": {"customer_id", "title", "need", "items", "total_once", "total_monthly", "text", "status",
               "sent_at", "followup_count", "last_followup_at", "tiers", "chosen_tier", "invoice_id"},
    "messages": {
        "channel", "direction", "external_id", "from_name", "from_email", "to_email", "phone", "company",
        "subject", "body", "attachments", "category", "status", "ai_result", "draft_reply", "note",
        "customer_id", "linked_type", "linked_id", "reply_to_id", "sent_at",
    },
    "leads": {
        "name", "company", "email", "phone", "source", "need", "stage", "score", "qualification", "notes",
        "followups", "last_contact_at", "customer_id", "owner_id", "next_step", "risk",
    },
    "receipts": {"message_id", "vendor", "invoice_no", "invoice_date", "amount", "currency", "category",
                 "status", "note", "document_id"},
    "bank_transactions": {"booking_date", "amount", "currency", "partner", "iban", "text", "reference", "dedupe_key",
                          "status", "match_note", "customer_id", "receipt_id", "suggestion", "import_file"},
    "payments": {"invoice_id", "transaction_id", "amount", "date", "note"},
    "sepa_mandates": {"customer_id", "reference", "signed_on", "holder", "iban", "bic", "scheme", "kind", "status",
                      "used_at", "note"},
    "sepa_batches": {"msg_id", "collection_date", "count", "total", "format", "status", "xml"},
    "maintenance_tasks": {"customer_id", "template", "title", "checklist", "interval", "next_due", "lead_days",
                          "assigned_to", "estimate_min", "active", "last_done_at", "last_result"},
    "maintenance_runs": {"task_id", "customer_id", "ticket_id", "title", "due_date", "status", "result", "checklist",
                         "note", "minutes", "done_at", "done_by"},
    "documents": {"kind", "title", "filename", "customer_id", "ref_type", "ref_id", "folder", "local_path", "size",
                  "sha256", "remote", "remote_url", "remote_id", "remote_status", "remote_error"},
    "mrr_history": {"customer_id", "customer_name", "old_mrr", "new_mrr", "reason"},
    "users": {"name", "email", "role", "password_hash", "active", "last_login_at", "totp_secret", "totp_enabled",
              "totp_recovery", "totp_last_step"},
    "subscriptions": {"customer_id", "name", "vendor", "kind", "quantity", "unit_cost", "unit_price", "billing_cycle",
                      "renewal_date", "auto_renew", "notice_days", "billable", "per_user", "notes"},
    "portal_users": {"customer_id", "name", "email", "password_hash", "active", "last_login_at"},
    "time_entries": {"customer_id", "ticket_id", "user_id", "date", "minutes", "description", "billable", "rate",
                     "invoice_id"},
    "invoices": {"number", "customer_id", "customer_name", "period", "date", "due_date", "items", "net", "vat_rate",
                 "vat", "gross", "status", "note", "paid_at", "order_ref", "sent_at", "sent_to",
                 "paid_amount", "dunning_level", "dunned_at", "payment_method", "sepa_mandate_id", "sepa_status",
                 "sepa_due", "sepa_batch_id"},
    "activities": {"user_id", "type", "ref_type", "ref_id", "note"},
    "weekly_goals": {"user_id", "week", "goals", "review_note"},
    "qbrs": {"customer_id", "period", "health_score", "text", "next_steps"},
    "assessments": {"customer_id", "answers", "score", "level", "report"},
    "agent_log": {"agent", "provider", "input", "output", "ok", "duration_ms"},
    "m365_tenants": {"customer_id", "tenant_id", "display_name", "domain", "status", "consent_state", "consented_at",
                     "last_sync", "error", "snapshot", "sku_map", "ignored", "tickets", "score_history"},
    "m365_users": {"customer_id", "object_id", "upn", "display_name", "enabled", "user_type", "licenses", "last_sign_in",
                   "mfa", "mfa_methods", "admin_roles", "rules", "department", "job_title", "created_dt", "synced_at"},
    "staff_changes": {"customer_id", "kind", "person", "email", "due_date", "details", "checklist", "status", "ticket_id",
                      "subscription_id", "license_adjusted", "requested_by", "completed_at"},
    "ms_accounts": {"user_key", "upn", "display_name", "refresh_token", "list_id", "options", "connected_at", "last_sync",
                    "error"},
    "todo_links": {"user_key", "ref", "task_id", "list_id", "title", "due", "state", "meta", "synced_at"},
    "backup_jobs": {"customer_id", "job_key", "name", "source", "host", "sender", "expected_hours", "active", "last_status",
                    "last_at", "last_success_at", "ticket_id"},
    "backup_runs": {"job_id", "status", "at", "subject", "details", "message_id"},
    "domain_checks": {"customer_id", "domain", "source", "last_check", "score", "result", "ignored", "tickets"},
    "agent_keys": {"customer_id", "key_hash", "hint", "expires_at", "uses", "active"},
    "agent_devices": {"customer_id", "asset_id", "hostname", "serial", "token_hash", "agent_version", "enrolled_at",
                      "last_seen", "last_ip", "data", "ignored", "active"},
}

TABLES_WITH_UPDATED_AT = {"tickets", "kb_articles", "messages", "leads"}
TABLES_WITH_CREATED_AT = {
    "customers", "tickets", "assets", "kb_articles", "quotes", "assessments", "agent_log",
    "messages", "leads", "receipts", "mrr_history", "qbrs", "users", "activities", "weekly_goals",
    "time_entries", "invoices", "portal_users", "subscriptions", "documents",
    "bank_transactions", "payments", "maintenance_tasks", "maintenance_runs", "sepa_mandates", "sepa_batches",
    "remote_sessions", "csat_surveys", "timers", "ai_usage", "attachments", "m365_tenants", "staff_changes", "ms_accounts", "backup_jobs",
    "domain_checks", "agent_keys", "agent_devices",
}

# Spalten, die nach Version 0.1 dazugekommen sind (bestehende Datenbanken werden ergänzt).
MIGRATIONS = {
    "customers": {"last_qbr_at": "TEXT DEFAULT ''", "uid": "TEXT DEFAULT ''", "supplier_no": "TEXT DEFAULT ''",
                  "keeper_url": "TEXT DEFAULT ''", "bookstack_url": "TEXT DEFAULT ''",
                  "index_clause": "INTEGER DEFAULT 0", "index_base_month": "TEXT DEFAULT ''",
                  "index_base_value": "REAL DEFAULT 0", "mrr_next": "REAL", "mrr_next_from": "TEXT DEFAULT ''"},
    "assets": {"external_id": "TEXT DEFAULT ''", "remote_url": "TEXT DEFAULT ''", "keeper_url": "TEXT DEFAULT ''"},
    "invoices": {"order_ref": "TEXT DEFAULT ''", "sent_at": "TEXT DEFAULT ''", "sent_to": "TEXT DEFAULT ''",
                 "paid_amount": "REAL DEFAULT 0", "dunning_level": "INTEGER DEFAULT 0", "dunned_at": "TEXT DEFAULT ''",
                 "payment_method": "TEXT DEFAULT 'ueberweisung'", "sepa_mandate_id": "INTEGER", "sepa_status": "TEXT DEFAULT ''",
                 "sepa_due": "TEXT DEFAULT ''", "sepa_batch_id": "INTEGER"},
    "receipts": {"document_id": "INTEGER"},
    "users": {"totp_secret": "TEXT DEFAULT ''", "totp_enabled": "INTEGER DEFAULT 0", "totp_recovery": "TEXT DEFAULT '[]'",
              "totp_last_step": "INTEGER DEFAULT 0"},
    "tickets": {"assigned_to": "INTEGER", "first_response_at": "TEXT DEFAULT ''"},
    "kb_articles": {"public": "INTEGER DEFAULT 0", "source": "TEXT DEFAULT 'cockpit'", "external_id": "TEXT DEFAULT ''",
                    "external_url": "TEXT DEFAULT ''", "synced_at": "TEXT DEFAULT ''"},
    "leads": {"owner_id": "INTEGER", "next_step": "TEXT DEFAULT ''", "risk": "TEXT DEFAULT ''"},
    "quotes": {"sent_at": "TEXT DEFAULT ''", "followup_count": "INTEGER DEFAULT 0",
               "last_followup_at": "TEXT DEFAULT ''", "tiers": "TEXT DEFAULT '[]'", "chosen_tier": "TEXT DEFAULT ''",
               "invoice_id": "INTEGER"},
}


def now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat(sep=" ")


class Database:
    def __init__(self, path: str):
        self.path = path
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def init_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(SCHEMA)
            for table, columns in MIGRATIONS.items():
                existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
                for column, definition in columns.items():
                    if column not in existing:
                        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    # --- Einstellungen (Schlüssel/Wert, JSON) -------------------------------
    def get_setting(self, key: str, default: Any = None) -> Any:
        row = self.query_one("SELECT value FROM app_settings WHERE key = ?", (key,))
        return loads(row["value"], default) if row else default

    def set_setting(self, key: str, value: Any) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO app_settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value, ensure_ascii=False)),
            )

    # --- generische Helfer -------------------------------------------------
    def query(self, sql: str, params: tuple | list = ()) -> list[dict[str, Any]]:
        with self.connect() as conn:
            return [dict(row) for row in conn.execute(sql, params).fetchall()]

    def query_one(self, sql: str, params: tuple | list = ()) -> dict[str, Any] | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def scalar(self, sql: str, params: tuple | list = ()) -> Any:
        with self.connect() as conn:
            row = conn.execute(sql, params).fetchone()
            return row[0] if row else None

    def _clean(self, table: str, data: dict[str, Any]) -> dict[str, Any]:
        allowed = WRITABLE_FIELDS[table]
        clean: dict[str, Any] = {}
        for key, value in data.items():
            if key not in allowed:
                continue
            if isinstance(value, (list, dict)):
                value = json.dumps(value, ensure_ascii=False)
            elif isinstance(value, bool):
                value = int(value)
            clean[key] = value
        return clean

    def insert(self, table: str, data: dict[str, Any]) -> int:
        clean = self._clean(table, data)
        ts = now_iso()
        if table in TABLES_WITH_CREATED_AT:
            clean["created_at"] = ts
        if table in TABLES_WITH_UPDATED_AT:
            clean["updated_at"] = ts
        cols = ", ".join(clean)
        marks = ", ".join("?" for _ in clean)
        with self.connect() as conn:
            cur = conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", list(clean.values()))
            return int(cur.lastrowid)

    def update(self, table: str, row_id: int, data: dict[str, Any]) -> bool:
        clean = self._clean(table, data)
        if table in TABLES_WITH_UPDATED_AT:
            clean["updated_at"] = now_iso()
        if not clean:
            return self.get(table, row_id) is not None
        assignments = ", ".join(f"{k} = ?" for k in clean)
        with self.connect() as conn:
            cur = conn.execute(
                f"UPDATE {table} SET {assignments} WHERE id = ?", [*clean.values(), row_id]
            )
            return cur.rowcount > 0

    def get(self, table: str, row_id: int) -> dict[str, Any] | None:
        if table not in WRITABLE_FIELDS:
            raise ValueError(f"Unbekannte Tabelle: {table}")
        return self.query_one(f"SELECT * FROM {table} WHERE id = ?", (row_id,))

    def delete(self, table: str, row_id: int) -> bool:
        if table not in WRITABLE_FIELDS:
            raise ValueError(f"Unbekannte Tabelle: {table}")
        with self.connect() as conn:
            cur = conn.execute(f"DELETE FROM {table} WHERE id = ?", (row_id,))
            return cur.rowcount > 0


def loads(value: str | None, default: Any) -> Any:
    """JSON tolerant laden (leere/kaputte Felder -> default)."""
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default
