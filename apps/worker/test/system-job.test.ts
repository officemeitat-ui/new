import { describe, expect, it } from "vitest";
import { handleSystemJob } from "../src/jobs/system";

describe("system jobs", () => {
  it("answers ping", async () => {
    const result = await handleSystemJob({ name: "ping", id: "1" });
    expect(result.pong).toBe(true);
  });

  it("rejects unknown jobs instead of silently succeeding", async () => {
    await expect(handleSystemJob({ name: "nope", id: "2" })).rejects.toThrow(/Unbekannter/);
  });
});
