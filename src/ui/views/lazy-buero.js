// Später geladen (views/lazy.js), Paket mit den Bereichen des Büros. Ein Paket statt vieler
// einzelner Dateien: esbuild teilt gemeinsamen Code je Kombination von Paketen auf, mit vielen
// Paketen zerfiele der Start in viele kleine Dateien. Reihenfolge wie früher in index.js.
import './calculation.js'
import './proof.js'
import './staff.js'
import './sites.js'
// Checkliste am Handy (Einsatz-Dialog, Zu erledigen, Punkte der Leistung)
import './checkliste.js'
import './trainings.js'
import './rules.js'
import './system.js'
import './sicherung.js'
import './vehicles.js'
import './complaints.js'
import './material.js'
import './keys.js'
import './anlagen.js'
import './geraete.js'
import './regie.js'
import './qualitaet.js'
import './matten.js'
import './matten-kalender.js'
import './matten-planung.js'
import './matten-lieferscheine.js'
import './matten-bestand.js'
import './matten-uebersicht.js'
import './matten-umstellung.js'
import './arbeitsschutz.js'
import './zufriedenheit.js'
import './eintritt.js'
import './mitteilungen.js'
// Posteingang: übergibt an Reklamationen, Fakturierung, Regie, Vertrieb, Termine, Einkauf und Bewerbungen
import './posteingang.js'
import './bewerber.js'
import './invoicing.js'
// Vertrieb: Anfrage bis Objekt (nutzt Fakturierung, Kalkulation und Termine)
import './vertrieb.js'
// Kundenbereich: Lieferscheine und nächster Mattenwechsel (über portalHooks in customer-portal.js)
import './customer-portal-matten.js'
// Kundenbereich: Aushang (QR) im Objekt (über portalHooks in customer-portal.js)
import './customer-portal-aushang.js'
// Kundenbereich: Zusatzleistungen anfragen (über portalHooks in customer-portal.js)
import './customer-portal-zusatz.js'
import './purchase.js'
import './cashbook.js'
import './weiterverrechnung.js'
import './uva.js'
// Paket für die Steuerberatung (Fakturierung, Einkauf, Kassenbuch, Umsatzsteuer)
import './steuerberatung.js'
// Rentabilität je Objekt (Fakturierung und Auswertung)
import './rentabilitaet.js'
import './weather.js'
