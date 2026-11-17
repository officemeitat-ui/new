"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { rereadReceipt, saveReceipt, type ReceiptActionState } from "@/app/admin/beleg-actions";

function Feedback({ state }: { state: ReceiptActionState }) {
  if (state.error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>;
  return null;
}

function SubmitButton({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        primary
          ? "rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
          : "rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
      }
    >
      {pending ? "Bitte warten …" : children}
    </button>
  );
}

type UploadResult = { stored?: number; duplicates?: number; skipped?: number; error?: string };

/** Belege hochladen – eine Datei nach der anderen, jede wird sofort ausgelesen. */
export function ReceiptUpload({ receiptId, label = "Belege hochladen" }: { receiptId?: string; label?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<{ busy: boolean; lines: string[] }>({ busy: false, lines: [] });

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setStatus({ busy: true, lines: [] });
    const lines: string[] = [];
    for (const [index, file] of list.entries()) {
      setStatus({ busy: true, lines: [...lines, `${index + 1}/${list.length}: ${file.name} wird ausgelesen …`] });
      const body = new FormData();
      body.append("file", file);
      if (receiptId) body.append("receiptId", receiptId);
      try {
        const response = await fetch("/admin/belege/upload", { method: "POST", body });
        const result = (await response.json().catch(() => ({ error: `HTTP ${response.status}` }))) as UploadResult;
        lines.push(
          result.error
            ? `✗ ${result.error}`
            : result.stored
              ? `✓ ${file.name} abgelegt`
              : result.duplicates
                ? `• ${file.name} war schon abgelegt`
                : `• ${file.name} ist laut KI kein Beleg (z. B. Lieferschein) – nicht abgelegt`,
        );
      } catch {
        lines.push(`✗ ${file.name}: Upload fehlgeschlagen`);
      }
    }
    setStatus({ busy: false, lines });
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <label
        className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand-soft ${status.busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <input
          type="file"
          multiple={!receiptId}
          accept="application/pdf,image/jpeg,image/png,image/webp,.xml"
          className="sr-only"
          disabled={status.busy}
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = "";
          }}
        />
        {status.busy ? "Wird hochgeladen …" : label}
      </label>
      {status.lines.length > 0 && (
        <ul className="space-y-0.5 text-sm text-slate-600">
          {status.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type ReceiptFormValues = {
  id: string;
  supplier: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  gross: string;
  net: string;
  vat: string;
  currency: string;
  paid: "ja" | "nein" | "";
  description: string;
  docType: string;
  status: string;
};

const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

export function ReceiptEditForm({ values, hasFile }: { values: ReceiptFormValues; hasFile: boolean }) {
  const [state, action] = useActionState(saveReceipt, {});
  const [rereadState, reread] = useActionState(rereadReceipt, {});
  const field = (name: keyof ReceiptFormValues, label: string, type = "text", placeholder?: string) => (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input name={name} type={type} defaultValue={values[name]} placeholder={placeholder} className={input} />
    </label>
  );
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={values.id} />
        {/* Nach „Neu auslesen“ neue Werte übernehmen; die Rückmeldung oben bleibt dabei erhalten. */}
        <div key={JSON.stringify(values)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {field("supplier", "Lieferant")}
            {field("invoiceNumber", "Rechnungsnummer")}
            {field("invoiceDate", "Belegdatum", "date")}
            {field("dueDate", "Fällig am", "date")}
            {field("gross", "Brutto", "text", "z. B. 1.234,56")}
            {field("net", "Netto")}
            {field("vat", "USt")}
            {field("currency", "Währung")}
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Art</span>
              <select name="docType" defaultValue={values.docType} className={input}>
                <option value="rechnung">Rechnung</option>
                <option value="gutschrift">Gutschrift</option>
                <option value="mahnung">Mahnung</option>
                <option value="sonstiger_beleg">Sonstiger Beleg</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Bezahlt</span>
              <select name="paid" defaultValue={values.paid} className={input}>
                <option value="">unbekannt</option>
                <option value="ja">ja (Karte, Abbuchung …)</option>
                <option value="nein">nein, noch offen</option>
              </select>
            </label>
          </div>
          {field("description", "Beschreibung")}
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Status</span>
            <select name="status" defaultValue={values.status} className={input}>
              <option value="neu">Bereit für die Buchhaltung</option>
              <option value="pruefen">Prüfen</option>
              <option value="fehlt">Datei fehlt</option>
              <option value="exportiert">An die Buchhaltung übergeben</option>
            </select>
          </label>
        </div>
        <Feedback state={state} />
        <SubmitButton primary>Speichern</SubmitButton>
      </form>
      {hasFile && (
        <form action={reread} className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <input type="hidden" name="id" value={values.id} />
          <SubmitButton>Mit KI neu auslesen</SubmitButton>
          <Feedback state={rereadState} />
        </form>
      )}
    </div>
  );
}
