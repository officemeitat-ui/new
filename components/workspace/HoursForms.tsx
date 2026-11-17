"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addHourPackage, bookTime, type WorkspaceActionState } from "@/app/app/actions";
import { Submit } from "@/components/workspace/Forms";
import { formatHours, parseDuration } from "@/lib/workspace/format";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base md:text-sm focus:border-brand focus:outline-none";

function Feedback({ state }: { state: WorkspaceActionState }) {
  if (state.error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>;
  return null;
}

type CustomerOption = { id: string; name: string };

function CustomerSelect({ customers, customerId }: { customers: CustomerOption[]; customerId?: string }) {
  if (customerId) return <input type="hidden" name="customerId" value={customerId} />;
  return (
    <label className="text-xs text-slate-500 sm:col-span-2">
      Kunde
      <select name="customerId" required defaultValue="" className={input}>
        <option value="" disabled>
          Kunde wählen …
        </option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Zeit buchen: Dauer als „1,5“, „1:30“ oder „45 min“. Standard: vom Stundenpaket abziehen. */
export function TimeEntryForm({
  customers,
  customerId,
  ticketId,
  defaultDescription,
  today,
  roundTo,
}: {
  customers: CustomerOption[];
  customerId?: string;
  ticketId?: string;
  defaultDescription?: string;
  today: string;
  roundTo: number;
}) {
  const [state, action] = useActionState(bookTime, {});
  const [duration, setDuration] = useState("");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      form.current?.reset();
      setDuration("");
    }
  }, [state]);
  const parsed = parseDuration(duration);
  const rounded = parsed && roundTo > 0 ? Math.ceil(parsed / roundTo) * roundTo : parsed;

  return (
    <form ref={form} action={action} className="space-y-3">
      {ticketId && <input type="hidden" name="ticketId" value={ticketId} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <CustomerSelect customers={customers} customerId={customerId} />
        <label className="text-xs text-slate-500">
          Dauer
          <input
            name="duration"
            required
            inputMode="decimal"
            placeholder="z. B. 1,5 oder 1:30 oder 45 min"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className={input}
          />
          <span className="mt-1 block h-4 text-slate-500">
            {duration &&
              (rounded
                ? `= ${formatHours(rounded)}${rounded !== parsed ? ` (aufgerundet auf ${roundTo} Min.)` : ""}`
                : "Format nicht erkannt")}
          </span>
        </label>
        <label className="text-xs text-slate-500">
          Datum
          <input type="date" name="date" defaultValue={today} className={input} />
        </label>
        <label className="text-xs text-slate-500 sm:col-span-2">
          Tätigkeit
          <input
            name="description"
            required
            defaultValue={defaultDescription}
            placeholder="z. B. Outlook-Profil neu eingerichtet"
            className={input}
          />
        </label>
        <fieldset className="text-xs text-slate-500 sm:col-span-2">
          <legend>Abrechnung</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {[
              ["kontingent", "Vom Stundenpaket abziehen"],
              ["verrechnen", "Separat verrechnen"],
              ["intern", "Nicht verrechnen"],
            ].map(([value, label]) => (
              <label
                key={value}
                className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200 has-[:checked]:bg-brand-soft has-[:checked]:text-brand has-[:checked]:ring-brand"
              >
                <input type="radio" name="mode" value={value} defaultChecked={value === "kontingent"} className="accent-current" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <Feedback state={state} />
      <Submit>Zeit buchen</Submit>
    </form>
  );
}

/** Vorab bezahlte Stunden gutschreiben (z. B. 10-Stunden-Paket). */
export function PackageForm({ customers, customerId, today }: { customers: CustomerOption[]; customerId?: string; today: string }) {
  const [state, action] = useActionState(addHourPackage, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <CustomerSelect customers={customers} customerId={customerId} />
        <label className="text-xs text-slate-500">
          Stunden
          <input name="hours" required inputMode="decimal" placeholder="z. B. 10" className={input} />
        </label>
        <label className="text-xs text-slate-500">
          Bezahlt am
          <input type="date" name="date" defaultValue={today} className={input} />
        </label>
        <label className="text-xs text-slate-500">
          Betrag (optional)
          <input name="price" inputMode="decimal" placeholder="z. B. 950,00" className={input} />
        </label>
        <label className="text-xs text-slate-500">
          Rechnung / Notiz (optional)
          <input name="reference" placeholder="z. B. RE 2026-118" className={input} />
        </label>
      </div>
      <Feedback state={state} />
      <Submit>Stunden gutschreiben</Submit>
    </form>
  );
}
