import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_columns";
import { authUser } from "./auth";
import { tenants } from "./tenancy";

export type ToolMode = "auto" | "approve" | "deny";

/** Versioned agent configuration (Agent Studio, M3). Stored as JSON so versions are immutable. */
export type AgentConfig = {
  instructions: string;
  /** Model tier: smart | balanced | fast (ADR 0006). */
  tier: string;
  effort: string;
  tools: { name: string; mode: ToolMode }[];
  maxSteps: number;
  maxCostUsdMicros?: number;
  /** Manual minutes a human needs per task – basis for ROI (M10). */
  roiMinutesPerTask?: number;
};

export const agents = pgTable(
  "agents",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    status: text().$type<"active" | "archived">().notNull().default("active"),
    isDefault: boolean().notNull().default(false),
    /** Agent template this agent was created from (packages/domain/src/agent-templates.ts). */
    templateId: text(),
    currentVersionId: uuid(),
    createdBy: uuid().references(() => authUser.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("agents_tenant_idx").on(t.tenantId)],
);

export const agentVersions = pgTable(
  "agent_versions",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    config: jsonb().$type<AgentConfig>().notNull(),
    publishedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => authUser.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("agent_versions_agent_version_uq").on(t.agentId, t.version)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** Who started the conversation. Conversations are private unless conversation.read_all. */
    userId: uuid().references(() => authUser.id, { onDelete: "set null" }),
    channel: text().notNull().default("web"),
    title: text().notNull(),
    lastMessageAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("conversations_tenant_user_idx").on(t.tenantId, t.userId, t.lastMessageAt)],
);

/**
 * Messages in the exact Anthropic content format, append-only (thinking blocks must be sent
 * back unchanged). The first user message starts with the <kontext> block.
 */
export const messages = pgTable(
  "messages",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    runId: uuid(),
    seq: integer().notNull(),
    role: text().$type<"user" | "assistant">().notNull(),
    content: jsonb().$type<unknown[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("messages_conversation_seq_uq").on(t.conversationId, t.seq)],
);

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "awaiting_approval"
  | "refused"
  | "incomplete"
  | "max_steps"
  | "budget_exceeded"
  | "cancelled"
  | "failed";

export const runs = pgTable(
  "runs",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    agentId: uuid()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    agentVersionId: uuid()
      .notNull()
      .references(() => agentVersions.id),
    triggeredBy: uuid().references(() => authUser.id, { onDelete: "set null" }),
    status: text().$type<RunStatus>().notNull().default("queued"),
    model: text().notNull(),
    effort: text().notNull(),
    steps: integer().notNull().default(0),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    cacheReadTokens: integer().notNull().default(0),
    cacheWriteTokens: integer().notNull().default(0),
    costUsdMicros: bigint({ mode: "number" }).notNull().default(0),
    finalText: text(),
    error: text(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("runs_conversation_idx").on(t.conversationId),
    index("runs_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

/** Trace of a run (M4, section 8.4): every model call, tool call and approval. */
export const runSteps = pgTable(
  "run_steps",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    runId: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    type: text().$type<"llm" | "thinking" | "tool" | "approval">().notNull(),
    name: text(),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    isError: boolean().notNull().default(false),
    costUsdMicros: bigint({ mode: "number" }).notNull().default(0),
    durationMs: integer(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("run_steps_run_seq_uq").on(t.runId, t.seq)],
);

/** One row per model call – the basis for billing and the partner's margin view (M11, M12). */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    runId: uuid().references(() => runs.id, { onDelete: "set null" }),
    agentId: uuid().references(() => agents.id, { onDelete: "set null" }),
    model: text().notNull(),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    cacheReadTokens: integer().notNull(),
    cacheWriteTokens: integer().notNull(),
    costUsdMicros: bigint({ mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("usage_events_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

export type ApprovalStatus = "pending" | "approved" | "rejected";

/**
 * A tool call that waits for a human decision (M9). The run pauses with status
 * "awaiting_approval" and continues once every approval of the run is decided.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    runId: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    toolUseId: text().notNull(),
    toolName: text().notNull(),
    input: jsonb().$type<Record<string, unknown>>().notNull(),
    status: text().$type<ApprovalStatus>().notNull().default("pending"),
    /** The input as approved, if the person edited it. */
    editedInput: jsonb().$type<Record<string, unknown>>(),
    reason: text(),
    decidedBy: uuid().references(() => authUser.id, { onDelete: "set null" }),
    decidedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("approvals_run_tool_use_uq").on(t.runId, t.toolUseId),
    index("approvals_tenant_status_idx").on(t.tenantId, t.status, t.createdAt),
  ],
);
