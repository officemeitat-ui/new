# Wissen – die Hilfe-Bibliothek

Das Cockpit bringt eine fertige Bibliothek mit **600 Anleitungen** für den IT-Alltag kleiner Betriebe mit
(rund 118.000 Wörter). Sie wird beim ersten Start automatisch geladen und steht unter **Wissen**.

| Bereich | Artikel | davon für Anwender |
| --- | ---: | ---: |
| Windows & Arbeitsplatz | 30 | 20 |
| Outlook & E-Mail | 30 | 20 |
| Teams, OneDrive, SharePoint & Office | 30 | 22 |
| Excel, Word & PowerPoint | 30 | 24 |
| Browser, PDF & Internet | 30 | 22 |
| Drucker & Scanner | 30 | 18 |
| Netzwerk, WLAN & VPN | 30 | 12 |
| Telefonie & Besprechungsräume | 30 | 14 |
| Mobilgeräte, Homeoffice & Abläufe | 30 | 16 |
| Mac, iPhone & iPad | 30 | 20 |
| Sicherheit & Notfälle | 30 | 15 |
| Datenschutz, NIS2 & Richtlinien | 30 | 8 |
| Datensicherung, NAS & Hardware | 30 | 8 |
| Microsoft 365 Administration | 30 | 0 |
| Geräteverwaltung & Softwareverteilung | 30 | 0 |
| Server & Active Directory | 30 | 0 |
| Virtualisierung, Azure & Hybrid | 30 | 0 |
| Firewall, Router & Internetanschluss | 30 | 4 |
| Branchensoftware & Datenbanken | 30 | 4 |
| IT-Betreuung: Standards & Kundengespräche | 30 | 0 |
| **Gesamt** | **600** | **227** |

Der letzte Bereich ist für dich selbst gedacht: Arbeitsanweisungen und Gesprächshilfen für den IT-Dienstleister
(Erstgespräch, Übernahme vom Vorgänger, monatliche Wartungsroutine, Quartalsgespräch, Umgang mit Zuruf-Anfragen,
abgelehnte Empfehlung dokumentieren, Preisanpassung ankündigen …).

Jeder Artikel hat denselben Aufbau: **Symptom → Häufige Ursachen → Lösung in Schritten → Wenn das nicht hilft**
(bei Technik-Artikeln zusätzlich „Für das Ticket notieren“).

## Zwei Zielgruppen

- **Für Anwender (227 Artikel):** Anleitungen ohne Admin-Rechte und ohne riskante Schritte. Nur diese verwendet die
  **Hilfe im Kundenportal** – ein Kunde, der „Drucker offline“ eintippt, bekommt die passende Anleitung, bevor ein
  Ticket entsteht.
- **Nur Technik (373 Artikel):** interne Anleitungen mit PowerShell, Admin Center, Server. Sie erscheinen nie im Portal.
  Riskante Schritte sind mit **Achtung:** markiert.

Die Zuordnung lässt sich je Artikel ändern (Artikel öffnen → *Fürs Portal freigeben* / *Portal-Freigabe entfernen*).

## So wird gesucht

Oben das Problem eintippen – so, wie es ein Kunde am Telefon sagt. Die Suche

- versteht **Wortformen** („sendet“ findet „senden“, „Drucker“ findet „Druckertreiber“),
- kennt **gängige Synonyme** (Kennwort/Passwort, WLAN/WiFi, PC/Rechner/Computer, Handy/Smartphone, Backup/Sicherung …),
- gewichtet Treffer in **Titel und Schlagworten** stärker als ein beiläufiges Wort im Text,
- und nutzt zusätzlich die **sinngemäße Suche**, wenn eine lokale KI mit Embedding-Modell läuft
  (*Neu indexieren* berechnet die Vektoren für alle Artikel).

Links lässt sich auf einen Bereich einschränken, darüber auf *Für Anwender* oder *Nur Technik*.

Dieselben Artikel nutzen auch der **Triage-Agent** (Lösungsvorschlag im Ticket), der **Assistent** und die
**globale Suche (Strg+K)**.

## Passende Anleitungen direkt im Ticket

Jedes Ticket zeigt oben bis zu vier **passende Anleitungen aus dem Wissen** – auch ohne KI und auch bei Tickets, die aus
Atera gespiegelt sind. Ein Klick öffnet die Anleitung, „Text kopieren“ übernimmt sie in die Antwort an den Kunden.
Den Ausschlag gibt der Titel des Tickets, die Beschreibung verfeinert nur. Das ist bewusst streng eingestellt: Passt
nichts wirklich, wird nichts vorgeschlagen.

## Eigene Artikel und Anpassungen

Die Bibliothek ist ein Ausgangspunkt, kein fertiges Handbuch für deinen Betrieb:

- **+ Artikel** legt eigene Anleitungen an (mit Bereich, Schlagworten und Vorlage für den Aufbau).
- Jeder Bibliotheksartikel lässt sich **bearbeiten** – z. B. „Bei uns steht der Ersatztoner im Lager, Regal 3“.
- **Bibliothek aktualisieren** (nur Verwaltung) liest neue Fassungen ein. Dabei gilt:
  - Artikel, die du **geändert** hast, bleiben, wie sie sind.
  - Artikel, die du **gelöscht** hast, kommen nicht wieder.
  - Unveränderte Artikel bekommen die neue Fassung.
- Gelöste Tickets lassen sich wie bisher per Klick als Wissensartikel übernehmen.

Die Artikel liegen als Textdateien in `meit/kb/` (Format: `meit/kb/FORMAT.md`). Wer mag, schreibt dort eigene
Sammlungen dazu – beim nächsten Start werden sie eingelesen.

Mit `MEIT_KB_LIBRARY=false` in `.env` wird die Bibliothek beim Start nicht automatisch geladen.

## Was du über die Qualität wissen musst

- Die Artikel wurden **maschinell geschrieben** und auf Format, Länge, Aufbau und die enthaltenen Befehle
  durchgesehen. Sie wurden **nicht an echten Systemen Schritt für Schritt nachgestellt**.
- Menünamen bei Microsoft ändern sich laufend (Windows 10/11, neues Outlook, Admin Center). Wo das bekannt ist,
  steht „je nach Version“ dabei – trotzdem kann ein Pfad bei dir anders heißen.
- Bevor du dich bei einem Kunden auf einen **Technik-Artikel mit „Achtung“** verlässt (Registry, Rollen verschieben,
  Wiederherstellung): einmal selbst durchlesen und bei Bedarf anpassen. Du bist der Fachmann – die Bibliothek spart
  das Schreiben, nicht das Prüfen.
- Rechtliches (Datenschutz, NIS2, Datenpanne, Aufbewahrung, Registrierkasse, Entsorgung) ist bewusst allgemein gehalten,
  nennt keine Fristen oder Schwellenwerte und ersetzt keine Beratung.
