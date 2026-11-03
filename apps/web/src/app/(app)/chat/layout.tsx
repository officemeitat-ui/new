import { getDatabase, withTenant } from "@nexus/db";
import { listConversations } from "@nexus/domain";
import type { ReactNode } from "react";
import { ConversationList } from "@/components/chat/conversation-list";
import { requireTenant } from "@/lib/session";

export default async function ChatLayout({ children }: { children: ReactNode }) {
  const ctx = await requireTenant();
  const conversations = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    listConversations(tx, ctx.tenant.tenantId, ctx.user.id),
  );
  return (
    // Fill the viewport below the top bar; the message list scrolls, the composer stays.
    <div className="-mx-4 -mb-24 -mt-6 flex h-[calc(100dvh_-_7rem_-_env(safe-area-inset-bottom))] md:-mx-8 md:-my-8 md:h-[calc(100dvh-3.5rem)]">
      <aside className="hidden w-64 shrink-0 flex-col border-r lg:flex">
        <ConversationList
          conversations={conversations.map((c) => ({
            id: c.id,
            title: c.title,
            lastMessageAt: c.lastMessageAt.toISOString(),
          }))}
        />
      </aside>
      <section className="flex min-w-0 flex-1 flex-col px-4 md:px-8">{children}</section>
    </div>
  );
}
