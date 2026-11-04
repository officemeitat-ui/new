import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "../src/env";

const base = { DATABASE_URL: "postgres://nexus:nexus@localhost:5432/nexus" };

describe("parseEnv", () => {
  it("applies defaults for a minimal development config", () => {
    const env = parseEnv(base);
    expect(env.NODE_ENV).toBe("development");
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.LLM_PROVIDER).toBe("anthropic");
    expect(env.SMTP_PORT).toBe(1025);
  });

  it("treats empty strings as unset", () => {
    const env = parseEnv({ ...base, ANTHROPIC_API_KEY: "", SMTP_PORT: "" });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.SMTP_PORT).toBe(1025);
  });

  it("refuses private connector URLs in production unless the app runs locally", () => {
    const production = {
      ...base,
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "x".repeat(32),
      CONNECTOR_ALLOW_PRIVATE_URLS: "true",
    };
    expect(() => parseEnv({ ...production, APP_URL: "https://app.me-it.at" })).toThrowError(
      /CONNECTOR_ALLOW_PRIVATE_URLS/,
    );
    expect(
      parseEnv({ ...production, APP_URL: "http://localhost:3000" }).CONNECTOR_ALLOW_PRIVATE_URLS,
    ).toBe(true);
  });

  it("requires an auth secret in production", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrowError(EnvError);
  });

  it("reports every problem in readable German", () => {
    try {
      parseEnv({ DATABASE_URL: "mysql://x", BRAND_PRIMARY_COLOR: "blue" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      const message = (error as EnvError).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("BRAND_PRIMARY_COLOR");
    }
  });

  it("requires a project id for Vertex AI", () => {
    expect(() => parseEnv({ ...base, LLM_PROVIDER: "vertex" })).toThrowError(
      /GOOGLE_VERTEX_PROJECT_ID/,
    );
  });
});
