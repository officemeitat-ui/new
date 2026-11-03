# ADR 0005 – Hintergrundjobs mit BullMQ, Zustand in Postgres

**Status:** angenommen · **Datum:** 2026-11-03

## Kontext

Agentenläufe, Workflows, Synchronisationen und Zeitpläne laufen im Hintergrund, teilweise minutenlang. Sie müssen Neustarts überstehen, dürfen Aktionen nicht doppelt ausführen und ein Mandant darf die anderen nicht blockieren.

## Entscheidung

- **BullMQ** auf Redis/Valkey als Queue und für Retries mit Backoff.
- Der fachliche Zustand (Run, Schritte, Freigaben) liegt **in Postgres**, nicht in Redis. Ein Job trägt nur IDs.
- Jede externe Aktion bekommt einen Idempotenzschlüssel (`runId:stepId`), damit eine Wiederholung nach einem Absturz nichts doppelt ausführt.
- Fairness: Begrenzung gleichzeitiger Läufe pro Mandant (Gruppen-/Rate-Limit), konfigurierbar pro Paket.
- Fortschritt wird über Redis Pub/Sub an die Web-App gemeldet und per SSE an den Browser weitergereicht.

## Konsequenzen

- Redis kann ohne Datenverlust geleert werden; laufende Jobs werden aus Postgres wiederhergestellt (Recovery-Job beim Start).
- Falls dauerhafte Workflows später komplexer werden, kann eine Workflow-Engine (z. B. Temporal) per neuem ADR nachgezogen werden.
