// Beispieldaten für Bewerbungen (Vorschau im Browser-Modus), relativ zu heute: eine neue Bewerbung, eine ohne
// Rückmeldung seit 10 Tagen, ein geplantes Gespräch, eine Zusage (noch nicht angelegt), eine Absage mit erreichter
// Löschfrist und ein Rückzug. Eintritt & Austritt beginnt leer (startet mit „Als Mitarbeiter:in anlegen“).
// Alle Namen, Telefonnummern und Adressen sind erfunden (example).

import { addMonths } from '../core/trainings.js'
import { addDays, todayISO } from '../core/dates.js'

export function createBewerberDemo(today = todayISO()) {
  const day = (n) => addDays(today, n)
  const at = (date) => `${date}T09:15:00.000Z`
  const log = (date, status, text = '') => ({ at: at(date), date, by: 'Beispieldaten', kind: 'status', status, text })
  const contact = (date, text) => ({ at: at(date), date, by: 'Beispieldaten', kind: 'kontakt', text })
  const week = (days, from, to) => Object.fromEntries(days.map((d) => [d, { from, to }]))
  const applicant = (id, name, extra) => ({ id, name, phone: '', email: '', source: 'inserat', sourceNote: '', status: 'neu', hours: 20, region: 'Salzburg Stadt', langs: ['de'], license: false, availability: {}, start: '', notes: '', docs: [], log: [], decidedAt: '', rejectMail: null, empId: '', createdBy: 'Beispieldaten', ...extra })
  const rejected = addMonths(today, -7)
  return {
    bewerbung: {
      applicants: [
        applicant('bw-demo1', 'Jana Novak', { phone: '0660 000 1101', email: 'jana.novak@example.com', source: 'inserat', sourceNote: 'Inserat Unterhaltsreinigung', hours: 20, langs: ['de', 'bks'], availability: week([1, 2, 3, 4, 5], '06:00', '12:00'), notes: 'Erfahrung in der Büroreinigung, möchte Frühdienst', createdAt: at(day(-2)), log: [log(day(-2), 'neu', 'erfasst')] }),
        applicant('bw-demo2', 'Mihai Ionescu', { phone: '0660 000 1102', email: 'mihai.ionescu@example.com', source: 'ams', sourceNote: 'Vermittlung AMS Salzburg', hours: 30, region: 'Flachgau', langs: ['ro', 'de'], license: true, availability: week([1, 2, 3, 4, 5, 6], '05:30', '14:00'), notes: 'Glasreinigung, Führerschein B', createdAt: at(day(-16)), status: 'kontakt', log: [log(day(-16), 'neu', 'erfasst'), contact(day(-12), 'angerufen, schickt Lebenslauf'), log(day(-10), 'kontakt')] }),
        applicant('bw-demo3', 'Sabine Lechner', { phone: '0660 000 1103', email: 'sabine.lechner@example.com', source: 'empfehlung', sourceNote: 'Empfehlung aus dem Team', hours: 25, langs: ['de', 'en'], availability: week([1, 2, 3, 4, 5], '15:00', '21:00'), notes: 'Abenddienst, Objekte in Lehen bevorzugt', createdAt: at(day(-6)), status: 'gespraech', log: [log(day(-6), 'neu', 'erfasst'), log(day(-3), 'gespraech', 'Gespräch vereinbart')] }),
        applicant('bw-demo4', 'Elena Petrova', { phone: '0660 000 1104', email: 'elena.petrova@example.com', source: 'initiativ', hours: 38, langs: ['de', 'bks'], license: true, availability: week([1, 2, 3, 4, 5], '06:00', '16:00'), start: day(14), notes: 'Grundreinigung, Hygienebereich', createdAt: at(day(-25)), status: 'zusage', decidedAt: day(-1), log: [log(day(-25), 'neu', 'erfasst'), log(day(-18), 'gespraech'), log(day(-8), 'probe', 'Probearbeit (angemeldet)'), log(day(-1), 'zusage')] }),
        applicant('bw-demo5', 'Petra Gruber', { phone: '0660 000 1105', email: 'petra.gruber@example.com', source: 'inserat', hours: 15, createdAt: at(addDays(rejected, -20)), status: 'absage', decidedAt: rejected, rejectMail: { at: at(rejected), by: 'Beispieldaten', via: 'graph', to: ['petra.gruber@example.com'] }, log: [log(addDays(rejected, -20), 'neu', 'erfasst'), log(rejected, 'absage', 'mit Absage-Mail')] }),
        applicant('bw-demo6', 'Lukas Brandner', { phone: '0660 000 1106', source: 'ams', hours: 40, region: 'Tennengau', createdAt: at(day(-70)), status: 'zurueck', decidedAt: day(-55), log: [log(day(-70), 'neu', 'erfasst'), log(day(-55), 'zurueck', 'andere Stelle angenommen')] }),
      ],
      settings: {},
    },
    eintritt: { lists: [], templates: {}, settings: { payrollEmail: 'lohn@steuerberatung.example' } },
  }
}
