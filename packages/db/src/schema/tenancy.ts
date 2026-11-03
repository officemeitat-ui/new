import type { PartnerRole, SystemTenantRole, TenantPermission } from "@nexus/core";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_columns";
import { authUser } from "./auth";

export type TenantPlan = "starter" | "business" | "enterprise";
export type TenantStatus = "active" | "suspended";

/** Resellers such as ME-IT. Every tenant belongs to exactly one partner. */
export const partners = pgTable("partners", {
  id: id(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  productName: text().notNull().default("ME-IT Nexus"),
  brandColor: text().notNull().default("#2454d6"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const partnerMemberships = pgTable(
  "partner_memberships",
  {
    id: id(),
    partnerId: uuid()
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    role: text().$type<PartnerRole>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("partner_memberships_partner_user_uq").on(t.partnerId, t.userId),
    index("partner_memberships_user_idx").on(t.userId),
  ],
);

/** Customers (Mandanten). `id` is the tenant id used by every tenant-scoped table. */
export const tenants = pgTable(
  "tenants",
  {
    id: id(),
    partnerId: uuid()
      .notNull()
      .references(() => partners.id, { onDelete: "restrict" }),
    name: text().notNull(),
    slug: text().notNull().unique(),
    plan: text().$type<TenantPlan>().notNull().default("starter"),
    status: text().$type<TenantStatus>().notNull().default("active"),
    /** Overrides the partner colour (white-label, M1). */
    brandColor: text(),
    locale: text().notNull().default("de-AT"),
    /** Internal hourly rate in cents, used for ROI (M10). */
    hourlyRateCents: integer().notNull().default(4500),
    /** Owners and admins must use two-factor authentication (M2). */
    requireAdminTwoFactor: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tenants_partner_idx").on(t.partnerId)],
);

/** Custom roles per tenant (Business plan and above). System roles live in code. */
export const roles = pgTable(
  "roles",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    permissions: text().array().$type<TenantPermission[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("roles_tenant_name_uq").on(t.tenantId, t.name)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    role: text().$type<SystemTenantRole>().notNull(),
    /** When set, the permissions of this custom role apply instead of the system role. */
    customRoleId: uuid().references(() => roles.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("memberships_tenant_user_uq").on(t.tenantId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: text().$type<SystemTenantRole>().notNull(),
    /** SHA-256 of the token sent by e-mail. The token itself is never stored. */
    tokenHash: text().notNull().unique(),
    invitedBy: uuid().references(() => authUser.id, { onDelete: "set null" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("invitations_tenant_idx").on(t.tenantId),
    index("invitations_email_idx").on(t.email),
  ],
);

/** Time-limited access of partner staff to a tenant, granted by the tenant (M12). */
export const supportAccessGrants = pgTable(
  "support_access_grants",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    partnerId: uuid()
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    grantedBy: uuid().references(() => authUser.id, { onDelete: "set null" }),
    reason: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("support_access_grants_tenant_idx").on(t.tenantId)],
);
