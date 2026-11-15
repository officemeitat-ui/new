// Verbindet eine Telefonnummer in Vapi mit diesem Cockpit.
// Danach fragt Vapi bei jedem Anruf den Assistenten hier ab (immer mit aktuellem Datum und Betriebsprofil)
// und schickt Werkzeugaufrufe sowie Gesprächsberichte hierher.
//
// Aufruf: node --env-file=.env.local scripts/vapi-connect.mjs
// Benötigt: VAPI_API_KEY, VAPI_WEBHOOK_SECRET, PUBLIC_URL und VAPI_PHONE_NUMBER (z. B. +4312345678) oder VAPI_PHONE_NUMBER_ID

import { VapiClient } from "@vapi-ai/server-sdk";

const { VAPI_API_KEY, VAPI_WEBHOOK_SECRET, PUBLIC_URL, VAPI_PHONE_NUMBER, VAPI_PHONE_NUMBER_ID } = process.env;

const missing = Object.entries({ VAPI_API_KEY, VAPI_WEBHOOK_SECRET, PUBLIC_URL })
  .filter(([, value]) => !value)
  .map(([key]) => key);
if (missing.length > 0 || (!VAPI_PHONE_NUMBER && !VAPI_PHONE_NUMBER_ID)) {
  console.error(
    `Fehlende Umgebungsvariablen: ${[...missing, ...(!VAPI_PHONE_NUMBER && !VAPI_PHONE_NUMBER_ID ? ["VAPI_PHONE_NUMBER oder VAPI_PHONE_NUMBER_ID"] : [])].join(", ")}`,
  );
  process.exit(1);
}
if (!PUBLIC_URL.startsWith("https://")) {
  console.error("PUBLIC_URL muss eine öffentlich erreichbare https-Adresse sein, z. B. https://cockpit.example.at");
  process.exit(1);
}

// VAPI_BASE_URL nur für Tests gegen einen Mock-Server
const vapi = new VapiClient({ token: VAPI_API_KEY, ...(process.env.VAPI_BASE_URL ? { baseUrl: process.env.VAPI_BASE_URL } : {}) });
const numbers = await vapi.phoneNumbers.list();
const phone = numbers.find((n) => n.id === VAPI_PHONE_NUMBER_ID || (VAPI_PHONE_NUMBER && n.number === VAPI_PHONE_NUMBER));
if (!phone) {
  console.error("Telefonnummer nicht gefunden. Vorhandene Nummern:");
  for (const n of numbers) console.error(`  ${n.number}  (ID ${n.id}, ${n.provider})`);
  process.exit(1);
}

const serverUrl = `${PUBLIC_URL.replace(/\/$/, "")}/api/voice/vapi`;
await vapi.phoneNumbers.update({
  id: phone.id,
  body: { provider: phone.provider, server: { url: serverUrl, headers: { "x-webhook-secret": VAPI_WEBHOOK_SECRET }, timeoutSeconds: 20 } },
});

console.log(`✓ ${phone.number} ist mit ${serverUrl} verbunden.`);
if (phone.assistantId) {
  console.warn(
    "⚠ Bei dieser Nummer ist noch ein fester Assistent hinterlegt. Bitte im Vapi-Dashboard entfernen –" +
      " sonst wird der Assistent aus diesem Cockpit nicht verwendet.",
  );
}
console.log("Jetzt die Nummer anrufen und testen. Gespräche erscheinen danach im Cockpit unter „Anrufe“.");
