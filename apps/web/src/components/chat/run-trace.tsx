"use client";

import { convertUsdMicros } from "@nexus/core";
import { modelDisplayName } from "@nexus/agents/models";
import { cn } from "@nexus/ui";
import { Brain, Cpu, Hand, Loader2, Wrench } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { getRunTraceAction, type TraceStep } from "@/app/(app)/chat/actions";
import { toolLabel } from "@/lib/chat";

const ICONS = { llm: Cpu, thinking: Brain, tool: Wrench, approval: Hand } as const;

function useMoney(usdEurRate: number | null) {
  const format = useFormatter();
  return (micros: number) => {
    const { amount, currency } = convertUsdMicros(micros, usdEurRate);
    return format.number(amount, { style: "currency", currency, maximumFractionDigits: 4 });
  };
}

function StepRow({ step, usdEurRate }: { step: TraceStep; usdEurRate: number | null }) {
  const t = useTranslations("chat.trace");
  const format = useFormatter();
  const money = useMoney(usdEurRate);
  const Icon = ICONS[step.type];
  const seconds =
    step.durationMs !== null
      ? format.number(step.durationMs / 1000, { maximumFractionDigits: 1 })
      : null;

  let title: string;
  let details: React.ReactNode = null;
  if (step.type === "llm") {
    const usage = step.data.usage as {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
    };
    const reason = String(step.data.stopReason ?? "");
    title = t("llm", { model: modelDisplayName(step.name ?? "") });
    details = (
      <span>
        {[
          t("stopReason", { reason: t.has(`reasons.${reason}`) ? t(`reasons.${reason}`) : reason }),
          t("tokensInOut", {
            input: format.number(usage.inputTokens),
            output: format.number(usage.outputTokens),
          }),
          usage.cacheReadTokens > 0
            ? t("cacheRead", { count: format.number(usage.cacheReadTokens) })
            : null,
          usage.cacheWriteTokens > 0
            ? t("cacheWrite", { count: format.number(usage.cacheWriteTokens) })
            : null,
          seconds ? t("seconds", { seconds }) : null,
          money(step.costUsdMicros),
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    );
  } else if (step.type === "thinking") {
    title = t("thinking");
    details = <span className="whitespace-pre-wrap italic">{String(step.data.text ?? "")}</span>;
  } else if (step.type === "tool") {
    const isCall = step.data.phase === "call";
    title = isCall
      ? t("toolCall", { tool: toolLabel(step.name ?? "") })
      : t("toolResult", { tool: toolLabel(step.name ?? "") });
    const payload = isCall
      ? JSON.stringify(step.data.input, null, 1)
      : String(step.data.output ?? "");
    details = (
      <code className="block max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 font-mono text-[11px]">
        {payload}
        {!isCall && seconds ? `\n(${t("seconds", { seconds })})` : null}
      </code>
    );
  } else {
    title = t("approval");
  }

  return (
    <li className="flex gap-2">
      <Icon
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          step.isError ? "text-danger" : "text-muted-foreground",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className={cn("font-medium", step.isError && "text-danger")}>{title}</p>
        {details ? <div className="text-muted-foreground">{details}</div> : null}
      </div>
    </li>
  );
}

/** Trace of one answer, loaded on demand (master prompt, section 8.4). */
export function RunTrace({ runId, usdEurRate }: { runId: string; usdEurRate: number | null }) {
  const t = useTranslations("chat.trace");
  const [steps, setSteps] = useState<TraceStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (steps || loading) return;
    setLoading(true);
    const result = await getRunTraceAction(runId);
    setLoading(false);
    if (result.ok) setSteps(result.data ?? []);
    else setError(result.error);
  }

  return (
    <details
      className="mt-1 text-xs"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) void load();
      }}
    >
      <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
        {t("show")}
      </summary>
      <div className="mt-2 rounded-md border p-3">
        {loading ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {t("loading")}
          </p>
        ) : error ? (
          <p className="text-danger">{error}</p>
        ) : steps && steps.length === 0 ? (
          <p className="text-muted-foreground">{t("empty")}</p>
        ) : (
          <ol className="space-y-3" aria-label={t("label")}>
            {steps?.map((step) => (
              <StepRow key={step.seq} step={step} usdEurRate={usdEurRate} />
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}
