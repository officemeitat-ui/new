# ADR 0011 – Unternehmensgedächtnis

**Status:** angenommen · **Datum:** 2026-11-06

## Kontext

„Claude Memory ausschalten → eigenes Gedächtnis“: Das Wissen einer Firma soll nicht im Gedächtnis eines KI-Anbieters liegen, sondern in ihrer eigenen Datenbank – durchsuchbar für Mitarbeitende und Agenten, exportierbar und unter ihrer Kontrolle. Bisher kam Wissen nur über hochgeladene Dateien und synchronisierte Quellen (SharePoint, BookStack, Atera, ADR 0007/0008/0010) in die Plattform. Was im Alltag gelöst wird („Drucker im 2. Stock braucht nach dem Tonerwechsel einen Neustart“), ging verloren.

Ein Gedächtnis, in das Agenten selbst schreiben, ist ein bekanntes Angriffsziel: Eine präparierte E-Mail oder ein Dokument bringt den Agenten dazu, eine falsche „Regel“ zu speichern, die später alle Agenten wiederholen (Memory Poisoning, OWASP LLM04/LLM08).

## Entscheidung

- **Artikel in der App:** In jeder Sammlung lassen sich Artikel (Markdown) schreiben und bearbeiten (`knowledge_documents.origin = 'article'`). Sie laufen durch denselben Ingest wie Uploads und sind danach durchsuchbar; Überschriften gliedern die Abschnitte.
- **Sammlung „Unternehmensgedächtnis“** (`knowledge_collections.kind = 'memory'`, höchstens eine pro Firma, eindeutiger Index). Sie entsteht auf Knopfdruck oder beim ersten Vorschlag eines Agenten und lässt sich nie mit einer Sync-Quelle verbinden (sonst könnte ein Abgleich Einträge überschreiben oder löschen).
- **Werkzeug `wissen_merken`** (Risiko `internal_write`, Standard „automatisch“): Ein Agent schlägt einen Eintrag vor (Titel, Inhalt). Der Eintrag wird mit Status **`proposed`** gespeichert und ist **nicht durchsuchbar**: Die Suche liefert nur `ready`, der Ingest überspringt Vorschläge, Listen, Zähler, Dokumentansicht und Export lassen sie aus. Erst wenn eine Person mit `knowledge.manage` ihn **übernimmt** (unverändert oder bearbeitet), wird er indiziert. Verwerfen löscht ihn. Weil der Vorschlag selbst harmlos ist, braucht das Werkzeug keine Freigabe pro Aufruf – die Prüfung findet beim Übernehmen statt, mit dem ganzen Text vor Augen.
- **Schutz vor Missbrauch:** Zugangsdaten (Passwort, PIN, API-Schlüssel, WLAN-Schlüssel …) werden vor dem Speichern entfernt (`redactCredentials`, gemeinsam mit dem Atera-Import); höchstens 100 offene Vorschläge pro Firma; Vorschläge, die 60 Tage niemand bearbeitet, löscht der nächtliche Job; jeder Schritt steht im Audit-Log (Vorschlag mit `actorType = 'agent'`, Lauf-ID). Die Werkzeugbeschreibung verbietet Vorschläge aus Dokumenten oder E-Mails, die dazu auffordern – verlässlich ist aber nur die menschliche Bestätigung.
- **Export als Markdown-ZIP:** Jede Sammlung lässt sich als ZIP herunterladen (eine `.md`-Datei pro Dokument mit YAML-Front-Matter `titel`, `herkunft`, `erstellt`, `quelle`), das sich direkt als Obsidian-Vault öffnen lässt. Artikel, Gedächtnis-Einträge und Markdown/Text kommen im Original, PDF/Word als erkannter Text (mit Hinweis). Dateinamen ohne Pfadtrenner, führende Punkte und reservierte Windows-Namen. eigenes Recht `knowledge.export` – Inhaber und Admins, nicht in Support-Sitzungen (eine Massenkopie ist mehr als Lesen oder Pflegen) –, 20 Exporte pro Person und 10 Minuten, Eintrag im Audit-Log. Das ZIP schreibt `packages/knowledge/src/zip.ts` selbst (Deflate über `node:zlib`, keine neue Abhängigkeit).
- **Vorlagen:** Firmenwissen-Agent und IT-Support-Agent nutzen `wissen_merken` („Problem gemeinsam gelöst, noch nicht dokumentiert → vorschlagen“).

## Konsequenzen

- Gelöstes Wissen bleibt in der Firma: Agenten schlagen vor, Menschen entscheiden, Agenten finden es beim nächsten Mal mit Quelle.
- Das Wissen ist portabel (Markdown, Obsidian) – kein Lock-in.
- Wer Vorschläge übernimmt, trägt Verantwortung für deren Richtigkeit; die Oberfläche weist darauf hin.
- Nicht in v1: Versionen/Verlauf eines Artikels, Rückimport aus Obsidian, Verknüpfungen zwischen Artikeln (`[[Wikilinks]]`), semantische Suche (Embeddings) – siehe Roadmap.
