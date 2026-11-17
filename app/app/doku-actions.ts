"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { BookStackError } from "@/lib/bookstack";
import { importPagesFromBookstack, publishCablingToBookstack } from "@/lib/workspace/bookstack-sync";
import { getCustomer, setCustomerBookstack } from "@/lib/workspace/customers";
import {
  addRackItem,
  createPage,
  createRack,
  deletePage,
  deletePort,
  deleteRack,
  deleteRackItem,
  getPage,
  importPorts,
  looksLikeSecret,
  PAGE_TEMPLATES,
  PATCH_FIELDS,
  parsePatchCsv,
  RACK_ITEM_KINDS,
  savePort,
  updatePage,
  type PatchInput,
  type RackItemKind,
} from "@/lib/workspace/docs";

export type DocActionState = { ok?: boolean; error?: string; message?: string; warning?: string };

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const docPath = (customerId: string) => `/app/kunden/${customerId}/doku`;
const SECRET_WARNING = "Achtung: Das sieht nach einem Passwort aus. Zugangsdaten bitte in Keeper ablegen und hier nur darauf verweisen.";

async function customerOrError(formData: FormData) {
  return getCustomer(field(formData, "customerId"));
}

// ── Seiten ──

export async function createDocPage(_prev: DocActionState, formData: FormData): Promise<DocActionState> {
  await requireAdmin();
  const customer = await customerOrError(formData);
  if (!customer) return { error: "Kunde nicht gefunden" };
  const template = field(formData, "template");
  const title = field(formData, "title") || template || "Neue Seite";
  const page = await createPage({ customerId: customer.id, title, content: PAGE_TEMPLATES[template] ?? "" });
  revalidatePath(docPath(customer.id));
  redirect(`${docPath(customer.id)}/${page.id}?bearbeiten=1`);
}

export async function saveDocPage(_prev: DocActionState, formData: FormData): Promise<DocActionState> {
  await requireAdmin();
  const page = await getPage(field(formData, "id"));
  if (!page) return { error: "Seite nicht gefunden" };
  const content = String(formData.get("content") ?? "");
  await updatePage(page.id, { title: field(formData, "title"), content });
  revalidatePath(docPath(page.customerId), "layout");
  return { ok: true, message: "Gespeichert", warning: looksLikeSecret(content) ? SECRET_WARNING : undefined };
}

export async function removeDocPage(formData: FormData) {
  await requireAdmin();
  const page = await getPage(field(formData, "id"));
  if (!page) return;
  await deletePage(page.id);
  revalidatePath(docPath(page.customerId));
  redirect(docPath(page.customerId));
}

// ── Patchschrank ──

export async function addRack(_prev: DocActionState, formData: FormData): Promise<DocActionState> {
  await requireAdmin();
  const customer = await customerOrError(formData);
  if (!customer) return { error: "Kunde nicht gefunden" };
  try {
    await createRack({
      customerId: customer.id,
      name: field(formData, "name"),
      location: field(formData, "location"),
      units: Number(field(formData, "units") || 42),
      notes: field(formData, "notes"),
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Fehler" };
  }
  revalidatePath(docPath(customer.id));
  return { ok: true, message: "Schrank angelegt" };
}

export async function removeRack(formData: FormData) {
  await requireAdmin();
  await deleteRack(field(formData, "id"));
  revalidatePath(docPath(field(formData, "customerId")));
}

export async function addRackEntry(_prev: DocActionState, formData: FormData): Promise<DocActionState> {
  await requireAdmin();
  const kind = field(formData, "kind") as RackItemKind;
  const name = field(formData, "name");
  if (!name) return { error: "Bitte einen Namen angeben" };
  const result = await addRackItem({
    rackId: field(formData, "rackId"),
    name,
    kind: kind in RACK_ITEM_KINDS ? kind : "sonstiges",
    unitStart: Number(field(formData, "unitStart")),
    unitHeight: Number(field(formData, "unitHeight") || 1),
    model: field(formData, "model"),
    ip: field(formData, "ip"),
    notes: field(formData, "notes"),
  });
  if (!result.ok) return { error: result.error };
  revalidatePath(docPath(field(formData, "customerId")));
  return { ok: true, message: `„${name}“ eingebaut` };
}

export async function removeRackEntry(formData: FormData) {
  await requireAdmin();
  await deleteRackItem(field(formData, "id"));
  revalidatePath(docPath(field(formData, "customerId")));
}

// ── Verkabelung ──

export async function savePatchPort(_prev: DocActionState, formData: FormData): Promise<DocActionState> {
  await requireAdmin();
  const customer = await customerOrError(formData);
  if (!customer) return { error: "Kunde nicht gefunden" };
  const input = Object.fromEntries(PATCH_FIELDS.map(({ key }) => [key, field(formData, key) || null])) as PatchInput;
  const id = field(formData, "id") || undefined;
  try {
    await savePort(customer.id, input, id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Fehler" };
  }
  revalidatePath(docPath(customer.id));
  if (id) redirect(`${docPath(customer.id)}?tab=verkabelung`);
  return { ok: true, message: "Anschluss gespeichert" };
}

export async function removePatchPort(formData: FormData) {
  await requireAdmin();
  await deletePort(field(formData, "id"));
  revalidatePath(docPath(field(formData, "customerId")));
}

/** Patchliste aus Excel (als CSV gespeichert) übernehmen – Spalten werden an den Überschriften erkannt. */
export async function importPatchList(_prev: DocActionState, formData: FormData): Promise<DocActionState> {
  await requireAdmin();
  const customer = await customerOrError(formData);
  if (!customer) return { error: "Kunde nicht gefunden" };
  const file = formData.get("file");
  const text = file instanceof File && file.size > 0 ? await file.text() : String(formData.get("text") ?? "");
  if (!text.trim()) return { error: "Bitte eine CSV-Datei wählen oder Zeilen einfügen" };
  const { rows, mapped, ignored } = parsePatchCsv(text);
  if (mapped.length === 0) {
    return { error: "Keine bekannten Spalten gefunden. Erwartet z. B. Patchfeld, Port, Dose, Raum, Switch, Switchport, VLAN, Gerät." };
  }
  const count = await importPorts(customer.id, rows);
  revalidatePath(docPath(customer.id));
  return {
    ok: true,
    message: `${count} Anschlüsse übernommen (Spalten: ${mapped.join(", ")})`,
    warning: ignored.length ? `Nicht übernommen: ${ignored.join(", ")}` : undefined,
  };
}

// ── BookStack ──

export async function linkBookstackBook(_prev: DocActionState, formData: FormData): Promise<DocActionState> {
  await requireAdmin();
  const customer = await customerOrError(formData);
  if (!customer) return { error: "Kunde nicht gefunden" };
  const bookId = field(formData, "bookId");
  await setCustomerBookstack(customer.id, { bookId: bookId || null });
  revalidatePath(docPath(customer.id));
  return { ok: true, message: bookId ? "Buch verknüpft" : "Verknüpfung gelöst" };
}

/** Patchschränke und Patchliste als Seite im verknüpften BookStack-Buch veröffentlichen (wird jedes Mal aktualisiert). */
export async function publishCabling(_prev: DocActionState, formData: FormData): Promise<DocActionState> {
  await requireAdmin();
  const customer = await customerOrError(formData);
  if (!customer?.bookstackBookId) return { error: "Zuerst ein BookStack-Buch verknüpfen" };
  try {
    await publishCablingToBookstack(customer);
  } catch (error) {
    if (error instanceof BookStackError) return { error: error.message };
    throw error;
  }
  revalidatePath(docPath(customer.id));
  return { ok: true, message: "In BookStack veröffentlicht" };
}

/** Seiten des verknüpften Buchs in den Arbeitsplatz übernehmen (bereits übernommene werden aktualisiert). */
export async function importBookstackPages(_prev: DocActionState, formData: FormData): Promise<DocActionState> {
  await requireAdmin();
  const customer = await customerOrError(formData);
  if (!customer?.bookstackBookId) return { error: "Zuerst ein BookStack-Buch verknüpfen" };
  try {
    const { created, updated } = await importPagesFromBookstack(customer);
    revalidatePath(docPath(customer.id));
    return { ok: true, message: `${created} Seiten übernommen, ${updated} aktualisiert` };
  } catch (error) {
    if (error instanceof BookStackError) return { error: error.message };
    throw error;
  }
}
