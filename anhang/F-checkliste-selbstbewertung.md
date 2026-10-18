# Anhang F – Selbstbewertung: Wie gut sind wir gegen KI-Angriffe geschützt?

> Zurück zur [Strategie](../KI-Cybersicherheitsstrategie.md)

**Anleitung:** Jede Frage ehrlich mit **Ja (2)**, **Teilweise (1)** oder **Nein (0)** bewerten. Fragen mit ★ sind Basisanforderungen – ein „Nein“ dort hat Vorrang vor allen anderen Lücken. Die Bewertung zu Beginn, nach 90 Tagen und danach halbjährlich wiederholen.

| Datum der Bewertung | Durchgeführt von | Gesamtpunkte |
|---|---|---|
| | | ___ / 96 |

---

## 1. Governance und Compliance (max. 12)

| # | Frage | Punkte |
|---|---|---|
| 1.1 ★ | Gibt es eine benannte, verantwortliche Person für Informationssicherheit und für KI? | |
| 1.2 ★ | Ist ein vollständiges KI-Inventar vorhanden (inkl. KI-Funktionen in bestehender Software)? | |
| 1.3 ★ | Ist eine KI-Nutzungsrichtlinie in Kraft und allen bekannt? | |
| 1.4 | Sind KI-spezifische Risiken in der Risikoanalyse berücksichtigt? | |
| 1.5 ★ | Ist geklärt, ob wir unter das NISG 2026 fallen (und ggf. registriert bis 31.12.2026)? | |
| 1.6 | Erhält die Geschäftsführung regelmäßig einen Bericht zur Sicherheitslage? | |

## 2. Identitäten und Zugriffe (max. 14)

| # | Frage | Punkte |
|---|---|---|
| 2.1 ★ | Nutzen alle privilegierten Konten phishing-resistente MFA (Passkeys/FIDO2)? | |
| 2.2 | Nutzen alle übrigen Konten phishing-resistente MFA? | |
| 2.3 ★ | Ist Legacy-Authentifizierung (ohne MFA) blockiert? | |
| 2.4 ★ | Erfolgen Passwort-/MFA-Resets nur nach starker Identitätsprüfung (Rückruf + zweite Bestätigung)? | |
| 2.5 | Ist die Zustimmung zu Drittanbieter-Apps für normale Benutzer gesperrt? | |
| 2.6 | Sind Admin-Rechte getrennt, zeitlich begrenzt und ohne dauerhafte globale Administratoren? | |
| 2.7 | Haben KI-Agenten und Dienstkonten eigene, eng begrenzte Identitäten? | |

## 3. Prozesse gegen Täuschung (max. 14)

| # | Frage | Punkte |
|---|---|---|
| 3.1 ★ | Gibt es verbindliche, schriftliche Verifikationsregeln für Zahlungen, Bankdatenänderungen und Resets? | |
| 3.2 ★ | Erfolgt jeder Rückruf ausschließlich über hinterlegte Kontaktdaten? | |
| 3.3 ★ | Ist das Vier-Augen-Prinzip im Zahlungsverkehr technisch erzwungen? | |
| 3.4 | Gibt es ein Codewort-Verfahren für Geschäftsführung, Assistenz und Finanzen? | |
| 3.5 | Hat die Geschäftsführung schriftlich Rückendeckung für Prüfungen und Verzögerungen gegeben? | |
| 3.6 | Werden Lieferanten- und Kundenbankdaten nur nach dokumentiertem Rückruf geändert? | |
| 3.7 | Wird die Identität neuer Mitarbeitender vor Vergabe von Zugängen verlässlich geprüft? | |

## 4. Technische Abwehr (max. 18)

| # | Frage | Punkte |
|---|---|---|
| 4.1 ★ | Sind SPF, DKIM und DMARC (mind. `p=quarantine`, Ziel `p=reject`) für alle Domains aktiv? | |
| 4.2 | Erkennt der E-Mail-Schutz BEC, Lookalike-Domains und Erstkontakte verhaltensbasiert? | |
| 4.3 ★ | Ist verhaltensbasiertes EDR auf allen Endgeräten und Servern aktiv? | |
| 4.4 ★ | Werden aktiv ausgenutzte Lücken an extern erreichbaren Systemen binnen 48 Stunden geschlossen? | |
| 4.5 | Wird die externe Angriffsfläche regelmäßig gescannt? | |
| 4.6 ★ | Gibt es eine offline bzw. unveränderliche Sicherung, deren Wiederherstellung getestet wurde? | |
| 4.7 | Sind lokale Administratorrechte entfernt und Makros eingeschränkt? | |
| 4.8 | Werden Identitäts-, E-Mail-, Endgeräte-, Cloud- und KI-Protokolle zentral gesammelt? | |
| 4.9 | Ist das Netzwerk segmentiert? | |

## 5. Sichere KI-Nutzung (max. 16)

| # | Frage | Punkte |
|---|---|---|
| 5.1 ★ | Steht ein freigegebenes KI-Werkzeug mit Business-Vertrag (kein Training mit unseren Daten) bereit? | |
| 5.2 | Werden nicht freigegebene KI-Dienste blockiert oder mit Warnung versehen? | |
| 5.3 ★ | Wurden Berechtigungen bereinigt, bevor KI-Suche oder Office-Assistenten aktiviert wurden? | |
| 5.4 | Benötigen Aktionen von KI-Agenten mit Außenwirkung eine menschliche Freigabe? | |
| 5.5 | Ist sichergestellt, dass kein Agent das „gefährliche Dreieck“ (vertrauliche Daten + fremde Inhalte + Ausleitungsweg) ohne Kontrolle vereint? | |
| 5.6 | Werden Plugins, Erweiterungen und MCP-Server nur von einer Allowlist zugelassen? | |
| 5.7 | Wird KI-generierter Code wie anderer Code geprüft (Review, SAST, Abhängigkeiten)? | |
| 5.8 | Wurden eigene KI-Anwendungen vor Inbetriebnahme gegen Prompt Injection getestet? | |

## 6. Menschen (max. 10)

| # | Frage | Punkte |
|---|---|---|
| 6.1 ★ | Wurden alle Mitarbeitenden zu KI-Phishing, Deepfakes und den Verifikationsregeln geschult? | |
| 6.2 | Erhalten Risikogruppen (Finanzen, Assistenz, HR, Helpdesk, Geschäftsführung) gezielte Schulungen? | |
| 6.3 | Finden regelmäßig realistische Simulationen statt (inkl. KI-generiertem Phishing)? | |
| 6.4 ★ | Gibt es einen einfachen Meldeweg (z. B. Melde-Button) und eine Melderate ≥ 70 %? | |
| 6.5 | Ist die Schulung zur KI-Kompetenz (AI Act Art. 4) dokumentiert? | |

## 7. Erkennung und Reaktion (max. 12)

| # | Frage | Punkte |
|---|---|---|
| 7.1 ★ | Werden sicherheitsrelevante Alarme rund um die Uhr bearbeitet (SOC/MDR)? | |
| 7.2 | Gibt es Erkennungsregeln für Kontoübernahme (neue MFA-Methode, Posteingangsregeln, App-Zustimmungen)? | |
| 7.3 ★ | Existiert ein Incident-Response-Plan mit Playbooks für Deepfake-Betrug, Kontoübernahme und KI-Missbrauch? | |
| 7.4 ★ | Sind Meldewege und Fristen (NISG, DSGVO) sowie Notfallkontakte dokumentiert? | |
| 7.5 | Wurde im letzten Jahr eine Notfallübung mit der Geschäftsführung durchgeführt? | |
| 7.6 | Ist geklärt, ob die Cyber-Versicherung Social Engineering/„Fake President“ deckt? | |

---

## Auswertung

| Punkte | Einschätzung | Empfehlung |
|---|---|---|
| **0–38** | Hohes Risiko | Sofort Phase 1 der Roadmap umsetzen, Fokus auf alle ★-Fragen |
| **39–67** | Grundschutz teilweise vorhanden | Offene ★-Fragen schließen, dann Phase 2 |
| **68–86** | Guter Schutz | Phase 3 – Reife, Tests, Automatisierung |
| **87–96** | Sehr guter Schutz | Halten, regelmäßig üben, Bedrohungslage beobachten |

**Unabhängig von der Gesamtpunktzahl gilt:** Jede mit „Nein“ beantwortete ★-Frage ist eine priorisierte Lücke.

### Top-3-Lücken aus dieser Bewertung

1. ______________________________________________
2. ______________________________________________
3. ______________________________________________
