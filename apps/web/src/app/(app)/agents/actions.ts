"use server";

import { isUuid, validationError } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import {
  createAgentFromTemplate,
  createBlankAgent,
  requirePermission,
  restoreAgentVersion,
  saveAgentVersion,
  setAgentStatus,
} from "@nexus/domain";
import { TOOL_CATALOG } from "@nexus/agents/catalog";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireTenant } from "@/lib/session";

async function editorContext() {
  const ctx = await requireTenant();
  requirePermission(ctx.tenant, "agent.edit");
  return ctx;
}

export async function createFromTemplateAction(templateId: string): Promise<void> {
  const ctx = await editorContext();
  const agent = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    createAgentFromTemplate(tx, {
      tenantId: ctx.tenant.tenantId,
      templateId,
      tenantName: ctx.tenant.tenantName,
      actorId: ctx.user.id,
    }),
  );
  revalidatePath("/agents");
  redirect(`/agents/${agent.id}?neu=1`);
}

export async function createBlankAgentAction(formData: FormData): Promise<void> {
  const ctx = await editorContext();
  const agent = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    createBlankAgent(tx, {
      tenantId: ctx.tenant.tenantId,
      actorId: ctx.user.id,
      name: String(formData.get("name") ?? ""),
    }),
  );
  revalidatePath("/agents");
  redirect(`/agents/${agent.id}?neu=1`);
}

function numberField(formData: FormData, name: string): number | undefined {
  const raw = String(formData.get(name) ?? "")
    .trim()
    .replace(",", ".");
  if (raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw validationError("Bitte eine gültige Zahl eingeben.");
  return value;
}

export async function saveAgentAction(
  agentId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("saveAgent", async () => {
    const ctx = await editorContext();
    requirePermission(ctx.tenant, "agent.publish");
    if (!isUuid(agentId)) throw validationError("Ungültiger Agent.");

    const tools = TOOL_CATALOG.flatMap((tool) => {
      const mode = String(formData.get(`tool:${tool.name}`) ?? "off");
      return mode === "auto" || mode === "approve" ? [{ name: tool.name, mode }] : [];
    });
    // The cost limit is entered in the currency the tenant sees (EUR with a partner rate).
    const limit = numberField(formData, "maxCost");
    const rate = ctx.tenant.usdEurRate;
    const maxCostUsdMicros =
      limit === undefined ? undefined : Math.round((rate ? limit / rate : limit) * 1_000_000);
    const knowledgeCollectionIds = formData.getAll("knowledge").map(String).filter(isUuid);
    const steps = numberField(formData, "maxSteps");
    const roi = numberField(formData, "roiMinutes");

    const version = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      saveAgentVersion(tx, {
        tenantId: ctx.tenant.tenantId,
        agentId,
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
        config: {
          instructions: String(formData.get("instructions") ?? ""),
          tier: String(formData.get("tier") ?? ""),
          effort: String(formData.get("effort") ?? ""),
          tools,
          maxSteps: steps === undefined ? 10 : Math.round(steps),
          ...(maxCostUsdMicros !== undefined ? { maxCostUsdMicros } : {}),
          ...(roi !== undefined ? { roiMinutesPerTask: Math.round(roi) } : {}),
          // Empty = all collections; left out so unchanged agents keep an identical config.
          ...(knowledgeCollectionIds.length > 0 ? { knowledgeCollectionIds } : {}),
        },
        actorId: ctx.user.id,
      }),
    );
    revalidatePath(`/agents/${agentId}`);
    revalidatePath("/agents");
    return { message: `Version ${version.version} ist veröffentlicht.` };
  });
}

export async function restoreVersionAction(
  agentId: string,
  versionId: string,
): Promise<ActionResult> {
  return runAction("restoreVersion", async () => {
    const ctx = await editorContext();
    requirePermission(ctx.tenant, "agent.publish");
    const version = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      restoreAgentVersion(tx, {
        tenantId: ctx.tenant.tenantId,
        agentId,
        versionId,
        actorId: ctx.user.id,
      }),
    );
    revalidatePath(`/agents/${agentId}`);
    return { message: `Wiederhergestellt als Version ${version.version}.` };
  });
}

export async function setAgentStatusAction(
  agentId: string,
  status: "active" | "archived",
): Promise<ActionResult> {
  return runAction("setAgentStatus", async () => {
    const ctx = await editorContext();
    await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      setAgentStatus(tx, { tenantId: ctx.tenant.tenantId, agentId, status, actorId: ctx.user.id }),
    );
    revalidatePath("/agents");
    revalidatePath(`/agents/${agentId}`);
  });
}
