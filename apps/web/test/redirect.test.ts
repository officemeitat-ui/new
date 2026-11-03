import { describe, expect, it } from "vitest";
import { safeNextPath } from "../src/lib/redirect";

describe("safeNextPath", () => {
  it("keeps paths inside the app", () => {
    expect(safeNextPath("/settings/members?tab=1")).toBe("/settings/members?tab=1");
  });

  it.each([
    undefined,
    null,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
  ])("falls back to / for %s", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });
});
