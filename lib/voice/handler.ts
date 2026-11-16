import "server-only";
import { z } from "zod";
import { runTool, type ToolContext } from "@/lib/assistant/tools";
import { saveCall } from "@/lib/calls";
import { ensureContact } from "@/lib/contacts";
import { addActivity, findLeadByContact, normalizePhone } from "@/lib/leads";
import type { WebhookEvent } from "@/lib/webhook";
import { buildAssistant } from "@/lib/voice/assistant";

// Verarbeitet die Server-Nachrichten von Vapi. Rückgabe: Antwort an Vapi und Ereignisse,
// die die Route nach der Antwort verschickt (Webhook, Benachrichtigungen).

export type HandlerResult = { response: Record<string, unknown>; events: WebhookEvent[] };
type Context = ToolContext;

const Message = z
  .object({
    type: z.string(),
    call: z
      .object({ id: z.string().optional(), customer: z.object({ number: z.string().optional() }).optional() })
      .passthrough()
      .optional(),
    customer: z.object({ number: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const ToolCalls = z.object({
  toolCallList: z.array(
    z.object({
      id: z.string(),
      function: z.object({ name: z.string(), arguments: z.union([z.string(), z.record(z.string(), z.unknown())]) }),
    }),
  ),
});

const EndOfCallReport = z.object({
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  endedReason: z.string().optional(),
  cost: z.number().optional(),
  analysis: z.object({ summary: z.string().optional() }).passthrough().optional(),
  artifact: z.object({ transcript: z.string().optional(), recordingUrl: z.string().optional() }).passthrough().optional(),
});

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Dauer unbekannt";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} Min.`;
}

async function storeCallReport(message: z.infer<typeof Message>, ctx: Context): Promise<void> {
  const report = EndOfCallReport.parse(message);
  const callId = message.call?.id;
  if (!callId) return;
  const phone = ctx.contactPhone ? normalizePhone(ctx.contactPhone) : null;
  const lead = phone ? ((await findLeadByContact({ phone })) ?? (await ensureContact("telefon", { phone }))) : null;
  const started = report.startedAt ? Date.parse(report.startedAt) : NaN;
  const ended = report.endedAt ? Date.parse(report.endedAt) : NaN;
  const durationSeconds = Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : null;
  const summary = report.analysis?.summary ?? null;

  const inserted = await saveCall({
    id: callId,
    leadId: lead?.id ?? null,
    phone,
    startedAt: report.startedAt ?? null,
    endedAt: report.endedAt ?? null,
    durationSeconds,
    endedReason: report.endedReason ?? null,
    summary,
    transcript: report.artifact?.transcript ?? null,
    recordingUrl: report.artifact?.recordingUrl ?? null,
    cost: report.cost ?? null,
  });
  if (!inserted) return;
  if (lead) await addActivity(lead.id, "call", `Anruf (${formatDuration(durationSeconds)}): ${summary ?? "ohne Zusammenfassung"}`);
  ctx.events.push({ event: "call.ended", callId, leadId: lead?.id ?? null, phone, summary });
}

export async function handleVapiMessage(
  rawMessage: unknown,
  options: { serverUrl: string; secret: string; now?: Date },
): Promise<HandlerResult> {
  const message = Message.parse(rawMessage);
  const ctx: Context = {
    now: options.now ?? new Date(),
    channel: "telefon",
    contactPhone: message.call?.customer?.number ?? message.customer?.number,
    events: [],
  };

  switch (message.type) {
    case "assistant-request":
      return {
        response: {
          assistant: buildAssistant({ serverUrl: options.serverUrl, secret: options.secret, now: ctx.now, callerNumber: ctx.contactPhone }),
        },
        events: [],
      };

    case "tool-calls": {
      const { toolCallList } = ToolCalls.parse(message);
      const results = [];
      for (const call of toolCallList) {
        results.push({
          name: call.function.name,
          toolCallId: call.id,
          ...(await runTool(call.function.name, call.function.arguments, ctx)),
        });
      }
      return { response: { results }, events: ctx.events };
    }

    case "end-of-call-report":
      await storeCallReport(message, ctx);
      return { response: {}, events: ctx.events };

    default:
      return { response: {}, events: [] };
  }
}
