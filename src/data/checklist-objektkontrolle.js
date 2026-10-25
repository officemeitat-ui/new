// Prüfkatalog der Objektkontrolle (übernommen aus dem Prüfprotokoll-Tool,
// Fassung 2.8): 9 Kapitel, 39 Punkte. Punkt-Nummer = Kapitel.Position
// („1.6“), damit Mängel über Kontrollen hinweg demselben Punkt zugeordnet
// bleiben. Weitere Checklisten (z. B. je Objektart) legt man in der App an.

export const OBJEKTKONTROLLE_CHECKLIST = {
  id: 'objektkontrolle',
  name: 'Objektkontrolle (Standard)',
  version: 1,
  chapters: [
    {
      title: 'Allgemeiner Objektzustand und Allgemeinflächen',
      items: [
        'Allgemeiner Reinigungszustand',
        'Böden sauber, trocken und unbeschädigt',
        'Wände und Decken sauber und ohne sichtbare Schäden',
        'Keine Wasserflecken, Feuchtigkeit oder Schimmelanzeichen',
        'Keine ungewöhnlichen Gerüche',
        'Keine Rutsch-, Stolper- oder sonstigen Gefahrenstellen',
        'Allgemeinflächen frei von unzulässigen Ablagerungen',
        'Zugänge, Durchgänge und Bedienbereiche frei zugänglich',
        'Beschilderungen vorhanden, sauber und lesbar',
        'Keine sichtbaren Schäden, Vandalismus oder Graffiti',
        'Keine sichtbaren Schädlingsspuren',
        'Offene Mängel aus der letzten Kontrolle nachverfolgt',
      ],
    },
    {
      title: 'Türen, Tore und Zutritt',
      items: [
        'Türen öffnen und schließen vollständig und fallen ins Schloss',
        'Schlösser, Griffe, Beschläge und Türschließer fest und funktionsfähig',
        'Türantrieb, Zutrittskontrolle, Gegensprechanlage, Tor oder Schranke funktionieren',
      ],
    },
    {
      title: 'Fenster, Glasflächen und Sonnenschutz',
      items: [
        'Fenster- und Glasflächen sauber und ohne Sprünge oder Beschädigungen',
        'Fenster lassen sich öffnen, schließen und verschließen; Griffe fest',
        'Rollladen, Jalousie oder Sonnenschutz funktioniert',
      ],
    },
    { title: 'Beleuchtung', items: ['Alle Leuchtmittel funktionieren'] },
    {
      title: 'Stiegenhaus, Gänge und Verkehrswege',
      items: ['Stufen, Podeste und Bodenbeläge fest und unbeschädigt', 'Handläufe, Geländer und Absturzsicherungen fest und unbeschädigt', 'Fußmatten liegen sicher und eben'],
    },
    {
      title: 'Lift',
      items: [
        'Liftkabine (Wände, Spiegel, Boden) sauber und unbeschädigt',
        'Lifttüren öffnen und schließen vollständig; Türschienen sauber und frei',
        'Bedientasten und Kabinenbeleuchtung funktionieren',
        'Lift hält bodenniveaugleich; Notruf zeigt keine Störung',
      ],
    },
    {
      title: 'Abfall, Müllraum und Mülltonnen',
      items: [
        'Mülltonnen vorhanden, unbeschädigt und nicht überfüllt',
        'Mülltrennung eingehalten; Tonnen richtig beschriftet',
        'Müllraum bzw. Stellplatz sauber; keine losen Abfälle, kein Sperrmüll',
        'Zufahrt und Zugang für die Entsorgung frei',
      ],
    },
    {
      title: 'Außenbereich',
      items: [
        'Reinigungs- und Pflegezustand; keine losen Abfälle oder Zigarettenreste',
        'Gehwege, Zugänge und Zufahrten frei, eben und ohne Stolperstellen',
        'Außenbeleuchtung funktioniert',
        'Laub, Bewuchs und Unkraut entfernt; Hecken und Äste behindern keine Wege oder Leuchten',
        'Keine Schnee-, Eis- oder Rutschgefahr; Streumittel vorhanden (Winter)',
      ],
    },
    {
      title: 'Entwässerung und Kanäle',
      items: [
        'Kanal- und Schachtdeckel, Roste und Einfassungen vorhanden, fest und bündig',
        'Einlaufschächte, Rinnen und Rigolen frei von Laub, Schmutz und Verstopfungen',
        'Dachrinnen und Fallrohre äußerlich unbeschädigt',
        'Kein stehendes Wasser, Rückstau oder Unterspülungen',
      ],
    },
  ],
}

export const INSPECTION_KINDS = ['Regelkontrolle', 'Nachkontrolle', 'Kontrolle auf Kundenwunsch', 'Anlasskontrolle', 'Erstaufnahme', 'Sonderkontrolle']
