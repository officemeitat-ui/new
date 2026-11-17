"use client";

import { useActionState } from "react";
import { bookServiceAction, saveProfileAction, updateServiceAction, type ContractState } from "@/app/app/vertrag-actions";
import { Submit } from "@/components/workspace/Forms";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base md:text-sm focus:border-brand focus:outline-none";

function Feedback({ state }: { state: ContractState }) {
  if (state.error) return <p className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p className="rounded-lg bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800">{state.message}</p>;
  return null;
}

export function ProfileForm({
  customerId,
  profile,
  packages,
  industries,
}: {
  customerId: string;
  profile: { industry: string | null; employees: number | null; package: string; contractEnd: string | null };
  packages: Record<string, string>;
  industries: string[];
}) {
  const [state, action] = useActionState(saveProfileAction, {});
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-4">
      <input type="hidden" name="customerId" value={customerId} />
      <label className="text-xs text-slate-500">
        Paket
        <select name="package" defaultValue={profile.package} className={input}>
          {Object.entries(packages).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-slate-500">
        Mitarbeiter/innen
        <input name="employees" defaultValue={profile.employees ?? ""} inputMode="numeric" className={input} />
      </label>
      <label className="text-xs text-slate-500">
        Branche
        <input name="industry" defaultValue={profile.industry ?? ""} list="industries" className={input} />
        <datalist id="industries">
          {industries.map((i) => (
            <option key={i} value={i} />
          ))}
        </datalist>
      </label>
      <label className="text-xs text-slate-500">
        Vertrag bis
        <input name="contractEnd" type="date" defaultValue={profile.contractEnd ?? ""} className={input} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-4">
        <Submit>Speichern</Submit>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function BookServiceForm({
  customerId,
  services,
}: {
  customerId: string;
  services: { code: string; name: string; unit: string; price: number }[];
}) {
  const [state, action] = useActionState(bookServiceAction, {});
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[1fr_6rem_7rem_auto]">
      <input type="hidden" name="customerId" value={customerId} />
      <select name="code" className={input} aria-label="Leistung">
        {services.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name} ({s.price.toLocaleString("de-AT")} € / {s.unit})
          </option>
        ))}
      </select>
      <input name="quantity" defaultValue="1" inputMode="decimal" className={input} aria-label="Menge" />
      <input name="price" placeholder="Preis (Katalog)" inputMode="decimal" className={input} aria-label="Sonderpreis" />
      <Submit>Buchen</Submit>
      <div className="sm:col-span-4">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function RemoveService({ customerId, code }: { customerId: string; code: string }) {
  const [, action] = useActionState(bookServiceAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="quantity" value="0" />
      <button type="submit" className="text-xs text-slate-400 hover:text-red-700">
        entfernen
      </button>
    </form>
  );
}

export function ServicePriceForm({ code, price, active }: { code: string; price: number; active: boolean }) {
  const [state, action] = useActionState(updateServiceAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="code" value={code} />
      <input
        name="price"
        defaultValue={String(price).replace(".", ",")}
        inputMode="decimal"
        className={`${input} w-24 text-right`}
        aria-label="Preis"
      />
      <label className="flex items-center gap-1 text-xs text-slate-600">
        <input type="checkbox" name="active" defaultChecked={active} /> aktiv
      </label>
      <Submit className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50">Speichern</Submit>
      {state.error && <span className="text-xs text-red-700">{state.error}</span>}
      {state.message && <span className="text-xs text-emerald-700">✓</span>}
    </form>
  );
}
