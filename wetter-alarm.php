<?php
// Schnee-Alarm für den Winterdienst (läuft am Webspace, unabhängig davon, ob jemand die App offen hat).
//
// Ein Cronjob ruft diese Datei alle 10 Minuten auf. Sie prüft je Ort (z. B. Salzburg,
// Hallein, Obertrum) Vorhersage und amtliche Warnungen von GeoSphere Austria und weckt
// das Winterdienst-Team, sobald es zu schneien beginnt, Glätte droht oder eine Schnee-
// oder Glatteiswarnung gilt:
//
//  - Push aufs Handy über ntfy (höchste Priorität, Knopf „Bin wach“) und E-Mail;
//  - bestätigt in Stufe 1 niemand binnen 15 Minuten, geht der Alarm an Stufe 2 (z. B. Büro);
//  - ein Ort meldet sich höchstens alle 8 Stunden neu, außer die Warnstufe steigt;
//  - optional Ruhezeit (z. B. 22–3 Uhr): Alarm erst am Ende, Warnung orange/rot sofort.
//
// Aufrufe:
//   php wetter-alarm.php                         prüfen (Cronjob am Webspace)
//   wetter-alarm.php?aktion=pruefen&schluessel=… prüfen (externer Cron-Dienst, Prüfschlüssel)
//   wetter-alarm.php?aktion=wach&t=…             „Bin wach“ (ntfy-Knopf, Link in der E-Mail)
//   wetter-alarm.php?aktion=status|test|speichern  aus der App, mit Schlüssel im Kopf X-Schluessel
//
// Einstellungen: privat/wetter-alarm.json (erstellt die App unter Wetter & Winterdienst →
// Alarm einrichten). Der Ordner privat/ ist per .htaccess gesperrt. Daten: GeoSphere Austria, CC BY 4.0.

declare(strict_types=1);

require __DIR__ . '/wetter-lib.php';

const ALARM_STANDARD = ['vorlaufStunden' => 3, 'schneeCm' => 0.3, 'glaetteC' => 1, 'pauseStunden' => 8, 'eskalationMinuten' => 15, 'ruheVon' => '', 'ruheBis' => '', 'ruheAusnahmeStufe' => 2, 'ohneDatenStunden' => 2];
const STUFE_TEXT = [1 => 'gelb', 2 => 'orange', 3 => 'rot'];

$cli = PHP_SAPI === 'cli';

function jetzt(): int
{
    $t = getenv('WETTER_JETZT'); // nur für Tests
    return $t !== false && $t !== '' ? (int) $t : time();
}

function uhrzeit(int $ts, string $format = 'H:i'): string
{
    return (new DateTimeImmutable('@' . $ts))->setTimezone(new DateTimeZone('Europe/Vienna'))->format($format);
}

function ordner(): string
{
    return getenv('WETTER_ALARM_ORDNER') ?: __DIR__ . '/privat';
}

function einstellungen(): ?array
{
    $datei = ordner() . '/wetter-alarm.json';
    if (!is_file($datei)) {
        return null;
    }
    $e = json_decode((string) file_get_contents($datei), true);
    if (!is_array($e) || !is_string($e['schluessel'] ?? null) || strlen($e['schluessel']) < 32) {
        return null;
    }
    $e['regeln'] = array_merge(ALARM_STANDARD, (array) ($e['regeln'] ?? []));
    return $e;
}

function ausgabe(int $status, array $daten): void
{
    global $cli;
    if (!$cli) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo json_encode($daten, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), "\n";
    exit($cli && $status >= 400 ? 1 : 0);
}

// ---------------------------------------------------------------- Stand (wer wurde wann geweckt)

/** Stand gesperrt öffnen (nie zwei Prüfungen gleichzeitig); $fn ändert den Stand, Rückgabe wird durchgereicht. */
function mit_stand(callable $fn)
{
    $dir = ordner();
    $datei = is_dir($dir) && is_writable($dir) ? "$dir/wetter-alarm-stand.json" : rtrim(sys_get_temp_dir(), '/\\') . '/app-wetter-alarm-stand.json';
    $h = fopen($datei, 'c+');
    if (!$h) {
        throw new RuntimeException('Stand nicht speicherbar');
    }
    flock($h, LOCK_EX);
    $stand = json_decode((string) stream_get_contents($h), true);
    if (!is_array($stand)) {
        $stand = ['orte' => [], 'protokoll' => []];
    }
    $ergebnis = $fn($stand);
    ftruncate($h, 0);
    rewind($h);
    fwrite($h, json_encode($stand, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    fflush($h);
    flock($h, LOCK_UN);
    fclose($h);
    return $ergebnis;
}

function protokoll(array &$stand, string $ort, string $text): void
{
    array_unshift($stand['protokoll'], ['zeit' => jetzt(), 'ort' => $ort, 'text' => $text]);
    $stand['protokoll'] = array_slice($stand['protokoll'], 0, 60);
}

// ---------------------------------------------------------------- Lage je Ort

/**
 * Wie ist die Lage an einem Ort? Liefert null (ruhig) oder
 * ['stufe' => 1–3, 'text' => …, 'arten' => [...]]: Schneefall in den nächsten Stunden,
 * Glätte (Niederschlag bei Frost) oder amtliche Schnee-/Glatteiswarnung.
 */
function lage(array $stunden, array $warnungen, array $r, int $jetzt): ?array
{
    $bis = $jetzt + (int) round($r['vorlaufStunden'] * 3600);
    $nah = array_values(array_filter($stunden, fn ($h) => $h['at'] >= $jetzt - 3600 && $h['at'] < $bis));
    $texte = [];
    $arten = [];
    $stufe = 0;
    $schnee = null;
    foreach ($nah as $h) {
        if (($h['snow'] ?? 0) >= $r['schneeCm']) {
            $schnee = $h;
            break;
        }
    }
    if ($schnee) {
        // Menge ab Beginn für die nächsten 12 Stunden
        $summe = 0.0;
        foreach ($stunden as $h) {
            if ($h['at'] >= $schnee['at'] && $h['at'] < $schnee['at'] + 12 * 3600) {
                $summe += (float) ($h['snow'] ?? 0);
            }
        }
        $wann = $schnee['at'] <= $jetzt ? 'Es schneit' : 'Schneefall ab ' . uhrzeit($schnee['at']) . ' Uhr';
        $texte[] = sprintf('%s, ca. %s cm in 12 h', $wann, str_replace('.', ',', (string) round($summe, 1)));
        $arten[] = 'schnee';
        $stufe = 1;
    }
    foreach ($nah as $h) {
        if ($h['t'] !== null && $h['t'] <= $r['glaetteC'] && ($h['precip'] ?? 0) >= 0.1 && !(($h['snow'] ?? 0) > 0)) {
            $texte[] = sprintf('Glätte möglich ab %s Uhr (%s °C mit Niederschlag)', uhrzeit(max($h['at'], $jetzt)), str_replace('.', ',', (string) round($h['t'], 1)));
            $arten[] = 'glaette';
            $stufe = max($stufe, 1);
            break;
        }
    }
    foreach ($warnungen as $w) {
        if (($w['type'] === 'schnee' || $w['type'] === 'glatteis') && $w['start'] < $bis && $w['end'] > $jetzt) {
            $texte[] = sprintf('%swarnung %s (GeoSphere) %s–%s Uhr', $w['type'] === 'schnee' ? 'Schnee' : 'Glatteis', STUFE_TEXT[$w['level']], uhrzeit($w['start'], 'd.m. H:i'), uhrzeit($w['end'], 'H:i'));
            $arten[] = $w['type'];
            $stufe = max($stufe, $w['level']);
        }
    }
    return $stufe ? ['stufe' => $stufe, 'text' => implode('. ', $texte), 'arten' => array_values(array_unique($arten))] : null;
}

/** In der Ruhezeit gemerkte Lage: „Um 23:20 Uhr gemeldet (Ruhezeit): …“ */
function gemeldet(array $wartend): string
{
    return 'Um ' . uhrzeit((int) $wartend['seit']) . ' Uhr gemeldet (Ruhezeit): ' . $wartend['text'];
}

/**
 * Stufe 1 eines Orts: alle, oder bei wöchentlichem Wechsel („wechsel“: „woche“) nur, wer
 * diese Woche Bereitschaft hat (Wechsel montags 0 Uhr, gleiche Rechnung wie in der App).
 */
function stufe1(array $ort, int $ts): array
{
    $liste = array_values((array) ($ort['stufe1'] ?? []));
    if (($ort['wechsel'] ?? '') !== 'woche' || count($liste) < 2) {
        return $liste;
    }
    $tag = intdiv((int) gmmktime(0, 0, 0, (int) uhrzeit($ts, 'n'), (int) uhrzeit($ts, 'j'), (int) uhrzeit($ts, 'Y')), 86400);
    return [$liste[intdiv($tag + 3, 7) % count($liste)]];
}

function in_ruhezeit(array $r, int $ts): bool
{
    if (!preg_match('/^\d{2}:\d{2}$/', (string) $r['ruheVon']) || !preg_match('/^\d{2}:\d{2}$/', (string) $r['ruheBis'])) {
        return false;
    }
    $t = uhrzeit($ts);
    return $r['ruheVon'] <= $r['ruheBis'] ? ($t >= $r['ruheVon'] && $t < $r['ruheBis']) : ($t >= $r['ruheVon'] || $t < $r['ruheBis']);
}

/** Marke aus config.json der App (Name, Hausfarbe, Logo, App-Symbol) für die Seite „Bin wach“ und die Nachrichten. */
function marke(): array
{
    static $m = null;
    if ($m !== null) {
        return $m;
    }
    $c = json_decode((string) @file_get_contents(__DIR__ . '/config.json'), true);
    $b = is_array($c['brand'] ?? null) ? $c['brand'] : [];
    $farbe = fn ($v, string $sonst) => is_string($v) && preg_match('/^#[0-9a-f]{6}$/i', $v) ? $v : $sonst;
    $datei = fn ($v) => is_string($v) && preg_match('#^[a-z0-9][a-z0-9/_.-]*\.(png|svg|jpg|webp)$#i', $v) && !str_contains($v, '..') ? $v : '';
    return $m = [
        'app' => is_string($b['app'] ?? null) ? $b['app'] : (is_string($b['name'] ?? null) ? $b['name'] : 'App'),
        'farbe' => $farbe($b['colors']['primary'] ?? null, '#1d4ea6'),
        'leise' => $farbe($b['colors']['muted'] ?? null, '#4b5b67'),
        'logo' => $datei($b['logoOnLight'] ?? $b['logo'] ?? ''),
        'symbol' => $datei($b['appIcons'][0] ?? $b['icon'] ?? ''),
    ];
}

// ---------------------------------------------------------------- Benachrichtigen

function adresse(array $e): string
{
    return rtrim((string) ($e['adresse'] ?? ''), '/') . '/';
}

/** An eine Person: ntfy (Push, höchste Priorität, Knopf „Bin wach“) und/oder E-Mail. Liefert Fehlertexte. */
function benachrichtigen(array $e, array $person, string $titel, string $text, ?string $token): array
{
    $fehler = [];
    $app = adresse($e) . '#wetter';
    $wach = $token ? adresse($e) . 'wetter-alarm.php?aktion=wach&t=' . $token : null;
    if (!empty($person['ntfy'])) {
        $nachricht = [
            'topic' => (string) $person['ntfy'],
            'title' => $titel,
            'message' => $text,
            'priority' => 5,
            'tags' => ['snowflake', 'rotating_light'],
            'icon' => marke()['symbol'] ? adresse($e) . marke()['symbol'] : null,
            'click' => $app,
            'actions' => array_values(array_filter([
                $wach ? ['action' => 'http', 'label' => 'Bin wach', 'url' => $wach, 'method' => 'POST', 'clear' => true] : null,
                ['action' => 'view', 'label' => 'App öffnen', 'url' => $app],
            ])),
        ];
        [$status] = holen(rtrim((string) ($e['ntfy'] ?? 'https://ntfy.sh'), '/'), json_encode(array_filter($nachricht, fn ($v) => $v !== null), JSON_UNESCAPED_UNICODE));
        if ($status < 200 || $status >= 300) {
            $fehler[] = sprintf('ntfy an %s: %s', $person['name'] ?? '?', $status ? "Antwort $status" : 'nicht erreichbar');
        }
    }
    if (!empty($person['email']) && filter_var($person['email'], FILTER_VALIDATE_EMAIL)) {
        $absender = filter_var($e['absender'] ?? '', FILTER_VALIDATE_EMAIL) ? $e['absender'] : null;
        $kopf = ['MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', 'Auto-Submitted: auto-generated'];
        if ($absender) {
            $kopf[] = 'From: =?UTF-8?B?' . base64_encode(marke()['app'] . ' – Winterdienst') . '?= <' . $absender . '>';
        }
        $inhalt = $text . "\n\n" . ($wach ? "Bitte bestätigen: $wach\n" : '') . "App: $app\n\nAutomatische Nachricht der " . marke()['app'] . " (Wetterdaten: GeoSphere Austria).\n";
        $ok = @mail($person['email'], '=?UTF-8?B?' . base64_encode($titel) . '?=', $inhalt, implode("\r\n", $kopf), $absender ? '-f' . $absender : '');
        if (!$ok) {
            $fehler[] = sprintf('E-Mail an %s nicht versendet', $person['name'] ?? $person['email']);
        }
    }
    return $fehler;
}

/** Alarm an eine Liste von Personen senden, je Person ein eigener Bestätigungs-Code. */
function alarm_senden(array $e, array &$alarm, array $personen, string $titel, string $text): array
{
    $fehler = [];
    foreach ($personen as $p) {
        $token = bin2hex(random_bytes(12));
        $alarm['empfaenger'][$token] = ['name' => (string) ($p['name'] ?? ''), 'stufe' => $alarm['eskaliert'] ? 2 : 1];
        $fehler = array_merge($fehler, benachrichtigen($e, $p, $titel, $text, $token));
    }
    return $fehler;
}

// ---------------------------------------------------------------- Prüfen (Cronjob)

function pruefen(array $e): array
{
    $r = $e['regeln'];
    $jetzt = jetzt();
    // Wetter zuerst holen (ohne Sperre), dann den Stand in einem Zug ändern
    $daten = [];
    foreach ((array) ($e['orte'] ?? []) as $ort) {
        try {
            $daten[$ort['name']] = ['stunden' => wetter_vorhersage((float) $ort['lat'], (float) $ort['lon']), 'warnungen' => wetter_warnungen((float) $ort['lat'], (float) $ort['lon'])];
        } catch (Throwable $x) {
            $daten[$ort['name']] = ['fehler' => $x->getMessage()];
        }
    }
    return mit_stand(function (array &$stand) use ($e, $r, $jetzt, $daten) {
        $stand['letztePruefung'] = $jetzt;
        $bericht = ['geprueft' => uhrzeit($jetzt, 'd.m.Y H:i'), 'orte' => []];
        foreach ((array) ($e['orte'] ?? []) as $ort) {
            $name = (string) $ort['name'];
            $s = $stand['orte'][$name] ?? [];
            $d = $daten[$name];
            $fehler = [];
            if (isset($d['fehler'])) {
                $s['fehler'] = $d['fehler'];
                // zu lange ohne Wetterdaten: Stufe 2 Bescheid geben (einmal)
                $seit = (int) ($s['geprueft'] ?? 0);
                if ($seit && $jetzt - $seit >= $r['ohneDatenStunden'] * 3600 && empty($s['ohneDatenGemeldet'])) {
                    foreach ((array) ($ort['stufe2'] ?? []) as $p) {
                        $fehler = array_merge($fehler, benachrichtigen($e, $p, "Schnee-Alarm $name ohne Wetterdaten", sprintf('Seit %s Uhr kommen keine Wetterdaten von GeoSphere (%s). Bitte selbst auf das Wetter achten.', uhrzeit($seit), $d['fehler']), null));
                    }
                    $s['ohneDatenGemeldet'] = $jetzt;
                    protokoll($stand, $name, 'Keine Wetterdaten: Stufe 2 informiert');
                }
                $stand['orte'][$name] = $s;
                $bericht['orte'][$name] = ['fehler' => $d['fehler']];
                continue;
            }
            unset($s['fehler'], $s['ohneDatenGemeldet']);
            $s['geprueft'] = $jetzt;
            $lage = lage($d['stunden'], $d['warnungen'], $r, $jetzt);
            $s['lage'] = $lage['text'] ?? 'ruhig';
            $alarm = $s['alarm'] ?? null;
            $objekte = implode(', ', (array) ($ort['objekte'] ?? []));
            $titel = "Winterdienst $name";
            if ($lage) {
                $neu = !$alarm || !empty($alarm['test']) || $jetzt - (int) $alarm['gesendet'] >= $r['pauseStunden'] * 3600 || $lage['stufe'] > (int) $alarm['stufe'];
                if ($neu && in_ruhezeit($r, $jetzt) && $lage['stufe'] < $r['ruheAusnahmeStufe']) {
                    // Ruhezeit: merken, am Ende wecken
                    $s['wartend'] = $s['wartend'] ?? ['seit' => $jetzt, 'text' => $lage['text']];
                } elseif ($neu || !empty($s['wartend'])) {
                    $text = !empty($s['wartend']) ? gemeldet($s['wartend']) . ($s['wartend']['text'] !== $lage['text'] ? '. Jetzt: ' . $lage['text'] : '') : $lage['text'];
                    $alarm = ['id' => bin2hex(random_bytes(6)), 'gesendet' => $jetzt, 'stufe' => $lage['stufe'], 'text' => $text, 'empfaenger' => [], 'wach' => [], 'eskaliert' => null, 'test' => false];
                    $fehler = alarm_senden($e, $alarm, stufe1($ort, $jetzt), $titel, "$text." . ($objekte ? " Objekte: $objekte." : '') . ' Bitte mit „Bin wach“ bestätigen.');
                    unset($s['wartend']);
                    protokoll($stand, $name, "Alarm: $text");
                }
            } elseif (!empty($s['wartend']) && !in_ruhezeit($r, $jetzt)) {
                // in der Ruhezeit gemeldet, inzwischen vorbei: trotzdem wecken (Schnee liegt)
                $text = gemeldet($s['wartend']);
                $alarm = ['id' => bin2hex(random_bytes(6)), 'gesendet' => $jetzt, 'stufe' => 1, 'text' => $text, 'empfaenger' => [], 'wach' => [], 'eskaliert' => null, 'test' => false];
                $fehler = alarm_senden($e, $alarm, stufe1($ort, $jetzt), $titel, "$text." . ($objekte ? " Objekte: $objekte." : '') . ' Bitte mit „Bin wach“ bestätigen.');
                unset($s['wartend']);
                protokoll($stand, $name, "Alarm nach der Ruhezeit: $text");
            }
            // niemand bestätigt: Stufe 2
            if ($alarm && empty($alarm['test']) && !$alarm['wach'] && !$alarm['eskaliert'] && !empty($ort['stufe2']) && $jetzt - (int) $alarm['gesendet'] >= $r['eskalationMinuten'] * 60) {
                $alarm['eskaliert'] = $jetzt;
                $fehler = array_merge($fehler, alarm_senden($e, $alarm, (array) $ort['stufe2'], "$titel – niemand bestätigt", sprintf('%s. Seit %s Uhr hat niemand aus dem Winterdienst-Team bestätigt. Bitte übernehmen oder das Team anrufen.', $alarm['text'], uhrzeit((int) $alarm['gesendet']))));
                protokoll($stand, $name, 'Niemand bestätigt: Stufe 2 alarmiert');
            }
            foreach ($fehler as $f) {
                protokoll($stand, $name, "Fehler: $f");
            }
            $s['alarm'] = $alarm;
            $stand['orte'][$name] = $s;
            $bericht['orte'][$name] = ['lage' => $s['lage'], 'alarm' => $alarm ? uhrzeit((int) $alarm['gesendet'], 'd.m. H:i') : null, 'wartend' => !empty($s['wartend']), 'fehler' => $fehler];
        }
        return $bericht;
    });
}

// ---------------------------------------------------------------- Aufruf

$aktion = $cli ? (($argv[1] ?? '') === 'test' ? 'test' : 'pruefen') : (string) ($_GET['aktion'] ?? '');
$e = einstellungen();
$methode = $cli ? 'CLI' : ($_SERVER['REQUEST_METHOD'] ?? 'GET');

// „Bin wach“: GET zeigt eine Seite mit Knopf (E-Mail-Prüfprogramme öffnen Links von selbst), POST bestätigt
if ($aktion === 'wach') {
    $token = preg_replace('/[^a-f0-9]/', '', (string) ($_GET['t'] ?? ''));
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    // im Design der App: Logo, Hausfarbe, Systemschrift, Knöpfe mit 8 px Ecken
    $m = marke();
    $h = fn (string $t) => htmlspecialchars($t, ENT_QUOTES);
    $seite = fn (string $inhalt) => print('<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="' . $m['farbe'] . '"><title>' . $h($m['app']) . ' – Winterdienst</title>'
        . '<style>body{margin:0;padding:1rem;background:#f3f6f8;color:#13232f;font:1.1rem/1.5 "Segoe UI",Roboto,"Helvetica Neue",Arial,system-ui,sans-serif}'
        . 'main{max-width:30rem;margin:1rem auto;padding:1.5rem;background:#fff;border-radius:12px;box-shadow:0 1px 2px rgb(19 35 47/.06),0 6px 20px rgb(19 35 47/.08)}'
        . 'img{display:block;max-width:180px;max-height:64px;margin:0 0 1rem}h1{font-size:1.4rem;margin:0 0 .5rem}p{color:' . $m['leise'] . '}'
        . 'button{font:inherit;font-weight:700;font-size:1.2rem;color:#fff;background:' . $m['farbe'] . ';border:0;border-radius:8px;padding:.85rem 1.4rem;width:100%;cursor:pointer}</style></head>'
        . '<body><main>' . ($m['logo'] ? '<img src="' . $h($m['logo']) . '" alt="' . $h($m['app']) . '">' : '') . $inhalt . '</main></body></html>');
    if (strlen($token) !== 24) {
        http_response_code(400);
        $seite('<p>Ungültiger Link.</p>');
        exit;
    }
    if ($methode !== 'POST') {
        $seite('<h1>Winterdienst</h1><p>Bitte bestätigen, dass du wach bist und den Winterdienst übernimmst.</p><form method="post"><button type="submit">Ich bin wach und übernehme</button></form>');
        exit;
    }
    $wer = mit_stand(function (array &$stand) use ($token) {
        foreach ($stand['orte'] as $name => &$s) {
            if (isset($s['alarm']['empfaenger'][$token])) {
                $s['alarm']['wach'][$token] = $s['alarm']['wach'][$token] ?? jetzt();
                $person = $s['alarm']['empfaenger'][$token]['name'];
                protokoll($stand, $name, "$person ist wach (bestätigt)");
                return [$person, $name];
            }
        }
        return null;
    });
    if (!$wer) {
        http_response_code(404);
        $seite('<p>Dieser Alarm ist nicht mehr offen.</p>');
        exit;
    }
    $seite('<h1>Danke, ' . htmlspecialchars($wer[0]) . '</h1><p>Winterdienst ' . htmlspecialchars($wer[1]) . ' ist bestätigt.</p>');
    exit;
}

if (!$e) {
    ausgabe(503, ['fehler' => 'Schnee-Alarm noch nicht eingerichtet: privat/wetter-alarm.json fehlt (App → Wetter & Winterdienst → Alarm einrichten).']);
}
// Schlüssel: aus der App im Kopf X-Schluessel; der Cron-Dienst darf mit dem Prüfschlüssel nur prüfen
$gegeben = (string) ($_SERVER['HTTP_X_SCHLUESSEL'] ?? '');
$pruef = (string) ($_GET['schluessel'] ?? '');
$istApp = $gegeben !== '' && hash_equals((string) $e['schluessel'], $gegeben);
$istCron = $pruef !== '' && is_string($e['pruefschluessel'] ?? null) && strlen($e['pruefschluessel']) >= 16 && hash_equals($e['pruefschluessel'], $pruef);
if (!$cli && !$istApp && !($aktion === 'pruefen' && $istCron)) {
    ausgabe(403, ['fehler' => 'Schlüssel fehlt oder falsch']);
}

if ($aktion === 'pruefen') {
    ausgabe(200, pruefen($e));
}
if ($aktion === 'status') {
    $stand = mit_stand(fn (array &$s) => $s);
    $orte = [];
    foreach ((array) ($e['orte'] ?? []) as $ort) {
        $s = $stand['orte'][$ort['name']] ?? [];
        $a = $s['alarm'] ?? null;
        $orte[] = [
            'name' => $ort['name'],
            'geprueft' => $s['geprueft'] ?? null,
            'lage' => $s['lage'] ?? null,
            'fehler' => $s['fehler'] ?? null,
            'wartend' => $s['wartend']['seit'] ?? null,
            'alarm' => $a ? ['gesendet' => $a['gesendet'], 'text' => $a['text'], 'test' => !empty($a['test']), 'eskaliert' => $a['eskaliert'], 'wach' => array_values(array_map(fn ($t) => ['name' => $a['empfaenger'][$t]['name'] ?? '?', 'zeit' => $a['wach'][$t]], array_keys($a['wach'])))] : null,
        ];
    }
    ausgabe(200, ['jetzt' => jetzt(), 'letztePruefung' => $stand['letztePruefung'] ?? null, 'orte' => $orte, 'protokoll' => array_slice($stand['protokoll'] ?? [], 0, 20)]);
}
if ($aktion === 'test' && ($cli || $methode === 'POST')) {
    $nur = $cli ? ($argv[2] ?? '') : (string) ($_GET['ort'] ?? '');
    $bericht = mit_stand(function (array &$stand) use ($e, $nur) {
        $aus = [];
        foreach ((array) ($e['orte'] ?? []) as $ort) {
            if ($nur !== '' && $ort['name'] !== $nur) {
                continue;
            }
            $alarm = ['id' => bin2hex(random_bytes(6)), 'gesendet' => jetzt(), 'stufe' => 0, 'text' => 'Testalarm', 'empfaenger' => [], 'wach' => [], 'eskaliert' => null, 'test' => true];
            $fehler = alarm_senden($e, $alarm, (array) ($ort['stufe1'] ?? []), 'Testalarm Winterdienst ' . $ort['name'], 'Probe: So kommt der Schnee-Alarm. Bitte mit „Bin wach“ bestätigen.');
            $stand['orte'][$ort['name']]['alarm'] = $alarm;
            protokoll($stand, $ort['name'], 'Testalarm an ' . count($alarm['empfaenger']) . ' Personen' . ($fehler ? ' – ' . implode('; ', $fehler) : ''));
            $aus[$ort['name']] = ['personen' => count($alarm['empfaenger']), 'fehler' => $fehler];
        }
        return $aus;
    });
    ausgabe($bericht ? 200 : 404, $bericht ?: ['fehler' => 'Ort nicht gefunden']);
}
if ($aktion === 'speichern' && $methode === 'POST') {
    // neue Einstellungen aus der App (Schlüssel geprüft); der neue Schlüssel darf sich ändern
    $neu = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($neu) || !is_string($neu['schluessel'] ?? null) || strlen($neu['schluessel']) < 32 || !is_array($neu['orte'] ?? null)) {
        ausgabe(400, ['fehler' => 'Ungültige Einstellungen']);
    }
    foreach ($neu['orte'] as $ort) {
        if (!is_string($ort['name'] ?? null) || !is_numeric($ort['lat'] ?? null) || !is_numeric($ort['lon'] ?? null)) {
            ausgabe(400, ['fehler' => 'Ort ohne Name oder Koordinaten']);
        }
    }
    $datei = ordner() . '/wetter-alarm.json';
    if (@file_put_contents($datei . '.neu', json_encode($neu, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX) === false || !@rename($datei . '.neu', $datei)) {
        ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
    }
    ausgabe(200, ['gespeichert' => count($neu['orte']) . ' Orte']);
}
ausgabe(400, ['fehler' => 'Unbekannte Aktion']);
