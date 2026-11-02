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
// Aufrufe der App (Schlüssel im Kopf X-Schluessel): aktion=speichern | antraege | antrag-status | einrichten | zeiten
// Cronjob: mein-plan.php?aktion=pruefen&schluessel=PRÜFSCHLÜSSEL oder php mein-plan.php pruefen

declare(strict_types=1);

require __DIR__ . '/wetter-lib.php';
require __DIR__ . '/webspace-lib.php';

const COOKIE = 'mein_plan';
const ARTEN = ['Urlaub', 'Zeitausgleich', 'Pflegefreistellung', 'Krankenstand'];
const STATUS_TEXT = ['offen' => 'offen', 'genehmigt' => 'genehmigt', 'abgelehnt' => 'abgelehnt', 'erledigt' => 'eingetragen'];
const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const EINSATZ_TEXT = ['offen' => 'gemeldet', 'genehmigt' => 'eingeteilt', 'abgelehnt' => 'nicht eingeteilt', 'erledigt' => 'erledigt'];
const ABGABE_TEXT = ['offen' => 'angefragt', 'genehmigt' => 'in der Börse', 'abgelehnt' => 'nicht freigegeben', 'erledigt' => 'abgegeben'];

function status_text(array $a): string
{
    $s = (string) ($a['status'] ?? '');
    $art = $a['art'] ?? '';
    return ($art === 'Einsatz' ? EINSATZ_TEXT[$s] ?? null : ($art === 'Abgabe' ? ABGABE_TEXT[$s] ?? null : null)) ?? STATUS_TEXT[$s] ?? $s;
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
                ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $p['ntfy'], 'title' => 'Noch nicht eingestempelt: ' . $was, 'message' => 'Bitte beim Objekt den QR-Code scannen. Kommst du später, bitte im Büro melden.', 'priority' => 4, 'tags' => ['alarm_clock'], 'click' => rtrim((string) ($e['adresse'] ?? ''), '/') . '/mein-plan.php']);
            }
        }
    }
    json_schreiben($datei, $gemeldet);
    return ['geprueft' => $geprueft, 'gemeldet' => $faelle];
}

$h = fn (string $t): string => htmlspecialchars($t, ENT_QUOTES);
$tag = function (string $d): string {
    $t = DateTimeImmutable::createFromFormat('!Y-m-d', $d);
    return $t ? TAGE[(int) $t->format('N') - 1] . ' ' . $t->format('d.m.') : $d;
};
$zeitraum = fn (string $von, string $bis): string => $von === $bis ? $tag($von) : $tag($von) . ' – ' . $tag($bis);
$stunden = fn ($min): string => str_replace('.', ',', (string) round(((int) $min) / 60, 2));
$konto = fn ($min): string => ($min > 0 ? '+' : ($min < 0 ? '−' : '±')) . str_replace('.', ',', (string) round(abs((int) $min) / 60, 2));

$e = einstellungen();
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
    $ergebnis = nicht_erschienen($e, $z);
    if ($cli) {
        echo json_encode($ergebnis) . "\n";
        exit;
    }
    json_ausgabe(200, $ergebnis);
}

// ---------------------------------------------------------------- Aufrufe der App (mit Schlüssel)

if (in_array($aktion, ['speichern', 'antraege', 'antrag-status', 'einrichten', 'zeiten'], true)) {
    if (!$e) {
        json_ausgabe(503, ['fehler' => 'Mein Dienstplan noch nicht eingerichtet: privat/mitarbeiter.json fehlt (App → Mitarbeitende → Plan am Handy).']);
    }
    $gegeben = (string) ($_SERVER['HTTP_X_SCHLUESSEL'] ?? '');
    if ($gegeben === '' || !hash_equals((string) $e['schluessel'], $gegeben)) {
        json_ausgabe(403, ['fehler' => 'Schlüssel fehlt oder falsch']);
    }
    $daten = $methode === 'POST' ? json_decode((string) file_get_contents('php://input'), true) : null;

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
        if (!empty($p['ntfy']) && ($status !== 'erledigt' || $a['art'] === 'Abgabe')) {
            $was = $tag($a['von']) . ' ' . ($a['text'] ?? '');
            $titel = match ($a['art']) {
                'Einsatz' => ($status === 'genehmigt' ? 'Du bist eingeteilt: ' : 'Nicht eingeteilt: ') . $was,
                'Abgabe' => ['genehmigt' => 'In der Einsatzbörse: ', 'abgelehnt' => 'Abgabe nicht möglich: ', 'erledigt' => 'Abgegeben: '][$status] . $was,
                default => $a['art'] . ' ' . $zeitraum($a['von'], $a['bis']) . ': ' . STATUS_TEXT[$status],
            };
            ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $p['ntfy'], 'title' => $titel, 'message' => $a['antwort'] ?: 'Details in deinem Dienstplan.', 'priority' => 3, 'tags' => [$status === 'genehmigt' ? 'white_check_mark' : 'x'], 'click' => rtrim((string) ($e['adresse'] ?? ''), '/') . '/mein-plan.php']);
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
        $p['wochen'] = (array) ($p['wochen'] ?? []);
        $meldungen = [];
        foreach ((array) ($daten['wochen'][$hash] ?? []) as $mo => $woche) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $mo) || !is_array($woche)) {
                continue;
            }
            $sig = sha1(json_encode([$woche['tage'] ?? [], $woche['summe'] ?? [], $woche['konto'] ?? null]));
            $alt = $p['wochen'][$mo] ?? null;
            if (!$alt && $mo >= $montag) {
                $meldungen[] = 'Dein Dienstplan für KW ' . ($woche['kw'] ?? '') . ' ist da';
            } elseif ($alt && ($alt['sig'] ?? '') !== $sig && $mo >= $montag) {
                $meldungen[] = 'Dein Dienstplan KW ' . ($woche['kw'] ?? '') . ' wurde geändert';
            }
            $woche['sig'] = $sig;
            $woche['veroeffentlicht'] = $alt['veroeffentlicht'] ?? jetzt();
            $woche['geaendert'] = $alt && ($alt['sig'] ?? '') !== $sig ? jetzt() : ($alt['geaendert'] ?? null);
            $p['wochen'][$mo] = $woche;
        }
        if (!empty($neueAngebote[$hash])) {
            $meldungen[] = $neueAngebote[$hash] === 1 ? '1 offener Einsatz für dich' : $neueAngebote[$hash] . ' offene Einsätze für dich';
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
            if (ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => $p['ntfy'], 'title' => implode(' · ', $meldungen), 'message' => 'Antippen öffnet deinen Plan.', 'priority' => 3, 'tags' => ['calendar'], 'click' => rtrim((string) ($e['adresse'] ?? ''), '/') . '/mein-plan.php'])) {
                $benachrichtigt++;
            }
        }
    }
    json_ausgabe(200, ['personen' => $personen, 'benachrichtigt' => $benachrichtigt]);
}

// ---------------------------------------------------------------- Seite für Mitarbeitende

if (!$e) {
    html_seite('<h1>Mein Dienstplan</h1><p>Noch nicht eingerichtet. Bitte im Büro melden.</p>', 503, '', 'Mein Dienstplan');
    exit;
}
$code = (string) ($_GET['p'] ?? $_POST['p'] ?? $_COOKIE[COOKIE] ?? '');
if ($aktion === 'vergessen') {
    setcookie(COOKIE, '', ['expires' => 1, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']), 'httponly' => true, 'samesite' => 'Lax']);
    html_seite('<h1>Mein Dienstplan</h1><p>Dieses Gerät hat den persönlichen Link vergessen. Zum Öffnen wieder den Link aus der Nachricht verwenden.</p>', 200, '', 'Mein Dienstplan');
    exit;
}
$hash = preg_match('/^[A-Za-z0-9]{16,40}$/', $code) ? hash('sha256', $code) : '';
$person = $hash ? json_lesen(person_datei($hash)) : [];
$token = (string) ($_GET['o'] ?? '');
if (!$person && $token !== '') {
    html_seite('<h1>Zeiterfassung</h1><p>Dieses Handy kennt dich noch nicht. Bitte zuerst deinen persönlichen Link aus der Nachricht vom Büro öffnen, dann den Code noch einmal scannen.</p>', 403, '', 'Zeiterfassung');
    exit;
}
if (!$person) {
    html_seite('<h1>Mein Dienstplan</h1><p>Dieser Link gilt nicht (mehr). Bitte im Büro um einen neuen Link bitten.</p>', 404, '', 'Mein Dienstplan');
    exit;
}
if (isset($_GET['p'])) {
    // merken: danach genügt mein-plan.php (z. B. am Startbildschirm)
    setcookie(COOKIE, $code, ['expires' => jetzt() + 400 * 86400, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']), 'httponly' => true, 'samesite' => 'Lax']);
}

// Zeiterfassung am Objekt (QR-Code)
if ($token !== '') {
    $z = zeiterfassung($e);
    $obj = $z['objekte'][$token] ?? null;
    if (!is_array($obj)) {
        html_seite('<h1>Zeiterfassung</h1><p>Dieser Code gilt nicht (mehr). Bitte im Büro melden.</p>', 404, '', 'Zeiterfassung');
        exit;
    }
    $zurueck = 'mein-plan.php?o=' . rawurlencode($token);
    if ($aktion === 'stempeln' && $methode === 'POST') {
        if (fremde_herkunft()) {
            html_seite('<p>Nicht erlaubt.</p>', 403, '', 'Zeiterfassung');
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
            html_seite('<h1>Zeiterfassung</h1><p class="fehler">Konnte nicht speichern. Bitte im Büro anrufen.</p>', 500, '', 'Zeiterfassung');
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
    $info = '';
    if ($erfasst === 'kommen' && $letzte) {
        $info = '<p class="ok">Kommen um ' . uhr((int) $letzte['kommen']) . ' Uhr erfasst.</p>';
    } elseif ($erfasst === 'gehen' && $letzte && !empty($letzte['gehen'])) {
        $info = '<p class="ok">Gehen um ' . uhr((int) $letzte['gehen']) . ' Uhr erfasst (' . dauer((int) $letzte['gehen'] - (int) $letzte['kommen']) . '). Danke!</p>';
    } elseif ($erfasst === 'doppelt') {
        $info = '<p class="ok">Schon erfasst.</p>';
    }
    $offen = $letzte && empty($letzte['gehen']);
    $x = $offen ? null : passender_einsatz($person, $obj['id']);
    $stand = $offen
        ? '<p>Eingestempelt seit <b>' . uhr((int) $letzte['kommen']) . ' Uhr</b>' . ($letzte['plan'] ? ' (laut Plan ' . $h((string) $letzte['plan']) . ')' : '') . '.</p>'
        : ($x ? '<p>Laut Plan: <b>' . $h((string) $x['zeit']) . '</b>' . (!empty($x['leistung']) ? ' · ' . $h((string) $x['leistung']) : '') . '</p>' : '<p class="leise">Laut Plan hast du hier jetzt keinen Einsatz. Kommen trotzdem erfassen (z. B. eingesprungen)?</p>');
    $knopf = '<form method="post" action="' . $h($zurueck) . '&amp;aktion=stempeln"><button type="submit">' . ($offen ? 'Gehen erfassen' : 'Kommen erfassen') . '</button></form>';
    html_seite('<h1>Zeiterfassung</h1><p><b>' . $h((string) $obj['name']) . '</b><br>' . $h((string) ($person['name'] ?? '')) . '</p>' . $info . $stand
        . '<p class="leise">Jetzt: ' . uhr(jetzt()) . ' Uhr</p>' . $knopf
        . '<p class="leise" style="margin-top:1.5rem;font-size:.9rem">Die Uhrzeit nimmt der Server, nicht das Handy. <a href="mein-plan.php">Mein Dienstplan</a></p>', 200, '', 'Zeiterfassung');
    exit;
}

// Antrag oder Krankmeldung
if ($aktion === 'antrag' && $methode === 'POST') {
    if (fremde_herkunft()) {
        html_seite('<p>Nicht erlaubt.</p>', 403, '', 'Mein Dienstplan');
        exit;
    }
    $art = (string) ($_POST['art'] ?? '');
    $von = (string) ($_POST['von'] ?? '');
    $bis = (string) ($_POST['bis'] ?? '') ?: $von;
    $notiz = mb_substr(trim((string) ($_POST['notiz'] ?? '')), 0, 300);
    $fehler = '';
    $gueltig = fn ($d) => (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && DateTimeImmutable::createFromFormat('!Y-m-d', $d);
    if (!in_array($art, ARTEN, true)) {
        $fehler = 'Bitte die Art wählen.';
    } elseif (!$gueltig($von) || !$gueltig($bis) || $bis < $von) {
        $fehler = 'Bitte einen gültigen Zeitraum angeben.';
    } elseif ($bis > tag_plus($von, 60)) {
        $fehler = 'Höchstens 60 Tage je Antrag.';
    } elseif ($von < tag_plus(heute(), -7)) {
        $fehler = 'Der Beginn liegt zu weit zurück. Bitte im Büro melden.';
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
            $fehler = 'Zu viele Anträge heute. Bitte im Büro melden.';
        } elseif ($neu === null) {
            $fehler = 'Konnte nicht speichern. Bitte im Büro anrufen.';
        }
    }
    if ($fehler) {
        $meldung = '<p class="fehler">' . $h($fehler) . '</p>';
    } else {
        // Büro benachrichtigen (Krankmeldung dringender)
        $krank = $art === 'Krankenstand';
        $titel = ($krank ? 'Krankmeldung: ' : $art . ': ') . ($person['name'] ?? '');
        $text = ($krank ? 'Krank ab ' . $tag($von) . ($bis !== $von ? ', voraussichtlich bis ' . $tag($bis) : '') : $zeitraum($von, $bis)) . ($notiz ? "\n„{$notiz}“" : '') . "\nIn der App unter „Zu erledigen“.";
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

// Einsatzbörse: „Ich übernehme“
if ($aktion === 'melden' && $methode === 'POST') {
    if (fremde_herkunft()) {
        html_seite('<p>Nicht erlaubt.</p>', 403, '', 'Mein Dienstplan');
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
        $meldung = '<p class="fehler">Dieser Einsatz ist nicht mehr offen. Danke trotzdem!</p>';
    } elseif ($neu === false) {
        $meldung = '<p class="fehler">Zu viele Meldungen heute. Bitte im Büro melden.</p>';
    } elseif ($neu === null) {
        $meldung = '<p class="fehler">Konnte nicht speichern. Bitte im Büro anrufen.</p>';
    } else {
        if (is_array($neu)) {
            $app = rtrim((string) ($e['adresse'] ?? ''), '/') . '/#home';
            $text = $tag($angebot['datum']) . ' ' . $neu['text'] . ($angebot['leistung'] ? ' (' . $angebot['leistung'] . ')' : '') . "\nIn der App unter „Zu erledigen“ einteilen.";
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
        html_seite('<p>Nicht erlaubt.</p>', 403, '', 'Mein Dienstplan');
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
        $meldung = '<p class="fehler">Diesen Einsatz kannst du hier nicht mehr abgeben (beginnt bald oder steht nicht mehr im Plan). Bitte im Büro anrufen.</p>';
    } elseif ($neu === false) {
        $meldung = '<p class="fehler">Zu viele Anfragen heute. Bitte im Büro melden.</p>';
    } elseif ($neu === null) {
        $meldung = '<p class="fehler">Konnte nicht speichern. Bitte im Büro anrufen.</p>';
    } else {
        if (is_array($neu)) {
            $app = rtrim((string) ($e['adresse'] ?? ''), '/') . '/#home';
            $text = $tag($eintrag['datum']) . ' ' . $neu['text'] . ($notiz ? "\n„{$notiz}“" : '') . "\nIn der App unter „Zu erledigen“: in die Einsatzbörse stellen oder ablehnen.";
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
if (($_GET['gesendet'] ?? '') === 'krank') {
    $meldung = '<p class="ok">Krankmeldung ist im Büro. Gute Besserung!</p>';
} elseif (($_GET['gesendet'] ?? '') === 'antrag') {
    $meldung = '<p class="ok">Antrag gesendet. Die Antwort steht dann hier.</p>';
} elseif (($_GET['gesendet'] ?? '') === 'einsatz') {
    $meldung = '<p class="ok">Danke! Das Büro bestätigt, ob du eingeteilt bist.</p>';
} elseif (($_GET['gesendet'] ?? '') === 'abgabe') {
    $meldung = '<p class="ok">Anfrage ist im Büro. Bis jemand übernimmt, bleibt der Einsatz deiner.</p>';
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
        if (!$eintraege && empty($t['abwesend']) && empty($t['feiertag'])) {
            continue;
        }
        $zeilen = '';
        foreach ($eintraege as $x) {
            $adresse = (string) ($x['adresse'] ?? '');
            $karte = $adresse !== '' ? ' · <a href="https://www.google.com/maps/search/?api=1&amp;query=' . rawurlencode($adresse) . '" target="_blank" rel="noopener">Karte</a>' : '';
            $zeilen .= '<div class="einsatz' . (!empty($x['entfaellt']) ? ' weg' : '') . '"><b>' . $h((string) ($x['zeit'] ?? '')) . '</b> ' . $h((string) ($x['objekt'] ?? ''))
                . (!empty($x['leistung']) ? ' <span class="leise">· ' . $h((string) $x['leistung']) . '</span>' : '')
                . ($adresse !== '' ? '<br><span class="leise">' . $h($adresse) . $karte . '</span>' : '')
                . (!empty($x['notizen']) ? '<br><span class="hinweis">' . $h(implode(' · ', (array) $x['notizen'])) . '</span>' : '')
                . (isset($abgaben[$x['id'] ?? '']) ? ' <span class="pill st-offen">Abgabe ' . $h(status_text($abgaben[$x['id']])) . '</span>'
                    : (empty($x['entfaellt']) && !empty($x['id']) && !empty($x['beginn']) && wien_ts((string) $t['datum'], (string) $x['beginn']) > jetzt() + 2 * 3600
                        ? '<details class="abgabe"><summary>Abgeben</summary><form method="post" action="mein-plan.php?aktion=abgeben">' . $p . '<input type="hidden" name="einsatz" value="' . $h((string) $x['id']) . '"><label>Grund (optional)<textarea name="notiz" rows="2" maxlength="300"></textarea></label><button type="submit" class="klein">Abgabe anfragen</button></form></details>' : ''))
                . (isset($gestempelt[$x['id'] ?? '']) ? '<br><span class="zeit-ok">✓ ' . uhr((int) $gestempelt[$x['id']]['kommen']) . (!empty($gestempelt[$x['id']]['gehen']) ? '–' . uhr((int) $gestempelt[$x['id']]['gehen']) : ' eingestempelt') . '</span>' : '')
                . (!empty($x['hinweis']) || !empty($x['schluessel']) ? '<details><summary>Objektinfo</summary>' . (!empty($x['hinweis']) ? '<p>' . nl2br($h((string) $x['hinweis'])) . '</p>' : '') . (!empty($x['schluessel']) ? '<p class="leise">Schlüssel: ' . $h((string) $x['schluessel']) . '</p>' : '') . '</details>' : '')
                . '</div>';
        }
        $tageHtml .= '<section class="tag"><h3>' . $h($tag((string) $t['datum'])) . (!empty($t['feiertag']) ? ' <span class="pill">' . $h((string) $t['feiertag']) . '</span>' : '') . (!empty($t['abwesend']) ? ' <span class="pill abw">' . $h((string) $t['abwesend']) . '</span>' : '') . '</h3>' . ($zeilen ?: '<p class="leise">frei</p>') . '</section>';
    }
    $summe = (array) ($w['summe'] ?? []);
    $planHtml .= '<h2>KW ' . $h((string) ($w['kw'] ?? '')) . ' <span class="leise">' . $h($zeitraum((string) ($w['von'] ?? $mo), (string) ($w['bis'] ?? $mo))) . '</span></h2>'
        . (!empty($w['geaendert']) ? '<p class="pill neu">geändert am ' . (new DateTimeImmutable('@' . (int) $w['geaendert']))->setTimezone(new DateTimeZone('Europe/Vienna'))->format('d.m. H:i') . '</p>' : '')
        . ($tageHtml ?: '<p class="leise">Keine Einsätze in dieser Woche.</p>')
        . '<p class="summe">Stunden: <b>' . $stunden($summe['ist'] ?? 0) . ' h</b>' . (isset($summe['soll']) ? ' · Soll ' . $stunden($summe['soll']) . ' h' : '') . (isset($w['konto']) && $w['konto'] !== null ? ' · Zeitkonto danach ' . $konto($w['konto']) . ' h' : '') . '</p>';
}
$antraegeHtml = $meine ? '<h2>Meine Anträge</h2><ul class="antraege">' . implode('', array_map(fn ($a) => '<li><b>' . $h($a['art']) . '</b> ' . $h($zeitraum($a['von'], $a['bis'])) . (in_array($a['art'] ?? '', ['Einsatz', 'Abgabe'], true) ? ' · ' . $h((string) ($a['text'] ?? '')) : '') . ' <span class="pill st-' . $h($a['status']) . '">' . $h(status_text($a)) . '</span>' . ($a['antwort'] ? '<br><span class="leise">' . $h($a['antwort']) . '</span>' : '') . '</li>', $meine)) . '</ul>' : '';
$gemeldet = array_column(array_filter($meine, fn ($a) => ($a['art'] ?? '') === 'Einsatz' && $a['status'] === 'offen'), 'einsatz');
$boerse = '';
foreach (angebote_von($hash) as $o) {
    $adresse = (string) $o['adresse'];
    $boerse .= '<div class="einsatz angebot"><b>' . $h($tag($o['datum'])) . ' ' . $h($o['zeit']) . '</b> ' . $h($o['objekt'])
        . ($o['leistung'] ? ' <span class="leise">· ' . $h($o['leistung']) . '</span>' : '')
        . ($adresse !== '' ? '<br><span class="leise">' . $h($adresse) . ' · <a href="https://www.google.com/maps/search/?api=1&amp;query=' . rawurlencode($adresse) . '" target="_blank" rel="noopener">Karte</a></span>' : '')
        . '<br><span class="leise">' . $stunden($o['minuten']) . ' h' . (!empty($o['tausch']) ? ' · wird von einer Kollegin oder einem Kollegen abgegeben' : '') . '</span>'
        . (in_array($o['id'], $gemeldet, true) ? ' <span class="pill st-offen">gemeldet</span>' : '<form method="post" action="mein-plan.php?aktion=melden">' . $p . '<input type="hidden" name="einsatz" value="' . $h($o['id']) . '"><button type="submit" class="klein">Ich übernehme</button></form>')
        . '</div>';
}
$boerseHtml = $boerse ? '<h2>Offene Einsätze für dich</h2><p class="leise">Passt laut Plan zu deinen Zeiten. Das Büro bestätigt, wer eingeteilt wird.</p>' . $boerse : '';
$heute = heute();
$formulare = '<h2>Abwesenheit</h2>'
    . '<details><summary>Krank melden</summary><form method="post" action="mein-plan.php?aktion=antrag">' . $p . '<input type="hidden" name="art" value="Krankenstand">'
    . '<label for="k-von">Krank ab</label><input type="date" id="k-von" name="von" value="' . $heute . '" required>'
    . '<label for="k-bis">Voraussichtlich bis (wenn bekannt)</label><input type="date" id="k-bis" name="bis">'
    . '<label for="k-notiz">Notiz (optional, keine Diagnose)</label><textarea id="k-notiz" name="notiz" rows="2" maxlength="300"></textarea>'
    . '<button type="submit">Krankmeldung senden</button><p class="leise">Bitte zusätzlich wie gewohnt anrufen, wenn der Dienst schon bald beginnt. Die Krankenstandsbestätigung bleibt nötig.</p></form></details>'
    . '<details><summary>Urlaub, Zeitausgleich oder Pflegefreistellung beantragen</summary><form method="post" action="mein-plan.php?aktion=antrag">' . $p
    . '<label for="a-art">Art</label><select id="a-art" name="art"><option>Urlaub</option><option>Zeitausgleich</option><option>Pflegefreistellung</option></select>'
    . '<label for="a-von">Von</label><input type="date" id="a-von" name="von" required><label for="a-bis">Bis</label><input type="date" id="a-bis" name="bis" required>'
    . '<label for="a-notiz">Notiz (optional)</label><textarea id="a-notiz" name="notiz" rows="2" maxlength="300"></textarea>'
    . '<button type="submit">Antrag senden</button></form></details>';
html_seite('<h1>Mein Dienstplan</h1><p>' . $h((string) ($person['name'] ?? '')) . '</p>' . $meldung
    . '<style>.tag{border-top:1px solid #dde5ea;padding:.5rem 0}.tag h3{font-size:1rem;margin:.2rem 0}.einsatz{margin:.35rem 0}.einsatz.weg{text-decoration:line-through;color:#6f8596}.hinweis{color:#8a5300;font-size:.95rem}.pill{display:inline-block;border-radius:999px;padding:0 .6rem;font-size:.85rem;background:#e8f1fa;color:#0a5a96;font-weight:600}.pill.abw{background:#fdf0d5;color:#8a5300}.pill.neu{background:#fce8e6;color:#b3261e}.st-genehmigt,.st-erledigt{background:#eef6e2!important;color:#4e7a1e!important}.st-abgelehnt{background:#fce8e6!important;color:#b3261e!important}.summe{background:#f3f6f8;border-radius:8px;padding:.5rem .7rem}details{margin:.6rem 0}summary{font-weight:600;cursor:pointer;padding:.3rem 0}input[type=date]{font:inherit;width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #c9d6df;border-radius:8px}.angebot{border:1px solid #dde5ea;border-radius:8px;padding:.6rem .7rem}.zeit-ok{color:#4e7a1e;font-weight:600;font-size:.95rem}details.abgabe{margin:.2rem 0 .4rem}details.abgabe summary{font-weight:400;font-size:.95rem;color:#0a5a96}details.abgabe label{font-weight:400}button.klein{font-size:1rem;padding:.55rem 1rem;margin-top:.5rem}</style>'
    . ($planHtml ?: '<p class="leise">Noch kein veröffentlichter Plan.</p>')
    . $boerseHtml . $antraegeHtml . $formulare
    . '<p class="leise" style="margin-top:2rem;font-size:.9rem">Diese Seite ist persönlich: den Link nicht weitergeben. Tipp: im Browser-Menü „Zum Startbildschirm“ wählen. <a href="mein-plan.php?aktion=vergessen">Auf diesem Gerät vergessen</a></p>', 200, '', 'Mein Dienstplan');
