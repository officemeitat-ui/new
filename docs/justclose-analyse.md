# JustClose (justclose.de) – Analyse & Machbarkeit

> **Hinweis zur Quellenlage:** justclose.de konnte aus der Cloud-Umgebung nicht direkt geladen werden
> (Domain durch die Netzwerk-Policy gesperrt). Die Analyse basiert auf Suchergebnissen zu justclose.de,
> justclose.de/kundenergebnisse und justclose.de/recruiting sowie auf ProvenExpert, Trustpilot, theorg.com,
> LinkedIn-Profilen und Fachpresse (silicon.de, ap-verlag.de). Alle Zahlen sind Eigenangaben von JustClose
> und teils widersprüchlich (siehe unten).

## 1. Was ist JustClose?

**Kein Software-Produkt, sondern eine Vertriebsberatung / Agentur** mit einer conversion-optimierten Funnel-Website.

| | |
|---|---|
| Sitz / Gründung | Nürnberg, 2024 (Andreas May, Frederik Jaegers), ca. 10 Personen |
| Zielgruppe | IT-Dienstleister & SaaS-Firmen im DACH-Raum, 5–80 Mitarbeitende |
| Kernversprechen | „Unabhängig von Empfehlungen“ – qualifizierte Anfragen bzw. vorqualifizierte Termine, 2–3 Neukunden/Monat |
| Positionierung | „Wir bauen keine Werbeanzeigen, sondern Vertriebs-Systeme.“ |
| Leistungsmodell | 1:1-Betreuung + Training + Done-for-You-Kampagnen |
| Einstieg (Lead-Magnet) | Erstgespräch / 60-minütige Live-Session mit den Gründern zum „Pipeline-System“ |

### Leistungsbausteine

1. **Vertrieb / Neukundengewinnung** in drei Phasen:
   1. Strategische Vorbereitung & Onboarding – Definition des Ideal Customer Profile (ICP)
   2. Vertriebssystem & Teamentwicklung mit persönlichem Coaching
   3. Opportunity- & Forecasting-System (strukturierte Pipeline)
   - Zwei Wege zu Terminen: direkte Ansprache (Outreach) und Kampagnen (Ads)
2. **KI-Unterstützung im Vertrieb:** Lead-Anreicherung, Gesprächszusammenfassungen, Follow-up-E-Mails
   („bis zu 12 Std./Woche gespart“)
3. **Recruiting-Funnels für IT-Talente** (Unterseite /recruiting, „Top-IT-Talente per Knopfdruck“):
   täglich vorqualifizierte Bewerber, 14–28 Tage Time-to-Hire, 30-Tage-Go-live-Garantie,
   Abgrenzung zu Headhuntern (25–30 % Jahresgehalt). Beispiel-Testimonials: C#-Entwickler in 14 Tagen
   für < 700 €, zwei Einstellungen in 9 Tagen für < 1.000 € Ad-Spend.

### Social Proof (Eigenangaben, teils inkonsistent)

- „45+“, „50+“ bzw. „65+“ IT-Kunden im DACH-Raum – je nach Seite/Artikel unterschiedlich
- Ø-Zufriedenheit 9,4/10 (Kundenergebnisse-Seite)
- ProvenExpert 4,98/5 – Seite zeigt teils 24, teils 11 Bewertungen
- Fachpresse: silicon.de ist ein *BrandVoice*-Beitrag (bezahlter Content), dazu ap-verlag.de

## 2. Was macht die Website „gut“? (übertragbare Funnel-Prinzipien)

- **Enge Nische + konkretes Ergebnis** im Hero („IT-Dienstleister & SaaS“, „2–3 Neukunden/Monat“)
- **Ein einziger Call-to-Action** über die ganze Seite: Termin / Erstgespräch buchen
- **Massiver Social Proof:** Logos, Video-/Text-Testimonials, eigene Seite „Kundenergebnisse“, Bewertungsportale
- **Gegner-Framing:** Empfehlungsabhängigkeit, „keine Werbeanzeigen“, teure Headhunter
- **Prozess in 3 Phasen** statt Leistungs-Liste → wirkt wie ein System, nicht wie Stundenberatung
- **Risiko-Umkehr:** Garantien (z. B. 30-Tage-Go-live)
- **Separate Funnel-Seiten pro Angebot** (Vertrieb vs. Recruiting) mit eigener Zielgruppe und Botschaft

## 3. Können wir so etwas bauen? – Ja, aber „so etwas“ hat drei Ebenen

### Ebene A – Website / Funnel → **einfach**

| Baustein | Umsetzung |
|---|---|
| Landingpage(s) inkl. Kundenergebnisse, Recruiting-Seite | Astro oder Next.js + Tailwind, statisch gehostet (Vercel/Netlify/Cloudflare) |
| Vorqualifizierung vor dem Termin (Multi-Step-Formular) | eigenes Formular, Antworten → CRM |
| Terminbuchung | Cal.com (self-hosted möglich) oder Calendly, Routing nach Qualifizierung |
| Recruiting-Funnel (mobile Kurzbewerbung in 60 Sek., ohne Anschreiben) | Multi-Step-Formular + Bewerber-Inbox/ATS-Anbindung |
| Tracking & Ads | GA4/Plausible, Meta- & LinkedIn-Pixel, Conversion-API, Consent-Banner |
| CRM-Anbindung | Webhook → HubSpot / Pipedrive / Close |

Grobe Schätzung: **1–2 Wochen** für eine Person (ohne Texte, Fotos, Videos – die sind der eigentliche Aufwand).

### Ebene B – Tooling dahinter (eigene Software) → **mittel**

- Pipeline/Opportunity-Board mit Forecasting
- Lead-Enrichment (Firmendaten, Ansprechpartner, Tech-Stack)
- KI-Gesprächszusammenfassungen (Transkription + LLM) und automatische Follow-up-Entwürfe
- Outreach-Sequenzen (LinkedIn/E-Mail) mit Personalisierung
- Recruiting: Funnel-Builder + Bewerber-Pipeline

Grobe Schätzung: **MVP 4–8 Wochen**, je nach Umfang. Empfehlung: nicht alles neu bauen – auf HubSpot/Pipedrive +
n8n/Make + LLM-API aufsetzen und nur das selbst entwickeln, was uns unterscheidet (z. B. KI-Follow-ups,
Qualifizierungs-Logik, Dashboard).

### Ebene C – Das Geschäftsmodell → **kein Software-Problem**

JustClose verkauft Know-how, Betreuung und Umsetzung (Coaching, Kampagnen, Ad-Management). Dafür braucht es
Vertriebsexpertise, eigene Case Studies, Ad-Budget und Personal. Software kann das nur skalieren, nicht ersetzen.

## 4. Rechtliches (DACH) – vorab klären

- **Nicht kopieren:** Struktur und Funnel-Prinzipien übernehmen ist unproblematisch; Texte, Design,
  Bilder und Testimonials nicht (Urheberrecht, UWG – unlautere Nachahmung).
- **Kalt-Akquise per E-Mail:** In Österreich (§ 174 TKG 2021) und Deutschland (§ 7 UWG) ist Werbung per E-Mail
  ohne vorherige Einwilligung grundsätzlich unzulässig – **auch B2B**. Outreach-Tooling daher eher auf
  LinkedIn, Ads und Inbound ausrichten; im Zweifel juristisch prüfen lassen.
- **DSGVO:** Consent für Tracking-Pixel, Auftragsverarbeitungsverträge (CRM, Kalender, LLM-Anbieter),
  Datenschutzhinweise für Bewerberdaten; Impressum nach ECG/MedienG (AT) bzw. DDG (DE).
- **Werbeaussagen** wie „2–3 Neukunden/Monat“ oder Garantien müssen belegbar sein.

## 5. Vorschlag nächster Schritt

Offene Frage: **Für wen und welche Ebene?** (eigenes Angebot vs. Kundenprojekt; nur Website oder auch Tooling)

Vorschlag MVP (Ebene A + kleiner Teil B):

1. Funnel-Landingpage mit Hero, Problem, 3-Phasen-Prozess, Ergebnissen, FAQ, einem CTA
2. Multi-Step-Vorqualifizierung → Terminbuchung (Cal.com) → Webhook ins CRM
3. Optional: KI-Follow-up-Entwurf nach dem Erstgespräch (Transkript rein → Zusammenfassung + Mail-Entwurf raus)

Dafür benötigt: Zielgruppe & Angebot, Markenname/Logo, Texte bzw. Stichpunkte, vorhandene Referenzen,
gewünschtes CRM.

## Quellen

- https://justclose.de/ · https://justclose.de/kundenergebnisse · https://justclose.de/recruiting (via Suchergebnisse)
- https://www.provenexpert.com/de-de/justclose/
- https://www.trustpilot.com/review/justclose.de
- https://theorg.com/org/justclose
- https://www.silicon.de/brandvoice/profitables-wachstum-fuer-it-firmen
- https://ap-verlag.de/skalierung-fuer-it-firmen-der-weg-zum-profitablen-wachstum/106576/
- https://www.linkedin.com/in/frederik-jaegers/ · https://www.linkedin.com/in/lennert-bewernick/
- https://www.scamadviser.com/check-website/justclose.de
