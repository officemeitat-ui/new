# Unterauftragsverarbeiter – ENTWURF

> **Entwurf zur rechtlichen Prüfung.** Die App zeigt unter Einstellungen → Datenschutz die Liste **dieser Installation**, abgeleitet aus der Konfiguration (`LLM_PROVIDER`, `SMTP_HOST`, `HOSTING_DESCRIPTION`). Diese Datei beschreibt die möglichen Varianten.

| Dienst              | Variante                                       | Zweck                                           | Ort                                             | Hinweis                                                                                             |
| ------------------- | ---------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Hosting             | [Anbieter eintragen]                           | Betrieb, Datenbank, Dateien, Backups            | [Standort, z. B. AT/DE]                         | Zertifizierungen und Standort im AVV nennen                                                         |
| KI-Modelle (Claude) | Anthropic, PBC – Claude API                    | Chat und Agenten                                | USA                                             | Drittlandübermittlung: Garantien (z. B. Standardvertragsklauseln) laut Vertrag mit Anthropic prüfen |
| KI-Modelle (Claude) | Amazon Web Services EMEA SARL – Amazon Bedrock | Chat und Agenten                                | EU-Region (`AWS_REGION`, Standard eu-central-1) | Option „Verarbeitung nur in der EU“                                                                 |
| KI-Modelle (Claude) | Google Cloud EMEA Limited – Vertex AI          | Chat und Agenten                                | EU (`GOOGLE_VERTEX_REGION=eu`)                  | Option „Verarbeitung nur in der EU“                                                                 |
| E-Mail-Versand      | [SMTP-Anbieter eintragen]                      | Einladungen, Anmeldelinks, freigegebene E-Mails | [Standort]                                      |                                                                                                     |

**Kein Unterauftragsverarbeiter von ME-IT:** Microsoft 365/Intune des Kunden. Die Plattform fragt dort nur im Auftrag des Kunden ab (App-Zugriff nach Zustimmung des Kunden-Admins, ADR 0008); der Vertrag mit Microsoft besteht zwischen Kunde und Microsoft.
