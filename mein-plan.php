<?php
// Mein Dienstplan: die veröffentlichten Wochen für Mitarbeitende am Handy, ohne Anmeldung.
//
// Jede Person bekommt aus der App einen persönlichen Link (mein-plan.php?p=CODE, per WhatsApp
// oder E-Mail). Beim ersten Öffnen merkt sich das Handy den Code (Cookie), danach genügt
// mein-plan.php, z. B. als Symbol am Startbildschirm. Dort sieht die Person ihre Einsätze
// (Zeit, Objekt, Adresse, Hinweise, Fahrten, Stunden, Zeitkonto) und kann Urlaub, Zeitausgleich
// oder Pflegefreistellung beantragen oder sich krank melden. Das Büro bekommt dazu einen
// Push (ntfy) bzw. eine E-Mail, die App zeigt den Antrag unter „Zu erledigen“.
//
// Gespeichert wird nur, was die App beim Veröffentlichen schickt: je Person eine Datei unter
// privat/mitarbeiter/ (Name nur über den Hashwert des Codes auffindbar), dazu die Anträge.
// Der Ordner privat/ ist per .htaccess gesperrt.
//
// Einsatzbörse: Die App schickt je Person die offenen Einsätze, die sie laut Regeln übernehmen darf
// (eingeschult, verfügbar, Ruhezeit). „Ich übernehme“ meldet das dem Büro; eingeteilt wird in der App.
//
// Zeiterfassung: Am Objekt hängt ein QR-Code (mein-plan.php?o=CODE). Das Handy kennt die Person
// (Cookie vom persönlichen Link); „Kommen“ und „Gehen“ nimmt die Uhrzeit des Servers. Der Cronjob
// (aktion=pruefen) meldet dem Büro, wer laut Plan seit einigen Minuten im Dienst sein sollte und
// sich nicht eingestempelt hat (nur bei Personen, die schon einmal gestempelt haben).
//
// Material fehlt? (aktion=material): Die Person wählt eines ihrer Objekte laut Plan und schreibt,
// was fehlt. Das Büro bekommt einen Push; die App übernimmt die Meldung als Anforderung ins Lager.
// Gerät kaputt? (aktion=geraet): ebenso mit Objekt, Gerät (Nummer vom QR-Etikett oder Bezeichnung) und was kaputt
// ist, ohne Foto; die App übernimmt die Meldung als Schaden unter „Geräte & Maschinen“ (Reparaturen).
//
// Sprachen: Seite, Formulare, Hinweise und die Push-Nachrichten an die Person erscheinen in ihrer Sprache
// (Deutsch, Bosnisch/Kroatisch/Serbisch, Rumänisch, Türkisch, Ungarisch, Englisch; Texte in
// mein-plan-texte.php). Standard ist die Sprache aus dem Stammblatt (die App schickt sie beim Übertragen
// mit, personen[].sprache); oben auf der Seite lässt sie sich umstellen (?sprache=, das Gerät merkt sie
// sich, Push folgt der Wahl). Objektanweisungen kommen übersetzt aus der App (woche.objektinfo); ist eine
// Übersetzung veraltet, steht der deutsche Text dabei. Nachrichten ans Büro bleiben deutsch.
//
// Mitteilungen (Lesebestätigung): Die App schickt die laufenden und geplanten Mitteilungen mit den Hashwerten der Links
// ihrer Empfänger (aktion=mitteilungen), Anhänge einzeln (aktion=mitteilung-anhang). Oben auf der Seite stehen nur die
// Mitteilungen der Person, in ihrer Sprache (Umschalter „Deutsch zeigen“); „Gelesen“ bzw. „Verstanden“ speichert den
// Zeitpunkt des Servers (höchstens MIT_GRENZE_TAG je Person und Tag), die App holt ihn ab (aktion=mitteilungen-status).
// Anhänge liegen unter privat/mitarbeiter/mitteilungen/ und kommen nur über diese Seite (aktion=anhang, Empfänger).
//
// Aufrufe der App (Schlüssel im Kopf X-Schluessel): aktion=speichern | antraege | antrag-status | einrichten | zeiten
// | mitteilungen | mitteilung-anhang | mitteilungen-status
// Cronjob: mein-plan.php?aktion=pruefen&schluessel=PRÜFSCHLÜSSEL oder php mein-plan.php pruefen

declare(strict_types=1);

// Fehler nie in die Antwort (Serverpfade, Stacktraces), nur ins Fehlerprotokoll des Webspace
if (PHP_SAPI !== 'cli') {
    ini_set('display_errors', '0');
}

require __DIR__ . '/wetter-lib.php';
require __DIR__ . '/webspace-lib.php';

const COOKIE = 'mein_plan';
const ARTEN = ['Urlaub', 'Zeitausgleich', 'Pflegefreistellung', 'Krankenstand'];
const STATUS_TEXT = ['offen' => 'offen', 'genehmigt' => 'genehmigt', 'abgelehnt' => 'abgelehnt', 'erledigt' => 'eingetragen'];
const ABWESENHEITEN = 'Urlaub|Krankenstand|Zeitausgleich|Pflegefreistellung|Sonstiges';
// Hinweise der App zu einem Einsatz (Wochenzettel, deutsch) → Text in der Sprache der Person. Was hier
// nicht steht (eigene Notizen, Müll), bleibt deutsch; Datumsangaben wie „Mo 02.11.“ werden umgeschrieben.
const NOTIZ_MUSTER = [
    '/^danach (?<n>\d+) min Fahrt zu (?<ziel>.+)$/u' => 'notiz_fahrt_zu',
    '/^danach (?<n>\d+) min Fahrt$/u' => 'notiz_fahrt',
    '/^Fahrt: (?<text>.+)$/u' => 'notiz_fahrt_text',
    '/^Vertretung für (?<namen>.+)$/u' => 'notiz_vertretung_fuer',
    '/^Vertretung: (?<namen>.+)$/u' => 'notiz_vertretung',
    '/^verschoben von (?<datum>.+) \(Feiertag\)$/u' => 'notiz_verschoben_von_feiertag',
    '/^verschoben von (?<datum>.+)$/u' => 'notiz_verschoben_von',
    '/^verschoben auf (?<datum>.+)$/u' => 'notiz_verschoben_auf',
    '/^Zeit diese Woche geändert$/u' => 'notiz_zeit_geaendert',
    '/^entfällt diese Woche$/u' => 'notiz_entfaellt_woche',
    '/^entfällt: (?<name>.+)$/u' => 'notiz_entfaellt_feiertag',
    '/^Feiertag angerechnet$/u' => 'notiz_feiertag_angerechnet',
    '/^nicht besetzt$/u' => 'notiz_nicht_besetzt',
    '/^(?<n>\d+) min Pause abgezogen$/u' => 'notiz_pause',
    '/^inkl\. (?<n>\d+) % Feiertagszuschlag$/u' => 'notiz_zuschlag_feiertag',
    '/^inkl\. (?<n>\d+) % Sonntagszuschlag$/u' => 'notiz_zuschlag_sonntag',
    '/^(?<n>\d+) % Feiertagszuschlag wird ausbezahlt$/u' => 'notiz_zuschlag_feiertag_bezahlt',
    '/^(?<n>\d+) % Sonntagszuschlag wird ausbezahlt$/u' => 'notiz_zuschlag_sonntag_bezahlt',
    '/^Zeitausgleich \(aus dem Zeitkonto\)$/u' => 'notiz_za_konto',
    '/^Feiertag \((?<art>' . ABWESENHEITEN . ')\) angerechnet$/u' => 'notiz_feiertag_art_angerechnet',
    '/^Feiertag \((?<art>' . ABWESENHEITEN . ')\)$/u' => 'notiz_feiertag_art',
    '/^(?<art>' . ABWESENHEITEN . ') angerechnet$/u' => 'notiz_angerechnet',
];

/** Stand eines Antrags in der Sprache der Seite (oder $s), je nach Art (Einsatz, Abgabe, Material, sonst Antrag). */
function status_text(array $a, ?string $s = null): string
{
    $status = (string) ($a['status'] ?? '');
    $gruppe = ['Einsatz' => 'einsatz', 'Abgabe' => 'abgabe', 'Material' => 'material', 'Geraet' => 'geraet'][$a['art'] ?? ''] ?? 'status';
    return isset(STATUS_TEXT[$status]) ? t($gruppe . '_' . $status, [], $s) : $status;
}

/** Art eines Antrags oder einer Abwesenheit (Urlaub, Krankenstand …) in der Sprache; Unbekanntes bleibt. */
function art_text(string $art, ?string $s = null): string
{
    $key = 'art_' . strtolower($art);
    return isset(texte()['de'][$key]) ? t($key, [], $s) : $art;
}

/** Deutsche Datumsangaben der App („Mo 02.11.“) in der Sprache schreiben. */
function datum_umschreiben(string $text, ?string $s = null): string
{
    $s ??= sprache();
    if ($s === 'de') {
        return $text;
    }
    $tage = t_liste('tage', $s);
    $de = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    return preg_replace_callback('/\b(Mo|Di|Mi|Do|Fr|Sa|So) (\d\d)\.(\d\d)\./u', fn ($m) => t('datum', ['tag' => $tage[(int) array_search($m[1], $de, true)], 'd' => $m[2], 'm' => $m[3]], $s), $text) ?? $text;
}

/** Hinweis zu einem Einsatz (aus dem Wochenzettel der App) in der Sprache; Deutsch bleibt unverändert. */
function notiz_text(string $n, ?string $s = null): string
{
    $s ??= sprache();
    if ($s === 'de') {
        return $n;
    }
    foreach (NOTIZ_MUSTER as $muster => $key) {
        if (preg_match($muster, $n, $m)) {
            $werte = array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY);
            if (isset($werte['datum'])) {
                $werte['datum'] = datum_umschreiben($werte['datum'], $s);
            }
            if (isset($werte['art'])) {
                $werte['art'] = art_text($werte['art'], $s);
            }
            if (($werte['ziel'] ?? '') === 'nächstem Einsatz') {
                $werte['ziel'] = t('naechster_einsatz', [], $s);
            }
            return t($key, $werte, $s);
        }
    }
    if (preg_match('/^(' . ABWESENHEITEN . ')$/u', $n)) {
        return art_text($n, $s);
    }
    return datum_umschreiben($n, $s);
}

/** Antwort des Büros: die festen Sätze der App übersetzt, eigene Begründungen bleiben, wie sie sind. */
function antwort_text(string $antwort, ?string $s = null): string
{
    $s ??= sprache();
    if ($antwort === '' || $s === 'de') {
        return $antwort;
    }
    foreach (texte()['de'] as $key => $de) {
        if (!is_string($de) || !str_starts_with((string) $key, 'antwort_')) {
            continue;
        }
        if ($de === $antwort) {
            return t((string) $key, [], $s);
        }
        if (str_contains($de, '{name}') && preg_match('/^' . str_replace('\{name\}', '(?<name>.+)', preg_quote($de, '/')) . '$/u', $antwort, $m)) {
            return t((string) $key, ['name' => $m['name']], $s);
        }
    }
    return $antwort;
}

/**
 * Objektanweisung zu einem Einsatz als HTML für „Objektinfo“: auf Deutsch der Text der App; in einer anderen
 * Sprache die Übersetzung, ist sie veraltet (deutscher Text geändert) oder fehlt sie, der deutsche Text mit
 * Hinweis. $info: woche.objektinfo[objektId] = { hinweis, uebersetzt: { tr: { text, veraltet } } }.
 */
function objektinfo_html(array $x, ?array $info): string
{
    $h = fn (string $t): string => htmlspecialchars($t, ENT_QUOTES);
    $de = trim((string) ($info['hinweis'] ?? $x['hinweis'] ?? ''));
    if ($de === '') {
        return '';
    }
    $s = sprache();
    $deutsch = '<p' . ($s === 'de' ? '' : ' lang="de"') . '>' . nl2br($h($de)) . '</p>';
    if ($s === 'de') {
        return $deutsch;
    }
    $u = is_array($info['uebersetzt'][$s] ?? null) ? $info['uebersetzt'][$s] : [];
    $text = trim((string) ($u['text'] ?? ''));
    $lang = html_sprache($s);
    if ($text !== '' && empty($u['veraltet'])) {
        return '<p lang="' . $h($lang) . '">' . nl2br($h($text)) . '</p>';
    }
    if ($text !== '') {
        return '<p class="veraltet">' . th('hinweis_veraltet') . '</p>' . $deutsch . '<p class="leise">' . th('hinweis_alt') . '<br><span lang="' . $h($lang) . '">' . nl2br($h($text)) . '</span></p>';
    }
    return '<p class="leise">' . th('hinweis_nur_deutsch') . '</p>' . $deutsch;
}

/** Objekte der Person laut Plan (vorige Woche bis zuletzt veröffentlicht): id → Name, für „Material fehlt?“. */
function meine_objekte(array $person): array
{
    $ab = tag_plus(heute(), -14);
    $out = [];
    foreach ((array) ($person['wochen'] ?? []) as $w) {
        foreach ((array) ($w['tage'] ?? []) as $t) {
            if (($t['datum'] ?? '') < $ab) {
                continue;
            }
            foreach ((array) ($t['eintraege'] ?? []) as $x) {
                if (!empty($x['objektId']) && !empty($x['objekt'])) {
                    $out[(string) $x['objektId']] = (string) $x['objekt'];
                }
            }
        }
    }
    asort($out);
    return $out;
}

/** Offene Einsätze für eine Person (Einsatzbörse). */
function angebote_von(string $hash): array
{
    return array_values(array_filter((array) (json_lesen(speicher() . '/angebote.json')[$hash] ?? []), fn ($o) => is_array($o) && ($o['datum'] ?? '') >= heute()));
}

/** Formular von einer fremden Seite? (Browser schicken Sec-Fetch-Site mit) */
function fremde_herkunft(): bool
{
    $herkunft = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    return $herkunft !== '' && $herkunft !== 'same-origin' && $herkunft !== 'none';
}

function jetzt(): int
{
    $t = getenv('WETTER_JETZT'); // nur für Tests
    return $t !== false && $t !== '' ? (int) $t : time();
}

function ordner(): string
{
    return getenv('MEIN_PLAN_ORDNER') ?: __DIR__ . '/privat';
}

function heute(): string
{
    return (new DateTimeImmutable('@' . jetzt()))->setTimezone(new DateTimeZone('Europe/Vienna'))->format('Y-m-d');
}

function einstellungen(): ?array
{
    $e = json_decode((string) @file_get_contents(ordner() . '/mitarbeiter.json'), true);
    return is_array($e) && is_string($e['schluessel'] ?? null) && strlen($e['schluessel']) >= 32 ? $e : null;
}

/** Datum (JJJJ-MM-TT) plus/minus Tage, unabhängig von der Zeitzone des Servers. */
function tag_plus(string $datum, int $tage): string
{
    return (new DateTimeImmutable($datum, new DateTimeZone('UTC')))->modify(($tage >= 0 ? '+' : '') . $tage . ' days')->format('Y-m-d');
}

function json_ausgabe(int $status, array $daten): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($daten, JSON_UNESCAPED_UNICODE);
    exit;
}

function speicher(): string
{
    $d = ordner() . '/mitarbeiter';
    if (!is_dir($d)) {
        @mkdir($d, 0775, true);
    }
    return $d;
}

function person_datei(string $hash): string
{
    return speicher() . '/' . $hash . '.json';
}

function json_lesen(string $datei): array
{
    $d = is_file($datei) ? json_decode((string) file_get_contents($datei), true) : null;
    return is_array($d) ? $d : [];
}

function json_schreiben(string $datei, array $daten): bool
{
    $tmp = $datei . '.' . bin2hex(random_bytes(4));
    return @file_put_contents($tmp, json_encode($daten, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX) !== false && @rename($tmp, $datei);
}

/** Anträge gesperrt ändern; $fn bekommt die Liste per Referenz, Rückgabe wird durchgereicht. */
function antraege(callable $fn)
{
    $h = @fopen(speicher() . '/antraege.json', 'c+');
    if (!$h) {
        return null;
    }
    flock($h, LOCK_EX);
    $liste = json_decode((string) stream_get_contents($h), true);
    $liste = is_array($liste) ? $liste : [];
    $ergebnis = $fn($liste);
    // Datensparsam: Entschiedenes nach 120 Tagen weg, Notiz einer Krankmeldung nach dem Eintragen leeren
    $grenze = tag_plus(heute(), -120);
    $liste = array_values(array_filter($liste, fn ($a) => ($a['status'] ?? '') === 'offen' || ($a['bis'] ?? '') >= $grenze));
    foreach ($liste as &$a) {
        if (($a['art'] ?? '') === 'Krankenstand' && ($a['status'] ?? '') === 'erledigt') {
            $a['notiz'] = '';
        }
    }
    unset($a);
    ftruncate($h, 0);
    rewind($h);
    fwrite($h, json_encode(array_values($liste), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    fflush($h);
    flock($h, LOCK_UN);
    fclose($h);
    return $ergebnis;
}

/** Zeiterfassung eingeschaltet? Dann { alarmMinuten, pruefschluessel, objekte: { code: { id, name } } }. */
function zeiterfassung(?array $e): ?array
{
    $z = $e['zeiterfassung'] ?? null;
    return is_array($z) && is_array($z['objekte'] ?? null) ? $z : null;
}

/** Stempelungen gesperrt ändern (wie die Anträge); älter als 62 Tage fallen weg. */
function zeiten(callable $fn)
{
    $h = @fopen(speicher() . '/zeiten.json', 'c+');
    if (!$h) {
        return null;
    }
    flock($h, LOCK_EX);
    $liste = json_decode((string) stream_get_contents($h), true);
    $liste = is_array($liste) ? $liste : [];
    $ergebnis = $fn($liste);
    $liste = array_values(array_filter($liste, fn ($r) => (int) ($r['kommen'] ?? 0) > jetzt() - 62 * 86400));
    ftruncate($h, 0);
    rewind($h);
    fwrite($h, json_encode($liste, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    fflush($h);
    flock($h, LOCK_UN);
    fclose($h);
    return $ergebnis;
}

/** Zeitpunkt für Datum und Uhrzeit in Wien. */
function wien_ts(string $datum, string $uhrzeit): int
{
    $t = DateTimeImmutable::createFromFormat('!Y-m-d H:i', "$datum $uhrzeit", new DateTimeZone('Europe/Vienna'));
    return $t ? $t->getTimestamp() : 0;
}

function uhr(int $ts): string
{
    return (new DateTimeImmutable('@' . $ts))->setTimezone(new DateTimeZone('Europe/Vienna'))->format('H:i');
}

function dauer(int $sekunden): string
{
    $min = intdiv(max(0, $sekunden), 60);
    return intdiv($min, 60) . ':' . str_pad((string) ($min % 60), 2, '0', STR_PAD_LEFT) . ' h';
}

/** Einsätze einer Person (gestern und heute), optional nur an einem Objekt; mit Beginn als Zeitpunkt. */
function einsaetze(array $person, ?string $objektId = null): array
{
    $tage = [tag_plus(heute(), -1), heute()];
    $out = [];
    foreach ((array) ($person['wochen'] ?? []) as $w) {
        foreach ((array) ($w['tage'] ?? []) as $t) {
            if (!in_array($t['datum'] ?? '', $tage, true)) {
                continue;
            }
            foreach ((array) ($t['eintraege'] ?? []) as $x) {
                if (!empty($x['entfaellt']) || empty($x['id']) || empty($x['beginn']) || ($objektId !== null && ($x['objektId'] ?? '') !== $objektId)) {
                    continue;
                }
                $out[] = $x + ['datum' => $t['datum'], 'ts' => wien_ts($t['datum'], (string) $x['beginn'])];
            }
        }
    }
    return $out;
}

/** Laut Plan passender Einsatz zum Kommen: Beginn höchstens 6 h zurück oder 3 h voraus, der nächste. */
function passender_einsatz(array $person, string $objektId): ?array
{
    $best = null;
    foreach (einsaetze($person, $objektId) as $x) {
        $abstand = abs($x['ts'] - jetzt());
        if ($x['ts'] >= jetzt() - 6 * 3600 && $x['ts'] <= jetzt() + 3 * 3600 && (!$best || $abstand < abs($best['ts'] - jetzt()))) {
            $best = $x;
        }
    }
    return $best;
}

/**
 * Cronjob: Wer laut Plan seit alarmMinuten im Dienst sein sollte und nicht gestempelt hat, wird
 * dem Büro (und sich selbst) einmal gemeldet; bis 3 Stunden nach Beginn. Nur Personen, die die
 * Zeiterfassung schon benutzen (einmal gestempelt).
 */
function nicht_erschienen(array $e, array $z): array
{
    $min = (int) ($z['alarmMinuten'] ?? 0);
    if ($min <= 0) {
        return ['geprueft' => 0, 'gemeldet' => 0];
    }
    $zeiten = json_lesen(speicher() . '/zeiten.json');
    $da = [];
    foreach ($zeiten as $r) {
        $da[$r['hash'] . '|' . ($r['einsatz'] ?? '')] = true;
        $da[$r['hash'] . '|' . ($r['objektId'] ?? '') . '|' . ($r['datum'] ?? '')] = true;
    }
    $datei = speicher() . '/gemeldet.json';
    $gemeldet = array_filter(json_lesen($datei), fn ($ts) => (int) $ts > jetzt() - 3 * 86400);
    $faelle = 0;
    $geprueft = 0;
    foreach (glob(speicher() . '/*.json') ?: [] as $pfad) {
        $hash = basename($pfad, '.json');
        if (!preg_match('/^[a-f0-9]{64}$/', $hash)) {
            continue;
        }
        $p = json_lesen($pfad);
        if (empty($p['stempelt'])) {
            continue;
        }
        $geprueft++;
        foreach (einsaetze($p) as $x) {
            $k = $hash . '|' . $x['id'];
            $ab = $x['ts'] + $min * 60;
            if ($ab > jetzt() || jetzt() > $ab + 3 * 3600 || isset($da[$k]) || isset($da[$hash . '|' . $x['objektId'] . '|' . $x['datum']]) || isset($gemeldet[$k])) {
                continue;
            }
            $gemeldet[$k] = jetzt();
            $faelle++;
            $was = ($x['zeit'] ?? '') . ' ' . ($x['objekt'] ?? '');
            $app = rtrim((string) ($e['adresse'] ?? ''), '/') . '/#home';
            foreach ((array) ($e['buero'] ?? []) as $b) {
                if (!empty($b['ntfy'])) {
                    ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $b['ntfy'], 'title' => 'Nicht eingestempelt: ' . ($p['name'] ?? ''), 'message' => "$was (Beginn vor " . intdiv(jetzt() - $x['ts'], 60) . " min).\nIn der App unter „Zu erledigen“.", 'priority' => 4, 'tags' => ['warning'], 'click' => $app]);
                }
            }
            if (!empty($p['ntfy'])) {
                $sp = sprache_von($p);
                ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $p['ntfy'], 'title' => t('push_nicht_gestempelt', ['was' => $was], $sp), 'message' => t('push_nicht_gestempelt_text', [], $sp), 'priority' => 4, 'tags' => ['alarm_clock'], 'click' => rtrim((string) ($e['adresse'] ?? ''), '/') . '/mein-plan.php']);
            }
        }
    }
    json_schreiben($datei, $gemeldet);
    return ['geprueft' => $geprueft, 'gemeldet' => $faelle];
}

$h = fn (string $t): string => htmlspecialchars($t, ENT_QUOTES);
// Datum und Zeitraum in der Sprache der Seite; $s = 'de' für Nachrichten ans Büro, die Sprache der Person für ihren Push
$tag = fn (string $d, ?string $s = null): string => datum_sprache($d, false, $s);
$zeitraum = fn (string $von, string $bis, ?string $s = null): string => $von === $bis ? $tag($von, $s) : $tag($von, $s) . ' – ' . $tag($bis, $s);
$stunden = fn ($min): string => str_replace('.', t('dezimal'), (string) round(((int) $min) / 60, 2));
$konto = fn ($min): string => ($min > 0 ? '+' : ($min < 0 ? '−' : '±')) . str_replace('.', t('dezimal'), (string) round(abs((int) $min) / 60, 2));

$e = einstellungen();
// ---------------------------------------------------------------- Termin-Erinnerung per Push

/**
 * Termine laut veröffentlichtem Plan (Schulung, Begehung …), die in den nächsten 60 Minuten beginnen:
 * je Person mit Push-Thema einmal erinnern. Läuft mit dem Cronjob (aktion=pruefen).
 */
function termin_erinnerungen(array $e, int $vorlauf = 60): array
{
    $datei = speicher() . '/erinnert.json';
    $erinnert = json_lesen($datei);
    $jetzt = jetzt();
    $heute = heute();
    $n = 0;
    $geprueft = 0;
    foreach (glob(speicher() . '/*.json') ?: [] as $f) {
        $hash = basename($f, '.json');
        if (!preg_match('/^[a-f0-9]{64}$/', $hash)) {
            continue;
        }
        $p = json_lesen($f);
        if (empty($p['ntfy'])) {
            continue;
        }
        foreach ((array) ($p['wochen'] ?? []) as $w) {
            foreach ((array) ($w['tage'] ?? []) as $t) {
                if (($t['datum'] ?? '') !== $heute) {
                    continue;
                }
                foreach ((array) ($t['termine'] ?? []) as $x) {
                    if (!empty($x['ganztags']) || empty($x['beginn']) || empty($x['id'])) {
                        continue;
                    }
                    $geprueft++;
                    $ts = wien_ts($heute, (string) $x['beginn']);
                    $key = $hash . '|' . $x['id'] . '|' . $heute;
                    if ($ts < $jetzt || $ts - $jetzt > $vorlauf * 60 || isset($erinnert[$key])) {
                        continue;
                    }
                    $sp = sprache_von($p);
                    if (ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $p['ntfy'], 'title' => t('push_termin', ['zeit' => $x['beginn'], 'titel' => $x['titel'] ?? ''], $sp), 'message' => (string) ($x['ort'] ?? t('push_details', [], $sp)), 'priority' => 4, 'tags' => ['calendar'], 'click' => rtrim((string) ($e['adresse'] ?? ''), '/') . '/mein-plan.php'])) {
                        $erinnert[$key] = $jetzt;
                        $n++;
                    }
                }
            }
        }
    }
    // alte Einträge (über 3 Tage) entfernen
    $erinnert = array_filter($erinnert, fn ($ts) => $ts > $jetzt - 3 * 86400);
    json_schreiben($datei, $erinnert);
    return ['termine' => $geprueft, 'erinnert' => $n];
}

// ---------------------------------------------------------------- Kalender-Abo (iCalendar)

function ics_text(string $s): string
{
    return str_replace(['\\', "\r\n", "\n", ',', ';'], ['\\\\', '\\n', '\\n', '\\,', '\\;'], $s);
}

/** Zeile nach RFC 5545 auf 75 Byte falten, ohne UTF-8-Zeichen zu zerteilen. */
function ics_falten(string $zeile): string
{
    $teile = [];
    $akt = '';
    foreach (mb_str_split($zeile) as $z) {
        if (strlen($akt . $z) > ($teile ? 74 : 75)) {
            $teile[] = $akt;
            $akt = '';
        }
        $akt .= $z;
    }
    $teile[] = $akt;
    return implode("\r\n ", $teile);
}

function ics_utc(string $datum, string $uhr): string
{
    $d = new DateTimeImmutable($datum . ' ' . $uhr, new DateTimeZone('Europe/Vienna'));
    return $d->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z');
}

/** Von–bis aus „06:00–10:00“; Ende vor Beginn = nächster Tag. */
function ics_spanne(string $datum, string $zeit, string $beginn = ''): ?array
{
    $teile = preg_split('/\s*[–-]\s*/u', $zeit);
    $von = preg_match('/^\d{2}:\d{2}$/', $beginn) ? $beginn : ($teile[0] ?? '');
    $bis = $teile[1] ?? '';
    if (!preg_match('/^\d{2}:\d{2}$/', $von) || !preg_match('/^\d{2}:\d{2}$/', $bis)) {
        return null;
    }
    return [ics_utc($datum, $von), ics_utc($bis <= $von ? tag_plus($datum, 1) : $datum, $bis)];
}

/** Dienstplan einer Person als Kalender: Einsätze, Termine und Abwesenheiten der veröffentlichten Wochen. */
function kalender_ics(array $person, string $hash): string
{
    $sp = sprache_von($person);
    $jetzt = gmdate('Ymd\THis\Z', jetzt());
    $z = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cleanos App//Mein Dienstplan//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'X-WR-CALNAME:' . ics_text(t('ics_kalender', [], $sp) . (!empty($person['name']) ? ' ' . $person['name'] : '')), 'X-WR-TIMEZONE:Europe/Vienna', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
    $ereignis = function (string $uid, array $felder) use (&$z, $jetzt) {
        $z[] = 'BEGIN:VEVENT';
        $z[] = 'UID:' . $uid . '@mein-plan';
        $z[] = 'DTSTAMP:' . $jetzt;
        foreach ($felder as $f) {
            $z[] = $f;
        }
        $z[] = 'END:VEVENT';
    };
    foreach ((array) ($person['wochen'] ?? []) as $w) {
        foreach ((array) ($w['tage'] ?? []) as $t) {
            $datum = (string) ($t['datum'] ?? '');
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $datum)) {
                continue;
            }
            foreach ((array) ($t['eintraege'] ?? []) as $x) {
                if (!empty($x['entfaellt']) || empty($x['zeit'])) {
                    continue;
                }
                $spanne = ics_spanne($datum, (string) $x['zeit'], (string) ($x['beginn'] ?? ''));
                if (!$spanne) {
                    continue;
                }
                $titel = (string) ($x['objekt'] ?? t('ics_einsatz', [], $sp)) . (!empty($x['leistung']) ? ' – ' . $x['leistung'] : '');
                $ereignis(sha1($hash . '|' . ($x['id'] ?? $datum . $x['zeit'])), array_filter(['DTSTART:' . $spanne[0], 'DTEND:' . $spanne[1], 'SUMMARY:' . ics_text($titel), !empty($x['adresse']) ? 'LOCATION:' . ics_text((string) $x['adresse']) : '', !empty($x['notizen']) ? 'DESCRIPTION:' . ics_text(implode("\n", array_map(fn ($n) => notiz_text((string) $n, $sp), (array) $x['notizen']))) : '']));
            }
            foreach ((array) ($t['termine'] ?? []) as $x) {
                $titel = t('ics_termin', ['titel' => (string) ($x['titel'] ?? '')], $sp);
                $ort = !empty($x['ort']) ? 'LOCATION:' . ics_text((string) $x['ort']) : '';
                if (!empty($x['ganztags'])) {
                    $ereignis(sha1($hash . '|t|' . ($x['id'] ?? '') . '|' . $datum), array_filter(['DTSTART;VALUE=DATE:' . str_replace('-', '', $datum), 'DTEND;VALUE=DATE:' . str_replace('-', '', tag_plus($datum, 1)), 'SUMMARY:' . ics_text($titel), $ort, 'TRANSP:TRANSPARENT']));
                    continue;
                }
                $spanne = ics_spanne($datum, (string) ($x['zeit'] ?? ''), (string) ($x['beginn'] ?? ''));
                if ($spanne) {
                    $ereignis(sha1($hash . '|t|' . ($x['id'] ?? $datum)), array_filter(['DTSTART:' . $spanne[0], 'DTEND:' . $spanne[1], 'SUMMARY:' . ics_text($titel), $ort]));
                }
            }
            if (!empty($t['abwesend'])) {
                $ereignis(sha1($hash . '|a|' . $datum), ['DTSTART;VALUE=DATE:' . str_replace('-', '', $datum), 'DTEND;VALUE=DATE:' . str_replace('-', '', tag_plus($datum, 1)), 'SUMMARY:' . ics_text(art_text((string) $t['abwesend'], $sp)), 'TRANSP:TRANSPARENT']);
            }
        }
    }
    $z[] = 'END:VCALENDAR';
    return implode("\r\n", array_map('ics_falten', $z)) . "\r\n";
}

// ---------------------------------------------------------------- Mitteilungen an Mitarbeitende (Lesebestätigung)

const MIT_ID = '/^[a-z0-9]{6,32}$/';
const MIT_TYPEN = ['application/pdf' => 'pdf', 'image/jpeg' => 'jpg', 'image/png' => 'png'];
const MIT_GRENZE_TAG = 60; // „Gelesen“/„Verstanden“ je Person und Tag
const MIT_ANHANG_MAX = 6 * 1024 * 1024;

function mit_ordner(): string
{
    $d = speicher() . '/mitteilungen';
    if (!is_dir($d)) {
        @mkdir($d, 0775, true);
    }
    return $d;
}

/** Alle Mitteilungen, wie die App sie zuletzt übertragen hat. */
function mit_liste(): array
{
    return array_values(array_filter((array) (json_lesen(speicher() . '/mitteilungen.json')['mitteilungen'] ?? []), 'is_array'));
}

/** Heute sichtbare Mitteilungen einer Person: nur die, in deren Empfängerliste ihr Hashwert steht. */
function mit_meine(string $hash): array
{
    $heute = heute();
    return array_values(array_filter(mit_liste(), fn ($m) => $hash !== '' && in_array($hash, (array) ($m['an'] ?? []), true) && (string) ($m['ab'] ?? '') <= $heute && (string) ($m['bis'] ?? '') >= $heute));
}

/** Datei des Anhangs (fester Name aus Kennung und Typ); '' ohne Anhang. */
function mit_anhang_pfad(array $m): string
{
    $endung = MIT_TYPEN[(string) ($m['anhang']['typ'] ?? '')] ?? '';
    return $endung !== '' && preg_match(MIT_ID, (string) ($m['id'] ?? '')) ? mit_ordner() . '/' . $m['id'] . '.' . $endung : '';
}

/** Passt der Inhalt zum Typ? (PDF, JPEG, PNG am Anfang der Datei erkannt; nichts anderes wird ausgeliefert) */
function mit_inhalt_passt(string $typ, string $daten): bool
{
    return match ($typ) {
        'application/pdf' => str_starts_with($daten, '%PDF-'),
        'image/jpeg' => str_starts_with($daten, "\xFF\xD8\xFF"),
        'image/png' => str_starts_with($daten, "\x89PNG\r\n\x1A\n"),
        default => false,
    };
}

/** Rückmeldungen gesperrt ändern: { gelesen: { 'id|hash': { gelesen, bestaetigt, geaendert } }, push, zaehler }. */
function mit_status(callable $fn)
{
    $h = @fopen(speicher() . '/mitteilungen-status.json', 'c+');
    if (!$h) {
        return null;
    }
    flock($h, LOCK_EX);
    $s = json_decode((string) stream_get_contents($h), true);
    $s = is_array($s) ? $s : [];
    foreach (['gelesen', 'push', 'zaehler'] as $k) {
        $s[$k] = is_array($s[$k] ?? null) ? $s[$k] : [];
    }
    $ergebnis = $fn($s);
    // Zähler der Grenze nur für heute und gestern
    $gestern = tag_plus(heute(), -1);
    $s['zaehler'] = array_filter($s['zaehler'], fn ($k) => substr((string) $k, -10) >= $gestern, ARRAY_FILTER_USE_KEY);
    ftruncate($h, 0);
    rewind($h);
    fwrite($h, json_encode($s, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    fflush($h);
    flock($h, LOCK_UN);
    fclose($h);
    return $ergebnis;
}

/** Erledigt? Bei „Bestätigung nötig“ zählt nur „Verstanden“. */
function mit_erledigt(array $m, array $st): bool
{
    return !empty($m['bestaetigen']) ? !empty($st['bestaetigt']) : !empty($st['gelesen']);
}

/**
 * Push für heute sichtbare Mitteilungen: je Person und Mitteilung einmal, nach einer Erinnerung noch einmal; nur an
 * Personen mit Push-Thema, die noch nicht gelesen bzw. bestätigt haben. Ohne Inhalt („Neue Mitteilung vom Büro“),
 * gelesen wird auf der Seite. Läuft beim Übertragen, beim Abholen durch die App und mit dem Cronjob.
 */
function mit_push(array $e): int
{
    $heute = heute();
    $liste = array_filter(mit_liste(), fn ($m) => !empty($m['push']) && (string) ($m['ab'] ?? '') <= $heute && (string) ($m['bis'] ?? '') >= $heute);
    if (!$liste) {
        return 0;
    }
    $faellig = mit_status(function (array &$s) use ($liste) {
        $out = [];
        foreach ($liste as $m) {
            foreach ((array) ($m['an'] ?? []) as $hash) {
                $k = $m['id'] . '|' . $hash;
                if (mit_erledigt($m, (array) ($s['gelesen'][$k] ?? []))) {
                    continue;
                }
                $erinnert = (int) ($m['erinnert'][$hash] ?? 0);
                $art = !isset($s['push'][$k]) ? 'neu' : ($erinnert > (int) $s['push'][$k] ? 'erinnert' : null);
                if (!$art) {
                    continue;
                }
                $s['push'][$k] = max(jetzt(), $erinnert);
                $out[$hash][$art] = ($out[$hash][$art] ?? 0) + 1;
            }
        }
        return $out;
    }) ?? [];
    $n = 0;
    foreach ($faellig as $hash => $was) {
        $p = json_lesen(person_datei((string) $hash));
        if (empty($p['ntfy'])) {
            continue;
        }
        $sp = sprache_von($p);
        $neu = (int) ($was['neu'] ?? 0);
        $titel = $neu > 1 ? t('push_mitteilungen', ['n' => $neu], $sp) : ($neu === 1 ? t('push_mitteilung', [], $sp) : t('push_mitteilung_erinnerung', [], $sp));
        if (ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $p['ntfy'], 'title' => $titel, 'message' => t('push_mitteilung_text', [], $sp), 'priority' => 3, 'tags' => ['envelope'], 'click' => rtrim((string) ($e['adresse'] ?? ''), '/') . '/mein-plan.php'])) {
            $n++;
        }
    }
    return $n;
}

/** Bereich „Mitteilungen“ oben auf der Seite: offene zuerst (erinnerte hervorgehoben), gelesene eingeklappt. */
function mit_html(string $hash, string $code): string
{
    $meine = mit_meine($hash);
    if (!$meine) {
        return '';
    }
    $h = fn (string $t): string => htmlspecialchars($t, ENT_QUOTES);
    $status = (array) (json_lesen(speicher() . '/mitteilungen-status.json')['gelesen'] ?? []);
    $s = sprache();
    $lang = html_sprache($s);
    $wann = function (int $ts) use ($h): array {
        $d = (new DateTimeImmutable('@' . $ts))->setTimezone(new DateTimeZone('Europe/Vienna'));
        return ['datum' => $h(t('datum_kurz', ['d' => $d->format('d'), 'm' => $d->format('m')])), 'zeit' => $h($d->format('H:i'))];
    };
    $offen = [];
    $fertig = [];
    foreach ($meine as $m) {
        $m['_st'] = (array) ($status[$m['id'] . '|' . $hash] ?? []);
        $m['_erinnert'] = (int) ($m['erinnert'][$hash] ?? 0) > 0;
        if (mit_erledigt($m, $m['_st'])) {
            $fertig[] = $m;
        } else {
            $offen[] = $m;
        }
    }
    usort($offen, fn ($a, $b) => ($b['_erinnert'] <=> $a['_erinnert']) ?: strcmp((string) $b['ab'], (string) $a['ab']));
    usort($fertig, fn ($a, $b) => strcmp((string) $b['ab'], (string) $a['ab']));
    $karte = function (array $m) use ($h, $s, $lang, $code, $wann): string {
        $u = $s !== 'de' && is_array($m['uebersetzt'][$s] ?? null) && trim((string) ($m['uebersetzt'][$s]['text'] ?? '')) !== '' ? $m['uebersetzt'][$s] : null;
        $titel = $u && trim((string) ($u['titel'] ?? '')) !== '' ? (string) $u['titel'] : (string) ($m['titel'] ?? '');
        $text = $u ? (string) $u['text'] : (string) ($m['text'] ?? '');
        $attr = $u ? ' lang="' . $h($lang) . '"' : ($s !== 'de' ? ' lang="de"' : '');
        $bestaetigen = !empty($m['bestaetigen']);
        $erledigt = mit_erledigt($m, $m['_st']);
        $erinnert = $m['_erinnert'] && !$erledigt;
        $html = '<article class="mit' . ($erledigt ? '' : ' mit-offen') . ($erinnert ? ' mit-erinnert' : '') . '" id="mit-' . $h((string) $m['id']) . '">'
            . '<h3' . $attr . '>' . $h($titel) . '</h3>'
            . '<p class="mit-kopf">' . ($bestaetigen ? '<span class="pill mit-wichtig">' . th('mit_wichtig') . '</span> ' : '') . ($erinnert ? '<span class="pill mit-erinnerung">' . th('mit_erinnerung') . '</span> ' : '') . '<span class="leise">' . th('mit_vom', ['datum' => $h(datum_sprache((string) $m['ab']))]) . '</span></p>'
            . ($s !== 'de' && !$u ? '<p class="leise">' . th('mit_nur_deutsch') . '</p>' : '')
            . '<div class="mit-text"' . $attr . '>' . nl2br($h($text)) . '</div>'
            . ($u ? '<details class="mit-de"><summary>' . th('mit_deutsch_zeigen') . '</summary><div lang="de"><p><b>' . $h((string) ($m['titel'] ?? '')) . '</b></p><p>' . nl2br($h((string) ($m['text'] ?? ''))) . '</p></div></details>' : '');
        $pfad = mit_anhang_pfad($m);
        if ($pfad !== '' && is_file($pfad)) {
            $html .= '<p><a class="mit-anhang" href="mein-plan.php?aktion=anhang&amp;m=' . rawurlencode((string) $m['id']) . '" target="_blank" rel="noopener">' . th('mit_anhang', ['name' => $h((string) ($m['anhang']['name'] ?? ''))]) . '</a></p>';
        }
        if ($erledigt) {
            $html .= '<p class="ok">✓ ' . th($bestaetigen ? 'mit_verstanden_am' : 'mit_gelesen_am', $wann((int) ($bestaetigen ? $m['_st']['bestaetigt'] : $m['_st']['gelesen']))) . '</p>';
        } else {
            $html .= '<form method="post" action="mein-plan.php?aktion=gelesen"><input type="hidden" name="p" value="' . $h($code) . '"><input type="hidden" name="m" value="' . $h((string) $m['id']) . '"><button type="submit" class="klein">' . th($bestaetigen ? 'mit_verstanden_knopf' : 'mit_gelesen_knopf') . '</button></form>'
                . ($bestaetigen ? '<p class="leise">' . th('mit_verstanden_info') . '</p>' : '');
        }
        return $html . '</article>';
    };
    return '<section class="mitteilungen" aria-labelledby="mit-titel"><h2 id="mit-titel">' . th('mit_titel') . ($offen ? ' <span class="pill neu">' . th('mit_neu', ['n' => (string) count($offen)]) . '</span>' : '') . '</h2>'
        . implode('', array_map($karte, $offen))
        . ($fertig ? '<details class="mit-alt"><summary>' . th('mit_gelesene', ['n' => (string) count($fertig)]) . '</summary>' . implode('', array_map($karte, $fertig)) . '</details>' : '')
        . '</section>';
}

$aktion = (string) ($_GET['aktion'] ?? '');
$methode = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ---------------------------------------------------------------- Cronjob: Nichterscheinen

$cli = PHP_SAPI === 'cli' && in_array('pruefen', array_slice($argv ?? [], 1), true);
if ($aktion === 'pruefen' || $cli) {
    $z = zeiterfassung($e);
    $schluessel = (string) ($z['pruefschluessel'] ?? '');
    if (!$z || strlen($schluessel) < 16) {
        json_ausgabe(503, ['fehler' => 'Zeiterfassung nicht eingerichtet']);
    }
    if (!$cli && !hash_equals($schluessel, (string) ($_GET['schluessel'] ?? ''))) {
        json_ausgabe(403, ['fehler' => 'Prüfschlüssel fehlt oder falsch']);
    }
    $ergebnis = nicht_erschienen($e, $z) + ['terminErinnerung' => termin_erinnerungen($e), 'mitteilungen' => mit_push($e)];
    json_schreiben(speicher() . '/pruefung.json', ['zuletzt' => jetzt()] + $ergebnis); // für den Systemcheck
    if ($cli) {
        echo json_encode($ergebnis) . "\n";
        exit;
    }
    json_ausgabe(200, $ergebnis);
}

// ---------------------------------------------------------------- Aufrufe der App (mit Schlüssel)

if (in_array($aktion, ['speichern', 'antraege', 'antrag-status', 'einrichten', 'zeiten', 'mitteilungen', 'mitteilung-anhang', 'mitteilungen-status'], true)) {
    if (!$e) {
        json_ausgabe(503, ['fehler' => 'Mein Dienstplan noch nicht eingerichtet: privat/mitarbeiter.json fehlt (App → Mitarbeitende → Plan am Handy).']);
    }
    $gegeben = (string) ($_SERVER['HTTP_X_SCHLUESSEL'] ?? '');
    if ($gegeben === '' || !hash_equals((string) $e['schluessel'], $gegeben)) {
        json_ausgabe(403, ['fehler' => 'Schlüssel fehlt oder falsch']);
    }
    $daten = $methode === 'POST' && $aktion !== 'mitteilung-anhang' ? json_decode((string) file_get_contents('php://input'), true) : null;

    // Mitteilungen: Anhang einer Mitteilung (Rohdaten: PDF, JPEG oder PNG, am Inhalt geprüft)
    if ($aktion === 'mitteilung-anhang') {
        $id = (string) ($_GET['id'] ?? '');
        $typ = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
        if ($methode !== 'POST' || !preg_match(MIT_ID, $id) || !isset(MIT_TYPEN[$typ])) {
            json_ausgabe(400, ['fehler' => 'POST mit PDF, JPEG oder PNG und Kennung der Mitteilung erwartet']);
        }
        if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > MIT_ANHANG_MAX) {
            json_ausgabe(413, ['fehler' => 'Anhang zu groß (höchstens 6 MB)']);
        }
        $inhalt = (string) file_get_contents('php://input', false, null, 0, MIT_ANHANG_MAX + 1);
        if ($inhalt === '' || strlen($inhalt) > MIT_ANHANG_MAX) {
            json_ausgabe(413, ['fehler' => 'Anhang leer oder zu groß für den Webspace (post_max_size ' . ini_get('post_max_size') . ', höchstens 6 MB)']);
        }
        if (!mit_inhalt_passt($typ, $inhalt)) {
            json_ausgabe(415, ['fehler' => 'Der Inhalt passt nicht zum Typ (nur PDF, JPEG, PNG)']);
        }
        $ziel = mit_ordner() . '/' . $id . '.' . MIT_TYPEN[$typ];
        $tmp = $ziel . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (@file_put_contents($tmp, $inhalt) === false || !@rename($tmp, $ziel)) {
            @unlink($tmp);
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        foreach (MIT_TYPEN as $endung) {
            if ($endung !== MIT_TYPEN[$typ]) {
                @unlink(mit_ordner() . '/' . $id . '.' . $endung);
            }
        }
        json_ausgabe(200, ['gespeichert' => true, 'groesse' => strlen($inhalt)]);
    }

    // Mitteilungen: „Gelesen“/„Verstanden“ seit einem Zeitpunkt (Unix-Sekunden); dabei fällige Push-Nachrichten senden
    if ($aktion === 'mitteilungen-status') {
        $seit = (int) ($_GET['seit'] ?? 0);
        $push = mit_push($e);
        $out = [];
        foreach ((array) (json_lesen(speicher() . '/mitteilungen-status.json')['gelesen'] ?? []) as $k => $st) {
            if (!is_array($st) || (int) ($st['geaendert'] ?? 0) < $seit) {
                continue;
            }
            [$id, $hash] = array_pad(explode('|', (string) $k, 2), 2, '');
            $out[] = ['id' => $id, 'hash' => $hash, 'gelesen' => (int) ($st['gelesen'] ?? 0), 'bestaetigt' => (int) ($st['bestaetigt'] ?? 0)];
        }
        json_ausgabe(200, ['status' => $out, 'push' => $push, 'jetzt' => jetzt()]);
    }

    if ($aktion === 'zeiten') {
        $seit = (int) ($_GET['seit'] ?? 0);
        json_ausgabe(200, ['zeiten' => array_values(array_filter(json_lesen(speicher() . '/zeiten.json'), fn ($r) => (int) ($r['geaendert'] ?? 0) >= $seit)), 'jetzt' => jetzt()]);
    }

    if ($aktion === 'antraege') {
        $grenze = tag_plus(heute(), -120);
        $liste = antraege(fn (array &$l) => $l) ?? [];
        json_ausgabe(200, ['antraege' => array_values(array_filter($liste, fn ($a) => ($a['bis'] ?? '') >= $grenze || ($a['status'] ?? '') === 'offen'))]);
    }
    if ($methode !== 'POST' || !is_array($daten)) {
        json_ausgabe(400, ['fehler' => 'POST mit JSON erwartet']);
    }
    // Mitteilungen: Liste ersetzen (laufende und geplante), Personen ohne Datei anlegen, aufräumen, Push
    if ($aktion === 'mitteilungen') {
        $kurz = fn ($v, int $n): string => mb_substr(trim((string) $v), 0, $n);
        $istDatum = fn ($d): bool => is_string($d) && (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $d);
        $liste = [];
        foreach (array_slice((array) ($daten['mitteilungen'] ?? []), 0, 100) as $m) {
            if (!is_array($m)) {
                continue;
            }
            $id = (string) ($m['id'] ?? '');
            $ab = (string) ($m['ab'] ?? '');
            $bis = (string) ($m['bis'] ?? '');
            $an = array_slice(array_values(array_unique(array_filter((array) ($m['an'] ?? []), fn ($x) => is_string($x) && preg_match('/^[a-f0-9]{64}$/', $x)))), 0, 2000);
            if (!preg_match(MIT_ID, $id) || !$istDatum($ab) || !$istDatum($bis) || $bis < $ab || !$an) {
                continue;
            }
            $uebersetzt = [];
            foreach ((array) ($m['uebersetzt'] ?? []) as $sp => $u) {
                if ($sp !== 'de' && sprache_gueltig((string) $sp) && is_array($u) && trim((string) ($u['text'] ?? '')) !== '') {
                    $uebersetzt[$sp] = ['titel' => $kurz($u['titel'] ?? '', 160), 'text' => $kurz($u['text'], 6000)];
                }
            }
            $erinnert = [];
            foreach ((array) ($m['erinnert'] ?? []) as $hash => $ts) {
                if (in_array((string) $hash, $an, true) && (int) $ts > 0) {
                    $erinnert[(string) $hash] = (int) $ts;
                }
            }
            $anhang = is_array($m['anhang'] ?? null) && isset(MIT_TYPEN[(string) ($m['anhang']['typ'] ?? '')]) ? ['name' => $kurz($m['anhang']['name'] ?? '', 120), 'typ' => (string) $m['anhang']['typ'], 'groesse' => (int) ($m['anhang']['groesse'] ?? 0)] : null;
            $liste[] = ['id' => $id, 'titel' => $kurz($m['titel'] ?? '', 160), 'text' => $kurz($m['text'] ?? '', 6000), 'uebersetzt' => $uebersetzt, 'bestaetigen' => !empty($m['bestaetigen']), 'ab' => $ab, 'bis' => $bis, 'an' => $an, 'erinnert' => $erinnert, 'push' => !empty($m['push']), 'erstellt' => (int) ($m['erstellt'] ?? 0), 'anhang' => $anhang];
        }
        if (!json_schreiben(speicher() . '/mitteilungen.json', ['mitteilungen' => $liste, 'stand' => jetzt()])) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        // Empfänger ohne Plan am Handy (noch keine Woche veröffentlicht) bekommen eine Datei, damit ihr Link gilt
        $neu = 0;
        foreach (array_slice((array) ($daten['personen'] ?? []), 0, 3000) as $person) {
            $hash = (string) ($person['hash'] ?? '');
            if (!preg_match('/^[a-f0-9]{64}$/', $hash) || is_file(person_datei($hash))) {
                continue;
            }
            $ntfy = is_string($person['ntfy'] ?? null) && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $person['ntfy']) ? $person['ntfy'] : '';
            if (json_schreiben(person_datei($hash), ['name' => mb_substr((string) ($person['name'] ?? ''), 0, 80), 'ntfy' => $ntfy, 'sprache' => sprache_gueltig($person['sprache'] ?? null) ?? 'de', 'wochen' => []])) {
                $neu++;
            }
        }
        // aufräumen: Rückmeldungen, Push-Vermerke und Anhänge von Mitteilungen, die es nicht mehr gibt
        $ids = array_column($liste, 'id');
        mit_status(function (array &$s) use ($ids) {
            foreach (['gelesen', 'push'] as $k) {
                $s[$k] = array_filter($s[$k], fn ($x) => in_array(explode('|', (string) $x)[0], $ids, true), ARRAY_FILTER_USE_KEY);
            }
        });
        $behalten = array_filter(array_map(fn ($m) => $m['anhang'] ? basename(mit_anhang_pfad($m)) : '', $liste));
        foreach (glob(mit_ordner() . '/*') ?: [] as $f) {
            if (!in_array(basename($f), $behalten, true) && @filemtime($f) < time() - 3600) {
                @unlink($f);
            }
        }
        $fehlen = array_values(array_map(fn ($m) => $m['id'], array_filter($liste, fn ($m) => $m['anhang'] && !is_file(mit_anhang_pfad($m)))));
        json_ausgabe(200, ['mitteilungen' => count($liste), 'personenNeu' => $neu, 'anhaengeFehlen' => $fehlen, 'push' => mit_push($e)]);
    }
    if ($aktion === 'einrichten') {
        if (!is_string($daten['schluessel'] ?? null) || strlen($daten['schluessel']) < 32) {
            json_ausgabe(400, ['fehler' => 'Ungültige Einstellungen']);
        }
        if (!json_schreiben(ordner() . '/mitarbeiter.json', $daten)) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        json_ausgabe(200, ['gespeichert' => true]);
    }
    if ($aktion === 'antrag-status') {
        $status = (string) ($daten['status'] ?? '');
        if (!isset(STATUS_TEXT[$status]) || $status === 'offen') {
            json_ausgabe(400, ['fehler' => 'Status genehmigt, abgelehnt oder erledigt']);
        }
        $a = antraege(function (array &$l) use ($daten, $status) {
            foreach ($l as &$x) {
                if (($x['id'] ?? '') === (string) ($daten['id'] ?? '')) {
                    $x['status'] = $status;
                    $x['antwort'] = mb_substr(trim((string) ($daten['antwort'] ?? '')), 0, 300);
                    $x['entschieden'] = jetzt();
                    return $x;
                }
            }
            return null;
        });
        if (!$a) {
            json_ausgabe(404, ['fehler' => 'Antrag nicht gefunden']);
        }
        // der Person Bescheid geben (Krankmeldung „eingetragen“: kein Push nötig)
        $p = json_lesen(person_datei((string) $a['hash']));
        if (!empty($p['ntfy']) && ($status !== 'erledigt' || in_array($a['art'], ['Abgabe', 'Material', 'Geraet'], true))) {
            $sp = sprache_von($p);
            $was = $tag($a['von'], $sp) . ' ' . ($a['text'] ?? '');
            $titel = match ($a['art']) {
                'Material' => t('push_material_' . $status, ['text' => $a['text'] ?? ''], $sp),
                'Geraet' => t('push_geraet_' . $status, ['text' => (string) ($a['geraet'] ?? $a['text'] ?? '')], $sp),
                'Einsatz' => t($status === 'genehmigt' ? 'push_eingeteilt' : 'push_nicht_eingeteilt', ['was' => $was], $sp),
                'Abgabe' => t('push_abgabe_' . $status, ['was' => $was], $sp),
                default => t('push_antrag', ['art' => art_text((string) $a['art'], $sp), 'zeitraum' => $zeitraum($a['von'], $a['bis'], $sp), 'status' => t('status_' . $status, [], $sp)], $sp),
            };
            ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $p['ntfy'], 'title' => $titel, 'message' => antwort_text((string) $a['antwort'], $sp) ?: t('push_details', [], $sp), 'priority' => 3, 'tags' => [$status === 'abgelehnt' ? 'x' : 'white_check_mark'], 'click' => rtrim((string) ($e['adresse'] ?? ''), '/') . '/mein-plan.php']);
        }
        json_ausgabe(200, ['antrag' => $a]);
    }
    // speichern: veröffentlichte Wochen je Person; geänderte Wochen per Push melden
    $benachrichtigt = 0;
    $personen = 0;
    $montag = (new DateTimeImmutable(heute() . ' monday this week'))->format('Y-m-d');
    foreach ((array) ($daten['entfernen'] ?? []) as $hash) {
        if (is_string($hash) && preg_match('/^[a-f0-9]{64}$/', $hash)) {
            @unlink(person_datei($hash));
        }
    }
    // Einsatzbörse: Liste ersetzen; neue Angebote je Person zählen (für den Push)
    $neueAngebote = [];
    if (isset($daten['angebote']) && is_array($daten['angebote'])) {
        $alt = json_lesen(speicher() . '/angebote.json');
        $liste = [];
        foreach ($daten['angebote'] as $hash => $angebote) {
            if (!preg_match('/^[a-f0-9]{64}$/', (string) $hash) || !is_array($angebote)) {
                continue;
            }
            $bekannt = array_column(array_filter((array) ($alt[$hash] ?? []), 'is_array'), 'id');
            foreach (array_slice($angebote, 0, 20) as $o) {
                $id = (string) ($o['id'] ?? '');
                $datum = (string) ($o['datum'] ?? '');
                if (!preg_match('/^\d{4}-\d{2}-\d{2}\|[^|]{1,80}$/u', $id) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $datum)) {
                    continue;
                }
                $kurz = fn ($k, $n) => mb_substr((string) ($o[$k] ?? ''), 0, $n);
                $liste[$hash][] = ['id' => $id, 'datum' => $datum, 'zeit' => $kurz('zeit', 20), 'objekt' => $kurz('objekt', 80), 'leistung' => $kurz('leistung', 80), 'adresse' => $kurz('adresse', 120), 'minuten' => (int) ($o['minuten'] ?? 0), 'tausch' => !empty($o['tausch'])];
                if (!in_array($id, $bekannt, true)) {
                    $neueAngebote[$hash] = ($neueAngebote[$hash] ?? 0) + 1;
                }
            }
        }
        if (!json_schreiben(speicher() . '/angebote.json', $liste)) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
    }
    foreach ((array) ($daten['personen'] ?? []) as $person) {
        $hash = (string) ($person['hash'] ?? '');
        if (!preg_match('/^[a-f0-9]{64}$/', $hash)) {
            continue;
        }
        $p = json_lesen(person_datei($hash));
        $p['name'] = mb_substr((string) ($person['name'] ?? ''), 0, 80);
        $p['ntfy'] = is_string($person['ntfy'] ?? null) && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $person['ntfy']) ? $person['ntfy'] : '';
        if (array_key_exists('sprache', $person)) {
            $neu = sprache_gueltig($person['sprache']) ?? 'de'; // aus dem Stammblatt
            if ($neu !== ($p['sprache'] ?? null)) {
                unset($p['spracheWahl']); // im Büro geändert: gilt wieder (am Handy weiter umstellbar)
            }
            $p['sprache'] = $neu;
        }
        $sp = sprache_von($p);
        $p['wochen'] = (array) ($p['wochen'] ?? []);
        $meldungen = [];
        foreach ((array) ($daten['wochen'][$hash] ?? []) as $mo => $woche) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $mo) || !is_array($woche)) {
                continue;
            }
            $sig = sha1(json_encode([$woche['tage'] ?? [], $woche['summe'] ?? [], $woche['konto'] ?? null]));
            $alt = $p['wochen'][$mo] ?? null;
            if (!$alt && $mo >= $montag) {
                $meldungen[] = t('push_plan_neu', ['kw' => $woche['kw'] ?? ''], $sp);
            } elseif ($alt && ($alt['sig'] ?? '') !== $sig && $mo >= $montag) {
                $meldungen[] = t('push_plan_geaendert', ['kw' => $woche['kw'] ?? ''], $sp);
            }
            $woche['sig'] = $sig;
            $woche['veroeffentlicht'] = $alt['veroeffentlicht'] ?? jetzt();
            $woche['geaendert'] = $alt && ($alt['sig'] ?? '') !== $sig ? jetzt() : ($alt['geaendert'] ?? null);
            $p['wochen'][$mo] = $woche;
        }
        if (!empty($neueAngebote[$hash])) {
            $meldungen[] = $neueAngebote[$hash] === 1 ? t('push_angebot_1', [], $sp) : t('push_angebote', ['n' => $neueAngebote[$hash]], $sp);
        }
        // nur die letzten 8 Wochen und die kommenden behalten
        $grenze = tag_plus($montag, -56);
        $p['wochen'] = array_filter($p['wochen'], fn ($k) => $k >= $grenze, ARRAY_FILTER_USE_KEY);
        ksort($p['wochen']);
        if (!json_schreiben(person_datei($hash), $p)) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        $personen++;
        if ($meldungen && $p['ntfy']) {
            if (ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => $p['ntfy'], 'title' => implode(' · ', $meldungen), 'message' => t('push_antippen', [], $sp), 'priority' => 3, 'tags' => ['calendar'], 'click' => rtrim((string) ($e['adresse'] ?? ''), '/') . '/mein-plan.php'])) {
                $benachrichtigt++;
            }
        }
    }
    json_ausgabe(200, ['personen' => $personen, 'benachrichtigt' => $benachrichtigt]);
}

// ---------------------------------------------------------------- Seite für Mitarbeitende

if (!$e) {
    sprache_waehlen([], true);
    html_seite('<h1>' . th('titel') . '</h1><p>' . th('nicht_eingerichtet') . '</p>', 503, '', t('titel'));
    exit;
}
$code = (string) ($_GET['p'] ?? $_POST['p'] ?? $_COOKIE[COOKIE] ?? '');
if ($aktion === 'vergessen') {
    sprache_waehlen([], true);
    setcookie(COOKIE, '', ['expires' => 1, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']), 'httponly' => true, 'samesite' => 'Lax']);
    html_seite('<h1>' . th('titel') . '</h1><p>' . th('vergessen_text') . '</p>', 200, '', t('titel'));
    exit;
}
$hash = preg_match('/^[A-Za-z0-9]{16,40}$/', $code) ? hash('sha256', $code) : '';
$person = $hash ? json_lesen(person_datei($hash)) : [];
$token = (string) ($_GET['o'] ?? '');
// Sprache der Seite: Wahl auf der Seite, Gerät, Person (Stammblatt); ohne Person der Browser
sprache_waehlen($person, true);
if (!$person && $token !== '') {
    html_seite('<h1>' . th('titel_zeit') . '</h1><p>' . th('handy_unbekannt') . '</p>', 403, '', t('titel_zeit'));
    exit;
}
if (!$person) {
    html_seite('<h1>' . th('titel') . '</h1><p>' . th('link_ungueltig') . '</p>', 404, '', t('titel'));
    exit;
}
// auf der Seite gewählte Sprache merken: gilt auch auf anderen Geräten und für Push-Nachrichten
$gewaehlt = sprache_gueltig($_GET['sprache'] ?? null);
if ($gewaehlt && $gewaehlt !== ($person['spracheWahl'] ?? null)) {
    $person['spracheWahl'] = $gewaehlt;
    json_schreiben(person_datei($hash), $person);
}
// Kalender-Abo (Outlook, Google, iPhone): persönlicher Link mit aktion=kalender, ohne Cookie
if ($aktion === 'kalender') {
    header('Content-Type: text/calendar; charset=utf-8');
    header('Content-Disposition: inline; filename="dienstplan.ics"');
    header('Cache-Control: private, max-age=900');
    header('X-Robots-Tag: noindex');
    echo kalender_ics($person, $hash);
    exit;
}
if (isset($_GET['p'])) {
    // merken: danach genügt mein-plan.php (z. B. am Startbildschirm)
    setcookie(COOKIE, $code, ['expires' => jetzt() + 400 * 86400, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']), 'httponly' => true, 'samesite' => 'Lax']);
}

// Mitteilung: Anhang öffnen (nur Empfänger, nur solange die Mitteilung sichtbar ist)
if ($aktion === 'anhang') {
    $id = (string) ($_GET['m'] ?? '');
    $m = null;
    foreach (mit_meine($hash) as $x) {
        if (($x['id'] ?? '') === $id) {
            $m = $x;
        }
    }
    $pfad = $m ? mit_anhang_pfad($m) : '';
    if ($pfad === '' || !is_file($pfad)) {
        html_seite('<h1>' . th('titel') . '</h1><p>' . th('mit_nicht_gefunden') . '</p><p><a href="mein-plan.php">' . th('titel') . '</a></p>', 404, '', t('titel'));
        exit;
    }
    $name = (string) ($m['anhang']['name'] ?? '') ?: 'Anhang.' . MIT_TYPEN[$m['anhang']['typ']];
    header('Content-Type: ' . $m['anhang']['typ']);
    header('Content-Disposition: inline; filename="' . preg_replace('/[^A-Za-z0-9._-]/', '_', $name) . '"; filename*=UTF-8\'\'' . rawurlencode($name));
    header('Content-Length: ' . filesize($pfad));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');
    header('X-Robots-Tag: noindex, nofollow');
    readfile($pfad);
    exit;
}

// Mitteilung gelesen bzw. verstanden: Zeitpunkt des Servers; die Grenze je Person und Tag zählt in einem Schritt mit
if ($aktion === 'gelesen' && $methode === 'POST') {
    if (fremde_herkunft()) {
        html_seite('<p>' . th('nicht_erlaubt') . '</p>', 403, '', t('titel'));
        exit;
    }
    $id = (string) ($_POST['m'] ?? '');
    $m = null;
    foreach (mit_meine($hash) as $x) {
        if (($x['id'] ?? '') === $id) {
            $m = $x;
        }
    }
    $ergebnis = !$m ? 'weg' : mit_status(function (array &$s) use ($m, $hash) {
        $z = $hash . '|' . heute();
        if ((int) ($s['zaehler'][$z] ?? 0) >= MIT_GRENZE_TAG) {
            return 'grenze';
        }
        $s['zaehler'][$z] = (int) ($s['zaehler'][$z] ?? 0) + 1;
        $k = $m['id'] . '|' . $hash;
        $st = (array) ($s['gelesen'][$k] ?? []);
        if (mit_erledigt($m, $st)) {
            return 'ok';
        }
        $st['gelesen'] = (int) ($st['gelesen'] ?? 0) ?: jetzt();
        if (!empty($m['bestaetigen'])) {
            $st['bestaetigt'] = jetzt();
        }
        $st['geaendert'] = jetzt();
        $s['gelesen'][$k] = $st;
        return 'ok';
    });
    if ($ergebnis === 'ok') {
        header('Location: mein-plan.php?gesendet=mitteilung#mit-' . rawurlencode($id), true, 303);
        exit;
    }
    $meldung = '<p class="fehler">' . th($ergebnis === 'grenze' ? 'mit_zu_viele' : ($ergebnis === 'weg' ? 'mit_nicht_gefunden' : 'nicht_gespeichert')) . '</p>';
}

// Zeiterfassung am Objekt (QR-Code)
if ($token !== '') {
    $z = zeiterfassung($e);
    $obj = $z['objekte'][$token] ?? null;
    if (!is_array($obj)) {
        html_seite('<h1>' . th('titel_zeit') . '</h1><p>' . th('code_ungueltig') . '</p>', 404, '', t('titel_zeit'));
        exit;
    }
    $zurueck = 'mein-plan.php?o=' . rawurlencode($token);
    if ($aktion === 'stempeln' && $methode === 'POST') {
        if (fremde_herkunft()) {
            html_seite('<p>' . th('nicht_erlaubt') . '</p>', 403, '', t('titel_zeit'));
            exit;
        }
        $ergebnis = zeiten(function (array &$l) use ($hash, $person, $obj) {
            $offen = null;
            foreach ($l as $i => $r) {
                if ($r['hash'] !== $hash || $r['objektId'] !== $obj['id'] || (int) $r['kommen'] < jetzt() - 16 * 3600) {
                    continue;
                }
                if (max((int) $r['kommen'], (int) ($r['gehen'] ?? 0)) > jetzt() - 60) {
                    return 'doppelt'; // zweimal getippt
                }
                if (empty($r['gehen'])) {
                    $offen = $i;
                }
            }
            if ($offen !== null) {
                $l[$offen]['gehen'] = jetzt();
                $l[$offen]['geaendert'] = jetzt();
                return 'gehen';
            }
            $x = passender_einsatz($person, $obj['id']);
            $l[] = ['id' => bin2hex(random_bytes(6)), 'hash' => $hash, 'name' => $person['name'] ?? '', 'objektId' => $obj['id'], 'objekt' => $obj['name'], 'einsatz' => $x['id'] ?? '', 'plan' => $x['zeit'] ?? '', 'datum' => $x['datum'] ?? heute(), 'kommen' => jetzt(), 'gehen' => null, 'geaendert' => jetzt()];
            return 'kommen';
        });
        if ($ergebnis === null) {
            html_seite('<h1>' . th('titel_zeit') . '</h1><p class="fehler">' . th('nicht_gespeichert') . '</p>', 500, '', t('titel_zeit'));
            exit;
        }
        if (empty($person['stempelt'])) {
            $person['stempelt'] = jetzt(); // ab jetzt gilt der Alarm bei Nichterscheinen
            json_schreiben(person_datei($hash), $person);
        }
        header('Location: ' . $zurueck . '&erfasst=' . $ergebnis, true, 303);
        exit;
    }
    // Stand: letzte Stempelung hier (16 h)
    $letzte = null;
    foreach (json_lesen(speicher() . '/zeiten.json') as $r) {
        if ($r['hash'] === $hash && $r['objektId'] === $obj['id'] && (int) $r['kommen'] > jetzt() - 16 * 3600 && (!$letzte || $r['kommen'] > $letzte['kommen'])) {
            $letzte = $r;
        }
    }
    $erfasst = (string) ($_GET['erfasst'] ?? '');
    $um = fn (int $ts): string => $h(t('uhrzeit', ['zeit' => uhr($ts)]));
    $info = '';
    if ($erfasst === 'kommen' && $letzte) {
        $info = '<p class="ok">' . th('kommen_erfasst', ['uhr' => $um((int) $letzte['kommen'])]) . '</p>';
    } elseif ($erfasst === 'gehen' && $letzte && !empty($letzte['gehen'])) {
        $info = '<p class="ok">' . th('gehen_erfasst', ['uhr' => $um((int) $letzte['gehen']), 'dauer' => $h(dauer((int) $letzte['gehen'] - (int) $letzte['kommen']))]) . '</p>';
    } elseif ($erfasst === 'doppelt') {
        $info = '<p class="ok">' . th('schon_erfasst') . '</p>';
    }
    $offen = $letzte && empty($letzte['gehen']);
    $x = $offen ? null : passender_einsatz($person, $obj['id']);
    $stand = $offen
        ? '<p>' . ($letzte['plan'] ? th('eingestempelt_seit_plan', ['uhr' => '<b>' . $um((int) $letzte['kommen']) . '</b>', 'plan' => $h((string) $letzte['plan'])]) : th('eingestempelt_seit', ['uhr' => '<b>' . $um((int) $letzte['kommen']) . '</b>'])) . '</p>'
        : ($x ? '<p>' . th('laut_plan', ['zeit' => '<b>' . $h((string) $x['zeit']) . '</b>']) . (!empty($x['leistung']) ? ' · ' . $h((string) $x['leistung']) : '') . '</p>' : '<p class="leise">' . th('kein_einsatz_hier') . '</p>');
    $knopf = '<form method="post" action="' . $h($zurueck) . '&amp;aktion=stempeln"><button type="submit">' . th($offen ? 'gehen_knopf' : 'kommen_knopf') . '</button></form>';
    html_seite(sprachwahl_html($zurueck) . '<h1>' . th('titel_zeit') . '</h1><p><b>' . $h((string) $obj['name']) . '</b><br>' . $h((string) ($person['name'] ?? '')) . '</p>' . $info . $stand
        . '<p class="leise">' . th('jetzt', ['uhr' => $um(jetzt())]) . '</p>' . $knopf
        . '<p class="leise" style="margin-top:1.5rem;font-size:.9rem">' . th('serverzeit') . ' <a href="mein-plan.php">' . th('titel') . '</a></p>', 200, '', t('titel_zeit'));
    exit;
}

// Antrag oder Krankmeldung
if ($aktion === 'antrag' && $methode === 'POST') {
    if (fremde_herkunft()) {
        html_seite('<p>' . th('nicht_erlaubt') . '</p>', 403, '', t('titel'));
        exit;
    }
    $art = (string) ($_POST['art'] ?? '');
    $von = (string) ($_POST['von'] ?? '');
    $bis = (string) ($_POST['bis'] ?? '') ?: $von;
    $notiz = mb_substr(trim((string) ($_POST['notiz'] ?? '')), 0, 300);
    $fehler = '';
    $gueltig = fn ($d) => (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && DateTimeImmutable::createFromFormat('!Y-m-d', $d);
    if (!in_array($art, ARTEN, true)) {
        $fehler = t('fehler_art');
    } elseif (!$gueltig($von) || !$gueltig($bis) || $bis < $von) {
        $fehler = t('fehler_zeitraum');
    } elseif ($bis > tag_plus($von, 60)) {
        $fehler = t('fehler_60_tage');
    } elseif ($von < tag_plus(heute(), -7)) {
        $fehler = t('fehler_zurueck');
    }
    $neu = null;
    if (!$fehler) {
        $neu = antraege(function (array &$l) use ($hash, $person, $art, $von, $bis, $notiz) {
            $heute = array_filter($l, fn ($a) => $a['hash'] === $hash && (int) $a['erstellt'] > jetzt() - 86400);
            if (count($heute) >= 10) {
                return false;
            }
            $a = ['id' => bin2hex(random_bytes(6)), 'hash' => $hash, 'name' => $person['name'] ?? '', 'art' => $art, 'von' => $von, 'bis' => $bis, 'notiz' => $notiz, 'erstellt' => jetzt(), 'status' => 'offen', 'antwort' => ''];
            $l[] = $a;
            return $a;
        });
        if ($neu === false) {
            $fehler = t('zu_viele_antraege');
        } elseif ($neu === null) {
            $fehler = t('nicht_gespeichert');
        }
    }
    if ($fehler) {
        $meldung = '<p class="fehler">' . $h($fehler) . '</p>';
    } else {
        // Büro benachrichtigen (Krankmeldung dringender)
        $krank = $art === 'Krankenstand';
        $titel = ($krank ? 'Krankmeldung: ' : $art . ': ') . ($person['name'] ?? '');
        $text = ($krank ? 'Krank ab ' . $tag($von, 'de') . ($bis !== $von ? ', voraussichtlich bis ' . $tag($bis, 'de') : '') : $zeitraum($von, $bis, 'de')) . ($notiz ? "\n„{$notiz}“" : '') . "\nIn der App unter „Zu erledigen“.";
        $app = rtrim((string) ($e['adresse'] ?? ''), '/') . '/#home';
        foreach ((array) ($e['buero'] ?? []) as $b) {
            if (!empty($b['ntfy'])) {
                ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $b['ntfy'], 'title' => $titel, 'message' => $text, 'priority' => $krank ? 4 : 3, 'tags' => [$krank ? 'face_with_thermometer' : 'palm_tree'], 'click' => $app]);
            }
            if (!empty($b['email'])) {
                mail_senden((string) $b['email'], $titel, $text . "\n\nApp: $app\n", (string) ($e['absender'] ?? ''), 'Mein Dienstplan');
            }
        }
        header('Location: mein-plan.php?gesendet=' . ($krank ? 'krank' : 'antrag'), true, 303);
        exit;
    }
}

// Material fehlt im Objekt: geht ans Lager (App → Material & Lager → Anforderungen)
if ($aktion === 'material' && $methode === 'POST') {
    if (fremde_herkunft()) {
        html_seite('<p>' . th('nicht_erlaubt') . '</p>', 403, '', t('titel'));
        exit;
    }
    $objekte = meine_objekte($person);
    $objekt = (string) ($_POST['objekt'] ?? '');
    $was = mb_substr(trim((string) ($_POST['was'] ?? '')), 0, 300);
    $fehler = '';
    if (!isset($objekte[$objekt])) {
        $fehler = t('fehler_objekt');
    } elseif ($was === '') {
        $fehler = t('fehler_was_fehlt');
    }
    if (!$fehler) {
        $neu = antraege(function (array &$l) use ($hash, $person, $objekt, $objekte, $was) {
            $heute = array_filter($l, fn ($a) => $a['hash'] === $hash && (int) $a['erstellt'] > jetzt() - 86400);
            if (count($heute) >= 10) {
                return false;
            }
            $a = ['id' => bin2hex(random_bytes(6)), 'hash' => $hash, 'name' => $person['name'] ?? '', 'art' => 'Material', 'objekt' => $objekt, 'text' => $objekte[$objekt], 'von' => heute(), 'bis' => heute(), 'notiz' => $was, 'erstellt' => jetzt(), 'status' => 'offen', 'antwort' => ''];
            $l[] = $a;
            return $a;
        });
        if ($neu === false) {
            $fehler = t('zu_viele_meldungen');
        } elseif ($neu === null) {
            $fehler = t('nicht_gespeichert');
        }
    }
    if ($fehler) {
        $meldung = '<p class="fehler">' . $h($fehler) . '</p>';
    } else {
        $titel = 'Material fehlt: ' . $objekte[$objekt];
        $text = ($person['name'] ?? '') . ": „{$was}“\nIn der App unter „Material & Lager“.";
        $app = rtrim((string) ($e['adresse'] ?? ''), '/') . '/#material';
        foreach ((array) ($e['buero'] ?? []) as $b) {
            if (!empty($b['ntfy'])) {
                ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $b['ntfy'], 'title' => $titel, 'message' => $text, 'priority' => 3, 'tags' => ['package'], 'click' => $app]);
            }
            if (!empty($b['email'])) {
                mail_senden((string) $b['email'], $titel, $text . "\n\nApp: $app\n", (string) ($e['absender'] ?? ''), 'Mein Dienstplan');
            }
        }
        header('Location: mein-plan.php?gesendet=material', true, 303);
        exit;
    }
}

// Gerät kaputt: geht ans Büro (App → Geräte & Maschinen → Reparaturen), ohne Foto
if ($aktion === 'geraet' && $methode === 'POST') {
    if (fremde_herkunft()) {
        html_seite('<p>' . th('nicht_erlaubt') . '</p>', 403, '', t('titel'));
        exit;
    }
    $objekte = meine_objekte($person);
    $objekt = (string) ($_POST['objekt'] ?? '');
    $geraet = mb_substr(trim((string) ($_POST['geraet'] ?? '')), 0, 80);
    $was = mb_substr(trim((string) ($_POST['was'] ?? '')), 0, 300);
    $fehler = '';
    if (!isset($objekte[$objekt])) {
        $fehler = t('fehler_objekt');
    } elseif ($geraet === '' || $was === '') {
        $fehler = t('fehler_geraet');
    }
    if (!$fehler) {
        $neu = antraege(function (array &$l) use ($hash, $person, $objekt, $objekte, $geraet, $was) {
            $heute = array_filter($l, fn ($a) => $a['hash'] === $hash && (int) $a['erstellt'] > jetzt() - 86400);
            if (count($heute) >= 10) {
                return false;
            }
            $a = ['id' => bin2hex(random_bytes(6)), 'hash' => $hash, 'name' => $person['name'] ?? '', 'art' => 'Geraet', 'objekt' => $objekt, 'text' => $objekte[$objekt], 'geraet' => $geraet, 'von' => heute(), 'bis' => heute(), 'notiz' => $was, 'erstellt' => jetzt(), 'status' => 'offen', 'antwort' => ''];
            $l[] = $a;
            return $a;
        });
        if ($neu === false) {
            $fehler = t('zu_viele_meldungen');
        } elseif ($neu === null) {
            $fehler = t('nicht_gespeichert');
        }
    }
    if ($fehler) {
        $meldung = '<p class="fehler">' . $h($fehler) . '</p>';
    } else {
        $titel = 'Gerät kaputt: ' . $geraet;
        $text = ($person['name'] ?? '') . " ({$objekte[$objekt]}): „{$was}“\nIn der App unter „Geräte & Maschinen“.";
        $app = rtrim((string) ($e['adresse'] ?? ''), '/') . '/#geraete';
        foreach ((array) ($e['buero'] ?? []) as $b) {
            if (!empty($b['ntfy'])) {
                ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $b['ntfy'], 'title' => $titel, 'message' => $text, 'priority' => 3, 'tags' => ['wrench'], 'click' => $app]);
            }
            if (!empty($b['email'])) {
                mail_senden((string) $b['email'], $titel, $text . "\n\nApp: $app\n", (string) ($e['absender'] ?? ''), 'Mein Dienstplan');
            }
        }
        header('Location: mein-plan.php?gesendet=geraet', true, 303);
        exit;
    }
}

// Einsatzbörse: „Ich übernehme“
if ($aktion === 'melden' && $methode === 'POST') {
    if (fremde_herkunft()) {
        html_seite('<p>' . th('nicht_erlaubt') . '</p>', 403, '', t('titel'));
        exit;
    }
    $id = (string) ($_POST['einsatz'] ?? '');
    $angebot = null;
    foreach (angebote_von($hash) as $o) {
        if ($o['id'] === $id) {
            $angebot = $o;
        }
    }
    $neu = !$angebot ? null : antraege(function (array &$l) use ($hash, $person, $angebot) {
        foreach ($l as $a) {
            if ($a['hash'] === $hash && ($a['einsatz'] ?? '') === $angebot['id'] && $a['status'] === 'offen') {
                return 'schon';
            }
        }
        if (count(array_filter($l, fn ($a) => $a['hash'] === $hash && (int) $a['erstellt'] > jetzt() - 86400)) >= 10) {
            return false;
        }
        $a = ['id' => bin2hex(random_bytes(6)), 'hash' => $hash, 'name' => $person['name'] ?? '', 'art' => 'Einsatz', 'von' => $angebot['datum'], 'bis' => $angebot['datum'], 'einsatz' => $angebot['id'], 'text' => trim($angebot['zeit'] . ' ' . $angebot['objekt']), 'notiz' => '', 'erstellt' => jetzt(), 'status' => 'offen', 'antwort' => ''];
        $l[] = $a;
        return $a;
    });
    if (!$angebot) {
        $meldung = '<p class="fehler">' . th('einsatz_nicht_offen') . '</p>';
    } elseif ($neu === false) {
        $meldung = '<p class="fehler">' . th('zu_viele_meldungen') . '</p>';
    } elseif ($neu === null) {
        $meldung = '<p class="fehler">' . th('nicht_gespeichert') . '</p>';
    } else {
        if (is_array($neu)) {
            $app = rtrim((string) ($e['adresse'] ?? ''), '/') . '/#home';
            $text = $tag($angebot['datum'], 'de') . ' ' . $neu['text'] . ($angebot['leistung'] ? ' (' . $angebot['leistung'] . ')' : '') . "\nIn der App unter „Zu erledigen“ einteilen.";
            foreach ((array) ($e['buero'] ?? []) as $b) {
                if (!empty($b['ntfy'])) {
                    ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $b['ntfy'], 'title' => 'Übernimmt Einsatz: ' . ($person['name'] ?? ''), 'message' => $text, 'priority' => 3, 'tags' => ['raising_hand'], 'click' => $app]);
                }
                if (!empty($b['email'])) {
                    mail_senden((string) $b['email'], 'Übernimmt Einsatz: ' . ($person['name'] ?? ''), $text . "\n\nApp: $app\n", (string) ($e['absender'] ?? ''), 'Mein Dienstplan');
                }
            }
        }
        header('Location: mein-plan.php?gesendet=einsatz', true, 303);
        exit;
    }
}

// Dienst abgeben: Anfrage ans Büro (das stellt den Einsatz in die Börse oder lehnt ab)
if ($aktion === 'abgeben' && $methode === 'POST') {
    if (fremde_herkunft()) {
        html_seite('<p>' . th('nicht_erlaubt') . '</p>', 403, '', t('titel'));
        exit;
    }
    $id = (string) ($_POST['einsatz'] ?? '');
    $notiz = mb_substr(trim((string) ($_POST['notiz'] ?? '')), 0, 300);
    $eintrag = null;
    foreach ((array) ($person['wochen'] ?? []) as $w) {
        foreach ((array) ($w['tage'] ?? []) as $t) {
            foreach ((array) ($t['eintraege'] ?? []) as $x) {
                if (($x['id'] ?? '') === $id && $id !== '' && empty($x['entfaellt']) && !empty($x['beginn']) && wien_ts((string) $t['datum'], (string) $x['beginn']) > jetzt() + 2 * 3600) {
                    $eintrag = $x + ['datum' => $t['datum']];
                }
            }
        }
    }
    $neu = !$eintrag ? null : antraege(function (array &$l) use ($hash, $person, $eintrag, $notiz) {
        foreach ($l as $a) {
            if ($a['hash'] === $hash && ($a['einsatz'] ?? '') === $eintrag['id'] && in_array($a['status'], ['offen', 'genehmigt'], true) && $a['art'] === 'Abgabe') {
                return 'schon';
            }
        }
        if (count(array_filter($l, fn ($a) => $a['hash'] === $hash && (int) $a['erstellt'] > jetzt() - 86400)) >= 10) {
            return false;
        }
        $a = ['id' => bin2hex(random_bytes(6)), 'hash' => $hash, 'name' => $person['name'] ?? '', 'art' => 'Abgabe', 'von' => $eintrag['datum'], 'bis' => $eintrag['datum'], 'einsatz' => $eintrag['id'], 'text' => trim(($eintrag['zeit'] ?? '') . ' ' . ($eintrag['objekt'] ?? '')), 'notiz' => $notiz, 'erstellt' => jetzt(), 'status' => 'offen', 'antwort' => ''];
        $l[] = $a;
        return $a;
    });
    if (!$eintrag) {
        $meldung = '<p class="fehler">' . th('abgabe_nicht_moeglich') . '</p>';
    } elseif ($neu === false) {
        $meldung = '<p class="fehler">' . th('zu_viele_anfragen') . '</p>';
    } elseif ($neu === null) {
        $meldung = '<p class="fehler">' . th('nicht_gespeichert') . '</p>';
    } else {
        if (is_array($neu)) {
            $app = rtrim((string) ($e['adresse'] ?? ''), '/') . '/#home';
            $text = $tag($eintrag['datum'], 'de') . ' ' . $neu['text'] . ($notiz ? "\n„{$notiz}“" : '') . "\nIn der App unter „Zu erledigen“: in die Einsatzbörse stellen oder ablehnen.";
            foreach ((array) ($e['buero'] ?? []) as $b) {
                if (!empty($b['ntfy'])) {
                    ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $b['ntfy'], 'title' => 'Möchte abgeben: ' . ($person['name'] ?? ''), 'message' => $text, 'priority' => 3, 'tags' => ['arrows_counterclockwise'], 'click' => $app]);
                }
                if (!empty($b['email'])) {
                    mail_senden((string) $b['email'], 'Möchte abgeben: ' . ($person['name'] ?? ''), $text . "\n\nApp: $app\n", (string) ($e['absender'] ?? ''), 'Mein Dienstplan');
                }
            }
        }
        header('Location: mein-plan.php?gesendet=abgabe', true, 303);
        exit;
    }
}

// Plan: diese Woche und die kommenden (sonst die letzte veröffentlichte)
$montag = (new DateTimeImmutable(heute() . ' monday this week'))->format('Y-m-d');
$wochen = array_filter((array) ($person['wochen'] ?? []), fn ($k) => $k >= $montag, ARRAY_FILTER_USE_KEY);
if (!$wochen && !empty($person['wochen'])) {
    $wochen = array_slice((array) $person['wochen'], -1, 1, true);
}
$meldung = $meldung ?? '';
$gesendet = ['krank' => 'ok_krank', 'antrag' => 'ok_antrag', 'einsatz' => 'ok_einsatz', 'abgabe' => 'ok_abgabe', 'material' => 'ok_material', 'geraet' => 'ok_geraet', 'mitteilung' => 'mit_ok'][(string) ($_GET['gesendet'] ?? '')] ?? null;
if ($gesendet) {
    $meldung = '<p class="ok">' . th($gesendet) . '</p>';
}
// eigene Anträge (vor dem Plan: Abgaben stehen beim Einsatz)
$meine = array_values(array_filter(antraege(fn (array &$l) => $l) ?? [], fn ($a) => $a['hash'] === $hash && (($a['bis'] ?? '') >= tag_plus(heute(), -60) || $a['status'] === 'offen')));
usort($meine, fn ($a, $b) => $b['erstellt'] <=> $a['erstellt']);
$p = '<input type="hidden" name="p" value="' . $h($code) . '">';
$abgaben = [];
foreach ($meine as $a) {
    if (($a['art'] ?? '') === 'Abgabe' && in_array($a['status'], ['offen', 'genehmigt'], true)) {
        $abgaben[$a['einsatz']] = $a;
    }
}
// erfasste Zeiten je Einsatz (Zeiterfassung)
$gestempelt = [];
foreach (zeiterfassung($e) ? json_lesen(speicher() . '/zeiten.json') : [] as $r) {
    if ($r['hash'] === $hash && !empty($r['einsatz'])) {
        $gestempelt[$r['einsatz']] = $r;
    }
}
$planHtml = '';
foreach ($wochen as $mo => $w) {
    $tageHtml = '';
    foreach ((array) ($w['tage'] ?? []) as $t) {
        $eintraege = (array) ($t['eintraege'] ?? []);
        $termine = (array) ($t['termine'] ?? []);
        if (!$eintraege && !$termine && empty($t['abwesend']) && empty($t['feiertag'])) {
            continue;
        }
        $zeilen = '';
        foreach ($termine as $x) {
            $zeilen .= '<div class="einsatz termin"><b>' . (!empty($x['ganztags']) ? th('ganztaegig') : $h((string) ($x['zeit'] ?? ''))) . '</b> <span class="pill">' . th('termin') . '</span> ' . $h((string) ($x['titel'] ?? ''))
                . (!empty($x['ort']) ? '<br><span class="leise">' . $h((string) $x['ort']) . '</span>' : '') . '</div>';
        }
        foreach ($eintraege as $x) {
            $adresse = (string) ($x['adresse'] ?? '');
            $karte = $adresse !== '' ? ' · <a href="https://www.google.com/maps/search/?api=1&amp;query=' . rawurlencode($adresse) . '" target="_blank" rel="noopener">' . th('karte') . '</a>' : '';
            $info = objektinfo_html($x, is_array($w['objektinfo'][$x['objektId'] ?? ''] ?? null) ? $w['objektinfo'][$x['objektId']] : null);
            $zeilen .= '<div class="einsatz' . (!empty($x['entfaellt']) ? ' weg' : '') . '"><b>' . $h((string) ($x['zeit'] ?? '')) . '</b> ' . $h((string) ($x['objekt'] ?? ''))
                . (!empty($x['leistung']) ? ' <span class="leise">· ' . $h((string) $x['leistung']) . '</span>' : '')
                . ($adresse !== '' ? '<br><span class="leise">' . $h($adresse) . $karte . '</span>' : '')
                . (!empty($x['notizen']) ? '<br><span class="hinweis">' . $h(implode(' · ', array_map(fn ($n) => notiz_text((string) $n), (array) $x['notizen']))) . '</span>' : '')
                . (isset($abgaben[$x['id'] ?? '']) ? ' <span class="pill st-offen">' . th('abgabe_status', ['status' => $h(status_text($abgaben[$x['id']]))]) . '</span>'
                    : (empty($x['entfaellt']) && !empty($x['id']) && !empty($x['beginn']) && wien_ts((string) $t['datum'], (string) $x['beginn']) > jetzt() + 2 * 3600
                        ? '<details class="abgabe"><summary>' . th('abgeben') . '</summary><form method="post" action="mein-plan.php?aktion=abgeben">' . $p . '<input type="hidden" name="einsatz" value="' . $h((string) $x['id']) . '"><label>' . th('grund_optional') . '<textarea name="notiz" rows="2" maxlength="300"></textarea></label><button type="submit" class="klein">' . th('abgabe_anfragen') . '</button></form></details>' : ''))
                . (isset($gestempelt[$x['id'] ?? '']) ? '<br><span class="zeit-ok">✓ ' . uhr((int) $gestempelt[$x['id']]['kommen']) . (!empty($gestempelt[$x['id']]['gehen']) ? '–' . uhr((int) $gestempelt[$x['id']]['gehen']) : ' ' . th('eingestempelt')) . '</span>' : '')
                . ($info !== '' || !empty($x['schluessel']) ? '<details><summary>' . th('objektinfo') . '</summary>' . $info . (!empty($x['schluessel']) ? '<p class="leise">' . th('schluessel', ['text' => $h((string) $x['schluessel'])]) . '</p>' : '') . '</details>' : '')
                . '</div>';
        }
        $tageHtml .= '<section class="tag"><h3>' . $h(datum_sprache((string) $t['datum'], true)) . (!empty($t['feiertag']) ? ' <span class="pill">' . th('feiertag', ['name' => $h((string) $t['feiertag'])]) . '</span>' : '') . (!empty($t['abwesend']) ? ' <span class="pill abw">' . $h(art_text((string) $t['abwesend'])) . '</span>' : '') . '</h3>' . ($zeilen ?: '<p class="leise">' . th('frei') . '</p>') . '</section>';
    }
    $summe = (array) ($w['summe'] ?? []);
    $geaendert = !empty($w['geaendert']) ? (new DateTimeImmutable('@' . (int) $w['geaendert']))->setTimezone(new DateTimeZone('Europe/Vienna')) : null;
    $planHtml .= '<h2>' . th('kw', ['kw' => $h((string) ($w['kw'] ?? ''))]) . ' <span class="leise">' . $h($zeitraum((string) ($w['von'] ?? $mo), (string) ($w['bis'] ?? $mo))) . '</span></h2>'
        . ($geaendert ? '<p class="pill neu">' . th('geaendert_am', ['datum' => $h(t('datum_kurz', ['d' => $geaendert->format('d'), 'm' => $geaendert->format('m')])), 'zeit' => $geaendert->format('H:i')]) . '</p>' : '')
        . ($tageHtml ?: '<p class="leise">' . th('keine_einsaetze') . '</p>')
        . '<p class="summe">' . th('stunden', ['h' => '<b>' . $stunden($summe['ist'] ?? 0) . ' h</b>']) . (isset($summe['soll']) ? ' · ' . th('soll', ['h' => $stunden($summe['soll']) . ' h']) : '') . (isset($w['konto']) && $w['konto'] !== null ? ' · ' . th('konto_danach', ['h' => $konto($w['konto']) . ' h']) : '') . '</p>';
}
$antraegeHtml = $meine ? '<h2>' . th('meine_antraege') . '</h2><ul class="antraege">' . implode('', array_map(fn ($a) => '<li><b>' . $h(art_text((string) $a['art'])) . '</b> ' . $h($zeitraum($a['von'], $a['bis'])) . (in_array($a['art'] ?? '', ['Einsatz', 'Abgabe', 'Material', 'Geraet'], true) ? ' · ' . $h((string) ($a['text'] ?? '')) : '') . (($a['art'] ?? '') === 'Geraet' && !empty($a['geraet']) ? ' · ' . $h((string) $a['geraet']) : '') . (in_array($a['art'] ?? '', ['Material', 'Geraet'], true) && !empty($a['notiz']) ? ': „' . $h((string) $a['notiz']) . '“' : '') . ' <span class="pill st-' . $h($a['status']) . '">' . $h(status_text($a)) . '</span>' . ($a['antwort'] ? '<br><span class="leise">' . $h(antwort_text((string) $a['antwort'])) . '</span>' : '') . '</li>', $meine)) . '</ul>' : '';
$gemeldet = array_column(array_filter($meine, fn ($a) => ($a['art'] ?? '') === 'Einsatz' && $a['status'] === 'offen'), 'einsatz');
$boerse = '';
foreach (angebote_von($hash) as $o) {
    $adresse = (string) $o['adresse'];
    $boerse .= '<div class="einsatz angebot"><b>' . $h($tag($o['datum'])) . ' ' . $h($o['zeit']) . '</b> ' . $h($o['objekt'])
        . ($o['leistung'] ? ' <span class="leise">· ' . $h($o['leistung']) . '</span>' : '')
        . ($adresse !== '' ? '<br><span class="leise">' . $h($adresse) . ' · <a href="https://www.google.com/maps/search/?api=1&amp;query=' . rawurlencode($adresse) . '" target="_blank" rel="noopener">Karte</a></span>' : '')
        . '<br><span class="leise">' . $stunden($o['minuten']) . ' h' . (!empty($o['tausch']) ? ' · ' . th('tausch') : '') . '</span>'
        . (in_array($o['id'], $gemeldet, true) ? ' <span class="pill st-offen">' . th('einsatz_offen') . '</span>' : '<form method="post" action="mein-plan.php?aktion=melden">' . $p . '<input type="hidden" name="einsatz" value="' . $h($o['id']) . '"><button type="submit" class="klein">' . th('ich_uebernehme') . '</button></form>')
        . '</div>';
}
$boerseHtml = $boerse ? '<h2>' . th('boerse_titel') . '</h2><p class="leise">' . th('boerse_text') . '</p>' . $boerse : '';
$heute = heute();
$objekte = meine_objekte($person);
$materialForm = $objekte ? '<h2>' . th('material_titel') . '</h2><details><summary>' . th('material_summary') . '</summary><form method="post" action="mein-plan.php?aktion=material">' . $p
    . '<label for="m-obj">' . th('objekt') . '</label><select id="m-obj" name="objekt">' . implode('', array_map(fn ($id, $name) => '<option value="' . $h((string) $id) . '">' . $h($name) . '</option>', array_keys($objekte), $objekte)) . '</select>'
    . '<label for="m-was">' . th('was_fehlt') . '</label><textarea id="m-was" name="was" rows="2" maxlength="300" required placeholder="' . th('was_fehlt_bsp') . '"></textarea>'
    . '<button type="submit">' . th('melden') . '</button><p class="leise">' . th('material_info') . '</p></form></details>' : '';
// Art: Wert bleibt deutsch (das Büro liest ihn), angezeigt wird die Übersetzung
$option = fn (string $wert): string => ($text = art_text($wert)) === $wert ? '<option>' . $h($wert) . '</option>' : '<option value="' . $h($wert) . '">' . $h($text) . '</option>';
// Gerät kaputt? (ohne Foto): Objekt aus dem eigenen Plan, Gerät mit der Nummer vom Etikett, was kaputt ist
$geraetForm = $objekte ? '<h2>' . th('geraet_titel') . '</h2><details><summary>' . th('geraet_summary') . '</summary><form method="post" action="mein-plan.php?aktion=geraet">' . $p
    . '<label for="g-obj">' . th('objekt') . '</label><select id="g-obj" name="objekt">' . implode('', array_map(fn ($id, $name) => '<option value="' . $h((string) $id) . '">' . $h($name) . '</option>', array_keys($objekte), $objekte)) . '</select>'
    . '<label for="g-geraet">' . th('geraet_welches') . '</label><input type="text" id="g-geraet" name="geraet" maxlength="80" required placeholder="' . th('geraet_welches_bsp') . '">'
    . '<label for="g-was">' . th('geraet_schaden') . '</label><textarea id="g-was" name="was" rows="2" maxlength="300" required placeholder="' . th('geraet_schaden_bsp') . '"></textarea>'
    . '<button type="submit">' . th('melden') . '</button><p class="leise">' . th('geraet_info') . '</p></form></details>' : '';
$formulare = $materialForm . $geraetForm . '<h2>' . th('abwesenheit') . '</h2>'
    . '<details><summary>' . th('krank_melden') . '</summary><form method="post" action="mein-plan.php?aktion=antrag">' . $p . '<input type="hidden" name="art" value="Krankenstand">'
    . '<label for="k-von">' . th('krank_ab') . '</label><input type="date" id="k-von" name="von" value="' . $heute . '" required>'
    . '<label for="k-bis">' . th('krank_bis') . '</label><input type="date" id="k-bis" name="bis">'
    . '<label for="k-notiz">' . th('krank_notiz') . '</label><textarea id="k-notiz" name="notiz" rows="2" maxlength="300"></textarea>'
    . '<button type="submit">' . th('krank_senden') . '</button><p class="leise">' . th('krank_info') . '</p></form></details>'
    . '<details><summary>' . th('antrag_summary') . '</summary><form method="post" action="mein-plan.php?aktion=antrag">' . $p
    . '<label for="a-art">' . th('art') . '</label><select id="a-art" name="art">' . $option('Urlaub') . $option('Zeitausgleich') . $option('Pflegefreistellung') . '</select>'
    . '<label for="a-von">' . th('von') . '</label><input type="date" id="a-von" name="von" required><label for="a-bis">' . th('bis') . '</label><input type="date" id="a-bis" name="bis" required>'
    . '<label for="a-notiz">' . th('notiz_optional') . '</label><textarea id="a-notiz" name="notiz" rows="2" maxlength="300"></textarea>'
    . '<button type="submit">' . th('antrag_senden') . '</button></form></details>';
// Kalender-Abo: Plan und Termine erscheinen im eigenen Kalender (Outlook, Google, iPhone) und bleiben aktuell
$aboAdresse = rtrim((string) ($e['adresse'] ?? ''), '/');
if ($aboAdresse === '') {
    $aboAdresse = (!empty($_SERVER['HTTPS']) ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? '') . rtrim(dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
}
$aboLink = $aboAdresse . '/mein-plan.php?aktion=kalender&p=' . rawurlencode($code);
$aboHtml = $code !== '' ? '<h2>' . th('kalender_titel') . '</h2><details><summary>' . th('kalender_summary') . '</summary>'
    . '<p><a class="knopf" href="' . $h(preg_replace('#^https?://#', 'webcal://', $aboLink)) . '">' . th('kalender_abo') . '</a></p>'
    . '<p class="leise">' . th('kalender_hilfe') . '</p>'
    . '<input readonly value="' . $h($aboLink) . '" onclick="this.select()" style="width:100%">'
    . '<p class="leise">' . th('kalender_info') . '</p></details>' : '';
// Matten-Tour (Fahrer ohne Microsoft-Konto, mattentour.php): Hinweis, wenn für diese Person eine Tour freigegeben ist;
// mattentour.php erkennt die Person am selben Link (Cookie mein_plan)
$mattenFahrer = json_lesen((getenv('MATTEN_ORDNER') ?: ordner()) . '/matten/fahrer/' . $hash . '.json');
$mattenTouren = empty($mattenFahrer['entfernt']) ? array_filter((array) ($mattenFahrer['touren'] ?? []), fn ($d) => is_string($d) && $d >= tag_plus(heute(), -1) && $d <= tag_plus(heute(), 7)) : [];
$mattenHtml = $mattenTouren && is_file(__DIR__ . '/mattentour.php') ? '<p class="summe">' . th('mt_plan_text') . '</p><p><a class="knopf" href="mattentour.php' . (isset($_GET['p']) ? '?p=' . rawurlencode($code) : '') . '">' . th('mt_plan_oeffnen') . '</a></p>' : '';
$hier = 'mein-plan.php' . (isset($_GET['p']) ? '?p=' . rawurlencode($code) : '');
html_seite(sprachwahl_html($hier) . '<h1>' . th('titel') . '</h1><p>' . $h((string) ($person['name'] ?? '')) . '</p>' . $meldung . mit_html($hash, $code) . $mattenHtml
    . '<style>.tag{border-top:1px solid #dde5ea;padding:.5rem 0}.tag h3{font-size:1rem;margin:.2rem 0}.einsatz{margin:.35rem 0}.einsatz.weg{text-decoration:line-through;color:#6f8596}.einsatz.termin{border-left:3px solid #7b5cc4;padding-left:.5rem}.knopf{display:inline-block;padding:.5rem 1rem;border-radius:8px;background:#0c6cb4;color:#fff;text-decoration:none}.hinweis{color:#8a5300;font-size:.95rem}.pill{display:inline-block;border-radius:999px;padding:0 .6rem;font-size:.85rem;background:#e8f1fa;color:#0a5a96;font-weight:600}.pill.abw{background:#fdf0d5;color:#8a5300}.pill.neu{background:#fce8e6;color:#b3261e}.st-genehmigt,.st-erledigt{background:#eef6e2!important;color:#4e7a1e!important}.st-abgelehnt{background:#fce8e6!important;color:#b3261e!important}.summe{background:#f3f6f8;border-radius:8px;padding:.5rem .7rem}details{margin:.6rem 0}summary{font-weight:600;cursor:pointer;padding:.3rem 0}input[type=date]{font:inherit;width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #c9d6df;border-radius:8px}.angebot{border:1px solid #dde5ea;border-radius:8px;padding:.6rem .7rem}.zeit-ok{color:#4e7a1e;font-weight:600;font-size:.95rem}details.abgabe{margin:.2rem 0 .4rem}details.abgabe summary{font-weight:400;font-size:.95rem;color:#0a5a96}details.abgabe label{font-weight:400}button.klein{font-size:1rem;padding:.55rem 1rem;margin-top:.5rem}'
    . '.mitteilungen h2{margin-top:1rem}.mit{border:1px solid #c9d6df;border-radius:8px;padding:.6rem .8rem;margin:.6rem 0}.mit h3{font-size:1.05rem;margin:0 0 .2rem}.mit-offen{border:2px solid #0a5a96}.mit-erinnert{background:#fff8e6}.mit-kopf{margin:.1rem 0 .4rem;color:#13232f}.mit-text{margin:.3rem 0}.mit-wichtig{background:#fce8e6!important;color:#b3261e!important}.mit-erinnerung{background:#fdf0d5!important;color:#6b4100!important}.mit-de summary{font-weight:400;color:#0a5a96;font-size:.95rem}.mit-de div{background:#f3f6f8;border-radius:8px;padding:.3rem .6rem}.mit-anhang{color:#0a5a96;font-weight:600}.mit .ok{margin:.4rem 0 0}</style>'
    . ($planHtml ?: '<p class="leise">' . th('kein_plan') . '</p>')
    . $boerseHtml . $antraegeHtml . $formulare . $aboHtml
    . '<p class="leise" style="margin-top:2rem;font-size:.9rem">' . th('fuss') . ' <a href="mein-plan.php?aktion=vergessen">' . th('vergessen') . '</a></p>', 200, '', t('titel'));
