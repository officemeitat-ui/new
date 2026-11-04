# ADR 0010 – Wissensquellen BookStack und Atera

**Status:** angenommen · **Datum:** 2026-11-04

## Kontext

ME-IT pflegt seine Dokumentation in BookStack und arbeitet Supportfälle in Atera ab. Genau dort liegt das Wissen, das Agenten und Technik brauchen („Wo liegt das Wissen heute?“, „Wie haben wir das zuletzt gelöst?“). SharePoint ist bereits angebunden (ADR 0008).

## Entscheidung

- **Eine Wissensquelle pro Sammlung**, Anbieter `sharepoint`, `bookstack` oder `atera` (`knowledge_sources.provider`). Gemeinsam sind Abgleich im Hintergrund (Queue `knowledge-sync`, stündlich und auf Knopfdruck), Fortschritt, Fehlerstatus, Reparatur-Job und das Speichern als normale Dokumente mit Ingest.
- **BookStack** (Quellcode-geprüft: `routes/api.php`, `ListingResponseBuilder`, `ApiTokenGuard`): Header `Authorization: Token <id>:<secret>`, `GET /api/books` und `GET /api/pages` (bis 500 pro Abruf, Offset nach tatsächlicher Anzahl), Inhalt über `GET /api/pages/{id}/export/markdown`. Übernommen werden veröffentlichte Seiten (keine Entwürfe, keine Vorlagen). Version = `updated_at`; gelöschte Seiten werden entfernt. Jede Seite verlinkt zurück nach BookStack.
- **Atera** (REST API v3, `https://app.atera.com/api/v3`, Header `X-API-KEY`, JWT-Schlüssel als Bearer): `GET /tickets` mit `Page`, `ItemsInPage` (≤ 50), `TicketStatus`, `DateFrom`; `GET /tickets/{id}/comments`. Übernommen werden nur Tickets mit Status _Resolved_ und _Closed_ aus dem gewählten Zeitraum (6–36 Monate). Version = `LastUpdatedDate`; unveränderte Tickets werden nicht erneut geladen. Tickets, die aus dem Zeitraum fallen, bleiben (es gelten die Löschfristen der Firma).
- **Offene Verifikation Atera:** Die offizielle Referenz (app.atera.com/apidocs) war aus der Entwicklungsumgebung nicht erreichbar. Endpunkte und Ticketfelder sind durch mehrere unabhängige Quellen belegt (u. a. quelloffener Connector MSPbotsAIFramework/atera-mcp); die Text- und Datumsfelder der Kommentare werden tolerant gelesen (`Comment`/`CommentText`, `Date`/`CommentTimestamp`/`CreatedDate`). Vor dem Echtbetrieb mit einem echten Schlüssel gegen die Referenz prüfen.
- **Datenschutz bei Tickets:** Ein Ticket wird als ein Abschnitt (Problem, Verlauf, Lösung) gespeichert. Namen von Personen werden nicht übernommen; E-Mail-Adressen, Telefonnummern und IBANs werden vor dem Speichern ersetzt; HTML wird zu Text. Namen im Freitext lassen sich nicht zuverlässig erkennen – das steht im Verarbeitungsverzeichnis. Empfohlen ist der Einsatz in der eigenen ME-IT-Firma („bei uns zuerst“); pro Kunde gefilterte Ticketquellen kommen erst, wenn der Partner sie steuert (sonst könnte ein Kunden-Admin den Filter ändern).
- **Zugangsdaten verschlüsselt:** Token und API-Schlüssel liegen AES-256-GCM-verschlüsselt in `knowledge_sources.secret` (`packages/core/src/crypto.ts`, Schlüssel `DATA_ENCRYPTION_KEY`, in Produktion Pflicht). Sie werden nie an den Browser gegeben und nur im Abgleich entschlüsselt.
- **SSRF-Schutz:** Die BookStack-Adresse gibt der Kunde ein. Erlaubt sind nur `https` und Hosts, die ausschließlich auf öffentliche Adressen auflösen (kein localhost, keine privaten, Link-Local- oder CGNAT-Netze); keine Zugangsdaten in der URL, keine Weiterleitungen, Timeout und Größenlimit. Die Prüfung läuft beim Verbinden und bei jedem Abgleich. `CONNECTOR_ALLOW_PRIVATE_URLS=true` nur für Entwicklung und Tests.

## Konsequenzen

- Agenten beantworten Supportfragen mit Quelle: aus der eigenen Doku und aus gelösten Fällen.
- Ein in BookStack nur intern erreichbarer Server kann von einer Cloud-Installation nicht abgeglichen werden; dafür muss BookStack öffentlich (mit Token-Schutz) erreichbar sein oder die Plattform im selben Netz laufen (dann bewusst freischalten).
- Nicht in v1: Webhooks statt stündlich, Ticket-Anhänge, Atera-Kunden auf Firmen der Plattform abbilden.
