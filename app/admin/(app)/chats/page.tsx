import Link from "next/link";
import { AutoRefresh, SimulateChatForm } from "@/components/ChatPanels";
import { requireOwner } from "@/lib/auth";
import { listConversations } from "@/lib/conversations";
import { formatDateTime } from "@/lib/format";
import { whatsappConfigured } from "@/lib/whatsapp";

export default async function ChatsPage() {
  await requireOwner();
  const conversations = await listConversations();

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div>
        <h1 className="text-2xl font-bold">Chats</h1>
        <p className="text-sm text-slate-500">
          WhatsApp {whatsappConfigured() ? "verbunden" : "nicht verbunden"} · Der Assistent antwortet sofort und übergibt bei Bedarf an das
          Team.
        </p>
      </div>

      <section className="rounded-xl border border-dashed border-slate-300 bg-white p-5">
        <h2 className="mb-3 font-semibold">Test-Chat starten (für Vorführungen)</h2>
        <SimulateChatForm />
      </section>

      {conversations.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">Noch keine Gespräche.</p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {conversations.map((c) => {
            const waiting = c.mode === "team" && c.lastAuthor === "kunde";
            return (
              <li key={c.id}>
                <Link
                  href={`/admin/chats/${c.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-slate-50"
                >
                  <span className="w-48 font-semibold">{c.contactName ?? `+${c.contact}`}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-600">{c.lastMessage ?? "–"}</span>
                  <span className="flex gap-2 text-xs">
                    {c.channel === "simulation" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Test</span>}
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${c.mode === "ki" ? "bg-brand-soft text-brand" : "bg-amber-100 text-amber-800"}`}
                    >
                      {c.mode === "ki" ? "KI antwortet" : waiting ? "wartet auf Team" : "Team"}
                    </span>
                  </span>
                  <span className="text-xs text-slate-400">{formatDateTime(c.updatedAt)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
