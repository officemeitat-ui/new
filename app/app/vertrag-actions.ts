"use server";

import { revalidatePath } from "next/cache";
import { PACKAGES, type PackageId } from "@/config/services";
import { logAction, requireAdmin, requireOwner } from "@/lib/auth";
import { saveContractProfile, serviceMap, setBookedService, updateService } from "@/lib/workspace/catalog";
import { getCustomer } from "@/lib/workspace/customers";

export type ContractState = { ok?: boolean; error?: string; message?: string };

const fail = (error: unknown): ContractState => ({ error: error instanceof Error ? error.message : "Das hat nicht geklappt" });

export async function saveProfileAction(_prev: ContractState, formData: FormData): Promise<ContractState> {
  await requireAdmin();
  const customer = await getCustomer(String(formData.get("customerId") ?? ""));
  if (!customer) return { error: "Kunde nicht gefunden" };
  const employees = String(formData.get("employees") ?? "").trim();
  const pkg = String(formData.get("package") ?? "keins");
  try {
    await saveContractProfile(customer.id, {
      industry: String(formData.get("industry") ?? "").trim() || null,
      employees: employees === "" ? null : Number(employees),
      package: (pkg in PACKAGES ? pkg : "keins") as PackageId,
      contractEnd: String(formData.get("contractEnd") ?? "") || null,
    });
  } catch (error) {
    return fail(error);
  }
  await logAction("Vertragsdaten geändert", customer.name);
  revalidatePath(`/app/kunden/${customer.id}`);
  return { ok: true, message: "Gespeichert." };
}

export async function bookServiceAction(_prev: ContractState, formData: FormData): Promise<ContractState> {
  await requireAdmin();
  const customer = await getCustomer(String(formData.get("customerId") ?? ""));
  if (!customer) return { error: "Kunde nicht gefunden" };
  const code = String(formData.get("code") ?? "");
  const service = (await serviceMap()).get(code);
  if (!service) return { error: "Leistung nicht gefunden" };
  const quantity = Number(String(formData.get("quantity") ?? "").replace(",", "."));
  if (!Number.isFinite(quantity) || quantity < 0) return { error: "Ungültige Menge" };
  const priceText = String(formData.get("price") ?? "")
    .trim()
    .replace(",", ".");
  const price = priceText === "" ? null : Number(priceText);
  if (price !== null && (!Number.isFinite(price) || price < 0)) return { error: "Ungültiger Preis" };
  await setBookedService(customer.id, code, quantity, price);
  await logAction(
    quantity > 0 ? "Leistung gebucht" : "Leistung entfernt",
    `${customer.name}: ${service.name}${quantity > 0 ? ` × ${quantity}` : ""}`,
  );
  revalidatePath(`/app/kunden/${customer.id}`);
  return { ok: true, message: quantity > 0 ? `${service.name} gebucht.` : `${service.name} entfernt.` };
}

export async function updateServiceAction(_prev: ContractState, formData: FormData): Promise<ContractState> {
  await requireOwner();
  const code = String(formData.get("code") ?? "");
  try {
    await updateService(code, {
      price: Number(String(formData.get("price") ?? "").replace(",", ".")),
      active: formData.get("active") === "on",
    });
  } catch (error) {
    return fail(error);
  }
  await logAction("Preis geändert", code);
  revalidatePath("/app/leistungen");
  return { ok: true, message: "Gespeichert." };
}
