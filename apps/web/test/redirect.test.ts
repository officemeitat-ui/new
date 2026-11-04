import { describe, expect, it } from "vitest";
import { safeExternalUrl, safeNextPath } from "../src/lib/redirect";

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

describe("safeExternalUrl", () => {
  it("renders only http(s) links from connected systems", () => {
    expect(safeExternalUrl("https://doku.example/books/a/page/b")).toBe(
      "https://doku.example/books/a/page/b",
    );
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,<script>")).toBeNull();
    expect(safeExternalUrl("kein link")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});
