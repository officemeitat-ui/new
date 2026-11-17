# Roadmap: Arbeitsplatz für IT-Dienstleister

Leitfrage für jede Funktion: **Spart sie uns Zeit, macht sie Kunden sicherer – oder beides?**
Sortiert nach Nutzen im Verhältnis zum Aufwand. ✅ = vorhanden.

## Vorhanden

- ✅ Heute-Übersicht, Aufgaben (statt To Do), Tickets/Warnungen/Geräte aus Atera, Kundenakte mit Keeper-Link
- ✅ KI-Assistent per Sprache: Termine, Aufgaben, E-Mail-Entwürfe, Zeiten, Doku-Fragen, Netz-Prüfung, Dateisuche
- ✅ E-Mail-Assistent mit Outlook-Entwürfen, Belege-Ablage, Stundenpakete und Leistungsnachweis
- ✅ Verschlüsselte Kunden-Doku (Tresor) mit Netzwerkplan, Live-Prüfung, VLAN-Übersicht, Patchschrank, Verkabelung
- ✅ Konten mit Microsoft-Anmeldung (SSO, MFA über Conditional Access) oder Passwort + Einmalcode, Rollen, Protokoll
- ✅ Wissen & Dateien aus OneDrive/SharePoint, „Frag die Wissensdatenbank“
- ✅ Security-Awareness-Plattform für Team und Kunden (AI Act Art. 4, Nachweis, Selbstbewertung)

## Als Nächstes (größter Hebel)

1. **UniFi- und Securepoint-Import** – Geräte, Ports, VLANs und WAN direkt aus UniFi Network (API) bzw. der Securepoint-Konfiguration
   übernehmen statt abtippen; regelmäßiger Abgleich zeigt Abweichungen zur Doku („Port 12 ist jetzt VLAN 30 – Doku sagt 20“).
2. **Ablauf-Überwachung** – Zertifikate (TLS), Domains, Lizenzen (M365, Securepoint, Sophos, Kaspersky), Garantien (HP, Lenovo,
   TERRA) je Kunde; 60/30/7 Tage vorher als Aufgabe auf „Heute“ und als Angebotsentwurf.
3. **M365-Mandanten-Check für Kunden** (über GDAP/Lighthouse): MFA-Abdeckung, Legacy-Auth, Admin-Konten, Weiterleitungen nach außen,
   Secure Score – Ergebnis direkt in die Selbstbewertung und den Monatsbericht.
4. **Onboarding/Offboarding-Assistent** – Checkliste je Kunde; legt in Entra ID Konto, Gruppen, Lizenz an bzw. sperrt, entzieht,
   leitet um – mit Freigabe per Klick und Protokoll.
5. **Monatsbericht für Kunden** aus Atera, Stunden, Awareness-Stand und Netz-Prüfung – als PDF, als Entwurf in Outlook.
6. **Angebote aus Tickets** – „Server ist 7 Jahre alt“ → Angebotsvorschlag mit TD-Synnex-/Wortmann-Preisen (CSV-Import der
   Preislisten), Übergabe an FreeFinance.

## Danach

- **Passkeys** (FIDO2) direkt im Arbeitsplatz zusätzlich zum Einmalcode
- **Kundenportal**: Kunden sehen ihre Tickets, Stundenkonto, Schulungsstand, Doku-Auszüge (ohne Zugangsdaten)
- **Phishing-Simulation** – besser über Microsoft Defender „Attack Simulation Training“ (Plan 2) anbinden statt selbst Mails zu versenden;
  Ergebnisse fließen in die Awareness-Übersicht
- **Änderungsverlauf der Doku** (wer hat wann was geändert, Vergleich, Wiederherstellen)
- **Notfallhandbuch je Kunde** auf Knopfdruck (aus Netzwerk, Ansprechpartnern, Backup-Seite) – als PDF für den Tresor beim Kunden
- **NIS2-Mappe**: Selbstbewertung, Schulungsnachweise, Netzplan, Notfallhandbuch und Maßnahmenplan in einem Paket
- **Wartungsfenster und Patch-Status** aus Atera mit automatischem Kunden-Hinweis (Entwurf)
- **Weitere Awareness-Kurse**: Phishing & Passwörter, Arbeiten unterwegs, Social Engineering am Telefon – im selben Format

## Grundsätze

- **Nichts geht automatisch nach außen**: E-Mails sind Entwürfe, Änderungen beim Kunden brauchen eine Freigabe.
- **Passwörter nur in Keeper**, nie im Arbeitsplatz und nie an die KI.
- **Kundendaten verschlüsselt** und nur mit den Rechten der Person, die gerade arbeitet.
