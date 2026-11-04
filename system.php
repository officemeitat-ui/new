<?php
// Systemcheck für die Inbetriebnahme (App → Systemcheck): Was der Webspace kann und ob die
// Einrichtung stimmt. Liefert nur Ja/Nein-Werte und Zeitpunkte, keine Inhalte. PHP-Version und
// freier Speicher nur mit Schlüssel (X-Schluessel: Schlüssel von Schnee-Alarm, Plan am Handy oder Kundenbereich)
// oder solange noch keiner eingerichtet ist (erste Inbetriebnahme).

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$alarmOrdner = getenv('WETTER_ALARM_ORDNER') ?: __DIR__ . '/privat';
$planOrdner = getenv('MEIN_PLAN_ORDNER') ?: __DIR__ . '/privat';
$lesen = function ($datei) {
    $d = is_file($datei) ? json_decode((string) @file_get_contents($datei), true) : null;
    return is_array($d) ? $d : null;
};
$alarm = $lesen("$alarmOrdner/wetter-alarm.json");
$plan = $lesen("$planOrdner/mitarbeiter.json");
$kundenOrdner = getenv('KUNDEN_ORDNER') ?: __DIR__ . '/privat';
$kunden = $lesen("$kundenOrdner/kundenbereich.json");
$schluessel = array_values(array_filter([isset($alarm['schluessel']) ? $alarm['schluessel'] : '', isset($plan['schluessel']) ? $plan['schluessel'] : '', isset($kunden['schluessel']) ? $kunden['schluessel'] : ''], function ($k) {
    return is_string($k) && strlen($k) >= 32;
}));
$gegeben = isset($_SERVER['HTTP_X_SCHLUESSEL']) ? (string) $_SERVER['HTTP_X_SCHLUESSEL'] : '';
$berechtigt = !$schluessel || ($gegeben !== '' && in_array(true, array_map(function ($k) use ($gegeben) {
    return hash_equals($k, $gegeben);
}, $schluessel), true));

// bewusst ohne PHP-8-Sprachmittel: soll auch auf zu altem PHP antworten und das melden
$bytes = function ($wert) {
    $wert = trim((string) $wert);
    $zahl = (int) $wert;
    switch (strtolower(substr($wert, -1))) {
        case 'g':
            return $zahl * 1024 * 1024 * 1024;
        case 'm':
            return $zahl * 1024 * 1024;
        case 'k':
            return $zahl * 1024;
        default:
            return $zahl;
    }
};
$upload = min($bytes((string) ini_get('upload_max_filesize')), $bytes((string) ini_get('post_max_size')) ?: PHP_INT_MAX);
$stand = $lesen("$alarmOrdner/wetter-alarm-stand.json");
$planPruefung = $lesen("$planOrdner/mitarbeiter/pruefung.json");

echo json_encode([
    'php' => ['ok' => version_compare(PHP_VERSION, '8.0.0', '>='), 'version' => $berechtigt ? PHP_VERSION : null],
    'erweiterungen' => [
        'json' => function_exists('json_encode'),
        'mbstring' => function_exists('mb_substr'),
        'curl' => function_exists('curl_init'),
        'openssl' => extension_loaded('openssl'),
        'fileinfo' => class_exists('finfo'),
        'gd' => function_exists('imagejpeg'),
    ],
    'privat' => ['vorhanden' => is_dir($alarmOrdner), 'beschreibbar' => is_dir($alarmOrdner) && is_writable($alarmOrdner)],
    'upload' => ['bytes' => $upload, 'ok' => $upload >= 8 * 1024 * 1024],
    'dateien' => ['wetterAlarm' => $alarm !== null, 'mitarbeiter' => $plan !== null, 'kundenbereich' => $kunden !== null],
    'cron' => [
        'wetterAlarm' => isset($stand['letztePruefung']) ? (int) $stand['letztePruefung'] : null,
        'meinPlan' => isset($planPruefung['zuletzt']) ? (int) $planPruefung['zuletzt'] : null,
    ],
    'speicherFrei' => $berechtigt ? (@disk_free_space(__DIR__) ?: null) : null,
    'berechtigt' => (bool) $berechtigt,
    'jetzt' => time(),
], JSON_UNESCAPED_UNICODE);
