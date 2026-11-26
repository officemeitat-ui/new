// Vorlage „Sicherheitsunterweisung Gebäudereinigung und Facility Service“ für die Unterweisung am Handy
// (core/unterweisung-online.js) in den Sprachen der Mitarbeitenden. Vorschlag ohne Gewähr, keine Rechtsauskunft:
// allgemeine Gefahren der Reinigung und Hausbetreuung nach § 14 ASchG; die eigene Evaluierung (§ 4 ASchG), die
// Betriebsanweisungen und die Einschulung im Objekt ergänzen sie (docs/RECHTSPRUEFUNG.md, Punkt 58).
//
// Format (wie im Editor der App):
//   content: Absätze, „## Überschrift“ beginnt einen Abschnitt, „- “ ist ein Punkt einer Liste
//   quiz:    „? Frage“, darunter Antworten, „+ “ = richtig (genau eine), „- “ = falsch
//   decl:    Text der Erklärung, die die Person mit ihrer Unterschrift bestätigt
// Alle Sprachen haben dieselben Abschnitte, Fragen und Antworten in derselben Reihenfolge (test/unterweisung-online.test.js).
// Die Übersetzungen sind nicht von Muttersprachlern geprüft.

export const VORLAGE_NAME = 'Gebäudereinigung und Facility Service (Österreich)'

export const VORLAGE = {
  de: {
    title: 'Sicherheitsunterweisung Gebäudereinigung und Facility Service',
    content: `Diese Unterweisung gilt für alle Arbeiten in der Gebäudereinigung und im Facility Service (Hausbetreuung, Glasreinigung, Außenanlagen, Winterdienst). Sie ist gesetzlich vorgeschrieben (§ 14 ArbeitnehmerInnenschutzgesetz, ASchG): vor dem ersten Einsatz und danach jedes Jahr. Die Zeit dafür ist Arbeitszeit.

Lies jeden Abschnitt in Ruhe. Am Ende beantwortest du ein paar Fragen und bestätigst mit deiner Unterschrift. Wenn du etwas nicht verstehst: Frag bitte nach, bevor du unterschreibst.

## Deine Pflichten und Rechte
- Halte dich an die Anweisungen und an die Betriebsanweisungen.
- Benutze die Schutzausrüstung, die du von uns bekommst (Handschuhe, Schutzbrille, Schuhe, Warnweste).
- Benutze Geräte, Maschinen und Mittel nur so, wie du es gelernt hast.
- Melde Mängel, Schäden und gefährliche Situationen sofort: Vorarbeiter:in, Büro oder „Gerät kaputt?“ in Mein Plan.
- Arbeite nie unter Einfluss von Alkohol, Drogen oder Medikamenten, die müde machen.
- Bei ernster und unmittelbarer Gefahr bringst du dich in Sicherheit und meldest es sofort. Dafür darfst du keine Nachteile haben.

## Reinigungsmittel und Desinfektion
- Lies vor der Arbeit das Etikett und die Betriebsanweisung. Die Gefahrensymbole (rote Raute) zeigen dir die Gefahr.
- Sicherheitsdatenblätter und Betriebsanweisungen liegen im Büro bzw. im Objekt auf. Frag nach, wenn du sie nicht findest.
- Dosiere genau nach Angabe (Dosierhilfe, Messbecher). Mehr Mittel reinigt nicht besser, es schadet Haut und Material.
- Mische nie verschiedene Mittel. Besonders gefährlich: saurer WC-Reiniger und Chlorreiniger, es entsteht giftiges Chlorgas.
- Fülle Mittel nie in Getränkeflaschen um. Nur in richtig beschriftete Flaschen und Sprühflaschen.
- Trage bei Konzentrat Schutzhandschuhe und Schutzbrille.
- Lüfte gut, vor allem in kleinen Räumen (WC, Dusche). Sprüh möglichst wenig, besser auf das Tuch.
- Verschließe Gebinde nach der Arbeit und lass sie nie offen oder unbeaufsichtigt stehen (Kinder, Kundschaft).
- Zuerst das Wasser, dann das Reinigungsmittel.
- Sprüh nie in Richtung von Menschen, auch nicht zu dir selbst. Atme den Sprühnebel nicht ein.
- Gefährliche Säuren füllst du nicht um. Unter größere Kanister mit Hahn (z. B. 10 Liter) gehört eine Auffangwanne.
- Lagere Mittel im Objekt nur in verschlossenen, belüfteten Räumen. Nimm im Auto nur kleine Mengen für deine eigene Arbeit mit (Gefahrgut).
- Desinfektion: wischen statt sprühen. Alkoholische Desinfektionsmittel brennen leicht.
- Schmutzwasser aus dem Wassersauger erst neutralisieren (pH 7), dann über den Kanal entsorgen, so wie es dir die Objektleitung zeigt.

## Lösemittel
- Lösemittel brennen leicht, und ihre Dämpfe schaden der Gesundheit (Leber, Nerven).
- Nicht rauchen, kein offenes Feuer. Lüfte gut und atme die Dämpfe nicht ein.
- Brennendes Lösemittel nie mit Wasser löschen, sondern mit Sand oder einem Pulverlöscher.
- Lösemittel nur in geschlossenen Metallgebinden lagern. Reste und leere Gebinde sind gefährlicher Abfall und kommen zur Sammelstelle.

## Haut schützen
- Arbeit mit Wasser und Reinigungsmitteln belastet die Haut (Feuchtarbeit). Auch langes Tragen von Handschuhen zählt dazu.
- Halte dich an den Hautschutzplan: vor der Arbeit schützen, nach der Arbeit reinigen und pflegen.
- Trage passende Schutzhandschuhe (z. B. Nitril). Wechsle feuchte Handschuhe, bei langer Arbeit Baumwollhandschuhe darunter.
- Melde Rötungen, Jucken oder Risse an der Haut früh. Daraus kann eine Berufskrankheit werden.
- Trag Handschuhe auch bei verdünnten Mitteln, vor allem bei Laugen. Schlag die Stulpen um, damit nichts hineinrinnt.

## Erste Hilfe bei Reinigungsmitteln
- Spritzer ins Auge: sofort mindestens 10 Minuten mit Wasser spülen, das Auge dabei offen halten, dann zum Arzt.
- Auf der Haut: verschmutzte Kleidung ausziehen, mit viel Wasser abspülen.
- Verschluckt: Mund ausspülen, kein Erbrechen auslösen, Vergiftungsinformationszentrale anrufen (01 406 43 43), bei Beschwerden Rettung 144.
- Nimm das Etikett oder das Sicherheitsdatenblatt zum Arzt mit.

## Rutschen, Stolpern, Stürzen
- Trage geschlossene, rutschfeste Schuhe.
- Stell beim Nasswischen das Warnschild „Rutschgefahr“ auf. Wo Leute gehen, wische möglichst halbseitig.
- Leg Kabel und Schläuche so, dass niemand darüber stolpert. Halte Gänge und Stiegen frei.
- Geh auf Stiegen langsam und halte dich am Handlauf fest. Trag nichts, was dir die Sicht nimmt.
- Sorge für gutes Licht. Melde kaputte Beleuchtung.
- Wische mit Tüchern, die nicht zu nass sind.
- Deine Schuhe brauchen eine rutschfeste Sohle und einen Riemen an der Ferse. Auf Leitern trägst du flache Schuhe, die die Ferse umschließen.

## Leitern und Arbeiten in der Höhe
- Benutze nur Leitern und Tritte, die in Ordnung sind. Prüfe sie vor jeder Benutzung (Sprossen, Füße, Spreizsicherung).
- Steig nie auf Sessel, Tische, Kübel oder Heizkörper.
- Stell die Leiter auf festen, ebenen Boden. Bei der Stehleiter die Spreizsicherung spannen.
- Steig bei der Stehleiter nicht auf die obersten zwei Stufen. Lehn dich nicht seitlich hinaus.
- Für hohe Glasflächen nimm Teleskopstangen statt der Leiter, wo es geht.
- Glas außen, Hubarbeitsbühnen, Arbeiten am Dach oder mit Absturzgefahr: nur mit eigener Einschulung, Sicherung und Freigabe durch die Vorgesetzten.
- Lehn dich nie aus Fenstern hinaus und steig nicht auf Fensterbretter.
- Anlegeleiter: Winkel 65 bis 75 Grad, gegen Wegrutschen sichern, mindestens 1 Meter über die Stelle hinaus, an der du aussteigst. Steh mit beiden Füßen auf den Sprossen.
- Lehn die Stehleiter nicht zusammengeklappt an. Auf Stiegen nur Leitern mit Holmverlängerung verwenden.
- Sicherheitsgeschirr nur nach Einschulung und nur an den festgelegten Punkten. Prüf es vor jeder Benutzung. Nach einem Sturz darf es nicht mehr verwendet werden.

## Geräte und Maschinen
- Benutze Maschinen (z. B. Scheuersaugmaschine, Einscheibenmaschine, Hochdruckreiniger, Laubbläser, Rasenmäher) erst nach der Einschulung.
- Schau vor der Arbeit Kabel, Stecker und Gerät an. Beschädigt? Nicht benutzen, kennzeichnen und sofort melden.
- Zieh den Stecker, bevor du Bürsten, Pads oder Beutel wechselst oder das Gerät reinigst.
- Fass Stecker und Schalter nie mit nassen Händen an. Fahr nicht über das Kabel.
- Repariere nichts selbst, keine Bastellösungen mit Klebeband.
- Trage Gehörschutz und Schutzbrille, wenn die Betriebsanweisung es verlangt (z. B. Laubbläser, Heckenschere).
- Treibteller und Bürsten nur bei gezogenem Stecker montieren.
- Führe das Kabel immer hinter der Maschine, über Hand oder Schulter. Klemm es nicht ein (z. B. in automatischen Türen). Wickle es locker auf und schau dabei, ob es beschädigt ist.
- Zieh in den Pausen den Schlüssel der Maschine ab.

## Heben und Tragen
- Heb mit geradem Rücken aus den Knien, halte die Last nah am Körper und dreh dich nicht mit der Last.
- Benutze Wagen, Rollen und Transporthilfen. Teile schwere Lasten auf oder hol Hilfe.
- Heb volle Kübel und Müllsäcke nicht über Kopfhöhe und halte Müllsäcke vom Körper weg.

## Infektionsgefahr, Nadeln und Scherben
- Trage bei Sanitärreinigung und Müll immer Schutzhandschuhe.
- Greif nie mit der Hand in Müllsäcke und Papierkörbe und drück den Müll nicht mit der Hand zusammen.
- Gebrauchte Spritzen oder Nadeln: nicht angreifen. Mit Zange oder Greifer in einen stichfesten Behälter geben, dann melden.
- Stich oder Schnitt an einer gebrauchten Nadel oder an verschmutzten Scherben: Wunde bluten lassen, desinfizieren, sofort melden und gleich zum Arzt (am besten innerhalb von 2 Stunden).
- Wasch und desinfizier die Hände vor dem Essen, Trinken und Rauchen und nach der Arbeit.
- Iss und trink nicht in Sanitärräumen.
- Verwende Tücher nach Farben (z. B. rot nur für WC und Urinal), damit keine Keime verschleppt werden.
- In Pflegeheimen und Ordinationen: kein Schmuck und keine Uhr, kurze Fingernägel, lange Haare zusammenbinden. Einweghandschuhe und Einwegschürze, wo es verlangt wird.
- Desinfiziere die Hände vor und nach dem Dienst, nach unreinen Arbeiten und nach dem WC.
- Transportiere Müllsäcke im Wagen, nicht in der Hand.
- Frag nach der Impfung gegen Hepatitis B. Die Arbeitsmedizin berät dich.

## Allein arbeiten, früh und spät
- Hab dein Handy geladen dabei. Speichere die Notrufnummern und die Nummer des Büros.
- Lass keine fremden Personen ins Gebäude. Halte Türen geschlossen, wie es die Kundschaft verlangt.
- Bei Bedrohung oder Gewalt: bring dich in Sicherheit, ruf die Polizei 133, dann das Büro.
- Gefährliche Arbeiten (z. B. hohe Leiter, Maschinen in abgelegenen Räumen) machst du nicht allein, wenn die Betriebsanweisung das verlangt.

## Notfall und Erste Hilfe
- Notrufe: Rettung 144, Feuerwehr 122, Polizei 133, Euro-Notruf 112, Vergiftungsinformation 01 406 43 43.
- Sag beim Notruf: Wo ist es (Adresse, Stiege, Stock)? Was ist passiert? Wie viele Verletzte? Warte auf Rückfragen.
- Weißt du, wo im Objekt Erste-Hilfe-Kasten, Feuerlöscher und Notausgänge sind? Wenn nicht: Frag beim ersten Einsatz nach.
- Leiste Erste Hilfe, so gut du kannst. Deine eigene Sicherheit geht vor.

## Brand und Fluchtwege
- Halte Fluchtwege, Notausgänge und Brandschutztüren frei. Keil Brandschutztüren nie auf.
- Im Brandfall: alarmieren (122), Menschen warnen und in Sicherheit bringen, löschen nur, wenn es ohne Gefahr geht.
- Benutze im Brandfall nie den Lift.
- Stell Reinigungswagen und Material nicht vor Feuerlöscher, Hydranten oder Notausgänge.
- Beim Melden: Wer meldet? Was ist passiert? Wie viele sind betroffen? Wo ist es? Warte auf Rückfragen. Drück den Brandmelder.
- Nimm gefährdete Personen mit, schließ die Türen hinter dir und folge den Fluchtwegen.

## Unfälle und Beinahe-Unfälle melden
- Melde jeden Arbeitsunfall sofort, auch kleine Verletzungen und Unfälle auf dem Arbeitsweg.
- Melde auch Beinahe-Unfälle („das war knapp“). So verhindern wir den nächsten Unfall.
- Nach einem Unfall besprechen wir, was wir ändern.

## Bei der Kundschaft
- Halte dich an die Hausordnung und die Vorgaben im Objekt (Alarmanlage, Zutritt, Bereiche, die du nicht betreten darfst).
- Schlüssel, Karten und Codes: nur für die Arbeit, nie weitergeben, nie beschriften. Verlust sofort melden.
- Lies keine Unterlagen und schau nicht auf Bildschirme. Was du im Objekt siehst und hörst, bleibt vertraulich.
- Fundstücke und Schäden meldest du dem Büro.

## Fahrzeug und Arbeitsweg
- Firmenfahrzeug nur mit gültigem Führerschein und nach Freigabe. Gurt anlegen, kein Handy am Steuer.
- Sichere die Ladung (Maschinen, Kanister) gegen Verrutschen.
- Kein Alkohol und keine Drogen, weder bei der Arbeit noch am Steuer.
- Prüf vor der Fahrt Lichter, Blinker und Bremslicht. Führerschein und Zulassungsschein hast du immer dabei.
- Befestige Leitern mit Spanngurten am Dachträger.
- Kontrollier Warnweste, Pannendreieck und Verbandskasten regelmäßig. Melde jeden Unfall sofort.

## Winterdienst, Kälte und Hitze
- Winterdienst nur nach Einschulung (Schneefräse, Streuwagen). Trage Warnkleidung, Schuhe mit gutem Profil und warme Kleidung.
- Achte auf den Verkehr, auch bei Dunkelheit. Räum und streu zuerst den Weg, auf dem du selbst gehst.
- Bei Hitze: viel Wasser trinken, Pausen im Schatten, Kopfbedeckung und Sonnenschutz.

## Schwangerschaft, Jugendliche, Gesundheit
- Wenn du schwanger bist, sag es bitte so früh wie möglich im Büro. Wir prüfen dann deinen Arbeitsplatz. Manche Arbeiten sind dann nicht erlaubt, z. B. mit bestimmten Reinigungsmitteln, auf Leitern oder schweres Heben (Mutterschutzgesetz).
- Für Jugendliche unter 18 gelten eigene Regeln. Sie machen nur Arbeiten, für die sie freigegeben sind.
- Sag uns, wenn du gesundheitliche Einschränkungen hast (z. B. Allergie, Rücken), damit wir die Arbeit anpassen können.

## Sicherheitsmappe
- Im Objekt liegt die Sicherheitsmappe (Betriebsanweisungen, Sicherheitsdatenblätter) in der Reinigungskammer, bei Firmenfahrzeugen im Fahrzeug.
- Schau vor Arbeitsbeginn hinein, vor allem in einem neuen Objekt oder bei einem neuen Mittel.

## Fragen
- Bei Fragen zu Sicherheit und Gesundheit wende dich an deine Vorarbeiterin oder deinen Vorarbeiter oder an das Büro.
- Besondere Gefahren im einzelnen Objekt (z. B. Labor, Küche, Produktion) erfährst du bei der Einschulung vor Ort.`,
    quiz: `? Du brauchst einen sauren WC-Reiniger und einen Chlorreiniger. Was ist richtig?
+ Nie mischen und nie gleichzeitig verwenden, es entsteht giftiges Gas.
- Mischen ist in Ordnung, wenn das Fenster offen ist.
- Mischen reinigt besser und spart Zeit.

? Wo findest du die Gefahren und Schutzmaßnahmen eines Reinigungsmittels?
+ Auf dem Etikett, in der Betriebsanweisung und im Sicherheitsdatenblatt.
- Nur am Geruch.
- Nirgends, das weiß nur der Lieferant.

? Darfst du Reinigungsmittel in eine leere Getränkeflasche umfüllen?
+ Nein, nie. Nur in richtig beschriftete Flaschen.
- Ja, wenn die Flasche sauber ist.
- Ja, wenn ich mir die Flasche merke.

? Ein Spritzer Reinigungsmittel ist dir ins Auge gekommen. Was tust du?
+ Sofort mindestens 10 Minuten mit Wasser spülen, dann zum Arzt.
- Das Auge reiben und weiterarbeiten.
- Abwarten, ob es besser wird.

? Was tust du, bevor du einen Gang nass wischst, in dem Leute gehen?
+ Warnschild „Rutschgefahr“ aufstellen und möglichst halbseitig wischen.
- Nichts, die Leute sehen den nassen Boden schon.
- Schnell wischen, dann trocknet es von selbst.

? Was ist bei der Stehleiter richtig?
+ Vorher prüfen, Spreizsicherung spannen, nicht auf die obersten zwei Stufen steigen.
- Ein Sessel ist genauso gut wie eine Leiter.
- Die oberste Stufe ist zum Stehen da.

? Das Kabel der Reinigungsmaschine ist beschädigt. Was tust du?
+ Nicht benutzen, kennzeichnen und sofort melden.
- Mit Klebeband reparieren und weiterarbeiten.
- Vorsichtig weiterarbeiten und es am Monatsende melden.

? Im Mistkübel liegt eine gebrauchte Spritze. Was ist richtig?
+ Nicht angreifen, mit Zange oder Greifer in einen stichfesten Behälter geben und melden.
- Mit der Hand herausnehmen und in den Müllsack werfen.
- Den Müll mit der Hand zusammendrücken, damit mehr Platz ist.

? Du hast dich an einer gebrauchten Nadel gestochen. Was tust du?
+ Wunde bluten lassen, desinfizieren, sofort melden und gleich zum Arzt.
- Pflaster drauf und weiterarbeiten.
- Erst in ein paar Tagen zum Arzt, wenn es weh tut.

? Welche Nummer hat die Rettung in Österreich?
+ 144
- 122
- 133

? Im Objekt brennt es. Was ist richtig?
+ Alarmieren (122), Menschen warnen, nur ohne Gefahr löschen, nie den Lift benutzen.
- Zuerst die Arbeit fertig machen.
- Mit dem Lift schnell hinunterfahren.

? Du hast dich leicht verletzt oder es ist fast ein Unfall passiert. Was tust du?
+ Sofort melden, auch kleine Verletzungen und Beinahe-Unfälle.
- Nur melden, wenn ich ins Krankenhaus muss.
- Nichts sagen, damit es keinen Ärger gibt.

? Was gilt für Schlüssel, Karten und Codes der Kundschaft?
+ Nur für die Arbeit verwenden, nie weitergeben, Verlust sofort melden.
- Ich darf sie Kolleginnen und Kollegen leihen.
- Ich schreibe den Code auf den Schlüssel, damit ich ihn nicht vergesse.

? Wie stellst du eine Anlegeleiter richtig auf?
+ Winkel 65 bis 75 Grad, gegen Wegrutschen gesichert, 1 Meter über die Ausstiegsstelle.
- Möglichst steil, dann steht sie stabiler.
- Egal wie, Hauptsache schnell.

? Lösemittel brennt. Womit löschst du?
+ Mit Sand oder einem Pulverlöscher, nicht mit Wasser.
- Mit viel Wasser.
- Mit einem nassen Tuch.`,
    decl: 'Ich bestätige: Ich habe die Sicherheitsunterweisung heute erhalten, gelesen und verstanden. Ich hatte die Möglichkeit, Fragen zu stellen. Ich halte mich an die Anweisungen und benutze die Schutzausrüstung. Wenn ich etwas nicht weiß oder sich etwas ändert, frage ich nach.',
  },
  bks: {
    title: 'Sigurnosna obuka za čišćenje i održavanje zgrada',
    content: `Ova sigurnosna obuka važi za sve poslove čišćenja i održavanja zgrada (domarski poslovi, pranje stakla, vanjske površine, zimska služba). Propisana je zakonom (§ 14 Zakona o zaštiti radnika, ASchG): prije prve smjene i zatim svake godine. Vrijeme za obuku je radno vrijeme.

Pročitaj svaki dio polako. Na kraju odgovoriš na nekoliko pitanja i potvrdiš svojim potpisom. Ako nešto ne razumiješ: molimo pitaj prije nego što potpišeš.

## Tvoje obaveze i prava
- Drži se uputa koje dobiješ i radnih uputa.
- Koristi zaštitnu opremu koju dobiješ od nas (rukavice, zaštitne naočale, cipele, sigurnosni prsluk).
- Uređaje, mašine i sredstva koristi samo onako kako si naučio/la.
- Nedostatke, štete i opasne situacije odmah prijavi: predradniku ili predradnici, uredu ili preko „Uređaj je pokvaren?“ na stranici „Moj raspored“.
- Nikad ne radi pod djelovanjem alkohola, droga ili lijekova od kojih si umoran/na.
- Kod ozbiljne i neposredne opasnosti skloni se na sigurno i odmah to prijavi. Zbog toga ne smiješ imati nikakve negativne posljedice.

## Sredstva za čišćenje i dezinfekciju
- Prije rada pročitaj etiketu i radnu uputu. Znakovi opasnosti (crveni romb) pokazuju ti opasnost.
- Sigurnosni listovi i radne upute nalaze se u uredu ili na lokaciji. Pitaj ako ih ne nađeš.
- Doziraj tačno kako piše (dozator, mjerna čaša). Više sredstva ne čisti bolje, nego šteti koži i materijalu.
- Nikad ne miješaj različita sredstva. Posebno opasno: kiselo sredstvo za WC i sredstvo s klorom, nastaje otrovni plin klor.
- Nikad ne sipaj sredstva u boce za piće. Samo u pravilno označene boce i boce za prskanje.
- Kod koncentrata nosi zaštitne rukavice i zaštitne naočale.
- Dobro provjetri, posebno u malim prostorijama (WC, tuš). Prskaj što manje, bolje na krpu.
- Nakon rada zatvori posude i nikad ih ne ostavljaj otvorene ili bez nadzora (djeca, klijenti).
- Prvo voda, zatim sredstvo za čišćenje.
- Nikad ne prskaj prema ljudima, ni prema sebi. Ne udiši maglicu od prskanja.
- Opasne kiseline ne sipaš u druge posude. Ispod većih kanistera sa slavinom (npr. 10 litara) mora stajati prihvatna posuda.
- Na lokaciji drži sredstva samo u zaključanim prostorijama koje se provjetravaju. U autu nosi samo male količine za svoj posao (opasna roba).
- Dezinfekcija: briši umjesto da prskaš. Sredstva za dezinfekciju s alkoholom lako se zapale.
- Prljavu vodu iz usisivača za vodu prvo neutraliziraj (pH 7), zatim je izlij u kanalizaciju, onako kako ti pokaže odgovorna osoba na lokaciji.

## Rastvarači (otapala)
- Rastvarači se lako zapale, a njihove pare štete zdravlju (jetra, živci).
- Ne puši, bez otvorene vatre. Dobro provjetri i ne udiši pare.
- Zapaljeni rastvarač nikad ne gasi vodom, nego pijeskom ili aparatom za gašenje s prahom.
- Rastvarače drži samo u zatvorenim metalnim posudama. Ostaci i prazne posude su opasan otpad i idu na mjesto za prikupljanje.

## Zaštiti kožu
- Rad s vodom i sredstvima za čišćenje opterećuje kožu (mokri rad). I dugo nošenje rukavica spada u to.
- Drži se plana zaštite kože: prije rada zaštiti kožu, poslije rada je očisti i njeguj.
- Nosi odgovarajuće zaštitne rukavice (npr. od nitrila). Mijenjaj vlažne rukavice. Kod dugog rada nosi ispod pamučne rukavice.
- Rano prijavi crvenilo, svrab ili pucanje kože. Iz toga može nastati profesionalna bolest.
- Nosi rukavice i kod razrijeđenih sredstava, posebno kod lužina. Preklopi rub rukavica prema van, da ništa ne curi unutra.

## Prva pomoć kod sredstava za čišćenje
- Prskanje u oko: odmah ispiraj vodom najmanje 10 minuta, oko pri tome drži otvoreno, zatim idi doktoru.
- Na koži: skini zaprljanu odjeću, isperi s puno vode.
- Progutano: isperi usta, ne izazivaj povraćanje, nazovi Centar za informacije o trovanjima (01 406 43 43), ako ima tegoba, nazovi Hitnu pomoć 144.
- Ponesi etiketu ili sigurnosni list doktoru.

## Klizanje, spoticanje, padovi
- Nosi zatvorene cipele koje ne klize.
- Kod mokrog brisanja postavi znak upozorenja „Opasnost od klizanja“. Gdje ljudi hodaju, briši po mogućnosti samo jednu polovinu poda odjednom.
- Kablove i crijeva postavi tako da se niko ne spotakne. Hodnike i stepenice drži slobodnim.
- Na stepenicama hodaj polako i drži se za rukohvat. Ne nosi ništa što ti zaklanja pogled.
- Pobrini se za dobro svjetlo. Prijavi pokvarena svjetla.
- Briši krpama koje nisu previše mokre.
- Tvoje cipele trebaju imati đon koji ne klizi i remen oko pete. Na ljestvama nosi ravne cipele koje su zatvorene oko pete.

## Ljestve i rad na visini
- Koristi samo ispravne ljestve i stepenike. Provjeri ih prije svake upotrebe (prečke, noge, osigurač protiv razmicanja).
- Nikad se ne penji na stolice, stolove, kante ili radijatore.
- Postavi ljestve na čvrstu, ravnu podlogu. Kod dvokrakih ljestvi zategni osigurač protiv razmicanja.
- Na dvokrakim ljestvama ne penji se na dvije najviše stepenice. Ne naginji se u stranu.
- Za visoke staklene površine koristi teleskopske šipke umjesto ljestvi, gdje god je moguće.
- Pranje stakla s vanjske strane, podizne radne platforme, rad na krovu ili rad s opasnošću od pada: samo uz posebnu obuku, osiguranje i odobrenje nadređenih.
- Nikad se ne naginji kroz prozor i ne penji se na prozorske daske.
- Naslonjene ljestve: ugao od 65 do 75 stepeni, osiguraj ih da ne kliznu, najmanje 1 metar iznad mjesta gdje prelaziš s ljestvi. Stoj s obje noge na prečkama.
- Ne naslanjaj sklopljene dvokrake ljestve. Na stepenicama koristi samo ljestve s produžetkom za noge.
- Pojas za zaštitu od pada samo nakon obuke i samo na određenim mjestima. Provjeri ga prije svake upotrebe. Nakon pada više se ne smije koristiti.

## Uređaji i mašine
- Mašine (npr. mašinu za pranje i usisavanje poda, jednodisknu mašinu, perač pod visokim pritiskom, duvač lišća, kosilicu) koristi tek nakon obuke.
- Prije rada pogledaj kabl, utikač i uređaj. Oštećeno? Ne koristi, označi i odmah prijavi.
- Izvuci utikač prije nego što mijenjaš četke, padove ili vrećice ili čistiš uređaj.
- Nikad ne diraj utikač i prekidač mokrim rukama. Ne prelazi mašinom preko kabla.
- Ništa ne popravljaj sam/a, nikakva improvizirana rješenja s ljepljivom trakom.
- Nosi zaštitu za sluh i zaštitne naočale kad to traži radna uputa (npr. duvač lišća, trimer za živicu).
- Pogonski disk i četke montiraj samo kad je utikač izvučen.
- Kabl uvijek vodi iza mašine, preko ruke ili ramena. Pazi da se ne zaglavi (npr. u automatskim vratima). Namotaj ga labavo i pri tome pogledaj je li oštećen.
- U pauzama izvuci ključ iz mašine.

## Dizanje i nošenje
- Diži iz koljena s ravnim leđima, drži teret blizu tijela i ne okreći se s teretom.
- Koristi kolica, podloge s točkićima i pomagala za prijenos. Teški teret podijeli ili pozovi pomoć.
- Pune kante i vreće za smeće ne diži iznad visine glave i drži vreće za smeće dalje od tijela.

## Opasnost od infekcije, igle i krhotine
- Kod čišćenja sanitarnih prostorija i smeća uvijek nosi zaštitne rukavice.
- Nikad ne stavljaj ruku u vreće za smeće i korpe za papir i ne sabijaj smeće rukom.
- Korištene šprice ili igle: ne diraj ih. Kliještima ili hvataljkom stavi ih u posudu otpornu na ubod, zatim prijavi.
- Ubod ili posjekotina na korištenoj igli ili prljavoj krhotini: pusti da rana krvari, dezinficiraj je, odmah prijavi i odmah idi doktoru (najbolje u roku od 2 sata).
- Operi i dezinficiraj ruke prije jela, pića i pušenja i poslije rada.
- Ne jedi i ne pij u sanitarnim prostorijama.
- Koristi krpe po bojama (npr. crvenu samo za WC i pisoar), da se klice ne prenose.
- U domovima za starije i nemoćne i u ordinacijama: bez nakita i sata, kratki nokti, dugu kosu zaveži. Rukavice i pregaču za jednokratnu upotrebu nosi gdje se to traži.
- Dezinficiraj ruke prije i poslije smjene, poslije prljavih poslova i poslije odlaska u WC.
- Vreće za smeće prevozi u kolicima, ne nosi ih u ruci.
- Pitaj za vakcinaciju protiv hepatitisa B. Medicina rada će te savjetovati.

## Kad radiš sam/a, rano i kasno
- Imaj uz sebe napunjen telefon. Sačuvaj u telefonu brojeve za hitne slučajeve i broj ureda.
- Ne puštaj nepoznate osobe u zgradu. Drži vrata zatvorena, kako traži klijent.
- Kod prijetnje ili nasilja: skloni se na sigurno, nazovi policiju 133, zatim ured.
- Opasne poslove (npr. visoke ljestve, mašine u udaljenim prostorijama) ne radiš sam/a ako to traži radna uputa.

## Hitan slučaj i prva pomoć
- Hitni brojevi: Hitna pomoć 144, Vatrogasci 122, Policija 133, Euro-hitni broj 112, Informacije o trovanjima 01 406 43 43.
- Kod hitnog poziva reci: Gdje je (adresa, stepenište, sprat)? Šta se dogodilo? Koliko je povrijeđenih? Sačekaj dodatna pitanja.
- Znaš li gdje su na lokaciji kutija prve pomoći, aparat za gašenje požara i izlazi u slučaju nužde? Ako ne znaš: pitaj u prvoj smjeni.
- Pruži prvu pomoć koliko možeš. Tvoja sigurnost je na prvom mjestu.

## Požar i putevi za evakuaciju
- Drži slobodnim puteve za evakuaciju, izlaze u slučaju nužde i protivpožarna vrata. Protivpožarna vrata nikad ne drži otvorena klinom.
- Kod požara: digni uzbunu (122), upozori ljude i odvedi ih na sigurno, gasi samo ako to ide bez opasnosti.
- Kod požara nikad ne koristi lift.
- Kolica za čišćenje i materijal ne stavljaj ispred aparata za gašenje požara, hidranata ili izlaza u slučaju nužde.
- Kod prijave: Ko prijavljuje? Šta se dogodilo? Koliko je osoba pogođeno? Gdje je? Sačekaj dodatna pitanja. Pritisni javljač požara.
- Povedi sa sobom osobe u opasnosti, zatvori vrata za sobom i idi putevima za evakuaciju.

## Prijavi nesreće i skoro-nesreće
- Odmah prijavi svaku nesreću na poslu, i male povrede i nesreće na putu na posao i s posla.
- Prijavi i skoro-nesreće („to je bilo za dlaku“). Tako sprječavamo sljedeću nesreću.
- Nakon nesreće razgovaramo o tome šta ćemo promijeniti.

## Kod klijenta
- Drži se kućnog reda i pravila na lokaciji (alarm, pristup, prostorije u koje ne smiješ ulaziti).
- Ključevi, kartice i kodovi: samo za posao, nikad ih ne daj drugima, nikad ništa ne piši na njih. Gubitak odmah prijavi.
- Ne čitaj dokumente i ne gledaj u ekrane. Ono što na lokaciji vidiš i čuješ ostaje povjerljivo.
- Pronađene stvari i oštećenja prijavljuješ uredu.

## Vozilo i put do posla
- Službeno vozilo samo s važećom vozačkom dozvolom i nakon odobrenja. Veži pojas, bez telefona za volanom.
- Osiguraj teret (mašine, kanistere) da ne klizi.
- Bez alkohola i bez droga, ni na poslu ni za volanom.
- Prije vožnje provjeri svjetla, žmigavce i stop-svjetla. Vozačku i saobraćajnu dozvolu uvijek imaš kod sebe.
- Ljestve pričvrsti zateznim trakama na krovni nosač.
- Redovno provjeravaj sigurnosni prsluk, sigurnosni trougao i kutiju prve pomoći. Svaku nesreću odmah prijavi.

## Zimska služba, hladnoća i vrućina
- Zimska služba samo nakon obuke (freza za snijeg, kolica za posipanje). Nosi odjeću upozorenja koja se dobro vidi, cipele s dobrim đonom i toplu odjeću.
- Pazi na saobraćaj, i kad je mrak. Prvo očisti i pospi put kojim sam/a ideš.
- Kod vrućine: pij puno vode, pauze u hladu, pokrivalo za glavu i zaštita od sunca.

## Trudnoća, mladi, zdravlje
- Ako si trudna, molimo reci to u uredu što prije. Tada provjeravamo tvoje radno mjesto. Neki poslovi tada nisu dozvoljeni, npr. s određenim sredstvima za čišćenje, na ljestvama ili teško dizanje (Zakon o zaštiti majki, Mutterschutzgesetz).
- Za mlade ispod 18 godina važe posebna pravila. Oni rade samo poslove za koje su odobreni.
- Reci nam ako imaš zdravstvena ograničenja (npr. alergija, leđa), da možemo prilagoditi posao.

## Sigurnosna fascikla (mapa)
- Na lokaciji je sigurnosna fascikla (radne upute, sigurnosni listovi) u spremištu za čišćenje, kod službenih vozila u vozilu.
- Pogledaj u nju prije početka rada, posebno na novoj lokaciji ili kod novog sredstva.

## Pitanja
- Za pitanja o sigurnosti i zdravlju obrati se svojoj predradnici ili svom predradniku ili uredu.
- Posebne opasnosti na pojedinoj lokaciji (npr. laboratorija, kuhinja, proizvodnja) saznaješ na obuci na licu mjesta.`,
    quiz: `? Treba ti kiselo sredstvo za WC i sredstvo s klorom. Šta je ispravno?
+ Nikad ih ne miješam i ne koristim u isto vrijeme, nastaje otrovni plin.
- Miješanje je u redu ako je prozor otvoren.
- Miješanje bolje čisti i štedi vrijeme.

? Gdje nalaziš opasnosti i mjere zaštite za neko sredstvo za čišćenje?
+ Na etiketi, u radnoj uputi i u sigurnosnom listu.
- Samo po mirisu.
- Nigdje, to zna samo dobavljač.

? Smiješ li sredstvo za čišćenje sipati u praznu bocu za piće?
+ Ne, nikad. Samo u pravilno označene boce.
- Da, ako je boca čista.
- Da, ako zapamtim bocu.

? Sredstvo za čišćenje ti je prsnulo u oko. Šta radiš?
+ Odmah ispiram vodom najmanje 10 minuta, zatim idem doktoru.
- Protrljam oko i radim dalje.
- Čekam da vidim hoće li biti bolje.

? Šta radiš prije nego što mokro brišeš hodnik kojim ljudi hodaju?
+ Postavim znak upozorenja „Opasnost od klizanja“ i brišem po mogućnosti samo jednu polovinu poda odjednom.
- Ništa, ljudi već vide mokar pod.
- Brzo brišem, onda se samo osuši.

? Šta je ispravno kod dvokrakih ljestvi?
+ Prije provjerim ljestve, zategnem osigurač protiv razmicanja i ne penjem se na dvije najviše stepenice.
- Stolica je jednako dobra kao ljestve.
- Najviša stepenica je za stajanje.

? Kabl mašine za čišćenje je oštećen. Šta radiš?
+ Ne koristim mašinu, označim je i odmah prijavim.
- Popravim kabl ljepljivom trakom i radim dalje.
- Pažljivo radim dalje i prijavim to na kraju mjeseca.

? U kanti za smeće je korištena šprica. Šta je ispravno?
+ Ne diram je, kliještima ili hvataljkom je stavim u posudu otpornu na ubod i prijavim.
- Izvadim je rukom i bacim u vreću za smeće.
- Rukom sabijem smeće da bude više mjesta.

? Ubo/la si se na korištenu iglu. Šta radiš?
+ Pustim da rana krvari, dezinficiram je, odmah prijavim i odmah idem doktoru.
- Stavim flaster i radim dalje.
- Idem doktoru tek za nekoliko dana, ako boli.

? Koji broj ima Hitna pomoć u Austriji?
+ 144
- 122
- 133

? Na lokaciji je požar. Šta je ispravno?
+ Dignem uzbunu (122), upozorim ljude, gasim samo ako nema opasnosti, nikad ne koristim lift.
- Prvo završim posao.
- Brzo se spustim liftom.

? Lakše si se povrijedio/la ili se zamalo dogodila nesreća. Šta radiš?
+ Odmah prijavim, i male povrede i skoro-nesreće.
- Prijavim samo ako moram u bolnicu.
- Ništa ne kažem, da ne bude problema.

? Šta važi za ključeve, kartice i kodove klijenta?
+ Koristim ih samo za posao, nikad ih ne dajem drugima, gubitak odmah prijavim.
- Smijem ih posuditi kolegicama i kolegama.
- Napišem kod na ključ da ga ne zaboravim.

? Kako pravilno postavljaš naslonjene ljestve?
+ Ugao od 65 do 75 stepeni, osigurane da ne kliznu, 1 metar iznad mjesta gdje prelaziš s ljestvi.
- Što strmije, onda stoje stabilnije.
- Svejedno kako, glavno da je brzo.

? Rastvarač gori. Čime gasiš?
+ Pijeskom ili aparatom za gašenje s prahom, ne vodom.
- S puno vode.
- Mokrom krpom.`,
    decl: 'Potvrđujem: Danas sam dobio/la sigurnosnu obuku, pročitao/la sam je i razumio/la. Imao/la sam priliku postaviti pitanja. Pridržavam se uputa i koristim zaštitnu opremu. Ako nešto ne znam ili se nešto promijeni, pitam.',
  },
  ro: {
    title: 'Instruirea de securitate în muncă: curățenie și întreținerea clădirilor',
    content: `Această instruire este valabilă pentru toate lucrările de curățenie și de întreținere a clădirilor (îngrijirea clădirii, curățarea geamurilor, spațiile exterioare, deszăpezirea). Este obligatorie prin lege (§ 14 din Legea privind protecția angajaților, ASchG): înainte de prima tură și apoi în fiecare an. Timpul pentru instruire este timp de lucru.

Citește fiecare parte fără grabă. La sfârșit răspunzi la câteva întrebări și confirmi cu semnătura ta. Dacă nu înțelegi ceva: te rugăm să întrebi înainte să semnezi.

## Obligațiile și drepturile tale
- Respectă indicațiile primite și instrucțiunile de lucru.
- Folosește echipamentul de protecție pe care îl primești de la noi (mănuși, ochelari de protecție, încălțăminte, vestă reflectorizantă).
- Folosește aparatele, mașinile și produsele doar așa cum ai învățat.
- Anunță imediat defectele, stricăciunile și situațiile periculoase: la șeful sau șefa de echipă, la birou sau prin „Aparat defect?” în „Programul meu”.
- Nu lucra niciodată sub influența alcoolului, a drogurilor sau a medicamentelor care provoacă oboseală.
- Dacă este un pericol grav și imediat, te pui în siguranță și anunți imediat. Pentru asta nimeni nu are voie să te dezavantajeze.

## Produse de curățenie și dezinfectare
- Înainte de lucru, citește eticheta și instrucțiunile de lucru. Simbolurile de pericol (romb roșu) îți arată pericolul.
- Fișele cu date de securitate și instrucțiunile de lucru sunt la birou sau la obiectiv. Întreabă dacă nu le găsești.
- Dozează exact cum scrie (dozator, pahar gradat). Mai mult produs nu curăță mai bine, ci dăunează pielii și materialelor.
- Nu amesteca niciodată produse diferite. Deosebit de periculos: detergentul acid pentru WC și detergentul cu clor, se formează gaz de clor otrăvitor.
- Nu turna niciodată produsele în sticle de băuturi. Doar în sticle și pulverizatoare etichetate corect.
- Când lucrezi cu concentrat, poartă mănuși de protecție și ochelari de protecție.
- Aerisește bine, mai ales în încăperi mici (WC, duș). Pulverizează cât mai puțin, mai bine pe lavetă.
- După lucru, închide recipientele și nu le lăsa niciodată deschise sau nesupravegheate (copii, clienți).
- Pune mai întâi apa, apoi produsul de curățenie.
- Nu pulveriza niciodată spre oameni, nici spre tine. Nu respira ceața pulverizată.
- Acizii periculoși nu îi torni în alte recipiente. Sub canistrele mai mari cu robinet (de exemplu de 10 litri) trebuie pusă o tavă de colectare.
- La obiectiv, depozitează produsele doar în încăperi încuiate și aerisite. În mașină ia doar cantități mici, pentru munca ta (marfă periculoasă).
- Dezinfectare: șterge, nu pulveriza. Dezinfectanții cu alcool iau foc ușor.
- Apa murdară din aspiratorul de apă mai întâi o neutralizezi (pH 7), apoi o arunci la canalizare, așa cum îți arată responsabilul obiectivului.

## Solvenți
- Solvenții iau foc ușor, iar vaporii lor dăunează sănătății (ficat, nervi).
- Nu fuma, fără foc deschis. Aerisește bine și nu respira vaporii.
- Nu stinge niciodată cu apă un solvent care arde, ci cu nisip sau cu un stingător cu pulbere.
- Păstrează solvenții doar în recipiente de metal închise. Resturile și recipientele goale sunt deșeuri periculoase și se duc la punctul de colectare.

## Protejează-ți pielea
- Lucrul cu apă și cu produse de curățenie afectează pielea (lucru în mediu umed). Și purtatul mănușilor mult timp face parte din asta.
- Respectă planul de protecție a pielii: înainte de lucru protejezi pielea, după lucru o speli și o îngrijești.
- Poartă mănuși de protecție potrivite (de exemplu din nitril). Schimbă mănușile umede, iar la lucru de lungă durată poartă dedesubt mănuși din bumbac.
- Anunță din timp dacă pielea se înroșește, te mănâncă sau crapă. Din asta poate apărea o boală profesională.
- Poartă mănuși și la produsele diluate, mai ales la cele alcaline. Întoarce marginea mănușilor în afară, ca să nu curgă nimic înăuntru.

## Primul ajutor la produse de curățenie
- Stropi în ochi: clătește imediat cu apă cel puțin 10 minute, ține ochiul deschis în timp ce clătești, apoi mergi la medic.
- Pe piele: scoate hainele pe care a ajuns produsul, clătește cu multă apă.
- Dacă produsul a fost înghițit: clătește gura, nu provoca vomă, sună la Centrul de informare toxicologică (01 406 43 43), iar dacă apar probleme de sănătate, sună la ambulanță 144.
- Ia cu tine la medic eticheta sau fișa cu date de securitate.

## Alunecare, împiedicare, cădere
- Poartă încălțăminte închisă, antiderapantă.
- Când ștergi pe jos cu mopul ud, pune semnul de avertizare „Pericol de alunecare”. Unde trec oameni, șterge pe cât posibil doar o jumătate din lățime.
- Pune cablurile și furtunurile așa încât nimeni să nu se împiedice de ele. Ține culoarele și scările libere.
- Pe scări mergi încet și ține-te de balustradă. Nu căra nimic care îți acoperă vederea.
- Ai grijă să fie lumină bună. Anunță dacă iluminatul este defect.
- Șterge cu lavete care nu sunt prea ude.
- Încălțămintea ta trebuie să aibă talpă antiderapantă și o curea la călcâi. Pe scară porți încălțăminte fără toc, închisă la călcâi.

## Scări portabile și lucrul la înălțime
- Folosește doar scări și scăunele cu trepte care sunt în stare bună. Verifică-le înainte de fiecare folosire (trepte, picioare, siguranța de deschidere).
- Nu te urca niciodată pe scaune, mese, găleți sau calorifere.
- Pune scara pe o suprafață fermă și dreaptă. La scara dublă, fixează siguranța de deschidere.
- La scara dublă nu urca pe cele două trepte de sus. Nu te apleca în lateral.
- Pentru geamuri înalte folosește, unde se poate, tije telescopice în loc de scară.
- Geamuri pe exterior, platforme de ridicare, lucru pe acoperiș sau cu pericol de cădere de la înălțime: doar cu instruire specială, asigurare împotriva căderii și aprobarea șefilor.
- Nu te apleca niciodată în afara ferestrei și nu te urca pe pervaz.
- Scara rezemată: unghi de 65 până la 75 de grade, asigur-o să nu alunece, trebuie să fie cu cel puțin 1 metru mai sus decât locul unde ieși de pe ea. Stai cu ambele picioare pe trepte.
- Nu sprijini scara dublă când este închisă. Pe scările clădirii folosește doar scări cu picioare care se pot prelungi.
- Hamul de siguranță doar după instruire și doar prins în punctele stabilite. Verifică-l înainte de fiecare folosire. După o cădere nu mai ai voie să-l folosești.

## Aparate și mașini
- Folosește mașinile (de exemplu mașina de spălat pardoseli, mașina monodisc, aparatul de spălat cu presiune, suflanta de frunze, mașina de tuns iarba) doar după instruire.
- Înainte de lucru, uită-te la cablu, ștecăr și aparat. Este deteriorat? Nu-l folosi, marchează-l și anunță imediat.
- Scoate ștecărul din priză înainte să schimbi perii, pad-uri sau saci ori să cureți aparatul.
- Nu atinge niciodată ștecărul și întrerupătorul cu mâinile ude. Nu trece cu mașina peste cablu.
- Nu repara tu nimic, nu improviza cu bandă adezivă.
- Poartă protecție pentru auz și ochelari de protecție, dacă instrucțiunile de lucru cer asta (de exemplu suflanta de frunze, foarfeca pentru gard viu).
- Montează suportul pentru pad-uri și periile doar cu ștecărul scos din priză.
- Ține cablul mereu în spatele mașinii, peste mână sau peste umăr. Nu-l lăsa să fie prins (de exemplu în ușile automate). Înfășoară-l fără să-l strângi tare și verifică atunci dacă este deteriorat.
- În pauze scoate cheia din mașină.

## Ridicare și cărat
- Ridică cu spatele drept, din genunchi, ține greutatea aproape de corp și nu te răsuci cu greutatea în mâini.
- Folosește cărucioare, role și alte ajutoare pentru transport. Împarte greutățile mari sau cere ajutor.
- Nu ridica găleți pline și saci de gunoi mai sus de cap și ține sacii de gunoi departe de corp.

## Pericol de infecție, ace și cioburi
- La curățenia grupurilor sanitare și când lucrezi cu gunoiul, poartă mereu mănuși de protecție.
- Nu băga niciodată mâna în sacii de gunoi și în coșurile de hârtii și nu îndesa gunoiul cu mâna.
- Seringi sau ace folosite: nu le atinge. Pune-le cu un clește sau cu un apucător într-un recipient rezistent la înțepare, apoi anunță.
- Te-ai înțepat cu un ac folosit sau te-ai tăiat cu cioburi murdare: lasă rana să sângereze, dezinfecteaz-o, anunță imediat și mergi direct la medic (cel mai bine în cel mult 2 ore).
- Spală-te și dezinfectează-te pe mâini înainte să mănânci, să bei sau să fumezi și după lucru.
- Nu mânca și nu bea în grupurile sanitare.
- Folosește lavetele după culori (de exemplu roșu doar pentru WC și pisoar), ca să nu duci microbii dintr-un loc în altul.
- În centrele de îngrijire și în cabinetele medicale: fără bijuterii și fără ceas, unghii scurte, părul lung legat. Mănuși și șorț de unică folosință, unde se cere.
- Dezinfectează-ți mâinile înainte și după tură, după lucrări murdare și după ce mergi la WC.
- Transportă sacii de gunoi cu căruciorul, nu în mână.
- Întreabă de vaccinul împotriva hepatitei B. Serviciul de medicina muncii te sfătuiește.

## Lucrul singur, devreme și târziu
- Ia telefonul cu tine, încărcat. Salvează numerele de urgență și numărul biroului.
- Nu lăsa persoane străine să intre în clădire. Ține ușile închise, așa cum cere clientul.
- La amenințări sau violență: pune-te în siguranță, sună la poliție 133, apoi la birou.
- Lucrările periculoase (de exemplu pe o scară înaltă, cu mașini în încăperi izolate) nu le faci singur, dacă instrucțiunile de lucru cer asta.

## Urgențe și prim ajutor
- Numere de urgență: ambulanța 144, pompierii 122, poliția 133, numărul european de urgență 112, Centrul de informare toxicologică 01 406 43 43.
- Când suni la urgență, spune: Unde este (adresa, scara, etajul)? Ce s-a întâmplat? Câți răniți sunt? Așteaptă, poate au întrebări.
- Știi unde sunt la obiectiv trusa de prim ajutor, stingătoarele și ieșirile de urgență? Dacă nu: întreabă la prima tură.
- Dă primul ajutor cât de bine poți. Siguranța ta este pe primul loc.

## Incendiu și căi de evacuare
- Ține libere căile de evacuare, ieșirile de urgență și ușile antifoc. Nu propti niciodată ușile antifoc ca să rămână deschise.
- Dacă este incendiu: dă alarma (122), avertizează oamenii și du-i în siguranță, stinge focul doar dacă se poate fără pericol.
- La incendiu nu folosi niciodată liftul.
- Nu pune căruciorul de curățenie și materialele în fața stingătoarelor, hidranților sau ieșirilor de urgență.
- Când anunți: Cine anunță? Ce s-a întâmplat? Câte persoane sunt afectate? Unde este? Așteaptă, poate au întrebări. Apasă butonul de alarmă la incendiu.
- Ia cu tine persoanele în pericol, închide ușile în urma ta și urmează căile de evacuare.

## Anunță accidentele și aproape-accidentele
- Anunță imediat orice accident de muncă, și rănile mici și accidentele pe drumul spre muncă sau de la muncă.
- Anunță și aproape-accidentele („a fost cât pe ce”). Așa prevenim următorul accident.
- După un accident discutăm ce schimbăm.

## La client
- Respectă regulamentul clădirii și regulile de la obiectiv (sistemul de alarmă, accesul, zonele în care nu ai voie să intri).
- Chei, carduri și coduri: doar pentru muncă, nu le da niciodată mai departe, nu scrie niciodată nimic pe ele. Dacă le pierzi, anunță imediat.
- Nu citi documente și nu te uita la ecrane. Ce vezi și auzi la obiectiv rămâne confidențial.
- Obiectele găsite și stricăciunile le anunți la birou.

## Vehiculul și drumul la muncă
- Vehiculul firmei: doar cu permis de conducere valabil și după aprobare. Pune-ți centura, nu folosi telefonul la volan.
- Asigură încărcătura (mașini de curățenie, canistre) ca să nu alunece.
- Fără alcool și fără droguri, nici la muncă, nici la volan.
- Înainte de drum verifică luminile, semnalizatoarele și stopurile. Ai mereu la tine permisul de conducere și certificatul de înmatriculare.
- Prinde scările pe portbagajul de pe acoperiș cu chingi de fixare.
- Verifică regulat vesta reflectorizantă, triunghiul reflectorizant și trusa de prim ajutor. Anunță imediat orice accident.

## Deszăpezire, frig și căldură
- Deszăpezire doar după instruire (freză de zăpadă, cărucior pentru presărat). Poartă haine reflectorizante, încălțăminte cu talpă bună, care nu alunecă, și haine calde.
- Ai grijă la trafic, și pe întuneric. Curăță și presară mai întâi drumul pe care mergi tu.
- Când e foarte cald: bea multă apă, fă pauze la umbră, poartă ceva pe cap și folosește protecție solară.

## Sarcină, tineri, sănătate
- Dacă ești însărcinată, te rugăm să spui la birou cât mai devreme. Atunci verificăm locul tău de muncă. Unele lucrări nu sunt permise atunci, de exemplu cu anumite produse de curățenie, lucrul pe scară sau ridicarea de greutăți mari (Legea privind protecția maternității).
- Pentru tinerii sub 18 ani sunt reguli speciale. Ei fac doar lucrările pentru care au aprobare.
- Spune-ne dacă ai probleme de sănătate care te limitează (de exemplu alergie, spate), ca să putem adapta munca.

## Dosarul de securitate
- La obiectiv, dosarul de securitate (instrucțiunile de lucru, fișele cu date de securitate) este în debaraua de curățenie, iar la vehiculele firmei este în vehicul.
- Uită-te în el înainte să începi lucrul, mai ales la un obiectiv nou sau la un produs nou.

## Întrebări
- Dacă ai întrebări despre securitate și sănătate, adresează-te șefei sau șefului de echipă ori biroului.
- Despre pericolele speciale de la fiecare obiectiv (de exemplu laborator, bucătărie, producție) afli la instruirea la fața locului.`,
    quiz: `? Ai nevoie de un detergent acid pentru WC și de un detergent cu clor. Ce este corect?
+ Nu le amestec niciodată și nu le folosesc în același timp, se formează gaz otrăvitor.
- Le pot amesteca dacă fereastra este deschisă.
- Dacă le amestec, curăță mai bine și economisesc timp.

? Unde găsești pericolele și măsurile de protecție pentru un produs de curățenie?
+ Pe etichetă, în instrucțiunile de lucru și în fișa cu date de securitate.
- Doar după miros.
- Nicăieri, asta știe doar furnizorul.

? Ai voie să torni produs de curățenie într-o sticlă goală de băutură?
+ Nu, niciodată. Doar în sticle etichetate corect.
- Da, dacă sticla este curată.
- Da, dacă țin minte care este sticla.

? Ți-a sărit produs de curățenie în ochi. Ce faci?
+ Clătesc imediat cu apă cel puțin 10 minute, apoi merg la medic.
- Mă frec la ochi și lucrez mai departe.
- Aștept să văd dacă trece.

? Ce faci înainte să ștergi cu mopul ud un culoar pe unde trec oameni?
+ Pun semnul de avertizare „Pericol de alunecare” și, pe cât posibil, șterg doar o jumătate din lățime.
- Nimic, oamenii văd oricum că podeaua este udă.
- Șterg repede, apoi se usucă singură.

? Ce este corect la scara dublă?
+ O verific înainte, fixez siguranța de deschidere, nu urc pe cele două trepte de sus.
- Un scaun este la fel de bun ca o scară.
- Treapta de sus este făcută ca să stai pe ea.

? Cablul mașinii de curățenie este deteriorat. Ce faci?
+ Nu folosesc mașina, o marchez și anunț imediat.
- Repar cablul cu bandă adezivă și lucrez mai departe.
- Lucrez mai departe cu grijă și anunț la sfârșitul lunii.

? În coșul de gunoi este o seringă folosită. Ce este corect?
+ Nu o ating, o pun cu un clește sau cu un apucător într-un recipient rezistent la înțepare și anunț.
- O scot cu mâna și o arunc în sacul de gunoi.
- Îndes gunoiul cu mâna, ca să fie mai mult loc.

? Te-ai înțepat cu un ac folosit. Ce faci?
+ Las rana să sângereze, o dezinfectez, anunț imediat și merg direct la medic.
- Pun un plasture și lucrez mai departe.
- Merg la medic abia peste câteva zile, dacă mă doare.

? Ce număr are ambulanța în Austria?
+ 144
- 122
- 133

? La obiectiv este un incendiu. Ce este corect?
+ Dau alarma (122), avertizez oamenii, sting focul doar fără pericol, nu folosesc niciodată liftul.
- Mai întâi îmi termin lucrul.
- Cobor repede cu liftul.

? Te-ai rănit ușor sau aproape s-a întâmplat un accident. Ce faci?
+ Anunț imediat, și rănile mici și aproape-accidentele.
- Anunț doar dacă trebuie să merg la spital.
- Nu spun nimic, ca să nu am probleme.

? Ce reguli sunt pentru cheile, cardurile și codurile clientului?
+ Le folosesc doar pentru muncă, nu le dau niciodată mai departe, dacă le pierd anunț imediat.
- Am voie să le împrumut colegelor și colegilor.
- Scriu codul pe cheie, ca să nu-l uit.

? Cum pui corect o scară rezemată?
+ La un unghi de 65 până la 75 de grade, asigurată să nu alunece, cu 1 metru mai sus decât locul unde ies de pe ea.
- Cât mai dreaptă, așa stă mai stabil.
- Nu contează cum, important e să fie repede.

? Arde un solvent. Cu ce stingi focul?
+ Cu nisip sau cu un stingător cu pulbere, nu cu apă.
- Cu multă apă.
- Cu o lavetă udă.`,
    decl: 'Confirm: am primit azi instruirea de securitate în muncă, am citit-o și am înțeles-o. Am avut posibilitatea să pun întrebări. Respect indicațiile și folosesc echipamentul de protecție. Dacă nu știu ceva sau dacă se schimbă ceva, întreb.',
  },
  tr: {
    title: 'Bina temizliği ve tesis hizmetleri için güvenlik eğitimi',
    content: `Bu eğitim, bina temizliği ve tesis hizmetlerindeki tüm işler için geçerlidir (kapıcılık, cam temizliği, dış alanlar, kış hizmeti). Yasal olarak zorunludur (§ 14 Çalışanları Koruma Kanunu, ASchG): ilk vardiyandan önce ve sonra her yıl. Eğitim için harcadığın süre çalışma süresidir.

Her bölümü acele etmeden oku. Sonunda birkaç soruyu cevaplarsın ve imzanla onaylarsın. Bir şeyi anlamazsan: Lütfen imzalamadan önce sor.

## Görevlerin ve hakların
- Talimatlara ve çalışma talimatlarına uy.
- Bizden aldığın koruyucu ekipmanı kullan (eldiven, koruyucu gözlük, ayakkabı, reflektörlü yelek).
- Cihazları, makineleri ve temizlik maddelerini sadece öğrendiğin gibi kullan.
- Eksikleri, hasarları ve tehlikeli durumları hemen bildir: ekip şefine, büroya ya da Çalışma planım sayfasında “Cihaz bozuk mu?” ile.
- Alkol, uyuşturucu veya uyku yapan ilaçların etkisi altında asla çalışma.
- Ciddi ve yakın bir tehlike varsa kendini güvenli bir yere götür ve hemen bildir. Bunun için kimse seni cezalandıramaz.

## Temizlik maddeleri ve dezenfeksiyon
- İşe başlamadan önce etiketi ve çalışma talimatını oku. Tehlike işaretleri (kırmızı baklava şekli) sana tehlikeyi gösterir.
- Güvenlik bilgi formları ve çalışma talimatları büroda veya iş yerinde bulunur. Bulamazsan sor.
- Miktarı tam olarak talimata göre ayarla (dozaj aleti, ölçü kabı). Daha fazla madde daha iyi temizlemez, cilde ve malzemeye zarar verir.
- Farklı maddeleri asla karıştırma. Özellikle tehlikeli: asitli tuvalet temizleyicisi ve klorlu temizleyici, zehirli klor gazı oluşur.
- Temizlik maddelerini asla içecek şişelerine koyma. Sadece doğru etiketlenmiş şişelere ve sprey şişelerine koy.
- Konsantre madde kullanırken koruyucu eldiven ve koruyucu gözlük tak.
- İyi havalandır, özellikle küçük odalarda (tuvalet, duş). Mümkün olduğunca az sprey sık, en iyisi beze sık.
- İşten sonra kapları kapat. Kapları asla açık veya gözetimsiz bırakma (çocuklar, müşteri).
- Önce suyu koy, sonra temizlik maddesini ekle.
- Asla insanlara doğru sprey sıkma, kendine doğru da sıkma. Sprey bulutunu soluma.
- Tehlikeli asitleri başka bir kaba aktarma. Musluklu büyük bidonların (örneğin 10 litre) altında bir toplama kabı olmalı.
- Temizlik maddelerini iş yerinde sadece kilitli ve havalandırılan odalarda sakla. Arabaya sadece kendi işin için az miktar al (tehlikeli yük).
- Dezenfeksiyon: sprey sıkmak yerine sil. Alkollü dezenfektanlar kolay yanar.
- Islak süpürgedeki kirli suyu önce nötrleştir (pH 7), sonra iş yeri sorumlusunun sana gösterdiği gibi kanalizasyona dök.

## Çözücüler (solventler)
- Çözücüler kolay yanar ve buharları sağlığa zarar verir (karaciğer, sinirler).
- Sigara içme, açık ateş olmasın. İyi havalandır ve buharları soluma.
- Yanan çözücüyü asla suyla söndürme, kumla veya kuru tozlu yangın söndürücüyle söndür.
- Çözücüleri sadece kapalı metal kaplarda sakla. Artıklar ve boş kaplar tehlikeli atıktır ve toplama noktasına götürülür.

## Cildini koru
- Su ve temizlik maddeleriyle çalışmak cildi yıpratır (ıslak iş). Uzun süre eldiven takmak da buna dahildir.
- Cilt koruma planına uy: işten önce cildini koru, işten sonra temizle ve bakımını yap.
- Uygun koruyucu eldiven tak (örneğin nitril). Nemli eldivenleri değiştir, uzun işlerde altına pamuklu eldiven giy.
- Ciltte kızarıklık, kaşıntı veya çatlak varsa erken bildir. Bundan meslek hastalığı olabilir.
- Seyreltilmiş maddelerde de eldiven tak, özellikle alkali (kostik) maddelerde. İçine bir şey akmasın diye eldivenin ağzını dışa doğru kıvır.

## Temizlik maddelerinde ilk yardım
- Göze sıçrarsa: hemen en az 10 dakika suyla yıka, bu sırada gözü açık tut, sonra doktora git.
- Cilde bulaşırsa: kirlenen giysileri çıkar, bol suyla yıka.
- Yutulursa: ağzı çalkala, kusturmaya çalışma, Zehir Danışma Merkezini ara (01 406 43 43), rahatsızlık varsa ambulans 144.
- Etiketi veya güvenlik bilgi formunu doktora götür.

## Kayma, takılma, düşme
- Kapalı ve kaymaz ayakkabı giy.
- Islak silerken “Kaygan zemin” uyarı levhasını koy. İnsanların yürüdüğü yerde mümkünse zeminin önce bir yarısını, sonra diğer yarısını sil.
- Kabloları ve hortumları kimse takılmayacak şekilde yerleştir. Koridorları ve merdivenleri boş tut.
- Merdivenlerde yavaş yürü ve tırabzana tutun. Önünü görmeni engelleyen şeyler taşıma.
- İyi ışık olmasına dikkat et. Bozuk lambaları bildir.
- Çok ıslak olmayan bezlerle sil.
- Ayakkabının tabanı kaymaz olmalı ve topukta bir kayışı olmalı. Seyyar merdivende topuğu saran düz ayakkabı giy.

## Seyyar merdivenler ve yüksekte çalışma
- Sadece sağlam seyyar merdivenler ve basamaklı tabureler kullan. Her kullanımdan önce kontrol et (basamaklar, ayaklar, açılma emniyeti).
- Asla sandalyeye, masaya, kovaya veya kaloriferin üstüne çıkma.
- Merdiveni sağlam ve düz bir zemine koy. A tipi merdivende açılma emniyetini gergin hale getir.
- A tipi merdivende en üstteki iki basamağa çıkma. Yana doğru sarkma.
- Yüksek camlar için mümkünse merdiven yerine teleskopik sap kullan.
- Dış cam, yükseltici platformlar, çatıda çalışma veya düşme tehlikesi olan işler: sadece özel eğitimle, düşme emniyetiyle ve amirlerinin onayıyla.
- Pencereden asla dışarı sarkma ve pencere pervazına çıkma.
- Dayama merdiven: açı 65 ile 75 derece arasında olsun, kaymaya karşı sabitle, merdiven indiğin yerden en az 1 metre yukarı uzansın. İki ayağınla basamakların üstünde dur.
- A tipi merdiveni kapalıyken bir yere dayama. Bina merdivenlerinde sadece ayak uzatması olan seyyar merdiven kullan.
- Paraşüt tipi emniyet kemerini sadece eğitimden sonra ve sadece belirlenen bağlantı noktalarında kullan. Her kullanımdan önce kontrol et. Bir düşmeden sonra artık kullanılmamalı.

## Cihazlar ve makineler
- Makineleri (örneğin zemin yıkama makinesi, tek diskli makine, basınçlı yıkama makinesi, yaprak üfleme makinesi, çim biçme makinesi) ancak eğitimden sonra kullan.
- İşe başlamadan önce kabloya, fişe ve cihaza bak. Hasarlı mı? Kullanma, işaretle ve hemen bildir.
- Fırçaları, pedleri veya torbaları değiştirmeden ya da cihazı temizlemeden önce fişi çek.
- Fişe ve düğmelere asla ıslak elle dokunma. Makineyle kablonun üstünden geçme.
- Hiçbir şeyi kendin tamir etme, bantla geçici çözüm yapma.
- Çalışma talimatı istiyorsa kulak koruyucu ve koruyucu gözlük tak (örneğin yaprak üfleme makinesi, çit budama makası).
- Ped tutucu tablayı ve fırçaları sadece fiş çekiliyken tak.
- Kabloyu her zaman makinenin arkasında, elinin veya omzunun üstünden geçirerek tut. Kabloyu sıkıştırma (örneğin otomatik kapılarda). Kabloyu gevşek sar ve sararken hasarlı olup olmadığına bak.
- Molalarda makinenin anahtarını çıkar.

## Kaldırma ve taşıma
- Yükü sırtın düz şekilde, dizlerini bükerek kaldır. Yükü vücuduna yakın tut ve yük elindeyken gövdeni döndürme.
- Taşıma arabası, tekerlekli altlık ve başka taşıma araçları kullan. Ağır yükleri böl veya yardım iste.
- Dolu kovaları ve çöp torbalarını baş hizasının üstüne kaldırma. Çöp torbalarını vücudundan uzak tut.

## Enfeksiyon tehlikesi, iğneler ve cam kırıkları
- Tuvalet ve banyo temizliğinde ve çöple çalışırken her zaman koruyucu eldiven tak.
- Çöp torbalarına ve kağıt sepetlerine asla elini sokma ve çöpü elinle bastırma.
- Kullanılmış şırınga veya iğne: dokunma. Pense veya maşa ile delinmez bir kaba koy, sonra bildir.
- Kullanılmış bir iğne veya kirli cam kırığı battı ya da seni kesti: yaranın kanamasına izin ver, dezenfekte et, hemen bildir ve hemen doktora git (en iyisi 2 saat içinde).
- Yemekten, içmekten ve sigara içmekten önce ve işten sonra ellerini yıka ve dezenfekte et.
- Tuvalet ve banyolarda yemek yeme ve bir şey içme.
- Bezleri renklerine göre kullan (örneğin kırmızı sadece tuvalet ve pisuar için), böylece mikroplar başka yere taşınmaz.
- Bakım evlerinde ve muayenehanelerde: takı ve saat takma, tırnakların kısa olsun, uzun saçlarını bağla. İstenen yerlerde tek kullanımlık eldiven ve tek kullanımlık önlük kullan.
- Ellerini işe başlamadan önce ve iş bittikten sonra, kirli işlerden sonra ve tuvaletten sonra dezenfekte et.
- Çöp torbalarını elde değil, arabada taşı.
- Hepatit B aşısını sor. İş yeri hekimi sana bilgi verir.

## Yalnız çalışma, sabah erken ve akşam geç
- Telefonun şarjlı olsun ve yanında olsun. Acil numaraları ve büronun numarasını kaydet.
- Yabancıları binaya alma. Kapıları müşterinin istediği gibi kapalı tut.
- Tehdit veya şiddet olursa: kendini güvenli bir yere götür, polisi ara (133), sonra büroyu ara.
- Çalışma talimatı istiyorsa tehlikeli işleri (örneğin yüksek merdiven, uzak odalarda makineler) yalnız yapma.

## Acil durum ve ilk yardım
- Acil numaralar: ambulans 144, itfaiye 122, polis 133, Avrupa acil numarası 112, zehir danışma 01 406 43 43.
- Acil aramada söyle: Nerede (adres, merdiven, kat)? Ne oldu? Kaç yaralı var? Soruları bekle.
- İş yerinde ilk yardım çantası, yangın söndürücü ve acil çıkışlar nerede, biliyor musun? Bilmiyorsan: ilk vardiyanda sor.
- Elinden geldiği kadar ilk yardım yap. Kendi güvenliğin önce gelir.

## Yangın ve kaçış yolları
- Kaçış yollarını, acil çıkışları ve yangın kapılarını boş tut. Yangın kapılarını asla takozla açık tutma.
- Yangın olursa: alarm ver (122), insanları uyar ve güvenli bir yere götür, sadece tehlike yoksa söndür.
- Yangın olursa asla asansöre binme.
- Temizlik arabasını ve malzemeyi yangın söndürücülerin, yangın hidrantlarının veya acil çıkışların önüne koyma.
- Haber verirken: Kim haber veriyor? Ne oldu? Kaç kişi etkilendi? Nerede? Soruları bekle. Yangın ihbar butonuna bas.
- Tehlikedeki kişileri yanına al, arkandan kapıları kapat ve kaçış yollarını takip et.

## Kazaları ve ramak kala olayları bildir
- Her iş kazasını hemen bildir, küçük yaralanmaları ve işe giderken ya da işten dönerken olan kazaları da.
- Ramak kala olayları da bildir (“az kalsın kaza oluyordu”). Böylece bir sonraki kazayı önleriz.
- Bir kazadan sonra neyi değiştireceğimizi konuşuruz.

## Müşterinin yerinde
- Bina kurallarına ve iş yerindeki kurallara uy (alarm sistemi, giriş, girmemen gereken alanlar).
- Anahtarlar, kartlar ve kodlar: sadece iş için, asla başkasına verme, üzerine asla bir şey yazma. Kaybolursa hemen bildir.
- Belgeleri okuma ve ekranlara bakma. İş yerinde gördüğün ve duyduğun şeyler gizli kalır.
- Bulduğun eşyaları ve hasarları büroya bildir.

## Araç ve iş yolu
- Şirket aracını sadece geçerli ehliyetle ve izin aldıktan sonra kullan. Emniyet kemerini tak, direksiyondayken telefon kullanma.
- Yükü (makineler, bidonlar) kaymaya karşı sabitle.
- Alkol ve uyuşturucu yok: ne işte ne de direksiyonda.
- Yola çıkmadan önce farları, sinyalleri ve fren lambasını kontrol et. Ehliyetin ve araç ruhsatın her zaman yanında olsun.
- Seyyar merdivenleri gergi kayışlarıyla port bagaja bağla.
- Reflektörlü yeleği, ikaz üçgenini ve ilk yardım çantasını düzenli kontrol et. Her kazayı hemen bildir.

## Kış hizmeti, soğuk ve sıcak
- Kış hizmeti sadece eğitimden sonra (kar küreme makinesi, serpme arabası). Reflektörlü giysi, tabanı iyi tutan ayakkabı ve sıcak giysiler giy.
- Trafiğe dikkat et, karanlıkta da. Önce kendi yürüdüğün yolu temizle ve serp.
- Sıcakta: bol su iç, gölgede mola ver, şapka tak ve güneşten korun.

## Hamilelik, gençler, sağlık
- Hamileysen lütfen bunu büroya mümkün olduğunca erken söyle. O zaman işini ve çalışma yerini kontrol ederiz. O zaman bazı işler yasaktır, örneğin belirli temizlik maddeleriyle çalışmak, merdivende çalışmak veya ağır kaldırmak (Annelik Koruma Kanunu).
- 18 yaşından küçük gençler için özel kurallar geçerlidir. Sadece izin verilen işleri yaparlar.
- Sağlık sorunun varsa (örneğin alerji, sırt) bize söyle, böylece işi sana göre ayarlayabiliriz.

## Güvenlik dosyası
- İş yerinde güvenlik dosyası (çalışma talimatları, güvenlik bilgi formları) temizlik malzemesi odasında, şirket araçlarında ise aracın içinde bulunur.
- İşe başlamadan önce dosyaya bak, özellikle yeni bir iş yerinde veya yeni bir temizlik maddesi kullanırken.

## Sorular
- Güvenlik ve sağlıkla ilgili soruların için ekip şefine veya büroya başvur.
- Her iş yerinin özel tehlikelerini (örneğin laboratuvar, mutfak, üretim) iş yerindeki eğitimde öğrenirsin.`,
    quiz: `? Asitli bir tuvalet temizleyicisine ve klorlu bir temizleyiciye ihtiyacın var. Hangisi doğru?
+ Asla karıştırma ve asla aynı anda kullanma, zehirli gaz oluşur.
- Pencere açıksa karıştırmak sorun değil.
- Karıştırmak daha iyi temizler ve zaman kazandırır.

? Bir temizlik maddesinin tehlikelerini ve koruma önlemlerini nerede bulursun?
+ Etikette, çalışma talimatında ve güvenlik bilgi formunda.
- Sadece kokusundan.
- Hiçbir yerde, bunu sadece tedarikçi bilir.

? Temizlik maddesini boş bir içecek şişesine koyabilir misin?
+ Hayır, asla. Sadece doğru etiketlenmiş şişelere.
- Evet, şişe temizse.
- Evet, şişeyi aklımda tutarsam.

? Gözüne temizlik maddesi sıçradı. Ne yaparsın?
+ Hemen en az 10 dakika suyla yıka, sonra doktora git.
- Gözünü ovala ve çalışmaya devam et.
- Bekle ve geçip geçmediğine bak.

? İnsanların yürüdüğü bir koridoru ıslak silmeden önce ne yaparsın?
+ “Kaygan zemin” uyarı levhasını koy ve mümkünse zeminin önce bir yarısını, sonra diğer yarısını sil.
- Hiçbir şey, insanlar ıslak zemini zaten görür.
- Hızlı sil, sonra kendiliğinden kurur.

? A tipi merdivende hangisi doğru?
+ Önce kontrol et, açılma emniyetini gergin hale getir, en üstteki iki basamağa çıkma.
- Sandalye de merdiven kadar iyidir.
- En üstteki basamak, üstünde durmak içindir.

? Temizlik makinesinin kablosu hasarlı. Ne yaparsın?
+ Kullanma, işaretle ve hemen bildir.
- Bantla tamir et ve çalışmaya devam et.
- Dikkatli çalışmaya devam et ve ay sonunda bildir.

? Çöp kutusunda kullanılmış bir şırınga var. Hangisi doğru?
+ Dokunma, pense veya maşa ile delinmez bir kaba koy ve bildir.
- Elinle çıkar ve çöp torbasına at.
- Daha fazla yer olsun diye çöpü elinle bastır.

? Kullanılmış bir iğne sana battı. Ne yaparsın?
+ Yaranın kanamasına izin ver, dezenfekte et, hemen bildir ve hemen doktora git.
- Yara bandı yapıştır ve çalışmaya devam et.
- Birkaç gün bekle, acırsa doktora git.

? Avusturya’da ambulansın numarası kaç?
+ 144
- 122
- 133

? İş yerinde yangın var. Hangisi doğru?
+ Alarm ver (122), insanları uyar, sadece tehlike yoksa söndür, asla asansöre binme.
- Önce işini bitir.
- Asansörle hızlıca aşağı in.

? Hafif yaralandın ya da az kalsın kaza oluyordu. Ne yaparsın?
+ Hemen bildiririm, küçük yaralanmaları ve ramak kala olayları da.
- Sadece hastaneye gitmem gerekirse bildiririm.
- Sorun çıkmasın diye hiçbir şey söylemem.

? Müşterinin anahtarları, kartları ve kodları için hangi kural geçerli?
+ Sadece iş için kullan, asla başkasına verme, kaybolursa hemen bildir.
- Onları iş arkadaşlarıma ödünç verebilirim.
- Unutmamak için kodu anahtarın üstüne yazarım.

? Dayama merdiveni nasıl doğru kurarsın?
+ Açı 65 ile 75 derece arasında, kaymaya karşı sabitlenmiş, indiğin yerden 1 metre yukarı uzanıyor.
- Mümkün olduğunca dik, o zaman daha sağlam durur.
- Nasıl olursa olsun, yeter ki hızlı olsun.

? Çözücü yanıyor. Neyle söndürürsün?
+ Kumla veya kuru tozlu yangın söndürücüyle, suyla değil.
- Bol suyla.
- Islak bir bezle.`,
    decl: 'Onaylıyorum: Güvenlik eğitimini bugün aldım, okudum ve anladım. Soru sorma imkânım oldu. Talimatlara uyarım ve koruyucu ekipmanı kullanırım. Bir şeyi bilmezsem veya bir şey değişirse sorarım.',
  },
  hu: {
    title: 'Munkavédelmi oktatás: épülettakarítás és létesítménygondnokság',
    content: `Ez az oktatás minden munkára vonatkozik az épülettakarításban és a létesítménygondnokságban (házgondnokság, üvegtisztítás, külső területek, téli szolgálat). A törvény előírja (§ 14 munkavédelmi törvény, ASchG): az első műszak előtt, és utána minden évben. Az erre szánt idő munkaidő.

Olvass el nyugodtan minden részt. A végén válaszolsz néhány kérdésre, és az aláírásoddal megerősíted. Ha valamit nem értesz: kérjük, kérdezz, mielőtt aláírsz.

## Kötelességeid és jogaid
- Tartsd be az utasításokat és az üzemi utasításokat.
- Használd a védőfelszerelést, amit tőlünk kapsz (kesztyű, védőszemüveg, cipő, láthatósági mellény).
- Az eszközöket, gépeket és szereket csak úgy használd, ahogy tanultad.
- Hibát, kárt és veszélyes helyzetet azonnal jelents: a csoportvezetőnek, az irodának, vagy a Beosztásom oldalon az „Elromlott egy gép?” résznél.
- Soha ne dolgozz alkohol, drog vagy álmosító gyógyszer hatása alatt.
- Komoly és közvetlen veszélynél menj biztonságba, és azonnal jelentsd. Ezért nem érhet hátrány.

## Tisztítószerek és fertőtlenítés
- Munka előtt olvasd el a címkét és az üzemi utasítást. A veszélyjelek (piros rombusz) mutatják a veszélyt.
- A biztonsági adatlapok és az üzemi utasítások az irodában vagy az objektumban vannak. Kérdezz, ha nem találod őket.
- Pontosan az előírás szerint adagolj (adagoló, mérőpohár). Több szer nem tisztít jobban, de árt a bőrnek és az anyagoknak.
- Soha ne keverj össze különböző szereket. Különösen veszélyes: savas WC-tisztító és klóros tisztító, ebből mérgező klórgáz lesz.
- Soha ne tölts szert italos palackba. Csak jól feliratozott flakonba és szórófejes flakonba.
- Tömény szernél (koncentrátum) viselj védőkesztyűt és védőszemüveget.
- Szellőztess jól, főleg kis helyiségekben (WC, zuhanyzó). Permetezz minél kevesebbet, inkább a törlőkendőre.
- Munka után zárd le a tartályokat, és soha ne hagyd őket nyitva vagy felügyelet nélkül (gyerekek, ügyfelek).
- Először a vizet, aztán a tisztítószert.
- Soha ne permetezz emberek felé, és magad felé se. Ne lélegezd be a permetet.
- Veszélyes savakat ne tölts át. A nagyobb, csapos kannák (pl. 10 liter) alá gyűjtőtálca kell.
- Az objektumban a szereket csak bezárt, szellőző helyiségben tárold. Autóban csak kis mennyiséget vigyél, a saját munkádhoz (veszélyes áru).
- Fertőtlenítés: törölj, ne permetezz. Az alkoholos fertőtlenítőszer könnyen meggyullad.
- A vízszívóból származó szennyvizet először semlegesítsd (pH 7), aztán öntsd a csatornába, ahogy az objektumvezető megmutatja.

## Oldószerek
- Az oldószerek könnyen meggyulladnak, és a gőzük árt az egészségnek (máj, idegek).
- Ne dohányozz, nyílt láng tilos. Szellőztess jól, és ne lélegezd be a gőzöket.
- Égő oldószert soha ne olts vízzel, hanem homokkal vagy poroltóval.
- Oldószert csak zárt fémtartályban tárolj. A maradék és az üres tartály veszélyes hulladék, a gyűjtőhelyre kerül.

## Óvd a bőrödet
- A vízzel és tisztítószerekkel végzett munka megterheli a bőrt (nedves munka). A kesztyű hosszú viselése is ide tartozik.
- Tartsd be a bőrvédelmi tervet: munka előtt védd, munka után tisztítsd és ápold a bőrödet.
- Viselj megfelelő védőkesztyűt (pl. nitril). A nedves kesztyűt cseréld le, hosszú munkánál alá vegyél pamutkesztyűt.
- Korán jelentsd, ha a bőröd piros, viszket vagy berepedt. Ebből foglalkozási betegség lehet.
- Hígított szernél is viselj kesztyűt, főleg lúgoknál. Hajtsd vissza a kesztyű szárát, hogy ne folyjon bele semmi.

## Elsősegély tisztítószereknél
- Ha a szembe fröccsent: azonnal öblítsd vízzel legalább 10 percig, közben tartsd nyitva a szemet, aztán menj orvoshoz.
- Ha a bőrre került: vedd le a szennyezett ruhát, öblítsd le sok vízzel.
- Ha lenyelték: öblítsd ki a szájat, ne hánytass, hívd a mérgezési információs központot (01 406 43 43), panasz esetén a mentőket: 144.
- Vidd magaddal az orvoshoz a címkét vagy a biztonsági adatlapot.

## Csúszás, botlás, esés
- Viselj zárt, csúszásmentes cipőt.
- Nedves felmosásnál tedd ki a „Csúszásveszély” táblát. Ahol emberek járnak, lehetőleg egyszerre csak a fél oldalt mosd fel.
- A kábeleket és tömlőket úgy tedd le, hogy senki ne botoljon meg bennük. Tartsd szabadon a folyosókat és a lépcsőket.
- A lépcsőn menj lassan, és fogd a korlátot. Ne vigyél olyat, ami miatt nem látsz előre.
- Gondoskodj jó világításról. Jelentsd, ha elromlott a világítás.
- Olyan kendővel törölj, amely nem túl vizes.
- A cipődnek csúszásmentes talp és sarokpánt kell. Létrán lapos cipőt viselj, amely körbefogja a sarkadat.

## Létrák és munka a magasban
- Csak ép létrát és fellépőt használj. Minden használat előtt ellenőrizd (fokok, lábak, szétnyílásgátló).
- Soha ne állj fel székre, asztalra, vödörre vagy radiátorra.
- A létrát szilárd, sík talajra állítsd. Állólétránál feszítsd ki a szétnyílásgátlót.
- Állólétránál ne állj a felső két fokra. Ne hajolj ki oldalra.
- Magas üvegfelületekhez, ahol lehet, létra helyett teleszkópos rudat használj.
- Külső üvegtisztítás, emelőkosár, munka a tetőn vagy ahol le lehet esni: csak külön betanítással, leesés elleni biztosítással és a feletteseid engedélyével.
- Soha ne hajolj ki az ablakon, és ne állj fel az ablakpárkányra.
- Támasztólétra: a szög 65 és 75 fok között legyen, biztosítsd elcsúszás ellen, és legalább 1 méterrel érjen túl azon a ponton, ahol lelépsz róla. Mindkét lábaddal a fokokon állj.
- Az állólétrát ne támaszd neki semminek összecsukva. Lépcsőn csak szárhosszabbítós létrát használj.
- Zuhanásgátló hevedert csak betanítás után és csak a kijelölt pontokon használj. Minden használat előtt ellenőrizd. Egy zuhanás után már nem szabad használni.

## Eszközök és gépek
- Gépeket (pl. súroló-szívó gép, egytárcsás gép, magasnyomású mosó, lombfúvó, fűnyíró) csak betanítás után használj.
- Munka előtt nézd meg a kábelt, a dugót és a gépet. Sérült? Ne használd, jelöld meg, és azonnal jelentsd.
- Húzd ki a dugót, mielőtt kefét, padot vagy zsákot cserélsz, vagy tisztítod a gépet.
- Soha ne fogd meg a dugót és a kapcsolót vizes kézzel. Ne menj át a géppel a kábelen.
- Semmit ne javíts meg magad, ne barkácsolj ragasztószalaggal.
- Viselj hallásvédőt és védőszemüveget, ha az üzemi utasítás előírja (pl. lombfúvó, sövénynyíró).
- Meghajtótányért és kefét csak kihúzott dugónál szerelj fel.
- A kábelt mindig a gép mögött vezesd, a kezeden vagy a válladon át. Ne csípd be (pl. automata ajtóba). Lazán tekerd fel, és közben nézd meg, nem sérült-e.
- Szünetben húzd ki a gép kulcsát.

## Emelés és cipelés
- Egyenes háttal, térdből emelj, tartsd a terhet közel a testedhez, és ne fordulj el a teherrel.
- Használj kocsit, görgőt és szállítóeszközt. A nehéz terhet oszd több részre, vagy kérj segítséget.
- Teli vödröt és szemeteszsákot ne emelj fejmagasság fölé, és a szemeteszsákot tartsd távol a testedtől.

## Fertőzésveszély, tűk és szilánkok
- A mosdók és WC-k takarításánál és a szemétnél mindig viselj védőkesztyűt.
- Soha ne nyúlj kézzel szemeteszsákba vagy papírkosárba, és ne nyomd össze kézzel a szemetet.
- Használt fecskendő vagy tű: ne nyúlj hozzá. Fogóval vagy szemétfelszedővel tedd szúrásbiztos tartályba, aztán jelentsd.
- Ha megszúrt egy használt tű, vagy elvágott egy szennyezett szilánk: hagyd vérezni a sebet, fertőtlenítsd, azonnal jelentsd, és rögtön menj orvoshoz (legjobb 2 órán belül).
- Evés, ivás és dohányzás előtt és munka után moss és fertőtleníts kezet.
- Ne egyél és ne igyál mosdóban és WC-ben.
- A törlőkendőket szín szerint használd (pl. piros csak WC-hez és piszoárhoz), hogy ne hurcold szét a kórokozókat.
- Ápolási otthonban és orvosi rendelőben: ne viselj ékszert és órát, a körmöd legyen rövid, a hosszú hajat kösd össze. Egyszer használatos kesztyű és kötény, ahol előírják.
- Fertőtlenítsd a kezed a műszak előtt és után, piszkos munka után és WC-használat után.
- A szemeteszsákot kocsin szállítsd, ne kézben.
- Kérdezz rá a hepatitis B elleni oltásra. Az üzemorvos tanácsot ad.

## Egyedül dolgozni, korán és későn
- Legyen nálad a feltöltött telefonod. Mentsd el a segélyhívó számokat és az iroda számát.
- Ne engedj be idegeneket az épületbe. Tartsd zárva az ajtókat, ahogy az ügyfél kéri.
- Fenyegetés vagy erőszak esetén: menj biztonságba, hívd a rendőrséget: 133, aztán az irodát.
- Veszélyes munkát (pl. magas létra, gépek félreeső helyiségekben) ne végezz egyedül, ha az üzemi utasítás ezt előírja.

## Vészhelyzet és elsősegély
- Segélyhívó számok: mentők 144, tűzoltóság 122, rendőrség 133, európai segélyhívó 112, mérgezési információ 01 406 43 43.
- Segélyhíváskor mondd el: Hol történt (cím, lépcsőház, emelet)? Mi történt? Hány sérült van? Várj, hátha még kérdeznek.
- Tudod, hol van az objektumban az elsősegélydoboz, a tűzoltó készülék és a vészkijárat? Ha nem: kérdezd meg az első műszakodnál.
- Nyújts elsősegélyt, ahogy tudsz. A saját biztonságod az első.

## Tűz és menekülési utak
- Tartsd szabadon a menekülési utakat, a vészkijáratokat és a tűzgátló ajtókat. Soha ne ékeld ki nyitva a tűzgátló ajtót.
- Tűz esetén: riassz (122), figyelmeztesd az embereket és vidd őket biztonságba, csak akkor olts, ha veszély nélkül lehet.
- Tűz esetén soha ne használd a liftet.
- A takarítókocsit és az anyagot ne tedd tűzoltó készülék, tűzcsap vagy vészkijárat elé.
- Bejelentéskor: Ki jelenti? Mi történt? Hányan érintettek? Hol van? Várj, hátha még kérdeznek. Nyomd meg a tűzjelzőt.
- Vidd magaddal a veszélyben lévő embereket, csukd be magad mögött az ajtókat, és kövesd a menekülési utakat.

## Balesetek és majdnem-balesetek jelentése
- Minden munkabalesetet azonnal jelents, a kis sérüléseket és a munkába menet vagy hazafelé történt baleseteket is.
- A majdnem-baleseteket is jelentsd („ez majdnem baj lett”). Így megelőzzük a következő balesetet.
- Baleset után megbeszéljük, mit változtatunk.

## Az ügyfélnél
- Tartsd be a házirendet és az objektum szabályait (riasztó, belépés, helyek, ahová nem mehetsz be).
- Kulcsok, kártyák és kódok: csak a munkához, soha ne add tovább, soha ne írj rájuk semmit. Ha elveszett, azonnal jelentsd.
- Ne olvass iratokat, és ne nézz a képernyőkre. Amit az objektumban látsz és hallasz, az bizalmas marad.
- A talált tárgyakat és a károkat jelentsd az irodának.

## Jármű és munkába járás
- Céges járművet csak érvényes jogosítvánnyal és engedély után vezess. Kösd be a biztonsági övet, vezetés közben ne telefonálj.
- Rögzítsd a rakományt (gépek, kannák), hogy ne csússzon el.
- Se alkohol, se drog: sem munka közben, sem vezetés közben.
- Indulás előtt ellenőrizd a lámpákat, az irányjelzőt és a féklámpát. A jogosítványod és a forgalmi engedély mindig legyen nálad.
- A létrát rögzítőhevederrel rögzítsd a tetőcsomagtartón.
- Rendszeresen ellenőrizd a láthatósági mellényt, az elakadásjelző háromszöget és az elsősegélycsomagot. Minden balesetet azonnal jelents.

## Téli szolgálat, hideg és hőség
- Téli szolgálat csak betanítás után (hómaró, szórókocsi). Viselj láthatósági ruhát, jó recés talpú cipőt és meleg ruhát.
- Figyelj a forgalomra, sötétben is. Először azt az utat takarítsd el és szórd le, amelyen te magad jársz.
- Hőségben: igyál sok vizet, tarts szünetet árnyékban, viselj fejfedőt és használj napvédelmet.

## Terhesség, fiatalok, egészség
- Ha terhes vagy, kérjük, mondd el minél előbb az irodában. Ekkor megnézzük a munkahelyedet. Bizonyos munkák akkor nem engedélyezettek, pl. egyes tisztítószerekkel, létrán vagy nehéz emelés (anyavédelmi törvény).
- A 18 év alatti fiatalokra külön szabályok vonatkoznak. Csak olyan munkát végeznek, amire engedélyt kaptak.
- Szólj nekünk, ha egészségi problémád van (pl. allergia, hátprobléma), hogy hozzá tudjuk igazítani a munkát.

## Biztonsági mappa
- Az objektumban a biztonsági mappa (üzemi utasítások, biztonsági adatlapok) a takarítószertárban van, céges járműnél a járműben.
- Munkakezdés előtt nézz bele, főleg új objektumban vagy új szernél.

## Kérdések
- Ha kérdésed van a biztonságról vagy az egészségről, fordulj a csoportvezetődhöz vagy az irodához.
- Az egyes objektumok különleges veszélyeiről (pl. labor, konyha, gyártás) a helyszíni betanításon hallasz.`,
    quiz: `? Szükséged van egy savas WC-tisztítóra és egy klóros tisztítóra. Mi a helyes?
+ Soha ne keverd össze és ne használd őket egyszerre, mérgező gáz keletkezik.
- A keverés rendben van, ha nyitva van az ablak.
- A keverés jobban tisztít és időt spórol.

? Hol találod egy tisztítószer veszélyeit és a védőintézkedéseket?
+ A címkén, az üzemi utasításban és a biztonsági adatlapon.
- Csak a szagából.
- Sehol, ezt csak a szállító tudja.

? Szabad tisztítószert üres italos palackba tölteni?
+ Nem, soha. Csak jól feliratozott flakonba.
- Igen, ha a palack tiszta.
- Igen, ha megjegyzem, melyik palack az.

? Tisztítószer fröccsent a szemedbe. Mit teszel?
+ Azonnal öblítem vízzel legalább 10 percig, aztán orvoshoz megyek.
- Megdörzsölöm a szemem, és dolgozom tovább.
- Várok, hátha jobb lesz.

? Mit teszel, mielőtt nedvesen felmosol egy folyosót, ahol emberek járnak?
+ Kiteszem a „Csúszásveszély” táblát, és lehetőleg egyszerre csak a fél oldalt mosom fel.
- Semmit, az emberek úgyis látják a nedves padlót.
- Gyorsan felmosok, aztán magától megszárad.

? Mi a helyes az állólétránál?
+ Előtte ellenőrzöm, kifeszítem a szétnyílásgátlót, nem állok a felső két fokra.
- A szék ugyanolyan jó, mint a létra.
- A legfelső fok arra való, hogy ráálljak.

? A takarítógép kábele sérült. Mit teszel?
+ Nem használom, megjelölöm, és azonnal jelentem.
- Megjavítom ragasztószalaggal, és dolgozom tovább.
- Óvatosan dolgozom tovább, és a hónap végén jelentem.

? A szemetesben egy használt fecskendő van. Mi a helyes?
+ Nem nyúlok hozzá, fogóval vagy szemétfelszedővel szúrásbiztos tartályba teszem, és jelentem.
- Kézzel kiveszem, és a szemeteszsákba dobom.
- Kézzel összenyomom a szemetet, hogy több hely legyen.

? Megszúrt egy használt tű. Mit teszel?
+ Hagyom vérezni a sebet, fertőtlenítem, azonnal jelentem, és rögtön orvoshoz megyek.
- Ragtapaszt teszek rá, és dolgozom tovább.
- Csak pár nap múlva megyek orvoshoz, ha fáj.

? Mi a mentők száma Ausztriában?
+ 144
- 122
- 133

? Tűz van az objektumban. Mi a helyes?
+ Riasztok (122), figyelmeztetem az embereket, csak veszély nélkül oltok, soha nem használom a liftet.
- Először befejezem a munkát.
- Gyorsan lemegyek a lifttel.

? Kicsit megsérültél, vagy majdnem baleset történt. Mit teszel?
+ Azonnal jelentem, a kis sérüléseket és a majdnem-baleseteket is.
- Csak akkor jelentem, ha kórházba kell mennem.
- Nem szólok semmit, hogy ne legyen baj belőle.

? Mi a szabály az ügyfél kulcsaira, kártyáira és kódjaira?
+ Csak a munkához használom, soha nem adom tovább, ha elveszik, azonnal jelentem.
- Kölcsönadhatom a kollégáimnak.
- Ráírom a kódot a kulcsra, hogy ne felejtsem el.

? Hogyan állítasz fel helyesen egy támasztólétrát?
+ 65 és 75 fok közötti szögben, elcsúszás ellen biztosítva, 1 méterrel a lelépési pont fölé érjen.
- Minél meredekebben, akkor stabilabban áll.
- Mindegy, hogyan, csak gyorsan legyen.

? Ég az oldószer. Mivel oltod?
+ Homokkal vagy poroltóval, nem vízzel.
- Sok vízzel.
- Egy vizes kendővel.`,
    decl: 'Megerősítem: Ma megkaptam, elolvastam és megértettem a munkavédelmi oktatást. Lehetőségem volt kérdezni. Betartom az utasításokat, és használom a védőfelszerelést. Ha valamit nem tudok, vagy valami megváltozik, megkérdezem.',
  },
  en: {
    title: 'Safety briefing for building cleaning and facility services',
    content: `This briefing applies to all work in building cleaning and facility services (caretaking, window cleaning, outdoor areas, winter service). It is required by law (§ 14 Employee Protection Act, ASchG): before your first shift and then every year. The time for it is working time.

Read each section calmly. At the end you answer a few questions and confirm with your signature. If you do not understand something: please ask before you sign.

## Your duties and rights
- Follow the instructions you get and the operating instructions.
- Use the protective equipment you get from us (gloves, safety glasses, shoes, high-visibility vest).
- Use equipment, machines and cleaning products only the way you have learned.
- Report faults, damage and dangerous situations immediately: team leader, office or "Equipment broken?" in My schedule.
- Never work under the influence of alcohol, drugs or medicines that make you tired.
- If there is serious and immediate danger, get yourself to safety and report it immediately. Nobody may treat you worse because of this.

## Cleaning products and disinfection
- Before work, read the label and the operating instructions. The hazard symbols (red diamond) show you the danger.
- Safety data sheets and operating instructions are kept in the office or at the site. Ask if you cannot find them.
- Use exactly the amount stated (dosing aid, measuring cup). More product does not clean better. It harms skin and materials.
- Never mix different products. Especially dangerous: acidic toilet cleaner and chlorine cleaner. This makes poisonous chlorine gas.
- Never put products into drink bottles. Only into correctly labelled bottles and spray bottles.
- Wear protective gloves and safety glasses when you work with concentrate.
- Air the room well, especially small rooms (toilet, shower). Spray as little as possible, better onto the cloth.
- Close containers after work and never leave them open or unattended (children, customers).
- First the water, then the cleaning product.
- Never spray towards people, and not towards yourself. Do not breathe in the spray mist.
- Do not pour dangerous acids into other containers. Put a drip tray under larger canisters with a tap (for example 10 litres).
- At the site, store products only in locked, ventilated rooms. In the car, only take small amounts for your own work (dangerous goods).
- Disinfection: wipe instead of spraying. Disinfectants with alcohol catch fire easily.
- Dirty water from the wet vacuum cleaner: first neutralise it (pH 7), then pour it into the drain, the way the site manager shows you.

## Solvents
- Solvents catch fire easily, and their fumes harm your health (liver, nerves).
- No smoking, no open fire. Air the room well and do not breathe in the fumes.
- Never put out burning solvent with water. Use sand or a powder extinguisher.
- Store solvents only in closed metal containers. Leftovers and empty containers are hazardous waste and go to the collection point.

## Protect your skin
- Working with water and cleaning products is hard on your skin (wet work). Wearing gloves for a long time also counts.
- Follow the skin protection plan: protect your skin before work, clean and care for it after work.
- Wear suitable protective gloves (for example nitrile). Change damp gloves. For long work wear cotton gloves underneath.
- Report redness, itching or cracks in your skin early. This can turn into an occupational disease.
- Wear gloves also with diluted products, especially with alkaline cleaners. Fold the cuffs outwards so that nothing runs inside.

## First aid for cleaning products
- Splash in the eye: immediately rinse with water for at least 10 minutes, keep the eye open while you do this, then go to the doctor.
- On the skin: take off the dirty clothes, rinse with plenty of water.
- Swallowed: rinse the mouth, do not cause vomiting, call the Poison Information Centre (01 406 43 43). If there are symptoms, call the ambulance 144.
- Take the label or the safety data sheet with you to the doctor.

## Slipping, tripping, falling
- Wear closed, non-slip shoes.
- When you wet-mop, put up the "Slippery floor" warning sign. Where people walk, mop one half of the floor at a time if possible.
- Lay cables and hoses so that nobody trips over them. Keep corridors and stairs clear.
- Walk slowly on stairs and hold on to the handrail. Do not carry anything that blocks your view.
- Make sure there is good light. Report broken lights.
- Mop with cloths that are not too wet.
- Your shoes need a non-slip sole and a strap at the heel. On ladders wear flat shoes that are closed around the heel.

## Ladders and work at height
- Only use ladders and step stools that are in good condition. Check them before every use (rungs, feet, spreader).
- Never climb onto chairs, tables, buckets or radiators.
- Put the ladder on firm, level ground. On a stepladder, pull the spreader tight.
- On a stepladder, do not climb onto the top two steps. Do not lean out to the side.
- For high glass surfaces use telescopic poles instead of the ladder where possible.
- Outside glass, lifting platforms, work on the roof or where you could fall: only with special training, fall protection and approval from your supervisors.
- Never lean out of windows and do not climb onto window sills.
- Leaning ladder: angle 65 to 75 degrees, secure it against slipping, at least 1 metre higher than the point where you step off. Stand with both feet on the rungs.
- Do not lean a folded stepladder against something. On stairs only use ladders with leg extensions.
- Safety harness only after training and only at the fixed anchor points. Check it before every use. After a fall it must not be used again.

## Equipment and machines
- Use machines (for example scrubber dryer, single-disc machine, pressure washer, leaf blower, lawn mower) only after training.
- Before work, check the cable, plug and equipment. Damaged? Do not use it, mark it and report it immediately.
- Pull out the plug before you change brushes, pads or bags or clean the equipment.
- Never touch plugs and switches with wet hands. Do not drive over the cable.
- Do not repair anything yourself, no quick fixes with tape.
- Wear hearing protection and safety glasses if the operating instructions say so (for example leaf blower, hedge trimmer).
- Fit drive plates and brushes only when the plug is pulled out.
- Always guide the cable behind the machine, over your hand or shoulder. Do not let it get trapped (for example in automatic doors). Wind it up loosely and check it for damage while you do this.
- In breaks, take the key out of the machine.

## Lifting and carrying
- Lift with a straight back, bend your knees, keep the load close to your body and do not twist your body while holding the load.
- Use trolleys, dollies and transport aids. Split heavy loads or get help.
- Do not lift full buckets and bin bags above head height, and keep bin bags away from your body.

## Risk of infection, needles and broken glass
- Always wear protective gloves when you clean toilets and washrooms and when you handle waste.
- Never reach into bin bags and paper baskets with your hand, and do not press the waste down with your hand.
- Used syringes or needles: do not touch them. Put them into a puncture-proof container with pliers or a grabber, then report it.
- If you prick or cut yourself on a used needle or on dirty broken glass: let the wound bleed, disinfect it, report it immediately and go to the doctor straight away (best within 2 hours).
- Wash and disinfect your hands before eating, drinking and smoking and after work.
- Do not eat or drink in toilets and washrooms.
- Use cloths by colour (for example red only for toilet and urinal) so that germs are not spread.
- In care homes and doctors' practices: no jewellery and no watch, short fingernails, tie long hair back. Disposable gloves and disposable apron where this is required.
- Disinfect your hands before and after your shift, after dirty work and after using the toilet.
- Carry bin bags on the trolley, not in your hand.
- Ask about the vaccination against hepatitis B. The occupational health doctor will advise you.

## Working alone, early and late
- Have your phone with you and charged. Save the emergency numbers and the office number.
- Do not let strangers into the building. Keep doors closed as the customer requires.
- If you are threatened or there is violence: get to safety, call the police 133, then the office.
- Do not do dangerous work (for example on a high ladder, with machines in remote rooms) alone if the operating instructions say so.

## Emergency and first aid
- Emergency numbers: ambulance 144, fire brigade 122, police 133, European emergency number 112, Poison Information 01 406 43 43.
- When you call, say: Where is it (address, staircase, floor)? What happened? How many people are injured? Wait for their questions.
- Do you know where the first aid kit, fire extinguishers and emergency exits are at the site? If not: ask on your first shift.
- Give first aid as well as you can. Your own safety comes first.

## Fire and escape routes
- Keep escape routes, emergency exits and fire doors clear. Never wedge fire doors open.
- If there is a fire: raise the alarm (122), warn people and bring them to safety, only put out the fire if you can do it without danger.
- Never use the lift if there is a fire.
- Do not put cleaning trolleys and supplies in front of fire extinguishers, hydrants or emergency exits.
- When you report: Who is reporting? What happened? How many people are affected? Where is it? Wait for their questions. Press the fire alarm button.
- Take people in danger with you, close the doors behind you and follow the escape routes.

## Report accidents and near misses
- Report every work accident immediately, also small injuries and accidents on the way to or from work.
- Also report near misses ("that was close"). This way we prevent the next accident.
- After an accident we talk about what we will change.

## At the customer's site
- Follow the house rules and the rules at the site (alarm system, access, areas you must not enter).
- Keys, cards and codes: only for work, never give them to others, never write on them. Report a loss immediately.
- Do not read documents and do not look at screens. What you see and hear at the site stays confidential.
- Report things you find and damage to the office.

## Vehicle and the way to work
- Company vehicle only with a valid driving licence and after approval. Wear your seat belt, no phone while driving.
- Secure the load (machines, canisters) so that it cannot slide.
- No alcohol and no drugs, not at work and not when driving.
- Before you drive, check the lights, indicators and brake lights. Always have your driving licence and vehicle registration document with you.
- Fasten ladders to the roof rack with tie-down straps.
- Check the high-visibility vest, warning triangle and first aid kit regularly. Report every accident immediately.

## Winter service, cold and heat
- Winter service only after training (snow blower, grit spreader). Wear high-visibility clothing, shoes with a good grip and warm clothing.
- Watch out for traffic, also in the dark. First clear and grit the path you walk on yourself.
- In hot weather: drink a lot of water, take breaks in the shade, wear a hat and use sun protection.

## Pregnancy, young people, health
- If you are pregnant, please tell the office as early as possible. We will then check your workplace. Some work is then not allowed, for example with certain cleaning products, on ladders or heavy lifting (Maternity Protection Act).
- Young people under 18 have their own rules. They only do work they are approved for.
- Tell us if you have health problems that limit you (for example allergy, back), so that we can adapt your work.

## Safety folder
- At the site, the safety folder (operating instructions, safety data sheets) is in the cleaning storeroom. For company vehicles, it is in the vehicle.
- Look inside before you start work, especially at a new site or with a new product.

## Questions
- If you have questions about safety and health, ask your team leader or the office.
- You learn about special dangers at each site (for example laboratory, kitchen, production) during the training at the site.`,
    quiz: `? You need an acidic toilet cleaner and a chlorine cleaner. What is right?
+ Never mix them and never use them at the same time. This makes poisonous gas.
- Mixing is fine if the window is open.
- Mixing cleans better and saves time.

? Where do you find the dangers and safety measures for a cleaning product?
+ On the label, in the operating instructions and in the safety data sheet.
- Only by the smell.
- Nowhere, only the supplier knows that.

? Are you allowed to put cleaning product into an empty drink bottle?
+ No, never. Only into correctly labelled bottles.
- Yes, if the bottle is clean.
- Yes, if I remember the bottle.

? Cleaning product has splashed into your eye. What do you do?
+ Immediately rinse with water for at least 10 minutes, then go to the doctor.
- Rub the eye and keep working.
- Wait and see if it gets better.

? What do you do before you wet-mop a corridor where people walk?
+ Put up the "Slippery floor" warning sign and mop one half at a time if possible.
- Nothing, people can see the wet floor.
- Mop quickly, then it dries by itself.

? What is right for a stepladder?
+ Check it first, pull the spreader tight, do not climb onto the top two steps.
- A chair is just as good as a ladder.
- The top step is for standing on.

? The cable of the cleaning machine is damaged. What do you do?
+ Do not use it, mark it and report it immediately.
- Repair it with tape and keep working.
- Keep working carefully and report it at the end of the month.

? There is a used syringe in the waste bin. What is right?
+ Do not touch it, put it into a puncture-proof container with pliers or a grabber and report it.
- Take it out with your hand and throw it into the bin bag.
- Press the waste down with your hand to make more room.

? You pricked yourself on a used needle. What do you do?
+ Let the wound bleed, disinfect it, report it immediately and go to the doctor straight away.
- Put a plaster on it and keep working.
- Go to the doctor in a few days, if it hurts.

? What is the ambulance number in Austria?
+ 144
- 122
- 133

? There is a fire at the site. What is right?
+ Raise the alarm (122), warn people, only put out the fire if there is no danger, never use the lift.
- First finish the work.
- Take the lift down quickly.

? You have a small injury or there was almost an accident. What do you do?
+ Report it immediately, also small injuries and near misses.
- Only report it if I have to go to hospital.
- Say nothing, so that there is no trouble.

? What applies to the customer's keys, cards and codes?
+ Use them only for work, never give them to others, report a loss immediately.
- I may lend them to colleagues.
- I write the code on the key so that I do not forget it.

? How do you set up a leaning ladder correctly?
+ Angle 65 to 75 degrees, secured against slipping, 1 metre higher than the point where you step off.
- As steep as possible, then it is more stable.
- It does not matter how, as long as it is quick.

? Solvent is burning. What do you use to put it out?
+ Sand or a powder extinguisher, not water.
- Lots of water.
- A wet cloth.`,
    decl: 'I confirm: Today I received the safety briefing, read it and understood it. I had the chance to ask questions. I follow the instructions and use the protective equipment. If I do not know something or something changes, I ask.',
  },
}
