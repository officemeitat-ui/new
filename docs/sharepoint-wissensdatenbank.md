# Wissensdatenbank in SharePoint – Aufbau-Vorschlag

Ziel: Ein Ort, an dem das Team Anleitungen, Standards und Checklisten findet – im Browser, in Teams und im Arbeitsplatz
(„Wissen & Dateien“ und KI-Assistent: „Wie richten wir einen neuen Mitarbeiter in M365 ein?“).

## 1. Website anlegen

1. SharePoint → **Website erstellen** → **Kommunikationswebsite**, Name z. B. „Wissen“ (Adresse `…/sites/wissen`).
2. Besitzer: Inhaber/in. Mitglieder: das Technik-Team (Bearbeiten). Keine Kunden, keine Gäste.
3. In Teams als Registerkarte im Team-Kanal anheften.
4. Die Adresse in `config/workspace.ts` → `knowledge.sharePointSiteUrl` eintragen.

## 2. Struktur

| Bibliothek / Bereich | Inhalt | Beispiele |
|---|---|---|
| **Anleitungen** (Seiten) | Schritt-für-Schritt, kurz, mit Screenshots | Neuer Mitarbeiter in M365, Securepoint-Update, UniFi-AP tauschen |
| **Standards** (Seiten) | Wie wir es bei jedem Kunden machen | M365-Grundschutz, Namensschema, Backup-Standard, Firewall-Basisregeln |
| **Checklisten** (Dokumente) | Abhakbar, als Vorlage | Onboarding, Offboarding, Serverwechsel, Jahreswartung |
| **Vorlagen** (Dokumente) | Word/Excel-Vorlagen | Angebot, Übergabeprotokoll, Wartungsvertrag |
| **Richtlinien** (Dokumente) | Intern verbindlich | KI-Nutzungsrichtlinie, Verifikationsregeln, Datenschutz |

Tipps:
- **Seiten statt Word**, wo es geht – Seiten werden besser gefunden und sind am Handy lesbar.
- Titel so formulieren, wie man sucht: „Securepoint: Firmware aktualisieren“ statt „Update-Prozess v3“.
- Je Seite oben: *Wofür*, *Dauer*, *Voraussetzungen*. Unten: *Zuletzt geprüft am*.
- **Keine Passwörter** in SharePoint – die liegen in Keeper. Kundenspezifisches gehört in die Kunden-Doku des Arbeitsplatzes.

## 3. Berechtigungen und Sicherheit

- Vor dem Einschalten von KI-Suche oder Copilot **Berechtigungen bereinigen** („Jeder außer externen Benutzern“ vermeiden).
- Freigabe nach außen für diese Website **abschalten** (Website-Einstellungen → Freigabe → nur Personen in der Organisation).
- Vertraulichkeitsbezeichnungen (Purview) verwenden, falls vorhanden.

## 4. Was der Arbeitsplatz damit macht

- Suche mit den Rechten der angemeldeten Person (Microsoft Search) – wer etwas nicht sehen darf, findet es auch hier nicht.
- „Frag die Wissensdatenbank“: Claude antwortet nur aus den gefundenen Suchauszügen und nennt die Quellen. Ganze Dokumente
  gehen nicht an die KI.
- Der Assistent kann auf Zuruf suchen („Such die Onboarding-Checkliste“) – mit Link zum Dokument.
