"use client";

import { useActionState } from "react";
import { askKnowledgeAction, linkCustomerFolder } from "@/app/app/m365-actions";
import { Submit } from "@/components/workspace/Forms";
import type { DriveFile } from "@/lib/m365";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base md:text-sm focus:border-brand focus:outline-none";

const EXTENSION_STYLE: Record<string, string> = {
  docx: "bg-blue-100 text-blue-800",
  doc: "bg-blue-100 text-blue-800",
  xlsx: "bg-emerald-100 text-emerald-800",
  xls: "bg-emerald-100 text-emerald-800",
  csv: "bg-emerald-100 text-emerald-800",
  pptx: "bg-orange-100 text-orange-800",
  pdf: "bg-red-100 text-red-800",
  aspx: "bg-teal-100 text-teal-800",
};

export function FileList({ files, timeZone }: { files: DriveFile[]; timeZone: string }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      {files.map((file) => {
        const extension = file.folder ? "ordner" : (file.name.split(".").pop() ?? "").toLowerCase();
        return (
          <li key={file.id}>
            <a href={file.webUrl} target="_blank" rel="noreferrer" className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
              <span
                className={`mt-0.5 w-12 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-semibold uppercase ${
                  file.folder ? "bg-amber-100 text-amber-800" : (EXTENSION_STYLE[extension] ?? "bg-slate-100 text-slate-700")
                }`}
              >
                {extension === "aspx" ? "Seite" : extension.slice(0, 5) || "Datei"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{file.name.replace(/\.aspx$/, "")}</span>
                <span className="block text-xs text-slate-500">
                  {[
                    file.location,
                    file.modified &&
                      `geändert ${new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeZone }).format(new Date(file.modified))}`,
                    file.modifiedBy,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {file.summary && <span className="mt-0.5 block text-sm text-slate-600">{file.summary}</span>}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function AskKnowledge({ timeZone }: { timeZone: string }) {
  const [state, action] = useActionState(askKnowledgeAction, {});
  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="font-semibold">Frag die Wissensdatenbank</h2>
      <form action={action} className="flex gap-2">
        <input
          name="question"
          defaultValue={state.question}
          placeholder="z. B. „Wie richten wir einen neuen Mitarbeiter in M365 ein?“"
          className={input}
          aria-label="Frage"
        />
        <Submit>Fragen</Submit>
      </form>
      {state.error && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{state.error}</p>}
      {state.answer && (
        <div className="space-y-2">
          <p className="text-sm whitespace-pre-wrap text-slate-800">{state.answer}</p>
          {state.sources && state.sources.length > 0 && (
            <>
              <p className="text-xs font-semibold text-slate-500">Quellen</p>
              <FileList files={state.sources} timeZone={timeZone} />
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function LinkFolderForm({ customerId }: { customerId: string }) {
  const [state, action] = useActionState(linkCustomerFolder, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="flex gap-2">
        <input
          name="url"
          required
          placeholder="Link zum Kundenordner (in OneDrive/SharePoint: Ordner → Link kopieren)"
          className={input}
          aria-label="Ordner-Link"
        />
        <Submit>Verknüpfen</Submit>
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state.message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>}
    </form>
  );
}
