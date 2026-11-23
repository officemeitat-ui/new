# AI FIT COACH — v0.4

Deutschsprachige Trainings-App (Expo / React Native, iOS, Android, Web). Sie baut aus Ziel, Erfahrung, Zeit und dem vorhandenen Equipment einen Trainingsplan, führt durchs Workout und steigert die Belastung von Einheit zu Einheit.

## Start

```bash
npm install
npx expo start        # QR-Code mit Expo Go öffnen
npm run web           # im Browser
npm test              # Tests der Trainingslogik
npm run typecheck
npm run build:web     # statischer Web-Build nach dist/
```

Voraussetzung: Node.js 20.19 oder neuer. Bei SDK-Konflikten: `npx expo install --fix`.

## Was die App kann

- **Einrichtung in zwölf kurzen Schritten**, eine Frage pro Bildschirm: Name, Geschlecht (optional), Hauptziel, Schwerpunkte, Körperdaten, Erfahrung, Kraftwert, Tage und Zeit, Trainingsort, Equipment, größte Hürde und Problemzonen, Planvorschau.
- **Schwerpunkte:** Gewählte Muskelgruppen (Figur zum Antippen) bekommen mehr Sätze und eine Zusatzübung und werden bei Zeitmangel zuletzt gekürzt.
- **Körperdaten:** Größe, Gewicht, BMI mit Einordnung, optionales Zielgewicht mit realistischem Zeitrahmen. Gewichtsverlauf im Tab Fortschritt.
- **Startgewichte:** Aus einem bekannten Satz (Bankdrücken, Kniebeuge oder Kreuzheben) wird das Maximum geschätzt und daraus ein Startgewicht für jede Übung. Ohne Kraftwert vorsichtig aus Körpergewicht und Erfahrung. Grobe Richtwerte, im Workout änderbar.
- **Größte Hürde:** „Klare Anweisungen" klappt die Ausführung im Workout auf, „Langeweile" bringt mehr verschiedene Übungen, „Motivation" einen Hinweis auf Home.
- **Sanfter Abnehm-Modus:** Für den Einstieg mit mehr Körpergewicht. Nur gelenkschonende Übungen im Stehen, Sitzen oder am Gerät: keine Sprünge, nichts am Boden, kein Hängen oder Stützen mit dem ganzen Körpergewicht. Immer Ganzkörper, mittlere Wiederholungen, ruhige Ausdauer am Ende jeder Einheit. Home zeigt Gewichtsverlauf, eine haltbare Abnahme pro Woche und den Hinweis aufs tägliche Gehen. Wird bei BMI ab 30 vorgeschlagen, mit Hinweis auf ärztliche Abklärung.
- **Equipment-Auswahl:** 20 Geräte einzeln wählbar, auch jede Maschine für sich (Latzug, Beinpresse, Brustpresse …), dazu fünf Trainingsorte als Vorlage. Der Plan enthält nur Übungen, die mit der Auswahl möglich sind.
- **Anleitung zu jeder Übung:** animierte Figur mit Start- und Endposition, Zielbereich, Geräte, Vorbereitung, Ausführung in Schritten, Tipps, eigene Notiz und der Verlauf aller bisherigen Sätze. Die Figuren sind selbst gezeichnet (keine fremden Bilder).
- **Übungskatalog:** alle Übungen mit Vorschaubild, Filter nach Zielbereich und Gerät. Übungen lassen sich einem Trainingstag hinzufügen oder daraus entfernen.
- **Equipment-Abdeckung:** Wert von 0 bis 100, wie gut das Equipment die Bewegungsmuster des Plans trägt, und welche Anschaffung am meisten bringen würde.
- **Plan-Generator:** Split nach Trainingstagen (Ganzkörper, Ober-/Unterkörper, Push/Pull/Beine). Sätze, Wiederholungen und Pausen nach Ziel und Erfahrung. Passt die Einheit nicht in die Zeit, fallen zuerst die kleinen Übungen weg.
- **Übungsbibliothek:** rund 110 Übungen mit Ausführungshinweis, Zielmuskeln, Schwierigkeit und benötigtem Equipment. Jede Übung lässt sich gegen eine passende Alternative tauschen.
- **Workout-Player:** Gewicht und Wiederholungen je Satz, Pausen-Timer, Halte-Timer für Zeitübungen, Sätze hinzufügen oder entfernen, Zusammenfassung mit neuen Bestwerten.
- **Progression:** Doppelte Progression. Erst im Wiederholungsbereich nach oben, dann mehr Gewicht. Zweimal unter dem Ziel: 10 % zurück. Ohne Gewicht: Vorschlag für die schwerere Variante.
- **Fortschritt:** Einheiten pro Woche, Bestwerte mit Verlauf, Sätze pro Muskel, Trainingstagebuch.
- **Coach:** Antwortet aus den Regeln der App und den lokalen Trainingsdaten. Ist Supabase eingerichtet und jemand angemeldet, fragt er den KI-Coach am Server (siehe `SETUP_BACKEND.md`).

Alle Daten liegen lokal auf dem Gerät (AsyncStorage).

## Noch nicht enthalten

- Anmeldung und Synchronisation (Supabase ist vorbereitet, in der App gibt es noch keinen Login; der KI-Coach ist deshalb in der App noch nicht erreichbar)
- Übungsvideos oder Fotos (die Figuren sind stilisiert und zeigen etwa 50 Grundbewegungen, ähnliche Übungen teilen sich ein Bild), Erinnerungen, Abo und Zahlungen
- Rechtliche Texte, DSGVO-Prozesse, Tests auf echten Geräten (bisher im Web-Build geprüft)

Die Trainingsempfehlungen sind allgemeine Hinweise und ersetzen keine ärztliche oder therapeutische Beratung.

## Aufbau

- `App.tsx`: Start, Tabs, Wechsel zwischen Einrichtung, Tabs und Workout
- `src/engine/`: Trainingslogik ohne UI
  - `equipment.ts` Geräte und Vorlagen, `exercises.ts` Übungsbibliothek
  - `plan.ts` Plan-Generator, Equipment-Abdeckung, Upgrade-Empfehlung, Tauschen
  - `progression.ts` Steigerung, Bestwerte, Wochenstatistik
  - `startweights.ts` Schätzung der Startgewichte
- `src/screens/`: `Onboarding`, `Tabs` (Home, Training, Coach, Fortschritt, Profil), `Workout`
- `src/engine/guides.ts`: Anleitungstexte, `src/figure/`: Bewegungsbilder und Figur, `src/ExerciseGuide.tsx`: Anleitung und Katalog
- `src/BodyMap.tsx`: Figur für die Schwerpunkte, `src/coach.ts`: regelbasierter Coach, `src/store.ts`: Speichern und Laden, `src/ui.tsx`: Bausteine
- `checks/engine.spec.ts`: Tests (alle Kombinationen aus Ziel, Level, Tagen, Zeit und Equipment)
- `supabase/`: Datenbankschema und Edge Function für den KI-Coach

Eine neue Übung braucht eine Zeile in `src/engine/exercises.ts`, einen Text in `guides.ts` und eine Zuordnung in `figure/poses.ts`; ein Test prüft, dass nichts fehlt.
