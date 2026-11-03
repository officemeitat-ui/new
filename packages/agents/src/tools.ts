import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/** Risk classes decide the default approval rules (master prompt, section 9.1). */
export type ToolRisk = "read" | "internal_write" | "external_write" | "destructive" | "financial";

export type ToolContext = {
  tenantId: string;
  userId: string | null;
  runId: string;
  /** Stable per tool call: lets external actions be retried without running twice (ADR 0005). */
  idempotencyKey: string;
  signal: AbortSignal;
  now: Date;
};

export type AgentTool<I = unknown> = {
  name: string;
  /** German, written for the model: what the tool does and when to use it. */
  description: string;
  risk: ToolRisk;
  input: z.ZodType<I>;
  run(input: I, ctx: ToolContext): Promise<unknown>;
};

// Tool names must match the API's pattern; connector actions like "mail.send" become "mail__send".
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export function defineTool<S extends z.ZodType>(definition: {
  name: string;
  description: string;
  risk: ToolRisk;
  input: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<unknown>;
}): AgentTool<z.infer<S>> {
  if (!TOOL_NAME.test(definition.name)) {
    throw new Error(`Ungültiger Werkzeugname "${definition.name}" (erlaubt: a-z, 0-9, _ und -).`);
  }
  return definition as AgentTool<z.infer<S>>;
}

export function actionToToolName(actionId: string): string {
  return actionId.replace(/\./g, "__");
}

/**
 * Tool definition for the API. `strict: true` makes the API guarantee schema-valid inputs; the
 * runtime still validates with Zod before running anything (defence in depth).
 */
export function toToolParam(tool: AgentTool): Anthropic.Beta.Messages.BetaTool {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.input) as Record<string, unknown>;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema as Anthropic.Beta.Messages.BetaTool.InputSchema,
    strict: true,
  };
}

/** Sorted by name, so the tool list – part of the cached prefix – is byte-identical every time. */
export function sortTools(tools: readonly AgentTool[]): AgentTool[] {
  return [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
