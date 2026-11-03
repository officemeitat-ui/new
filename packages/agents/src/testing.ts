/**
 * Test helpers: a scripted stand-in for the SDK client, so the runtime can be tested without
 * network calls or API keys. Not used by production code.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages";
import type { LlmClient, MessageStreamLike } from "./provider";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

type ScriptStep = BetaMessage | ((params: BetaMessageStreamParams) => BetaMessage);

export type ScriptedClient = LlmClient & {
  requests: BetaMessageStreamParams[];
  remaining: () => number;
};

const usage = (input = 100, output = 20, cacheRead = 0, cacheWrite = 0) =>
  ({
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
  }) as BetaMessage["usage"];

function base(
  content: BetaMessage["content"],
  stopReason: BetaMessage["stop_reason"],
): BetaMessage {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: usage(),
  } as unknown as BetaMessage;
}

export function textResponse(text: string, extra: Partial<BetaMessage> = {}): BetaMessage {
  return {
    ...base([{ type: "text", text, citations: null }] as BetaMessage["content"], "end_turn"),
    ...extra,
  };
}

export function toolUseResponse(
  calls: { id: string; name: string; input: unknown }[],
  text?: string,
): BetaMessage {
  const content = [
    ...(text ? [{ type: "text", text, citations: null }] : []),
    { type: "thinking", thinking: "Ich prüfe, welches Werkzeug passt.", signature: "sig" },
    ...calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
  ] as BetaMessage["content"];
  return base(content, "tool_use");
}

export function refusalResponse(category: string | null = "cyber"): BetaMessage {
  return {
    ...base([] as BetaMessage["content"], "refusal"),
    stop_details: { type: "refusal", category, explanation: "Declined by policy." },
  } as unknown as BetaMessage;
}

export function withUsage(
  message: BetaMessage,
  input: number,
  output: number,
  cacheRead = 0,
  cacheWrite = 0,
): BetaMessage {
  return { ...message, usage: usage(input, output, cacheRead, cacheWrite) };
}

/** Replies with the scripted responses in order and records every request. */
export function scriptedClient(script: ScriptStep[]): ScriptedClient {
  const queue = [...script];
  const requests: BetaMessageStreamParams[] = [];
  return {
    requests,
    remaining: () => queue.length,
    beta: {
      messages: {
        stream(params): MessageStreamLike {
          // Deep copy: the runtime keeps appending to its own array.
          requests.push(structuredClone(params));
          const step = queue.shift();
          if (!step) throw new Error("scriptedClient: no scripted response left");
          const message = typeof step === "function" ? step(params) : step;
          const listeners: ((delta: string, snapshot: string) => void)[] = [];
          return {
            on(_event, listener) {
              listeners.push(listener);
              return this;
            },
            async finalMessage() {
              let snapshot = "";
              for (const block of message.content) {
                if (block.type === "text") {
                  for (const word of block.text.split(/(?<= )/)) {
                    snapshot += word;
                    listeners.forEach((l) => l(word, snapshot));
                  }
                }
              }
              return message;
            },
          };
        },
      },
    },
  };
}
