import { isUuid, notFound, validationError } from "@nexus/core";
import {
  and,
  desc,
  enterTenant,
  eq,
  inArray,
  isNotNull,
  sql,
  withPartner,
  type Database,
} from "@nexus/db";
import { agents, partnerAgentTemplates, tenants, type AgentConfig } from "@nexus/db/schema";
import {
  agentConfigSchema,
  configFromTemplate,
  findTemplate,
  insertAgentVersion,
  sameConfig,
} from "./agents";
import { appendAudit } from "./audit";

/**
 * Agent packages (ADR 0009): a partner prepares an agent once and rolls it out to the tenants
 * that need the same task ("Kunden: Wer braucht dasselbe?"). Later changes reach every tenant
 * that still runs the rolled-out version; an agent the tenant adapted is never overwritten.
 */

const COMPANY = "{{firma.name}}";
const MAX_TENANTS_PER_ROLLOUT = 200;

export type RolloutOutcome =
  /** New agent in the tenant. */
  | "created"
  /** Rolled-out agent got the new package version. */
  | "updated"
  /** Already on this version. */
  | "current"
  /** The tenant changed the agent: it keeps its own version. */
  | "adapted"
  /** The tenant archived the agent: it stays archived. */
  | "archived"
  /** Not one of the partner's active tenants. */
  | "unavailable"
  /** Something went wrong for this tenant; the others still ran. */
  | "failed";

/** Packages stay tenant-neutral: no knowledge collections (those IDs belong to one tenant). */
function packageConfig(config: AgentConfig): AgentConfig {
  const { knowledgeCollectionIds: _ignored, ...rest } = config;
  return rest;
}

/** Creates a package from a library template; {{firma.name}} is filled per tenant later. */
export async function createAgentPackage(
  db: Database,
  input: { partnerId: string; baseTemplateId: string; actorId: string },
) {
  const template = findTemplate(input.baseTemplateId);
  if (!template) throw notFound("Vorlage nicht gefunden.");
  const config = agentConfigSchema.parse(packageConfig(configFromTemplate(template, COMPANY)));
  const [created] = await withPartner(db, input.partnerId, (tx) =>
    tx
      .insert(partnerAgentTemplates)
      .values({
        partnerId: input.partnerId,
        name: template.name,
        description: template.purpose,
        baseTemplateId: template.id,
        config,
        createdBy: input.actorId,
      })
      .returning(),
  );
  return created!;
}

/** Changes name, description or instructions; a changed configuration raises the version. */
export async function updateAgentPackage(
  db: Database,
  input: {
    partnerId: string;
    packageId: string;
    name: string;
    description: string | null;
    instructions: string;
  },
) {
  if (!isUuid(input.packageId)) throw notFound("Paket nicht gefunden.");
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    throw validationError("Der Name muss 2 bis 80 Zeichen lang sein.");
  }
  return withPartner(db, input.partnerId, async (tx) => {
    const [current] = await tx
      .select()
      .from(partnerAgentTemplates)
      .where(eq(partnerAgentTemplates.id, input.packageId))
      .for("update");
    if (!current) throw notFound("Paket nicht gefunden.");
    const parsed = agentConfigSchema.safeParse(
      // Browsers submit textarea line breaks as CRLF.
      packageConfig({
        ...current.config,
        instructions: input.instructions.replace(/\r\n?/g, "\n"),
      }),
    );
    if (!parsed.success) throw validationError(parsed.error.issues[0]!.message);
    const changed = !sameConfig(parsed.data, current.config);
    const [updated] = await tx
      .update(partnerAgentTemplates)
      .set({
        name,
        description: input.description?.trim().slice(0, 300) || null,
        config: parsed.data,
        version: changed ? current.version + 1 : current.version,
      })
      .where(eq(partnerAgentTemplates.id, current.id))
      .returning();
    return { package: updated!, changed };
  });
}

export type PackageRollout = {
  tenantId: string;
  version: number | null;
  adapted: boolean;
  archived: boolean;
};

/**
 * The partner's packages with the rollout state per tenant. The partner sees whether a tenant
 * adapted the agent, not what it changed (no tenant content, ADR 0002).
 */
export async function listAgentPackages(db: Database, partnerId: string) {
  return withPartner(db, partnerId, async (tx) => {
    const packages = await tx
      .select()
      .from(partnerAgentTemplates)
      .where(eq(partnerAgentTemplates.partnerId, partnerId))
      .orderBy(desc(partnerAgentTemplates.createdAt));
    if (packages.length === 0) return [];
    const rollouts = await tx
      .select({
        packageId: agents.partnerTemplateId,
        tenantId: agents.tenantId,
        version: agents.partnerTemplateVersion,
        adapted: sql<boolean>`${agents.currentVersionId} is distinct from ${agents.rolledOutVersionId}`,
        archived: sql<boolean>`${agents.status} = 'archived'`,
      })
      .from(agents)
      .where(
        and(
          isNotNull(agents.partnerTemplateId),
          inArray(
            agents.partnerTemplateId,
            packages.map((p) => p.id),
          ),
        ),
      );
    return packages.map((pkg) => ({
      ...pkg,
      rollouts: rollouts
        .filter((r) => r.packageId === pkg.id)
        .map((r): PackageRollout => ({
          tenantId: r.tenantId,
          version: r.version,
          adapted: r.adapted,
          archived: r.archived,
        })),
    }));
  });
}

/**
 * Rolls a package out to the selected tenants – one transaction per tenant, so one failing
 * tenant does not stop the others. Each tenant's audit log records what its partner did.
 */
export async function rolloutAgentPackage(
  db: Database,
  input: { partnerId: string; packageId: string; tenantIds: string[]; actorId: string },
) {
  if (!isUuid(input.packageId)) throw notFound("Paket nicht gefunden.");
  const tenantIds = [...new Set(input.tenantIds)].filter(isUuid);
  if (tenantIds.length === 0) throw validationError("Bitte mindestens eine Firma auswählen.");
  if (tenantIds.length > MAX_TENANTS_PER_ROLLOUT) {
    throw validationError(`Höchstens ${MAX_TENANTS_PER_ROLLOUT} Firmen auf einmal.`);
  }
  const results: { tenantId: string; tenantName: string | null; outcome: RolloutOutcome }[] = [];
  for (const tenantId of tenantIds) {
    try {
      results.push(await rolloutToTenant(tenantId));
    } catch (error) {
      if (error instanceof Error && error.name === "AppError") throw error; // e.g. package gone
      results.push({ tenantId, tenantName: null, outcome: "failed" });
    }
  }
  return results;

  async function rolloutToTenant(tenantId: string) {
    return withPartner(db, input.partnerId, async (tx) => {
      const [pkg] = await tx
        .select()
        .from(partnerAgentTemplates)
        .where(eq(partnerAgentTemplates.id, input.packageId));
      if (!pkg) throw notFound("Paket nicht gefunden.");
      // Row Level Security already limits this to the partner's tenants.
      const [tenant] = await tx
        .select({ id: tenants.id, name: tenants.name, status: tenants.status })
        .from(tenants)
        .where(and(eq(tenants.id, tenantId), eq(tenants.partnerId, input.partnerId)));
      if (!tenant || tenant.status !== "active") {
        return { tenantId, tenantName: tenant?.name ?? null, outcome: "unavailable" as const };
      }
      await enterTenant(tx, tenant.id);
      const config: AgentConfig = {
        ...pkg.config,
        instructions: pkg.config.instructions.replaceAll(COMPANY, tenant.name),
      };
      const done = (outcome: RolloutOutcome) => ({
        tenantId,
        tenantName: tenant.name,
        outcome,
      });

      const [existing] = await tx
        .select()
        .from(agents)
        .where(and(eq(agents.tenantId, tenant.id), eq(agents.partnerTemplateId, pkg.id)))
        .for("update");

      if (!existing) {
        const [agent] = await tx
          .insert(agents)
          .values({
            tenantId: tenant.id,
            name: pkg.name,
            description: pkg.description,
            templateId: pkg.baseTemplateId,
            partnerTemplateId: pkg.id,
            createdBy: input.actorId,
          })
          .returning();
        const version = await insertAgentVersion(tx, {
          tenantId: tenant.id,
          agentId: agent!.id,
          config,
          actorId: input.actorId,
        });
        await tx
          .update(agents)
          .set({ partnerTemplateVersion: pkg.version, rolledOutVersionId: version.id })
          .where(eq(agents.id, agent!.id));
        await appendAudit(tx, tenant.id, {
          actorType: "partner",
          actorId: input.actorId,
          action: "agent.rolled_out",
          targetType: "agent",
          targetId: agent!.id,
          metadata: { name: pkg.name, packageVersion: pkg.version },
        });
        return done("created");
      }
      if (existing.status === "archived") return done("archived");
      if (existing.partnerTemplateVersion === pkg.version) return done("current");
      if (existing.currentVersionId !== existing.rolledOutVersionId) return done("adapted");

      const version = await insertAgentVersion(tx, {
        tenantId: tenant.id,
        agentId: existing.id,
        config,
        actorId: input.actorId,
      });
      await tx
        .update(agents)
        .set({ partnerTemplateVersion: pkg.version, rolledOutVersionId: version.id })
        .where(eq(agents.id, existing.id));
      await appendAudit(tx, tenant.id, {
        actorType: "partner",
        actorId: input.actorId,
        action: "agent.updated_by_partner",
        targetType: "agent",
        targetId: existing.id,
        metadata: { name: existing.name, packageVersion: pkg.version, version: version.version },
      });
      return done("updated");
    });
  }
}
