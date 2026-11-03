"use client";

import { modelDisplayName } from "@nexus/agents/models";
import { Badge, Button, cn, FieldError } from "@nexus/ui";
import { ArrowUp, Bot, Calculator, Loader2, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { sendMessageAction } from "@/app/(app)/chat/actions";
import { toolLabel, type ChatTurn } from "@/lib/chat";
import { Markdown } from "./markdown";

type LiveRun = { runId: string; text: string; activity: string | null; tools: string[] };

type RunEvent =
  | { type: "llm_request"; step: number }
  | { type: "text_delta"; text: string }
  | { type: "thinking" }
  | { type: "tool_call"; toolName: string }
  | { type: "tool_result"; toolName: string }
  | { type: "done"; status: string; error?: string }
  | { type: string };

const STATUS_NOTE: Record<string, string> = {
  refused: "statusRefused",
  failed: "statusFailed",
  budget_exceeded: "statusBudget",
  max_steps: "statusMaxSteps",
  incomplete: "statusIncomplete",
  awaiting_approval: "statusApproval",
  cancelled: "statusCancelled",
};

function useRunStream(runId: string | null, onDone: () => void) {
  const t = useTranslations("chat");
  const [live, setLive] = useState<LiveRun | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (!runId) return;
    const fresh = (): LiveRun => ({ runId, text: "", activity: t("activityThinking"), tools: [] });
    const source = new EventSource(`/api/runs/${runId}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as RunEvent;
      setLive((previous) => {
        const current = previous?.runId === runId ? previous : fresh();
        switch (event.type) {
          case "text_delta":
            return {
              ...current,
              text: current.text + (event as { text: string }).text,
              activity: null,
            };
          case "llm_request":
            return (event as { step: number }).step > 1
              ? { ...current, activity: t("activityThinking") }
              : current;
          case "tool_call": {
            const name = (event as { toolName: string }).toolName;
            return {
              ...current,
              // Text before a tool call was an interim note; the answer comes after the tools.
              text: "",
              activity: t("activityTool", { tool: toolLabel(name) }),
              tools: [...current.tools, name],
            };
          }
          default:
            return current;
        }
      });
      if (event.type === "done") {
        source.close();
        onDoneRef.current();
      }
    };
    // On network errors the browser reconnects by itself; the stream replays from the start.
    return () => source.close();
  }, [runId, t]);

  if (!runId) return null;
  return live?.runId === runId
    ? live
    : { runId, text: "", activity: t("activityThinking"), tools: [] };
}

function TurnMeta({ turn }: { turn: ChatTurn }) {
  const t = useTranslations("chat");
  const format = useFormatter();
  if (turn.steps === 0) return null;
  const cost = format.number(turn.costUsdMicros / 1_000_000, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  });
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      {[
        modelDisplayName(turn.model),
        t("metaSteps", { count: turn.steps }),
        t("metaTokens", { count: turn.tokens }),
        turn.cacheReadTokens > 0 ? t("metaCached", { count: turn.cacheReadTokens }) : null,
        cost,
      ]
        .filter(Boolean)
        .join(" · ")}
    </p>
  );
}

function ToolChips({ names, errors }: { names: string[]; errors?: boolean[] }) {
  if (names.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {names.map((name, index) => (
        <Badge key={`${name}-${index}`} variant={errors?.[index] ? "danger" : "secondary"}>
          {name === "rechner" ? (
            <Calculator className="size-3" aria-hidden />
          ) : (
            <Wrench className="size-3" aria-hidden />
          )}
          {toolLabel(name)}
        </Badge>
      ))}
    </div>
  );
}

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Bot className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  );
}

export function ChatView({
  conversationId,
  turns,
  activeRunId,
  llmConfigured,
  examples,
}: {
  conversationId: string | null;
  turns: ChatTurn[];
  activeRunId: string | null;
  llmConfigured: boolean;
  examples: string[];
}) {
  const t = useTranslations("chat");
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const live = useRunStream(activeRunId, () => router.refresh());
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = sending || activeRunId !== null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, live?.text, live?.activity]);

  function send(text: string) {
    if (!text.trim() || busy || !llmConfigured) return;
    setError(null);
    startSending(async () => {
      const result = await sendMessageAction(conversationId, text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft("");
      if (!conversationId && result.data) router.push(`/chat/${result.data.conversationId}`);
      else router.refresh();
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(draft);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto" aria-live="polite">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-1 py-4">
          {turns.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-12 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Sparkles className="size-5" aria-hidden />
              </span>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">{t("emptyTitle")}</h2>
                <p className="text-sm text-muted-foreground">{t("emptyDescription")}</p>
              </div>
              <div className="flex max-w-xl flex-wrap justify-center gap-2">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    disabled={!llmConfigured || busy}
                    onClick={() => send(example)}
                    className="rounded-full border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {turns.map((turn) => {
            const isLive = live && live.runId === turn.runId;
            const note = STATUS_NOTE[turn.status];
            return (
              <div key={turn.runId} className="flex flex-col gap-4">
                <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                  {turn.userText}
                </div>
                <AssistantBubble>
                  {isLive ? (
                    <>
                      <ToolChips names={live.tools} />
                      {live.text ? <Markdown text={live.text} /> : null}
                      {live.activity ? (
                        <p className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                          {live.activity}
                        </p>
                      ) : null}
                    </>
                  ) : turn.status === "queued" || turn.status === "running" ? (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      {t("activityThinking")}
                    </p>
                  ) : (
                    <>
                      <ToolChips
                        names={turn.tools.map((tool) => tool.name)}
                        errors={turn.tools.map((tool) => tool.isError)}
                      />
                      {turn.assistantText ? <Markdown text={turn.assistantText} /> : null}
                      {note ? (
                        <p
                          className={cn(
                            "mt-2 flex items-start gap-2 text-sm",
                            turn.status === "failed" || turn.status === "refused"
                              ? "text-danger"
                              : "text-warning",
                          )}
                        >
                          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                          {turn.status === "failed" && turn.error ? turn.error : t(note)}
                        </p>
                      ) : null}
                      <TurnMeta turn={turn} />
                    </>
                  )}
                </AssistantBubble>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <form onSubmit={onSubmit} className="mx-auto w-full max-w-3xl pb-2 pt-3">
        {!llmConfigured ? (
          <p className="mb-2 flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            {t("notConfigured")}
          </p>
        ) : null}
        {error ? <FieldError className="mb-2">{error}</FieldError> : null}
        <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-xs focus-within:border-ring">
          <label htmlFor="chat-input" className="sr-only">
            {t("inputLabel")}
          </label>
          <textarea
            id="chat-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={20_000}
            placeholder={t("placeholder")}
            disabled={!llmConfigured}
            className="max-h-48 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground [field-sizing:content]"
          />
          <Button
            type="submit"
            size="icon"
            aria-label={t("send")}
            disabled={!draft.trim() || busy || !llmConfigured}
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}
          </Button>
        </div>
        <p className="mt-1.5 text-center text-xs text-muted-foreground">{t("disclaimer")}</p>
      </form>
    </div>
  );
}
