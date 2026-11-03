import { describe, expect, it } from "vitest";
import { evaluateExpression } from "../src/builtin-tools";
import { DEFAULT_TIER_MODELS, resolveModel } from "../src/models";
import { costUsdMicros, DEFAULT_PRICES, priceFor } from "../src/pricing";
import { contextBlock } from "../src/prompt";
import { actionToToolName, defineTool } from "../src/tools";
import { z } from "zod";

describe("evaluateExpression", () => {
  it.each([
    ["1+2*3", 7],
    ["(1+2)*3", 9],
    ["2^3^2", 512],
    ["1.250,5 - 0,5".replace(".", ""), 1250],
    ["-3 + +4", 1],
    ["10 % 4", 2],
    ["1250 * 0,19", 237.5],
  ])("%s = %d", (expression, expected) => {
    expect(evaluateExpression(expression)).toBeCloseTo(expected, 10);
  });

  it.each(["", "2+", "process.exit(1)", "1/0", "alert(1)", "2**", "(1+2"])(
    "rejects %s",
    (expression) => {
      expect(() => evaluateExpression(expression)).toThrow();
    },
  );
});

describe("pricing", () => {
  it("computes micro-dollars including cache reads and writes", () => {
    const price = DEFAULT_PRICES["claude-sonnet-5-5"]!;
    // 1M input = $2, 1M output = $10 → 12,000,000 micro-dollars
    expect(
      costUsdMicros(
        {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        price,
      ),
    ).toBe(12_000_000);
    expect(
      costUsdMicros(
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 10_000, cacheWriteTokens: 1000 },
        price,
      ),
    ).toBe(2000 + 2500);
  });

  it("finds Bedrock model prices", () => {
    expect(priceFor("anthropic.claude-opus-5-5", DEFAULT_PRICES)).toBe(
      DEFAULT_PRICES["claude-opus-5-5"],
    );
  });
});

describe("models", () => {
  it("maps tiers to models, with overrides from the database", () => {
    expect(resolveModel("smart")).toBe(DEFAULT_TIER_MODELS.smart);
    expect(resolveModel("fast", { fast: "claude-haiku-6" })).toBe("claude-haiku-6");
  });
});

describe("tools", () => {
  it("only accepts API-compatible names", () => {
    expect(() =>
      defineTool({
        name: "mail.send",
        description: "x",
        risk: "read",
        input: z.object({}),
        run: async () => 1,
      }),
    ).toThrow(/Ungültiger Werkzeugname/);
    expect(actionToToolName("microsoft365.mail.send")).toBe("microsoft365__mail__send");
  });
});

describe("contextBlock", () => {
  it("puts date, time and user into the conversation, in Vienna time", () => {
    const block = contextBlock({
      now: new Date("2026-11-03T06:30:00Z"),
      userName: "Anna",
      channel: "Web-Chat",
    });
    expect(block).toBe(
      "<kontext>\nDatum: Dienstag, 03.11.2026\nUhrzeit: 07:30 (Europe/Vienna)\nNutzer: Anna\nKanal: Web-Chat\n</kontext>",
    );
  });
});
