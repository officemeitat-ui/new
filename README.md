# Funnel & Pipeline

Vorlage für Vertriebs- und Recruiting-Funnels nach dem Vorbild von Anbietern wie justclose.de – für das eigene Angebot
oder als Kundenprojekt. Eine Installation pro Marke; Inhalte, Funnels und Pipelines stehen in einer einzigen Datei.

Hintergrund und Marktanalyse: [docs/justclose-analyse.md](docs/justclose-analyse.md)

## Funktionen

**Website**
- Landingpage mit Hero, Problem, 3-Phasen-Prozess, Kundenstimmen, FAQ und einem durchgehenden Call-to-Action
- Vorqualifizierungs-Funnel (`/termin`): Fragen mit Punkten, Schwelle und Ausschlusskriterien; qualifizierte Interessenten sehen direkt die Terminbuchung (Cal.com, Calendly …) mit vorausgefülltem Namen und E-Mail
- Recruiting-Funnel (`/bewerben`): Bewerbung in 60 Sekunden ohne Anschreiben
- Kampagnen-Zuordnung: UTM-Parameter, Klick-IDs und Referrer werden beim ersten Seitenaufruf gemerkt und mit dem Lead gespeichert
- Spam-Schutz per Honeypot, Einwilligungs-Checkbox, Impressum- und Datenschutz-Vorlage (AT)

**Admin-Bereich (`/admin`)**
- Dashboard: Eingänge, Qualifizierungsquote, gewichteter Forecast, Abschlüsse, Verteilung über die Stufen
- Pipeline-Board je Pipeline (Vertrieb, Recruiting) mit Drag & Drop
- Lead-Detail: Antworten, Quelle, Kontakt, Stufe, Deal-Wert, Notizen und Verlauf
- **KI-Gesprächsvorbereitung** aus den Funnel-Antworten (Zusammenfassung, Fragen, mögliche Einwände)
- **KI-Follow-up** aus Gesprächsnotizen oder Transkript: Zusammenfassung, nächste Schritte, empfohlene Stufe und fertiger E-Mail-Entwurf

**Integrationen**
- Webhook für CRM/n8n/Make/Zapier bei neuem Lead und Stufenwechsel, optional HMAC-signiert
- Datenbank: lokal SQLite-Datei, in Produktion Turso/libSQL

## Schnellstart

```bash
npm install
cp .env.example .env.local   # mindestens ADMIN_PASSWORD und SESSION_SECRET setzen
npm run dev
```

- Website: http://localhost:3000
- Funnel: http://localhost:3000/termin · Recruiting: http://localhost:3000/bewerben
- Admin: http://localhost:3000/admin

Weitere Befehle: `npm test` (Unit-Tests), `npm run typecheck`, `npm run build`.

## An ein Projekt anpassen

Alles Projektspezifische steht in [`config/site.ts`](config/site.ts):

| Bereich | Inhalt |
|---|---|
| `site.brand` | Name, Claim, Primärfarbe |
| `site.hero`, `problems`, `process`, `testimonials`, `faq`, `finalCta` | Texte der Landingpage |
| `site.legal` | Impressumsangaben |
| `site.recruiting` | Stelle für den Recruiting-Funnel |
| `funnels` | Fragen, Antworten mit Punkten, Schwelle, Ausschlusskriterien, Kontaktfelder, Ergebnistexte |
| `pipelines` | Stufen mit Abschlusswahrscheinlichkeit, Standard-Deal-Wert |

Inhalte mit `placeholder: true` werden auf der Seite mit einem gelben „Platzhalter“-Hinweis markiert und müssen vor
dem Livegang ersetzt werden.

**Bewertung im Funnel:** Jede Antwort bringt Punkte; ab `threshold` gilt ein Eintrag als qualifiziert, außer eine
Antwort ist mit `disqualify: true` markiert. Die Bewertung läuft ausschließlich auf dem Server – Punkte und
Ausschlusskriterien werden nicht an den Browser ausgeliefert.

## Integrationen

### Terminbuchung
`BOOKING_URL` auf den Buchungslink setzen (z. B. `https://cal.com/name/erstgespraech`). Der Link wird nach erfolgreicher
Qualifizierung eingebettet, `name` und `email` werden als Parameter übergeben.

### Webhook
Ist `WEBHOOK_URL` gesetzt, wird ein `POST` mit JSON gesendet:

```json
{ "event": "lead.created", "lead": { "id": "…", "funnel": "erstgespraech", "stage": "qualifiziert", "name": "…", "email": "…", "answers": {}, "score": 15, "qualified": true, "source": { "utm_source": "linkedin" } }, "sentAt": "…" }
{ "event": "lead.stage_changed", "leadId": "…", "from": "qualifiziert", "to": "termin", "sentAt": "…" }
```

Mit `WEBHOOK_SECRET` enthält der Header `X-Signature` den Wert `sha256=<HMAC-SHA256 des Bodys>`.
Über n8n/Make lassen sich so z. B. E-Mail- oder Slack-Benachrichtigungen bei neuen Leads oder der Sync ins CRM bauen.

### KI (Claude)
`ANTHROPIC_API_KEY` setzen. Standardmodell ist `claude-opus-5-5` (über `ANTHROPIC_MODEL` änderbar). Die Ausgaben sind
strukturiert (JSON-Schema) und werden validiert. Lehnt das Modell eine Anfrage über seine Sicherheitsfilter ab,
übernimmt serverseitig automatisch ein Ersatzmodell (`fallbacks: "default"`).

Datenschutz: Für die KI-Funktionen werden Lead-Daten und Gesprächsnotizen an Anthropic übermittelt – das muss in der
Datenschutzerklärung stehen (ist in der Vorlage enthalten), ein Auftragsverarbeitungsvertrag ist abzuschließen.

## Deployment

- **Vercel / Serverless:** Dateisystem ist nicht dauerhaft → `DATABASE_URL` auf eine Turso-Datenbank (`libsql://…`) und `DATABASE_AUTH_TOKEN` setzen.
- **Eigener Server / Docker:** `npm run build && npm start`; die SQLite-Datei unter `data/` muss auf einem persistenten Volume liegen und gesichert werden.

## Checkliste vor dem Livegang

- [ ] Alle Platzhalter in `config/site.ts` ersetzt (Kundenstimmen nur echt und mit Einverständnis)
- [ ] Impressum und Datenschutzerklärung geprüft, eingesetzte Dienstleister eingetragen
- [ ] Auftragsverarbeitungsverträge (Hosting, Datenbank, Terminbuchung, Anthropic, CRM)
- [ ] Werden Tracking-Pixel (Meta, LinkedIn, Google) ergänzt: Consent-Banner einbauen
- [ ] Starkes `ADMIN_PASSWORD` und zufälliges `SESSION_SECRET`
- [ ] Werbeaussagen (Zahlen, Garantien) belegbar

## Projektstruktur

```
config/site.ts           Marke, Texte, Funnels, Pipelines
app/(site)/              öffentliche Seiten (Landingpage, /termin, /bewerben, Impressum, Datenschutz)
app/api/leads/           Entgegennahme der Funnel-Einträge
app/admin/               Login, Dashboard, Pipeline-Board, Lead-Detail, Server Actions
components/              Funnel-Formular, Pipeline-Board, KI-Bedienelemente
lib/                     Bewertung, Forecast, Datenbank, Sessions, Webhook, KI
tests/                   Unit-Tests (Vitest)
proxy.ts                 Weiterleitung nicht angemeldeter Aufrufe von /admin
```

## Mögliche nächste Ausbaustufen

- E-Mail-Benachrichtigung bei neuem Lead direkt aus der App (statt über Webhook)
- Mehrere Benutzer mit eigenen Zugängen statt eines gemeinsamen Admin-Passworts
- Mandantenfähigkeit (mehrere Kunden in einer Installation)
- Lead-Anreicherung (Firmendaten, Ansprechpartner) und automatische Transkription von Gesprächen
- Tracking-Pixel inkl. Consent-Management und Conversion-API
