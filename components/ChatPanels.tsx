"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { sendTeamReply, simulateChat, type ChatActionState } from "@/app/admin/chat-actions";

function ErrorNote({ state }: { state: ChatActionState }) {
  return state.error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null;
}

/** Eingabe für den Test-Chat (als Kunde schreiben). */
export function SimulateChatForm({ conversationId }: { conversationId?: string }) {
  const [state, action, pending] = useActionState(simulateChat, {});
  const [text, setText] = useState("");
  useEffect(() => {
    if (state.ok) setText("");
  }, [state]);
  return (
    <form action={action} className="space-y-3">
      {conversationId ? <input type="hidden" name="conversationId" value={conversationId} /> : null}
      {!conversationId && (
        <input
          name="name"
          placeholder="Name des Test-Kunden"
          defaultValue="Peter Berger"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      )}
      <div className="flex gap-2">
        <input
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={conversationId ? "Als Kunde antworten …" : "z. B. Grüß Gott, hätten Sie diese Woche Zeit für ein Pickerl?"}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? "KI antwortet …" : "Senden"}
        </button>
      </div>
      <ErrorNote state={state} />
    </form>
  );
}

export function TeamReplyForm({ conversationId, disabledReason }: { conversationId: string; disabledReason?: string }) {
  const [state, action, pending] = useActionState(sendTeamReply, {});
  const [text, setText] = useState("");
  useEffect(() => {
    if (state.ok) setText("");
  }, [state]);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <div className="flex gap-2">
        <input
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={Boolean(disabledReason)}
          placeholder={disabledReason ?? "Als Team antworten (der Assistent pausiert dann in diesem Gespräch) …"}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={pending || Boolean(disabledReason)}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
        >
          Senden
        </button>
      </div>
      <ErrorNote state={state} />
    </form>
  );
}

/** Lädt die Seite regelmäßig neu, damit neue WhatsApp-Nachrichten ohne Klick erscheinen. */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
