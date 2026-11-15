"""Leistungskatalog + Demodaten, damit die App sofort etwas zeigt.

Alle Preise sind Beispielwerte (netto, EUR) – bitte an die eigene Kalkulation anpassen.
Die Demokunden sind frei erfunden.
"""

from __future__ import annotations

import json
from datetime import date, timedelta

from .db import Database

# code, name, beschreibung, einheit, preis, wiederkehrend, stichworte
SERVICES = [
    ("MW", "Managed Workplace", "Support-Flatrate, Wartung, Patch-Management und Monitoring je Benutzer",
     "User/Monat", 39.0, 1, "arbeitsplatz pc support wartung managed flatrate benutzer helpdesk"),
    ("MS", "Managed Server", "Überwachung, Updates und Betreuung je Server (physisch/virtuell)",
     "Server/Monat", 149.0, 1, "server wartung hyper-v vmware ueberwachung"),
    ("MON", "Monitoring & Patch-Management", "Proaktive Überwachung und automatische Updates je Gerät",
     "Gerät/Monat", 6.0, 1, "monitoring patch updates rmm ueberwachung"),
    ("SEC", "Security-Paket (EDR/MDR, Mail-Security)", "Endpoint Detection & Response, 24/7-Überwachung, Mailfilter",
     "User/Monat", 12.0, 1, "virus sicherheit edr mdr antivirus phishing ransomware security malware"),
    ("AWR", "Security-Awareness-Training", "Phishing-Simulationen und Kurzschulungen für Mitarbeiter",
     "User/Monat", 4.0, 1, "schulung phishing awareness mitarbeiter training"),
    ("BCK", "Backup & Recovery", "Unveränderbares Offsite-Backup inkl. vierteljährlichem Restore-Test",
     "Monat", 89.0, 1, "backup sicherung restore datenverlust wiederherstellung nas"),
    ("M365B", "Microsoft-365-Backup", "Sicherung von Exchange Online, OneDrive, SharePoint und Teams",
     "User/Monat", 3.0, 1, "m365 backup onedrive sharepoint exchange sicherung"),
    ("MFW", "Managed Firewall", "Next-Gen-Firewall inkl. VPN, Updates und Überwachung",
     "Monat", 59.0, 1, "firewall vpn netzwerk router sicherheit"),
    ("NIS2GAP", "NIS2/NISG-2026 Gap-Analyse", "Betroffenheitsprüfung, Ist-Analyse, Maßnahmenplan, Registrierung",
     "Pauschal", 1900.0, 0, "nis2 nisg compliance audit risiko registrierung gesetz"),
    ("VCISO", "Informationssicherheit as a Service (vCISO)", "Laufende ISMS-Betreuung, Richtlinien, Nachweise, Meldeprozesse",
     "Monat", 490.0, 1, "nis2 isms iso 27001 sicherheitsbeauftragter richtlinie compliance"),
    ("WIN11", "Windows-11-Migration", "Upgrade bzw. Neuinstallation inkl. Datenübernahme je Gerät",
     "Gerät", 180.0, 0, "windows 10 windows 11 migration upgrade esu"),
    ("NEWPC", "Neugerät einrichten", "Beschaffung, Image, Software, Datenübernahme und Übergabe je Gerät",
     "Gerät", 150.0, 0, "neuer pc laptop notebook hardware tausch austausch rechner"),
    ("SRVMOD", "Server-Modernisierung (Cloud/Hybrid)", "Ablöse veralteter Server (z. B. Windows Server 2016, Exchange)",
     "Pauschal", 3500.0, 0, "server migration cloud azure exchange hybrid ablöse modernisierung"),
    ("M365MIG", "Microsoft-365-Einführung", "Migration E-Mail/Dateien, Teams, Intune-Basis je Benutzer",
     "User", 95.0, 0, "m365 office 365 exchange teams sharepoint email migration intune"),
    ("NET", "Netzwerk/WLAN-Modernisierung", "Planung und Umsetzung Switches, Access Points, VLANs",
     "Pauschal", 2400.0, 0, "wlan wifi netzwerk switch access point vlan langsam"),
    ("KIWS", "KI-Workshop & AI-Act-Kompetenzschulung", "Halbtag: sichere KI-Nutzung, Richtlinie, Use-Cases (Art. 4 AI Act)",
     "Pauschal", 1200.0, 0, "ki ai chatgpt copilot schulung ai act workshop kuenstliche intelligenz"),
    ("KIBOX", "Private KI-Box – Einrichtung", "Lokaler KI-Server (DSGVO-konform) mit Dokumentensuche, ohne Cloud",
     "Pauschal", 4900.0, 0, "ki lokal offline dsgvo ki-server chatbot dokumente datenschutz private"),
    ("KIBOXM", "Private KI-Box – Betreuung", "Updates, neue Modelle, Monitoring und Support der KI-Box",
     "Monat", 149.0, 1, "ki box betreuung wartung modell"),
    ("KIAGENT", "KI-Agenten-Automatisierung", "Analyse und Automatisierung eines Geschäftsprozesses mit KI-Agenten",
     "Pauschal", 2900.0, 0, "automatisierung agent workflow prozess ki effizienz"),
    ("KIMA-POT", "KI-Mitarbeiter Potenzialanalyse", "Vor Ort: Abläufe aufnehmen, Einsparpotenzial und ROI berechnen "
     "(wird bei Beauftragung angerechnet)", "Pauschal", 490.0, 0,
     "ki mitarbeiter potenzialanalyse automatisierung prozesse workshop roi"),
    ("KIMA", "KI-Mitarbeiter Einrichtung", "Individueller KI-Mitarbeiter: Posteingang sortieren, Anfragen ins CRM, "
     "Antwortentwürfe, Belege, Nachfassen – lokal und DSGVO-konform", "Pauschal", 3900.0, 0,
     "ki mitarbeiter assistent automatisierung email posteingang anfragen crm belege kundenanfragen"),
    ("KIMAM", "KI-Mitarbeiter Betrieb & Optimierung", "Monitoring, Anpassungen, neue Abläufe, monatlicher Wirkungsbericht",
     "Monat", 249.0, 1, "ki mitarbeiter betrieb wartung optimierung"),
    ("STD", "Technikerstunde", "Arbeitszeit vor Ort oder remote",
     "Stunde", 110.0, 0, "stunde techniker vor ort remote einsatz"),
]

PACKAGES = {"keins": 0, "basis": 1, "pro": 2, "premium": 3}


def seed_services(db: Database) -> None:
    """Legt fehlende Katalog-Leistungen an (bestehende, evtl. angepasste Preise bleiben unverändert)."""
    existing = {r["code"] for r in db.query("SELECT code FROM services")}
    for code, name, desc, unit, price, recurring, keywords in SERVICES:
        if code in existing:
            continue
        db.insert(
            "services",
            {"code": code, "name": name, "description": desc, "unit": unit, "price": price,
             "recurring": recurring, "keywords": keywords, "active": 1},
        )


def _d(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


KB_ARTICLES = [
    ("Outlook startet nicht / hängt beim Profil laden",
     "outlook m365 email",
     """## Symptome
Outlook bleibt beim Start bei "Profil wird geladen" hängen oder startet gar nicht.

## Lösung
1. Outlook im abgesicherten Modus starten: `outlook.exe /safe` – startet es, ein Add-in deaktivieren.
2. Office-Schnellreparatur: Einstellungen > Apps > Microsoft 365 > Ändern > Schnellreparatur.
3. Neues Outlook-Profil anlegen: Systemsteuerung > Mail > Profile anzeigen > Hinzufügen.
4. OST-Datei umbenennen (%LOCALAPPDATA%\\Microsoft\\Outlook) – wird neu synchronisiert.
"""),
    ("Drucker druckt nicht – Druckwarteschlange hängt",
     "drucker hardware windows",
     """## Lösung
1. Dienst neu starten (Admin-PowerShell): `Restart-Service Spooler -Force`
2. Hängt es weiter: Spooler stoppen, Inhalt von `C:\\Windows\\System32\\spool\\PRINTERS` löschen, Spooler starten.
3. Druckertreiber prüfen – bei Netzwerkdruckern feste IP / DHCP-Reservierung verwenden.
4. Bei mehreren betroffenen PCs: Druckserver bzw. Gerät selbst neu starten.
"""),
    ("VPN verbindet nicht (Homeoffice)",
     "vpn netzwerk firewall homeoffice",
     """## Checkliste
1. Internet beim Benutzer ok? (Speedtest, anderes Netz/Hotspot testen)
2. Zugangsdaten / MFA-Bestätigung abgelaufen? Konto gesperrt?
3. VPN-Client-Version aktuell? Zertifikat gültig?
4. Firewall-Logs prüfen: kommt der Verbindungsversuch an?
5. Heimrouter mit gleichem IP-Bereich wie Firma (z. B. 192.168.1.0/24) → Adresskonflikt.
"""),
    ("MFA für Microsoft 365 einrichten",
     "m365 sicherheit mfa nis2",
     """## Warum
MFA verhindert den Großteil der Konto-Übernahmen und ist Basis jeder NIS2-Maßnahme.

## Schritte
1. Entra ID: Sicherheitsstandards bzw. Conditional-Access-Richtlinie "MFA für alle Benutzer".
2. Microsoft Authenticator am Handy, Nummernabgleich aktivieren.
3. Notfall-Admin-Konto (Break-Glass) ohne MFA-Abhängigkeit dokumentiert sichern.
4. Legacy-Authentifizierung blockieren.
"""),
    ("Phishing-Verdacht / Mitarbeiter hat auf Link geklickt – Sofortmaßnahmen",
     "sicherheit phishing incident notfall",
     """## Sofort (innerhalb 15 Minuten)
1. Gerät vom Netzwerk trennen (LAN/WLAN), nicht ausschalten.
2. Passwort des Kontos zurücksetzen, alle Sitzungen abmelden, MFA-Methoden prüfen.
3. Posteingangsregeln prüfen (Weiterleitungen an Fremde!).
4. EDR-Scan / Isolation des Geräts.

## Danach
- Vorfall dokumentieren. Bei NIS2-pflichtigen Kunden: Frühwarnung binnen 24 h an die Behörde prüfen.
- Andere Empfänger derselben Mail warnen, Mail tenantweit löschen.
"""),
    ("Backup-Restore-Test durchführen",
     "backup server restore",
     """## Vorgehen (vierteljährlich)
1. Zufällige Datei/Ordner und eine komplette VM aus dem Backup wiederherstellen (Testumgebung).
2. Dauer messen (RTO) und Alter der Sicherung prüfen (RPO).
3. Ergebnis im Kundenbericht dokumentieren – wichtig für Versicherung und NIS2-Nachweis.
4. Mindestens eine Kopie offline/unveränderbar (3-2-1-1-0-Regel).
"""),
    ("Windows 11 Upgrade – Checkliste",
     "windows 11 windows 10 migration",
     """## Voraussetzungen
- TPM 2.0, Secure Boot, unterstützte CPU (PC-Integritätsprüfung).
- Windows 10 erhält seit Oktober 2025 nur noch mit kostenpflichtigem ESU Sicherheitsupdates.

## Ablauf
1. Inventar: welche Geräte sind kompatibel, welche müssen getauscht werden?
2. Software-Kompatibilität (Branchensoftware!) mit Hersteller klären.
3. Pilotgruppe, dann Rollout per Intune/RMM. Datenübernahme prüfen.
"""),
    ("WLAN langsam / Abbrüche – Analyse",
     "wlan netzwerk wifi",
     """## Analyse
1. Kanalauslastung messen (2,4 GHz meiden, 5/6 GHz bevorzugen).
2. Anzahl und Position der Access Points prüfen – Heatmap erstellen.
3. Firmware der APs/Controller aktualisieren.
4. Alte Clients (802.11n) bremsen das Netz – eigenes SSID/Band.
"""),
    ("Neuer Mitarbeiter – Onboarding-Checkliste",
     "benutzer onboarding m365 zugang",
     """1. Benutzer in Entra ID/AD anlegen, Lizenz zuweisen, Gruppen/Rechte nach Rolle.
2. MFA einrichten, Passwort-Richtlinie erklären.
3. Gerät vorbereiten (Intune/Autopilot), Drucker, Netzlaufwerke/SharePoint.
4. Security-Awareness-Kurzschulung, IT-Richtlinie unterschreiben lassen.
5. Beim Austritt: Konto sperren, Postfach in freigegebenes Postfach umwandeln, Geräte zurück.
"""),
]


def seed_demo(db: Database) -> None:
    if db.scalar("SELECT COUNT(*) FROM customers"):
        return

    customers = [
        dict(name="Tischlerei Huber GmbH", contact_name="Franz Huber", email="office@huber-demo.at",
             phone="+43 7200 1111", address="Hauptstraße 1, 4020 Linz", industry="Handwerk",
             employees=12, package="basis", mrr=468.0, contract_end=_d(45),
             booked_services=["MW"], notes="Chef will alles einfach. Viele Probleme mit Druckern."),
        dict(name="Steuerberatung Gruber & Partner", contact_name="Mag. Eva Gruber", email="kanzlei@gruber-demo.at",
             phone="+43 1 2222", address="Ringstraße 5, 1010 Wien", industry="Steuerberatung",
             employees=28, package="pro", mrr=1680.0, contract_end=_d(300),
             booked_services=["MW", "SEC", "BCK", "MFW"],
             notes="Sehr sensible Mandantendaten – Interesse an KI, aber nur ohne Cloud."),
        dict(name="Maschinenbau Steiner GmbH", contact_name="Ing. Thomas Steiner", email="it@steiner-demo.at",
             phone="+43 3842 3333", address="Industriezeile 7, 8700 Leoben", industry="Maschinenbau",
             employees=65, package="keins", mrr=0.0, contract_end="",
             booked_services=[], notes="Bisher nur auf Zuruf (Stundenbasis). Fertigung mit eigener IT."),
        dict(name="Ordination Dr. Berger", contact_name="Dr. Lisa Berger", email="ordination@berger-demo.at",
             phone="+43 662 4444", address="Mozartplatz 2, 5020 Salzburg", industry="Gesundheit",
             employees=6, package="basis", mrr=289.0, contract_end=_d(160),
             booked_services=["MW", "BCK"], notes="Arztsoftware, e-card-System. Ausfall = Praxis steht."),
        dict(name="Hotel Alpenblick", contact_name="Martin Hofer", email="it@alpenblick-demo.at",
             phone="+43 5356 5555", address="Seeweg 3, 6370 Kitzbühel", industry="Tourismus",
             employees=40, package="pro", mrr=1420.0, contract_end=_d(20),
             booked_services=["MW", "MFW"], notes="Gäste-WLAN wichtig, Saisonbetrieb."),
    ]
    ids = [db.insert("customers", c) for c in customers]
    huber, gruber, steiner, berger, hotel = ids

    # MRR-Verlauf (Demo): Start vor ~14 Monaten, Upsell vor ~5 Monaten → NRR über 100 %
    with db.connect() as conn:
        for cid, c in zip(ids, customers):
            if not c["mrr"]:
                continue
            start = round(c["mrr"] * 0.8, 2)
            for old, new, reason, days in ((0, start, "neukunde", 420), (start, c["mrr"], "upsell", 150)):
                conn.execute("INSERT INTO mrr_history (customer_id, customer_name, old_mrr, new_mrr, reason, created_at) "
                             "VALUES (?, ?, ?, ?, ?, ?)", (cid, c["name"], old, new, reason, f"{_d(-days)} 09:00:00"))

    assets = [
        (huber, "HUBER-PC01", "pc", "Windows 10 Pro 22H2", _d(-6 * 365), _d(-1 * 365)),
        (huber, "HUBER-PC02", "pc", "Windows 11 Pro", _d(-2 * 365), _d(365)),
        (huber, "HUBER-NB01", "notebook", "Windows 10 Pro 22H2", _d(-5 * 365), _d(-2 * 365)),
        (huber, "Drucker Werkstatt", "drucker", "", _d(-7 * 365), _d(-4 * 365)),
        (gruber, "GRUBER-SRV01", "server", "Windows Server 2016", _d(-7 * 365), _d(30)),
        (gruber, "GRUBER-SRV02", "server", "Windows Server 2022", _d(-2 * 365), _d(3 * 365)),
        (gruber, "GRUBER-FW", "firewall", "FortiOS 7.4", _d(-3 * 365), _d(60)),
        (gruber, "GRUBER-NB-EG", "notebook", "Windows 11 Pro", _d(-1 * 365), _d(2 * 365)),
        (steiner, "STEINER-DC01", "server", "Windows Server 2012 R2", _d(-10 * 365), _d(-5 * 365)),
        (steiner, "STEINER-CAD01", "pc", "Windows 10 Enterprise", _d(-5 * 365), _d(-2 * 365)),
        (steiner, "STEINER-CAD02", "pc", "Windows 10 Enterprise", _d(-5 * 365), _d(-2 * 365)),
        (steiner, "STEINER-NAS", "nas", "DSM 7.2", _d(-6 * 365), _d(-3 * 365)),
        (berger, "BERGER-EMPFANG", "pc", "Windows 11 Pro", _d(-1 * 365), _d(2 * 365)),
        (berger, "BERGER-ARZT", "pc", "Windows 10 Pro 22H2", _d(-4 * 365), _d(75)),
        (hotel, "HOTEL-REZEPTION1", "pc", "Windows 11 Pro", _d(-2 * 365), _d(365)),
        (hotel, "HOTEL-SRV", "server", "Windows Server 2019", _d(-5 * 365), _d(-1 * 365)),
        (hotel, "HOTEL-AP-LOBBY", "accesspoint", "", _d(-8 * 365), _d(-5 * 365)),
    ]
    for cid, name, typ, os_name, bought, warranty in assets:
        db.insert("assets", {"customer_id": cid, "name": name, "type": typ, "os": os_name,
                             "purchase_date": bought, "warranty_end": warranty, "last_seen": _d(0)})

    resolved = [
        (huber, "Drucker in der Werkstatt druckt nicht", "Seit heute früh kommt nichts mehr aus dem Drucker, Aufträge bleiben hängen.",
         "Hardware", "normal", "Druckwarteschlange hing. Spooler-Dienst neu gestartet, Ordner PRINTERS geleert, Drucker feste IP gegeben.", 25),
        (gruber, "Outlook startet nicht bei Frau Gruber", "Outlook bleibt beim Laden des Profils hängen.",
         "E-Mail/M365", "hoch", "Fehlerhaftes PDF-Add-in deaktiviert, Office-Schnellreparatur, neues Outlook-Profil angelegt.", 40),
        (hotel, "WLAN in der Lobby sehr langsam", "Gäste beschweren sich über langsames WLAN in der Lobby und im 1. Stock.",
         "Netzwerk", "hoch", "Access Point in der Lobby veraltet (802.11n) und auf überlastetem 2,4-GHz-Kanal. Kanal gewechselt, Tausch gegen Wi-Fi-6-AP angeboten.", 60),
        (berger, "Verdächtige E-Mail angeklickt", "Mitarbeiterin hat auf einen Link in einer Mail 'Paket zugestellt' geklickt und Daten eingegeben.",
         "Sicherheit", "kritisch", "Passwort zurückgesetzt, Sitzungen widerrufen, MFA aktiviert, Weiterleitungsregel entfernt, Gerät gescannt (sauber).", 90),
        (steiner, "VPN aus dem Homeoffice geht nicht", "Techniker kommt von zuhause nicht mehr ins Firmennetz.",
         "Netzwerk", "normal", "Heimrouter nutzte denselben IP-Bereich wie die Firma. VPN-Pool auf 10.20.0.0/24 umgestellt.", 45),
    ]
    for cid, title, desc, cat, prio, solution, minutes in resolved:
        tid = db.insert("tickets", {"customer_id": cid, "title": title, "description": desc, "status": "geloest",
                                    "priority": prio, "category": cat, "solution": solution,
                                    "time_spent_min": minutes})
        db.update("tickets", tid, {"resolved_at": db.scalar("SELECT created_at FROM tickets WHERE id = ?", (tid,))})

    open_tickets = [
        (huber, "PC im Büro sehr langsam", "Der alte Büro-PC (HUBER-PC01) braucht 10 Minuten zum Hochfahren."),
        (gruber, "Server-Speicher fast voll", "Warnung: Laufwerk D: auf GRUBER-SRV01 nur noch 5 % frei."),
        (steiner, "Alle CAD-Rechner können nicht auf das NAS zugreifen", "Produktion steht, niemand kommt auf die Zeichnungen am NAS!"),
        (hotel, "Neuer Mitarbeiter Rezeption ab Montag", "Bitte Konto, E-Mail und Zugang zum Hotelprogramm für neue Kollegin einrichten."),
        (berger, "Frage zu KI für Arztbriefe", "Gibt es eine Möglichkeit, Arztbriefe mit KI vorzuschreiben, ohne dass Daten in die Cloud gehen?"),
    ]
    from .agents.triage import rule_triage  # lokal importiert, um Zyklen zu vermeiden

    for cid, title, desc in open_tickets:
        db.insert("tickets", {"customer_id": cid, "title": title, "description": desc, "status": "neu",
                              **rule_triage(title, desc)})

    for title, tags, content in KB_ARTICLES:
        db.insert("kb_articles", {"title": title, "tags": tags, "content": content})

    # Ein Beispiel-Security-Check, damit der Radar etwas zum Auswerten hat.
    db.insert("assessments", {"customer_id": steiner, "answers": json.dumps({}), "score": 31.0,
                              "level": "kritisch", "report": "Demo-Bewertung – bitte echten Check durchführen."})


DEMO_MESSAGES = [
    dict(channel="email", from_name="Franz Huber", from_email="franz.huber@huber-demo.at",
         subject="Outlook geht schon wieder nicht",
         body="Hallo,\nbei mir im Büro startet Outlook seit heute früh nicht mehr, es bleibt beim Profil laden hängen. "
              "Kann sich das bitte wer anschauen? Dringend, ich warte auf Aufträge.\n\nLG Franz Huber"),
    dict(channel="web", from_name="Sabine Wagner", from_email="s.wagner@wagner-logistik-demo.at",
         company="Wagner Logistik GmbH", phone="+43 732 998877",
         subject="Webanfrage: Neuer IT-Partner gesucht",
         body="Guten Tag,\nwir sind eine Spedition mit 25 Mitarbeitern in Linz und suchen einen neuen IT-Partner. "
              "Unser bisheriger Betreuer hört auf. Wichtig sind uns laufende Betreuung, ein sicheres Backup und "
              "Schutz vor Ransomware. Umstellung am besten noch diesen Monat.\nMit freundlichen Grüßen\nSabine Wagner"),
    dict(channel="email", from_name="Distributor Demo GmbH", from_email="rechnung@distri-demo.at",
         subject="Ihre Rechnung RE-2026-1187", attachments=["RE-2026-1187.pdf"],
         body="Sehr geehrte Damen und Herren,\nanbei erhalten Sie die Rechnung Nr. RE-2026-1187 vom 03.11.2026 "
              "für 2 Notebooks und Microsoft-365-Lizenzen.\nGesamtbetrag: € 1.284,00\nZahlbar binnen 14 Tagen."),
    dict(channel="email", from_name="Firewall-Hersteller Demo", from_email="newsletter@hersteller-demo.com",
         subject="Webinar: Neue Firewall-Features 2027",
         body="Melden Sie sich jetzt zu unserem kostenlosen Webinar an! Abmelden: hier klicken."),
    dict(channel="email", from_name="Markus Lechner", from_email="markus.lechner.demo@gmail.com",
         subject="Rückruf wegen KI für unsere Kanzlei",
         body="Hallo, ich habe gelesen, dass Sie KI lokal ohne Cloud einrichten. Wir sind eine Kanzlei mit 8 Leuten. "
              "Bitte rufen Sie mich zurück, am besten vormittags: 0664 1234567. Danke, M. Lechner"),
]


def seed_demo_inbox(db: Database) -> None:
    if db.scalar("SELECT COUNT(*) FROM messages"):
        return
    for m in DEMO_MESSAGES:
        db.insert("messages", {**m, "direction": "in", "status": "neu"})


def seed_all(db: Database, demo: bool = True) -> None:
    seed_services(db)
    if demo:
        seed_demo(db)
        seed_demo_inbox(db)
