// Inhalte für Security-Awareness und KI-Kompetenz (AI Act Art. 4).
// Quelle: Anhänge D, E, F, L und M der KI-Cybersicherheitsstrategie.
// Platzhalter in lernendenseitigen Texten: {{firma}}, {{meldestelle}}, {{notfall}}, {{hausbank}}.

export type AwarenessLesson = { id: string; title: string; minutes: number; body: string; keyPoints: string[] };
export type AwarenessScenario = {
  id: string;
  situation: string;
  verdict: "angriff" | "verdacht" | "verstoss";
  answer: string;
  explanation: string;
};
export type AwarenessQuestion = { id: string; question: string; options: string[]; correct: number; explanation: string };
export type AwarenessCourse = {
  id: string;
  title: string;
  summary: string;
  audience: string;
  minutes: number;
  legalBasis: string;
  repeatMonths: number;
  passPercent: number;
  goals: string[];
  lessons: AwarenessLesson[];
  scenarios: AwarenessScenario[];
  quiz: AwarenessQuestion[];
};
export type MonthlyImpulse = { month: number; title: string; action: string | null; audience: string; subject: string; text: string };
export type SelfAssessmentQuestion = { id: string; text: string; key: boolean };
export type SelfAssessmentSection = { id: string; title: string; max: number; questions: SelfAssessmentQuestion[] };
export type SelfAssessment = {
  scale: { points: number; label: string }[];
  sections: SelfAssessmentSection[];
  max: number;
  ratings: { min: number; label: string; text: string }[];
};
export type VerificationRules = {
  title: string;
  intro: string;
  when: string[];
  steps: { name: string; text: string }[];
  notValid: string[];
  redFlags: string[];
  backing: string;
  report: { label: string; value: string }[];
};

// ---------------------------------------------------------------------------
// Basisschulung KI-Kompetenz (Anhang M, als Selbstlernkurs)
// ---------------------------------------------------------------------------

export const KI_KOMPETENZ: AwarenessCourse = {
  id: "ki-kompetenz",
  title: "KI sicher nutzen und KI-Angriffe erkennen",
  summary:
    "Die Basisschulung zur KI-Kompetenz: was KI kann und wo ihre Grenzen liegen, wie Sie freigegebene KI-Werkzeuge sicher nutzen, wie Angreifer KI zur Täuschung einsetzen, wie KI-Assistenten selbst manipuliert werden – und wie Sie mit STOPP · PRÜFEN · BESTÄTIGEN richtig reagieren und melden.",
  audience: "alle Mitarbeitenden, Führungskräfte, Praktikant/innen, externe Personen mit Zugang zu unseren KI-Werkzeugen",
  minutes: 40,
  legalBasis: "AI Act Art. 4 (KI-Kompetenz)",
  repeatMonths: 12,
  passPercent: 80,
  goals: [
    "Sie können erklären, was KI-Werkzeuge leisten und wo ihre Grenzen liegen (erfundene Fakten, Manipulierbarkeit, Verzerrungen).",
    "Sie können unsere freigegebenen KI-Werkzeuge nutzen und für jede Datenklasse entscheiden, was eingegeben werden darf.",
    "Sie können KI-gestützte Täuschung (Phishing, geklonte Stimmen, gefälschte Videocalls, falscher IT-Support) als Risiko einordnen und die Verifikationsregeln anwenden.",
    "Sie können ungewöhnliches Verhalten eines KI-Assistenten als mögliche Manipulation erkennen.",
    "Sie können Vorfälle und Fehler sofort über den richtigen Weg melden.",
  ],
  lessons: [
    {
      id: "echt-oder-faelschung",
      title: "Einstieg: Echt oder Fälschung?",
      minutes: 3,
      body: `Stellen Sie sich vor, Sie erhalten eine kurze Sprachnachricht. Es ist eindeutig die Stimme Ihrer Geschäftsführung. Würden Sie glauben, dass die Nachricht echt ist?

Eine solche Stimme lässt sich heute mit **frei verfügbaren Werkzeugen** aus **wenigen Sekunden Audiomaterial** erzeugen. Was mit Bordmitteln in einer Stunde gelingt, schaffen Kriminelle auch.

**Deshalb verlassen wir uns nicht mehr auf unser Gefühl, sondern auf feste Abläufe.**

### Warum diese Schulung?

- **Vor allem:** KI-gestützte Täuschung lässt sich nicht mehr an Fehlern erkennen. Schutz bieten nur Abläufe, die alle kennen und einhalten.
- **AI Act Art. 4:** Unternehmen, die KI-Systeme einsetzen, müssen Maßnahmen ergreifen, die die KI-Kompetenz ihres Personals fördern. Diese Schulung ist eine solche Maßnahme.
- **NISG 2026 / NIS-2-Richtlinie:** Zu den Risikomanagementmaßnahmen gehören grundlegende Cyberhygiene und Schulungen zur Cybersicherheit – für Unternehmen, die vom Gesetz erfasst sind.

Die Schulung absolvieren alle, die bei {{firma}} mit KI-Werkzeugen arbeiten: beim Onboarding, danach jährlich und bei Einführung neuer KI-Werkzeuge.

### Was Sie erwartet

In fünf kurzen Lektionen erfahren Sie, was KI kann und was nicht, wie Sie KI bei uns sicher nutzen, wie Angreifer KI einsetzen, was passiert, wenn die KI selbst angegriffen wird – und mit welcher Regel Sie sich schützen: **STOPP · PRÜFEN · BESTÄTIGEN**.

Zum Schluss üben Sie an sechs Situationen aus dem Alltag und beantworten zehn Quizfragen. Bestanden haben Sie ab 8 richtigen Antworten; eine Wiederholung ist jederzeit möglich.`,
      keyPoints: [
        "Eine Stimme lässt sich mit frei verfügbaren Werkzeugen aus wenigen Sekunden Audiomaterial klonen.",
        "KI-gestützte Täuschung lässt sich nicht mehr an Fehlern erkennen.",
        "Wir verlassen uns nicht auf unser Gefühl, sondern auf feste Abläufe, die alle kennen und einhalten.",
        "Die Schulung erfüllt die Pflicht zur KI-Kompetenz nach AI Act Art. 4 und wird jährlich wiederholt.",
      ],
    },
    {
      id: "was-ki-kann",
      title: "Was KI kann und was nicht",
      minutes: 4,
      body: `KI-Werkzeuge liefern in Sekunden Texte, Zusammenfassungen und Antworten. Damit Sie sie richtig einsetzen, sollten Sie wissen, wie sie arbeiten – und wo ihre Grenzen liegen.

### So arbeitet ein Sprachmodell

Ein Sprachmodell berechnet, welche Wörter wahrscheinlich als Nächstes kommen. Es „weiß“ nichts im menschlichen Sinn und **prüft keine Fakten**. Eine Antwort kann deshalb flüssig und überzeugend klingen – und trotzdem falsch sein.

### Erfundene Inhalte

KI kann **Quellen, Zahlen, Gesetzesstellen oder Namen erfinden**, die überzeugend klingen. Typisch ist eine plausible, aber falsche Antwort: etwa eine Gesetzesstelle, die es so nicht gibt, oder eine Quelle, die nie erschienen ist.

**Darum gilt:** Fakten, Zahlen, Quellen und rechtliche Aussagen prüfen Sie in der Originalquelle, bevor Sie sie verwenden.

### Verzerrungen

KI übernimmt Einseitigkeiten aus ihren Trainingsdaten. Bei **Entscheidungen über Menschen** – etwa bei Bewerbungen oder Bewertungen – ist deshalb besondere Vorsicht geboten. Unsere KI-Nutzungsrichtlinie verlangt dafür eine Freigabe.

### Manipulierbarkeit

KI folgt Anweisungen – **auch versteckten Anweisungen** in Texten, die sie liest. Wie Angreifer das ausnutzen, erfahren Sie in der Lektion „Wenn die KI selbst angegriffen wird“.

### Verantwortung

**Wer ein KI-Ergebnis verwendet, verantwortet es.** Die KI ist ein Werkzeug, keine Entscheidungsinstanz.`,
      keyPoints: [
        "Ein Sprachmodell berechnet wahrscheinliche nächste Wörter – es weiß nichts im menschlichen Sinn und prüft keine Fakten.",
        "KI kann Quellen, Zahlen, Gesetzesstellen und Namen überzeugend erfinden: Prüfen Sie in der Originalquelle.",
        "KI übernimmt Verzerrungen aus ihren Trainingsdaten – bei Entscheidungen über Menschen nur mit Freigabe.",
        "KI folgt auch versteckten Anweisungen und ist dadurch manipulierbar.",
        "Wer ein KI-Ergebnis verwendet, verantwortet es.",
      ],
    },
    {
      id: "ki-sicher-nutzen",
      title: "KI sicher nutzen bei uns",
      minutes: 8,
      body: `KI-Werkzeuge machen uns produktiver – wir wollen sie nutzen. Damit dabei keine vertraulichen Daten abfließen, keine Sicherheitslücken entstehen und gesetzliche Pflichten (DSGVO, AI Act, Vertraulichkeitsvereinbarungen) eingehalten werden, gilt bei {{firma}} eine KI-Nutzungsrichtlinie. Hier das Wichtigste.

### Die Grundsätze

1. **Freigegebene Werkzeuge nutzen.** Für die Arbeit verwenden Sie ausschließlich KI-Werkzeuge, die bei uns freigegeben sind.
2. **Daten nach Klasse behandeln.** Welche Daten in welches Werkzeug dürfen, regeln die Datenklassen (siehe unten).
3. **Der Mensch bleibt verantwortlich.** KI-Ergebnisse können falsch, erfunden oder manipuliert sein. Wer ein Ergebnis verwendet, prüft es und verantwortet es.
4. **KI-Inhalte sind nicht vertrauenswürdig.** Anweisungen, Links oder Code aus KI-Antworten prüfen Sie, bevor Sie danach handeln.
5. **Im Zweifel fragen** – bevor Sie etwas eingeben.

### Freigegebene Werkzeuge

In unseren freigegebenen KI-Werkzeugen werden Ihre Eingaben **nicht zum Training verwendet**, und die Daten bleiben unter unserer Kontrolle. Sie melden sich dort mit Ihrem Firmenkonto an. Welche Werkzeuge wofür freigegeben sind, steht in unserer KI-Nutzungsrichtlinie.

**Nicht freigegeben** sind insbesondere:

- private Konten bei KI-Diensten – auch kostenpflichtige Privat-Tarife
- kostenlose Online-Übersetzer und -Transkriptionsdienste
- KI-Browser-Erweiterungen
- KI-Meeting-Bots
- Apps, die nicht auf der Liste der freigegebenen Werkzeuge stehen

Sie brauchen ein Werkzeug, das noch nicht freigegeben ist? Beantragen Sie es – es wird vor der Freigabe geprüft.

### Datenklassen: Was darf wohin?

- **Öffentlich** – z. B. veröffentlichte Website-Texte, Pressemitteilungen: **überall erlaubt**.
- **Intern** – z. B. interne Abläufe, allgemeine Korrespondenz, nicht sensible Entwürfe: **nur in freigegebene Werkzeuge**, nie in öffentliche oder private KI-Dienste.
- **Vertraulich** – z. B. Kundendaten, personenbezogene Daten, Verträge, Angebote, Finanzdaten, Quellcode: **nur in freigegebene Werkzeuge**, soweit für den Zweck nötig.
- **Streng vertraulich** – z. B. Gesundheitsdaten und andere besondere Kategorien personenbezogener Daten, Geschäftsgeheimnisse, M&A, Personalakten, Sicherheitskonfigurationen: **nur mit Einzelfreigabe** bzw. in internen KI-Systemen, die ausdrücklich dafür freigegeben sind.
- **Zugangsdaten** – Passwörter, API-Schlüssel, Tokens, Zertifikate, private Schlüssel: **niemals**, in kein KI-Werkzeug, auch nicht in Code-Ausschnitten.

### Erlaubt oder nicht?

- Eine Pressemitteilung im freigegebenen Werkzeug umformulieren → **erlaubt**.
- Einen Kundenvertrag im kostenlosen Chatbot am Privathandy zusammenfassen → **nicht erlaubt**.
- Ein Protokoll mit Kundennamen im freigegebenen Werkzeug zusammenfassen → **erlaubt**, soweit für den Zweck nötig.
- Eine Fehlermeldung mit eingebettetem API-Schlüssel analysieren lassen → **nicht erlaubt**; entfernen Sie zuerst den Schlüssel.
- Eine Browser-Erweiterung mit KI-Funktion selbst installieren → **nicht erlaubt** ohne Freigabe.

### Das ist nicht erlaubt

- **Zugangsdaten** (Passwörter, Schlüssel, Tokens) in KI-Werkzeuge eingeben – auch in Code-Ausschnitten.
- **Automatisierte Entscheidungen über Menschen** (z. B. Bewerbungsauswahl, Leistungsbewertung) allein durch KI. Der Einsatz von KI im Personalbereich muss vorab freigegeben werden (AI Act, DSGVO, Betriebsrat).
- **Deepfakes realer Personen** ohne deren ausdrückliche Einwilligung und ohne Kennzeichnung.
- **Eigene KI-Agenten, Automatisierungen oder Integrationen** mit Zugriff auf Firmensysteme, Postfächer oder Daten ohne Freigabe.
- **KI-Erweiterungen, Plugins oder MCP-Server** installieren, die nicht freigegeben sind.
- **KI-Meeting-Bots** in Besprechungen ohne Zustimmung aller Teilnehmenden.
- Sperren oder Sicherheitsmaßnahmen umgehen.

### Ihre Pflichten bei der Nutzung

- **Ergebnisse prüfen:** Fakten, Zahlen, Quellen, rechtliche Aussagen und Code vor der Verwendung kontrollieren.
- **KI-generierter Code** durchläuft dieselben Reviews und Tests wie selbst geschriebener Code. Vorgeschlagene Pakete und Bibliotheken prüfen Sie vor der Installation auf Existenz und Vertrauenswürdigkeit.
- **Kennzeichnen:** KI-erzeugte oder -manipulierte Bilder, Audio- und Videoinhalte, die wir veröffentlichen, werden als solche gekennzeichnet (AI Act Art. 50). Kunden-Chatbots müssen als KI erkennbar sein.
- **Urheberrecht und Vertraulichkeitsvereinbarungen** beachten – auch für Inhalte, die Sie in die KI hochladen.
- **Ungewöhnliches Verhalten melden:** Führt ein KI-Assistent unerwartete Aktionen aus, gibt er merkwürdige Anweisungen aus oder greift er auf Daten zu, die nicht passen, melden Sie das sofort.

### KI, die handelt

Für KI-Agenten und Assistenten, die nicht nur antworten, sondern **handeln** (Mails versenden, Dateien ändern, Systeme bedienen), gelten zusätzliche Regeln: minimale Rechte, menschliche Freigabe für Aktionen mit Außenwirkung, kein „gefährliches Dreieck“ aus vertraulichen Daten, fremden Inhalten und einem Ausleitungsweg, Protokollierung und ein Kill-Switch. Jeder solche Agent wird im KI-Inventar erfasst und braucht eine dokumentierte Freigabe.

### Ist doch etwas passiert?

Haben Sie versehentlich Daten in ein nicht freigegebenes Werkzeug eingegeben? **Melden Sie es sofort** an {{meldestelle}}. Schnelles Melden ermöglicht Schadensbegrenzung, etwa eine Passwortänderung oder einen Löschantrag – und es wird nicht sanktioniert.

Vorsätzliche oder grob fahrlässige Verstöße können arbeitsrechtliche Konsequenzen haben. Unser Ziel ist aber, sichere Nutzung zu ermöglichen: Verbesserungsvorschläge zur Richtlinie sind ausdrücklich willkommen.`,
      keyPoints: [
        "Für die Arbeit nur freigegebene KI-Werkzeuge nutzen – keine privaten Konten, Gratis-Dienste, KI-Erweiterungen oder Meeting-Bots.",
        "Öffentliches überall, Internes und Vertrauliches nur in freigegebene Werkzeuge, streng Vertrauliches nur mit Einzelfreigabe.",
        "Zugangsdaten niemals – auch nicht in Code-Ausschnitten.",
        "Ergebnisse prüfen und veröffentlichte KI-Bilder, -Audio- und -Videoinhalte kennzeichnen.",
        "Fehler sofort melden – schnelles Melden wird nicht sanktioniert.",
      ],
    },
    {
      id: "wie-angreifer-ki-nutzen",
      title: "Wie Angreifer KI nutzen",
      minutes: 5,
      body: `Angreifer nutzen KI, um ihre Täuschungen glaubwürdiger zu machen. Die bekannten Warnsignale von früher greifen dabei nicht mehr.

### Phishing ohne Fehler

Phishing-Mails sind heute persönlich, nennen echte Namen und Projekte und sind in perfektem Deutsch geschrieben. **Tippfehler sind kein Warnsignal mehr.** Fehlerfreiheit sagt nichts über die Echtheit – entscheidend ist, was von Ihnen gefordert wird.

### Rechnungsbetrug aus echten Mail-Verläufen

Angreifer lesen in übernommenen Postfächern mit und schreiben im richtigen Ton weiter – zum Beispiel mit der Mitteilung, dass sich die Bankverbindung geändert hat.

### Geklonte Stimmen

Wenige Sekunden Audio genügen, um eine Stimme zu klonen – **auch live am Telefon**.

### Gefälschte Videocalls

Auch Gesichter lassen sich in Echtzeit fälschen. 2024 überwies ein Mitarbeiter in Hongkong nach einem Videocall mit **ausschließlich gefälschten Kollegen** rund 25 Mio. US-Dollar. Ein Videocall mit einem bekannten Gesicht ist kein Identitätsnachweis.

### Falscher IT-Support

Angreifer melden sich per Telefon oder Teams-Chat als IT-Support – oft mit der Bitte, eine **MFA-Anfrage zu bestätigen** oder ein **Fernwartungsprogramm zu installieren**. Unsere IT wird Sie nie nach Ihrem Passwort fragen und nie unaufgefordert um eine MFA-Bestätigung bitten.

### Gefälschte Bewerbungen

KI-erzeugte Lebensläufe und Deepfake-Interviews sollen Angreifern **Zugang zu unseren Systemen** verschaffen. Ziel ist oft nicht der Job, sondern der Zugang.

### Was daraus folgt

**Wir können Echtheit nicht mehr erkennen. Wir können aber prüfen – über einen zweiten Weg.** Wie das geht, erfahren Sie in der Lektion „STOPP · PRÜFEN · BESTÄTIGEN und Melden“. In der Übung „Echt oder Angriff?“ wenden Sie das Gelernte an sechs Situationen an.`,
      keyPoints: [
        "Fehlerfreie, persönliche Mails mit echten Namen und Projekten sind kein Echtheitsbeweis – Tippfehler sind kein Warnsignal mehr.",
        "Stimmen lassen sich aus wenigen Sekunden Audio klonen, Gesichter im Videocall fälschen.",
        "Echter IT-Support bittet nie unaufgefordert um eine MFA-Bestätigung.",
        "Gefälschte Bewerbungen zielen auf den Zugang zu unseren Systemen.",
        "Echtheit lässt sich nicht erkennen – aber über einen zweiten Weg prüfen.",
      ],
    },
    {
      id: "ki-wird-angegriffen",
      title: "Wenn die KI selbst angegriffen wird",
      minutes: 4,
      body: `KI-Assistenten lesen Mails, Dokumente und Webseiten. Genau das macht sie angreifbar.

### Prompt Injection

In diesen Inhalten können **versteckte Anweisungen** stecken – etwa als weißer Text, in Kommentaren oder in Metadaten. Sie selbst sehen davon meist nichts, der Assistent liest sie aber mit und kann dadurch umgesteuert werden. Das nennt man **Prompt Injection**. Eine präparierte Mail kann einen Assistenten zum Beispiel dazu bringen, Informationen weiterzugeben.

### Je mehr ein Assistent darf, desto größer der Schaden

Darf ein Assistent Mails senden, Dateien teilen oder Termine anlegen, wächst der mögliche Schaden. Deshalb geben wir KI-Agenten nur **minimale Rechte**, und **Aktionen mit Außenwirkung bestätigt ein Mensch**.

### Was Sie tun

Wenn ein KI-Assistent etwas Unerwartetes vorschlägt oder tut – Daten an Unbekannte senden, Links öffnen, merkwürdige Anweisungen ausgeben:

1. **Nicht bestätigen.**
2. **Screenshot machen.**
3. **Melden** an {{meldestelle}}.

Fragen Sie nicht den Assistenten selbst, ob die Aktion sicher ist – er könnte gerade manipuliert sein.

### Erweiterungen und Plugins

Installieren Sie nur freigegebene Erweiterungen und Plugins. Auch KI-Werkzeuge können manipuliert sein.`,
      keyPoints: [
        "Versteckte Anweisungen in Mails, Dokumenten oder Webseiten können KI-Assistenten umsteuern (Prompt Injection).",
        "Je mehr ein Assistent darf, desto größer der mögliche Schaden – Aktionen mit Außenwirkung bestätigt ein Mensch.",
        "Schlägt ein Assistent etwas Unerwartetes vor: nicht bestätigen, Screenshot machen, melden.",
        "Nur freigegebene Erweiterungen und Plugins installieren.",
      ],
    },
    {
      id: "stopp-pruefen-bestaetigen",
      title: "STOPP · PRÜFEN · BESTÄTIGEN und Melden",
      minutes: 6,
      body: `Stimmen, Gesichter und Schreibstile lassen sich mit KI täuschend echt fälschen – auch live am Telefon und im Videocall. Fälschungen können wir nicht zuverlässig erkennen. **Deshalb prüfen wir immer über einen zweiten Weg.**

### Wann gilt die Regel?

Immer, wenn jemand – egal wer, auch die Geschäftsführung – Folgendes verlangt:

- eine **Zahlung** ab dem bei Ihnen festgelegten Betrag oder außerhalb des üblichen Ablaufs
- eine **Änderung von Bankverbindungen** (Lieferanten, Kunden, Mitarbeitende)
- das **Zurücksetzen von Passwort oder MFA** oder neue Zugänge
- die **Herausgabe vertraulicher Daten** (Kundendaten, Personaldaten, Verträge, Zugangsdaten)
- eine **Änderung von Berechtigungen** oder Sicherheitseinstellungen
- eine **ungewöhnliche Anweisung**, die vom normalen Prozess abweicht

### Die drei Schritte

1. **STOPP:** Nicht sofort handeln. Beenden Sie das Gespräch freundlich: „Ich melde mich gleich über die bekannte Nummer zurück.“
2. **PRÜFEN:** Rufen Sie über die **hinterlegte Nummer** zurück (Telefonverzeichnis, Stammdaten) – niemals über eine Nummer, Mail oder einen Link aus der Anfrage. Bei Führungskräften fragen Sie das **Codewort** ab.
3. **BESTÄTIGEN:** Beziehen Sie eine **zweite Person** ein (Vier-Augen-Prinzip). Handeln Sie erst nach der Bestätigung – und dokumentieren Sie die Prüfung.

### Das gilt nicht als Bestätigung

- Rückruf an eine Nummer aus der Mail, Signatur oder SMS der Anfrage
- Antwort auf dieselbe E-Mail oder Nachricht
- eine bekannte Stimme am Telefon – Stimmen sind klonbar
- ein Videocall mit bekanntem Gesicht – Gesichter sind fälschbar
- eine Nachricht über Messenger, privates Handy oder ein „neues Konto“
- eine Bestätigung durch die anfragende Person selbst
- eine echt wirkende Absenderadresse

### Rote Flaggen – sofort STOPP

- **Dringlichkeit:** „Das muss in der nächsten Stunde raus.“
- **Geheimhaltung:** „Sprechen Sie mit niemandem darüber.“
- **Ausnahme vom Prozess:** „Diesmal ohne Freigabe, ich übernehme die Verantwortung.“
- **Ungewohnter Kanal:** private Nummer, WhatsApp, neue Mailadresse
- **Druck oder Schmeichelei:** „Ich verlasse mich auf Sie.“

**Kommen zwei oder mehr zusammen, ist es mit hoher Wahrscheinlichkeit ein Angriff.**

### Sie haben Rückendeckung

Die Geschäftsführung hat schriftlich zugesagt: „Niemand in unserem Unternehmen wird kritisiert, weil er oder sie eine Anweisung zur Prüfung verzögert oder bei uns zurückruft – auch dann nicht, wenn die Anweisung echt war. Wir werden Sie niemals bitten, diese Regeln zu umgehen. Wer das verlangt, ist nicht wir.“

### Verdacht? Sofort melden!

- **Verdächtige Mails:** über den Melde-Button im Mailprogramm
- **Informationssicherheit:** {{meldestelle}}
- **Außerhalb der Bürozeiten:** {{notfall}}
- **Geld bereits überwiesen?** **Sofort die Hausbank anrufen:** {{hausbank}} – jede Minute zählt.

**Lieber einmal zu viel gemeldet als einmal zu wenig. Wer schnell meldet, verhindert den Schaden.**`,
      keyPoints: [
        "STOPP: nicht sofort handeln – PRÜFEN: über die hinterlegte Nummer zurückrufen – BESTÄTIGEN: zweite Person einbeziehen.",
        "Bekannte Stimme, Videocall, Antwort auf dieselbe Mail oder die Nummer aus der Anfrage gelten nicht als Bestätigung.",
        "Dringlichkeit, Geheimhaltung, Ausnahme vom Prozess, ungewohnter Kanal, Druck: Kommen zwei zusammen, ist es wahrscheinlich ein Angriff.",
        "Niemand wird für eine Prüfung oder Verzögerung kritisiert – auch dann nicht, wenn die Anweisung echt war.",
        "Verdacht sofort melden; ist Geld schon überwiesen, sofort die Hausbank anrufen.",
      ],
    },
  ],
  scenarios: [
    {
      id: "lieferant-bankverbindung",
      situation:
        "Ein bekannter Lieferant schreibt in einer laufenden Mail-Konversation: „Unsere Bankverbindung hat sich geändert, bitte ab sofort auf das Konto im Anhang zahlen.“ Ton und Signatur stimmen.",
      verdict: "verdacht",
      answer: "Wie einen Angriff behandeln, bis das Gegenteil bestätigt ist",
      explanation:
        "Ob die Mail echt ist, lässt sich nicht erkennen. Rufen Sie über die bei uns hinterlegte Nummer zurück; eine zweite Person gibt die Änderung frei.",
    },
    {
      id: "falscher-it-support",
      situation:
        "Teams-Nachricht von „IT-Support“ (externes Konto): „Wir migrieren Ihr Postfach. Bitte bestätigen Sie gleich die Anmeldeanfrage auf Ihrem Handy.“",
      verdict: "angriff",
      answer: "Angriff",
      explanation:
        "Unsere IT bittet nie unaufgefordert um eine MFA-Bestätigung. Lehnen Sie die Anfrage ab und informieren Sie die IT über die bekannte Nummer.",
    },
    {
      id: "stimme-geschaeftsfuehrung",
      situation:
        "Anruf, eindeutig die Stimme der Geschäftsführung: „Schicken Sie mir bitte die Liste aller Kundenkontakte an meine private Adresse, ich brauche sie morgen früh.“",
      verdict: "verdacht",
      answer: "Rote Flaggen: privater Kanal, vertrauliche Daten, Zeitdruck",
      explanation:
        "Beenden Sie das Gespräch und rufen Sie über die hinterlegte Nummer zurück. Eine bekannte Stimme ist keine Bestätigung – Stimmen sind klonbar.",
    },
    {
      id: "ki-assistent-weiterleitung",
      situation:
        "Sie lassen den KI-Assistenten eine eingegangene Kundenmail zusammenfassen. Danach schlägt er vor, „die aktuelle Rechnungsübersicht an buchhaltung-service@… weiterzuleiten“.",
      verdict: "verdacht",
      answer: "Mögliche Manipulation (Prompt Injection)",
      explanation: "Nicht bestätigen, sondern melden. Die Mail enthielt vermutlich versteckte Anweisungen.",
    },
    {
      id: "privater-chatbot",
      situation:
        "Sie wollen schnell einen Vertragsentwurf mit Kundendaten zusammenfassen und nutzen dafür die kostenlose Version eines Chatbots am Privathandy.",
      verdict: "verstoss",
      answer: "Verstoß gegen die Richtlinie",
      explanation:
        "Verwenden Sie das freigegebene Werkzeug. Ist es schon passiert: sofort melden, damit wir reagieren können. Das wird nicht bestraft.",
    },
    {
      id: "deepfake-bewerbung",
      situation:
        "Im Video-Bewerbungsgespräch ruckelt das Bild, Lippen und Ton passen nicht ganz zusammen, der Bewerber weicht Detailfragen aus und kann seinen Ausweis „wegen kaputter Kamera“ nicht zeigen.",
      verdict: "verdacht",
      answer: "Verdacht auf gefälschte Identität",
      explanation: "Informieren Sie HR. Vor der Vergabe von Zugängen wird die Identität persönlich oder über ID Austria geprüft.",
    },
  ],
  quiz: [
    {
      id: "q1",
      question: "Eine E-Mail ist fehlerfrei, persönlich und bezieht sich auf ein echtes Projekt. Was folgt daraus?",
      options: [
        "Sie ist echt.",
        "Fehlerfreiheit sagt nichts über die Echtheit; entscheidend ist, was gefordert wird.",
        "Sie stammt sicher von einer Kollegin.",
      ],
      correct: 1,
      explanation:
        "KI schreibt fehlerfreie, persönliche Mails mit echten Namen und Projekten – Tippfehler sind kein Warnsignal mehr. Achten Sie darauf, was von Ihnen verlangt wird.",
    },
    {
      id: "q2",
      question: "Die Stimme der Geschäftsführung verlangt am Telefon eine dringende, vertrauliche Überweisung. Was tun Sie?",
      options: [
        "Überweisen, die Stimme ist eindeutig.",
        "Um eine Bestätigungs-Mail bitten.",
        "Gespräch beenden, über die hinterlegte Nummer zurückrufen und eine zweite Person einbeziehen.",
      ],
      correct: 2,
      explanation:
        "Stimmen sind klonbar, und eine Bestätigung durch die anfragende Person selbst zählt nicht. Gültig ist nur der Rückruf über die hinterlegte Nummer mit einer zweiten Person.",
    },
    {
      id: "q3",
      question: "Welche Bestätigung einer Bankdatenänderung ist gültig?",
      options: [
        "Rückruf an die Nummer aus der Signatur der Mail.",
        "Rückruf an die bei uns hinterlegte Nummer und Freigabe durch eine zweite Person.",
        "Ein kurzer Videocall mit dem Ansprechpartner.",
      ],
      correct: 1,
      explanation:
        "Eine Nummer aus der Mail oder Signatur kann vom Angreifer stammen, und Gesichter im Videocall sind fälschbar. Gültig ist nur der Rückruf über die hinterlegte Nummer plus Vier-Augen-Prinzip.",
    },
    {
      id: "q4",
      question: "Was darf in ein freigegebenes Business-KI-Werkzeug eingegeben werden?",
      options: ["Interne und vertrauliche Daten, soweit für den Zweck nötig.", "Alles, auch Passwörter.", "Nur öffentliche Texte."],
      correct: 0,
      explanation:
        "Freigegebene Werkzeuge sind für interne und vertrauliche Daten zugelassen, soweit für den Zweck nötig. Streng Vertrauliches nur mit Einzelfreigabe, Zugangsdaten niemals.",
    },
    {
      id: "q5",
      question: "Was darf niemals in ein KI-Werkzeug eingegeben werden?",
      options: ["Kundennamen.", "Passwörter, API-Schlüssel und andere Zugangsdaten.", "Interne Protokolle."],
      correct: 1,
      explanation:
        "Zugangsdaten gehören in kein KI-Werkzeug – auch nicht in Code-Ausschnitten. Kundennamen und interne Protokolle sind in freigegebenen Werkzeugen erlaubt, soweit für den Zweck nötig.",
    },
    {
      id: "q6",
      question: "Eine KI-Antwort nennt eine konkrete Gesetzesstelle. Was tun Sie?",
      options: [
        "Übernehmen, die KI hat Zugriff auf alle Gesetze.",
        "In der Originalquelle prüfen, bevor Sie sie verwenden.",
        "Eine zweite KI fragen.",
      ],
      correct: 1,
      explanation:
        "KI prüft keine Fakten und kann Gesetzesstellen erfinden, die überzeugend klingen. Rechtliche Aussagen kontrollieren Sie deshalb vor der Verwendung in der Originalquelle.",
    },
    {
      id: "q7",
      question:
        "Ihr KI-Assistent schlägt nach dem Lesen einer externen Mail vor, Dateien an eine unbekannte Adresse zu senden. Was tun Sie?",
      options: ["Bestätigen, der Assistent wird es wissen.", "Nicht bestätigen und melden.", "Den Assistenten fragen, ob das sicher ist."],
      correct: 1,
      explanation:
        "Das ist ein typisches Zeichen für Prompt Injection: Die Mail enthielt vermutlich versteckte Anweisungen. Ein möglicherweise manipulierter Assistent kann die Frage nach der Sicherheit nicht verlässlich beantworten.",
    },
    {
      id: "q8",
      question: "Sie haben versehentlich Kundendaten in einen privaten Chatbot kopiert. Was tun Sie?",
      options: [
        "Nichts, es merkt niemand.",
        "Den Verlauf löschen und schweigen.",
        "Sofort melden, damit wir den Schaden begrenzen können.",
      ],
      correct: 2,
      explanation:
        "Schnelles Melden ermöglicht Schadensbegrenzung, etwa einen Löschantrag – und wird nicht sanktioniert. Wer schweigt, verhindert, dass wir reagieren können.",
    },
    {
      id: "q9",
      question: "Der „IT-Support“ bittet Sie per Teams, eine MFA-Anfrage auf Ihrem Handy zu bestätigen. Was tun Sie?",
      options: [
        "Bestätigen, die IT braucht das für die Migration.",
        "Ablehnen und die IT über die bekannte Nummer informieren.",
        "Erst bestätigen, dann nachfragen.",
      ],
      correct: 1,
      explanation:
        "Unsere IT bittet nie unaufgefordert um eine MFA-Bestätigung – das ist ein typischer Angriff durch falschen IT-Support. Lehnen Sie ab und informieren Sie die IT über die bekannte Nummer.",
    },
    {
      id: "q10",
      question: "Welche Aussage zu Deepfakes stimmt?",
      options: [
        "Ein Videocall mit einem bekannten Gesicht ist kein Identitätsnachweis.",
        "Deepfakes erkennt man immer an ruckelnden Bildern.",
        "Deepfakes sind nur in Filmen ein Thema.",
      ],
      correct: 0,
      explanation:
        "Gesichter lassen sich in Echtzeit fälschen: 2024 überwies ein Mitarbeiter in Hongkong nach einem Videocall mit ausschließlich gefälschten Kollegen rund 25 Mio. US-Dollar. Auf ruckelnde Bilder als Erkennungsmerkmal ist kein Verlass.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Awareness-Jahresplan mit Monatsimpulsen (Anhang L)
// ---------------------------------------------------------------------------

export const MONTHLY_IMPULSES: MonthlyImpulse[] = [
  {
    month: 1,
    title: "Warum KI alles verändert",
    action: "Live-Deepfake-Demonstration bei Mitarbeiterveranstaltung",
    audience: "alle",
    subject: "Sicherheitsimpuls: Warum KI alles verändert",
    text: "Früher erkannte man Betrugsmails an Rechtschreibfehlern und holpriger Sprache. Das ist vorbei: KI schreibt fehlerfreie, persönliche Nachrichten in perfektem Deutsch – und kann mit wenigen Sekunden Audiomaterial jede Stimme nachahmen, sogar live am Telefon. In Videocalls lassen sich Gesichter in Echtzeit fälschen.\n\nWas das für Sie heißt: Verlassen Sie sich nicht auf Ihr Gefühl, ob etwas echt ist. Verlassen Sie sich auf unsere Prozesse. Wie die funktionieren, erfahren Sie in den nächsten Monaten.",
  },
  {
    month: 2,
    title: "STOPP · PRÜFEN · BESTÄTIGEN",
    action: "Verteilung des Einseiters „STOPP · PRÜFEN · BESTÄTIGEN“",
    audience: "Finanzen, Assistenz",
    subject: "Sicherheitsimpuls: STOPP · PRÜFEN · BESTÄTIGEN",
    text: "Wenn jemand eine Zahlung, eine Bankdatenänderung, ein Passwort-Reset oder vertrauliche Daten will – egal wer, auch die Geschäftsführung:\n– STOPP: nicht sofort handeln.\n– PRÜFEN: über die hinterlegte Nummer zurückrufen, nie über die Nummer aus der Nachricht.\n– BESTÄTIGEN: zweite Person einbeziehen.\n\nUnd: Niemand wird kritisiert, weil er oder sie zurückruft. Das ist ausdrücklich gewünscht.",
  },
  {
    month: 3,
    title: "Phishing ohne Tippfehler",
    action: "1. Phishing-Simulation (KI-generiert)",
    audience: "alle",
    subject: "Sicherheitsimpuls: Phishing ohne Tippfehler",
    text: "Die gefährlichsten Phishing-Mails wirken völlig normal: Sie beziehen sich auf echte Projekte, nennen echte Namen und kommen scheinbar von bekannten Absendern. Achten Sie stattdessen auf die Situation: Werden Sie zu einer Anmeldung, einer Zahlung oder dem Öffnen einer Datei gedrängt? Kommt die Nachricht unerwartet? Dann lieber einmal melden.\n\nDiesen Monat erhalten einige von Ihnen eine Übungs-Phishing-Mail. Melden Sie sie über den Melde-Button!",
  },
  {
    month: 4,
    title: "Passkeys statt Passwörter",
    action: "Unterstützung bei der Passkey-Einrichtung",
    audience: "alle",
    subject: "Sicherheitsimpuls: Passkeys statt Passwörter",
    text: "Passwörter und Einmal-Codes können auf gefälschten Anmeldeseiten abgefangen werden – auch wenn die Seite täuschend echt aussieht. Passkeys funktionieren nur auf der echten Seite und sind deshalb praktisch nicht phishbar. Außerdem sind sie bequemer: Fingerabdruck oder Gesichtserkennung statt Tippen.\n\nWir stellen schrittweise um. Bei der Einrichtung unterstützt Sie unsere IT.",
  },
  {
    month: 5,
    title: "KI sicher nutzen",
    action: "Basisschulung KI-Kompetenz",
    audience: "alle KI-Nutzenden",
    subject: "Sicherheitsimpuls: KI sicher nutzen",
    text: "KI-Werkzeuge sind großartige Helfer – solange wir drei Regeln beachten:\n1. Nur freigegebene Werkzeuge nutzen – welche das sind, steht in unserer KI-Nutzungsrichtlinie.\n2. Nie Passwörter oder Zugangsdaten eingeben; vertrauliche Daten nur in freigegebene Werkzeuge.\n3. Ergebnisse immer prüfen – KI kann überzeugend falsch liegen.\n\nVersehentlich etwas Falsches eingegeben? Sofort melden – dann können wir reagieren.",
  },
  {
    month: 6,
    title: "Der falsche IT-Support",
    action: "Vishing-Test beim Helpdesk (abgestimmt)",
    audience: "IT-Helpdesk, alle",
    subject: "Sicherheitsimpuls: Der falsche IT-Support",
    text: "Angreifer rufen an oder schreiben per Teams: „Hier ist die IT, wir müssen kurz Ihr Konto prüfen – bitte bestätigen Sie die Anmeldung auf Ihrem Handy“ oder „Bitte installieren Sie dieses Fernwartungsprogramm.“\n\nUnsere IT wird Sie nie nach Ihrem Passwort fragen und nie unaufgefordert um eine MFA-Bestätigung bitten. Im Zweifel auflegen und die IT über die bekannte Nummer zurückrufen.",
  },
  {
    month: 7,
    title: "Rechnungsbetrug",
    action: "2. Phishing-Simulation (gefälschte Lieferantenmail)",
    audience: "Finanzen, Einkauf",
    subject: "Sicherheitsimpuls: Rechnungsbetrug",
    text: "Ein Lieferant schreibt: „Wir haben eine neue Bankverbindung, bitte ab sofort auf dieses Konto überweisen.“ Die Mail kommt aus einer echten Konversation, der Ton stimmt – denn Angreifer haben oft das Postfach des Lieferanten übernommen und lesen mit.\n\nRegel: Bankdaten ändern wir nur nach Rückruf über die bei uns hinterlegte Nummer und mit Freigabe einer zweiten Person. Immer.",
  },
  {
    month: 8,
    title: "Unterwegs und im Urlaub",
    action: null,
    audience: "alle, Führungskräfte",
    subject: "Sicherheitsimpuls: Unterwegs und im Urlaub",
    text: "Betrüger nutzen gezielt Zeiten, in denen Führungskräfte schwer erreichbar sind – Urlaub, Dienstreisen, Freitagnachmittag. „Ich bin gerade im Flieger, bitte erledigen Sie das schnell für mich“ ist ein klassischer Einstieg.\n\nWenn eine Führungskraft wirklich nicht erreichbar ist, gilt: Dann wartet die Zahlung. Das ist kein Fehler, sondern genau richtig.",
  },
  {
    month: 9,
    title: "Gefälschte Bewerbungen und Identitäten",
    action: "Briefing HR",
    audience: "HR, Führungskräfte",
    subject: "Sicherheitsimpuls: Gefälschte Bewerbungen und Identitäten",
    text: "KI erzeugt überzeugende Lebensläufe, Zeugnisse und sogar Video-Bewerbungsgespräche mit fremden Gesichtern. Ziel ist oft nicht der Job, sondern der Zugang zu unseren Systemen.\n\nDeshalb prüfen wir Identitäten vor der Vergabe von Zugängen und starten neue Kolleginnen und Kollegen mit minimalen Rechten. Fällt Ihnen im Bewerbungsprozess etwas Merkwürdiges auf (Kamera „defekt“, Verzögerungen zwischen Bild und Ton, ausweichende Antworten zu Details), sprechen Sie HR an.",
  },
  {
    month: 10,
    title: "Wenn die KI selbst angegriffen wird",
    action: "Briefing für Agenten-Verantwortliche",
    audience: "KI-Nutzende, Entwicklung",
    subject: "Sicherheitsimpuls: Wenn die KI selbst angegriffen wird",
    text: "KI-Assistenten, die Mails lesen oder Dokumente verarbeiten, können durch versteckte Anweisungen in diesen Inhalten manipuliert werden („Prompt Injection“). Eine präparierte Mail kann den Assistenten z. B. dazu bringen, Informationen weiterzugeben.\n\nWas Sie tun können: Wenn Ihr KI-Assistent etwas Unerwartetes tut oder vorschlägt – Daten senden, Links öffnen, ungewöhnliche Anweisungen geben –, nicht bestätigen und melden.",
  },
  {
    month: 11,
    title: "Melden lohnt sich",
    action: "3. Phishing-Simulation; Auszeichnung der besten „Melder/innen“",
    audience: "alle",
    subject: "Sicherheitsimpuls: Melden lohnt sich",
    text: "Jede Meldung hilft: Wenn eine Person eine Phishing-Mail meldet, können wir sie oft bei allen anderen löschen, bevor jemand klickt. Und wer schon geklickt hat und es sofort meldet, verhindert meist größeren Schaden.\n\nDanke an alle, die dieses Jahr gemeldet haben! Verdächtiges melden Sie weiterhin über den Melde-Button oder an {{meldestelle}}.",
  },
  {
    month: 12,
    title: "Jahresrückblick: Was wir abgewehrt haben",
    action: "Notfallübung Geschäftsführung",
    audience: "alle, Geschäftsführung",
    subject: "Sicherheitsimpuls: Jahresrückblick",
    text: "Ein Jahr lang ging es in diesen Impulsen darum, wie KI Angriffe verändert – von geklonten Stimmen über Rechnungsbetrug bis zu manipulierten KI-Assistenten. Jeder Rückruf, jede Prüfung über einen zweiten Weg und jede Meldung macht es Angreifern schwerer.\n\nDanke für Ihre Aufmerksamkeit. Im nächsten Jahr bleiben wir dran – denn die Angreifer tun es auch.",
  },
];

// ---------------------------------------------------------------------------
// Selbstbewertung: Wie gut sind wir gegen KI-Angriffe geschützt? (Anhang F)
// ---------------------------------------------------------------------------

export const SELF_ASSESSMENT: SelfAssessment = {
  scale: [
    { points: 2, label: "Ja" },
    { points: 1, label: "Teilweise" },
    { points: 0, label: "Nein" },
  ],
  sections: [
    {
      id: "1",
      title: "Governance und Compliance",
      max: 12,
      questions: [
        { id: "1.1", text: "Gibt es eine benannte, verantwortliche Person für Informationssicherheit und für KI?", key: true },
        { id: "1.2", text: "Ist ein vollständiges KI-Inventar vorhanden (inkl. KI-Funktionen in bestehender Software)?", key: true },
        { id: "1.3", text: "Ist eine KI-Nutzungsrichtlinie in Kraft und allen bekannt?", key: true },
        { id: "1.4", text: "Sind KI-spezifische Risiken in der Risikoanalyse berücksichtigt?", key: false },
        { id: "1.5", text: "Ist geklärt, ob wir unter das NISG 2026 fallen (und ggf. registriert bis 31.12.2026)?", key: true },
        { id: "1.6", text: "Erhält die Geschäftsführung regelmäßig einen Bericht zur Sicherheitslage?", key: false },
      ],
    },
    {
      id: "2",
      title: "Identitäten und Zugriffe",
      max: 14,
      questions: [
        { id: "2.1", text: "Nutzen alle privilegierten Konten phishing-resistente MFA (Passkeys/FIDO2)?", key: true },
        { id: "2.2", text: "Nutzen alle übrigen Konten phishing-resistente MFA?", key: false },
        { id: "2.3", text: "Ist Legacy-Authentifizierung (ohne MFA) blockiert?", key: true },
        { id: "2.4", text: "Erfolgen Passwort-/MFA-Resets nur nach starker Identitätsprüfung (Rückruf + zweite Bestätigung)?", key: true },
        { id: "2.5", text: "Ist die Zustimmung zu Drittanbieter-Apps für normale Benutzer gesperrt?", key: false },
        { id: "2.6", text: "Sind Admin-Rechte getrennt, zeitlich begrenzt und ohne dauerhafte globale Administratoren?", key: false },
        { id: "2.7", text: "Haben KI-Agenten und Dienstkonten eigene, eng begrenzte Identitäten?", key: false },
      ],
    },
    {
      id: "3",
      title: "Prozesse gegen Täuschung",
      max: 14,
      questions: [
        {
          id: "3.1",
          text: "Gibt es verbindliche, schriftliche Verifikationsregeln für Zahlungen, Bankdatenänderungen und Resets?",
          key: true,
        },
        { id: "3.2", text: "Erfolgt jeder Rückruf ausschließlich über hinterlegte Kontaktdaten?", key: true },
        { id: "3.3", text: "Ist das Vier-Augen-Prinzip im Zahlungsverkehr technisch erzwungen?", key: true },
        { id: "3.4", text: "Gibt es ein Codewort-Verfahren für Geschäftsführung, Assistenz und Finanzen?", key: false },
        { id: "3.5", text: "Hat die Geschäftsführung schriftlich Rückendeckung für Prüfungen und Verzögerungen gegeben?", key: false },
        { id: "3.6", text: "Werden Lieferanten- und Kundenbankdaten nur nach dokumentiertem Rückruf geändert?", key: false },
        { id: "3.7", text: "Wird die Identität neuer Mitarbeitender vor Vergabe von Zugängen verlässlich geprüft?", key: false },
      ],
    },
    {
      id: "4",
      title: "Technische Abwehr",
      max: 18,
      questions: [
        { id: "4.1", text: "Sind SPF, DKIM und DMARC (mind. p=quarantine, Ziel p=reject) für alle Domains aktiv?", key: true },
        { id: "4.2", text: "Erkennt der E-Mail-Schutz BEC, Lookalike-Domains und Erstkontakte verhaltensbasiert?", key: false },
        { id: "4.3", text: "Ist verhaltensbasiertes EDR auf allen Endgeräten und Servern aktiv?", key: true },
        { id: "4.4", text: "Werden aktiv ausgenutzte Lücken an extern erreichbaren Systemen binnen 48 Stunden geschlossen?", key: true },
        { id: "4.5", text: "Wird die externe Angriffsfläche regelmäßig gescannt?", key: false },
        { id: "4.6", text: "Gibt es eine offline bzw. unveränderliche Sicherung, deren Wiederherstellung getestet wurde?", key: true },
        { id: "4.7", text: "Sind lokale Administratorrechte entfernt und Makros eingeschränkt?", key: false },
        { id: "4.8", text: "Werden Identitäts-, E-Mail-, Endgeräte-, Cloud- und KI-Protokolle zentral gesammelt?", key: false },
        { id: "4.9", text: "Ist das Netzwerk segmentiert?", key: false },
      ],
    },
    {
      id: "5",
      title: "Sichere KI-Nutzung",
      max: 16,
      questions: [
        {
          id: "5.1",
          text: "Steht ein freigegebenes KI-Werkzeug mit Business-Vertrag (kein Training mit unseren Daten) bereit?",
          key: true,
        },
        { id: "5.2", text: "Werden nicht freigegebene KI-Dienste blockiert oder mit Warnung versehen?", key: false },
        { id: "5.3", text: "Wurden Berechtigungen bereinigt, bevor KI-Suche oder Office-Assistenten aktiviert wurden?", key: true },
        { id: "5.4", text: "Benötigen Aktionen von KI-Agenten mit Außenwirkung eine menschliche Freigabe?", key: false },
        {
          id: "5.5",
          text: "Ist sichergestellt, dass kein Agent das „gefährliche Dreieck“ (vertrauliche Daten + fremde Inhalte + Ausleitungsweg) ohne Kontrolle vereint?",
          key: false,
        },
        { id: "5.6", text: "Werden Plugins, Erweiterungen und MCP-Server nur von einer Allowlist zugelassen?", key: false },
        { id: "5.7", text: "Wird KI-generierter Code wie anderer Code geprüft (Review, SAST, Abhängigkeiten)?", key: false },
        { id: "5.8", text: "Wurden eigene KI-Anwendungen vor Inbetriebnahme gegen Prompt Injection getestet?", key: false },
      ],
    },
    {
      id: "6",
      title: "Menschen",
      max: 10,
      questions: [
        { id: "6.1", text: "Wurden alle Mitarbeitenden zu KI-Phishing, Deepfakes und den Verifikationsregeln geschult?", key: true },
        {
          id: "6.2",
          text: "Erhalten Risikogruppen (Finanzen, Assistenz, HR, Helpdesk, Geschäftsführung) gezielte Schulungen?",
          key: false,
        },
        { id: "6.3", text: "Finden regelmäßig realistische Simulationen statt (inkl. KI-generiertem Phishing)?", key: false },
        { id: "6.4", text: "Gibt es einen einfachen Meldeweg (z. B. Melde-Button) und eine Melderate ≥ 70 %?", key: true },
        { id: "6.5", text: "Ist die Schulung zur KI-Kompetenz (AI Act Art. 4) dokumentiert?", key: false },
      ],
    },
    {
      id: "7",
      title: "Erkennung und Reaktion",
      max: 12,
      questions: [
        { id: "7.1", text: "Werden sicherheitsrelevante Alarme rund um die Uhr bearbeitet (SOC/MDR)?", key: true },
        {
          id: "7.2",
          text: "Gibt es Erkennungsregeln für Kontoübernahme (neue MFA-Methode, Posteingangsregeln, App-Zustimmungen)?",
          key: false,
        },
        {
          id: "7.3",
          text: "Existiert ein Incident-Response-Plan mit Playbooks für Deepfake-Betrug, Kontoübernahme und KI-Missbrauch?",
          key: true,
        },
        { id: "7.4", text: "Sind Meldewege und Fristen (NISG, DSGVO) sowie Notfallkontakte dokumentiert?", key: true },
        { id: "7.5", text: "Wurde im letzten Jahr eine Notfallübung mit der Geschäftsführung durchgeführt?", key: false },
        { id: "7.6", text: "Ist geklärt, ob die Cyber-Versicherung Social Engineering/„Fake President“ deckt?", key: false },
      ],
    },
  ],
  max: 96,
  ratings: [
    { min: 0, label: "Hohes Risiko", text: "Sofort Phase 1 der Roadmap umsetzen, Fokus auf alle ★-Fragen" },
    { min: 39, label: "Grundschutz teilweise vorhanden", text: "Offene ★-Fragen schließen, dann Phase 2" },
    { min: 68, label: "Guter Schutz", text: "Phase 3 – Reife, Tests, Automatisierung" },
    { min: 87, label: "Sehr guter Schutz", text: "Halten, regelmäßig üben, Bedrohungslage beobachten" },
  ],
};

// ---------------------------------------------------------------------------
// Verifikationsregeln: STOPP · PRÜFEN · BESTÄTIGEN (Anhang E)
// ---------------------------------------------------------------------------

export const VERIFICATION_RULES: VerificationRules = {
  title: "Verifikationsregeln: STOPP · PRÜFEN · BESTÄTIGEN",
  intro:
    "Stimmen, Gesichter und Schreibstile lassen sich heute mit KI täuschend echt fälschen – auch live am Telefon und im Videocall. Wir können Fälschungen nicht zuverlässig erkennen. Deshalb prüfen wir immer über einen zweiten Weg.\n\nDie Regel gilt immer – egal, wer etwas verlangt, auch die Geschäftsführung.",
  when: [
    "eine Zahlung ab dem bei Ihnen festgelegten Betrag oder außerhalb des üblichen Ablaufs",
    "eine Änderung von Bankverbindungen (Lieferanten, Kunden, Mitarbeitende)",
    "das Zurücksetzen von Passwort oder MFA oder neue Zugänge",
    "die Herausgabe vertraulicher Daten (Kundendaten, Personaldaten, Verträge, Zugangsdaten)",
    "eine Änderung von Berechtigungen oder Sicherheitseinstellungen",
    "eine ungewöhnliche Anweisung, die vom normalen Prozess abweicht",
  ],
  steps: [
    { name: "STOPP", text: "Nicht sofort handeln. Gespräch freundlich beenden: „Ich melde mich gleich über die bekannte Nummer zurück.“" },
    {
      name: "PRÜFEN",
      text: "Rückruf über die hinterlegte Nummer (Telefonverzeichnis, Stammdaten) – niemals über eine Nummer, Mail oder einen Link aus der Anfrage. Bei Führungskräften: Codewort abfragen.",
    },
    {
      name: "BESTÄTIGEN",
      text: "Zweite Person einbeziehen (Vier-Augen-Prinzip). Erst nach Bestätigung handeln – und die Prüfung dokumentieren.",
    },
  ],
  notValid: [
    "Rückruf an eine Nummer aus der Mail, Signatur oder SMS der Anfrage",
    "Antwort auf dieselbe E-Mail oder Nachricht",
    "Bekannte Stimme am Telefon – Stimmen sind klonbar",
    "Videocall mit bekanntem Gesicht – Gesichter sind fälschbar",
    "Nachricht über Messenger, privates Handy oder ein „neues Konto“",
    "Bestätigung durch die anfragende Person selbst",
    "Eine echt wirkende Absenderadresse",
  ],
  redFlags: [
    "Dringlichkeit: „Das muss in der nächsten Stunde raus.“",
    "Geheimhaltung: „Sprechen Sie mit niemandem darüber.“",
    "Ausnahme vom Prozess: „Diesmal ohne Freigabe, ich übernehme die Verantwortung.“",
    "Ungewohnter Kanal: private Nummer, WhatsApp, neue Mailadresse",
    "Druck oder Schmeichelei: „Ich verlasse mich auf Sie.“",
    "Kommen zwei oder mehr dieser Signale zusammen, ist es mit hoher Wahrscheinlichkeit ein Angriff.",
  ],
  backing:
    "„Niemand in unserem Unternehmen wird kritisiert, weil er oder sie eine Anweisung zur Prüfung verzögert oder bei uns zurückruft – auch dann nicht, wenn die Anweisung echt war. Wir werden Sie niemals bitten, diese Regeln zu umgehen. Wer das verlangt, ist nicht wir.“\n\n– Die Geschäftsführung von {{firma}}",
  report: [
    { label: "Informationssicherheit", value: "{{meldestelle}}" },
    { label: "Außerhalb der Bürozeiten", value: "{{notfall}}" },
    { label: "Geld bereits überwiesen?", value: "Sofort Hausbank anrufen: {{hausbank}} – jede Minute zählt" },
  ],
};
