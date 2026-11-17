import Link from "next/link";
import { notFound } from "next/navigation";
import { setChatMode } from "@/app/admin/chat-actions";
import { AutoRefresh, SimulateChatForm, TeamReplyForm } from "@/components/ChatPanels";
import { requireOwner } from "@/lib/auth";
import { WHATSAPP_WINDOW_MS } from "@/lib/chat/handle";
import { getConversation, listChatMessages, type ChatAuthor } from "@/lib/conversations";
import { formatDateTime } from "@/lib/format";

const bubble: Record<ChatAuthor, string> = {
  kunde: "mr-auto bg-white border border-slate-200",
  ki: "ml-auto bg-brand-soft",
  team: "ml-auto bg-emerald-50 border border-emerald-200",
};
const authorLabel: Record<ChatAuthor, string> = { kunde: "Kunde", ki: "KI-Assistent", team: "Team" };

export default async function ChatPage({ params }: PageProps<"/admin/chats/[id]">) {
  await requireOwner();
  const conversation = await getConversation((await params).id);
  if (!conversation) notFound();
  const messages = await listChatMessages(conversation.id, 200);
  const lastInbound = conversation.lastInboundAt ? new Date(conversation.lastInboundAt).getTime() : 0;
  const outsideWindow = conversation.channel === "whatsapp" && Date.now() - lastInbound > WHATSAPP_WINDOW_MS;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <AutoRefresh />
      <Link href="/admin/chats" className="text-sm font-medium text-brand hover:underline">
        ← Alle Chats
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{conversation.contactName ?? `+${conversation.contact}`}</h1>
          <p className="text-sm text-slate-500">
            {conversation.channel === "whatsapp" ? `WhatsApp +${conversation.contact}` : "Test-Chat"}
            {conversation.leadId && (
              <>
                {" · "}
                <Link href={`/admin/leads/${conversation.leadId}`} className="text-brand hover:underline">
                  Zum Kontakt
                </Link>
              </>
            )}
          </p>
        </div>
        <form action={setChatMode} className="flex items-center gap-3 text-sm">
          <input type="hidden" name="conversationId" value={conversation.id} />
          <input type="hidden" name="mode" value={conversation.mode === "ki" ? "team" : "ki"} />
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${conversation.mode === "ki" ? "bg-brand-soft text-brand" : "bg-amber-100 text-amber-800"}`}
          >
            {conversation.mode === "ki" ? "KI antwortet" : "Team hat übernommen"}
          </span>
          <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium hover:bg-slate-50">
            {conversation.mode === "ki" ? "Selbst übernehmen" : "An KI zurückgeben"}
          </button>
        </form>
      </div>

      <div className="space-y-3 rounded-xl bg-slate-200/50 p-4">
        {messages.map((m) => (
          <div key={m.id} className={`max-w-[85%] rounded-xl px-4 py-2 text-sm shadow-sm ${bubble[m.author]}`}>
            <p className="whitespace-pre-wrap">{m.text}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              {authorLabel[m.author]} · {formatDateTime(m.createdAt)}
              {m.deliveryError && <span className="text-red-600"> · nicht zugestellt: {m.deliveryError}</span>}
            </p>
          </div>
        ))}
      </div>

      <TeamReplyForm
        conversationId={conversation.id}
        disabledReason={
          outsideWindow ? "Letzte Kundennachricht älter als 24 Stunden – WhatsApp erlaubt nur freigegebene Vorlagen." : undefined
        }
      />
      {conversation.channel === "simulation" && (
        <section className="rounded-xl border border-dashed border-slate-300 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Als Kunde weiterschreiben</h2>
          <SimulateChatForm conversationId={conversation.id} />
        </section>
      )}
    </div>
  );
}
