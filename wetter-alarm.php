<?php
// Schnee-Alarm für den Winterdienst (läuft am Webspace, unabhängig davon, ob jemand die App offen hat).
//
// Ein Cronjob ruft diese Datei alle 2 bis 5 Minuten auf (höchstens alle 10). Sie prüft je Ort (z. B. Salzburg,
// Hallein, Obertrum) Vorhersage und amtliche Warnungen von GeoSphere Austria und weckt
// das Winterdienst-Team, sobald es zu schneien beginnt, Glätte droht oder eine Schnee-
// oder Glatteiswarnung gilt:
//
//  - Push aufs Handy über ntfy (höchste Priorität, Knopf „Bin wach“) und E-Mail;
//  - dazu SMS von selbst, wenn ein eigenes Android-Handy oder ein SMS-Dienst eingerichtet ist (privat/sms.json; kurzer Text mit Link „Bin wach“,
//    wetter-alarm.php?w=…) und die Person in der App „SMS“ angehakt hat (stufe1[].sms);
//  - dazu WhatsApp von selbst, wenn die Schnittstelle von Meta eingerichtet ist (privat/whatsapp.json, Vorlage mit
//    Knopf „Bin wach“; webspace-lib.php) und die Person in der App „WhatsApp“ angehakt hat (stufe1[].whatsapp);
//  - bis jemand bestätigt, kommt der Push alle wiederholenMinuten (Vorgabe 3) noch einmal, höchstens wiederholungen-mal
//    (Vorgabe 5): ein Ton allein weckt kaum. Wie oft, hängt auch am Cronjob (alle 2 bis 5 Minuten aufrufen);
//  - bestätigt in Stufe 1 niemand binnen 15 Minuten, geht der Alarm an Stufe 2 (z. B. Büro);
//  - je Ort eigene Regeln (orte[].regeln überschreibt regeln) und welche Lage weckt (orte[].arten: schnee, glaette,
//    warnung); je Person in Stufe 1, welche Alarme sie bekommt (stufe1[].bei: schnee = Räumen, glaette = Streuen,
//    sonst alle). Passt niemand zur Lage, werden alle aus Stufe 1 geweckt. Bei wöchentlichem Wechsel bekommt die
//    Person der Woche alles;
//  - ein Ort meldet sich höchstens alle 8 Stunden neu, außer die Warnstufe steigt;
//  - optional Ruhezeit (z. B. 22–3 Uhr): Alarm erst am Ende, Warnung orange/rot sofort.
//
// Aufrufe:
//   php wetter-alarm.php                         prüfen (Cronjob am Webspace)
//   wetter-alarm.php?aktion=pruefen&schluessel=… prüfen (externer Cron-Dienst, Prüfschlüssel)
//   wetter-alarm.php?aktion=wach&t=…             „Bin wach“ (ntfy-Knopf, Link in der E-Mail)
//   wetter-alarm.php?aktion=protokoll&t=…        Winterdienst-Protokoll am Handy (ohne Anmeldung, mit Fotos)
//   wetter-alarm.php?aktion=blick&k=Code         „Winterdienst auf einen Blick“ fürs Haupt-Gerät (Chef, Büro): je Ort Lage,
//                                                Alarm, wer bestätigt hat, Erinnerungen, Handys bereit, Protokolle von heute;
//                                                ohne Anmeldung, Code aus der Alarm-Datei (blick), lädt jede Minute neu
//   wetter-alarm.php?aktion=handy&t=Thema        „Handy einrichten“: App ntfy, Thema mit einem Tipp abonnieren
//                                                (ntfy://), Einstellungen, Probe an das eigene Handy (in der Sprache der Person)
//   Die Seiten „Bin wach“ und „Protokoll“ und die Knöpfe der Push-Nachricht kommen in der Sprache der Person
//   (aus dem Stammblatt, orte[].stufe1[].sprache; am Handy gemerkt wie bei „Mein Dienstplan“, ?sprache=);
//   Texte in mein-plan-texte.php. Der Text des Alarms selbst bleibt deutsch.
//   wetter-alarm.php?aktion=status|test|speichern|protokolle|foto  aus der App, Schlüssel im Kopf X-Schluessel
//   wetter-alarm.php?aktion=whatsapp        GET: Stand (ohne Token), POST: { token?, nummerId?, vorlage?, sprache?, version?,
//                                           entfernen? } speichert die Zugangsdaten für WhatsApp am Webspace
//   wetter-alarm.php?aktion=whatsapp-test   POST { an }: Probe-Nachricht an eine Nummer (höchstens 10 je Stunde)
//   wetter-alarm.php?aktion=sms             GET: Stand (ohne Schlüssel bzw. Passwort), POST: { anbieter? (handy|seven),
//                                           handy: benutzer?, passwort?, server?; seven: schluessel?, absender?; entfernen? }
//   wetter-alarm.php?aktion=sms-test        POST { an }: Probe-SMS an eine Nummer (höchstens 10 je Stunde)
//   wetter-alarm.php?aktion=probe           POST { thema }: Probe an eine Person (alle ihre Wege, mit „Bin wach“); bestätigte
//                                           Proben und Alarme stehen im Stand unter „handys“ (Thema → bestätigt, Probe)
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

const ALARM_STANDARD = ['vorlaufStunden' => 3, 'schneeCm' => 0.3, 'glaetteC' => 1, 'pauseStunden' => 8, 'eskalationMinuten' => 15, 'ruheVon' => '', 'ruheBis' => '', 'ruheAusnahmeStufe' => 2, 'ohneDatenStunden' => 2, 'wiederholenMinuten' => 3, 'wiederholungen' => 5];
const ALARM_ARTEN = ['schnee', 'glaette', 'warnung'];

/** Regeln eines Orts: die allgemeinen, überschrieben von den eigenen des Orts (nur bekannte Schlüssel, Zahlen bzw. Uhrzeiten). */
function regeln_ort(array $e, array $ort): array
{
    $r = $e['regeln'];
    foreach ((array) ($ort['regeln'] ?? []) as $k => $v) {
        if (!array_key_exists($k, ALARM_STANDARD)) {
            continue;
        }
        if (in_array($k, ['ruheVon', 'ruheBis'], true) ? is_string($v) && ($v === '' || preg_match('/^\d{2}:\d{2}$/', $v)) : is_numeric($v) && $v >= 0) {
            $r[$k] = is_string(ALARM_STANDARD[$k]) ? (string) $v : (float) $v;
        }
    }
    return $r;
}

/** Welche Lage an diesem Ort weckt (orte[].arten); ohne Angabe alle. */
function arten_ort(array $ort): array
{
    $a = array_values(array_intersect(ALARM_ARTEN, (array) ($ort['arten'] ?? ALARM_ARTEN)));
    return $a ?: ALARM_ARTEN;
}
const STUFE_TEXT = [1 => 'gelb', 2 => 'orange', 3 => 'rot'];
const WHATSAPP_TAG = 150; // höchstens so viele WhatsApp-Nachrichten am Tag (Schutz vor Kosten, falls etwas schiefläuft)
const SMS_TAG = 100;      // höchstens so viele SMS am Tag (bei rund 8 Cent je SMS höchstens rund 8 Euro, eine lange SMS zählt doppelt)

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
    $roh = (string) stream_get_contents($h);
    $stand = json_decode($roh, true);
    if (!is_array($stand)) {
        $stand = ['orte' => [], 'protokoll' => []];
    }
    $ergebnis = $fn($stand);
    $neu = json_encode($stand, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($neu !== $roh) { // nur bei Änderung schreiben (wie antraege())
        ftruncate($h, 0);
        rewind($h);
        fwrite($h, $neu);
        fflush($h);
    }
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
function lage(array $stunden, array $warnungen, array $r, int $jetzt, array $erlaubt = ALARM_ARTEN): ?array
{
    $bis = $jetzt + (int) round($r['vorlaufStunden'] * 3600);
    // Werte von GeoSphere gelten für die Stunde, die zum Zeitstempel endet: Beginn = Zeitstempel − 1 h
    $nah = array_values(array_filter($stunden, fn ($h) => $h['at'] > $jetzt - 3600 && $h['at'] - 3600 < $bis));
    $texte = [];
    $arten = [];
    $stufe = 0;
    $schnee = null;
    foreach (in_array('schnee', $erlaubt, true) ? $nah : [] as $h) {
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
    foreach (in_array('glaette', $erlaubt, true) ? $nah : [] as $h) {
        if ($h['t'] !== null && $h['t'] <= $r['glaetteC'] && ($h['precip'] ?? 0) >= 0.1 && !(($h['snow'] ?? 0) > 0)) {
            $texte[] = sprintf('Glätte möglich ab %s Uhr (%s °C mit Niederschlag)', uhrzeit(max($h['at'] - 3600, $jetzt)), str_replace('.', ',', (string) round($h['t'], 1)));
            $arten[] = 'glaette';
            $stufe = max($stufe, 1);
            break;
        }
    }
    foreach (in_array('warnung', $erlaubt, true) ? $warnungen : [] as $w) {
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
function stufe1(array $ort, int $ts, array $arten = []): array
{
    $liste = array_values((array) ($ort['stufe1'] ?? []));
    // abwesend (Urlaub, Krankenstand laut App) am Tag des Einsatzes: nicht wecken
    $da = array_values(array_filter($liste, fn ($p) => anwesend($p, $ts)));
    if (($ort['wechsel'] ?? '') !== 'woche' || count($liste) < 2) {
        // je Person, welche Alarme sie bekommt: schnee (Räumen) bzw. glaette (Streuen); passt niemand, alle
        $passt = fn ($p) => match ((string) ($p['bei'] ?? '')) {
            'schnee' => in_array('schnee', $arten, true),
            'glaette' => in_array('glaette', $arten, true) || in_array('glatteis', $arten, true),
            default => true,
        };
        $gefiltert = $arten ? array_values(array_filter($da, $passt)) : $da;
        return $gefiltert ?: $da;
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

/**
 * Voriger und dieser Monat (JJJJ-MM) in Wien. Nicht mit strtotime(): das rechnet in der Zeitzone des Servers (oft UTC),
 * am 1. um 0:30 Uhr wäre in UTC noch der Vortag und der Vormonat fehlte.
 */
function protokoll_monate(int $ts): array
{
    $wien = (new DateTimeImmutable('@' . $ts))->setTimezone(new DateTimeZone('Europe/Vienna'));
    return [$wien->modify('first day of last month')->format('Y-m'), $wien->format('Y-m')];
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

/**
 * Fahrer zu einem dauerhaften Protokoll-Code (Liste „fahrer“ der Einstellungen, in der App unter Wetter &
 * Winterdienst → „Protokoll-Links für Fahrer“): ['code', 'name', 'sprache'?] oder null. Der Link gilt, bis die
 * Person in der App entfernt oder ihr Link erneuert wird – ohne Schnee-Alarm.
 */
function fahrer_zum_code(?array $e, string $code): ?array
{
    if (!$e || strlen($code) !== 24) {
        return null;
    }
    foreach ((array) ($e['fahrer'] ?? []) as $f) {
        if (is_array($f) && is_string($f['code'] ?? null) && strlen($f['code']) === 24 && hash_equals($f['code'], $code) && trim((string) ($f['name'] ?? '')) !== '') {
            return $f;
        }
    }
    return null;
}

/**
 * Objekte für den Fahrer-Link als [['id', 'name', 'adresse', 'ort']]: alle Objekte mit Winterdienst (Liste
 * „winterObjekte“ der Einstellungen), sonst die Objekte aller eingeschalteten Orte.
 */
function fahrer_objekte(array $e): array
{
    $aus = [];
    foreach ((array) ($e['winterObjekte'] ?? []) as $i => $o) {
        if (is_array($o) && trim((string) ($o['name'] ?? '')) !== '') {
            $aus[(string) ($o['id'] ?? "w$i")] = ['id' => (string) ($o['id'] ?? "w$i"), 'name' => (string) $o['name'], 'adresse' => (string) ($o['adresse'] ?? ''), 'ort' => (string) ($o['ort'] ?? '')];
        }
    }
    if (!$aus) {
        foreach ((array) ($e['orte'] ?? []) as $ort) {
            foreach (objekte($ort) as $o) {
                $aus[$o['id']] = $o + ['ort' => (string) ($ort['name'] ?? '')];
            }
        }
    }
    return array_values($aus);
}

// ---------------------------------------------------------------- Benachrichtigen

function adresse(array $e): string
{
    return rtrim((string) ($e['adresse'] ?? ''), '/') . '/';
}

/** Link zur Übersicht „Winterdienst auf einen Blick“ oder '' (ohne Code in der Alarm-Datei). */
function blick_link(array $e): string
{
    return preg_match('/^[a-f0-9]{24}$/', (string) ($e['blick'] ?? '')) ? adresse($e) . 'wetter-alarm.php?aktion=blick&k=' . $e['blick'] : '';
}

/** Formular von einer fremden Seite? (Browser schicken Sec-Fetch-Site mit; wie in mein-plan.php) */
function fremde_herkunft(): bool
{
    $herkunft = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    return $herkunft !== '' && $herkunft !== 'same-origin' && $herkunft !== 'none';
}

/** Person zum ntfy-Thema (Stufe 1 oder 2 eines Orts) oder null. */
function person_zum_thema(?array $e, string $thema): ?array
{
    if (!$e || !preg_match('/^[A-Za-z0-9_-]{1,64}$/', $thema)) {
        return null;
    }
    foreach ((array) ($e['orte'] ?? []) as $ort) {
        foreach (['stufe1', 'stufe2'] as $stufe) {
            foreach ((array) ($ort[$stufe] ?? []) as $p) {
                if (is_array($p) && ($p['ntfy'] ?? '') === $thema) {
                    return $p;
                }
            }
        }
    }
    return null;
}

/**
 * Probe an eine Person (alle ihre Wege, Knopf „Bin wach“ ohne Protokoll). $grenze: höchstens so viele Proben je Stunde
 * für dieses Thema (die Seite „Handy einrichten“ ist ohne Anmeldung erreichbar). Liefert ['ok'|'grenze', Fehler].
 */
function probe_senden(array $e, array $person, int $grenze): array
{
    $thema = (string) ($person['ntfy'] ?? '');
    $token = bin2hex(random_bytes(12));
    $darf = mit_stand(function (array &$stand) use ($person, $thema, $token, $grenze) {
        $stand['proben'] = array_filter((array) ($stand['proben'] ?? []), fn ($p) => is_array($p) && (int) ($p['gesendet'] ?? 0) > jetzt() - 30 * 86400);
        $jetztDa = array_filter($stand['proben'], fn ($p) => ($p['thema'] ?? '') === $thema && (int) $p['gesendet'] > jetzt() - 3600);
        if (count($jetztDa) >= $grenze) {
            return false;
        }
        $stand['proben'][$token] = ['thema' => $thema, 'name' => (string) ($person['name'] ?? ''), 'gesendet' => jetzt(), 'wach' => null] + (sprache_gueltig($person['sprache'] ?? null) ? ['sprache' => $person['sprache']] : []);
        $stand['proben'] = array_slice($stand['proben'], -300, null, true);
        return true;
    });
    if (!$darf) {
        return ['grenze', []];
    }
    $fehler = benachrichtigen($e, $person, 'Probe Winterdienst', 'Probe: So kommt der Schnee-Alarm auf dieses Handy. Bitte mit „Bin wach“ bestätigen.', $token, true, false);
    mit_stand(function (array &$stand) use ($person, $fehler) {
        protokoll($stand, 'Probe', 'Probe an ' . ($person['name'] ?? '?') . ($fehler ? ' – ' . implode('; ', $fehler) : ''));
    });
    return ['ok', $fehler];
}

/** Je ntfy-Thema: wann zuletzt ein Alarm oder eine Probe bestätigt wurde, wann die letzte Probe ging (für die App). */
function handys_stand(array $stand): array
{
    $aus = [];
    foreach ((array) ($stand['bereit'] ?? []) as $thema => $ts) {
        $aus[(string) $thema] = ['bestaetigt' => (int) $ts, 'probe' => null];
    }
    foreach ((array) ($stand['proben'] ?? []) as $p) {
        $t = (string) ($p['thema'] ?? '');
        if ($t !== '' && (int) ($p['gesendet'] ?? 0) > (int) ($aus[$t]['probe'] ?? 0)) {
            $aus[$t] = ['bestaetigt' => $aus[$t]['bestaetigt'] ?? null, 'probe' => (int) $p['gesendet']];
        }
    }
    return $aus;
}

/** WhatsApp-Einstellungen dieses Aufrufs (einmal gelesen); null: nicht eingerichtet. */
function whatsapp(): ?array
{
    static $w = false;
    if ($w === false) {
        $w = whatsapp_einstellungen(ordner());
    }
    return $w;
}

/** WhatsApp an eine Nummer, mit der Grenze je Tag (WHATSAPP_TAG). Liefert '' oder den Fehler. */
function whatsapp_an(array $w, string $an, string $titel, string $text, string $knopf): string
{
    $datei = ordner() . '/whatsapp-zaehler.json';
    $tag = uhrzeit(jetzt(), 'Y-m-d');
    $z = json_decode((string) @file_get_contents($datei), true);
    $n = is_array($z) && ($z['tag'] ?? '') === $tag ? (int) ($z['anzahl'] ?? 0) : 0;
    if ($n >= WHATSAPP_TAG) {
        return 'Grenze von ' . WHATSAPP_TAG . ' Nachrichten am Tag erreicht';
    }
    $f = whatsapp_senden($w, $an, [$titel, $text], $knopf);
    if ($f === '') {
        @file_put_contents($datei, json_encode(['tag' => $tag, 'anzahl' => $n + 1]), LOCK_EX);
    }
    return $f;
}

/** SMS-Einstellungen dieses Aufrufs (einmal gelesen); null: nicht eingerichtet. */
function sms(): ?array
{
    static $s = false;
    if ($s === false) {
        $s = sms_einstellungen(ordner());
    }
    return $s;
}

/** SMS an eine Nummer, mit der Grenze je Tag (SMS_TAG); merkt sich das Guthaben, das der Dienst meldet. Liefert '' oder den Fehler. */
function sms_an(array $s, string $an, string $text): string
{
    $datei = ordner() . '/sms-zaehler.json';
    $tag = uhrzeit(jetzt(), 'Y-m-d');
    $z = json_decode((string) @file_get_contents($datei), true);
    $z = is_array($z) ? $z : [];
    $n = ($z['tag'] ?? '') === $tag ? (int) ($z['anzahl'] ?? 0) : 0;
    if ($n >= SMS_TAG) {
        return 'Grenze von ' . SMS_TAG . ' SMS am Tag erreicht';
    }
    [$f, $guthaben] = sms_senden($s, $an, $text);
    if ($f === '' || $guthaben !== null) {
        @file_put_contents($datei, json_encode(['tag' => $tag, 'anzahl' => $n + ($f === '' ? 1 : 0), 'guthaben' => $guthaben ?? ($z['guthaben'] ?? null), 'stand' => $guthaben !== null ? jetzt() : ($z['stand'] ?? null)]), LOCK_EX);
    }
    return $f;
}

/**
 * SMS an eine Person: Überschrift, Lage (gekürzt, damit es zwei SMS nicht übersteigt) und der Link zum Bestätigen
 * (kurz: wetter-alarm.php?w=Code; ohne Code der Link zur App). Nur wer eine Nummer für SMS in der Alarm-Datei hat.
 */
function sms_person(array $e, array $person, string $titel, string $text, ?string $token): array
{
    $s = sms();
    if (!$s || !is_string($person['sms'] ?? null) || $person['sms'] === '') {
        return [];
    }
    $ende = $token ? t('w_bin_wach', [], sprache_von($person)) . ': ' . adresse($e) . 'wetter-alarm.php?w=' . $token : adresse($e) . '#wetter';
    $kurz = (string) preg_replace('/ Bitte mit „Bin wach“ bestätigen\.$/u', '', $text);
    $f = sms_an($s, $person['sms'], sms_kuerzen($titel . ':', $kurz, $ende));
    return $f !== '' ? [sprintf('SMS an %s: %s', $person['name'] ?? '?', $f)] : [];
}

/**
 * WhatsApp an eine Person über die Schnittstelle von Meta: Vorlage mit Überschrift, Text und Knopf (mit Code: „Bin wach“,
 * ohne Code führt er zur App). Nur wer eine Nummer in der Alarm-Datei hat und nur, wenn WhatsApp eingerichtet ist.
 */
function whatsapp_person(array $person, string $titel, string $text, ?string $token): array
{
    $w = whatsapp();
    if (!$w || !is_string($person['whatsapp'] ?? null) || $person['whatsapp'] === '') {
        return [];
    }
    $f = whatsapp_an($w, $person['whatsapp'], $titel, $text, $token ?: 'info');
    return $f !== '' ? [sprintf('WhatsApp an %s: %s', $person['name'] ?? '?', $f)] : [];
}

/**
 * An eine Person: ntfy (Push, höchste Priorität, Knopf „Bin wach“) und/oder E-Mail; mit $handy danach auch SMS und
 * WhatsApp. Liefert Fehlertexte. Mehrere Personen: alarm_senden schickt zuerst allen Push und E-Mail, dann SMS, dann
 * WhatsApp (antwortet ein Dienst langsam, wartet darauf kein Push).
 */
function benachrichtigen(array $e, array $person, string $titel, string $text, ?string $token, bool $handy = true, bool $mitProtokoll = true): array
{
    $fehler = [];
    $app = adresse($e) . '#wetter';
    $wach = $token ? adresse($e) . 'wetter-alarm.php?aktion=wach&t=' . $token : null;
    $prot = $token && $mitProtokoll ? adresse($e) . 'wetter-alarm.php?aktion=protokoll&t=' . $token : null;
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
        $inhalt = $text . "\n\n" . ($wach ? "Bitte bestätigen: $wach\n" . ($prot ? "Nach dem Räumen das Protokoll eintragen: $prot\n" : '') : '') . "App: $app\n\nAutomatische Nachricht der " . marke()['app'] . " (Wetterdaten: GeoSphere Austria).\n";
        $ok = @mail($person['email'], '=?UTF-8?B?' . base64_encode($titel) . '?=', $inhalt, implode("\r\n", $kopf), $absender ? '-f' . $absender : '');
        if (!$ok) {
            $fehler[] = sprintf('E-Mail an %s nicht versendet', $person['name'] ?? $person['email']);
        }
    }
    return $handy ? array_merge($fehler, sms_person($e, $person, $titel, $text, $token), whatsapp_person($person, $titel, $text, $token)) : $fehler;
}

/** Alarm an eine Liste von Personen senden, je Person ein eigener Bestätigungs-Code. */
function alarm_senden(array $e, array &$alarm, array $personen, string $titel, string $text): array
{
    $fehler = [];
    $codes = [];
    foreach ($personen as $i => $p) {
        $token = bin2hex(random_bytes(12));
        $codes[$i] = $token;
        $alarm['empfaenger'][$token] = ['name' => (string) ($p['name'] ?? ''), 'stufe' => $alarm['eskaliert'] ? 2 : 1] + (sprache_gueltig($p['sprache'] ?? null) ? ['sprache' => $p['sprache']] : []) + (!empty($p['ntfy']) ? ['thema' => (string) $p['ntfy']] : []);
        $fehler = array_merge($fehler, benachrichtigen($e, $p, $titel, $text, $token, false));
    }
    // SMS und WhatsApp erst, wenn alle ihren Push haben
    foreach ($personen as $i => $p) {
        $fehler = array_merge($fehler, sms_person($e, $p, $titel, $text, $codes[$i]));
    }
    foreach ($personen as $i => $p) {
        $fehler = array_merge($fehler, whatsapp_person($p, $titel, $text, $codes[$i]));
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
            $r = regeln_ort($e, $ort);
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
            $lage = lage($d['stunden'], $d['warnungen'], $r, $jetzt, arten_ort($ort));
            $s['lage'] = $lage['text'] ?? 'ruhig';
            $alarm = $s['alarm'] ?? null;
            $objekte = implode(', ', array_column(objekte($ort), 'name'));
            $titel = "Winterdienst $name";
            if ($lage) {
                $neu = !$alarm || !empty($alarm['test']) || $jetzt - (int) $alarm['gesendet'] >= $r['pauseStunden'] * 3600 || $lage['stufe'] > (int) $alarm['stufe'];
                if ($neu && in_ruhezeit($r, $jetzt) && $lage['stufe'] < $r['ruheAusnahmeStufe']) {
                    // Ruhezeit: merken, am Ende wecken
                    $s['wartend'] = $s['wartend'] ?? ['seit' => $jetzt, 'text' => $lage['text'], 'arten' => $lage['arten']];
                } elseif ($neu || !empty($s['wartend'])) {
                    $text = !empty($s['wartend']) ? gemeldet($s['wartend']) . ($s['wartend']['text'] !== $lage['text'] ? '. Jetzt: ' . $lage['text'] : '') : $lage['text'];
                    $alarm = ['id' => bin2hex(random_bytes(6)), 'gesendet' => $jetzt, 'stufe' => $lage['stufe'], 'text' => $text, 'empfaenger' => [], 'wach' => [], 'eskaliert' => null, 'test' => false];
                    $fehler = alarm_senden($e, $alarm, stufe1($ort, $jetzt, array_merge($lage['arten'], (array) ($s['wartend']['arten'] ?? []))), $titel, "$text." . ($objekte ? " Objekte: $objekte." : '') . ' Bitte mit „Bin wach“ bestätigen.');
                    unset($s['wartend']);
                    protokoll($stand, $name, "Alarm: $text");
                }
            } elseif (!empty($s['wartend']) && !in_ruhezeit($r, $jetzt)) {
                // in der Ruhezeit gemeldet, inzwischen vorbei: trotzdem wecken (Schnee liegt)
                $text = gemeldet($s['wartend']);
                $alarm = ['id' => bin2hex(random_bytes(6)), 'gesendet' => $jetzt, 'stufe' => 1, 'text' => $text, 'empfaenger' => [], 'wach' => [], 'eskaliert' => null, 'test' => false];
                $fehler = alarm_senden($e, $alarm, stufe1($ort, $jetzt, (array) ($s['wartend']['arten'] ?? [])), $titel, "$text." . ($objekte ? " Objekte: $objekte." : '') . ' Bitte mit „Bin wach“ bestätigen.');
                unset($s['wartend']);
                protokoll($stand, $name, "Alarm nach der Ruhezeit: $text");
            }
            // niemand bestätigt: den Push wiederholen (nur Push, ohne E-Mail, SMS und WhatsApp; mit denselben Codes)
            // nur für einen frischen Alarm (sonst käme nach dem Einschalten des Wiederholens eine Erinnerung zu einem Alarm von gestern)
            $frisch = $alarm && $jetzt - (int) $alarm['gesendet'] <= ((float) $r['wiederholungen'] * (float) $r['wiederholenMinuten'] + 10) * 60;
            if ($alarm && $frisch && empty($alarm['test']) && !$alarm['wach'] && !empty($alarm['empfaenger']) && (float) $r['wiederholenMinuten'] > 0
                && (int) ($alarm['wiederholt'] ?? 0) < (int) $r['wiederholungen'] && $jetzt - (int) ($alarm['zuletzt'] ?? $alarm['gesendet']) >= (float) $r['wiederholenMinuten'] * 60 - 30) {
                $n = 0;
                foreach ($alarm['empfaenger'] as $tk => $em) {
                    if (empty($em['thema'])) {
                        continue;
                    }
                    $n++;
                    $fehler = array_merge($fehler, benachrichtigen($e, ['name' => $em['name'], 'ntfy' => $em['thema']] + (isset($em['sprache']) ? ['sprache' => $em['sprache']] : []), "Erinnerung: $titel", $alarm['text'] . '. Noch hat niemand bestätigt. Bitte mit „Bin wach“ bestätigen.', (string) $tk, false));
                }
                $alarm['wiederholt'] = (int) ($alarm['wiederholt'] ?? 0) + 1;
                $alarm['zuletzt'] = $jetzt;
                if ($n) {
                    protokoll($stand, $name, 'Erinnerung ' . $alarm['wiederholt'] . ' an ' . $n . ($n === 1 ? ' Person' : ' Personen'));
                }
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
// kurzer Link aus der SMS: wetter-alarm.php?w=Code ist „Bin wach“ mit diesem Code
if (!$cli && $aktion === '' && is_string($_GET['w'] ?? null)) {
    $aktion = 'wach';
    $_GET['t'] = $_GET['w'];
}
$e = einstellungen();
$methode = $cli ? 'CLI' : ($_SERVER['REQUEST_METHOD'] ?? 'GET');

// „Bin wach“: GET zeigt eine Seite mit Knopf (E-Mail-Prüfprogramme öffnen Links von selbst), POST bestätigt
if ($aktion === 'wach') {
    // Knopf einer WhatsApp-Nachricht ohne Bestätigung (z. B. „keine Wetterdaten“): gleich zur App
    if (($_GET['t'] ?? '') === 'info' && $e) {
        header('Location: ' . adresse($e) . '#wetter', true, 302);
        exit;
    }
    $token = preg_replace('/[^a-f0-9]/', '', (string) ($_GET['t'] ?? ''));
    if (strlen($token) !== 24) {
        sprache_waehlen([], true);
        html_seite('<p>' . th('w_ungueltig') . '</p>', 400, '', t('w_titel'));
        exit;
    }
    $zu = $e ? alarm_zum_code($token) : null;
    // Probe (Seite „Handy einrichten“ oder aus der App): bestätigt, dass das Handy weckt
    $probe = !$zu && $e ? (mit_stand(fn (array &$s) => $s)['proben'][$token] ?? null) : null;
    sprache_waehlen($zu ? (array) ($zu[2]['empfaenger'][$token] ?? []) : (array) ($probe ?? []), true);
    if ($probe && $methode === 'POST') {
        mit_stand(function (array &$stand) use ($token) {
            $p = &$stand['proben'][$token];
            $p['wach'] = $p['wach'] ?? jetzt();
            $stand['bereit'][(string) $p['thema']] = jetzt();
        });
        html_seite('<h1>' . th('h_probe_ok', ['name' => htmlspecialchars((string) $probe['name'])]) . '</h1><p>' . th('h_probe_ok_text') . '</p>', 200, '', t('h_titel'));
        exit;
    }
    if ($methode !== 'POST') {
        html_seite(sprachwahl_html('wetter-alarm.php?aktion=wach&t=' . $token) . '<h1>' . th('w_titel') . '</h1><p>' . th('w_bitte_bestaetigen') . '</p><form method="post"><button type="submit">' . th('w_wach_knopf') . '</button></form>', 200, '', t('w_titel'));
        exit;
    }
    $wer = mit_stand(function (array &$stand) use ($token) {
        foreach ($stand['orte'] as $name => &$s) {
            if (isset($s['alarm']['empfaenger'][$token])) {
                $erstes = !isset($s['alarm']['wach'][$token]);
                $s['alarm']['wach'][$token] = $s['alarm']['wach'][$token] ?? jetzt();
                $person = $s['alarm']['empfaenger'][$token]['name'];
                if (!empty($s['alarm']['empfaenger'][$token]['thema'])) {
                    $stand['bereit'][(string) $s['alarm']['empfaenger'][$token]['thema']] = jetzt(); // dieses Handy weckt
                }
                protokoll($stand, $name, "$person ist wach (bestätigt)");
                return [$person, $name, $erstes, !empty($s['alarm']['test'])];
            }
        }
        return null;
    });
    if (!$wer) {
        html_seite('<p>' . th('w_nicht_offen') . '</p>', 404, '', t('w_titel'));
        exit;
    }
    // Bestätigung ans Büro-Handy (Stufe 2 „Büro“ mit Push), wenn so eingestellt; nur beim ersten Tippen
    if ($wer[2] && !empty($e['bestaetigungAnBuero'])) {
        foreach ((array) ($e['orte'] ?? []) as $ort) {
            if (($ort['name'] ?? '') !== $wer[1]) {
                continue;
            }
            foreach ((array) ($ort['stufe2'] ?? []) as $b) {
                if (($b['name'] ?? '') === 'Büro' && !empty($b['ntfy'])) {
                    ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $b['ntfy'], 'title' => ($wer[3] ? 'Testalarm bestätigt: ' : 'Bestätigt: ') . 'Winterdienst ' . $wer[1], 'message' => $wer[0] . ' ist wach (' . uhrzeit(jetzt()) . ' Uhr).', 'priority' => 3, 'tags' => ['white_check_mark'], 'click' => blick_link($e) ?: adresse($e) . '#wetter']);
                }
            }
        }
    }
    html_seite('<h1>' . th('w_danke', ['name' => htmlspecialchars($wer[0])]) . '</h1><p>' . th('w_bestaetigt', ['ort' => htmlspecialchars($wer[1])]) . '</p>'
        . '<a class="knopf" href="wetter-alarm.php?aktion=protokoll&amp;t=' . $token . '">' . th('w_protokoll_eintragen') . '</a>', 200, '', t('w_titel'));
    exit;
}

// „Winterdienst auf einen Blick“ fürs Haupt-Gerät: alles Wichtige ohne Anmeldung, mit dem Code aus der Alarm-Datei
if ($aktion === 'blick') {
    $k = (string) ($_GET['k'] ?? '');
    sprache('de');
    header('X-Robots-Tag: noindex, nofollow');
    header('Referrer-Policy: no-referrer');
    if (!$e || !preg_match('/^[a-f0-9]{24}$/', (string) ($e['blick'] ?? '')) || !hash_equals((string) $e['blick'], $k)) {
        html_seite('<h1>Winterdienst auf einen Blick</h1><p>Dieser Link gilt nicht (mehr). Den aktuellen Link gibt es in der App unter „Schnee-Alarm“ → „Einstellungen“.</p>', 404, '', 'Winterdienst');
        exit;
    }
    header('Refresh: 60'); // lädt jede Minute neu
    $h = fn (string $t) => htmlspecialchars($t, ENT_QUOTES);
    $stand = mit_stand(fn (array &$s) => $s);
    $jetzt = jetzt();
    $vor = fn (int $ts) => $jetzt - $ts < 60 ? 'gerade eben' : ($jetzt - $ts < 7200 ? 'vor ' . intdiv($jetzt - $ts, 60) . ' min' : uhrzeit($ts, 'd.m. H:i'));
    $letzte = (int) ($stand['letztePruefung'] ?? 0);
    $kopf = '<h1>Winterdienst auf einen Blick</h1><p class="leise">Stand ' . uhrzeit($jetzt, 'd.m.Y H:i') . ' Uhr · lädt jede Minute neu</p>'
        . (!$letzte ? '<p class="fehler">Noch keine Prüfung am Webspace: läuft der Cronjob?</p>' : ($jetzt - $letzte > 1800 ? '<p class="fehler">Letzte Wetterprüfung ' . $h($vor($letzte)) . ': läuft der Cronjob?</p>' : '<p class="leise">Wetter geprüft ' . $h($vor($letzte)) . '</p>'));
    $bereit = (array) ($stand['bereit'] ?? []);
    $heute = uhrzeit($jetzt, 'Y-m-d');
    $prot = array_values(array_filter(protokolle_lesen(substr($heute, 0, 7)), fn ($p) => ($p['datum'] ?? '') === $heute && empty($p['test'])));
    $teile = '';
    foreach ((array) ($e['orte'] ?? []) as $ort) {
        $name = (string) $ort['name'];
        $s = (array) ($stand['orte'][$name] ?? []);
        $a = $s['alarm'] ?? null;
        $offen = $a && $jetzt - (int) $a['gesendet'] <= 36 * 3600;
        $html = '<h2>' . $h($name) . '</h2>';
        $lage = (string) ($s['lage'] ?? '');
        $html .= !empty($s['fehler']) ? '<p class="fehler">Keine Wetterdaten: ' . $h((string) $s['fehler']) . '</p>' : '<p>' . ($lage === '' ? '<span class="leise">noch nicht geprüft</span>' : ($lage === 'ruhig' ? 'ruhig' : '<b>' . $h($lage) . '</b>')) . '</p>';
        if (!empty($s['wartend'])) {
            $html .= '<p class="leise">Ruhezeit: wird am Ende geweckt (gemeldet ' . uhrzeit((int) $s['wartend']['seit']) . ' Uhr).</p>';
        }
        if ($offen) {
            $wach = (array) ($a['wach'] ?? []);
            $zeilen = '';
            foreach ((array) ($a['empfaenger'] ?? []) as $tk => $em) {
                $ts = $wach[$tk] ?? null;
                $zeilen .= '<li>' . ($ts ? '<span class="ok-zeichen">✓</span> ' : '<span class="warte">…</span> ') . $h((string) ($em['name'] ?? '?'))
                    . ((int) ($em['stufe'] ?? 1) === 2 ? ' <span class="leise">(Stufe 2)</span>' : '') . ($ts ? ' – wach ' . uhrzeit((int) $ts) . ' Uhr' : ' – <span class="leise">noch nicht bestätigt</span>') . '</li>';
            }
            $html .= '<div class="' . ($wach ? 'ok' : 'fehler') . '">' . (!empty($a['test']) ? 'Testalarm' : 'Alarm') . ' ' . uhrzeit((int) $a['gesendet'], 'd.m. H:i') . ' Uhr'
                . ($wach ? ' – bestätigt' : ' – noch niemand bestätigt') . (!empty($a['eskaliert']) ? ', Stufe 2 alarmiert ' . uhrzeit((int) $a['eskaliert']) . ' Uhr' : '')
                . (!empty($a['wiederholt']) ? ', ' . (int) $a['wiederholt'] . '× erinnert' : '') . '</div>' . ($zeilen ? '<ul class="liste">' . $zeilen . '</ul>' : '');
        }
        // Handys aus Stufe 1: bereit (Probe oder Alarm bestätigt)?
        $handys = '';
        foreach ((array) ($ort['stufe1'] ?? []) as $p) {
            if (!empty($p['ntfy'])) {
                $b = (int) ($bereit[$p['ntfy']] ?? 0);
                $handys .= '<li>' . ($b ? '<span class="ok-zeichen">✓</span> ' : '<span class="warte">?</span> ') . $h((string) $p['name']) . ($b ? ' <span class="leise">' . uhrzeit($b, 'd.m.') . '</span>' : ' <span class="leise">Handy noch nicht geprüft</span>') . '</li>';
            }
        }
        $html .= $handys ? '<details><summary>Handys in Stufe 1</summary><ul class="liste">' . $handys . '</ul></details>' : '';
        $heuteHier = array_filter($prot, fn ($p) => ($p['ort'] ?? '') === $name);
        if ($heuteHier) {
            $html .= '<p class="leise">Heute eingetragen:</p><ul class="liste">' . implode('', array_map(fn ($p) => '<li>' . $h(uhrzeit((int) $p['erledigt'])) . ' ' . $h((string) $p['objekt']) . ' – ' . $h((string) $p['person']) . ' <span class="leise">(' . $h(implode(', ', array_filter([!empty($p['geraeumt']) ? 'geräumt' : '', !empty($p['gestreut']) ? 'gestreut' : '', !empty($p['kontrolle']) ? 'kontrolliert' : '']))) . ')</span></li>', $heuteHier)) . '</ul>';
        }
        $teile .= '<section class="ort">' . $html . '</section>';
    }
    $ohneOrt = array_filter($prot, fn ($p) => ($p['ort'] ?? '') === '');
    if ($ohneOrt) {
        $teile .= '<section class="ort"><h2>Andere Adressen</h2><ul class="liste">' . implode('', array_map(fn ($p) => '<li>' . $h(uhrzeit((int) $p['erledigt'])) . ' ' . $h((string) $p['objekt']) . ' – ' . $h((string) $p['person']) . '</li>', $ohneOrt)) . '</ul></section>';
    }
    $log = array_slice((array) ($stand['protokoll'] ?? []), 0, 15);
    $teile .= $log ? '<details><summary>Protokoll des Alarms</summary><ul class="liste">' . implode('', array_map(fn ($p) => '<li><span class="leise">' . uhrzeit((int) $p['zeit'], 'd.m. H:i') . '</span> ' . $h((string) $p['ort']) . ': ' . $h((string) $p['text']) . '</li>', $log)) . '</ul></details>' : '';
    html_seite('<style>main{max-width:40rem}.ort{border-top:1px solid #dde5ea;padding:.4rem 0 .6rem}.ort h2{margin:.6rem 0 .2rem}.liste{list-style:none;padding:0;margin:.3rem 0}.liste li{margin:.25rem 0}.ok-zeichen{color:#2e6b12;font-weight:700}.warte{color:#a1460b;font-weight:700}summary{cursor:pointer;color:#0a5a96;margin:.4rem 0}</style>'
        . $kopf . $teile, 200, '', 'Winterdienst');
    exit;
}

// „Handy einrichten“ (Link aus der Einladung bzw. QR-Code vom Blatt): App ntfy, Thema mit einem Tipp abonnieren, Einstellungen
// für die Nacht, Probe an das eigene Handy. Ohne Anmeldung; das Thema im Link wirkt wie ein Passwort (wie in ntfy selbst).
if ($aktion === 'handy') {
    $thema = (string) ($_GET['t'] ?? '');
    $person = person_zum_thema($e, $thema);
    sprache_waehlen((array) ($person ?? []), true);
    header('X-Robots-Tag: noindex, nofollow');
    header('Referrer-Policy: no-referrer');
    if (!$person) {
        html_seite('<h1>' . th('h_titel') . '</h1><p>' . th('h_ungueltig') . '</p>', 404, '', t('h_titel'));
        exit;
    }
    $h = fn (string $t) => htmlspecialchars($t, ENT_QUOTES);
    $selbst = 'wetter-alarm.php?aktion=handy&t=' . rawurlencode($thema);
    $meldung = '';
    if ($methode === 'POST') {
        if (fremde_herkunft()) {
            html_seite('<p>' . th('nicht_erlaubt') . '</p>', 403, '', t('h_titel'));
            exit;
        }
        [$ok, $fehler] = probe_senden($e, $person, 3);
        // Fehler eines Weges (z. B. Push-Dienst antwortet nicht) stehen im Protokoll der App; die Person bekommt nur den Hinweis
        $meldung = $ok === 'grenze' ? '<p class="fehler" role="alert">' . th('h_probe_zuviel') . '</p>'
            : ($fehler ? '<p class="fehler" role="alert">' . th('h_probe_fehler') . '</p>' : '<p class="ok" role="status">' . th('h_probe_gesendet') . '</p>');
    }
    // ntfy-Server und Link für die App (ntfy://Server/Thema; http-Server mit secure=false)
    $server = rtrim((string) ($e['ntfy'] ?? 'https://ntfy.sh'), '/');
    $teile = parse_url($server) ?: [];
    $wo = (string) ($teile['host'] ?? 'ntfy.sh') . (isset($teile['port']) ? ':' . (int) $teile['port'] : '') . rtrim((string) ($teile['path'] ?? ''), '/');
    $tief = 'ntfy://' . $wo . '/' . rawurlencode($thema) . '?display=' . rawurlencode(t('h_anzeige')) . (($teile['scheme'] ?? 'https') === 'http' ? '&secure=false' : '');
    $bereit = (int) (mit_stand(fn (array &$s) => $s)['bereit'][$thema] ?? 0);
    $laden = '<ul><li><a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" rel="noopener">Google Play</a></li>'
        . '<li><a href="https://f-droid.org/packages/io.heckel.ntfy/" rel="noopener">F-Droid</a> <span class="leise">(' . th('h_fdroid') . ')</span></li>'
        . '<li><a href="https://apps.apple.com/app/ntfy/id1625396347" rel="noopener">App Store</a> <span class="leise">(iPhone)</span></li></ul>';
    html_seite(sprachwahl_html($selbst) . '<h1>' . th('h_titel') . '</h1><p><b>' . $h((string) $person['name']) . '</b></p>' . $meldung
        . ($bereit ? '<p class="ok">' . th('h_bereit', ['zeit' => $h(uhrzeit($bereit, 'd.m.Y H:i'))]) . '</p>' : '')
        . '<p>' . th('h_intro') . '</p>'
        . '<h2>1. ' . th('h_schritt1') . '</h2>' . $laden
        . '<h2>2. ' . th('h_schritt2') . '</h2><a class="knopf" href="' . $h($tief) . '">' . th('h_knopf') . '</a>'
        . '<p class="leise">' . th('h_vonhand', ['thema' => '<code>' . $h($thema) . '</code>', 'server' => '<code>' . $h($server) . '</code>']) . '</p>'
        . '<h2>3. ' . th('h_schritt3') . '</h2><ul><li>' . th('h_einst_sofort') . '</li><li>' . th('h_einst_laut') . '</li><li><b>' . th('h_einst_dauer') . '</b></li><li>' . th('h_einst_akku') . '</li></ul>'
        . '<h2>4. ' . th('h_schritt4') . '</h2><form method="post" action="' . $h($selbst) . '"><button type="submit">' . th('h_probe_knopf') . '</button></form>', 200, '', t('h_titel'));
    exit;
}

// Winterdienst-Protokoll am Handy: mit dem Code aus dem Alarm, ohne Anmeldung. GET: Formular, POST: speichern.
if ($aktion === 'protokoll') {
    $token = preg_replace('/[^a-f0-9]/', '', (string) ($_GET['t'] ?? ''));
    // dauerhafter Link eines Fahrers (f=…): ohne Alarm, alle Objekte mit Winterdienst oder eine freie Adresse
    $code = preg_replace('/[^a-f0-9]/', '', (string) ($_GET['f'] ?? ''));
    $zu = $e ? alarm_zum_code($token) : null;
    $fahrer = $zu ? null : fahrer_zum_code($e, $code);
    sprache_waehlen($zu ? (array) ($zu[2]['empfaenger'][$token] ?? []) : (array) ($fahrer ?? []), true);
    if (!$zu && !$fahrer) {
        html_seite('<h1>' . th('w_protokoll') . '</h1><p>' . th($code !== '' ? 'w_link_ungueltig' : 'w_link_abgelaufen') . '</p>', 404, '', t('w_titel'));
        exit;
    }
    if ($zu) {
        [$ortName, $person, $alarm, $lage] = $zu;
        $ort = null;
        foreach ((array) $e['orte'] as $o) {
            if ($o['name'] === $ortName) {
                $ort = $o;
            }
        }
        $liste = array_map(fn ($o) => $o + ['ort' => $ortName], $ort ? objekte($ort) : []);
        $selbst = 'wetter-alarm.php?aktion=protokoll&t=' . $token;
    } else {
        $ortName = '';
        $person = trim((string) $fahrer['name']);
        $alarm = ['id' => '', 'test' => false];
        $lage = '';
        $liste = fahrer_objekte($e);
        $selbst = 'wetter-alarm.php?aktion=protokoll&f=' . $code;
    }
    $h = fn (string $t) => htmlspecialchars($t, ENT_QUOTES);
    $meldung = '';
    if ($methode === 'POST') {
        $fehler = [];
        $obj = null;
        $wahl = (string) ($_POST['objekt'] ?? '');
        if ($wahl === 'andere') {
            // freie Adresse (Objekt nicht in der Liste): einzeilig, begrenzt
            $frei = mb_substr(trim((string) preg_replace('/\s+/u', ' ', (string) ($_POST['adresse'] ?? ''))), 0, 160);
            if (mb_strlen($frei) < 5) {
                $fehler[] = t('w_fehler_adresse');
            } else {
                $obj = ['id' => '', 'name' => $frei, 'adresse' => $frei, 'ort' => $ortName];
            }
        } else {
            foreach ($liste as $o) {
                if ($o['id'] === $wahl) {
                    $obj = $o;
                }
            }
            if (!$obj) {
                $fehler[] = t('fehler_objekt');
            }
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
            $eintrag = ['id' => $id, 'datum' => uhrzeit($erledigt, 'Y-m-d'), 'erledigt' => $erledigt, 'ort' => (string) ($obj['ort'] ?? $ortName), 'objektId' => $obj['id'], 'objekt' => $obj['name'], 'adresse' => $obj['adresse'], 'person' => $person,
                'geraeumt' => $geraeumt, 'gestreut' => $gestreut, 'kontrolle' => $kontrolle && !$geraeumt && !$gestreut, 'mittel' => $gestreut ? $mittel : '', 'notiz' => $notiz, 'fotos' => $gespeichert, 'lage' => $lage,
                'eingetragen' => jetzt(), 'alarm' => (string) $alarm['id'], 'test' => !empty($alarm['test']), 'quelle' => $zu ? 'alarm' : 'fahrer'];
            if (protokoll_anhaengen($eintrag)) {
                if ($zu) {
                    mit_stand(function (array &$stand) use ($ortName, $person, $obj) {
                        protokoll($stand, $ortName, "Protokoll von $person: " . $obj['name']);
                    });
                }
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
    // mit dem Alarm-Link: was heute an diesem Ort eingetragen ist; mit dem Fahrer-Link: was die Person heute eingetragen hat
    $erledigtHeute = array_values(array_filter(protokolle_lesen(substr($heute, 0, 7)), fn ($p) => ($p['datum'] ?? '') === $heute && ($zu ? ($p['ort'] ?? '') === $ortName : ($p['person'] ?? '') === $person && ($p['quelle'] ?? '') === 'fahrer')));
    $fertig = array_column($erledigtHeute, 'objektId');
    // Fahrer-Link mit Objekten an mehreren Orten: nach Ort gegliedert
    $orteDerListe = array_values(array_unique(array_filter(array_map(fn ($o) => (string) ($o['ort'] ?? ''), $liste))));
    $gruppen = count($orteDerListe) > 1;
    $optionen = '';
    $gruppe = null;
    foreach ($liste as $o) {
        if ($gruppen && ($o['ort'] ?? '') !== $gruppe) {
            $optionen .= ($gruppe !== null ? '</optgroup>' : '') . '<optgroup label="' . $h((string) ($o['ort'] ?? '') ?: '–') . '">';
            $gruppe = (string) ($o['ort'] ?? '');
        }
        $optionen .= '<option value="' . $h($o['id']) . '">' . $h($o['name'] . ($o['adresse'] ? ', ' . $o['adresse'] : '')) . (in_array($o['id'], $fertig, true) ? ' ✓' : '') . '</option>';
    }
    $optionen .= ($gruppen && $gruppe !== null ? '</optgroup>' : '') . '<option value="andere">' . th('w_andere_adresse') . '</option>';
    $schon = $erledigtHeute ? '<h2>' . th($zu ? 'w_heute' : 'w_heute_dir') . '</h2><ul>' . implode('', array_map(fn ($p) => '<li>' . $h($p['objekt']) . ', ' . $h(t('uhrzeit', ['zeit' => uhrzeit((int) $p['erledigt'])])) . ', ' . $h($p['person']) . '</li>', $erledigtHeute)) . '</ul>' : '';
    // Streumittel: Wert bleibt deutsch (Protokoll, Büro), angezeigt in der Sprache
    $mittelText = ['Splitt' => 'w_splitt', 'Salz' => 'w_salz', 'Sand' => 'w_sand', 'Splitt und Salz' => 'w_splitt_salz'];
    $mittelOpt = implode('', array_map(fn ($x) => '<option value="' . $h($x) . '">' . ($x === '' ? '–' : (isset($mittelText[$x]) ? th($mittelText[$x]) : $h($x))) . '</option>', STREUMITTEL));
    // der Fahrer-Link hat immer ein Formular (freie Adresse), der Alarm-Link nur mit Objekten am Ort
    html_seite(sprachwahl_html($selbst) . '<h1>' . th('w_protokoll') . '</h1><p>' . $h(implode(' · ', array_filter([$ortName, $person]))) . '</p>' . $meldung
        . (!$liste && !$zu ? '<p>' . th('w_kein_objekt_fahrer') . '</p>' : '')
        . ($liste || !$zu ? '<form method="post" enctype="multipart/form-data" data-fotos-verkleinern>'
            . '<label for="objekt">' . th('objekt') . '</label><select id="objekt" name="objekt" required><option value="">' . th('w_waehlen') . '</option>' . $optionen . '</select>'
            . '<label for="adresse">' . th('w_adresse') . '</label><input type="text" id="adresse" name="adresse" maxlength="160" autocomplete="street-address" placeholder="' . th('w_adresse_bsp') . '" value="' . $h(($methode === 'POST' && $meldung !== '' && str_contains($meldung, 'class="fehler"')) ? (string) ($_POST['adresse'] ?? '') : '') . '">'
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
    ausgabe(200, ['jetzt' => jetzt(), 'letztePruefung' => $stand['letztePruefung'] ?? null, 'orte' => $orte, 'protokoll' => array_slice($stand['protokoll'] ?? [], 0, 20), 'whatsapp' => whatsapp() !== null, 'sms' => sms() !== null, 'handys' => handys_stand($stand)]);
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
// Probe an eine Person aus der App (alle ihre Wege; höchstens 5 je Stunde und Person)
if ($aktion === 'probe' && $methode === 'POST') {
    $daten = json_decode((string) file_get_contents('php://input'), true);
    $person = person_zum_thema($e, is_string($daten['thema'] ?? null) ? $daten['thema'] : '');
    if (!$person) {
        ausgabe(404, ['fehler' => 'Diese Person ist am Webspace noch nicht eingetragen: zuerst „Speichern und übertragen“.']);
    }
    [$ok, $fehler] = probe_senden($e, $person, 5);
    if ($ok === 'grenze') {
        ausgabe(429, ['fehler' => 'Zu viele Proben für diese Person in dieser Stunde (höchstens 5).']);
    }
    ausgabe(200, ['gesendet' => true, 'fehler' => $fehler]);
}
// SMS: Zugang zum SMS-Dienst (nur am Webspace, der Schlüssel kommt nie zurück)
if ($aktion === 'sms' || $aktion === 'sms-test') {
    $datei = ordner() . '/sms.json';
    $stand_sms = function () use ($datei): array {
        $s = sms_einstellungen(ordner());
        if (!$s) {
            return ['eingerichtet' => false, 'anbieter' => 'handy', 'anbieterName' => SMS_ANBIETER['handy'], 'anbieterListe' => SMS_ANBIETER];
        }
        $aus = ['eingerichtet' => true, 'anbieter' => $s['anbieter'], 'anbieterName' => SMS_ANBIETER[$s['anbieter']], 'gespeichert' => (int) ($s['gespeichert'] ?? 0), 'anbieterListe' => SMS_ANBIETER];
        if ($s['anbieter'] === 'handy') {
            return $aus + ['benutzer' => $s['benutzer'], 'server' => $s['server']];
        }
        $z = json_decode((string) @file_get_contents(ordner() . '/sms-zaehler.json'), true);
        return $aus + ['absender' => $s['absender'], 'schluesselEnde' => substr($s['schluessel'], -4), 'guthaben' => is_array($z) && is_numeric($z['guthaben'] ?? null) ? (float) $z['guthaben'] : null, 'guthabenStand' => is_array($z) ? ($z['stand'] ?? null) : null];
    };
    if ($aktion === 'sms-test') {
        if ($methode !== 'POST') {
            ausgabe(405, ['fehler' => 'POST erwartet']);
        }
        $s = sms_einstellungen(ordner());
        if (!$s) {
            ausgabe(409, ['fehler' => 'SMS ist am Webspace noch nicht eingerichtet (Zugangsdaten speichern).']);
        }
        $daten = json_decode((string) file_get_contents('php://input'), true);
        $an = is_string($daten['an'] ?? null) ? (string) preg_replace('/\D/', '', $daten['an']) : '';
        $darf = mit_stand(function (array &$stand) {
            $stand['smsProben'] = array_values(array_filter((array) ($stand['smsProben'] ?? []), fn ($t) => (int) $t > jetzt() - 3600));
            if (count($stand['smsProben']) >= 10) {
                return false;
            }
            $stand['smsProben'][] = jetzt();
            return true;
        });
        if (!$darf) {
            ausgabe(429, ['fehler' => 'Zu viele Proben in dieser Stunde (höchstens 10).']);
        }
        $f = sms_an($s, $an, sms_kuerzen('Probe ' . marke()['app'] . ':', 'So kommt der Schnee-Alarm als SMS. Im Alarm steht hier der Link zum Bestätigen.', adresse($e) . '#wetter'));
        ausgabe($f === '' ? 200 : 502, $f === '' ? ['gesendet' => true] + $stand_sms() : ['fehler' => $f]);
    }
    if ($methode === 'POST') {
        $neu = json_decode((string) file_get_contents('php://input'), true);
        if (!is_array($neu)) {
            ausgabe(400, ['fehler' => 'POST mit JSON erwartet']);
        }
        if (!empty($neu['entfernen'])) {
            @unlink($datei);
            @unlink(ordner() . '/sms-zaehler.json');
            ausgabe(200, $stand_sms());
        }
        $alt = json_decode((string) @file_get_contents($datei), true);
        $alt = is_array($alt) ? $alt : [];
        $anbieter = is_string($neu['anbieter'] ?? null) && $neu['anbieter'] !== '' ? $neu['anbieter'] : (string) ($alt['anbieter'] ?? 'handy');
        if (!isset(SMS_ANBIETER[$anbieter])) {
            ausgabe(400, ['fehler' => 'Diesen Weg für SMS kennt die App nicht.']);
        }
        // anderer Weg: die Zugangsdaten des alten gelten nicht weiter
        $s = ($alt['anbieter'] ?? '') === $anbieter ? $alt : [];
        $s['anbieter'] = $anbieter;
        $felder = $anbieter === 'seven'
            ? ['schluessel' => 'Der Schlüssel sieht nicht richtig aus (20 bis 200 Zeichen, ohne Leerzeichen).']
            : ['benutzer' => 'Der Benutzername steht in der App am Handy unter „Cloud Server“ (ohne Leerzeichen).', 'passwort' => 'Das Passwort steht in der App am Handy unter „Cloud Server“ (ohne Leerzeichen).', 'server' => 'Eigener Server: eine Adresse mit https://, sonst leer lassen.'];
        foreach ($felder as $k => $text) {
            if (!isset($neu[$k]) || ($neu[$k] === '' && $k !== 'server')) {
                continue;
            }
            if (!sms_feld_gueltig($k, $neu[$k])) {
                ausgabe(400, ['fehler' => $text]);
            }
            $s[$k] = $neu[$k];
        }
        if ($anbieter === 'seven' && isset($neu['absender'])) {
            if (!is_string($neu['absender']) || mb_strlen($neu['absender']) > 40) {
                ausgabe(400, ['fehler' => 'Absender: ein Name mit höchstens 11 Buchstaben und Ziffern oder eine Nummer mit Ländervorwahl.']);
            }
            $s['absender'] = sms_absender($neu['absender']);
        }
        if ($anbieter === 'seven' && empty($s['schluessel'])) {
            ausgabe(400, ['fehler' => 'Den Schlüssel des SMS-Dienstes angeben.']);
        }
        if ($anbieter === 'handy' && (empty($s['benutzer']) || empty($s['passwort']))) {
            ausgabe(400, ['fehler' => 'Benutzername und Passwort aus der App am Handy angeben.']);
        }
        $s['gespeichert'] = jetzt();
        $s = array_intersect_key($s, array_flip($anbieter === 'seven' ? ['anbieter', 'schluessel', 'absender', 'gespeichert'] : ['anbieter', 'benutzer', 'passwort', 'server', 'gespeichert']));
        if (@file_put_contents($datei . '.neu', json_encode($s, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), LOCK_EX) === false || !@rename($datei . '.neu', $datei)) {
            ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        @chmod($datei, 0600);
    }
    ausgabe(200, $stand_sms());
}
// WhatsApp: Zugangsdaten für die Schnittstelle von Meta (nur am Webspace, das Token kommt nie zurück)
if ($aktion === 'whatsapp' || $aktion === 'whatsapp-test') {
    $datei = ordner() . '/whatsapp.json';
    $stand_wa = function () use ($datei): array {
        $w = whatsapp_einstellungen(ordner());
        $roh = json_decode((string) @file_get_contents($datei), true);
        return $w
            ? ['eingerichtet' => true, 'nummerId' => $w['nummerId'], 'vorlage' => $w['vorlage'], 'sprache' => $w['sprache'], 'version' => $w['version'], 'tokenEnde' => substr($w['token'], -4), 'gespeichert' => (int) ($w['gespeichert'] ?? 0)]
            : ['eingerichtet' => false, 'vorlage' => WHATSAPP_VORLAGE, 'sprache' => 'de', 'version' => WHATSAPP_VERSION, 'unvollstaendig' => is_array($roh)];
    };
    if ($aktion === 'whatsapp-test') {
        if ($methode !== 'POST') {
            ausgabe(405, ['fehler' => 'POST erwartet']);
        }
        $w = whatsapp_einstellungen(ordner());
        if (!$w) {
            ausgabe(409, ['fehler' => 'WhatsApp ist am Webspace noch nicht eingerichtet (Zugriffstoken und Telefonnummer-ID speichern).']);
        }
        $daten = json_decode((string) file_get_contents('php://input'), true);
        $an = is_string($daten['an'] ?? null) ? (string) preg_replace('/\D/', '', $daten['an']) : '';
        // höchstens 10 Proben je Stunde
        $darf = mit_stand(function (array &$stand) {
            $stand['waProben'] = array_values(array_filter((array) ($stand['waProben'] ?? []), fn ($t) => (int) $t > jetzt() - 3600));
            if (count($stand['waProben']) >= 10) {
                return false;
            }
            $stand['waProben'][] = jetzt();
            return true;
        });
        if (!$darf) {
            ausgabe(429, ['fehler' => 'Zu viele Proben in dieser Stunde (höchstens 10).']);
        }
        $f = whatsapp_an($w, $an, 'Probe', 'So kommt eine Nachricht vom Winterdienst an. Der Knopf öffnet die App.', 'info');
        ausgabe($f === '' ? 200 : 502, $f === '' ? ['gesendet' => true] : ['fehler' => $f]);
    }
    if ($methode === 'POST') {
        $neu = json_decode((string) file_get_contents('php://input'), true);
        if (!is_array($neu)) {
            ausgabe(400, ['fehler' => 'POST mit JSON erwartet']);
        }
        if (!empty($neu['entfernen'])) {
            @unlink($datei);
            ausgabe(200, $stand_wa());
        }
        $alt = json_decode((string) @file_get_contents($datei), true);
        $w = is_array($alt) ? $alt : [];
        $felder = [
            'token' => ['/^[A-Za-z0-9_|.\-]{40,1000}$/', 'Das Zugriffstoken sieht nicht richtig aus (40 bis 1000 Zeichen, ohne Leerzeichen).'],
            'nummerId' => ['/^\d{6,20}$/', 'Die Telefonnummer-ID besteht nur aus Ziffern (nicht die Telefonnummer selbst).'],
            'vorlage' => ['/^[a-z0-9_]{1,128}$/', 'Name der Vorlage: nur Kleinbuchstaben, Ziffern und Unterstrich.'],
            'sprache' => ['/^[a-z]{2,3}(_[A-Z]{2})?$/', 'Sprache der Vorlage als Kürzel, z. B. de.'],
            'version' => ['/^v\d{1,2}\.\d$/', 'Version der Schnittstelle in der Form v25.0.'],
        ];
        foreach ($felder as $k => [$muster, $text]) {
            if (!isset($neu[$k]) || $neu[$k] === '') {
                continue;
            }
            if (!is_string($neu[$k]) || !preg_match($muster, $neu[$k])) {
                ausgabe(400, ['fehler' => $text]);
            }
            $w[$k] = $neu[$k];
        }
        if (empty($w['token']) || empty($w['nummerId'])) {
            ausgabe(400, ['fehler' => 'Zugriffstoken und Telefonnummer-ID angeben.']);
        }
        $w['gespeichert'] = jetzt();
        $w = array_intersect_key($w, array_flip(['token', 'nummerId', 'vorlage', 'sprache', 'version', 'gespeichert']));
        if (@file_put_contents($datei . '.neu', json_encode($w, JSON_PRETTY_PRINT), LOCK_EX) === false || !@rename($datei . '.neu', $datei)) {
            ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        @chmod($datei, 0600);
    }
    ausgabe(200, $stand_wa());
}
if ($aktion === 'protokolle') {
    // Protokolle eines Monats (Standard: dieser und der vorige), für die Übernahme nach SharePoint
    $monat = (string) ($_GET['monat'] ?? '');
    $monate = preg_match('/^\d{4}-\d{2}$/', $monat) ? [$monat] : protokoll_monate(jetzt());
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
