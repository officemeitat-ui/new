import { isAppError, isUuid } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { can, getConversation } from "@nexus/domain";
import { notFound } from "next/navigation";
import { ChatView } from "@/components/chat/chat-view";
import { ACTIVE_RUN_STATUSES, buildTurns } from "@/lib/chat";
import { llmConfigured } from "@/lib/llm";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Chat" };

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  if (!isUuid(conversationId)) notFound();
  const ctx = await requireTenant();

  const data = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    getConversation(tx, {
      tenantId: ctx.tenant.tenantId,
      conversationId,
      userId: ctx.user.id,
      canReadAll: can(ctx.tenant, "conversation.read_all"),
    }),
  ).catch((error: unknown) => {
    if (isAppError(error) && error.code === "not_found") return null;
    throw error;
  });
  if (!data) notFound();

  const turns = buildTurns(data.messages, data.runs);
  const active = data.runs.findLast((run) => ACTIVE_RUN_STATUSES.has(run.status));

  return (
    <ChatView
      conversationId={conversationId}
      turns={turns}
      activeRunId={active?.id ?? null}
      llmConfigured={llmConfigured()}
      usdEurRate={ctx.tenant.usdEurRate}
      examples={[]}
    />
  );
}
