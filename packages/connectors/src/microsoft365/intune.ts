import type { GraphClient } from "./graph";

/**
 * Intune managed devices (Microsoft Graph v1.0).
 * Resource: https://learn.microsoft.com/graph/api/resources/intune-devices-manageddevice
 */

/** https://learn.microsoft.com/graph/api/resources/intune-devices-compliancestate */
export const COMPLIANCE_STATES = [
  "unknown",
  "compliant",
  "noncompliant",
  "conflict",
  "error",
  "inGracePeriod",
  "configManager",
] as const;
export type ComplianceState = (typeof COMPLIANCE_STATES)[number];

/** The properties we use; Graph returns more. */
export type ManagedDevice = {
  id: string;
  deviceName: string | null;
  userPrincipalName: string | null;
  userDisplayName: string | null;
  operatingSystem: string | null;
  osVersion: string | null;
  complianceState: ComplianceState | string | null;
  lastSyncDateTime: string | null;
  enrolledDateTime: string | null;
  managedDeviceOwnerType: string | null;
  isEncrypted: boolean | null;
  model: string | null;
  manufacturer: string | null;
  serialNumber: string | null;
  totalStorageSpaceInBytes: number | null;
  freeStorageSpaceInBytes: number | null;
};

const DEVICE_ID = /^[0-9a-f-]{36}$/i;

function devicePath(id: string): string {
  if (!DEVICE_ID.test(id)) throw new Error("Ungültige Geräte-ID.");
  return `/deviceManagement/managedDevices/${id}`;
}

/** Upper bound for one listing; SME tenants have far fewer devices. */
export const MAX_DEVICES = 2000;

/** GET /deviceManagement/managedDevices – https://learn.microsoft.com/graph/api/intune-devices-manageddevice-list */
export async function listManagedDevices(graph: GraphClient) {
  return graph.list<ManagedDevice>("/deviceManagement/managedDevices", MAX_DEVICES);
}

/** GET /deviceManagement/managedDevices/{id} – https://learn.microsoft.com/graph/api/intune-devices-manageddevice-get */
export async function getManagedDevice(graph: GraphClient, id: string) {
  return graph.request<ManagedDevice>("GET", devicePath(id));
}

/** POST …/syncDevice (204) – https://learn.microsoft.com/graph/api/intune-devices-manageddevice-syncdevice */
export async function syncDevice(graph: GraphClient, id: string) {
  await graph.request("POST", `${devicePath(id)}/syncDevice`);
}

/** POST …/rebootNow (204) – https://learn.microsoft.com/graph/api/intune-devices-manageddevice-rebootnow */
export async function rebootDevice(graph: GraphClient, id: string) {
  await graph.request("POST", `${devicePath(id)}/rebootNow`);
}

/** POST …/remoteLock (204) – https://learn.microsoft.com/graph/api/intune-devices-manageddevice-remotelock */
export async function lockDevice(graph: GraphClient, id: string) {
  await graph.request("POST", `${devicePath(id)}/remoteLock`);
}

/** GET /organization – https://learn.microsoft.com/graph/api/organization-list */
export async function getOrganizationName(graph: GraphClient): Promise<string | null> {
  const result = await graph.request<{ value?: { displayName?: string }[] }>(
    "GET",
    "/organization",
  );
  return result.value?.[0]?.displayName ?? null;
}

export type DeviceFilter = {
  /** Matches device name, user, e-mail, model or serial number. */
  query?: string;
  onlyProblems?: boolean;
  staleDays?: number;
};

/** Devices that need attention: not compliant, not encrypted or not synced for a while. */
export function deviceProblems(device: ManagedDevice, now = new Date(), staleDays = 7): string[] {
  const problems: string[] = [];
  if (
    device.complianceState === "noncompliant" ||
    device.complianceState === "error" ||
    device.complianceState === "conflict"
  ) {
    problems.push("nicht_konform");
  }
  if (device.isEncrypted === false) problems.push("nicht_verschluesselt");
  if (device.lastSyncDateTime) {
    const age = now.getTime() - new Date(device.lastSyncDateTime).getTime();
    if (age > staleDays * 86_400_000) problems.push("lange_nicht_synchronisiert");
  }
  return problems;
}

export function filterDevices(devices: ManagedDevice[], filter: DeviceFilter, now = new Date()) {
  const query = filter.query?.trim().toLowerCase();
  return devices.filter((device) => {
    if (filter.onlyProblems && deviceProblems(device, now, filter.staleDays).length === 0)
      return false;
    if (!query) return true;
    return [
      device.deviceName,
      device.userPrincipalName,
      device.userDisplayName,
      device.model,
      device.serialNumber,
    ].some((field) => field?.toLowerCase().includes(query));
  });
}
