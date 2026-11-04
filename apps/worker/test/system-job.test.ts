import { createLogger } from "@nexus/core/logger";
import { openTestDatabase } from "@nexus/db/testing";
import { afterAll, describe, expect, it } from "vitest";
import { handleSystemJob } from "../src/jobs/system";

const handle = openTestDatabase();
afterAll(() => handle.close());

describe("system jobs", () => {
  it("answers ping", async () => {
    const result = await handleSystemJob({ name: "ping", id: "1" });
    expect(result).toMatchObject({ pong: true });
  });

  it("runs the nightly retention", async () => {
    const result = await handleSystemJob(
      { name: "retention", id: "2" },
      { db: handle.db, log: createLogger("test") },
    );
    expect(result).toMatchObject({ retention: { tenants: expect.any(Number) } });
  });

  it("rejects unknown jobs instead of silently succeeding", async () => {
    await expect(handleSystemJob({ name: "nope", id: "3" })).rejects.toThrow(/Unbekannter/);
  });
});
