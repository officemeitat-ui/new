/**
 * Fine-grained permissions. Roles are bundles of these. Every server action and API route
 * checks a permission; the UI only hides what the user cannot do.
 */
export const TENANT_PERMISSIONS = [
  "tenant.settings.manage",
  "tenant.members.manage",
  "tenant.billing.manage",
  "tenant.audit.read",
  "tenant.support_access.manage",
  "agent.run",
  "agent.edit",
  "agent.publish",
  "workflow.run",
  "workflow.edit",
  "approval.decide",
  "knowledge.read",
  "knowledge.manage",
  /** Connect knowledge sources (SharePoint, BookStack, Atera) – not part of support sessions. */
  "knowledge.connect",
  "integration.manage",
  "analytics.read",
  "conversation.read_all",
  "reports.manage",
] as const;

export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];

export const SYSTEM_TENANT_ROLES = ["owner", "admin", "member"] as const;
export type SystemTenantRole = (typeof SYSTEM_TENANT_ROLES)[number];

const ADMIN_EXCLUDED: ReadonlySet<TenantPermission> = new Set([
  "tenant.billing.manage",
  "tenant.support_access.manage",
]);

export const SYSTEM_TENANT_ROLE_PERMISSIONS: Record<SystemTenantRole, readonly TenantPermission[]> =
  {
    owner: TENANT_PERMISSIONS,
    admin: TENANT_PERMISSIONS.filter((p) => !ADMIN_EXCLUDED.has(p)),
    // Object managers are often members: they handle the defect reports of their buildings.
    member: ["agent.run", "workflow.run", "knowledge.read", "approval.decide", "reports.manage"],
  };

export const PARTNER_PERMISSIONS = [
  "partner.tenants.read",
  "partner.tenants.manage",
  "partner.templates.manage",
  "partner.pricing.manage",
  /** Allow a company to connect BookStack and Atera (partner systems) – partner admins only. */
  "partner.sources.manage",
] as const;

export type PartnerPermission = (typeof PARTNER_PERMISSIONS)[number];

export const PARTNER_ROLES = ["partner_admin", "partner_technician"] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number];

export const PARTNER_ROLE_PERMISSIONS: Record<PartnerRole, readonly PartnerPermission[]> = {
  partner_admin: PARTNER_PERMISSIONS,
  partner_technician: ["partner.tenants.read", "partner.tenants.manage"],
};

export function isTenantPermission(value: string): value is TenantPermission {
  return (TENANT_PERMISSIONS as readonly string[]).includes(value);
}

export function isSystemTenantRole(value: string): value is SystemTenantRole {
  return (SYSTEM_TENANT_ROLES as readonly string[]).includes(value);
}

export function hasPermission<P extends string>(granted: Iterable<P>, needed: P): boolean {
  for (const permission of granted) {
    if (permission === needed) return true;
  }
  return false;
}

/**
 * What partner staff may do inside a tenant during a support session the tenant granted
 * (M12): configure agents, workflows, knowledge and integrations – not manage people,
 * billing, security policies or support access itself, and not connect knowledge sources
 * (that would let a technician pull e.g. any SharePoint site of the company – security
 * review 2, finding 7).
 */
export const SUPPORT_PERMISSIONS: readonly TenantPermission[] = [
  "agent.run",
  "agent.edit",
  "agent.publish",
  "workflow.run",
  "workflow.edit",
  "knowledge.read",
  "knowledge.manage",
  "integration.manage",
  "analytics.read",
  "tenant.audit.read",
];
