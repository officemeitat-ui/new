// Vorlagen für die Leistungs-Checkliste (core/checkliste.js): Punkte zum Übernehmen im Dialog „Leistung bearbeiten“,
// je Punkt in allen Sprachen der Mitarbeitenden (wie die Texte in mein-plan-texte.php: kurze Sätze, Du-Form,
// Bosnisch/Kroatisch/Serbisch als gemeinsame Fassung in lateinischer Schrift). Übernommene Punkte tragen die
// Übersetzungen als „aktuell“; ändert das Büro den deutschen Text, gelten sie als veraltet (wie bei den
// Objektanweisungen). Die Übersetzungen sind nicht von Muttersprachlern geprüft: Korrekturen hier eintragen, npm test.
//
// photo: Foto nötig; weekly: nur 1× pro Woche (beim ersten Einsatz der Leistung in der Woche).

import { FOREIGN_LANGUAGES, sourceKey } from './sprachen.js'
import { MAX_ITEMS } from './checkliste.js'

const FLOOR = { de: 'Boden feucht wischen', bks: 'Vlažno obriši pod', ro: 'Șterge pardoseala cu mopul umed', tr: 'Zemini nemli paspasla sil', hu: 'Mosd fel nedvesen a padlót', en: 'Damp-mop the floor' }

export const CHECKLIST_TEMPLATES = [
  {
    id: 'buero',
    label: 'Büro',
    items: [
      { de: 'Papierkörbe entleeren, Säcke tauschen', bks: 'Isprazni korpe za otpatke i zamijeni vreće', ro: 'Golește coșurile de gunoi și schimbă sacii', tr: 'Çöp kutularını boşalt ve poşetleri değiştir', hu: 'Ürítsd ki a papírkosarakat, cseréld ki a zsákokat', en: 'Empty the waste bins and replace the bags' },
      { de: 'Schreibtische und freie Flächen feucht abwischen', bks: 'Obriši stolove i slobodne površine vlažnom krpom', ro: 'Șterge cu o lavetă umedă birourile și suprafețele libere', tr: 'Masaları ve boş yüzeyleri nemli bezle sil', hu: 'Töröld le nedvesen az íróasztalokat és a szabad felületeket', en: 'Wipe desks and clear surfaces with a damp cloth' },
      { de: 'Türklinken und Lichtschalter reinigen', bks: 'Očisti kvake na vratima i prekidače za svjetlo', ro: 'Curăță clanțele ușilor și întrerupătoarele', tr: 'Kapı kollarını ve ışık düğmelerini temizle', hu: 'Tisztítsd meg a kilincseket és a villanykapcsolókat', en: 'Clean door handles and light switches' },
      { de: 'Böden saugen oder feucht wischen', bks: 'Usisaj ili vlažno obriši podove', ro: 'Aspiră sau șterge umed pardoseala', tr: 'Zemini elektrik süpürgesiyle çek veya nemli paspasla sil', hu: 'Porszívózd vagy mosd fel nedvesen a padlót', en: 'Vacuum or damp-mop the floors' },
      { de: 'Fenster schließen, Licht aus', bks: 'Zatvori prozore, ugasi svjetlo', ro: 'Închide ferestrele, stinge lumina', tr: 'Pencereleri kapat, ışıkları söndür', hu: 'Csukd be az ablakokat, kapcsold le a villanyt', en: 'Close the windows, switch off the lights' },
    ],
  },
  {
    id: 'sanitaer',
    label: 'Sanitär',
    items: [
      { de: 'WC, Urinal und Waschbecken reinigen und desinfizieren', bks: 'Očisti i dezinfikuj WC, pisoar i umivaonik', ro: 'Curăță și dezinfectează toaleta, pisoarul și chiuveta', tr: 'Klozeti, pisuarı ve lavaboyu temizle ve dezenfekte et', hu: 'Tisztítsd meg és fertőtlenítsd a WC-t, a piszoárt és a mosdót', en: 'Clean and disinfect toilets, urinals and washbasins' },
      { de: 'Spiegel und Armaturen reinigen', bks: 'Očisti ogledala i slavine', ro: 'Curăță oglinzile și robinetele', tr: 'Aynaları ve muslukları temizle', hu: 'Tisztítsd meg a tükröket és a csaptelepeket', en: 'Clean mirrors and taps' },
      { de: 'Seife, Papier und Handtücher nachfüllen', bks: 'Dopuni sapun, papir i ručnike', ro: 'Completează săpunul, hârtia și prosoapele', tr: 'Sabunu, kâğıdı ve havluları doldur', hu: 'Töltsd fel a szappant, a papírt és a törölközőket', en: 'Refill soap, paper and towels' },
      { de: 'Hygienebehälter und Mülleimer entleeren', bks: 'Isprazni higijenske posude i kante za smeće', ro: 'Golește recipientele igienice și coșurile de gunoi', tr: 'Hijyen kutularını ve çöp kovalarını boşalt', hu: 'Ürítsd ki az egészségügyi tartályokat és a szemeteseket', en: 'Empty sanitary bins and waste bins' },
      FLOOR,
    ],
  },
  {
    id: 'stiegenhaus',
    label: 'Stiegenhaus',
    items: [
      { de: 'Stufen und Podeste kehren und feucht wischen', bks: 'Pometi i vlažno obriši stepenice i odmorišta', ro: 'Mătură și șterge umed treptele și palierele', tr: 'Basamakları ve sahanlıkları süpür, nemli paspasla sil', hu: 'Söpörd fel és mosd fel nedvesen a lépcsőfokokat és a pihenőket', en: 'Sweep and damp-mop stairs and landings' },
      { de: 'Handlauf und Geländer abwischen', bks: 'Obriši rukohvat i ogradu', ro: 'Șterge mâna curentă și balustrada', tr: 'Tırabzanı ve korkulukları sil', hu: 'Töröld le a kapaszkodót és a korlátot', en: 'Wipe handrails and banisters' },
      { de: 'Lift innen reinigen', bks: 'Očisti lift iznutra', ro: 'Curăță liftul în interior', tr: 'Asansörün içini temizle', hu: 'Takarítsd ki a liftet belülről', en: 'Clean the inside of the lift' },
      { de: 'Eingangstür und Briefkästen abwischen', bks: 'Obriši ulazna vrata i poštanske sandučiće', ro: 'Șterge ușa de la intrare și cutiile poștale', tr: 'Giriş kapısını ve posta kutularını sil', hu: 'Töröld le a bejárati ajtót és a postaládákat', en: 'Wipe the entrance door and letterboxes' },
      { de: 'Fußmatte ausklopfen oder saugen', bks: 'Istresi ili usisaj otirač', ro: 'Scutură sau aspiră preșul', tr: 'Kapı paspasını silkele veya elektrik süpürgesiyle temizle', hu: 'Rázd ki vagy porszívózd ki a lábtörlőt', en: 'Shake out or vacuum the doormat' },
    ],
  },
  {
    id: 'kueche',
    label: 'Küche',
    items: [
      { de: 'Geschirrspüler einschalten oder ausräumen', bks: 'Uključi ili isprazni mašinu za suđe', ro: 'Pornește sau golește mașina de spălat vase', tr: 'Bulaşık makinesini çalıştır veya boşalt', hu: 'Indítsd el vagy pakold ki a mosogatógépet', en: 'Start or unload the dishwasher' },
      { de: 'Spüle und Arbeitsflächen reinigen', bks: 'Očisti sudoper i radne površine', ro: 'Curăță chiuveta și blaturile de lucru', tr: 'Eviyeyi ve tezgâhları temizle', hu: 'Tisztítsd meg a mosogatót és a munkalapokat', en: 'Clean the sink and worktops' },
      { de: 'Kühlschrank außen und Griffe abwischen', bks: 'Obriši frižider izvana i ručke', ro: 'Șterge frigiderul la exterior și mânerele', tr: 'Buzdolabının dışını ve kollarını sil', hu: 'Töröld le a hűtő külsejét és a fogantyúkat', en: 'Wipe the outside of the fridge and the handles' },
      { de: 'Mikrowelle und Kaffeemaschine außen reinigen', bks: 'Očisti mikrovalnu i aparat za kafu izvana', ro: 'Curăță la exterior cuptorul cu microunde și aparatul de cafea', tr: 'Mikrodalganın ve kahve makinesinin dışını temizle', hu: 'Tisztítsd meg kívülről a mikrót és a kávéfőzőt', en: 'Clean the outside of the microwave and coffee machine' },
      { de: 'Müll entleeren und trennen', bks: 'Isprazni smeće i razdvoji otpad', ro: 'Golește gunoiul și sortează deșeurile', tr: 'Çöpü boşalt ve ayrıştır', hu: 'Ürítsd ki és válogasd szét a szemetet', en: 'Empty and sort the rubbish' },
      FLOOR,
    ],
  },
  {
    id: 'glas',
    label: 'Glas',
    items: [
      { de: 'Glasflächen Eingang reinigen', bks: 'Očisti staklene površine na ulazu', ro: 'Curăță suprafețele de sticlă de la intrare', tr: 'Girişteki cam yüzeyleri temizle', hu: 'Tisztítsd meg a bejárat üvegfelületeit', en: 'Clean the glass surfaces at the entrance', photo: true },
      { de: 'Glastüren und Griffbereiche reinigen', bks: 'Očisti staklena vrata i dijelove oko ručki', ro: 'Curăță ușile de sticlă și zonele din jurul mânerelor', tr: 'Cam kapıları ve kol çevrelerini temizle', hu: 'Tisztítsd meg az üvegajtókat és a fogantyúk környékét', en: 'Clean glass doors and around the handles' },
      { de: 'Fensterbänke abwischen', bks: 'Obriši prozorske daske', ro: 'Șterge pervazurile', tr: 'Pencere pervazlarını sil', hu: 'Töröld le az ablakpárkányokat', en: 'Wipe the window sills' },
      { de: 'Glastrennwände innen reinigen', bks: 'Očisti staklene pregrade iznutra', ro: 'Curăță pereții despărțitori din sticlă în interior', tr: 'İçerideki cam bölmeleri temizle', hu: 'Tisztítsd meg belül az üveg válaszfalakat', en: 'Clean interior glass partitions', weekly: true },
    ],
  },
]

/**
 * Vorlage übernehmen: ihre Punkte hinten an die vorhandenen (schon vorhandene Texte nicht doppelt, höchstens 30),
 * mit neuen Kennungen (newId) und den Übersetzungen der Vorlage als aktuell (by: „Vorlage“).
 */
export function fromTemplate(template, existing = [], { newId, at = '', by = 'Vorlage' } = {}) {
  const have = new Set(existing.map((x) => String(x.text || '').trim().toLowerCase()))
  const out = [...existing]
  for (const t of template?.items || []) {
    if (out.length >= MAX_ITEMS || have.has(t.de.toLowerCase())) continue
    have.add(t.de.toLowerCase())
    const source = sourceKey(t.de)
    const i18n = Object.fromEntries(FOREIGN_LANGUAGES.filter((l) => t[l.id]).map((l) => [l.id, { text: t[l.id], source, ...(at ? { at } : {}), by }]))
    out.push({ id: newId(), text: t.de, ...(t.photo ? { photo: true } : {}), ...(t.weekly ? { weekly: true } : {}), i18n })
  }
  return out
}
