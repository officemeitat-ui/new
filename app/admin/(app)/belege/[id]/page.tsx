import Link from "next/link";
import { notFound } from "next/navigation";
import { removeReceipt } from "@/app/admin/beleg-actions";
import { ReceiptEditForm, ReceiptUpload, type ReceiptFormValues } from "@/components/ReceiptPanels";
import { requireAdmin } from "@/lib/auth";
import { getEmail } from "@/lib/emails";
import { formatDateTime } from "@/lib/format";
import { formatCents } from "@/lib/receipts/files";
import { getReceipt, RECEIPT_STATUS_LABELS } from "@/lib/receipts/store";

export default async function BelegPage({ params }: PageProps<"/admin/belege/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const receipt = await getReceipt(id);
  if (!receipt) notFound();
  const email = receipt.emailId ? await getEmail(receipt.emailId) : null;

  const values: ReceiptFormValues = {
    id: receipt.id,
    supplier: receipt.supplier ?? "",
    invoiceNumber: receipt.invoiceNumber ?? "",
    invoiceDate: receipt.invoiceDate ?? "",
    dueDate: receipt.dueDate ?? "",
    gross: formatCents(receipt.grossCents),
    net: formatCents(receipt.netCents),
    vat: formatCents(receipt.vatCents),
    currency: receipt.currency ?? "EUR",
    paid: receipt.paid === null ? "" : receipt.paid ? "ja" : "nein",
    description: receipt.description ?? "",
    docType: receipt.docType ?? "rechnung",
    status: receipt.status,
  };
  const fileUrl = `/admin/belege/datei/${receipt.id}`;
  const isImage = receipt.contentType?.startsWith("image/");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/admin/belege?monat=${receipt.month}`} className="text-sm text-slate-500 hover:text-slate-900">
            ← Belege{" "}
            {new Intl.DateTimeFormat("de-AT", { month: "long", year: "numeric", timeZone: "UTC" }).format(
              new Date(`${receipt.month}-01T00:00:00Z`),
            )}
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{receipt.supplier ?? "Beleg"}</h1>
          <p className="text-sm text-slate-500">
            {RECEIPT_STATUS_LABELS[receipt.status]} · {receipt.source === "upload" ? "hochgeladen" : "aus dem Postfach"} am{" "}
            {formatDateTime(receipt.createdAt)}
            {receipt.exportedAt && ` · übergeben am ${formatDateTime(receipt.exportedAt)}`}
          </p>
        </div>
        <form action={removeReceipt}>
          <input type="hidden" name="id" value={receipt.id} />
          <button type="submit" className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
            Beleg löschen
          </button>
        </form>
      </div>

      {receipt.note && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">{receipt.note}</p>}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-2">
          {receipt.hasFile ? (
            <div className="space-y-2">
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl} alt={receipt.fileName ?? "Beleg"} className="mx-auto max-h-[75vh]" />
              ) : (
                <iframe src={fileUrl} title={receipt.fileName ?? "Beleg"} className="h-[75vh] w-full rounded-lg" />
              )}
              <p className="px-2 pb-1 text-sm">
                <a href={`${fileUrl}?download`} className="font-medium text-brand hover:underline">
                  {receipt.fileName ?? "Datei"} herunterladen
                </a>
              </p>
            </div>
          ) : (
            <div className="space-y-4 p-6 text-sm text-slate-600">
              <p>Zu diesem Beleg ist keine Datei vorhanden.</p>
              <ReceiptUpload receiptId={receipt.id} label="Datei hochladen" />
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <ReceiptEditForm values={values} hasFile={receipt.hasFile} />
          </div>
          {email && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
              <p className="font-semibold">Aus der E-Mail</p>
              <p className="text-slate-600">
                {email.fromName ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress} · {formatDateTime(email.receivedAt)}
              </p>
              <p className="mt-1">„{email.subject}“</p>
              <details className="mt-2">
                <summary className="cursor-pointer text-slate-500">Text der E-Mail</summary>
                <p className="mt-2 rounded-lg bg-slate-50 p-3 whitespace-pre-wrap text-slate-700">{email.body}</p>
              </details>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
