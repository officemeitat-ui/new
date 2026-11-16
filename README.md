# Cybersicherheit gegen KI-Angriffe

Strategie, Playbooks und Vorlagen zum Schutz unserer Organisation vor KI-gestützten Angriffen
(Deepfakes, KI-Phishing, automatisierte Angriffe) und vor Angriffen auf unsere eigenen KI-Systeme
(Prompt Injection, Datenabfluss, manipulierte KI-Agenten).

**Stand:** Oktober 2026 · **Status:** Entwurf zur Beschlussfassung durch die Geschäftsführung

## Inhalt

| Dokument | Zweck | Zielgruppe |
|---|---|---|
| [**Übersicht für die Geschäftsführung**](uebersicht-geschaeftsfuehrung.html) | Webseite: Kernaussage, Angriffsbeispiel, Sofortmaßnahmen, Fahrplan, Fristen mit Countdown, interaktiver Schnell-Check, Beschlusspunkte | Geschäftsführung |
| [**KI-Cybersicherheitsstrategie**](KI-Cybersicherheitsstrategie.md) | Bedrohungslage, Ziele, Leitprinzipien, 9 Handlungsfelder mit Maßnahmen, Roadmap, Rollen, Kennzahlen, Rechtsrahmen | Geschäftsführung, Informationssicherheit, IT |
| [A – Playbook Deepfake- & CEO-Betrug](anhang/A-playbook-deepfake-ceo-betrug.md) | Vorgehen bei Täuschungsversuchen und nach erfolgter Fehlüberweisung | Finanzen, Assistenz, Informationssicherheit |
| [B – Playbook KI-Phishing & Kontoübernahme](anhang/B-playbook-ki-phishing-kontouebernahme.md) | Vorgehen bei Phishing und übernommenen Konten | IT, Informationssicherheit |
| [C – Playbook Angriff auf eigene KI-Systeme](anhang/C-playbook-angriff-auf-ki-systeme.md) | Vorgehen bei Prompt Injection, Agenten-Missbrauch, Datenabfluss über KI | IT, KI-Verantwortliche |
| [D – KI-Nutzungsrichtlinie](anhang/D-richtlinie-ki-nutzung.md) | Muster-Richtlinie: freigegebene Tools, Datenklassen, Verbote, Pflichten | alle Mitarbeitenden |
| [E – Verifikationsregeln](anhang/E-verifikationsregeln.md) | Einseiter „STOPP · PRÜFEN · BESTÄTIGEN“ zum Aushängen | alle Mitarbeitenden |
| [F – Selbstbewertung](anhang/F-checkliste-selbstbewertung.md) | Checkliste mit Punktesystem zur Standortbestimmung | Informationssicherheit, Geschäftsführung |
| [G – Beschlussvorlage](anhang/G-beschlussvorlage-geschaeftsfuehrung.md) | Beschlusspunkte, Budgetrahmen, nächste 30 Tage, Unterschriften | Geschäftsführung |
| [H – Notfallübung „Freitagabend“](anhang/H-notfalluebung-tabletop.md) | Drehbuch mit sechs Einspielungen (Deepfake-Anruf bis Wiederanlauf), Beobachtungsbogen | Geschäftsführung, Krisenteam |
| [I – Kommunikationsvorlagen](anhang/I-kommunikationsvorlagen.md) | Rundschreiben, Lieferantenbrief, Kundenhinweis, Warnmeldung, Stellungnahme bei Deepfake | Geschäftsführung, Kommunikation, Finanzen |
| [J – Technische Umsetzung](anhang/J-technische-umsetzung.md) | Konkrete Einstellungen für Microsoft 365 / Entra ID und Google Workspace, DNS-Beispiele, Erkennungsregeln mit KQL-Abfragen, Absicherung von KI-Agenten | IT-Betrieb, IT-Dienstleister |
| [K – KI-Inventar & Anbieterbewertung](anhang/K-vorlagen-ki-inventar-anbieter.md) | Inventarfelder, Risikostufen, Freigabe-Checkliste für Agenten, Fragebogen für KI-Anbieter, Anforderungen an IT-Dienstleister | KI-Verantwortliche, Einkauf |
| [L – Awareness-Jahresplan](anhang/L-awareness-jahresplan.md) | Zwölf Monatsimpulse mit versandfertigen Texten, Simulationsplan, Ablauf der Deepfake-Demonstration | Informationssicherheit, HR |
| [M – Schulungsmodul KI-Kompetenz](anhang/M-schulungsmodul-ki-kompetenz.md) | 60-Minuten-Basisschulung mit Sprechernotizen, Übung „Echt oder Angriff?“, Quiz mit Lösungen, Teilnahmenachweis, Vertiefungen für Risikogruppen (AI Act Art. 4) | alle Mitarbeitenden, Schulungsleitung |
| [vorlagen/massnahmenplan.xlsx](vorlagen/massnahmenplan.xlsx) | Alle 75 Maßnahmen mit Status, Fälligkeit (aus dem Projektstart berechnet), Verantwortlichen und Nachweis; Übersichtsblatt mit Fortschritt nach Phase und Handlungsfeld | Informationssicherheit, Geschäftsführung |
| [vorlagen/ki-inventar.csv](vorlagen/ki-inventar.csv) | Ausfüllbare Inventartabelle (öffnet direkt in Excel) | KI-Verantwortliche |

## So verwenden Sie dieses Paket

1. **Standort bestimmen:** Selbstbewertung ([Anhang F](anhang/F-checkliste-selbstbewertung.md)) durchführen.
2. **Anpassen:** Alle Stellen mit **[ANPASSEN]** ergänzen (Schwellenwerte, Kontakte, Werkzeuge, Verantwortliche).
3. **Beschließen:** Beschlussvorlage ([Anhang G](anhang/G-beschlussvorlage-geschaeftsfuehrung.md)) mit dem Ergebnis der Selbstbewertung der Geschäftsführung vorlegen.
4. **Sofort starten:** Phase 1 der Roadmap (Tag 0–30) umsetzen – insbesondere Verifikationsregeln, phishing-resistente MFA für Risikogruppen ([Anhang J](anhang/J-technische-umsetzung.md)) und die KI-Nutzungsrichtlinie.
5. **Kommunizieren:** Rundschreiben ([Anhang I](anhang/I-kommunikationsvorlagen.md)) und Verifikationsregeln ([Anhang E](anhang/E-verifikationsregeln.md)) an alle verteilen, Deepfake-Demonstration durchführen ([Anhang L](anhang/L-awareness-jahresplan.md)).
6. **Üben:** Innerhalb von 90 Tagen die Notfallübung ([Anhang H](anhang/H-notfalluebung-tabletop.md)) mit der Geschäftsführung durchführen.
7. **Überprüfen:** Nach 90 Tagen Selbstbewertung wiederholen, danach halbjährlich.

## Annahmen

- Organisation mit Sitz in Österreich (Rechtsrahmen: NISG 2026, DSGVO, AI Act)
- Kleines bis mittleres Unternehmen mit Cloud-Office und teilweise externen IT-Dienstleistern

Für andere Länder oder Branchen (z. B. Finanzsektor mit DORA) sind insbesondere Kapitel 9 und die Meldewege anzupassen.

> **Hinweis:** Diese Unterlagen ersetzen keine Rechtsberatung. Gesetzliche Fristen und Pflichten sind im Einzelfall anhand der aktuellen Gesetzestexte zu prüfen.
