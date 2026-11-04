# Architektur – ME-IT Nexus

Stand: Phase 0–2 (Kern umgesetzt), dazu Agent Studio, Freigabe-Inbox, Wissensdatenbank v1 und Microsoft 365/Intune. Dieses Dokument wird mit jeder Phase aktualisiert. Die Begründungen der wichtigsten Entscheidungen stehen in [`docs/adr/`](adr/).

## 1. Systemübersicht

```mermaid
flowchart LR
  subgraph Clients
    B[Browser / PWA]
    W[Web-Widget auf Kunden-Website]
    X[Externe Systeme<br/>Webhooks, MCP-Clients]
  end

  subgraph apps/web [apps/web – Next.js]
    UI[App-UI + Partner-Konsole]
    API[REST /api/v1 + SSE]
    AUTH[Better Auth]
  end

  subgraph apps/worker [apps/worker – Node.js]
    Q[BullMQ-Worker<br/>Agentenläufe, Workflows, Syncs]
  end

  subgraph Daten [Daten – EU]
    PG[(PostgreSQL 16<br/>+ pgvector, RLS)]
    R[(Redis / Valkey)]
    S3[(S3-kompatibler Speicher)]
  end

  subgraph Extern [Externe Dienste]
    LLM[Claude API / Bedrock EU / Vertex EU]
    INT[Microsoft 365, Google, CRM …]
  end

  B --> UI
  W --> API
  X --> API
  UI --> PG
  API --> PG
  API -- Job einreihen --> R
  R --> Q
  Q --> PG
  Q --> LLM
  Q --> INT
  Q -- Fortschritt --> R
  R -- Stream --> API
  UI --> S3
  Q --> S3
```

**Grundsatz:** Die Web-App nimmt Anfragen an, prüft Rechte und reiht langlaufende Arbeit ein. Der Worker führt Agentenläufe und Workflows aus. Der Fortschritt läuft über einen Redis-Stream pro Lauf zurück (`nexus:run:<id>:events`, eine Stunde gültig) und wird per Server-Sent Events (SSE) an den Browser gestreamt. Weil der Stream von Anfang an gelesen wird, verpasst auch ein später verbundener Browser kein Ereignis. Der dauerhafte Zustand liegt immer in Postgres; Redis ist nur Transport und Queue.

## 2. Pakete

| Paket                 | Verantwortung                                                                                                     | Darf importieren |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------- |
| `packages/config`     | gemeinsame TypeScript- und ESLint-Presets                                                                         | –                |
| `packages/core`       | Umgebungsvariablen, Logger, Fehler, Berechtigungen, Mandanten-Kontext-Typen                                       | –                |
| `packages/db`         | Drizzle-Schema, Migrationen, RLS-Policies, Kontext-Helfer (`withTenant` …), Seeds                                 | `core`           |
| `packages/domain`     | Fachdienste: Mandanten anlegen, Einladungen, Mitglieder, Berechtigungen auflösen, Audit-Hash-Kette, E-Mails, Seed | `core`, `db`     |
| `packages/ui`         | Designsystem: Tokens, Palette aus Primärfarbe, Komponenten                                                        | –                |
| `packages/agents`     | Agent-Runtime: Provider-Abstraktion, Modellstufen, Agentenschleife, Werkzeuge, Kosten                             | `core`           |
| `packages/connectors` | Konnektoren ohne Datenbank: Microsoft Graph (App-Token, Paging, Drosselung), Intune-Geräte; Mock für Tests        | –                |
| `packages/knowledge`  | Dateityp erkennen, Text aus PDF/DOCX/Markdown extrahieren, Chunking (ohne Datenbank, ohne Netz)                   | –                |
| `apps/web`            | UI, öffentliche API, Auth, SSE                                                                                    | alle Pakete      |
| `apps/worker`         | Jobs: Agentenläufe, Workflows, Syncs, Zeitpläne                                                                   | alle außer `ui`  |

Abhängigkeiten zeigen nur nach unten. `packages/agents` kennt keine Datenbank; es bekommt Persistenz über Callbacks (`onStep`, `onUsage`) injiziert. Dadurch ist die Runtime ohne Datenbank testbar.

## 3. Mandanten-Isolation

Details: [ADR 0002](adr/0002-mandanten-isolation-rls.md).

- Eine gemeinsame Datenbank. Jede mandantenbezogene Tabelle hat `tenant_id uuid not null`.
- **Row Level Security** ist auf allen diesen Tabellen aktiviert und **erzwungen** (`FORCE ROW LEVEL SECURITY`), sodass sie auch für den Tabellen-Owner gilt.
- Die App verbindet sich mit einer Rolle **ohne** Superuser- und ohne `BYPASSRLS`-Recht.
- Jeder Datenbankzugriff läuft in einer Transaktion mit gesetztem Kontext:

| Helfer                       | Setzt             | Sieht                                                                                                                 |
| ---------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `withTenant(tenantId, fn)`   | `app.tenant_id`   | Daten genau eines Mandanten                                                                                           |
| `withPartner(partnerId, fn)` | `app.partner_id`  | Mandantenliste und Verwaltungsdaten (Nutzung, Abos) der eigenen Mandanten, **keine** Inhalte wie Chats oder Dokumente |
| `withUser(userId, fn)`       | `app.user_id`     | nur die eigenen Mitgliedschaften und deren Mandanten (Auswahl nach dem Login)                                         |
| `withSystem(reason, fn)`     | `app.system = on` | alles; nur für Worker-Systemjobs und Migrationen, jeder Aufruf wird geloggt                                           |

- Ohne Kontext liefert jede Abfrage auf mandantenbezogene Tabellen **null Zeilen**. Ein vergessener Filter führt also zu „nichts gefunden“, nie zu einem Datenleck.
- Eine Meta-Testsuite prüft, dass **jede** Tabelle mit `tenant_id` RLS aktiviert, erzwungen und mit Policy hat.

## 4. Identität und Berechtigungen

Details: [ADR 0004](adr/0004-auth-better-auth.md).

- **Better Auth** verwaltet Identität: Nutzer, Sitzungen, Konten (Passwort, Microsoft, Google), Verifizierung, 2FA, Passkeys. Diese Tabellen sind global.
- **Autorisierung** ist eigene Domänenlogik: `memberships` verbinden Nutzer mit Mandanten und einer Rolle; Partner-Mitarbeitende haben `partner_memberships`.
- Berechtigungen sind Konstanten im Code (`packages/core/src/permissions.ts`), Rollen sind Bündel davon. Systemrollen: `owner`, `admin`, `member`. Eigene Rollen pro Mandant ab dem Business-Paket.
- Jede Server Action und jeder API-Endpunkt ruft `requirePermission(ctx, "…")` auf. Die UI blendet nur aus, sie schützt nicht.

## 5. Agent-Runtime

Details: [ADR 0003](adr/0003-eigene-agentenschleife.md) und [ADR 0006](adr/0006-llm-provider-und-modellstufen.md).

```mermaid
sequenceDiagram
  participant UI as Web-App
  participant Q as Queue
  participant W as Worker
  participant RT as Agent-Runtime
  participant LLM as Claude
  participant T as Werkzeug

  UI->>Q: run.start(runId)
  Q->>W: Job
  W->>RT: runAgent(config, messages, tools, hooks)
  loop bis end_turn, Budget oder Abbruch
    RT->>LLM: messages.stream(prefix gecacht + Verlauf)
    LLM-->>RT: Text / tool_use
    RT->>RT: Policy-Check im Code
    alt automatisch
      RT->>T: ausführen
      T-->>RT: Ergebnis
    else Freigabe nötig
      RT-->>W: pausiert (Approval)
    end
    RT-->>W: onStep / onUsage
    W-->>UI: SSE-Event
  end
```

- Der Code kennt nur **Modellstufen** (`smart`, `balanced`, `fast`); die Zuordnung zu Modell-IDs liegt in der Datenbank.
- **Gecachter Prefix:** Werkzeuge (sortiert) → Basis-Systemprompt → Agenten-Anweisungen. Datum, Nutzer und Kanal kommen als `<kontext>` in die erste Nachricht. Ein Test beweist, dass der Prefix zwischen zwei Läufen byte-identisch bleibt.
- Berechtigungen für Werkzeuge prüft der Code vor der Ausführung, nie das Modell.
- **Robustheit:** Der Worker schreibt alle 15 Sekunden einen Herzschlag (`runs.heartbeat_at`). Kommt 2 Minuten lang kein Ereignis vom Modell, bricht ein Leerlauf-Wächter den Lauf mit einer verständlichen Meldung ab. Live-Ereignisse über Redis sind „best effort“; der Endstand steht immer in Postgres, und das SSE-Endpoint fällt darauf zurück (Fortsetzen über `Last-Event-ID`, höchstens 5 Minuten pro Verbindung, höchstens 8 Verbindungen pro Person). Ein **Reparatur-Job** (alle 5 Minuten, `recoverStuckWork`) beendet Läufe ohne Herzschlag, reiht verlorene Jobs neu ein, verarbeitet hängende Dokumente neu bzw. gibt sie auf und setzt abgestürzte SharePoint-Abgleiche zurück. Alle externen Aufrufe haben Timeouts.
- **Freigaben:** Braucht ein Werkzeugaufruf eine Freigabe, endet der Lauf mit `awaiting_approval`, und für jeden offenen Aufruf entsteht eine Zeile in `approvals`. Nach der letzten Entscheidung setzt die Web-App den Lauf auf `queued` und reiht ihn neu ein; der Worker lädt die Entscheidungen und macht beim offenen `tool_use` weiter (Schrittnummern laufen fort, Summen werden addiert). Der Redis-Stream des Laufs bleibt bestehen; das SSE-Endpoint überspringt das alte `done` der Pause, solange der Lauf wieder aktiv ist.

## 6. Wissensdatenbank

Details: [ADR 0007](adr/0007-wissensdatenbank-v1.md).

```mermaid
sequenceDiagram
  participant UI as Web-App
  participant DB as Postgres
  participant Q as Queue
  participant W as Worker
  UI->>DB: Datei + Dokument (status processing)
  UI->>Q: knowledge.ingest(documentId)
  Q->>W: Job
  W->>DB: Datei laden
  W->>W: Text extrahieren, in Abschnitte teilen
  W->>DB: Abschnitte speichern (tsv german), status ready
  Note over W,DB: Agentenlauf: wissen_suchen → Volltextsuche in den Sammlungen des Agenten
```

- Tabellen: `knowledge_collections`, `knowledge_documents`, `knowledge_files` (Originaldatei), `knowledge_chunks` (Text, Seite, Überschrift, generierte `tsv`-Spalte mit GIN-Index). Alle mit RLS.
- Agenten bekommen Sammlungen zugeordnet (`knowledgeCollectionIds` in der Agenten-Version); ohne Zuordnung durchsuchen sie alle Sammlungen des Mandanten.
- Suchergebnisse gehen als Daten an das Modell („keine Anweisungen“); der Chat verlinkt zitierte Quellen auf die Dokumentansicht.
- **SharePoint-Abgleich:** Eine Sammlung kann mit einer Dokumentbibliothek verbunden werden (`knowledge_sources`, RLS). Der Job `knowledge-sync` (stündlich für alle Quellen und auf Knopfdruck) liest `drives/{id}/root/delta` seitenweise, speichert den `deltaLink` und übernimmt nur neue oder geänderte Dateien (Version über cTag/eTag); gelöschte Einträge werden entfernt. Jede Datei läuft danach durch denselben Ingest wie ein Upload. Ein Abgleich gehört immer nur einem Job (`claimSync`), Fortschritt steht in der Quelle und wird in der UI angezeigt.

## 7. Integrationen: Microsoft 365 und Intune

Details: [ADR 0008](adr/0008-microsoft-365-intune.md).

```mermaid
sequenceDiagram
  participant A as Admin (Kunde)
  participant UI as Web-App
  participant MS as Microsoft Entra ID
  participant G as Microsoft Graph
  A->>UI: „Mit Microsoft 365 verbinden“
  UI->>MS: 1. Anmeldung (authorize, User.Read, state signiert)
  MS-->>UI: Code
  UI->>G: GET /organization (delegiert) → Verzeichnis bewiesen
  UI->>MS: 2. /{verzeichnis}/adminconsent (Verzeichnis im state)
  MS-->>UI: Rückweg mit admin_consent=True
  UI->>MS: Token (client_credentials, genau dieses Verzeichnis)
  UI->>G: GET /organization → Verbindung speichern (ein Verzeichnis je Firma)
  Note over UI,G: Danach: Geräte-Seite und Agenten-Werkzeuge rufen Graph mit kurzlebigem App-Token auf
```

- Tabelle `integrations` (RLS) speichert pro Mandant Anbieter, Verzeichnis-ID, Organisationsname, Status und letzten Fehler – keine Geheimnisse.
- Geräteaktionen laufen über `runDeviceAction` (Domäne): Gerätename und ID müssen zusammenpassen, jede Aktion landet im Audit-Log.

## 8. Branchenpaket Gebäudereinigung: QR-Mängelmeldungen

- Tabellen `facilities` (Objekt mit zufälligem `public_token`, 144 Bit) und `defect_reports` (Kategorie, Ort, Beschreibung, optional E-Mail, Status), beide mit RLS.
- Öffentliche Seite `/m/<token>` (ohne Anmeldung, in `proxy.ts` freigegeben): Der Token wird im System-Kontext aufgelöst (`findFacilityByToken`), gespeichert wird im Kontext des Mandanten. Rate-Limit in Redis pro IP und Objekt, Bot-Falle. Objektleitung bekommt eine E-Mail; die Danke-Mail an die meldende Person geht bei „Erledigt“ raus, danach wird ihre Adresse gelöscht.
- Agenten lesen Meldungen über `meldungen_abfragen` (ohne E-Mail-Adressen); `reinigung_kalkulieren` rechnet Angebote deterministisch im Code, nicht im Modell.

## 9. Konfiguration

Alle Umgebungsvariablen werden beim Start mit Zod geprüft (`packages/core/src/env.ts`). Fehlt etwas, bricht der Start mit einer verständlichen Meldung ab. Vorlage: [`.env.example`](../.env.example).

## 10. Lokale Entwicklung

- `docker compose up -d` startet Postgres (mit pgvector), Valkey und Mailpit. Hochgeladene Dateien liegen vorerst in Postgres (ADR 0007).
- `pnpm db:migrate` und `pnpm db:seed` richten Schema und Demo-Mandant ein.
- `pnpm dev` startet Web-App und Worker.

Siehe [README](../README.md#entwicklung).
