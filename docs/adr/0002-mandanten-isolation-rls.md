# ADR 0002 – Mandanten-Isolation mit Postgres Row Level Security

**Status:** angenommen · **Datum:** 2026-11-03

## Kontext

Mehrere Kunden (Mandanten) teilen sich eine Installation. Ein einziger vergessener `WHERE tenant_id = …` darf nicht dazu führen, dass ein Kunde Daten eines anderen sieht. Gleichzeitig braucht die Partner-Konsole von ME-IT eine Übersicht über alle eigenen Mandanten, ohne deren Inhalte (Chats, Dokumente) lesen zu können.

## Optionen

1. **Eigene Datenbank pro Mandant:** stärkste Trennung, aber teuer im Betrieb (Migrationen × N, Verbindungen × N).
2. **Schema pro Mandant:** ähnliche Betriebsprobleme.
3. **Gemeinsame Tabellen mit `tenant_id` und Row Level Security:** günstig, einfach zu betreiben, Isolation durch die Datenbank erzwungen.

## Entscheidung

Option 3:

- Jede mandantenbezogene Tabelle hat `tenant_id uuid not null` mit Index und Fremdschlüssel auf `tenants`.
- `ENABLE` **und** `FORCE ROW LEVEL SECURITY` auf jeder dieser Tabellen.
- Die App verbindet sich mit einer Rolle ohne `SUPERUSER` und ohne `BYPASSRLS` (lokal: `nexus`).
- Der Kontext wird pro Transaktion mit `set_config(…, true)` gesetzt, also transaktionslokal. Er kann nicht in eine andere Anfrage aus dem Connection-Pool „durchsickern“.
- Policies:
  - `tenant_isolation`: `tenant_id = app.tenant_id`
  - `partner_overview` (nur auf Verwaltungstabellen wie `tenants`, `usage_events`): Mandant gehört zum Partner in `app.partner_id`
  - `system_access`: `app.system = 'on'`, nur über `withSystem(reason, fn)` gesetzt und geloggt
- Eine Meta-Testsuite prüft für jede Tabelle mit `tenant_id`, dass RLS aktiviert und erzwungen ist und mindestens eine Policy existiert. Neue Tabellen ohne RLS lassen die CI fehlschlagen.

## Konsequenzen

- Seeds und Datenmigrationen müssen in einem Kontext laufen.
- Der System-Kontext ist ein bewusster Kompromiss für Portabilität: Er funktioniert auch auf verwalteten Datenbanken, auf denen keine `BYPASSRLS`-Rolle angelegt werden darf. Wo möglich, kann er in Produktion durch eine eigene Datenbankrolle mit `BYPASSRLS` ersetzt werden, die nur der Worker nutzt.
- Superuser umgehen RLS immer. Deshalb laufen die Tests bewusst mit einer Rolle ohne Superuser-Rechte.
