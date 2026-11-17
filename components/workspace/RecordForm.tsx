"use client";

import { useActionState } from "react";
import { saveRecordAction } from "@/app/app/record-actions";
import { Submit } from "@/components/workspace/Forms";
import type { RecordField } from "@/config/records";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base md:text-sm focus:border-brand focus:outline-none";

/** Formular aus der Feldvorlage – für Neu und Bearbeiten. */
export function RecordForm({
  customerId,
  kind,
  fields,
  id,
  initial = {},
  submitLabel = "Speichern",
}: {
  customerId: string;
  kind: string;
  fields: RecordField[];
  id?: string;
  initial?: Record<string, string>;
  submitLabel?: string;
}) {
  const [state, action] = useActionState(saveRecordAction, {});
  const values = state.values ?? initial;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="kind" value={kind} />
      {id && <input type="hidden" name="id" value={id} />}
      {fields.map((field) => {
        const common = { name: field.key, defaultValue: values[field.key] ?? "", placeholder: field.placeholder, required: field.required };
        if (field.type === "boolean") {
          return (
            <label key={field.key} className="flex items-center gap-2 self-end py-2 text-sm text-slate-700">
              <input type="checkbox" name={field.key} defaultChecked={values[field.key] === "ja"} className="h-4 w-4" /> {field.label}
            </label>
          );
        }
        return (
          <label key={field.key} className={`text-xs text-slate-500 ${field.wide || field.type === "textarea" ? "sm:col-span-2" : ""}`}>
            {field.label}
            {field.required && <span className="text-red-500"> *</span>}
            {field.type === "textarea" ? (
              <textarea {...common} rows={3} className={input} />
            ) : field.type === "select" ? (
              <select {...common} className={input}>
                <option value="">–</option>
                {field.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                {...common}
                type={field.type === "phone" ? "tel" : field.type === "number" ? "text" : field.type}
                inputMode={field.type === "number" ? "decimal" : undefined}
                className={input}
              />
            )}
          </label>
        );
      })}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Submit>{submitLabel}</Submit>
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
        {state.message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>}
      </div>
    </form>
  );
}
