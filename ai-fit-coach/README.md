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

- **Einrichtung in fünf Schritten:** Name, Ziel (Muskelaufbau, Kraft, Fettabbau, Allgemeine Fitness), Erfahrung, Tage pro Woche (2–6), Zeit pro Einheit (20–90 Min.), Equipment, Problemzonen.
- **Equipment-Auswahl:** 12 Geräte einzeln wählbar, dazu vier Vorlagen (Ohne Geräte, Zuhause, Home-Gym, Fitnessstudio). Der Plan enthält nur Übungen, die mit der Auswahl möglich sind.
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
- Übungsvideos oder -bilder, Erinnerungen, Abo und Zahlungen
- Rechtliche Texte, DSGVO-Prozesse, Tests auf echten Geräten (bisher im Web-Build geprüft)

Die Trainingsempfehlungen sind allgemeine Hinweise und ersetzen keine ärztliche oder therapeutische Beratung.

## Aufbau

- `App.tsx`: Start, Tabs, Wechsel zwischen Einrichtung, Tabs und Workout
- `src/engine/`: Trainingslogik ohne UI
  - `equipment.ts` Geräte und Vorlagen, `exercises.ts` Übungsbibliothek
  - `plan.ts` Plan-Generator, Equipment-Abdeckung, Upgrade-Empfehlung, Tauschen
  - `progression.ts` Steigerung, Bestwerte, Wochenstatistik
- `src/screens/`: `Onboarding`, `Tabs` (Home, Training, Coach, Fortschritt, Profil), `Workout`
- `src/coach.ts`: regelbasierter Coach, `src/store.ts`: Speichern und Laden, `src/ui.tsx`: Bausteine
- `checks/engine.spec.ts`: Tests (alle Kombinationen aus Ziel, Level, Tagen, Zeit und Equipment)
- `supabase/`: Datenbankschema und Edge Function für den KI-Coach

Eine neue Übung ist eine Zeile in `src/engine/exercises.ts`; der Generator berücksichtigt sie von selbst.
