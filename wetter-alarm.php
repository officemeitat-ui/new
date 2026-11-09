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
//   wetter-alarm.php?aktion=protokoll&t=…        Winterdienst-Protokoll am Handy (ohne Anmeldung, mit Fotos)
//   Die Seiten „Bin wach“ und „Protokoll“ und die Knöpfe der Push-Nachricht kommen in der Sprache der Person
//   (aus dem Stammblatt, orte[].stufe1[].sprache; am Handy gemerkt wie bei „Mein Dienstplan“, ?sprache=);
//   Texte in mein-plan-texte.php. Der Text des Alarms selbst bleibt deutsch.
//   wetter-alarm.php?aktion=status|test|speichern|protokolle|foto  aus der App, Schlüssel im Kopf X-Schluessel
//
// Einstellungen: privat/wetter-alarm.json (erstellt die App unter Wetter & Winterdienst →
// Alarm einrichten). Protokolle und Fotos: privat/winterdienst/ (die App übernimmt sie nach
// SharePoint). Der Ordner privat/ ist per .htaccess gesperrt. Daten: GeoSphere Austria, CC BY 4.0.

declare(strict_types=1);

// Fehler nie in die Antwort (Serverpfade, Stacktraces), nur ins Fehlerprotokoll des Webspace; der Cronjob (CLI) zeigt sie
if (PHP_SAPI !== 'cli') {
    ini_set('display_errors', '0');
}

require __DIR__ . '/wetter-lib.php';
require __DIR__ . '/webspace-lib.php';

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
    // Werte von GeoSphere gelten für die Stunde, die zum Zeitstempel endet: Beginn = Zeitstempel − 1 h
    $nah = array_values(array_filter($stunden, fn ($h) => $h['at'] > $jetzt - 3600 && $h['at'] - 3600 < $bis));
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
        $beginn = $schnee['at'] - 3600;
        $wann = $beginn <= $jetzt ? 'Es schneit' : 'Schneefall ab ' . uhrzeit($beginn) . ' Uhr';
        $texte[] = sprintf('%s, ca. %s cm in 12 h', $wann, str_replace('.', ',', (string) round($summe, 1)));
        $arten[] = 'schnee';
        $stufe = 1;
    }
    foreach ($nah as $h) {
        if ($h['t'] !== null && $h['t'] <= $r['glaetteC'] && ($h['precip'] ?? 0) >= 0.1 && !(($h['snow'] ?? 0) > 0)) {
            $texte[] = sprintf('Glätte möglich ab %s Uhr (%s °C mit Niederschlag)', uhrzeit(max($h['at'] - 3600, $jetzt)), str_replace('.', ',', (string) round($h['t'], 1)));
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
    // abwesend (Urlaub, Krankenstand laut App) am Tag des Einsatzes: nicht wecken
    $da = array_values(array_filter($liste, fn ($p) => anwesend($p, $ts)));
    if (($ort['wechsel'] ?? '') !== 'woche' || count($liste) < 2) {
        return $da;
    }
    $tag = intdiv((int) gmmktime(0, 0, 0, (int) uhrzeit($ts, 'n'), (int) uhrzeit($ts, 'j'), (int) uhrzeit($ts, 'Y')), 86400);
    // Bereitschaft dieser Woche; ist sie abwesend, der/die Nächste in der Reihe
    $start = intdiv($tag + 3, 7) % count($liste);
    for ($i = 0; $i < count($liste); $i++) {
        $p = $liste[($start + $i) % count($liste)];
        if (anwesend($p, $ts)) {
            return [$p];
        }
    }
    return [];
}

/** Ist die Person am Tag des Einsatzes da? Abends (ab 18 Uhr) zählt schon der nächste Morgen. */
function anwesend(array $p, int $ts): bool
{
    $tag = uhrzeit($ts + 6 * 3600, 'Y-m-d');
    foreach ((array) ($p['abwesend'] ?? []) as $z) {
        if (is_array($z) && count($z) === 2 && $tag >= (string) $z[0] && $tag <= (string) $z[1]) {
            return false;
        }
    }
    return true;
}

function in_ruhezeit(array $r, int $ts): bool
{
    if (!preg_match('/^\d{2}:\d{2}$/', (string) $r['ruheVon']) || !preg_match('/^\d{2}:\d{2}$/', (string) $r['ruheBis'])) {
        return false;
    }
    $t = uhrzeit($ts);
    return $r['ruheVon'] <= $r['ruheBis'] ? ($t >= $r['ruheVon'] && $t < $r['ruheBis']) : ($t >= $r['ruheVon'] || $t < $r['ruheBis']);
}

/** Objekte eines Orts als [['id', 'name', 'adresse']] (ältere Einstellungen: nur Namen). */
function objekte(array $ort): array
{
    $aus = [];
    foreach ((array) ($ort['objekte'] ?? []) as $i => $o) {
        $aus[] = is_array($o)
            ? ['id' => (string) ($o['id'] ?? "o$i"), 'name' => (string) ($o['name'] ?? ''), 'adresse' => (string) ($o['adresse'] ?? '')]
            : ['id' => "o$i", 'name' => (string) $o, 'adresse' => ''];
    }
    return $aus;
}

// ---------------------------------------------------------------- Winterdienst-Protokoll (Speicher)

const STREUMITTEL = ['', 'Splitt', 'Salz', 'Sand', 'Splitt und Salz'];
const FOTO_TYPEN = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

function protokoll_ordner(): string
{
    $d = ordner() . '/winterdienst';
    if (!is_dir("$d/fotos")) {
        @mkdir("$d/fotos", 0775, true);
    }
    return $d;
}

function protokolle_lesen(string $monat): array
{
    $datei = protokoll_ordner() . "/$monat.json";
    $liste = is_file($datei) ? json_decode((string) file_get_contents($datei), true) : [];
    return is_array($liste) ? $liste : [];
}

function protokoll_anhaengen(array $eintrag): bool
{
    $datei = protokoll_ordner() . '/' . substr($eintrag['datum'], 0, 7) . '.json';
    $h = @fopen($datei, 'c+');
    if (!$h) {
        return false;
    }
    flock($h, LOCK_EX);
    $liste = json_decode((string) stream_get_contents($h), true);
    $liste = is_array($liste) ? $liste : [];
    $liste[] = $eintrag;
    ftruncate($h, 0);
    rewind($h);
    $ok = fwrite($h, json_encode($liste, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)) !== false;
    flock($h, LOCK_UN);
    fclose($h);
    return $ok;
}

/** Alarm zu einem Code (aus „Bin wach“ bzw. „Protokoll“): [Ort, Person, Alarm] oder null; gilt 36 Stunden. */
function alarm_zum_code(string $token): ?array
{
    if (strlen($token) !== 24) {
        return null;
    }
    $stand = mit_stand(fn (array &$s) => $s);
    foreach ((array) ($stand['orte'] ?? []) as $name => $s) {
        $a = $s['alarm'] ?? null;
        if ($a && isset($a['empfaenger'][$token]) && jetzt() - (int) $a['gesendet'] <= 36 * 3600) {
            return [(string) $name, (string) $a['empfaenger'][$token]['name'], $a, (string) ($s['lage'] ?? '')];
        }
    }
    return null;
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
    $prot = $token ? adresse($e) . 'wetter-alarm.php?aktion=protokoll&t=' . $token : null;
    $sp = sprache_von($person);
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
                $wach ? ['action' => 'http', 'label' => t('w_bin_wach', [], $sp), 'url' => $wach, 'method' => 'POST'] : null,
                $prot ? ['action' => 'view', 'label' => t('w_protokoll_kurz', [], $sp), 'url' => $prot] : null,
                ['action' => 'view', 'label' => t('w_app_oeffnen', [], $sp), 'url' => $app],
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
        $inhalt = $text . "\n\n" . ($wach ? "Bitte bestätigen: $wach\nNach dem Räumen das Protokoll eintragen: $prot\n" : '') . "App: $app\n\nAutomatische Nachricht der " . marke()['app'] . " (Wetterdaten: GeoSphere Austria).\n";
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
        $alarm['empfaenger'][$token] = ['name' => (string) ($p['name'] ?? ''), 'stufe' => $alarm['eskaliert'] ? 2 : 1] + (sprache_gueltig($p['sprache'] ?? null) ? ['sprache' => $p['sprache']] : []);
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
            $objekte = implode(', ', array_column(objekte($ort), 'name'));
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
            // niemand geweckt (Ort ohne Stufe 1): keine nächtliche Eskalation ans Büro
            if ($alarm && empty($alarm['test']) && !empty($alarm['empfaenger']) && !$alarm['wach'] && !$alarm['eskaliert'] && !empty($ort['stufe2']) && $jetzt - (int) $alarm['gesendet'] >= $r['eskalationMinuten'] * 60) {
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
    if (strlen($token) !== 24) {
        sprache_waehlen([], true);
        html_seite('<p>' . th('w_ungueltig') . '</p>', 400, '', t('w_titel'));
        exit;
    }
    $zu = $e ? alarm_zum_code($token) : null;
    sprache_waehlen($zu ? (array) ($zu[2]['empfaenger'][$token] ?? []) : [], true);
    if ($methode !== 'POST') {
        html_seite(sprachwahl_html('wetter-alarm.php?aktion=wach&t=' . $token) . '<h1>' . th('w_titel') . '</h1><p>' . th('w_bitte_bestaetigen') . '</p><form method="post"><button type="submit">' . th('w_wach_knopf') . '</button></form>', 200, '', t('w_titel'));
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
        html_seite('<p>' . th('w_nicht_offen') . '</p>', 404, '', t('w_titel'));
        exit;
    }
    html_seite('<h1>' . th('w_danke', ['name' => htmlspecialchars($wer[0])]) . '</h1><p>' . th('w_bestaetigt', ['ort' => htmlspecialchars($wer[1])]) . '</p>'
        . '<a class="knopf" href="wetter-alarm.php?aktion=protokoll&amp;t=' . $token . '">' . th('w_protokoll_eintragen') . '</a>', 200, '', t('w_titel'));
    exit;
}

// Winterdienst-Protokoll am Handy: mit dem Code aus dem Alarm, ohne Anmeldung. GET: Formular, POST: speichern.
if ($aktion === 'protokoll') {
    $token = preg_replace('/[^a-f0-9]/', '', (string) ($_GET['t'] ?? ''));
    $zu = $e ? alarm_zum_code($token) : null;
    sprache_waehlen($zu ? (array) ($zu[2]['empfaenger'][$token] ?? []) : [], true);
    if (!$zu) {
        html_seite('<h1>' . th('w_protokoll') . '</h1><p>' . th('w_link_abgelaufen') . '</p>', 404, '', t('w_titel'));
        exit;
    }
    [$ortName, $person, $alarm, $lage] = $zu;
    $ort = null;
    foreach ((array) $e['orte'] as $o) {
        if ($o['name'] === $ortName) {
            $ort = $o;
        }
    }
    $liste = $ort ? objekte($ort) : [];
    $h = fn (string $t) => htmlspecialchars($t, ENT_QUOTES);
    $meldung = '';
    if ($methode === 'POST') {
        $fehler = [];
        $obj = null;
        foreach ($liste as $o) {
            if ($o['id'] === (string) ($_POST['objekt'] ?? '')) {
                $obj = $o;
            }
        }
        if (!$obj) {
            $fehler[] = t('fehler_objekt');
        }
        $geraeumt = !empty($_POST['geraeumt']);
        $gestreut = !empty($_POST['gestreut']);
        $kontrolle = !empty($_POST['kontrolle']);
        if (!$geraeumt && !$gestreut && !$kontrolle) {
            $fehler[] = t('w_fehler_ankreuzen');
        }
        $mittel = (string) ($_POST['mittel'] ?? '');
        if (!in_array($mittel, STREUMITTEL, true)) {
            $mittel = '';
        }
        $zeit = (string) ($_POST['erledigt'] ?? '');
        $heute = uhrzeit(jetzt(), 'Y-m-d');
        $erledigt = preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $zeit) ? (new DateTimeImmutable("$heute $zeit", new DateTimeZone('Europe/Vienna')))->getTimestamp() : jetzt();
        if ($erledigt > jetzt() + 300) {
            $erledigt -= 86400; // kurz nach Mitternacht für den Vorabend eingetragen
        }
        $notiz = mb_substr(trim((string) ($_POST['notiz'] ?? '')), 0, 500);
        // Fotos (das Formular verkleinert sie vorher am Handy)
        $id = bin2hex(random_bytes(6));
        $fotos = [];
        $dateien = $_FILES['fotos'] ?? null;
        if ($dateien && is_array($dateien['name'] ?? null)) {
            $finfo = class_exists('finfo') ? new finfo(FILEINFO_MIME_TYPE) : null;
            foreach ($dateien['name'] as $i => $n) {
                if (($dateien['error'][$i] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
                    continue;
                }
                if ($dateien['error'][$i] !== UPLOAD_ERR_OK) {
                    $fehler[] = t('w_foto_gross');
                    continue;
                }
                if (count($fotos) >= 4) {
                    $fehler[] = t('w_foto_max');
                    break;
                }
                $typ = $finfo ? (string) $finfo->file($dateien['tmp_name'][$i]) : (string) ($dateien['type'][$i] ?? '');
                if (!isset(FOTO_TYPEN[$typ]) || $dateien['size'][$i] > 10 * 1024 * 1024) {
                    $fehler[] = t('w_foto_typ');
                    continue;
                }
                $fotos[] = ['tmp' => $dateien['tmp_name'][$i], 'name' => sprintf('%s-%d.%s', $id, count($fotos) + 1, FOTO_TYPEN[$typ])];
            }
        }
        if (!$fehler) {
            $gespeichert = [];
            foreach ($fotos as $f) {
                $ziel = protokoll_ordner() . '/fotos/' . $f['name'];
                // ohne JavaScript kommt das Foto unverkleinert (mit Ort der Aufnahme): Metadaten ohne Neukodieren entfernen
                if (move_uploaded_file($f['tmp'], $ziel)) {
                    if (bild_ohne_metadaten($ziel)) {
                        $gespeichert[] = $f['name'];
                    } else {
                        @unlink($ziel);
                    }
                }
            }
            $eintrag = ['id' => $id, 'datum' => uhrzeit($erledigt, 'Y-m-d'), 'erledigt' => $erledigt, 'ort' => $ortName, 'objektId' => $obj['id'], 'objekt' => $obj['name'], 'adresse' => $obj['adresse'], 'person' => $person,
                'geraeumt' => $geraeumt, 'gestreut' => $gestreut, 'kontrolle' => $kontrolle && !$geraeumt && !$gestreut, 'mittel' => $gestreut ? $mittel : '', 'notiz' => $notiz, 'fotos' => $gespeichert, 'lage' => $lage,
                'eingetragen' => jetzt(), 'alarm' => (string) $alarm['id'], 'test' => !empty($alarm['test'])];
            if (protokoll_anhaengen($eintrag)) {
                mit_stand(function (array &$stand) use ($ortName, $person, $obj) {
                    protokoll($stand, $ortName, "Protokoll von $person: " . $obj['name']);
                });
                $uhr = $h(t('uhrzeit', ['zeit' => uhrzeit($erledigt)]));
                $meldung = '<p class="ok">' . ($gespeichert
                    ? th('w_gespeichert_fotos', ['objekt' => $h($obj['name']), 'uhr' => $uhr, 'fotos' => count($gespeichert) === 1 ? th('w_foto_1') : th('w_fotos', ['n' => (string) count($gespeichert)])])
                    : th('w_gespeichert', ['objekt' => $h($obj['name']), 'uhr' => $uhr])) . '</p>';
            } else {
                $meldung = '<p class="fehler">' . th('w_speicher_fehler') . '</p>';
            }
        } else {
            $meldung = '<p class="fehler">' . $h(implode(' ', array_unique($fehler))) . '</p>';
        }
    }
    // heute an diesem Ort schon eingetragen
    $heute = uhrzeit(jetzt(), 'Y-m-d');
    $erledigtHeute = array_values(array_filter(protokolle_lesen(substr($heute, 0, 7)), fn ($p) => $p['ort'] === $ortName && $p['datum'] === $heute));
    $fertig = array_column($erledigtHeute, 'objektId');
    $optionen = '';
    foreach ($liste as $o) {
        $optionen .= '<option value="' . $h($o['id']) . '">' . $h($o['name'] . ($o['adresse'] ? ', ' . $o['adresse'] : '')) . (in_array($o['id'], $fertig, true) ? ' ✓' : '') . '</option>';
    }
    $schon = $erledigtHeute ? '<h2>' . th('w_heute') . '</h2><ul>' . implode('', array_map(fn ($p) => '<li>' . $h($p['objekt']) . ', ' . $h(t('uhrzeit', ['zeit' => uhrzeit((int) $p['erledigt'])])) . ', ' . $h($p['person']) . '</li>', $erledigtHeute)) . '</ul>' : '';
    // Streumittel: Wert bleibt deutsch (Protokoll, Büro), angezeigt in der Sprache
    $mittelText = ['Splitt' => 'w_splitt', 'Salz' => 'w_salz', 'Sand' => 'w_sand', 'Splitt und Salz' => 'w_splitt_salz'];
    $mittelOpt = implode('', array_map(fn ($x) => '<option value="' . $h($x) . '">' . ($x === '' ? '–' : (isset($mittelText[$x]) ? th($mittelText[$x]) : $h($x))) . '</option>', STREUMITTEL));
    html_seite(sprachwahl_html('wetter-alarm.php?aktion=protokoll&t=' . $token) . '<h1>' . th('w_protokoll') . '</h1><p>' . $h($ortName) . ' · ' . $h($person) . '</p>' . $meldung
        . ($liste ? '<form method="post" enctype="multipart/form-data" data-fotos-verkleinern>'
            . '<label for="objekt">' . th('objekt') . '</label><select id="objekt" name="objekt" required><option value="">' . th('w_waehlen') . '</option>' . $optionen . '</select>'
            . '<label for="erledigt">' . th('w_erledigt_um') . '</label><input type="time" id="erledigt" name="erledigt" value="' . uhrzeit(jetzt()) . '" required>'
            . '<label class="haken"><input type="checkbox" name="geraeumt" value="1"> ' . th('w_geraeumt') . '</label>'
            . '<label class="haken"><input type="checkbox" name="gestreut" value="1"> ' . th('w_gestreut') . '</label>'
            . '<label class="haken"><input type="checkbox" name="kontrolle" value="1"> ' . th('w_kontrolliert') . '</label>'
            . '<label for="mittel">' . th('w_streumittel') . '</label><select id="mittel" name="mittel">' . $mittelOpt . '</select>'
            . '<label for="notiz">' . th('notiz_optional') . '</label><textarea id="notiz" name="notiz" rows="2" maxlength="500" placeholder="' . th('w_notiz_bsp') . '"></textarea>'
            . '<label for="fotos">' . th('w_fotos_label') . '</label><input type="file" id="fotos" name="fotos[]" accept="image/*" capture="environment" multiple>'
            . '<button type="submit">' . th('w_speichern') . '</button></form>'
          : '<p>' . th('w_kein_objekt') . '</p>')
        . $schon, 200, 'wetter-foto.js', t('w_titel'));
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
if ($aktion === 'protokolle') {
    // Protokolle eines Monats (Standard: dieser und der vorige), für die Übernahme nach SharePoint
    $monat = (string) ($_GET['monat'] ?? '');
    $monate = preg_match('/^\d{4}-\d{2}$/', $monat) ? [$monat] : [uhrzeit(strtotime('first day of last month', jetzt()), 'Y-m'), uhrzeit(jetzt(), 'Y-m')];
    $alle = [];
    foreach (array_unique($monate) as $m) {
        $alle = array_merge($alle, protokolle_lesen($m));
    }
    ausgabe(200, ['eintraege' => $alle]);
}
if ($aktion === 'foto') {
    $datei = (string) ($_GET['datei'] ?? '');
    $pfad = protokoll_ordner() . '/fotos/' . $datei;
    if (!preg_match('/^[a-f0-9]{12}-[1-4]\.(jpg|png|webp)$/', $datei) || !is_file($pfad)) {
        ausgabe(404, ['fehler' => 'Foto nicht gefunden']);
    }
    header('Content-Type: ' . array_search(pathinfo($datei, PATHINFO_EXTENSION), FOTO_TYPEN, true));
    header('Cache-Control: private, max-age=86400');
    header('Content-Length: ' . filesize($pfad));
    readfile($pfad);
    exit;
}
if ($aktion === 'fotos-uebernommen' && $methode === 'POST') {
    // Die App hat diese Fotos nach SharePoint übertragen: am Webspace löschen (nur gültige Namen)
    $daten = json_decode((string) file_get_contents('php://input'), true);
    $geloescht = 0;
    foreach ((array) ($daten['dateien'] ?? []) as $datei) {
        if (is_string($datei) && preg_match('/^[a-f0-9]{12}-[1-4]\.(jpg|png|webp)$/', $datei) && @unlink(protokoll_ordner() . '/fotos/' . $datei)) {
            $geloescht++;
        }
    }
    ausgabe(200, ['geloescht' => $geloescht]);
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
    ausgabe(200, ['gespeichert' => count($neu['orte']) . (count($neu['orte']) === 1 ? ' Ort' : ' Orte')]);
}
ausgabe(400, ['fehler' => 'Unbekannte Aktion']);
