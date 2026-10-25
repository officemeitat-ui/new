// Bereichsvorlagen für das Leistungsverzeichnis (übernommen aus dem
// Objektdoku-Tool, Katalog 2.0 vom 12.10.2026): 13 Bereiche, 80 Leistungen.
// Richtzeiten (min) sind Ausgangswerte je Einsatz für einen Bereich üblicher
// Größe und werden am Objekt angepasst. Format wie Vorlagen.json des Werkzeugs.

export const BUILTIN_TEMPLATES = [
  {
    name: 'Stiegenhaus',
    boden: 'Fliesen',
    leistungen: [
      { was: 'Böden feucht reinigen', intervall: 'w1', methode: 'Wischmopp, Neutralreiniger', min: 18 },
      { was: 'Handläufe und Geländer feucht abwischen', intervall: 'w1', methode: 'Mikrofasertuch', min: 6 },
      { was: 'Stiegenhausfenster innen', intervall: 'm1', methode: 'Glasreiniger, Abzieher', min: 14 },
      { was: 'Lichtschalter und Türgriffe desinfizieren', intervall: 'w1', methode: 'Flächendesinfektion', min: 4 },
      { was: 'Spinnweben entfernen', intervall: 'm1', methode: 'Teleskopstiel', min: 5 },
      { was: 'Heizkörper und Nischen reinigen', intervall: 'q1', methode: 'Staubbindetuch', min: 12 },
      { was: 'Grundreinigung Böden', intervall: 'j1', methode: 'Einscheibenmaschine, Grundreiniger', min: 90 },
    ],
  },
  {
    name: 'Eingangsbereich / Foyer',
    boden: 'Naturstein',
    leistungen: [
      { was: 'Böden feucht reinigen', intervall: 't5', methode: 'Wischmopp', min: 10 },
      { was: 'Schmutzfangmatten saugen oder tauschen', intervall: 't5', methode: 'Staubsauger', min: 4 },
      { was: 'Eingangstüren und Glasflächen innen und außen', intervall: 'w2', methode: 'Glasreiniger', min: 8 },
      { was: 'Postkästen und Gegensprechanlage abwischen', intervall: 'w1', methode: 'Mikrofasertuch', min: 4 },
      { was: 'Papierkorb entleeren', intervall: 't5', methode: '', min: 2 },
      { was: 'Vordach und Außenmatte kehren', intervall: 'w2', methode: 'Besen', min: 5 },
    ],
  },
  {
    name: 'Aufzug',
    boden: 'PVC/Linoleum',
    leistungen: [
      { was: 'Kabinenboden feucht reinigen', intervall: 't5', methode: 'Wischmopp', min: 4 },
      { was: 'Kabinenwände und Spiegel reinigen', intervall: 'w2', methode: 'Mikrofaser, Glasreiniger', min: 5 },
      { was: 'Tastenfeld und Türrahmen desinfizieren', intervall: 't5', methode: 'Flächendesinfektion', min: 3 },
      { was: 'Türlaufschienen auskehren', intervall: 'w1', methode: 'Pinsel, Sauger', min: 4 },
      { was: 'Schachttüren außen je Geschoss', intervall: 'w1', methode: 'Mikrofasertuch', min: 6 },
    ],
  },
  {
    name: 'Sanitär / WC',
    boden: 'Fliesen',
    leistungen: [
      { was: 'WC-Becken und Urinale reinigen und desinfizieren', intervall: 't5', methode: 'Sanitärreiniger, Desinfektion', min: 8 },
      { was: 'Waschbecken und Armaturen reinigen', intervall: 't5', methode: 'Sanitärreiniger', min: 5 },
      { was: 'Spiegel und Ablagen reinigen', intervall: 't5', methode: 'Glasreiniger', min: 3 },
      { was: 'Böden feucht reinigen und desinfizieren', intervall: 't5', methode: 'Wischmopp, Sanitärreiniger', min: 7 },
      { was: 'Verbrauchsmaterial nachfüllen (Papier, Seife)', intervall: 't5', methode: '', min: 3 },
      { was: 'Abfallbehälter entleeren und Beutel wechseln', intervall: 't5', methode: '', min: 3 },
      { was: 'Trennwände und Türen feucht abwischen', intervall: 'w1', methode: 'Mikrofasertuch', min: 8 },
      { was: 'Fliesenwände vollflächig reinigen', intervall: 'm1', methode: 'Sanitärreiniger, Schrubber', min: 25 },
      { was: 'Abläufe und Siphons spülen', intervall: 'm1', methode: '', min: 8 },
      { was: 'Entkalkung Armaturen und Becken', intervall: 'm1', methode: 'Kalklöser', min: 15 },
    ],
  },
  {
    name: 'Büro',
    boden: 'Teppich',
    leistungen: [
      { was: 'Papierkörbe entleeren, Beutel bei Bedarf', intervall: 't5', methode: '', min: 3 },
      { was: 'Schreibtischflächen frei zugänglich abwischen', intervall: 'w2', methode: 'Mikrofasertuch', min: 6 },
      { was: 'Böden saugen', intervall: 'w2', methode: 'Staubsauger', min: 10 },
      { was: 'Türgriffe und Lichtschalter desinfizieren', intervall: 'w2', methode: 'Flächendesinfektion', min: 3 },
      { was: 'Staubwischen frei zugänglicher Flächen', intervall: 'w1', methode: 'Staubbindetuch', min: 8 },
      { was: 'Fußleisten und Heizkörper', intervall: 'm1', methode: 'Staubbindetuch', min: 10 },
      { was: 'Teppich-Fleckbehandlung', intervall: 'bedarf', methode: 'Fleckentferner', min: 10 },
      { was: 'Teppich-Grundreinigung Sprühextraktion', intervall: 'j1', methode: 'Sprühextraktionsgerät', min: 60 },
    ],
  },
  {
    name: 'Besprechungsraum',
    boden: 'PVC/Linoleum',
    leistungen: [
      { was: 'Tische abwischen, Stühle richten', intervall: 't5', methode: 'Mikrofasertuch', min: 6 },
      { was: 'Böden reinigen', intervall: 'w2', methode: 'Wischmopp', min: 8 },
      { was: 'Papierkorb entleeren', intervall: 't5', methode: '', min: 2 },
      { was: 'Gläser und Geschirr abräumen', intervall: 't5', methode: '', min: 4 },
      { was: 'Glastrennwände reinigen', intervall: 'w1', methode: 'Glasreiniger', min: 10 },
    ],
  },
  {
    name: 'Teeküche',
    boden: 'Fliesen',
    leistungen: [
      { was: 'Arbeitsflächen und Spüle reinigen', intervall: 't5', methode: 'Küchenreiniger', min: 6 },
      { was: 'Kaffeemaschine außen abwischen', intervall: 't5', methode: 'Mikrofasertuch', min: 3 },
      { was: 'Böden feucht reinigen', intervall: 't5', methode: 'Wischmopp', min: 5 },
      { was: 'Abfall trennen und entsorgen', intervall: 't5', methode: '', min: 4 },
      { was: 'Kühlschrank innen reinigen', intervall: 'm1', methode: 'Küchenreiniger', min: 20 },
      { was: 'Hängeschränke außen, Fliesenspiegel', intervall: 'w1', methode: 'Entfetter', min: 10 },
      { was: 'Mikrowelle innen und außen', intervall: 'w1', methode: 'Küchenreiniger', min: 6 },
    ],
  },
  {
    name: 'Tiefgarage',
    boden: 'Beton',
    leistungen: [
      { was: 'Fahrgassen kehren', intervall: 'm1', methode: 'Kehrmaschine', min: 45 },
      { was: 'Stellplätze kehren', intervall: 'q1', methode: 'Kehrmaschine', min: 60 },
      { was: 'Entwässerungsrinnen und Schächte räumen', intervall: 'q1', methode: 'Schaufel, Sauger', min: 30 },
      { was: 'Zugangstüren und Treppenabgang reinigen', intervall: 'm1', methode: 'Wischmopp', min: 15 },
      { was: 'Ölflecken behandeln', intervall: 'bedarf', methode: 'Ölbinder, Entfetter', min: 15 },
      { was: 'Nassreinigung Fahrgassen', intervall: 'j1', methode: 'Scheuersaugmaschine', min: 150 },
    ],
  },
  {
    name: 'Keller / Nebenräume',
    boden: 'Beton',
    leistungen: [
      { was: 'Gänge kehren', intervall: 'm1', methode: 'Besen', min: 20 },
      { was: 'Waschküche reinigen, Geräte außen', intervall: 'w1', methode: 'Allzweckreiniger', min: 15 },
      { was: 'Fahrradraum kehren', intervall: 'm1', methode: 'Besen', min: 12 },
      { was: 'Kellerfenster und Lichtschächte', intervall: 'h1', methode: '', min: 25 },
      { was: 'Böden feucht reinigen', intervall: 'q1', methode: 'Wischmopp', min: 30 },
    ],
  },
  {
    name: 'Müllraum / Müllplatz',
    boden: 'Fliesen',
    leistungen: [
      { was: 'Boden kehren und feucht reinigen', intervall: 'w1', methode: 'Wischmopp, Desinfektion', min: 12 },
      { was: 'Tonnen außen abspritzen', intervall: 'm1', methode: 'Hochdruckreiniger', min: 20 },
      { was: 'Tonnen zur Abholung stellen und zurückholen', intervall: 'w1', methode: '', min: 10 },
      { was: 'Beistellungen entfernen', intervall: 'w1', methode: '', min: 8 },
      { was: 'Desinfektion und Schädlingskontrolle', intervall: 'm1', methode: 'Flächendesinfektion', min: 10 },
    ],
  },
  {
    name: 'Außenanlage',
    boden: 'Asphalt',
    leistungen: [
      { was: 'Gehsteig und Zugänge kehren', intervall: 'w1', methode: 'Besen, Laubbläser', min: 20 },
      { was: 'Papierkörbe im Außenbereich entleeren', intervall: 'w1', methode: '', min: 6 },
      { was: 'Grünflächen von Unrat befreien', intervall: 'w1', methode: '', min: 12 },
      { was: 'Laub kehren', intervall: 'witter', methode: 'Laubbläser', min: 30 },
      { was: 'Unkraut in Pflasterfugen entfernen', intervall: 'm1', methode: 'Fugenkratzer', min: 25 },
      { was: 'Rasen mähen', intervall: 'w14', methode: 'Rasenmäher', min: 45 },
      { was: 'Hecken und Sträucher schneiden', intervall: 'h1', methode: 'Heckenschere', min: 90 },
    ],
  },
  {
    name: 'Glasflächen',
    boden: '',
    leistungen: [
      { was: 'Glasflächen innen bis 2 m Höhe', intervall: 'q1', methode: 'Glasreiniger, Abzieher', min: 40 },
      { was: 'Glasflächen außen bis 2 m Höhe', intervall: 'q1', methode: 'Glasreiniger, Abzieher', min: 45 },
      { was: 'Rahmen und Falze reinigen', intervall: 'h1', methode: 'Mikrofasertuch', min: 30 },
      { was: 'Glasflächen über 2 m (Hebebühne/Teleskop)', intervall: 'j1', methode: 'Teleskopstiel, reines Wasser', min: 120 },
      { was: 'Jalousien und Sonnenschutz abstauben', intervall: 'h1', methode: 'Lamellenbürste', min: 35 },
    ],
  },
  {
    name: 'Winterdienst',
    boden: 'Asphalt',
    leistungen: [
      { was: 'Schneeräumung Gehsteig und Zugänge', intervall: 'witter', methode: 'Schneeschaufel, Räumgerät', min: 35 },
      { was: 'Streuen bei Glatteis', intervall: 'witter', methode: 'Splitt, Streugut', min: 15 },
      { was: 'Kontrollgang Räum- und Streupflicht', intervall: 'witter', methode: '', min: 10 },
      { was: 'Streugut nach Saisonende aufkehren', intervall: 'j1', methode: 'Kehrmaschine', min: 60 },
    ],
  },
]
