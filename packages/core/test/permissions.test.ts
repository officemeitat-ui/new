import { describe, expect, it } from "vitest";
import {
  hasPermission,
  PARTNER_ROLE_PERMISSIONS,
  SUPPORT_PERMISSIONS,
  SYSTEM_TENANT_ROLE_PERMISSIONS,
  TENANT_PERMISSIONS,
} from "../src/permissions";

describe("system roles", () => {
  it("gives owners every tenant permission", () => {
    expect([...SYSTEM_TENANT_ROLE_PERMISSIONS.owner].sort()).toEqual(
      [...TENANT_PERMISSIONS].sort(),
    );
  });

  it("keeps billing and support access with the owner", () => {
    const admin = SYSTEM_TENANT_ROLE_PERMISSIONS.admin;
    expect(hasPermission(admin, "agent.edit")).toBe(true);
    expect(hasPermission(admin, "tenant.billing.manage")).toBe(false);
    expect(hasPermission(admin, "tenant.support_access.manage")).toBe(false);
  });

  it("lets members use agents but not configure them", () => {
    const member = SYSTEM_TENANT_ROLE_PERMISSIONS.member;
    expect(hasPermission(member, "agent.run")).toBe(true);
    expect(hasPermission(member, "agent.edit")).toBe(false);
    expect(hasPermission(member, "integration.manage")).toBe(false);
  });

  it("does not let partner technicians change prices", () => {
    expect(
      hasPermission(PARTNER_ROLE_PERMISSIONS.partner_technician, "partner.pricing.manage"),
    ).toBe(false);
  });

  it("keeps connecting sources and exporting whole collections out of support sessions", () => {
    expect(hasPermission(SUPPORT_PERMISSIONS, "knowledge.manage")).toBe(true);
    expect(hasPermission(SUPPORT_PERMISSIONS, "knowledge.connect")).toBe(false);
    expect(hasPermission(SUPPORT_PERMISSIONS, "knowledge.export")).toBe(false);
    expect(hasPermission(SYSTEM_TENANT_ROLE_PERMISSIONS.admin, "knowledge.export")).toBe(true);
    expect(hasPermission(SYSTEM_TENANT_ROLE_PERMISSIONS.member, "knowledge.export")).toBe(false);
  });
});
