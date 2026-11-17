"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { workspace } from "@/config/workspace";
import { logAction, requireAdmin } from "@/lib/auth";
import { encryptExistingDocs } from "@/lib/workspace/docs";
import {
  changeVaultPassword,
  docKey,
  MIN_PASSWORD_LENGTH,
  setupVault,
  unlockToken,
  unlockVault,
  VAULT_COOKIE,
  VaultLockedError,
} from "@/lib/workspace/vault";

export type VaultActionState = { ok?: boolean; error?: string; message?: string; recoveryCode?: string };

async function rememberUnlock(key: Buffer) {
  (await cookies()).set(VAULT_COOKIE, unlockToken(key, workspace.vault.unlockMinutes), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: workspace.vault.unlockMinutes * 60,
  });
}

/** Tresor einrichten: alle vorhandenen Doku-Daten werden verschlüsselt. Der Wiederherstellungsschlüssel wird genau einmal angezeigt. */
export async function setupDocVault(_prev: VaultActionState, formData: FormData): Promise<VaultActionState> {
  await requireAdmin();
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? "")) return { error: "Die beiden Passwörter stimmen nicht überein" };
  if (password.length < MIN_PASSWORD_LENGTH) return { error: `Bitte mindestens ${MIN_PASSWORD_LENGTH} Zeichen – am besten ein Satz.` };
  try {
    const { key, recoveryCode } = await setupVault(password, encryptExistingDocs);
    await rememberUnlock(key);
    await logAction("Doku-Tresor eingerichtet");
    return { ok: true, recoveryCode };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Einrichten fehlgeschlagen" };
  }
}

export async function unlockDocs(_prev: VaultActionState, formData: FormData): Promise<VaultActionState> {
  await requireAdmin();
  const key = await unlockVault(String(formData.get("secret") ?? "").trim());
  if (!key) {
    await logAction("Doku entsperren fehlgeschlagen");
    // Bremst Durchprobieren
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return { error: "Passwort oder Wiederherstellungsschlüssel ist falsch" };
  }
  await rememberUnlock(key);
  await logAction("Doku entsperrt");
  const next = String(formData.get("next") ?? "");
  redirect(next.startsWith("/app/") ? next : "/app/doku");
}

export async function lockDocs() {
  await requireAdmin();
  (await cookies()).delete(VAULT_COOKIE);
  await logAction("Doku gesperrt");
  redirect("/app/doku");
}

export async function changeDocPassword(_prev: VaultActionState, formData: FormData): Promise<VaultActionState> {
  await requireAdmin();
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? "")) return { error: "Die beiden Passwörter stimmen nicht überein" };
  try {
    const key = await docKey();
    if (!key) return { error: "Der Tresor ist noch nicht eingerichtet" };
    await changeVaultPassword(key, password);
    await logAction("Doku-Passwort geändert");
    return { ok: true, message: "Doku-Passwort geändert" };
  } catch (error) {
    if (error instanceof VaultLockedError) return { error: error.message };
    return { error: error instanceof Error ? error.message : "Ändern fehlgeschlagen" };
  }
}
