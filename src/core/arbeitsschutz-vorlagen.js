// Vorlagen für den Arbeitsschutz (Vorschlag ohne Gewähr, keine Rechtsauskunft): typische Gefahren der Reinigung je
// Tätigkeit mit Vorschlägen für Maßnahmen (Startpunkt der Evaluierung) und die Abschnitte der Betriebsanweisung,
// vorbefüllt aus den Angaben am Artikel. Die Texte sind allgemein gehalten und ersetzen weder das Sicherheitsdatenblatt
// noch die Beratung durch Sicherheitsfachkraft und Arbeitsmedizin (docs/RECHTSPRUEFUNG.md, Punkt 32).
// Nur von der Ansicht (später geladen) und den Tests gelesen, nicht vom Start der App.

import { codesOf, ghsOf, SIGNALS } from './arbeitsschutz.js'

/** Abschnitte der Betriebsanweisung in der Reihenfolge des Aushangs. */
export const BA_SECTIONS = [
  ['anwendung', 'Anwendungsbereich'],
  ['gefahren', 'Gefahren für Mensch und Umwelt'],
  ['schutz', 'Schutzmaßnahmen und Verhaltensregeln'],
  ['gefahrfall', 'Verhalten im Gefahrfall'],
  ['ersteHilfe', 'Erste Hilfe'],
  ['entsorgung', 'Sachgerechte Entsorgung'],
]
export const emptySections = () => Object.fromEntries(BA_SECTIONS.map(([k]) => [k, '']))

/** Hinweise je Abschnitt (Platzhalter im Formular, v. a. für Tätigkeiten und Maschinen). */
export const SECTION_HINTS = {
  anwendung: 'Wofür, wo und von wem, z. B. Scheuersaugmaschine in allen Objekten',
  gefahren: 'Was kann passieren, z. B. Stromschlag, Quetschen, Ausrutschen',
  schutz: 'Was ist zu tun und zu tragen, z. B. Sichtprüfung vor Beginn, rutschfeste Schuhe',
  gefahrfall: 'Was tun bei Störung, Brand oder Unfall; wen verständigen',
  ersteHilfe: 'Erste Hilfe, Ersthelfer:innen, Notruf',
  entsorgung: 'Reste, Gebinde, Verbrauchsmaterial',
}

// Allgemeine Beschreibung je Piktogramm (eigene Worte, nicht der Wortlaut der H-Sätze)
const GHS_HAZARD = {
  GHS01: 'Explosionsgefahr.',
  GHS02: 'Entzündbar: Dämpfe können sich an Hitze, Funken oder offenen Flammen entzünden.',
  GHS03: 'Brandfördernd: kann einen Brand verstärken.',
  GHS04: 'Gas unter Druck: Behälter kann bei Erwärmung bersten.',
  GHS05: 'Ätzend: kann Haut und Augen schwer schädigen.',
  GHS06: 'Giftig: schon kleine Mengen können zu schweren Vergiftungen führen.',
  GHS07: 'Reizend bzw. gesundheitsschädlich: kann Haut, Augen oder Atemwege reizen.',
  GHS08: 'Gesundheitsgefahr: kann die Gesundheit bei längerer Einwirkung schädigen.',
  GHS09: 'Umweltgefährlich: schädlich für Wasserorganismen.',
}

const lines = (list) => list.filter(Boolean).join('\n')

/**
 * Betriebsanweisung für einen Arbeitsstoff, vorbefüllt aus dem Artikel: { title, area, sections }.
 * Allgemeine Regeln plus das, was die Angaben am Artikel hergeben (Piktogramme, Signalwort, H- und P-Sätze,
 * Schutzausrüstung). Zum Prüfen und Ergänzen aus dem Sicherheitsdatenblatt.
 */
export function instructionFromArticle(article = {}) {
  const h = article.haz || {}
  const product = h.product || article.name || 'Arbeitsstoff'
  const ghs = (h.ghs || []).filter((id) => ghsOf(id))
  const has = (id) => ghs.includes(id)
  const hCodes = codesOf(h.h)
  const pCodes = codesOf(h.p)
  const ppe = h.ppe || []
  const gloves = ppe.includes('Schutzhandschuhe') || has('GHS05') || has('GHS07')
  const glasses = ppe.includes('Schutzbrille') || has('GHS05')
  const sections = {
    anwendung: lines([`${product}${h.maker ? ` (${h.maker})` : ''}${h.use ? `: ${h.use}` : ''}.`, 'Gilt für alle Beschäftigten, die mit diesem Mittel arbeiten, in allen Objekten.']),
    gefahren: lines([
      h.signal ? `Signalwort: ${SIGNALS[h.signal]}.` : '',
      ...ghs.map((id) => GHS_HAZARD[id]),
      hCodes.length ? `Gefahrenhinweise laut Sicherheitsdatenblatt: ${hCodes.join(', ')}.` : '',
      !ghs.length && !hCodes.length ? 'Keine Gefahrenpiktogramme eingetragen. Gefahren laut Sicherheitsdatenblatt (Abschnitt 2) ergänzen.' : '',
    ]),
    schutz: lines([
      gloves ? 'Geeignete Schutzhandschuhe tragen.' : '',
      glasses ? 'Bei Spritzgefahr Schutzbrille tragen.' : '',
      ppe.includes('Atemschutz') ? 'Atemschutz tragen, wenn im Sicherheitsdatenblatt verlangt.' : '',
      ppe.includes('Schutzkleidung') ? 'Schutzkleidung tragen.' : '',
      has('GHS02') ? 'Von Zündquellen fernhalten, nicht rauchen.' : '',
      'Nur nach Dosieranleitung verwenden, nie mit anderen Reinigern mischen.',
      'Nur im Originalgebinde oder in beschrifteten Gefäßen aufbewahren, nie in Getränkeflaschen umfüllen.',
      'Für gute Lüftung sorgen, nicht in die Luft sprühen.',
      'Bei der Arbeit nicht essen, trinken oder rauchen; danach Hände waschen und eincremen.',
      pCodes.length ? `Sicherheitshinweise laut Sicherheitsdatenblatt: ${pCodes.join(', ')}.` : '',
    ]),
    gefahrfall: lines([
      'Ausgelaufenes Mittel mit saugfähigem Material aufnehmen, Raum lüften, Vorgesetzte informieren.',
      has('GHS02') || has('GHS03') ? 'Bei Brand: Feuerlöscher verwenden, Feuerwehr verständigen.' : '',
      'Notruf: Rettung 144, Feuerwehr 122, Euro-Notruf 112.',
    ]),
    ersteHilfe: lines([
      'Nach Augenkontakt: sofort mehrere Minuten mit Wasser spülen, Kontaktlinsen entfernen, Arzt aufsuchen.',
      'Nach Hautkontakt: benetzte Kleidung ausziehen, Haut mit viel Wasser abspülen.',
      'Nach Einatmen: an die frische Luft bringen.',
      'Nach Verschlucken: Mund ausspülen, kein Erbrechen herbeiführen, Vergiftungsinformationszentrale anrufen: 01 406 43 43.',
      'Ersthelfer:innen verständigen, Sicherheitsdatenblatt zum Arzt mitnehmen.',
    ]),
    entsorgung: lines([
      'Unverdünnte Reste und Gebinde laut Sicherheitsdatenblatt (Abschnitt 13) und Vorgaben des Entsorgers entsorgen.',
      has('GHS09') ? 'Unverdünnt nicht in Kanal, Gewässer oder Boden gelangen lassen.' : '',
      'Leere Gebinde restentleert zurückgeben oder laut Vorgabe entsorgen.',
    ]),
  }
  return { title: product, area: h.use || '', sections }
}

/**
 * Typische Gefahren der Reinigung je Tätigkeit mit Vorschlägen für Maßnahmen (Startpunkt der Evaluierung).
 * Vorschlag ohne Gewähr: Bewertung, Verantwortliche und Fristen trägt der Betrieb selbst ein.
 */
export const EVAL_TEMPLATES = [
  {
    id: 'unterhalt',
    title: 'Unterhaltsreinigung',
    hazards: [
      ['Ausrutschen auf nassen oder frisch gewischten Böden', ['Geschlossene, rutschhemmende Arbeitsschuhe tragen', 'Nasse Flächen mit Warnschild kennzeichnen, in Abschnitten wischen']],
      ['Stolpern über Kabel, Eimer und Geräte', ['Kabel und Geräte so führen und abstellen, dass keine Stolperstellen entstehen']],
      ['Belastung von Rücken und Gelenken durch Heben, Tragen und gebückte Haltung', ['Geräte mit passender Stiellänge und Reinigungswagen verwenden, schwere Lasten nicht allein tragen']],
      ['Hautbelastung durch Feuchtarbeit und Handschuhe', ['Geeignete Schutzhandschuhe, Hautschutz- und Hautpflegeplan']],
      ['Stich- und Schnittverletzungen beim Leeren von Abfallbehältern', ['Abfallsäcke nicht mit der Hand nachdrücken, bei Bedarf schnittfeste Handschuhe']],
    ],
  },
  {
    id: 'glas',
    title: 'Glasreinigung',
    hazards: [
      ['Absturz bei Arbeiten in der Höhe (Fenster, Glasflächen)', ['Möglichst vom Boden mit Teleskopstange arbeiten, sonst geeignete Aufstiegshilfe bzw. Absturzsicherung']],
      ['Schnittverletzungen an beschädigtem Glas und Klingen', ['Schaber mit Klingenschutz verwenden, beschädigtes Glas melden und nicht reinigen']],
      ['Belastung von Schultern und Nacken durch Arbeiten über Kopf', ['Pausen und Wechsel der Tätigkeit einplanen']],
      ['Witterung bei Außenarbeiten (Kälte, Nässe, Sonne)', ['Wettergerechte Kleidung, bei Sturm oder Glätte Außenarbeit verschieben']],
    ],
  },
  {
    id: 'leiter',
    title: 'Arbeiten auf Leitern',
    hazards: [
      ['Absturz durch Abrutschen oder Umkippen der Leiter', ['Leiter nur auf festem, ebenem Untergrund aufstellen, Spreizsicherung einhängen']],
      ['Beschädigte oder ungeeignete Leiter', ['Leiter vor der Benützung auf Schäden prüfen, beschädigte aussondern']],
      ['Seitliches Hinauslehnen', ['Leiter lieber versetzen als sich hinauslehnen']],
    ],
  },
  {
    id: 'winter',
    title: 'Winterdienst',
    hazards: [
      ['Ausrutschen auf Eis und Schnee', ['Schuhe mit griffiger Sohle oder Spikes, zuerst den eigenen Weg streuen']],
      ['Kälte und Nässe', ['Warme, wasserabweisende Kleidung, Aufwärmpausen']],
      ['Verkehr beim Räumen an der Straße, Dunkelheit am frühen Morgen', ['Warnkleidung tragen, am Fahrbahnrand besonders achtgeben']],
      ['Heben und Schieben schwerer Schneemassen', ['Schnee schieben statt heben, passende Schneeschieber verwenden']],
      ['Lärm und Verletzungen an Schneefräsen und Streugeräten', ['Nur unterwiesene Personen bedienen, Gerät vor dem Freimachen abschalten, Gehörschutz bei Bedarf']],
    ],
  },
  {
    id: 'chemie',
    title: 'Umgang mit Reinigungsmitteln',
    hazards: [
      ['Verätzung oder Reizung von Haut und Augen', ['Schutzhandschuhe und bei Spritzgefahr Schutzbrille tragen']],
      ['Gefährliche Reaktion beim Mischen verschiedener Reiniger (z. B. sauer und chlorhaltig)', ['Reiniger nie mischen, nur nach Dosieranleitung verdünnen']],
      ['Einatmen von Dämpfen oder Sprühnebel', ['Für Lüftung sorgen, Schaum oder Strahl statt Sprühnebel']],
      ['Verwechslung durch Umfüllen in unbeschriftete Gefäße', ['Nur beschriftete Gebinde, nie in Getränkeflaschen umfüllen']],
      ['Fehlende Information über die Gefahren der Mittel', ['Sicherheitsdatenblätter und Betriebsanweisungen bereithalten, unterweisen']],
    ],
  },
  {
    id: 'allein',
    title: 'Alleinarbeit',
    hazards: [
      ['Keine Hilfe bei Unfall oder plötzlicher Erkrankung', ['Erreichbarkeit vereinbaren (Handy, Meldung bei Beginn und Ende), gefährliche Arbeiten nicht allein']],
      ['Bedrohung oder Übergriff, z. B. abends in leeren Gebäuden', ['Verhalten bei Bedrohung unterweisen, Notrufnummern im Handy speichern']],
    ],
  },
  {
    id: 'nacht',
    title: 'Nachtarbeit und frühe Dienste',
    hazards: [
      ['Ermüdung und höheres Unfallrisiko', ['Dienstplan mit ausreichender Ruhezeit, Pausen einhalten']],
      ['Unsicherer Weg in der Dunkelheit (Zugang zum Objekt)', ['Gut beleuchtete Zugänge mit dem Kunden vereinbaren']],
      ['Gesundheitliche Belastung durch Arbeit in der Nacht', ['Arbeitsmedizinische Beratung anbieten']],
    ],
  },
  {
    id: 'maschinen',
    title: 'Reinigungsmaschinen',
    hazards: [
      ['Stromschlag durch beschädigte Kabel oder Stecker', ['Sichtprüfung vor jeder Benützung, beschädigte Geräte nicht verwenden']],
      ['Lärm und Vibration', ['Leise Geräte wählen, Gehörschutz bei Bedarf']],
      ['Quetschen oder Einziehen an bewegten Teilen', ['Nur unterwiesene Personen bedienen, Schutzeinrichtungen nicht entfernen']],
    ],
  },
]
export const templateOf = (id) => EVAL_TEMPLATES.find((t) => t.id === id) || null

/** Gefahren einer Vorlage als Einträge (ohne Bewertung, Maßnahmen offen ohne Frist und Verantwortliche). */
export function hazardsFromTemplate(id, newId) {
  return (templateOf(id)?.hazards || []).map(([text, measures]) => ({ id: newId(), text, source: 'vorschlag', likelihood: 0, severity: 0, measures: measures.map((m) => ({ id: newId(), text: m, who: '', due: '', status: 'offen', doneAt: '', checkedAt: '', trainingTypeId: '' })) }))
}
