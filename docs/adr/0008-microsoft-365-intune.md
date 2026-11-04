# ADR 0008 – Microsoft 365 und Intune (MDM): App-Zugriff nach Administrator-Zustimmung

**Status:** angenommen · **Datum:** 2026-11-03 · **Nachtrag:** 2026-11-04 (Verbinden in zwei Schritten, SharePoint)

## Kontext

ME-IT betreut die IT seiner Kunden. Geräteverwaltung (MDM) mit Microsoft Intune ist dabei Alltag: Welche Geräte sind nicht konform, nicht verschlüsselt, lange nicht synchronisiert? Ein Laptop wurde gestohlen – sperren. Agenten sollen das abfragen und mit Freigabe handeln können, und Kunden sollen ihre Geräte in der Plattform sehen.

Die Spezifikation (§9.1) sieht für Konnektoren OAuth mit verschlüsselt gespeicherten Tokens vor. Für Geräteverwaltung passt ein Benutzer-Token aber nicht: Die Aktionen gehören zur Organisation, nicht zu einer Person, und Refresh-Tokens einzelner Admins laufen ab oder verschwinden mit der Person.

## Entscheidung

- **Eine mandantenfähige App-Registrierung von ME-IT** in Microsoft Entra ID mit **Anwendungsberechtigungen** (nur diese):
  - `DeviceManagementManagedDevices.Read.All` – Geräte lesen
  - `DeviceManagementManagedDevices.PrivilegedOperations.All` – synchronisieren, neu starten, sperren
  - `Organization.Read.All` – Namen der Organisation anzeigen
  - `Sites.Read.All` – SharePoint-Bibliotheken für die Wissensdatenbank lesen (Nachtrag 2026-11-04)
  - dazu die **delegierten Berechtigungen `User.Read` und `RoleManagement.Read.Directory`**, nur für den Nachweis beim Verbinden (Verzeichnis und Admin-Rolle)
- **Verbinden in zwei Schritten** (Nachtrag 2026-11-04 nach dem Sicherheits-Review, Befund 1):
  1. **Anmeldung** über den Autorisierungscode-Fluss (`organizations/oauth2/v2.0/authorize`, Scope `User.Read`). Mit dem Code holt der Server ein Token und liest `GET /organization` – so ist **bewiesen**, zu welchem Verzeichnis die Person gehört. Ein `tenant`-Parameter aus der URL zählt nicht. Außerdem muss die Person **Mitglied (kein Gast)** und **Globaler Administrator oder Administrator für privilegierte Rollen** sein (`GET /me`, `GET /me/memberOf/microsoft.graph.directoryRole`); nur diese Rollen dürfen Anwendungsberechtigungen von Microsoft Graph freigeben. Damit kann ein normales Mitglied ein früher freigegebenes Verzeichnis nicht an eine andere Firma binden (Nachtrag nach Sicherheits-Review 2, Befund 3).
  2. **Administrator-Zustimmung** genau für dieses Verzeichnis (`/{verzeichnis-id}/adminconsent`, Graph-Doku „Get access without a user“). Das Verzeichnis steht im signierten `state`; der Rückweg muss es bestätigen.
  - Der `state` ist HMAC-signiert, enthält Mandant, Person, Schritt und (im zweiten Schritt) das Verzeichnis und gilt 15 Minuten; der Rückweg muss zur selben Sitzung passen.
  - **Ein Microsoft-Verzeichnis gehört höchstens einer Firma** (eindeutiger Index auf Anbieter + Verzeichnis); ein zweiter Versuch endet mit einer klaren Meldung statt einer Umleitung der bestehenden Verbindung.
- **Zugriff mit Client Credentials:** Pro Aufruf holt die Plattform ein kurzlebiges App-Token für das Verzeichnis des Kunden (In-Memory-Cache bis kurz vor Ablauf). **Gespeichert wird nur die Verzeichnis-ID des Kunden** (`integrations.external_tenant_id`), kein Kunden-Geheimnis. Client-ID und -Secret der App liegen in den Umgebungsvariablen `MICROSOFT_GRAPH_CLIENT_ID` / `MICROSOFT_GRAPH_CLIENT_SECRET` (Secret-Store in Produktion).
- **Endpunkte nur aus der offiziellen Graph-Doku (v1.0):** `GET /deviceManagement/managedDevices` (mit `@odata.nextLink`), `GET …/{id}`, `POST …/{id}/syncDevice | rebootNow | remoteLock` (je 204), `GET /organization`; für SharePoint `GET /sites?search=`, `GET /sites/{id}/drives`, `GET /drives/{id}/root/delta` (mit `@odata.nextLink`/`@odata.deltaLink`, 410 = neu beginnen) und der Download über `@microsoft.graph.downloadUrl` (kurzlebig, ohne Token, nur HTTPS, Größenlimit beim Streamen). 429/503 werden mit `Retry-After` wiederholt; Folge-Links werden nur zu Graph selbst verfolgt (kein Token an fremde Hosts).
- **Agenten-Werkzeuge:** `geraete_suchen`, `geraet_details` (lesen, automatisch), `geraet_synchronisieren` (harmlos, automatisch), `geraet_neu_starten` und `geraet_sperren` (Standard: Freigabe). Aktionen nennen ID **und** Gerätenamen; vor der Ausführung prüft der Code, dass beides zusammenpasst – freigegeben wird also, was im Freigabe-Text steht. Ohne Verbindung bekommt der Agent die Werkzeuge gar nicht angeboten.
- **Bewusst nicht in v1:** Gerät zurücksetzen/löschen (`wipe`, `retire`). Zu folgenreich für den ersten Schritt; kommt mit eigener Freigaberegel (z. B. zwei Personen).

## Konsequenzen

- Kunden verbinden in unter einer Minute, ohne dass ME-IT Kunden-Passwörter oder -Tokens verwaltet. Widerruf jederzeit in Entra ID (Unternehmensanwendung löschen); die Plattform zeigt dann „Fehler“ beim nächsten Abruf.
- Jede Geräteaktion – ob von einer Person auf der Geräte-Seite oder von einem Agenten nach Freigabe – steht im Audit-Log mit Gerätename und Intune-ID.
- Für Microsoft-365-Funktionen im Namen einer Person (Postfach, Kalender) folgt später delegiertes OAuth mit verschlüsselten Tokens nach §9.1; diese Entscheidung bleibt davon unberührt.
- **SharePoint-Berechtigungen werden nicht übernommen:** Die App liest mit `Sites.Read.All` alle Websites; was in eine Sammlung übernommen wird, sehen alle mit Zugriff auf diese Sammlung. Wer verbindet (`knowledge.manage`), wählt die Bibliothek deshalb bewusst. Feinere Rechte (z. B. `Sites.Selected` oder Berechtigungen pro Datei) sind ein späterer Schritt.
- Tests laufen gegen einen Mock von Login und Graph (`packages/connectors/src/testing/mock-microsoft.ts`); der Code spricht in Produktion die echten Endpunkte an (`MICROSOFT_LOGIN_URL`, `MICROSOFT_GRAPH_URL` nur für nationale Clouds und Tests änderbar).
