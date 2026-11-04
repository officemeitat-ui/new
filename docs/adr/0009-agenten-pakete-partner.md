# ADR 0009 – Agenten-Pakete: ein Agent für viele Kunden, zentral gepflegt

**Status:** angenommen · **Datum:** 2026-11-04

## Kontext

ME-IT verkauft dieselbe Aufgabe an viele Kunden („Kunden: Wer braucht dasselbe?“) – zuerst Angebote. Bisher musste jeder Kunde seinen Agenten selbst aus der Vorlage anlegen, und jede Verbesserung musste ME-IT bei jedem Kunden einzeln nachziehen (über eine Support-Sitzung). Das skaliert nicht.

Gleichzeitig gilt ADR 0002: Partner sehen keine Kundeninhalte, und ein Kunde muss sich darauf verlassen können, dass seine eigenen Anpassungen nicht verschwinden.

## Entscheidung

- **Pakete gehören dem Partner** (`partner_agent_templates`, RLS: nur `partner_id = app_current_partner()`). Ein Paket entsteht aus einer Bibliotheksvorlage; Name, Beschreibung und Anweisungen sind editierbar. Jede geänderte Konfiguration erhöht die Paketversion. `{{firma.name}}` bleibt Platzhalter und wird beim Ausrollen pro Firma ersetzt. Wissenssammlungen gehören nicht ins Paket (deren IDs gehören einem Mandanten) – ohne Zuordnung durchsucht der Agent alle Sammlungen der Firma.
- **Ausrollen** (Recht `partner.templates.manage`, nur Partner-Admins) schreibt in die Agenten der Firma: im Partner-Kontext wird geprüft, dass die Firma zum Partner gehört und aktiv ist, dann wird der Mandant betreten (`enterTenant`) – eine Transaktion pro Firma. Der Agent merkt sich Paket, Paketversion und die ausgerollte Version (`rolled_out_version_id`); ein eindeutiger Index verhindert doppelte Agenten pro Firma und Paket.
- **Kundenänderungen haben Vorrang:** Weicht die aktuelle Version des Agenten von der ausgerollten ab, hat die Firma ihn angepasst – ein Update überspringt ihn („angepasst – nicht überschrieben“). Archivierte Agenten bleiben archiviert. Updates ändern die Konfiguration, nicht Name und Beschreibung, die die Firma umbenennen darf.
- **Transparenz beim Kunden:** jede Bereitstellung und jedes Update steht im Audit-Log der Firma (`agent.rolled_out`, `agent.updated_by_partner`, Akteur „partner“). Das Agent Studio zeigt „Zentral gepflegt“ und erklärt, dass eigene Anpassungen automatische Updates beenden. Alte Versionen bleiben erhalten und lassen sich wiederherstellen.
- **Was der Partner sieht:** pro Firma nur Paketversion, „angepasst ja/nein“ und „archiviert“ – über eine eigene Lese-Policy auf `agents`, die ausschließlich vom Partner ausgerollte Agenten seiner eigenen Firmen umfasst. Keine Agenten-Versionen, keine Anweisungen der Firma, keine Gespräche.

## Konsequenzen

- ME-IT pflegt eine Aufgabe einmal und liefert sie an alle passenden Kunden; die Partner-Konsole zeigt, wer welche Version hat.
- Eine Firma, die ihren Agenten anpasst, bekommt keine automatischen Verbesserungen mehr. Bewusst so: lieber kein Update als ein überschriebenes Angebotsschema. Ein späterer Schritt kann Änderungen zum Übernehmen anbieten statt sie zu überspringen.
- Paketänderungen selbst stehen nicht im Audit-Log einer Firma (Partner-Daten); erst das Ausrollen erzeugt dort Einträge.
