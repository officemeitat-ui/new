import { describe, expect, it } from "vitest";
import { isActive, visibleNavItems } from "../src/components/shell/nav";

describe("navigation", () => {
  it("marks the start page only on /", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/settings", "/")).toBe(false);
  });

  it("marks sections including their sub pages", () => {
    expect(isActive("/settings/members", "/settings")).toBe(true);
    expect(isActive("/settingsX", "/settings")).toBe(false);
  });

  it("shows the partner console only to partner staff", () => {
    expect(visibleNavItems(false).some((item) => item.key === "partner")).toBe(false);
    expect(visibleNavItems(true).some((item) => item.key === "partner")).toBe(true);
  });
});
