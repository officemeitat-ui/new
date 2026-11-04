import { ALWAYS_APPROVE, catalogTool, EFFORTS, MODEL_TIERS } from "@nexus/agents";
import { conflict, notFound, validationError } from "@nexus/core";
import { and, desc, eq, sql, type Tx } from "@nexus/db";
import { agents, agentVersions, authUser, runs, type AgentConfig } from "@nexus/db/schema";
import { z } from "zod";
import { AGENT_TEMPLATES, type AgentTemplate } from "./agent-templates";
import { appendAudit } from "./audit";

export const agentConfigSchema = z
  .object({
    instructions: z
      .string()
      .trim()
      .min(20, "Die Anweisungen sind zu kurz – beschreiben Sie Aufgabe und Ziel des Agenten.")
      .max(20_000, "Die Anweisungen sind zu lang (höchstens 20.000 Zeichen)."),
    tier: z.enum(MODEL_TIERS),
    effort: z.enum(EFFORTS),
    tools: z
      .array(
        z.object({
          name: z.string().refine((name) => Boolean(catalogTool(name)), "Unbekanntes Werkzeug"),
          mode: z.enum(["auto", "approve", "deny"]),
        }),
      )
      .max(50),
    maxSteps: z.number().int().min(1, "Mindestens 1 Schritt").max(50, "Höchstens 50 Schritte"),
    maxCostUsdMicros: z.number().int().min(10_000).max(50_000_000).optional(),
    roiMinutesPerTask: z.number().int().min(0).max(600).optional(),
    knowledgeCollectionIds: z.array(z.uuid()).max(50).optional(),
  })
  // E-mails to third parties and actions on devices always need a person's approval (finding 7).
  .refine(
    (config) =>
      config.tools.every((tool) => {
        const risk = catalogTool(tool.name)?.risk;
        return !(risk && ALWAYS_APPROVE.has(risk) && tool.mode === "auto");
      }),
    "E-Mails an Dritte und Eingriffe an Geräten brauchen immer eine Freigabe – „automatisch“ ist dafür nicht möglich.",
  ) satisfies z.ZodType<AgentConfig>;

/** JSON with sorted keys: Postgres stores jsonb with its own key order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Whether two configurations are the same, independent of key order. */
export function sameConfig(a: AgentConfig, b: AgentConfig): boolean {
  return stableJson(a) === stableJson(b);
}

const PLACEHOLDER = /\{\{([a-z_.]+)\}\}/g;

/** Placeholders like {{rabattregeln}} that still need company-specific content. */
export function openPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]!))];
}

/** Fills the company name and the template's default values into its instructions. */
export function instantiateInstructions(template: AgentTemplate, tenantName: string): string {
  const defaults = new Map(
    template.variables.filter((v) => v.default).map((v) => [v.name, v.default!]),
  );
  return template.instructions.replace(PLACEHOLDER, (match, name: string) =>
    name === "firma.name" ? tenantName : (defaults.get(name) ?? match),
  );
}

export function findTemplate(id: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((template) => template.id === id);
}

/** Starting configuration of an agent made from a library template. */
export function configFromTemplate(template: AgentTemplate, tenantName: string): AgentConfig {
  return {
    instructions: instantiateInstructions(template, tenantName),
    tier: template.tier,
    effort: template.effort,
    tools: template.tools,
    maxSteps: 15,
    maxCostUsdMicros: template.tier === "smart" ? 1_000_000 : 500_000,
    roiMinutesPerTask: template.roiMinutesPerTask,
  };
}

/** Publishes a new, immutable version and makes it the agent's current one. */
export async function insertAgentVersion(
  tx: Tx,
  input: { tenantId: string; agentId: string; config: AgentConfig; actorId: string },
) {
  const [{ next }] = (await tx
    .select({ next: sql<number>`coalesce(max(${agentVersions.version}), 0) + 1` })
    .from(agentVersions)
    .where(eq(agentVersions.agentId, input.agentId))) as [{ next: number }];
  const [version] = await tx
    .insert(agentVersions)
    .values({
      tenantId: input.tenantId,
      agentId: input.agentId,
      version: Number(next),
      config: input.config,
      publishedAt: new Date(),
      createdBy: input.actorId,
    })
    .returning();
  await tx
    .update(agents)
    .set({ currentVersionId: version!.id })
    .where(eq(agents.id, input.agentId));
  return version!;
}

export async function createAgentFromTemplate(
  tx: Tx,
  input: { tenantId: string; templateId: string; tenantName: string; actorId: string },
) {
  const template = findTemplate(input.templateId);
  if (!template) throw notFound("Vorlage nicht gefunden.");
  const [agent] = await tx
    .insert(agents)
    .values({
      tenantId: input.tenantId,
      name: template.name,
      description: template.purpose,
      templateId: template.id,
      createdBy: input.actorId,
    })
    .returning();
  const config = configFromTemplate(template, input.tenantName);
  await insertAgentVersion(tx, {
    tenantId: input.tenantId,
    agentId: agent!.id,
    config,
    actorId: input.actorId,
  });
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: "agent.created",
    targetType: "agent",
    targetId: agent!.id,
    metadata: { name: template.name, templateId: template.id },
  });
  return agent!;
}

export async function createBlankAgent(
  tx: Tx,
  input: { tenantId: string; actorId: string; name: string },
) {
  const name = input.name.trim();
  if (name.length < 2) throw validationError("Bitte einen Namen angeben.");
  const [agent] = await tx
    .insert(agents)
    .values({ tenantId: input.tenantId, name: name.slice(0, 80), createdBy: input.actorId })
    .returning();
  await insertAgentVersion(tx, {
    tenantId: input.tenantId,
    agentId: agent!.id,
    config: {
      instructions:
        "Beschreiben Sie hier, was der Agent tun soll: Ziel, Kontext, worauf es ankommt und wie das Ergebnis aussehen soll.",
      tier: "balanced",
      effort: "medium",
      tools: [
        { name: "aktuelle_zeit", mode: "auto" },
        { name: "rechner", mode: "auto" },
      ],
      maxSteps: 10,
      maxCostUsdMicros: 500_000,
      roiMinutesPerTask: 5,
    },
    actorId: input.actorId,
  });
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: "agent.created",
    targetType: "agent",
    targetId: agent!.id,
    metadata: { name },
  });
  return agent!;
}

/** Agents with their current configuration and usage of the last 30 days. */
export async function listAgents(
  tx: Tx,
  tenantId: string,
  options: { includeArchived?: boolean } = {},
) {
  const rows = await tx
    .select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      status: agents.status,
      isDefault: agents.isDefault,
      templateId: agents.templateId,
      /** Rolled out by the partner (ADR 0009); adapted = changed by the tenant since then. */
      managed: sql<boolean>`${agents.partnerTemplateId} is not null`,
      adapted: sql<boolean>`${agents.currentVersionId} is distinct from ${agents.rolledOutVersionId}`,
      version: agentVersions.version,
      config: agentVersions.config,
      updatedAt: agentVersions.createdAt,
      runs30d: sql<number>`(select count(*)::int from ${runs} r where r.agent_id = ${agents.id} and r.created_at > now() - interval '30 days')`,
    })
    .from(agents)
    .innerJoin(agentVersions, eq(agentVersions.id, agents.currentVersionId))
    .where(
      options.includeArchived
        ? eq(agents.tenantId, tenantId)
        : and(eq(agents.tenantId, tenantId), eq(agents.status, "active")),
    )
    .orderBy(desc(agents.isDefault), agents.name);
  return rows;
}

export async function getAgentDetail(tx: Tx, tenantId: string, agentId: string) {
  const [agent] = await tx
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)));
  if (!agent?.currentVersionId) throw notFound("Agent nicht gefunden.");
  const versions = await tx
    .select({
      id: agentVersions.id,
      version: agentVersions.version,
      config: agentVersions.config,
      createdAt: agentVersions.createdAt,
      createdByName: authUser.name,
    })
    .from(agentVersions)
    .leftJoin(authUser, eq(authUser.id, agentVersions.createdBy))
    .where(eq(agentVersions.agentId, agentId))
    .orderBy(desc(agentVersions.version));
  const current = versions.find((v) => v.id === agent.currentVersionId)!;
  return { agent, current, versions };
}

/**
 * Publishes a new version (versions are immutable, so every change is traceable and can be
 * rolled back). Name and description live on the agent itself.
 */
export async function saveAgentVersion(
  tx: Tx,
  input: {
    tenantId: string;
    agentId: string;
    name: string;
    description: string | null;
    config: unknown;
    actorId: string;
  },
) {
  const parsed = agentConfigSchema.safeParse(input.config);
  if (!parsed.success) throw validationError(parsed.error.issues[0]!.message);
  const name = input.name.trim();
  if (name.length < 2) throw validationError("Bitte einen Namen angeben.");
  const { agent, current } = await getAgentDetail(tx, input.tenantId, input.agentId);

  await tx
    .update(agents)
    .set({ name: name.slice(0, 80), description: input.description?.trim().slice(0, 300) || null })
    .where(eq(agents.id, agent.id));
  if (sameConfig(current.config, parsed.data) && agent.name === name) {
    return current;
  }
  const version = await insertAgentVersion(tx, {
    tenantId: input.tenantId,
    agentId: agent.id,
    config: parsed.data,
    actorId: input.actorId,
  });
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: "agent.published",
    targetType: "agent",
    targetId: agent.id,
    metadata: { name, version: version.version },
  });
  return version;
}

export async function restoreAgentVersion(
  tx: Tx,
  input: { tenantId: string; agentId: string; versionId: string; actorId: string },
) {
  const { agent, versions } = await getAgentDetail(tx, input.tenantId, input.agentId);
  const old = versions.find((v) => v.id === input.versionId);
  if (!old) throw notFound("Version nicht gefunden.");
  return saveAgentVersion(tx, {
    tenantId: input.tenantId,
    agentId: agent.id,
    name: agent.name,
    description: agent.description,
    config: old.config,
    actorId: input.actorId,
  });
}

export async function setAgentStatus(
  tx: Tx,
  input: { tenantId: string; agentId: string; status: "active" | "archived"; actorId: string },
) {
  const { agent } = await getAgentDetail(tx, input.tenantId, input.agentId);
  if (agent.isDefault && input.status === "archived") {
    throw conflict("Der Standard-Assistent kann nicht archiviert werden.");
  }
  await tx.update(agents).set({ status: input.status }).where(eq(agents.id, agent.id));
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: input.status === "archived" ? "agent.archived" : "agent.restored",
    targetType: "agent",
    targetId: agent.id,
    metadata: { name: agent.name },
  });
}
