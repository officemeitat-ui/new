"use server";

import { revalidatePath } from "next/cache";
import { logAction, requireAdmin, requireOwner, currentSession } from "@/lib/auth";
import {
  checkPassword,
  createUser,
  forgetMicrosoftToken,
  getUser,
  regenerateRecoveryCodes,
  resetSecondFactor,
  revokeAllSessions,
  revokeSession,
  setPassword,
  updateUser,
  verifySecondFactor,
  type Role,
} from "@/lib/users";

export type SettingsState = { ok?: boolean; error?: string; message?: string; codes?: string[] };

const fail = (error: unknown): SettingsState => ({ error: error instanceof Error ? error.message : "Das hat nicht geklappt" });

export async function changeOwnPassword(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireAdmin();
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? "")) return { error: "Die beiden Passwörter stimmen nicht überein" };
  if (user.hasPassword && !(await checkPassword(user.email, String(formData.get("current") ?? "")))) {
    return { error: "Das bisherige Passwort stimmt nicht" };
  }
  try {
    await setPassword(user.id, password);
  } catch (error) {
    return fail(error);
  }
  const session = await currentSession();
  await revokeAllSessions(user.id, session?.session.id);
  await logAction("Passwort geändert", "andere Sitzungen beendet");
  return { ok: true, message: "Passwort geändert – alle anderen Geräte wurden abgemeldet." };
}

export async function newRecoveryCodes(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireAdmin();
  if (!user.totpEnabled) return { error: "Für dieses Konto ist kein Einmalcode eingerichtet" };
  if ((await verifySecondFactor(user.id, String(formData.get("code") ?? ""))) !== "code") return { error: "Der Code stimmt nicht" };
  const codes = await regenerateRecoveryCodes(user.id);
  await logAction("Wiederherstellungscodes erneuert");
  return { ok: true, codes };
}

export async function endSession(formData: FormData) {
  const user = await requireAdmin();
  await revokeSession(user.id, String(formData.get("id") ?? ""));
  await logAction("Sitzung beendet");
  revalidatePath("/app/einstellungen");
}

export async function endOtherSessions() {
  const user = await requireAdmin();
  const session = await currentSession();
  await revokeAllSessions(user.id, session?.session.id);
  await logAction("Alle anderen Sitzungen beendet");
  revalidatePath("/app/einstellungen");
}

export async function disconnectMicrosoft() {
  const user = await requireAdmin();
  await forgetMicrosoftToken(user.id);
  await logAction("Microsoft-Zugriff getrennt");
  revalidatePath("/app/einstellungen");
}

// ── Benutzerverwaltung (nur Inhaber/in) ──

export async function addUser(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireOwner();
  const role: Role = formData.get("role") === "inhaber" ? "inhaber" : "technik";
  try {
    const user = await createUser({
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      role,
      password: String(formData.get("password") ?? "") || null,
    });
    await logAction("Benutzer angelegt", `${user.name} <${user.email}> als ${role}`);
    revalidatePath("/app/einstellungen/benutzer");
    return {
      ok: true,
      message: user.hasPassword
        ? `${user.name} kann sich jetzt mit Passwort anmelden und richtet beim ersten Mal den Einmalcode ein.`
        : `${user.name} kann sich jetzt mit dem Microsoft-Konto ${user.email} anmelden.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function manageUser(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const owner = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const target = await getUser(id);
  if (!target) return { error: "Konto nicht gefunden" };
  const action = String(formData.get("action") ?? "");
  try {
    switch (action) {
      case "rolle": {
        const role: Role = formData.get("role") === "inhaber" ? "inhaber" : "technik";
        await updateUser(id, { role });
        await logAction("Rolle geändert", `${target.name}: ${role}`);
        break;
      }
      case "sperren":
        if (id === owner.id) return { error: "Das eigene Konto kann nicht gesperrt werden" };
        await updateUser(id, { disabled: true });
        await logAction("Benutzer gesperrt", target.name);
        break;
      case "entsperren":
        await updateUser(id, { disabled: false });
        await logAction("Benutzer entsperrt", target.name);
        break;
      case "faktor":
        await resetSecondFactor(id);
        await logAction("Zweiter Faktor zurückgesetzt", target.name);
        break;
      case "abmelden":
        await revokeAllSessions(id);
        await logAction("Alle Sitzungen beendet", target.name);
        break;
      default:
        return { error: "Unbekannte Aktion" };
    }
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/app/einstellungen/benutzer");
  return { ok: true, message: "Gespeichert." };
}
