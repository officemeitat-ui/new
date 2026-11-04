import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_columns";
import { authUser } from "./auth";
import { tenants } from "./tenancy";

export type IntegrationProvider = "microsoft365";
export type IntegrationStatus = "connected" | "error";

/**
 * A tenant's connection to an external system (M6). Microsoft 365 uses app-only access after
 * admin consent, so no customer secret is stored – only the customer's directory ID (ADR 0008).
 */
export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text().$type<IntegrationProvider>().notNull(),
    status: text().$type<IntegrationStatus>().notNull().default("connected"),
    /** Microsoft: Entra directory (tenant) ID of the customer. */
    externalTenantId: text().notNull(),
    /** Organisation name as reported by the provider. */
    displayName: text(),
    lastError: text(),
    lastCheckedAt: timestamp({ withTimezone: true }),
    connectedBy: uuid().references(() => authUser.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("integrations_tenant_provider_uq").on(t.tenantId, t.provider),
    // One Microsoft directory belongs to one company (security review, finding 1).
    uniqueIndex("integrations_provider_external_uq").on(t.provider, t.externalTenantId),
  ],
);

/**
 * Directories a company was once connected to. Disconnecting removes the connection, but the
 * customer's admin consent stays in Entra ID – so the directory stays bound to that company and
 * cannot be connected to another one (security review 2, finding 3). ME-IT releases a binding
 * deliberately by deleting the row.
 */
export const integrationDirectoryHistory = pgTable(
  "integration_directory_history",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text().$type<IntegrationProvider>().notNull(),
    externalTenantId: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("integration_history_uq").on(t.provider, t.externalTenantId, t.tenantId)],
);
