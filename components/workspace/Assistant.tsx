"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantAction } from "@/lib/workspace/assistant";
import { ICONS } from "@/components/workspace/Nav";
import { useSpeech } from "@/components/workspace/useSpeech";

type Turn = { role: "user" | "assistant"; text: string; actions?: AssistantAction[] };

const STORAGE_KEY = "arbeitsplatz-assistent-v1";
const SUGGESTIONS = [
  "Was steht heute an?",
  "Welche Tickets warten auf mich?",
  "Erinnere mich morgen um 9 an die Backup-Kontrolle",
  "Trag mir Donnerstag 14 Uhr einen Vor-Ort-Termin ein",
  "Buch 1,5 Stunden bei Huber: Drucker eingerichtet",
];

const ACTION_STYLE: Record<AssistantAction["kind"], { label: string; className: string }> = {
  aufgabe: { label: "Aufgabe", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  erledigt: { label: "Erledigt", className: "bg-slate-50 text-slate-700 ring-slate-200" },
  termin: { label: "Termin", className: "bg-sky-50 text-sky-800 ring-sky-200" },
  entwurf: { label: "E-Mail-Entwurf", className: "bg-violet-50 text-violet-800 ring-violet-200" },
  zeit: { label: "Zeit gebucht", className: "bg-amber-50 text-amber-900 ring-amber-200" },
  stunden: { label: "Stunden gutgeschrieben", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
};

function load(): Turn[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Turn[]) : [];
  } catch {
    return [];
  }
}

function save(turns: Turn[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-40)));
  } catch {
    // Privater Modus o. Ä. – Verlauf bleibt dann nur bis zum Neuladen.
  }
}

function ActionCard({ action }: { action: AssistantAction }) {
  const style = ACTION_STYLE[action.kind];
  const external = action.href?.startsWith("http") || action.href?.startsWith("mailto:");
  const content = (
    <>
      <span className="text-[11px] font-semibold tracking-wide uppercase opacity-80">{style.label}</span>
      <span className="block font-medium">{action.title}</span>
      {action.detail && <span className="block text-sm opacity-80">{action.detail}</span>}
    </>
  );
  const className = `block rounded-xl px-3 py-2 ring-1 ${style.className}`;
  if (!action.href) return <div className={className}>{content}</div>;
  return external ? (
    <a
      href={action.href}
      target={action.href.startsWith("http") ? "_blank" : undefined}
      rel="noreferrer"
      className={`${className} hover:opacity-90`}
    >
      {content}
    </a>
  ) : (
    <Link href={action.href} className={`${className} hover:opacity-90`}>
      {content}
    </Link>
  );
}

function MicButton({ speech }: { speech: ReturnType<typeof useSpeech> }) {
  if (!speech.supported) return null;
  return (
    <button
      type="button"
      onClick={speech.listening ? speech.stop : speech.start}
      aria-label={speech.listening ? "Aufnahme beenden" : "Sprechen"}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
        speech.listening ? "animate-pulse bg-red-500 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {ICONS.assistent}
    </button>
  );
}

export function AssistantChat({ initial }: { initial?: string }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;
      setInput("");
      setBusy(true);
      const history = [...load(), { role: "user" as const, text: question }];
      setTurns(history);
      save(history);
      let reply: Turn;
      try {
        const response = await fetch("/app/api/assistent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ history: history.slice(-20).map(({ role, text }) => ({ role, text })) }),
        });
        const data = (await response.json()) as { text?: string; actions?: AssistantAction[]; error?: string };
        reply = { role: "assistant", text: data.text ?? data.error ?? "Keine Antwort", actions: data.actions ?? [] };
      } catch {
        reply = { role: "assistant", text: "Keine Verbindung – bitte nochmal versuchen." };
      }
      const next = [...history, reply];
      setTurns(next);
      save(next);
      setBusy(false);
      if (reply.actions?.length) router.refresh();
    },
    [busy, router],
  );
  const speech = useSpeech(send);

  useEffect(() => {
    setTurns(load());
  }, []);

  useEffect(() => {
    if (initial && !started.current) {
      started.current = true;
      router.replace("/app/assistent");
      void send(initial);
    }
  }, [initial, router, send]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  return (
    <div className="flex min-h-[calc(100dvh-9rem)] flex-col md:min-h-[calc(100dvh-4rem)]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Assistent</h1>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setTurns([]);
              save([]);
            }}
            className="text-sm text-slate-500 hover:text-slate-900"
          >
            Neues Gespräch
          </button>
        )}
      </div>

      <div className="flex-1 space-y-4 py-4">
        {turns.length === 0 && !busy && (
          <div className="space-y-3">
            <p className="text-slate-600">
              Sag oder schreib einfach, was zu tun ist – Termine, Aufgaben, E-Mail-Entwürfe, Überblick zu Kunden und Tickets.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-full bg-white px-3 py-1.5 text-sm text-slate-700 ring-1 ring-slate-200 hover:ring-brand"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? "flex justify-end" : "space-y-2"}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 whitespace-pre-wrap ${
                turn.role === "user" ? "rounded-br-sm bg-brand text-white" : "rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200"
              }`}
            >
              {turn.text}
            </div>
            {turn.actions && turn.actions.length > 0 && (
              <div className="grid max-w-[85%] gap-2 sm:grid-cols-2">
                {turn.actions.map((action, j) => (
                  <ActionCard key={j} action={action} />
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="w-24 animate-pulse rounded-2xl bg-white px-4 py-2.5 text-slate-400 ring-1 ring-slate-200">…</div>}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex items-end gap-2 rounded-2xl bg-white p-2 shadow-lg ring-1 ring-slate-200 md:bottom-4"
      >
        <MicButton speech={speech} />
        <textarea
          value={speech.listening ? speech.interim || "Ich höre zu …" : input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          placeholder="z. B. „Schreib Maria Huber, dass wir Donnerstag kommen“"
          className="max-h-40 min-h-11 flex-1 resize-none rounded-xl px-3 py-2.5 text-base focus:outline-none"
          aria-label="Nachricht an den Assistenten"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="h-11 shrink-0 rounded-full bg-brand px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          Senden
        </button>
      </form>
      {speech.error && <p className="mt-2 text-sm text-red-600">{speech.error}</p>}
    </div>
  );
}

/** Eingabezeile auf „Heute“: tippen oder sprechen, der Assistent übernimmt. */
export function CommandBar() {
  const router = useRouter();
  const [text, setText] = useState("");
  const go = useCallback(
    (value: string) => value.trim() && router.push(`/app/assistent?frage=${encodeURIComponent(value.trim())}`),
    [router],
  );
  const speech = useSpeech(go);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go(text);
      }}
      className="flex items-center gap-2 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200"
    >
      <MicButton speech={speech} />
      <input
        value={speech.listening ? speech.interim || "Ich höre zu …" : text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Was soll ich erledigen?"
        className="min-w-0 flex-1 px-2 py-2 text-base focus:outline-none"
        aria-label="Auftrag an den Assistenten"
      />
      <button
        type="submit"
        disabled={!text.trim()}
        className="h-11 rounded-full bg-brand px-4 text-sm font-semibold text-white disabled:opacity-40"
      >
        Los
      </button>
    </form>
  );
}
