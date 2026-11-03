# ADR 0004 – Better Auth für Identität, eigene Logik für Autorisierung

**Status:** angenommen · **Datum:** 2026-11-03

## Kontext

Benötigt werden E-Mail/Passwort, Magic Link, Passkeys, TOTP-2FA sowie SSO mit Microsoft Entra ID und Google. Hosting ausschließlich in der EU. Mandanten, Rollen und Partner-Ebene sind Kern des Geschäftsmodells.

## Entscheidung

- **Better Auth** (selbst gehostet, Daten in unserer Postgres-Datenbank) für **Identität**: Nutzer, Sitzungen, Konten, Verifizierung, 2FA, Passkeys, Social Login.
- Das Organization-Plugin von Better Auth wird **nicht** verwendet. Mandanten, Mitgliedschaften, Rollen und die Partner-Ebene sind eigene Tabellen mit Row Level Security (ADR 0002). So gibt es genau ein Modell für Mandanten.
- SSO-Provider werden nur aktiviert, wenn ihre Zugangsdaten in der Umgebung gesetzt sind.

## Konsequenzen

- Kein externer Identitätsdienst außerhalb der EU.
- Die Verbindung Identität → Mandant läuft über `memberships.user_id` → Better-Auth-Tabelle `user`.
