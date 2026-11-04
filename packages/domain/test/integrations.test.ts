import { startMockMicrosoft, type MockMicrosoft } from "@nexus/connectors/testing";
import { clearGraphTokenCache } from "@nexus/connectors";
import { withTenant } from "@nexus/db";
import { openTestDatabase } from "@nexus/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAuditEntries } from "../src/audit";
import {
  adminConsentUrl,
  connectMicrosoft365,
  disconnectIntegration,
  getIntegration,
  listTenantDevices,
  runDeviceAction,
  signConsentState,
  verifyConsentState,
  type MicrosoftAppConfig,
} from "../src/integrations";
import { createPartnerWithTenant } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let mock: MockMicrosoft;
let config: MicrosoftAppConfig;
let fx: Awaited<ReturnType<typeof createPartnerWithTenant>>;

beforeAll(async () => {
  mock = await startMockMicrosoft({
    directoryId: "a2000000-0000-4000-8000-000000000003",
    clientSecret: "geheim",
  });
  config = {
    clientId: "app",
    clientSecret: "geheim",
    loginUrl: mock.loginUrl,
    graphUrl: mock.graphUrl,
  };
  fx = await createPartnerWithTenant(db);
  clearGraphTokenCache();
});
afterAll(async () => {
  await mock.close();
  await handle.close();
});

describe("consent state", () => {
  it("round-trips and rejects tampering and expiry", () => {
    const state = signConsentState({ tenantId: "t1", userId: "u1" }, 1_000);
    expect(verifyConsentState(state, 2_000)).toMatchObject({ tenantId: "t1", userId: "u1" });
    const [payload, signature] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ t: "t2", u: "u1", e: 9e15 })).toString("base64url");
    expect(() => verifyConsentState(`${forged}.${signature}`, 2_000)).toThrow(/Ungültige/);
    expect(() => verifyConsentState(`${payload}.`, 2_000)).toThrow(/Ungültige/);
    expect(() => verifyConsentState(state, 1_000 + 16 * 60_000)).toThrow(/zu lange/);
  });

  it("builds the documented admin consent URL for the proven directory only", () => {
    const url = new URL(
      adminConsentUrl(config, {
        directoryId: mock.directoryId,
        redirectUri: "https://app.example/cb",
        state: "s",
      }),
    );
    expect(url.pathname).toBe(`/login/${mock.directoryId}/adminconsent`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "app",
      redirect_uri: "https://app.example/cb",
      state: "s",
    });
    expect(() =>
      adminConsentUrl(config, { directoryId: "common", redirectUri: "https://x", state: "s" }),
    ).toThrow(/Ungültiges/);
  });

  it("carries the step and the proven directory in the signed state", () => {
    const state = signConsentState({
      tenantId: "t",
      userId: "u",
      step: "consent",
      directoryId: mock.directoryId,
    });
    expect(verifyConsentState(state)).toMatchObject({
      step: "consent",
      directoryId: mock.directoryId,
    });
    expect(verifyConsentState(signConsentState({ tenantId: "t", userId: "u" }))).toMatchObject({
      step: "signin",
      directoryId: null,
    });
  });
});

describe("Microsoft 365 connection", () => {
  it("connects after consent, lists devices and audits actions by device name", async () => {
    const tenantId = fx.tenant.id;
    await expect(
      connectMicrosoft365(db, {
        tenantId,
        directoryTenantId: "nicht-guid",
        actorId: fx.owner.id,
        config,
      }),
    ).rejects.toThrow(/Ungültige/);
    const { displayName } = await connectMicrosoft365(db, {
      tenantId,
      directoryTenantId: mock.directoryId,
      actorId: fx.owner.id,
      config,
    });
    expect(displayName).toBe("Contoso Test GmbH");

    // The same Microsoft directory cannot be linked to a second company.
    const other = await createPartnerWithTenant(db);
    await expect(
      connectMicrosoft365(db, {
        tenantId: other.tenant.id,
        directoryTenantId: mock.directoryId,
        actorId: other.owner.id,
        config,
      }),
    ).rejects.toThrow(/bereits mit einer anderen Firma/);

    const { devices } = await listTenantDevices(db, tenantId, config);
    expect(devices[0]?.deviceName).toBe("LAPTOP-HUBER-01"); // most recent sync first
    const gruber = devices.find((d) => d.deviceName === "LAPTOP-GRUBER-07")!;

    // The name must match the ID – nothing happens otherwise.
    await expect(
      runDeviceAction(db, {
        tenantId,
        deviceId: gruber.id,
        action: "lock",
        expectedName: "LAPTOP-HUBER-01",
        actor: { type: "user", id: fx.owner.id },
        config,
      }),
    ).rejects.toThrow(/nicht zu „LAPTOP-HUBER-01“/);
    expect(mock.calls.some((c) => c.path.endsWith("/remoteLock"))).toBe(false);

    await runDeviceAction(db, {
      tenantId,
      deviceId: gruber.id,
      action: "lock",
      expectedName: "laptop-gruber-07",
      actor: { type: "user", id: fx.owner.id },
      config,
    });
    expect(mock.calls.filter((c) => c.path.endsWith("/remoteLock"))).toHaveLength(1);

    const audit = await withTenant(db, tenantId, (tx) => listAuditEntries(tx, tenantId, 10));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["integration.connected", "device.locked"]),
    );

    await withTenant(db, tenantId, (tx) =>
      disconnectIntegration(tx, { tenantId, provider: "microsoft365", actorId: fx.owner.id }),
    );
    expect(
      await withTenant(db, tenantId, (tx) => getIntegration(tx, tenantId, "microsoft365")),
    ).toBeNull();
    await expect(listTenantDevices(db, tenantId, config)).rejects.toThrow(/nicht verbunden/);
  });
});
