// Beispieldaten für den Vertrieb (Vorschau im Browser-Modus), relativ zu heute. Alle Namen, Adressen und Zahlen sind
// erfunden: eine neue Anfrage einer Zahnarztpraxis (nur die Angaben der Anfrage), eine Steuerberatung nach der
// Besichtigung mit fünf Bereichen (noch ohne Kalkulation), die Hausverwaltung als Bestandskunde mit dem Angebot für das
// Versicherungsbüro (Angebot der Beispieldaten der Fakturierung) und ein Fitnessstudio, das angenommen hat und für den
// Assistenten „Auftrag anlegen“ bereit ist. Am Tag der Beispieldaten ist kein nächster Schritt fällig.

import { addDays, todayISO } from '../core/dates.js'

export function createVertriebDemo(today = todayISO()) {
  const day = (n) => addDays(today, n)
  const at = (date, t = '09:00') => `${date}T${t}:00.000Z`
  const year = today.slice(0, 4)
  const h = (date, text, stage) => ({ at: at(date), by: 'Beispieldaten', text, ...(stage ? { stage } : {}) })
  const room = (id, name, type, m2, perWeek, floor = '', notes = '') => ({ id, name, type, m2, perWeek, floor, notes })
  return {
    settings: {},
    cases: [
      {
        id: 'vf-demo1',
        no: `VT-${year}-001`,
        stage: 'anfrage',
        requestDate: day(-1),
        source: 'website',
        customerId: '',
        lead: { name: 'Zahnarztpraxis Dr. Beispiel', contact: 'Frau Dr. Anna Beispiel', phone: '+43 662 000101', email: 'praxis@zahnarzt-beispiel.example', street: 'Praxisweg 2', zip: '5020', city: 'Salzburg' },
        site: { name: 'Zahnarztpraxis Praxisweg', address: 'Praxisweg 2, 5020 Salzburg' },
        title: 'Unterhaltsreinigung Ordination',
        monthly: 900,
        next: { text: 'Besichtigung vereinbaren', date: day(1) },
        owner: 'Petra Leitner',
        visit: { rooms: [], photos: [] },
        history: [h(day(-1), 'Anfrage angelegt (Website, Formular)', 'anfrage')],
        createdAt: at(day(-1)),
        createdBy: 'Beispieldaten',
      },
      {
        id: 'vf-demo2',
        no: `VT-${year}-002`,
        stage: 'besichtigt',
        requestDate: day(-12),
        source: 'empfehlung',
        customerId: '',
        lead: { name: 'Steuerberatung Beispiel OG', contact: 'Herr Mag. Paul Muster', phone: '+43 662 000102', email: 'office@steuer-beispiel.example', street: 'Kanzleigasse 5', zip: '5020', city: 'Salzburg' },
        site: { name: 'Kanzlei Kanzleigasse', address: 'Kanzleigasse 5, 5020 Salzburg' },
        title: 'Unterhaltsreinigung Kanzlei',
        monthly: '',
        next: { text: 'Kalkulation anlegen', date: day(2) },
        owner: 'Petra Leitner',
        visit: {
          date: day(-2),
          time: '16:00',
          voice: 'Büros im ersten Stock etwa 280 Quadratmeter Teppich, dreimal pro Woche. Besprechungsraum 40 Quadratmeter, zweimal. Zwei WC-Anlagen zusammen 22 Quadratmeter Fliesen, dreimal. Teeküche 12 Quadratmeter, dreimal. Gang und Empfang 60 Quadratmeter, dreimal. Reinigung erst ab 17 Uhr.',
          rooms: [
            room('r-d1', 'Büros 1. OG', 'buero', 280, 3, 'teppich', 'Reinigung erst ab 17 Uhr'),
            room('r-d2', 'Besprechungsraum', 'buero', 40, 2, 'holz'),
            room('r-d3', 'WC-Anlagen', 'sanitaer', 22, 3, 'fliesen'),
            room('r-d4', 'Teeküche', 'kueche', 12, 3, 'fliesen'),
            room('r-d5', 'Gang und Empfang', 'gang', 60, 3, 'stein', 'Glastür beim Empfang'),
          ],
          photos: [],
        },
        history: [h(day(-12), 'Anfrage angelegt (Empfehlung)', 'anfrage'), h(day(-6), 'Besichtigung am ' + day(-2).split('-').reverse().join('.') + ' um 16:00 (Termin)'), h(day(-2), 'Besichtigung geplant → Besichtigt', 'besichtigt')],
        createdAt: at(day(-12)),
        createdBy: 'Beispieldaten',
      },
      {
        id: 'vf-demo3',
        no: `VT-${year}-003`,
        stage: 'angebot',
        requestDate: day(-20),
        source: 'bestandskunde',
        customerId: 'c-demo1',
        lead: { name: 'Hausverwaltung Beispiel GmbH', contact: 'Herr Paul Muster' },
        site: { name: 'Versicherungsbüro Lehen', address: '' },
        objectId: 'o11',
        title: 'Unterhaltsreinigung Versicherungsbüro',
        monthly: 640,
        next: { text: 'Angebot nachfassen', date: day(3) },
        owner: 'Petra Leitner',
        visit: { date: day(-14), time: '10:00', rooms: [room('r-d6', 'Büros', 'buero', 210, 3, 'pvc'), room('r-d7', 'WC', 'sanitaer', 14, 3, 'fliesen'), room('r-d8', 'Eingang', 'eingang', 18, 3, 'stein')], photos: [] },
        calc: { net: 640, gross: 768, hours: 21.5, totalM2: 242, perM2: 2.64, at: at(day(-10)), by: 'Beispieldaten' },
        offer: { id: 'off-demo1', number: `AN-${year}-0001`, state: 'offen', net: 1249, date: day(-6), validUntil: day(24), sent: false, online: false },
        history: [h(day(-20), 'Anfrage angelegt (Bestandskunde)', 'anfrage'), h(day(-14), 'Besichtigung geplant → Besichtigt', 'besichtigt'), h(day(-10), 'Kalkulation: 640,00 € je Monat, 21,5 Std.'), h(day(-6), 'Kalkuliert → Angebot gesendet', 'angebot')],
        createdAt: at(day(-20)),
        createdBy: 'Beispieldaten',
      },
      {
        id: 'vf-demo4',
        no: `VT-${year}-004`,
        stage: 'angenommen',
        requestDate: day(-55),
        source: 'telefon',
        customerId: '',
        lead: { name: 'Fitnessstudio Beispiel GmbH', contact: 'Frau Lisa Beispiel', phone: '+43 662 000104', email: 'studio@fitness-beispiel.example', street: 'Sportplatz 1', zip: '5071', city: 'Wals-Siezenheim' },
        site: { name: 'Fitnessstudio Wals', address: 'Sportplatz 1, 5071 Wals-Siezenheim' },
        title: 'Unterhaltsreinigung Fitnessstudio',
        monthly: 2150,
        next: { text: 'Auftrag anlegen (Kunde, Objekt, Dauerauftrag, Vertrag)', date: day(4) },
        owner: 'Petra Leitner',
        wonAt: day(-20),
        visit: { date: day(-48), time: '07:30', rooms: [room('r-d9', 'Trainingsfläche', 'sonst', 420, 6, 'pvc', 'Geräte abwischen'), room('r-d10', 'Umkleiden und Duschen', 'sanitaer', 85, 6, 'fliesen'), room('r-d11', 'Eingang und Theke', 'eingang', 40, 6, 'stein')], photos: [] },
        calc: { net: 2150, gross: 2580, hours: 72.4, totalM2: 545, perM2: 3.94, at: at(day(-40)), by: 'Beispieldaten' },
        history: [h(day(-55), 'Anfrage angelegt (Telefon)', 'anfrage'), h(day(-48), 'Besichtigung geplant → Besichtigt', 'besichtigt'), h(day(-40), 'Kalkulation: 2.150,00 € je Monat, 72,4 Std.'), h(day(-34), 'Kalkuliert → Angebot gesendet', 'angebot'), h(day(-20), 'Angebot gesendet → Angenommen: telefonisch zugesagt', 'angenommen')],
        createdAt: at(day(-55)),
        createdBy: 'Beispieldaten',
      },
    ],
  }
}
