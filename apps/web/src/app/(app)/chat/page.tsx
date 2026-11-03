import { isUuid } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { ensureDefaultAgent, listAgents } from "@nexus/domain";
import { getTranslations } from "next-intl/server";
import { ChatView } from "@/components/chat/chat-view";
import { llmConfigured } from "@/lib/llm";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Chat" };

export default async function NewChatPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const ctx = await requireTenant();
  const t = await getTranslations("chat");
  const wanted = (await searchParams).agent;
  const agents = await withTenant(getDatabase().db, ctx.tenant.tenantId, async (tx) => {
    await ensureDefaultAgent(tx, ctx.tenant.tenantId, ctx.user.id);
    return listAgents(tx, ctx.tenant.tenantId);
  });
  return (
    <ChatView
      conversationId={null}
      turns={[]}
      activeRunId={null}
      llmConfigured={llmConfigured()}
      usdEurRate={ctx.tenant.usdEurRate}
      examples={[t("example1"), t("example2"), t("example3")]}
      agents={agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        isDefault: agent.isDefault,
      }))}
      initialAgentId={
        wanted && isUuid(wanted) && agents.some((a) => a.id === wanted) ? wanted : null
      }
    />
  );
}
