// Vorlagen für Formulare zum Unterschreiben am Handy (Unterweisung am Handy ohne Fragen, Art „Formular“): Information zu
// persönlichen Dienstverhinderungen und Vereinbarung über das Diensthandy. Allgemein gehalten (keine Daten einzelner
// Personen: Gerät und Rufnummer stehen bei der Ausgabe unter „Geräte & Maschinen“), Deutsch; Vorschlag ohne Gewähr,
// arbeitsrechtlich prüfen lassen (docs/RECHTSPRUEFUNG.md, Punkt 60). Format wie core/unterweisung-vorlage.js.

export const FORMULAR_VORLAGEN = [
  {
    id: 'dienstverhinderung',
    name: 'Information Arztbesuche und Behördenwege',
    months: 0,
    texts: {
      de: {
        title: 'Information: Arztbesuche, Behördenwege und andere persönliche Termine',
        content: `Diese Information gilt für alle Mitarbeiterinnen und Mitarbeiter. Bitte lies sie und bestätige mit deiner Unterschrift, dass du sie erhalten hast.

## Persönliche Termine in der Freizeit
- Arztbesuche, Behördenwege und andere persönliche Termine erledigst du so weit wie möglich in deiner Freizeit.
- Das gilt laut Rechtsprechung für alle Arbeitnehmerinnen und Arbeitnehmer.

## Wann ein Termin in der Arbeitszeit sein darf
- Wenn der Termin nicht verschoben werden kann, z. B. bei einer akuten Erkrankung oder einer Ladung als Zeugin oder Zeuge vor Gericht.
- Wenn der Termin trotz Bemühen nicht außerhalb der Arbeitszeit möglich ist, z. B. weil die Ordination nur zu deiner Arbeitszeit offen hat.
- Melde den Termin so früh wie möglich im Büro.

## Nachweis
- Wir können eine Begründung oder einen Nachweis verlangen, z. B. eine Bestätigung der Ordination mit Datum und Uhrzeit.
- Zeiten ohne ausreichende Begründung oder ohne Nachweis werden als Minus im Zeitkonto verbucht.`,
        quiz: '',
        decl: 'Ich habe die Information zu Arztbesuchen, Behördenwegen und anderen persönlichen Terminen erhalten, gelesen und verstanden.',
      },
    },
  },
  {
    id: 'diensthandy',
    name: 'Vereinbarung Diensthandy',
    months: 0,
    texts: {
      de: {
        title: 'Vereinbarung über die Überlassung und Nutzung eines Diensthandys',
        content: `Diese Vereinbarung ergänzt deinen Arbeitsvertrag. Gerät, Rufnummer und Zubehör stehen in der Übergabe (Geräte und Maschinen, Ausgabe an dich).

## Überlassung
- Die Firma überlässt dir ein Smartphone mit SIM-Karte und Zubehör (z. B. Ladekabel).
- Die Kosten der dienstlichen Nutzung trägt die Firma.
- Die Firma kann das Smartphone mit einer Ankündigung von 4 Wochen ohne Entschädigung zurückfordern.

## Nutzung
- Das Smartphone dient der dienstlichen Nutzung (Telefon, E-Mail, Internet, Plan am Handy).
- Halte es während deiner Arbeitszeit empfangsbereit, nach Absprache auch darüber hinaus.
- Im Ausland darfst du das Smartphone nicht benutzen, außer es ist ausdrücklich vereinbart.

## Sorgfalt und Sicherheit
- Gib das Smartphone und die SIM-Karte nicht an andere weiter und verleih es nicht.
- Halte die PIN geheim und sichere das Gerät mit einer Displaysperre.
- Behandle Gerät und Zubehör pfleglich und melde Störungen und Schäden sofort.

## Verlust
- Melde einen Verlust sofort im Büro und lass die SIM-Karte über die Hotline des Anbieters sperren.
- Bei Diebstahl erstattest du Anzeige bei der nächsten Polizeidienststelle.

## Rückgabe
- Endet das Arbeitsverhältnis, gibst du das Smartphone samt Zubehör sofort zurück, spätestens mit Erhalt der Kündigung bzw. bei der Beendigung.`,
        quiz: '',
        decl: 'Ich habe das Diensthandy samt Zubehör erhalten. Ich habe diese Vereinbarung gelesen und halte mich daran.',
      },
    },
  },
]
