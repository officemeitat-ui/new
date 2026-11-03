import { describe, expect, it } from "vitest";
import { buildTurns, type StoredRun } from "../src/lib/chat";

const run = (id: string, status = "completed"): StoredRun => ({
  id,
  status,
  model: "claude-opus-5-5",
  steps: 2,
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 400,
  cacheWriteTokens: 0,
  costUsdMicros: 1234,
  error: null,
});

describe("buildTurns", () => {
  it("hides the context block, keeps the final answer and lists tools", () => {
    const turns = buildTurns(
      [
        {
          runId: "r1",
          role: "user",
          content: [
            { type: "text", text: "<kontext>\nDatum: …\n</kontext>" },
            { type: "text", text: "Was sind 20 % von 50?" },
          ],
        },
        {
          runId: "r1",
          role: "assistant",
          content: [
            { type: "thinking", thinking: "…" },
            { type: "text", text: "Ich rechne nach." },
            { type: "tool_use", id: "t", name: "rechner", input: {} },
          ],
        },
        {
          runId: "r1",
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t", content: "10" }],
        },
        { runId: "r1", role: "assistant", content: [{ type: "text", text: "Das sind 10." }] },
      ],
      [run("r1")],
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      userText: "Was sind 20 % von 50?",
      assistantText: "Das sind 10.",
      tools: [{ name: "rechner", isError: false }],
      tokens: 520,
    });
  });

  it("shows a queued run with the user's text and no answer yet", () => {
    const turns = buildTurns(
      [{ runId: "r2", role: "user", content: [{ type: "text", text: "Hallo" }] }],
      [run("r2", "queued")],
    );
    expect(turns[0]).toMatchObject({ userText: "Hallo", assistantText: "", status: "queued" });
  });
});
