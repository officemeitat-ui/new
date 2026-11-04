import { index, pgTable, text, timestamp, uniqueIndex, uuid, boolean } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_columns";
import { authUser } from "./auth";
import { tenants } from "./tenancy";

/** A building or site the company looks after (Objekt), with its public QR token. */
export const facilities = pgTable(
  "facilities",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text().notNull(),
    address: text(),
    /** Objektleitung: receives an e-mail for every new report. */
    contactEmail: text(),
    /** Random, unguessable token in the QR code (public report page /m/<token>). */
    publicToken: text().notNull(),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("facilities_public_token_uq").on(t.publicToken),
    index("facilities_tenant_idx").on(t.tenantId),
  ],
);

export type DefectCategory = "verschmutzung" | "nachfuellen" | "schaden" | "sonstiges";
export type DefectStatus = "open" | "in_progress" | "done";

/** A defect report submitted through a facility's QR code (no login). */
export const defectReports = pgTable(
  "defect_reports",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    facilityId: uuid()
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    category: text().$type<DefectCategory>().notNull(),
    location: text(),
    description: text().notNull(),
    /** Optional, only to tell the reporter when it is done (personal data, see retention). */
    reporterEmail: text(),
    status: text().$type<DefectStatus>().notNull().default("open"),
    resolutionNote: text(),
    resolvedBy: uuid().references(() => authUser.id, { onDelete: "set null" }),
    resolvedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("defect_reports_tenant_status_idx").on(t.tenantId, t.status, t.createdAt)],
);
