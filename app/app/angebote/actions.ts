"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAction, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { eur } from "@/lib/workspace/catalog";
import { createMailDraft, outlookConfigured } from "@/lib/workspace/outlook";
import { createQuote, deleteQuote, getQuote, setQuoteStatus, type QuoteStatus } from "@/lib/workspace/quotes";
import { createTask } from "@/lib/workspace/tasks";
import { workspace } from "@/config/workspace";

export type QuoteState = { error?: string; message?: string };

export async function createQuoteAction(_prev: QuoteState, formData: FormData): Promise<QuoteState> {
  const user = await requireAdmin();
  const need = String(formData.get("need") ?? "").trim();
  if (need.length < 5) return { error: "Bitte kurz den Bedarf beschreiben (Gesprächsnotizen)" };
  let result;
  try {
    result = await createQuote(
      {
        customerId: String(formData.get("customerId") ?? ""),
        need: need.slice(0, 4000),
        codes: formData.getAll("codes").map(String),
        tiers: formData.get("tiers") === "on",
      },
      user.name,
    );
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Angebot konnte nicht erstellt werden" };
  }
  await logAction("Angebot erstellt", result.id);
  redirect(`/app/angebote/${result.id}${result.warning ? `?hinweis=${encodeURIComponent(result.warning)}` : ""}`);
}

export async function setStatusAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as QuoteStatus;
  if (!["entwurf", "gesendet", "angenommen", "abgelehnt"].includes(status)) return;
  await setQuoteStatus(id, status, String(formData.get("tier") ?? "") || null);
  const quote = await getQuote(id);
  await logAction(`Angebot ${status}`, `${quote?.number} ${quote?.customerName}`);
  revalidatePath(`/app/angebote/${id}`);
  revalidatePath("/app/angebote");
}

export async function deleteQuoteAction(formData: FormData) {
  await requireAdmin();
  await deleteQuote(String(formData.get("id") ?? ""));
  redirect("/app/angebote");
}

/** Angebot als E-Mail-Entwurf in Outlook (nur Inhaber-Postfach). */
export async function quoteDraftAction(_prev: QuoteState, formData: FormData): Promise<QuoteState> {
  const user = await requireAdmin();
  if (!outlookConfigured() || user.role !== "inhaber")
    return { error: "Outlook-Entwürfe nur mit dem Inhaber-Konto und verbundenem Outlook." };
  const quote = await getQuote(String(formData.get("id") ?? ""));
  if (!quote) return { error: "Angebot nicht gefunden" };
  const customer = (await (await db()).execute({ sql: "SELECT email FROM customers WHERE id = ?", args: [quote.customerId] })).rows[0];
  if (!customer?.email) return { error: "Beim Kunden ist keine E-Mail-Adresse hinterlegt (Kundenakte → Stammdaten)." };
  const lines = [
    "Sehr geehrte Damen und Herren,",
    "",
    quote.intro ?? "",
    "",
    ...quote.tiers.flatMap((t) => [
      `${t.label}${t.recommended ? " (unsere Empfehlung)" : ""}: ${t.items.map((i) => i.name).join(", ")}`,
      `  einmalig ${eur(t.totalOnce)} · monatlich ${eur(t.totalMonthly)} (netto)`,
    ]),
    "",
    "Das ausführliche Angebot finden Sie im Anhang. Alle Preise zzgl. 20 % USt., gültig 30 Tage.",
    "",
    "Freundliche Grüße",
    user.name,
    workspace.company,
  ];
  await createMailDraft({ to: [String(customer.email)], subject: `${quote.number}: ${quote.title}`, body: lines.join("\n") });
  if (quote.status === "entwurf") await setQuoteStatus(quote.id, "gesendet", null);
  await createTask({
    title: `Angebot ${quote.number} nachfassen (${quote.customerName})`,
    dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    customerId: quote.customerId,
    listName: "Kunden",
    source: "manuell",
    externalId: `angebot:${quote.id}`,
  }).catch(() => undefined);
  await logAction("Angebot als Entwurf", quote.number);
  revalidatePath(`/app/angebote/${quote.id}`);
  return {
    message:
      "Entwurf liegt in Outlook – PDF anhängen (Drucken → Als PDF speichern) und senden. Nachfassen ist in 7 Tagen als Aufgabe eingetragen.",
  };
}

export async function radarTaskAction(formData: FormData) {
  await requireAdmin();
  const externalId = `radar:${formData.get("customerId")}:${formData.get("code")}`;
  const existing = await (await db()).execute({ sql: "SELECT id FROM tasks WHERE external_id = ?", args: [externalId] });
  if (!existing.rows[0]) {
    await createTask({
      title: String(formData.get("title") ?? "Chance besprechen").slice(0, 200),
      notes: String(formData.get("reason") ?? ""),
      customerId: String(formData.get("customerId") ?? "") || null,
      listName: "Kunden",
      dueDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
      source: "manuell",
      externalId,
    });
  }
  revalidatePath("/app/radar");
}
