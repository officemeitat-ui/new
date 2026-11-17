import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

// Claude über Microsoft Azure (Microsoft Foundry): nachgebauter Foundry-Endpunkt.
const requests: { url: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
const foundry: Server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    requests.push({ url: req.url!, headers: req.headers, body });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: JSON.stringify({ antwort: "ok" }) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
});

let ai: typeof import("@/lib/ai");
let aiClient: typeof import("@/lib/ai-client");

beforeAll(async () => {
  await new Promise<void>((resolve) => foundry.listen(0, "127.0.0.1", resolve));
  Object.assign(process.env, {
    AI_PROVIDER: "azure",
    ANTHROPIC_FOUNDRY_BASE_URL: `http://127.0.0.1:${(foundry.address() as AddressInfo).port}/anthropic/`,
    ANTHROPIC_FOUNDRY_API_KEY: "azure-key",
  });
  ai = await import("@/lib/ai");
  aiClient = await import("@/lib/ai-client");
});
afterAll(async () => {
  process.env.AI_PROVIDER = "";
  await new Promise<void>((resolve) => foundry.close(() => resolve()));
});

describe("Claude über Azure", () => {
  it("schickt Anfragen an die Foundry-Ressource – ohne serverseitige Ersatzmodelle", async () => {
    expect(aiClient.aiProvider()).toBe("azure");
    const result = await ai.generateStructured("System", z.object({ antwort: z.string() }), "Frage");
    expect(result).toEqual({ antwort: "ok" });
    const [request] = requests;
    expect(request.url).toMatch(/^\/anthropic\/v1\/messages/);
    expect(request.headers["x-api-key"]).toBe("azure-key");
    expect(request.body.model).toBe("claude-opus-5-5");
    expect(request.body).not.toHaveProperty("fallbacks");
    expect(String(request.headers["anthropic-beta"] ?? "")).not.toContain("server-side-fallback");
  });

  it("nutzt die Ersatzmodelle nur direkt bei Anthropic", () => {
    expect(aiClient.fallbackOptions("claude-opus-5-5")).toEqual({});
    process.env.AI_PROVIDER = "anthropic";
    expect(aiClient.fallbackOptions("claude-opus-5-5")).toEqual({ betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    process.env.AI_PROVIDER = "azure";
  });
});
