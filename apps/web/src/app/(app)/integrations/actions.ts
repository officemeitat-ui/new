"use server";

import { isUuid, validationError } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import {
  disconnectIntegration,
  requirePermission,
  runDeviceAction,
  type DeviceAction,
} from "@nexus/domain";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireTenant } from "@/lib/session";

export async function disconnectMicrosoftAction(): Promise<ActionResult> {
  return runAction("disconnectMicrosoft", async () => {
    const ctx = await requireTenant();
    requirePermission(ctx.tenant, "integration.manage");
    await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
      disconnectIntegration(tx, {
        tenantId: ctx.tenant.tenantId,
        provider: "microsoft365",
        actorId: ctx.user.id,
      }),
    );
    revalidatePath("/integrations");
    revalidatePath("/devices");
    return { message: "Die Verbindung zu Microsoft 365 ist getrennt." };
  });
}

const ACTIONS: Record<DeviceAction, string> = {
  sync: "Synchronisierung angefordert",
  restart: "Neustart angefordert",
  lock: "Sperre angefordert",
};

/** Device actions from the "Geräte" page; the device name is checked against the ID. */
export async function deviceActionAction(input: {
  deviceId: string;
  deviceName: string;
  action: DeviceAction;
}): Promise<ActionResult> {
  return runAction("deviceAction", async () => {
    const ctx = await requireTenant();
    requirePermission(ctx.tenant, "integration.manage");
    if (!isUuid(input.deviceId) || !(input.action in ACTIONS)) {
      throw validationError("Ungültige Anfrage.");
    }
    const device = await runDeviceAction(getDatabase().db, {
      tenantId: ctx.tenant.tenantId,
      deviceId: input.deviceId,
      action: input.action,
      expectedName: input.deviceName,
      actor: { type: "user", id: ctx.user.id },
    });
    revalidatePath("/devices");
    return { message: `${ACTIONS[input.action]}: ${device.deviceName ?? input.deviceName}.` };
  });
}
