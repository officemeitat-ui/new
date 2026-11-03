import { getTranslations } from "next-intl/server";
import { ChatView } from "@/components/chat/chat-view";
import { llmConfigured } from "@/lib/llm";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Chat" };

export default async function NewChatPage() {
  const ctx = await requireTenant();
  const t = await getTranslations("chat");
  return (
    <ChatView
      conversationId={null}
      turns={[]}
      activeRunId={null}
      llmConfigured={llmConfigured()}
      usdEurRate={ctx.tenant.usdEurRate}
      examples={[t("example1"), t("example2"), t("example3")]}
    />
  );
}
