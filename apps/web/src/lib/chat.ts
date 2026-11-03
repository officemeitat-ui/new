/** Turns stored Anthropic-format messages and runs into what the chat shows. Pure, so it is testable. */

type Block = { type?: string; text?: string; name?: string; is_error?: boolean };

export type StoredMessage = {
  runId: string | null;
  role: "user" | "assistant";
  content: unknown[];
};

export type StoredRun = {
  id: string;
  status: string;
  model: string;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsdMicros: number;
  error: string | null;
};

export type ChatTurn = {
  runId: string;
  userText: string;
  assistantText: string;
  tools: { name: string; isError: boolean }[];
  status: string;
  model: string;
  steps: number;
  tokens: number;
  cacheReadTokens: number;
  costUsdMicros: number;
  error: string | null;
};

export const ACTIVE_RUN_STATUSES = new Set(["queued", "running"]);

const blocks = (content: unknown[]): Block[] =>
  content.filter((b): b is Block => typeof b === "object" && b !== null);

export function buildTurns(messages: StoredMessage[], runs: StoredRun[]): ChatTurn[] {
  return runs.map((run) => {
    const own = messages.filter((m) => m.runId === run.id);
    const userText = own
      .filter((m) => m.role === "user")
      .flatMap((m) => blocks(m.content))
      .filter((b) => b.type === "text" && b.text && !b.text.startsWith("<kontext>"))
      .map((b) => b.text)
      .join("\n\n");
    const assistantBlocks = own
      .filter((m) => m.role === "assistant")
      .flatMap((m) => blocks(m.content));
    const results = own.filter((m) => m.role === "user").flatMap((m) => blocks(m.content));
    const errors = results.filter((b) => b.type === "tool_result").map((b) => Boolean(b.is_error));
    const tools = assistantBlocks
      .filter((b) => b.type === "tool_use" && b.name)
      .map((b, index) => ({ name: b.name!, isError: errors[index] ?? false }));
    const texts = assistantBlocks.filter((b) => b.type === "text" && b.text).map((b) => b.text!);
    return {
      runId: run.id,
      userText,
      // The last text is the answer; earlier texts were interim notes between tool calls.
      assistantText: texts.at(-1) ?? "",
      tools,
      status: run.status,
      model: run.model,
      steps: run.steps,
      tokens: run.inputTokens + run.outputTokens + run.cacheReadTokens + run.cacheWriteTokens,
      cacheReadTokens: run.cacheReadTokens,
      costUsdMicros: run.costUsdMicros,
      error: run.error,
    };
  });
}

export const TOOL_LABELS: Record<string, string> = {
  rechner: "Rechner",
  aktuelle_zeit: "Datum und Uhrzeit",
  email_senden: "E-Mail senden",
  wissen_suchen: "Wissensdatenbank",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/__/g, ".");
}
