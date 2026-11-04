import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearGraphTokenCache,
  deviceProblems,
  filterDevices,
  getManagedDevice,
  getOrganizationName,
  GraphClient,
  GraphError,
  listManagedDevices,
  lockDevice,
  syncDevice,
  type ManagedDevice,
} from "../src";
import { startMockMicrosoft, type MockMicrosoft } from "../src/testing/mock-microsoft";

let mock: MockMicrosoft;
const client = (overrides: Partial<ConstructorParameters<typeof GraphClient>[0]> = {}) =>
  new GraphClient({
    clientId: "app",
    clientSecret: "geheim",
    directoryTenantId: mock.directoryId,
    loginUrl: mock.loginUrl,
    graphUrl: mock.graphUrl,
    ...overrides,
  });

beforeAll(async () => {
  mock = await startMockMicrosoft({
    directoryId: "a2000000-0000-4000-8000-000000000004",
    clientSecret: "geheim",
    pageSize: 3,
  });
});
afterAll(() => mock.close());
beforeEach(() => {
  mock.calls.length = 0;
  clearGraphTokenCache();
});

describe("GraphClient", () => {
  it("gets an app-only token once and pages through all devices", async () => {
    const graph = client();
    const { items, truncated } = await listManagedDevices(graph);
    expect(items.map((d) => d.deviceName)).toEqual([
      "LAPTOP-HUBER-01",
      "LAPTOP-GRUBER-07",
      "iPhone von Maria",
      "MACBOOK-EMPFANG",
    ]);
    expect(truncated).toBe(false);
    expect(await getOrganizationName(graph)).toBe("Contoso Test GmbH");
    // Two pages plus the organization – but only one token request.
    expect(mock.calls.filter((c) => c.path === "token")).toHaveLength(1);
    expect(mock.calls.filter((c) => c.path === "/deviceManagement/managedDevices")).toHaveLength(2);
  });

  it("calls the documented device actions", async () => {
    const graph = client();
    const id = "a1f0c2d4-0000-4000-8000-000000000002";
    await syncDevice(graph, id);
    await lockDevice(graph, id);
    expect(mock.calls.filter((c) => c.method === "POST" && c.path !== "token")).toEqual([
      { method: "POST", path: `/deviceManagement/managedDevices/${id}/syncDevice` },
      { method: "POST", path: `/deviceManagement/managedDevices/${id}/remoteLock` },
    ]);
    expect((await getManagedDevice(graph, id)).deviceName).toBe("LAPTOP-GRUBER-07");
    await expect(syncDevice(graph, "../../users")).rejects.toThrow(/Ungültige Geräte-ID/);
  });

  it("explains failures without leaking details", async () => {
    await expect(listManagedDevices(client({ clientSecret: "falsch" }))).rejects.toMatchObject({
      code: "invalid_client",
      message: expect.stringMatching(/erneut/),
    });
    await expect(
      getManagedDevice(client(), "a1f0c2d4-0000-4000-8000-0000000000ff"),
    ).rejects.toMatchObject({
      status: 404,
      message: "Der Eintrag wurde in Microsoft 365 nicht gefunden.",
    });
    expect(() => client({ directoryTenantId: "evil.example" })).toThrow(GraphError);
  });

  it("retries after throttling and never follows links to other hosts", async () => {
    const waits: number[] = [];
    let calls = 0;
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/token")) {
        return Response.json({ access_token: "t", expires_in: 3600 });
      }
      calls += 1;
      if (calls === 1) return new Response(null, { status: 429, headers: { "retry-after": "2" } });
      return Response.json({
        value: [{ id: "x" }],
        "@odata.nextLink": "https://evil.example/steal",
      });
    };
    const graph = client({ fetch: fakeFetch, sleep: async (ms) => void waits.push(ms) });
    await expect(graph.list("/deviceManagement/managedDevices", 10)).rejects.toMatchObject({
      code: "foreign_url",
    });
    expect(waits).toEqual([2000]);
  });
});

describe("device filters", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  const device = (extra: Partial<ManagedDevice>): ManagedDevice => ({
    id: "a1f0c2d4-0000-4000-8000-000000000009",
    deviceName: "PC-01",
    userPrincipalName: "eva@contoso.example",
    userDisplayName: "Eva Wolf",
    operatingSystem: "Windows",
    osVersion: "10",
    complianceState: "compliant",
    lastSyncDateTime: "2026-11-03T08:00:00Z",
    enrolledDateTime: null,
    managedDeviceOwnerType: "company",
    isEncrypted: true,
    model: null,
    manufacturer: null,
    serialNumber: "SN123",
    totalStorageSpaceInBytes: null,
    freeStorageSpaceInBytes: null,
    ...extra,
  });

  it("names the problems of a device", () => {
    expect(deviceProblems(device({}), now)).toEqual([]);
    expect(
      deviceProblems(
        device({
          complianceState: "noncompliant",
          isEncrypted: false,
          lastSyncDateTime: "2026-10-01T00:00:00Z",
        }),
        now,
      ),
    ).toEqual(["nicht_konform", "nicht_verschluesselt", "lange_nicht_synchronisiert"]);
  });

  it("filters by text and problems", () => {
    const devices = [device({}), device({ deviceName: "PC-02", complianceState: "noncompliant" })];
    expect(filterDevices(devices, { query: "eva" }, now)).toHaveLength(2);
    expect(
      filterDevices(devices, { query: "sn123", onlyProblems: true }, now).map((d) => d.deviceName),
    ).toEqual(["PC-02"]);
  });
});
