"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  addRack,
  addRackEntry,
  createDocPage,
  importBookstackPages,
  importPatchList,
  linkBookstackBook,
  publishCabling,
  saveDocPage,
  savePatchPort,
  type DocActionState,
} from "@/app/app/doku-actions";
import { Submit } from "@/components/workspace/Forms";
import { renderMarkdown } from "@/lib/workspace/markdown";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base md:text-sm focus:border-brand focus:outline-none";

function Feedback({ state }: { state: DocActionState }) {
  return (
    <>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state.message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>}
      {state.warning && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{state.warning}</p>}
    </>
  );
}

/** Formular, das sich nach Erfolg leert. */
function useResetOnSuccess(state: DocActionState) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return form;
}

export function NewPageForm({ customerId, templates }: { customerId: string; templates: string[] }) {
  const [state, action] = useActionState(createDocPage, {});
  return (
    <form action={action} className="flex flex-wrap gap-2">
      <input type="hidden" name="customerId" value={customerId} />
      <input name="title" placeholder="Titel der neuen Seite" className={`${input} min-w-0 flex-1`} />
      <select name="template" defaultValue="" className={`${input} w-auto`} aria-label="Vorlage">
        <option value="">leer</option>
        {templates.map((t) => (
          <option key={t} value={t}>
            Vorlage: {t}
          </option>
        ))}
      </select>
      <Submit>Seite anlegen</Submit>
      <div className="w-full">
        <Feedback state={state} />
      </div>
    </form>
  );
}

/** Markdown-Editor mit Vorschau. */
export function PageEditor({ page }: { page: { id: string; title: string; content: string } }) {
  const [state, action] = useActionState(saveDocPage, {});
  const [content, setContent] = useState(page.content);
  const [preview, setPreview] = useState(false);
  const html = useMemo(() => (preview ? renderMarkdown(content) : ""), [preview, content]);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={page.id} />
      <input name="title" defaultValue={page.title} required className={`${input} text-lg font-semibold`} aria-label="Titel" />
      <div className="flex gap-1 text-sm font-medium">
        {[
          [false, "Schreiben"],
          [true, "Vorschau"],
        ].map(([value, label]) => (
          <button
            key={String(label)}
            type="button"
            onClick={() => setPreview(value as boolean)}
            className={`rounded-full px-3 py-1 ${preview === value ? "bg-brand text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        name="content"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={18}
        className={`${input} font-mono ${preview ? "hidden" : ""}`}
        aria-label="Inhalt (Markdown)"
      />
      {preview && <div className="doc-content rounded-lg bg-white p-4 ring-1 ring-slate-200" dangerouslySetInnerHTML={{ __html: html }} />}
      <p className="text-xs text-slate-500">
        Markdown: <code># Überschrift</code>, <code>- Liste</code>, <code>**fett**</code>, Tabellen mit <code>| A | B |</code>. Keine
        Passwörter – die gehören in Keeper.
      </p>
      <Feedback state={state} />
      <Submit>Speichern</Submit>
    </form>
  );
}

export function RackForm({ customerId }: { customerId: string }) {
  const [state, action] = useActionState(addRack, {});
  const form = useResetOnSuccess(state);
  return (
    <form ref={form} action={action} className="space-y-3">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-500">
          Name
          <input name="name" required placeholder="z. B. Serverschrank" className={input} />
        </label>
        <label className="text-xs text-slate-500">
          Standort
          <input name="location" placeholder="z. B. Keller, Technikraum" className={input} />
        </label>
        <label className="text-xs text-slate-500">
          Höhe (HE)
          <input name="units" type="number" min={1} max={60} defaultValue={42} className={input} />
        </label>
      </div>
      <Feedback state={state} />
      <Submit>Schrank anlegen</Submit>
    </form>
  );
}

export function RackItemForm({
  customerId,
  rackId,
  kinds,
  freeUnit,
}: {
  customerId: string;
  rackId: string;
  kinds: [string, string][];
  freeUnit: number;
}) {
  const [state, action] = useActionState(addRackEntry, {});
  const form = useResetOnSuccess(state);
  return (
    <form ref={form} action={action} className="space-y-3">
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="rackId" value={rackId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-500">
          Gerät
          <input name="name" required placeholder="z. B. SW-Core" className={input} />
        </label>
        <label className="text-xs text-slate-500">
          Art
          <select name="kind" defaultValue="switch" className={input}>
            {kinds.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-500">
            ab HE
            <input name="unitStart" type="number" min={1} defaultValue={freeUnit} required className={input} />
          </label>
          <label className="text-xs text-slate-500">
            Höhe
            <input name="unitHeight" type="number" min={1} max={20} defaultValue={1} className={input} />
          </label>
        </div>
        <label className="text-xs text-slate-500">
          Modell
          <input name="model" placeholder="z. B. HPE Aruba 2930F" className={input} />
        </label>
        <label className="text-xs text-slate-500">
          IP / Verwaltung
          <input name="ip" placeholder="z. B. 192.168.10.2" className={input} />
        </label>
        <label className="text-xs text-slate-500">
          Notiz
          <input name="notes" className={input} />
        </label>
      </div>
      <Feedback state={state} />
      <Submit>Einbauen</Submit>
    </form>
  );
}

type PortRow = {
  id: string;
  panel: string | null;
  panelPort: string | null;
  outlet: string | null;
  room: string | null;
  switchName: string | null;
  switchPort: string | null;
  vlan: string | null;
  device: string | null;
  cable: string | null;
  notes: string | null;
};

export function PatchPortForm({
  customerId,
  fields,
  port,
}: {
  customerId: string;
  fields: { key: keyof Omit<PortRow, "id">; label: string }[];
  port?: PortRow;
}) {
  const [state, action] = useActionState(savePatchPort, {});
  const form = useResetOnSuccess(state);
  return (
    <form ref={form} action={action} className="space-y-3">
      <input type="hidden" name="customerId" value={customerId} />
      {port && <input type="hidden" name="id" value={port.id} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {fields.map(({ key, label }) => (
          <label key={key} className={`text-xs text-slate-500 ${key === "notes" || key === "device" ? "col-span-2" : ""}`}>
            {label}
            <input name={key} defaultValue={port?.[key] ?? ""} className={input} />
          </label>
        ))}
      </div>
      <Feedback state={state} />
      <div className="flex items-center gap-3">
        <Submit>{port ? "Änderungen speichern" : "Anschluss hinzufügen"}</Submit>
        {port && (
          <Link href={`/app/kunden/${customerId}/doku?tab=verkabelung`} className="text-sm text-slate-500 hover:text-slate-900">
            Abbrechen
          </Link>
        )}
      </div>
    </form>
  );
}

export function PatchImportForm({ customerId }: { customerId: string }) {
  const [state, action] = useActionState(importPatchList, {});
  const form = useResetOnSuccess(state);
  return (
    <form ref={form} action={action} className="space-y-3">
      <input type="hidden" name="customerId" value={customerId} />
      <p className="text-sm text-slate-600">
        Excel-Liste als CSV speichern und hier hochladen. Spalten werden an den Überschriften erkannt (Patchfeld, Port, Dose, Raum, Switch,
        Switchport, VLAN, Gerät, Kabel, Bemerkung).
      </p>
      <input type="file" name="file" accept=".csv,text/csv,text/plain" className="block w-full text-sm" />
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-500">… oder Zeilen aus Excel einfügen</summary>
        <textarea
          name="text"
          rows={5}
          placeholder={"Patchfeld;Port;Dose;Raum;Switch;Switchport;VLAN;Gerät"}
          className={`${input} mt-2 font-mono`}
        />
      </details>
      <Feedback state={state} />
      <Submit>Übernehmen</Submit>
    </form>
  );
}

/** Patchliste mit Sofortsuche (Gerät, Raum, Dose, Port …). */
export function PatchTable({
  customerId,
  ports,
  fields,
  onDelete,
}: {
  customerId: string;
  ports: PortRow[];
  fields: { key: keyof Omit<PortRow, "id">; label: string }[];
  onDelete: (formData: FormData) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = ports.filter((p) => {
    const haystack = fields
      .map(({ key }) => p[key] ?? "")
      .join(" ")
      .toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
  const shown = fields.filter(({ key }) => ports.some((p) => p[key]));
  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Suchen: Gerät, Raum, Dose, Port, VLAN …"
        className={input}
        aria-label="Patchliste durchsuchen"
      />
      <p className="text-xs text-slate-500">
        {visible.length} von {ports.length} Anschlüssen
      </p>
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              {shown.map(({ key, label }) => (
                <th key={key} className="px-3 py-2 whitespace-nowrap">
                  {label}
                </th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                {shown.map(({ key }) => (
                  <td
                    key={key}
                    className={`px-3 py-2 ${key === "device" ? "font-medium" : ""} ${key === "notes" ? "min-w-48" : "whitespace-nowrap"}`}
                  >
                    {p[key] ?? ""}
                  </td>
                ))}
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <Link
                    href={`/app/kunden/${customerId}/doku?tab=verkabelung&bearbeiten=${p.id}`}
                    className="text-xs text-brand hover:underline"
                  >
                    Bearbeiten
                  </Link>
                  <form action={onDelete} className="ml-3 inline">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="customerId" value={customerId} />
                    <button type="submit" className="text-xs text-slate-400 hover:text-red-600">
                      Löschen
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BookstackPanel({
  customerId,
  books,
  linkedBookId,
  hasPublished,
}: {
  customerId: string;
  books: { id: number; name: string }[];
  linkedBookId: string | null;
  hasPublished: boolean;
}) {
  const [linkState, link] = useActionState(linkBookstackBook, {});
  const [publishState, publish] = useActionState(publishCabling, {});
  const [importState, importPages] = useActionState(importBookstackPages, {});
  return (
    <div className="space-y-4">
      <form action={link} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="customerId" value={customerId} />
        <label className="min-w-0 flex-1 text-xs text-slate-500">
          Buch in BookStack
          <select name="bookId" defaultValue={linkedBookId ?? ""} className={input}>
            <option value="">– nicht verknüpft –</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <Submit className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
          Verknüpfen
        </Submit>
      </form>
      <Feedback state={linkState} />
      {linkedBookId && (
        <div className="flex flex-wrap gap-2">
          <form action={publish}>
            <input type="hidden" name="customerId" value={customerId} />
            <Submit>{hasPublished ? "Verkabelung in BookStack aktualisieren" : "Verkabelung nach BookStack veröffentlichen"}</Submit>
          </form>
          <form action={importPages}>
            <input type="hidden" name="customerId" value={customerId} />
            <Submit className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
              Seiten aus BookStack übernehmen
            </Submit>
          </form>
        </div>
      )}
      <Feedback state={publishState} />
      <Feedback state={importState} />
    </div>
  );
}
