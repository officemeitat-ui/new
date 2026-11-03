# ADR 0007 – Wissensdatenbank v1: Dateien in Postgres, deutsche Volltextsuche

**Status:** angenommen · **Datum:** 2026-11-03

## Kontext

Agenten sollen aus Firmendokumenten (Preislisten, AGB, Handbücher) antworten und die Quelle nennen (M5). Die Spezifikation sieht S3-kompatiblen Speicher und eine hybride Suche (Volltext + Vektoren) vor. Für eine erste, verkaufsfähige Version brauchen wir einen Weg, der ohne zusätzliche Dienste in jeder Umgebung funktioniert und mandantensicher ist.

- Ein S3-kompatibler Speicher ist im lokalen Setup und in der CI noch nicht vorhanden (MinIO stellt keine Community-Images mehr bereit; die Alternative wird mit dem Deployment entschieden).
- Die Claude API bietet keine Embeddings. Ein Embedding-Anbieter (z. B. Voyage AI) bringt einen weiteren Auftragsverarbeiter und Kosten pro Dokument mit sich und muss mit ME-IT abgestimmt werden.

## Entscheidung

- **Originaldateien in Postgres** (`knowledge_files.content bytea`), getrennt von `knowledge_documents`, damit Listen die Datei nie laden. Grenze 10 MB je Datei. Dieselbe RLS wie alle Mandantendaten; Backups enthalten die Dateien automatisch.
- **Verarbeitung im Worker** (Queue `knowledge`): Typ aus Dateiendung **und** Inhalt (Magic Bytes), Text mit `unpdf` (PDF, seitenweise) und `mammoth` (DOCX), Markdown/Text direkt. Abschnitte von etwa 1.200 Zeichen mit 150 Zeichen Überlappung, nie über Seitengrenzen, mit der nächsten Markdown-Überschrift.
- **Suche mit Postgres-Volltext, Konfiguration `german`:** generierte Spalte `tsv` (Überschrift höher gewichtet), GIN-Index. Die Wörter der Anfrage werden nach Stammformbildung ODER-verknüpft und nach `ts_rank_cd` sortiert, damit auch natürliche Fragen Treffer liefern.
- Das Werkzeug `wissen_suchen` liefert Textstellen mit Quelle („Dokument, S. x“); der Chat zeigt nur Quellen an, die die Antwort tatsächlich zitiert.

## Konsequenzen

- Keine neuen Dienste, keine Datenweitergabe an weitere Anbieter; funktioniert sofort in Entwicklung, CI und Produktion.
- Grenzen: Synonyme und zusammengesetzte Wörter („Urlaubsantrag“ vs. „Urlaub“) findet die Volltextsuche nur teilweise; gescannte PDFs ohne Textebene werden abgelehnt (OCR folgt).
- Die Tabelle `knowledge_files` ist die Naht für den späteren Umzug auf S3: Nur `addDocument` und `loadDocumentForIngest` greifen auf den Inhalt zu.
- **Später** (eigene ADRs): Embeddings in `pgvector` und hybride Suche mit Reciprocal Rank Fusion, sobald der Embedding-Anbieter feststeht; Datei-Ablage in S3, sobald das Deployment-Ziel feststeht.
