import Link from "next/link";
import { business } from "@/config/business";
import { markExported } from "@/app/admin/beleg-actions";
import { ReceiptUpload } from "@/components/ReceiptPanels";
import { requireOwner } from "@/lib/auth";
import { addDays, localDate } from "@/lib/calendar";
import { activeMailbox } from "@/lib/mail/mailbox";
import {
  DOC_TYPE_LABELS,
  listReceipts,
  RECEIPT_STATUS_LABELS,
  receiptMonths,
  type Receipt,
  type ReceiptStatus,
} from "@/lib/receipts/store";

const statusStyle: Record<ReceiptStatus, string> = {
  neu: "bg-emerald-100 text-emerald-800",
  pruefen: "bg-amber-100 text-amber-800",
  fehlt: "bg-red-100 text-red-700",
  exportiert: "bg-slate-100 text-slate-600",
};

const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("de-AT", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

function money(cents: number | null, currency: string | null): string {
  if (cents === null) return "–";
  return new Intl.NumberFormat("de-AT", { style: "currency", currency: currency || "EUR" }).format(cents / 100);
}

const shortDate = (date: string | null) => (date ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : "–");

export default async function BelegePage({ searchParams }: PageProps<"/admin/belege">) {
  await requireOwner();
  const { monat } = await searchParams;
  const today = localDate(new Date(), business.timeZone);
  const current = today.slice(0, 7);
  const previous = addDays(`${current}-01`, -1).slice(0, 7);
  const months = [...new Set([current, previous, ...(await receiptMonths())])].sort().reverse().slice(0, 12);
  const month = typeof monat === "string" && /^\d{4}-\d{2}$/.test(monat) ? monat : current;
  const receipts = await listReceipts(month);

  const withFile = receipts.filter((r) => r.hasFile);
  const count = (status: ReceiptStatus) => receipts.filter((r) => r.status === status).length;
  const euroTotal = receipts
    .filter((r) => r.status !== "fehlt" && (r.currency ?? "EUR") === "EUR" && r.docType !== "mahnung")
    .reduce((sum, r) => sum + (r.docType === "gutschrift" ? -1 : 1) * (r.grossCents ?? 0), 0);
  const readyForExport = count("neu") + count("pruefen");
  const mailbox = activeMailbox();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Belege</h1>
          <p className="text-sm text-slate-500">
            Rechnungen aus dem Postfach ({mailbox ? mailbox.label : "kein Postfach verbunden"}) und hochgeladene Belege – gesammelt pro
            Monat für die Buchhaltung.
          </p>
        </div>
        <ReceiptUpload />
      </div>

      <nav className="flex flex-wrap gap-1 rounded-lg bg-slate-200/60 p-1 text-sm font-medium">
        {months.map((m) => (
          <Link
            key={m}
            href={`/admin/belege?monat=${m}`}
            className={`rounded-md px-3 py-1.5 ${m === month ? "bg-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
          >
            {monthLabel(m)}
          </Link>
        ))}
      </nav>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Belege mit Datei</p>
          <p className="mt-1 text-2xl font-bold">{withFile.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Summe brutto (EUR)</p>
          <p className="mt-1 text-2xl font-bold">{money(euroTotal, "EUR")}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Bitte prüfen</p>
          <p className={`mt-1 text-2xl font-bold ${count("pruefen") > 0 ? "text-amber-600" : ""}`}>{count("pruefen")}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Datei fehlt</p>
          <p className={`mt-1 text-2xl font-bold ${count("fehlt") > 0 ? "text-red-600" : ""}`}>{count("fehlt")}</p>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex-1 text-sm text-slate-600">
          <p className="font-semibold text-slate-900">Monatspaket für die Buchhaltung</p>
          <p>
            ZIP mit allen Belegdateien (sprechend benannt: Datum_Lieferant_Nummer_Betrag) und einer Liste als CSV. Danach in FreeFinance
            bzw. der Buchhaltung hochladen und hier als übergeben markieren.
          </p>
        </div>
        <a
          href={`/admin/belege/export?monat=${month}`}
          className={`rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark ${withFile.length === 0 ? "pointer-events-none opacity-50" : ""}`}
        >
          Monatspaket herunterladen
        </a>
        <form action={markExported}>
          <input type="hidden" name="month" value={month} />
          <button
            type="submit"
            disabled={readyForExport === 0}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            Als übergeben markieren ({readyForExport})
          </button>
        </form>
      </section>

      {receipts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          Für {monthLabel(month)} sind noch keine Belege erfasst.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Datum</th>
                <th className="px-4 py-3">Lieferant</th>
                <th className="px-4 py-3">Nummer</th>
                <th className="px-4 py-3 text-right">Brutto</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Hinweis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {receipts.map((r: Receipt) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 whitespace-nowrap">{shortDate(r.invoiceDate)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/belege/${r.id}`} className="font-medium text-brand hover:underline">
                      {r.supplier ?? "Unbekannt"}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {[r.docType ? DOC_TYPE_LABELS[r.docType] : null, r.description, r.source === "upload" ? "hochgeladen" : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </td>
                  <td className="px-4 py-3">{r.invoiceNumber ?? "–"}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {r.docType === "gutschrift" && r.grossCents !== null ? "−" : ""}
                    {money(r.grossCents, r.currency)}
                    {r.paid === true && <p className="text-xs text-slate-500">bezahlt</p>}
                    {r.paid === false && r.dueDate && <p className="text-xs text-slate-500">fällig {shortDate(r.dueDate)}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${statusStyle[r.status]}`}>
                      {RECEIPT_STATUS_LABELS[r.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
