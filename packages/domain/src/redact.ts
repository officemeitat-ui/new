/**
 * Credentials typed into free text ("Passwort: …", "PIN=…", "API-Key: …"): the value is removed,
 * the label stays. Used for ticket imports and for the company memory (security review 2,
 * finding 6), so neither ever stores a password in searchable knowledge.
 */
const CREDENTIAL =
  /\b(passw(?:ort|ord)|kennwort|pwd|pw|pin|puk|zugangsdaten|api[- ]?key|api[- ]?schlüssel|lizenzschlüssel|license key|token|secret|wlan[- ]?schlüssel|wpa[- ]?key)\b\s*[:=]\s*[^\s,;]+/gi;

export function redactCredentials(text: string): string {
  return text.replace(CREDENTIAL, (_match, label: string) => `${label}: [entfernt]`);
}
