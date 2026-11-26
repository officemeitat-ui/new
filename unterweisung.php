<?php
// Unterweisung am Handy: Mitarbeitende lesen die Sicherheitsunterweisung (oder eine andere Unterweisung) in ihrer Sprache,
// sehen optional ein Video, beantworten Verständnisfragen und bestätigen mit ihrer Unterschrift (Finger). Fällig ist sie,
// wie es die App unter „Unterweisungen & Fristen“ rechnet: beim Eintritt und nach Ablauf (z. B. jährlich).
//
// Zugang: derselbe persönliche Link wie „Plan am Handy“ (mein-plan.php?p=CODE): Das Handy kennt den Code als Cookie
// mein_plan, sonst unterweisung.php?p=CODE. Ohne gültigen Code gibt es nichts zu sehen.
//
// Ablauf: unterweisung.php (Liste) → ?u=ART (lesen, Video, Fragen) → Antworten prüfen (der Webspace wertet aus, die Lösung
// kommt nie auf die Seite; falsche Fragen werden markiert, nochmals versuchen) → ?u=ART&schritt=unterschrift (Erklärung,
// Unterschrift) → gespeichert mit dem Zeitpunkt des Servers. Die App holt die Ergebnisse ab und trägt sie als Nachweis ein
// (Unterschrift, Fragen richtig, Versuche, Sprache, Fassung), danach werden sie hier gelöscht.
//
// Dateien (privat/mitarbeiter/, per .htaccess gesperrt):
//   unterweisungen.json        von der App: { arten: { ID: Definition }, personen: { HASH: [{ art, stand, bis, datum }] }, stand }
//   unterweisungen-stand.json  hier: { ergebnisse: [...], offen: { HASH|ART: bestanden, wartet auf Unterschrift },
//                              geoeffnet, erledigt, zaehler (Versuche je Tag), push (Erinnerungen) }
//   unterweisungen/ART-VERSION.mp4|webm  Video (von der App in Teilen hochgeladen)
//
// Aufrufe der App (Schlüssel aus mitarbeiter.json im Kopf X-Schluessel):
//   POST aktion=uebertragen  { arten: [...], personen: {...}, namen: [{ hash, name, ntfy, sprache }], uebernommen: [IDs] }
//   GET  aktion=status       Ergebnisse
//   POST aktion=video&art=ID&version=V&teil=N&teile=M  (Rohdaten, je Teil höchstens 4 MB)
// Seite: ?u=ART, aktion=pruefen, ?schritt=unterschrift, aktion=unterschreiben, aktion=abspielen (Video mit Range)
// Push an die Person (ntfy, in ihrer Sprache) beim Übertragen: neu fällig, dann alle 7 Tage, höchstens 4-mal.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    ini_set('display_errors', '0');
}

require __DIR__ . '/wetter-lib.php';
require __DIR__ . '/webspace-lib.php';

const UW_COOKIE = 'mein_plan';
const UW_VERSUCHE_TAG = 12;          // Antworten prüfen: so oft je Person, Unterweisung und Tag
const UW_UNTERSCHRIFT_ZEIT = 7200;   // so lange nach „bestanden“ darf unterschrieben werden
const UW_VIDEO_MAX = 400 * 1024 * 1024;
const UW_TEIL_MAX = 4 * 1024 * 1024;
const UW_PUSH_ABSTAND = 7 * 86400;
const UW_PUSH_MAX = 4;
const UW_ID = '/^[A-Za-z0-9_-]{1,40}$/';
const UW_VERSION = '/^[a-f0-9]{8}$/';

function jetzt(): int
{
    $t = getenv('WETTER_JETZT'); // nur für Tests
    return $t !== false && $t !== '' ? (int) $t : time();
}

function ordner(): string
{
    return getenv('MEIN_PLAN_ORDNER') ?: __DIR__ . '/privat';
}

function speicher(): string
{
    $d = ordner() . '/mitarbeiter';
    if (!is_dir($d)) {
        @mkdir($d, 0775, true);
    }
    return $d;
}

function heute(): string
{
    return (new DateTimeImmutable('@' . jetzt()))->setTimezone(new DateTimeZone('Europe/Vienna'))->format('Y-m-d');
}

function uhrzeit_wien(int $ts, string $format): string
{
    return (new DateTimeImmutable('@' . $ts))->setTimezone(new DateTimeZone('Europe/Vienna'))->format($format);
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

/** Stand gesperrt ändern; $fn bekommt ihn per Referenz, die Rückgabe wird durchgereicht (null: nicht beschreibbar). */
function uw_stand(callable $fn)
{
    $h = @fopen(speicher() . '/unterweisungen-stand.json', 'c+');
    if (!$h) {
        return null;
    }
    flock($h, LOCK_EX);
    $s = json_decode((string) stream_get_contents($h), true);
    $s = is_array($s) ? $s : [];
    foreach (['ergebnisse', 'offen', 'geoeffnet', 'erledigt', 'zaehler', 'push', 'versuche'] as $k) {
        $s[$k] = is_array($s[$k] ?? null) ? $s[$k] : [];
    }
    $r = $fn($s);
    // Zähler von gestern und älter, abgelaufene „bestanden“ weg
    $s['zaehler'] = array_filter($s['zaehler'], fn ($k) => str_ends_with((string) $k, '|' . heute()), ARRAY_FILTER_USE_KEY);
    $s['offen'] = array_filter($s['offen'], fn ($o) => is_array($o) && jetzt() - (int) ($o['zeit'] ?? 0) < UW_UNTERSCHRIFT_ZEIT);
    ftruncate($h, 0);
    rewind($h);
    fwrite($h, json_encode($s, JSON_UNESCAPED_UNICODE));
    fflush($h);
    flock($h, LOCK_UN);
    fclose($h);
    return $r;
}

function einstellungen(): ?array
{
    $e = json_decode((string) @file_get_contents(ordner() . '/mitarbeiter.json'), true);
    return is_array($e) && is_string($e['schluessel'] ?? null) && strlen($e['schluessel']) >= 32 ? $e : null;
}

function json_ausgabe(int $status, array $daten): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($daten, JSON_UNESCAPED_UNICODE);
    exit;
}

function fremde_herkunft(): bool
{
    $herkunft = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    return $herkunft !== '' && $herkunft !== 'same-origin' && $herkunft !== 'none';
}

function video_ordner(): string
{
    $d = speicher() . '/unterweisungen';
    if (!is_dir($d)) {
        @mkdir($d, 0775, true);
    }
    return $d;
}

function video_pfad(string $art, string $version, string $typ): string
{
    return video_ordner() . '/' . $art . '-' . $version . ($typ === 'video/webm' ? '.webm' : '.mp4');
}

function kurz($v, int $n): string
{
    return is_string($v) ? mb_substr(trim(preg_replace('/\s+/u', ' ', $v) ?? ''), 0, $n) : '';
}

/** Definition einer Art aus der App prüfen und auf bekannte Felder kürzen (null: unbrauchbar). */
function art_bereinigen($a): ?array
{
    if (!is_array($a) || !is_string($a['id'] ?? null) || !preg_match(UW_ID, $a['id']) || !is_string($a['version'] ?? null) || !preg_match(UW_VERSION, $a['version'])) {
        return null;
    }
    $loesung = array_values(array_map('intval', array_slice((array) ($a['loesung'] ?? []), 0, 40)));
    $texte = [];
    foreach ((array) ($a['texte'] ?? []) as $sp => $t) {
        if (!sprache_gueltig($sp) || !is_array($t)) {
            continue;
        }
        $abschnitte = [];
        foreach (array_slice((array) ($t['abschnitte'] ?? []), 0, 60) as $x) {
            $bloecke = [];
            foreach (array_slice((array) ($x['bloecke'] ?? []), 0, 40) as $b) {
                if (isset($b['liste']) && is_array($b['liste'])) {
                    $bloecke[] = ['liste' => array_values(array_filter(array_map(fn ($l) => kurz($l, 1200), array_slice($b['liste'], 0, 40))))];
                } elseif (isset($b['text'])) {
                    $bloecke[] = ['text' => kurz($b['text'], 1200)];
                }
            }
            $abschnitte[] = ['titel' => kurz($x['titel'] ?? '', 160), 'bloecke' => $bloecke];
        }
        $fragen = [];
        foreach (array_slice((array) ($t['fragen'] ?? []), 0, 40) as $f) {
            $fragen[] = ['frage' => kurz($f['frage'] ?? '', 300), 'antworten' => array_map(fn ($x) => kurz($x, 300), array_slice((array) ($f['antworten'] ?? []), 0, 6))];
        }
        // Aufbau wie die Lösung (sonst würde nach falschen Stellen ausgewertet)
        if (count($fragen) !== count($loesung)) {
            continue;
        }
        $texte[$sp] = ['titel' => kurz($t['titel'] ?? '', 160), 'abschnitte' => $abschnitte, 'fragen' => $fragen, 'erklaerung' => kurz($t['erklaerung'] ?? '', 900)];
    }
    if (!isset($texte['de'])) {
        return null;
    }
    $video = is_array($a['video'] ?? null) && preg_match(UW_VERSION, (string) ($a['video']['version'] ?? '')) ? ['version' => $a['video']['version'], 'typ' => ($a['video']['typ'] ?? '') === 'video/webm' ? 'video/webm' : 'video/mp4'] : null;
    return [
        'id' => $a['id'],
        'name' => kurz($a['name'] ?? '', 120),
        'version' => $a['version'],
        'monate' => max(0, (int) ($a['monate'] ?? 0)),
        'gesetz' => kurz($a['gesetz'] ?? '', 60),
        'bestehen' => min(100, max(0, (int) ($a['bestehen'] ?? 80))),
        'loesung' => $loesung,
        'texte' => $texte,
        'video' => $video,
        'videoLink' => is_string($a['videoLink'] ?? null) && preg_match('#^https://\S{4,400}$#i', $a['videoLink']) ? $a['videoLink'] : '',
        'deckt' => array_values(array_filter((array) ($a['deckt'] ?? []), fn ($x) => is_string($x) && preg_match(UW_ID, $x))),
    ];
}

/**
 * Reihenfolge der Antworten einer Frage am Handy: je Person und Frage fest gemischt. Die Seite schickt die Stelle in dieser
 * Reihenfolge, nicht die Nummer der Antwort (sonst verriete der Wert, welche Antwort in der Vorlage oben steht).
 */
function reihenfolge(string $hash, int $frage, int $n): array
{
    $r = range(0, max(0, $n - 1));
    usort($r, fn ($a, $b) => strcmp(hash('sha256', $hash . '|' . $frage . '|' . $a), hash('sha256', $hash . '|' . $frage . '|' . $b)));
    return $r;
}

/** So viele Fragen müssen stimmen (aufgerundet, mindestens 1). */
function noetig(int $gesamt, int $prozent): int
{
    return $gesamt ? min($gesamt, max(1, (int) ceil($gesamt * $prozent / 100 - 1e-9))) : 0;
}

/** Ist die Unterweisung für die Person offen? (Stand der App; seither am Handy erledigt zählt als erledigt) */
function ist_offen(array $z, array $st, string $hash): bool
{
    if (!in_array($z['stand'] ?? '', ['fehlt', 'abgelaufen', 'bald'], true)) {
        return false;
    }
    $fertig = (int) ($st['erledigt'][$hash . '|' . $z['art']] ?? 0);
    return !$fertig || uhrzeit_wien($fertig, 'Y-m-d') <= (string) ($z['datum'] ?? '');
}

/** Push an die Person: neu fällig, dann alle 7 Tage, höchstens 4-mal je Fälligkeit. Liefert die Zahl der Nachrichten. */
function erinnern(array $e, array $daten): int
{
    $server = (string) ($e['ntfy'] ?? '');
    $adresse = rtrim((string) ($e['adresse'] ?? ''), '/');
    $senden = [];
    uw_stand(function (array &$st) use ($daten, &$senden) {
        foreach ((array) ($daten['personen'] ?? []) as $hash => $liste) {
            foreach ((array) $liste as $z) {
                if (!in_array($z['stand'] ?? '', ['fehlt', 'abgelaufen'], true) || !ist_offen($z, $st, (string) $hash) || !isset($daten['arten'][$z['art']])) {
                    continue;
                }
                $k = $hash . '|' . $z['art'];
                $p = (array) ($st['push'][$k] ?? []);
                if (($p['datum'] ?? null) !== ($z['datum'] ?? '')) {
                    $p = ['datum' => (string) ($z['datum'] ?? ''), 'n' => 0, 'zuletzt' => 0];
                }
                if ($p['n'] >= UW_PUSH_MAX || jetzt() - (int) $p['zuletzt'] < UW_PUSH_ABSTAND) {
                    continue;
                }
                $p['n']++;
                $p['zuletzt'] = jetzt();
                $st['push'][$k] = $p;
                $senden[] = [(string) $hash, (string) $z['art'], $p['n'] > 1];
            }
        }
    });
    $n = 0;
    foreach ($senden as [$hash, $art, $wieder]) {
        $person = json_lesen(speicher() . '/' . $hash . '.json');
        $thema = (string) ($person['ntfy'] ?? '');
        if ($thema === '' || !preg_match('/^[A-Za-z0-9_-]{1,64}$/', $thema)) {
            continue;
        }
        $sp = sprache_von($person);
        $def = $daten['arten'][$art];
        $name = (string) ($def['texte'][$sp]['titel'] ?? '') ?: (string) $def['name'];
        $ok = ntfy_senden($server, ['topic' => $thema, 'title' => t('uw_push_titel', ['name' => $name], $sp), 'message' => t($wieder ? 'uw_push_erinnerung' : 'uw_push_text', [], $sp),
            'priority' => 3, 'tags' => ['clipboard'], 'click' => ($adresse !== '' ? $adresse . '/' : '') . 'unterweisung.php?u=' . rawurlencode($art)]);
        $n += $ok ? 1 : 0;
    }
    return $n;
}

/** Video mit Range (Vor- und Zurückspulen, iPhone braucht das). */
function video_senden(string $pfad, string $typ): void
{
    $groesse = (int) filesize($pfad);
    $von = 0;
    $bis = $groesse - 1;
    header('Content-Type: ' . $typ);
    header('Accept-Ranges: bytes');
    header('Cache-Control: private, max-age=3600');
    header('X-Content-Type-Options: nosniff');
    header('X-Robots-Tag: noindex, nofollow');
    if (preg_match('/^bytes=(\d*)-(\d*)$/', (string) ($_SERVER['HTTP_RANGE'] ?? ''), $m) && ($m[1] !== '' || $m[2] !== '')) {
        if ($m[1] === '') {
            $von = max(0, $groesse - (int) $m[2]);
        } else {
            $von = (int) $m[1];
            $bis = $m[2] !== '' ? min((int) $m[2], $groesse - 1) : $bis;
        }
        if ($von > $bis || $von >= $groesse) {
            http_response_code(416);
            header('Content-Range: bytes */' . $groesse);
            exit;
        }
        http_response_code(206);
        header("Content-Range: bytes $von-$bis/$groesse");
    }
    header('Content-Length: ' . ($bis - $von + 1));
    $h = fopen($pfad, 'rb');
    fseek($h, $von);
    $rest = $bis - $von + 1;
    while ($rest > 0 && !feof($h)) {
        $teil = fread($h, (int) min(1 << 20, $rest));
        if ($teil === false) {
            break;
        }
        echo $teil;
        $rest -= strlen($teil);
        flush();
    }
    fclose($h);
    exit;
}

$aktion = is_string($_GET['aktion'] ?? null) ? $_GET['aktion'] : '';
$methode = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$e = einstellungen();
$datei = speicher() . '/unterweisungen.json';

// ---------------------------------------------------------------- Aufrufe der App (mit Schlüssel)

if (in_array($aktion, ['uebertragen', 'status', 'video'], true)) {
    if (!$e) {
        json_ausgabe(503, ['fehler' => 'Plan am Handy noch nicht eingerichtet: privat/mitarbeiter.json fehlt (App → Mitarbeitende → Plan am Handy).']);
    }
    $gegeben = (string) ($_SERVER['HTTP_X_SCHLUESSEL'] ?? '');
    if ($gegeben === '' || !hash_equals((string) $e['schluessel'], $gegeben)) {
        json_ausgabe(403, ['fehler' => 'Schlüssel fehlt oder falsch']);
    }
    if ($aktion === 'status') {
        $st = uw_stand(fn (array &$s) => $s) ?? [];
        json_ausgabe(200, ['ergebnisse' => array_values((array) ($st['ergebnisse'] ?? [])), 'jetzt' => jetzt()]);
    }
    if ($methode !== 'POST') {
        json_ausgabe(405, ['fehler' => 'Nur POST']);
    }
    if ($aktion === 'video') {
        $art = is_string($_GET['art'] ?? null) ? $_GET['art'] : '';
        $version = is_string($_GET['version'] ?? null) ? $_GET['version'] : '';
        $teil = (int) ($_GET['teil'] ?? -1);
        $teile = (int) ($_GET['teile'] ?? 0);
        $typ = ($_SERVER['CONTENT_TYPE'] ?? '') === 'video/webm' ? 'video/webm' : 'video/mp4';
        if (!preg_match(UW_ID, $art) || !preg_match(UW_VERSION, $version) || $teile < 1 || $teile > (int) ceil(UW_VIDEO_MAX / UW_TEIL_MAX) || $teil < 0 || $teil >= $teile) {
            json_ausgabe(400, ['fehler' => 'art, version, teil und teile fehlen oder sind ungültig']);
        }
        $daten = (string) file_get_contents('php://input');
        if ($daten === '' || strlen($daten) > UW_TEIL_MAX) {
            json_ausgabe(413, ['fehler' => 'Teil leer oder größer als 4 MB']);
        }
        $ziel = video_pfad($art, $version, $typ);
        $tmp = $ziel . '.teil';
        if ($teil === 0) {
            @unlink($tmp);
        } elseif (!is_file($tmp) || (int) filesize($tmp) !== $teil * UW_TEIL_MAX) {
            json_ausgabe(409, ['fehler' => 'Teile in falscher Reihenfolge, bitte neu beginnen']);
        }
        if ($teil < $teile - 1 && strlen($daten) !== UW_TEIL_MAX) {
            json_ausgabe(400, ['fehler' => 'Jeder Teil außer dem letzten hat genau 4 MB']);
        }
        if (@file_put_contents($tmp, $daten, FILE_APPEND | LOCK_EX) === false) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        if ($teil < $teile - 1) {
            json_ausgabe(200, ['teil' => $teil, 'fertig' => false]);
        }
        // fertig: am Inhalt prüfen (MP4: „ftyp“ ab Byte 4, WebM: EBML-Kopf)
        $kopf = (string) file_get_contents($tmp, false, null, 0, 12);
        $passt = $typ === 'video/webm' ? str_starts_with($kopf, "\x1A\x45\xDF\xA3") : substr($kopf, 4, 4) === 'ftyp';
        if (!$passt || (int) filesize($tmp) > UW_VIDEO_MAX) {
            @unlink($tmp);
            json_ausgabe(415, ['fehler' => 'Kein MP4- bzw. WebM-Video (oder größer als 400 MB)']);
        }
        // ältere Fassungen dieser Art löschen
        foreach (glob(video_ordner() . '/' . $art . '-*') ?: [] as $alt) {
            if ($alt !== $tmp) {
                @unlink($alt);
            }
        }
        rename($tmp, $ziel);
        json_ausgabe(200, ['teil' => $teil, 'fertig' => true, 'groesse' => filesize($ziel)]);
    }
    // uebertragen: Arten und Zuordnung ersetzen, übernommene Ergebnisse löschen, Personen ohne Plan anlegen
    $daten = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($daten)) {
        json_ausgabe(400, ['fehler' => 'JSON erwartet']);
    }
    $arten = [];
    foreach (array_slice((array) ($daten['arten'] ?? []), 0, 30) as $a) {
        $b = art_bereinigen($a);
        if ($b) {
            $arten[$b['id']] = $b;
        }
    }
    $personen = [];
    foreach ((array) ($daten['personen'] ?? []) as $hash => $liste) {
        if (!preg_match('/^[a-f0-9]{64}$/', (string) $hash) || !is_array($liste)) {
            continue;
        }
        foreach (array_slice($liste, 0, 30) as $z) {
            if (is_array($z) && isset($arten[$z['art'] ?? '']) && in_array($z['stand'] ?? '', ['fehlt', 'abgelaufen', 'bald', 'ok'], true)) {
                $tag = fn ($v) => is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : '';
                $personen[$hash][] = ['art' => $z['art'], 'stand' => $z['stand'], 'bis' => $tag($z['bis'] ?? ''), 'datum' => $tag($z['datum'] ?? '')];
            }
        }
    }
    if (!json_schreiben($datei, ['arten' => $arten, 'personen' => $personen, 'stand' => jetzt()])) {
        json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
    }
    // Personen, die noch keinen Plan am Webspace haben (z. B. neu eingetreten): Link gilt trotzdem
    $neu = 0;
    foreach (array_slice((array) ($daten['namen'] ?? []), 0, 500) as $n) {
        $hash = (string) ($n['hash'] ?? '');
        if (!preg_match('/^[a-f0-9]{64}$/', $hash) || is_file(speicher() . '/' . $hash . '.json')) {
            continue;
        }
        $p = ['name' => kurz($n['name'] ?? '', 80), 'ntfy' => is_string($n['ntfy'] ?? null) && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $n['ntfy']) ? $n['ntfy'] : '', 'sprache' => sprache_gueltig($n['sprache'] ?? null) ?? 'de', 'wochen' => []];
        $neu += json_schreiben(speicher() . '/' . $hash . '.json', $p) ? 1 : 0;
    }
    $weg = array_values(array_filter((array) ($daten['uebernommen'] ?? []), fn ($x) => is_string($x) && preg_match('/^[a-f0-9]{16}$/', $x)));
    if ($weg) {
        uw_stand(function (array &$st) use ($weg) {
            $st['ergebnisse'] = array_values(array_filter($st['ergebnisse'], fn ($r) => !in_array($r['id'] ?? '', $weg, true)));
        });
    }
    // Videos, die die App noch hochladen muss
    $fehlen = [];
    foreach ($arten as $a) {
        if ($a['video'] && !is_file(video_pfad($a['id'], $a['video']['version'], $a['video']['typ']))) {
            $fehlen[] = ['art' => $a['id'], 'version' => $a['video']['version']];
        }
    }
    json_ausgabe(200, ['arten' => count($arten), 'personen' => count($personen), 'neuePersonen' => $neu, 'videosFehlen' => $fehlen, 'push' => erinnern($e, ['arten' => $arten, 'personen' => $personen])]);
}

// ---------------------------------------------------------------- Seite für Mitarbeitende

header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');
$h = fn (string $t): string => htmlspecialchars($t, ENT_QUOTES);
if (!$e) {
    sprache_waehlen([], true);
    html_seite('<h1>' . th('uw_titel') . '</h1><p>' . th('nicht_eingerichtet') . '</p>', 503, '', t('uw_titel'));
    exit;
}
$code = array_values(array_filter([$_GET['p'] ?? null, $_COOKIE[UW_COOKIE] ?? null], 'is_string'))[0] ?? '';
$hash = preg_match('/^[A-Za-z0-9]{16,40}$/', $code) ? hash('sha256', $code) : '';
$person = $hash ? json_lesen(speicher() . '/' . $hash . '.json') : [];
sprache_waehlen($person, true);
if (!$person) {
    html_seite('<h1>' . th('uw_titel') . '</h1><p>' . th('link_ungueltig') . '</p>', 404, '', t('uw_titel'));
    exit;
}
if (isset($_GET['p'])) {
    setcookie(UW_COOKIE, $code, ['expires' => jetzt() + 400 * 86400, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']), 'httponly' => true, 'samesite' => 'Lax']);
}
$alle = json_lesen($datei);
$arten = (array) ($alle['arten'] ?? []);
$meine = [];
foreach ((array) ($alle['personen'][$hash] ?? []) as $z) {
    if (isset($arten[$z['art'] ?? ''])) {
        $meine[$z['art']] = $z;
    }
}
$sp = sprache();
$datum = fn (string $d): string => $d !== '' ? (DateTimeImmutable::createFromFormat('!Y-m-d', $d) ?: new DateTimeImmutable())->format('d.m.Y') : '';
$basis = 'unterweisung.php';
$text = fn (array $def): array => $def['texte'][$sp] ?? $def['texte']['de'];
$stil = '<style>.uw-abschnitt{border-top:1px solid #dde5ea;padding:.4rem 0}.uw-abschnitt h2{font-size:1.1rem;margin:.6rem 0 .3rem}.uw-abschnitt ul{margin:.3rem 0}'
    . 'fieldset.uw-frage{border:1px solid #c9d6df;border-radius:8px;margin:.8rem 0;padding:.5rem .8rem}fieldset.uw-frage legend{font-weight:700;padding:0 .3rem}fieldset.uw-falsch{border:2px solid #b3261e;background:#fdf3f2}'
    . 'fieldset.uw-frage label.haken{align-items:flex-start}fieldset.uw-frage label.haken input{flex:0 0 auto;margin-top:.15rem}.uw-hinweis{color:#b3261e;font-weight:600;margin:.2rem 0}'
    . '.uw-karte{border:1px solid #c9d6df;border-radius:8px;padding:.6rem .8rem;margin:.6rem 0}.uw-karte.offen{border:2px solid #0a5a96}.uw-karte h2{font-size:1.05rem;margin:0 0 .2rem}'
    . 'video{width:100%;border-radius:8px;background:#000;margin:.4rem 0}.uw-erklaerung{background:#f3f6f8;border-radius:8px;padding:.6rem .8rem;color:#13232f}'
    . '.unterschrift canvas{display:block;width:100%;max-width:600px;aspect-ratio:3/1;border:1px dashed #8a9aa6;border-radius:8px;background:#fff;touch-action:none;cursor:crosshair}'
    . '.unterschrift button.leise{background:none;color:#0a5a96;padding:.4rem 0;font-weight:600;font-size:1rem;width:auto}</style>';
$seite = function (string $inhalt, int $status = 200, string $skript = '') use ($stil, $basis): void {
    html_seite(sprachwahl_html($basis . (isset($_GET['u']) && is_string($_GET['u']) ? '?u=' . rawurlencode($_GET['u']) : '')) . $stil . $inhalt, $status, $skript, t('uw_titel'));
    exit;
};
$art = is_string($_GET['u'] ?? null) && preg_match(UW_ID, $_GET['u']) ? $_GET['u'] : '';
$def = $art !== '' ? ($arten[$art] ?? null) : null;
if ($art !== '' && (!$def || !isset($meine[$art]))) {
    $seite('<h1>' . th('uw_titel') . '</h1><p class="fehler">' . th('uw_nicht_gefunden') . '</p><p><a class="knopf" href="' . $basis . '">' . th('uw_zurueck') . '</a></p>', 404);
}
$k = $hash . '|' . $art;

// Video abspielen (nur wer die Unterweisung hat)
if ($aktion === 'abspielen' && $def) {
    $pfad = $def['video'] ? video_pfad($art, $def['video']['version'], $def['video']['typ']) : '';
    if ($pfad === '' || !is_file($pfad)) {
        http_response_code(404);
        exit;
    }
    video_senden($pfad, $def['video']['typ']);
}

$meldung = '';
$antworten = [];
$falsch = [];
// Antworten prüfen
if ($aktion === 'pruefen' && $methode === 'POST' && $def) {
    if (fremde_herkunft()) {
        $seite('<p>' . th('nicht_erlaubt') . '</p>', 403);
    }
    $t = $text($def);
    $gesamt = count($def['loesung']);
    foreach ($def['loesung'] as $i => $richtig) {
        // Stelle am Handy → Nummer der Antwort
        $v = $_POST['a' . $i] ?? null;
        $reihe = reihenfolge($hash, $i, count($t['fragen'][$i]['antworten'] ?? []));
        $antworten[$i] = is_string($v) && ctype_digit($v) && isset($reihe[(int) $v]) ? $reihe[(int) $v] : -1;
    }
    if (($_POST['v'] ?? '') !== $def['version']) {
        $meldung = '<p class="fehler" role="alert">' . th('uw_geaendert') . '</p>';
        $antworten = [];
    } elseif (in_array(-1, $antworten, true)) {
        $meldung = '<p class="fehler" role="alert">' . th('uw_alle_beantworten') . '</p>';
        $falsch = array_keys(array_filter($antworten, fn ($a) => $a === -1));
    } else {
        $richtig = 0;
        foreach ($def['loesung'] as $i => $l) {
            if ($antworten[$i] === $l) {
                $richtig++;
            } else {
                $falsch[] = $i;
            }
        }
        $bestanden = $richtig >= noetig($gesamt, (int) $def['bestehen']);
        $ergebnis = uw_stand(function (array &$st) use ($k, $def, $richtig, $gesamt, $bestanden, $sp) {
            $z = $k . '|' . heute();
            if ((int) ($st['zaehler'][$z] ?? 0) >= UW_VERSUCHE_TAG) {
                return 'grenze';
            }
            $st['zaehler'][$z] = (int) ($st['zaehler'][$z] ?? 0) + 1;
            $st['versuche'][$k] = (int) ($st['versuche'][$k] ?? 0) + 1;
            if ($bestanden) {
                $st['offen'][$k] = ['version' => $def['version'], 'richtig' => $richtig, 'gesamt' => $gesamt, 'versuche' => $st['versuche'][$k], 'sprache' => $sp, 'zeit' => jetzt()];
            }
            return 'ok';
        });
        if ($ergebnis === 'grenze') {
            // über der Grenze nichts mehr verraten (sonst ließe sich die Lösung durchprobieren)
            $falsch = [];
            $meldung = '<p class="fehler" role="alert">' . th('uw_zu_viele') . '</p>';
        } elseif ($ergebnis === null) {
            $meldung = '<p class="fehler" role="alert">' . th('nicht_gespeichert') . '</p>';
        } elseif ($bestanden) {
            header('Location: ' . $basis . '?u=' . rawurlencode($art) . '&schritt=unterschrift', true, 303);
            exit;
        } else {
            $meldung = '<p class="fehler" role="alert">' . th('uw_nicht_bestanden', ['richtig' => (string) $richtig, 'gesamt' => (string) $gesamt]) . '</p>';
        }
    }
}

// Unterschreiben
if ($aktion === 'unterschreiben' && $methode === 'POST' && $def) {
    if (fremde_herkunft()) {
        $seite('<p>' . th('nicht_erlaubt') . '</p>', 403);
    }
    $pfad = is_string($_POST['unterschrift'] ?? null) ? $_POST['unterschrift'] : '';
    $gueltig = preg_match('/^M[0-9 ML]{2,16000}$/', $pfad) && substr_count($pfad, 'L') >= 3;
    if (!$gueltig || empty($_POST['bestaetigt'])) {
        $_GET['schritt'] = 'unterschrift';
        $meldung = '<p class="fehler" role="alert">' . th('uw_unterschrift_fehlt') . '</p>';
    } else {
        $t = $text($def);
        $ergebnis = uw_stand(function (array &$st) use ($k, $def, $hash, $art, $pfad, $t, $person) {
            $o = $st['offen'][$k] ?? null;
            if (!is_array($o)) {
                return 'abgelaufen';
            }
            if (($o['version'] ?? '') !== $def['version']) {
                unset($st['offen'][$k]);
                return 'geaendert';
            }
            $id = bin2hex(random_bytes(8));
            $st['ergebnisse'][] = ['id' => $id, 'hash' => $hash, 'art' => $art, 'version' => $def['version'], 'sprache' => (string) $o['sprache'], 'name' => (string) ($person['name'] ?? ''),
                'zeit' => jetzt(), 'geoeffnet' => (int) ($st['geoeffnet'][$k] ?? 0) ?: null, 'richtig' => (int) $o['richtig'], 'gesamt' => (int) $o['gesamt'], 'versuche' => (int) $o['versuche'],
                'unterschrift' => $pfad, 'erklaerung' => (string) ($t['erklaerung'] ?? '')];
            $st['ergebnisse'] = array_slice($st['ergebnisse'], -2000);
            foreach (array_merge([$art], (array) $def['deckt']) as $a) {
                $st['erledigt'][$hash . '|' . $a] = jetzt();
            }
            unset($st['offen'][$k], $st['geoeffnet'][$k], $st['versuche'][$k]);
            return 'ok';
        });
        if ($ergebnis === 'ok') {
            header('Location: ' . $basis . '?u=' . rawurlencode($art) . '&fertig=1', true, 303);
            exit;
        }
        $meldung = '<p class="fehler" role="alert">' . th($ergebnis === 'geaendert' ? 'uw_geaendert' : ($ergebnis === 'abgelaufen' ? 'uw_abgelaufen_schritt' : 'nicht_gespeichert')) . '</p>';
    }
}

$st = uw_stand(fn (array &$s) => $s) ?? [];

// Übersicht
if (!$def) {
    $karten = '';
    foreach ($meine as $id => $z) {
        $d = $arten[$id];
        $t = $text($d);
        $offen = ist_offen($z, $st, $hash);
        $fertig = (int) ($st['erledigt'][$hash . '|' . $id] ?? 0);
        $stand = $offen
            ? ($z['stand'] === 'fehlt' ? th('uw_fehlt') : th($z['stand'] === 'bald' ? 'uw_bald' : 'uw_abgelaufen', ['datum' => $h($datum($z['bis']))]))
            : ($fertig && uhrzeit_wien($fertig, 'Y-m-d') > $z['datum'] ? th('uw_erledigt_jetzt', ['datum' => $h(uhrzeit_wien($fertig, 'd.m.Y'))]) : ($z['bis'] !== '' ? th('uw_ok', ['datum' => $h($datum($z['bis']))]) : th('uw_ok_ohne')));
        $karten .= '<div class="uw-karte' . ($offen ? ' offen' : '') . '"><h2>' . $h((string) ($t['titel'] ?: $d['name'])) . '</h2><p' . ($offen ? ' class="uw-hinweis"' : '') . '>' . $stand . '</p>'
            . '<p><a class="knopf" href="' . $basis . '?u=' . rawurlencode($id) . '">' . th($offen ? 'uw_starten' : 'uw_ansehen') . '</a></p></div>';
    }
    $seite('<h1>' . th('uw_titel') . '</h1><p>' . $h((string) ($person['name'] ?? '')) . '</p>' . ($karten ?: '<p>' . th('uw_keine') . '</p>')
        . '<p style="margin-top:1.5rem"><a href="mein-plan.php">' . th('uw_zum_plan') . '</a></p>');
}

$t = $text($def);
$titel = (string) ($t['titel'] ?: $def['name']);
$z = $meine[$art];

// fertig
if (isset($_GET['fertig'])) {
    $fertig = (int) ($st['erledigt'][$k] ?? 0);
    $seite('<h1>' . $h($titel) . '</h1>' . ($fertig ? '<p class="ok" role="status">' . th('uw_danke') . '</p><p>' . th('uw_danke_text', ['name' => $h((string) ($person['name'] ?? '')), 'datum' => $h(uhrzeit_wien($fertig, 'd.m.Y')), 'zeit' => $h(uhrzeit_wien($fertig, 'H:i'))]) . '</p>' : '')
        . '<p><a class="knopf" href="' . $basis . '">' . th('uw_zurueck') . '</a></p><p><a href="mein-plan.php">' . th('uw_zum_plan') . '</a></p>');
}

// Schritt 2: Erklärung und Unterschrift
if (($_GET['schritt'] ?? '') === 'unterschrift') {
    $o = $st['offen'][$k] ?? null;
    if (!is_array($o) || ($o['version'] ?? '') !== $def['version']) {
        $seite('<h1>' . $h($titel) . '</h1><p class="fehler">' . th('uw_abgelaufen_schritt') . '</p><p><a class="knopf" href="' . $basis . '?u=' . rawurlencode($art) . '">' . th('uw_starten') . '</a></p>', 409);
    }
    $seite('<h1>' . $h($titel) . '</h1>' . $meldung . '<p class="ok">' . th('uw_bestanden', ['richtig' => (string) $o['richtig'], 'gesamt' => (string) $o['gesamt']]) . '</p>'
        . '<h2>' . th('uw_unterschrift_titel') . '</h2><p class="uw-erklaerung">' . $h((string) $t['erklaerung']) . '</p>'
        . '<p>' . $h((string) ($person['name'] ?? '')) . ' · ' . $h(uhrzeit_wien(jetzt(), 'd.m.Y')) . '</p>'
        . '<form method="post" action="' . $basis . '?aktion=unterschreiben&amp;u=' . rawurlencode($art) . '" data-unterschrift>'
        . '<label class="haken"><input type="checkbox" name="bestaetigt" value="1" required> ' . th('uw_erklaerung_haken') . '</label>'
        . '<div class="unterschrift" hidden><span class="feldname" id="uw-unterschrift-titel">' . th('uw_unterschrift') . '</span><canvas width="600" height="200" role="img" aria-labelledby="uw-unterschrift-titel"></canvas><input type="hidden" name="unterschrift" value=""><button type="button" class="leise" data-loeschen>' . th('uw_loeschen') . '</button></div>'
        . '<noscript><p class="fehler">' . th('uw_ohne_js') . '</p></noscript>'
        . '<button type="submit">' . th('uw_unterschreiben') . '</button></form>', 200, 'kunden-unterschrift.js');
}

// Schritt 1: lesen, Video, Fragen
uw_stand(function (array &$s) use ($k) {
    $s['geoeffnet'][$k] = (int) ($s['geoeffnet'][$k] ?? 0) ?: jetzt();
});
$abschnitte = '';
foreach ($t['abschnitte'] as $x) {
    $bl = '';
    foreach ($x['bloecke'] as $b) {
        $bl .= isset($b['liste']) ? '<ul>' . implode('', array_map(fn ($l) => '<li>' . $h((string) $l) . '</li>', $b['liste'])) . '</ul>' : '<p>' . $h((string) $b['text']) . '</p>';
    }
    $abschnitte .= '<section class="uw-abschnitt">' . ($x['titel'] !== '' ? '<h2>' . $h((string) $x['titel']) . '</h2>' : '') . $bl . '</section>';
}
$video = '';
if ($def['video'] && is_file(video_pfad($art, $def['video']['version'], $def['video']['typ']))) {
    $video = '<h2>' . th('uw_video') . '</h2><video controls preload="metadata" playsinline src="' . $basis . '?aktion=abspielen&amp;u=' . rawurlencode($art) . '&amp;v=' . $h($def['video']['version']) . '"></video>';
} elseif ($def['videoLink'] !== '') {
    $video = '<p><a class="knopf" href="' . $h($def['videoLink']) . '" target="_blank" rel="noopener noreferrer">' . th('uw_video_link') . '</a></p>';
}
$gesamt = count($def['loesung']);
$fragen = '';
foreach ($t['fragen'] as $i => $f) {
    $opt = '';
    foreach (reihenfolge($hash, $i, count($f['antworten'])) as $stelle => $j) {
        $opt .= '<label class="haken"><input type="radio" name="a' . $i . '" value="' . $stelle . '"' . (($antworten[$i] ?? -1) === $j ? ' checked' : '') . ' required> ' . $h((string) $f['antworten'][$j]) . '</label>';
    }
    $ist = in_array($i, $falsch, true);
    $fragen .= '<fieldset class="uw-frage' . ($ist ? ' uw-falsch' : '') . '"' . ($ist ? ' aria-describedby="uw-f' . $i . '"' : '') . '><legend>' . th('uw_frage', ['n' => (string) ($i + 1)]) . '</legend><p>' . $h((string) $f['frage']) . '</p>'
        . ($ist ? '<p class="uw-hinweis" id="uw-f' . $i . '">' . th('uw_falsch') . '</p>' : '') . $opt . '</fieldset>';
}
$deckt = array_values(array_filter(array_map(fn ($id) => (string) ($arten[$id]['name'] ?? ''), (array) $def['deckt'])));
$offen = ist_offen($z, $st, $hash);
$seite('<h1>' . $h($titel) . '</h1>' . ($def['gesetz'] !== '' ? '<p class="leise">' . th('uw_gesetz', ['gesetz' => $h($def['gesetz'])]) . '</p>' : '')
    . (!isset($def['texte'][$sp]) ? '<p class="veraltet">' . th('uw_deutsch_hinweis') . '</p>' : '')
    . $meldung . ($offen ? '<p>' . th('uw_intro') . '</p>' : '<p class="ok">' . ($z['bis'] !== '' ? th('uw_ok', ['datum' => $h($datum($z['bis']))]) : th('uw_ok_ohne')) . '</p>')
    . ($deckt ? '<p class="leise">' . th('uw_gilt_auch', ['namen' => $h(implode(', ', $deckt))]) . '</p>' : '')
    . $video . $abschnitte
    . ($gesamt ? '<h2 id="fragen">' . th('uw_fragen') . '</h2><p>' . th('uw_fragen_info', ['n' => (string) noetig($gesamt, (int) $def['bestehen']), 'gesamt' => (string) $gesamt]) . '</p>' : '')
    . '<form method="post" action="' . $basis . '?aktion=pruefen&amp;u=' . rawurlencode($art) . '#fragen"><input type="hidden" name="v" value="' . $h($def['version']) . '">' . $fragen
    . '<button type="submit">' . th($gesamt ? 'uw_pruefen' : 'uw_weiter') . '</button></form>'
    . '<p style="margin-top:1.5rem"><a href="' . $basis . '">' . th('uw_zurueck') . '</a></p>');
