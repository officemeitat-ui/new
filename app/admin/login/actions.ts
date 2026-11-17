"use server";

import { redirect } from "next/navigation";
import { clientInfo } from "@/lib/auth";
import { clearLoginStep, readLoginStep, safeNext, setLoginStep, startSession } from "@/lib/login";
import { secretsMatch } from "@/lib/secrets";
import {
  audit,
  checkPassword,
  confirmTotpSetup,
  countUsers,
  createUser,
  getUser,
  loginBlocked,
  MIN_USER_PASSWORD,
  recordLogin,
  startTotpSetup,
  verifySecondFactor,
  type User,
} from "@/lib/users";

// Anmeldung in Schritten: Passwort → zweiter Faktor (oder dessen Einrichtung) → Sitzung.
// Der Zwischenstand liegt in einem kurzlebigen, signierten Cookie; eine Sitzung gibt es erst nach dem zweiten Faktor.
// Nur async-Funktionen exportieren – jede davon ist von außen aufrufbar.

export type LoginState = { error?: string; recoveryCodes?: string[]; next?: string; name?: string; email?: string };

const failDelay = () => new Promise((resolve) => setTimeout(resolve, 800));

async function afterPassword(user: User, next: string) {
  if (user.totpEnabled) {
    await setLoginStep({ uid: user.id, step: "mfa", next });
  } else {
    await startTotpSetup(user.id);
    await setLoginStep({ uid: user.id, step: "mfa-setup", next });
  }
  redirect("/admin/login");
}

/** Ersteinrichtung: das erste Inhaber-Konto, bestätigt mit ADMIN_PASSWORD aus der Server-Konfiguration. */
export async function firstSetup(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if ((await countUsers()) > 0) return { error: "Die Einrichtung ist bereits abgeschlossen" };
  // Bei Fehlern Name und E-Mail zurückgeben, damit das Formular sie behält.
  const keep = { name: String(formData.get("name") ?? ""), email: String(formData.get("email") ?? "") };
  const client = await clientInfo();
  const keys = [`ip:${client.ip ?? "?"}`];
  if (await loginBlocked(keys)) return { ...keep, error: "Zu viele Versuche – bitte in 15 Minuten erneut versuchen" };
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !secretsMatch(String(formData.get("adminPassword") ?? ""), expected)) {
    await recordLogin(keys, false);
    await failDelay();
    return { ...keep, error: "Das Einrichtungspasswort (ADMIN_PASSWORD) stimmt nicht" };
  }
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? "")) return { ...keep, error: "Die beiden Passwörter stimmen nicht überein" };
  if (password.length < MIN_USER_PASSWORD)
    return { ...keep, error: `Passwort: mindestens ${MIN_USER_PASSWORD} Zeichen – am besten ein Satz` };
  let user: User;
  try {
    user = await createUser({
      email: String(formData.get("email") ?? ""),
      name: String(formData.get("name") ?? ""),
      role: "inhaber",
      password,
    });
  } catch (error) {
    return { ...keep, error: error instanceof Error ? error.message : "Konto konnte nicht angelegt werden" };
  }
  await recordLogin(keys, true);
  await audit("Konto angelegt", `${user.name} (Inhaber/in, Ersteinrichtung)`, { userId: user.id, userName: user.name, ip: client.ip });
  await afterPassword(user, "/app");
  return {};
}

export async function passwordLogin(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const client = await clientInfo();
  const keys = [`ip:${client.ip ?? "?"}`, `mail:${email}`];
  if (await loginBlocked(keys)) return { error: "Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen", email };
  const user = await checkPassword(email, String(formData.get("password") ?? ""));
  if (!user) {
    await recordLogin(keys, false);
    await audit("Anmeldung fehlgeschlagen", email, { ip: client.ip });
    await failDelay();
    return { error: "E-Mail-Adresse oder Passwort ist falsch", email };
  }
  await afterPassword(user, safeNext(formData.get("next")));
  return {};
}

export async function verifyCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const step = await readLoginStep();
  if (!step || step.step !== "mfa") return { error: "Die Anmeldung ist abgelaufen – bitte neu beginnen" };
  const client = await clientInfo();
  const keys = [`mfa:${step.uid}`];
  if (await loginBlocked(keys)) return { error: "Zu viele falsche Codes – bitte in 15 Minuten erneut versuchen" };
  const user = await getUser(step.uid);
  const result = user && !user.disabled ? await verifySecondFactor(user.id, String(formData.get("code") ?? "")) : null;
  if (!user || !result) {
    await recordLogin(keys, false);
    await audit("Code falsch", null, { userId: user?.id, userName: user?.name, ip: client.ip });
    await failDelay();
    return { error: "Der Code stimmt nicht" };
  }
  await recordLogin(keys, true);
  await startSession(user, result === "code" ? "passwort+code" : "wiederherstellung");
  await clearLoginStep();
  redirect(step.next);
}

/** Bestätigt die Einrichtung des zweiten Faktors. Die Wiederherstellungscodes werden genau einmal angezeigt. */
export async function confirmSetup(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const step = await readLoginStep();
  if (!step || step.step !== "mfa-setup") return { error: "Die Anmeldung ist abgelaufen – bitte neu beginnen" };
  const keys = [`mfa:${step.uid}`];
  if (await loginBlocked(keys)) return { error: "Zu viele falsche Codes – bitte in 15 Minuten erneut versuchen" };
  const user = await getUser(step.uid);
  const codes = user && !user.disabled ? await confirmTotpSetup(user.id, String(formData.get("code") ?? "")) : null;
  if (!user || !codes) {
    await recordLogin(keys, false);
    await failDelay();
    return { error: "Der Code stimmt nicht – Uhrzeit am Handy prüfen und den aktuellen Code eingeben" };
  }
  await recordLogin(keys, true);
  await audit("Zweiter Faktor eingerichtet", null, { userId: user.id, userName: user.name, ip: (await clientInfo()).ip });
  await startSession(user, "passwort+code");
  return { recoveryCodes: codes, next: step.next };
}

export async function finishLogin(formData: FormData) {
  await clearLoginStep();
  redirect(safeNext(formData.get("next")));
}

export async function cancelLogin() {
  await clearLoginStep();
  redirect("/admin/login");
}
