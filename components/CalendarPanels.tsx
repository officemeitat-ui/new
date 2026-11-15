"use client";

import { useActionState } from "react";
import { testCalendarConnection, type ActionState } from "@/app/admin/assistant-actions";

export function CalendarTestButton() {
  const [state, action, pending] = useActionState<ActionState>(testCalendarConnection, {});
  return (
    <form action={action} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Prüfe …" : "Verbindung testen"}
      </button>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state.message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>}
    </form>
  );
}
