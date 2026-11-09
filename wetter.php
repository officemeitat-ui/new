<?php
// Wetter-Umweg der App für den Webspace (z. B. World4You mit PHP).
//
// Die App lädt Vorhersage und Warnungen zuerst direkt bei GeoSphere Austria.
// Lässt der Browser das nicht zu (CORS) oder ist der Dienst aus dem Firmennetz
// gesperrt, fragt sie hier am eigenen Webspace. Diese Datei holt nur diese
// Adressen von GeoSphere und gibt die Antwort unverändert weiter:
//
//   wetter.php?art=vorhersage&lat=47.8095&lon=13.055&parameter=2t,tp,sf,10fg
//   wetter.php?art=warnungen&lat=47.8095&lon=13.055
//   wetter.php?art=metadaten   (welche Parameter der Datensatz hat)
//   wetter.php?art=nowcast&punkte=47.8095,13.055;47.6833,13.097   (Niederschlag der nächsten 3 h, bis 16 Orte)
//   wetter.php?art=raster&quelle=nowcast|inca|modell&bbox=47.45,12.55,48.3,13.6[&raster=12]
//                              (Radarbild: Gitter im Ausschnitt oder Zeitreihen an raster × raster Punkten)
//
// Nur Orte in Österreich, nur bekannte Parameter, keine anderen Ziele und keine
// Firmendaten. Antworten bleiben 10 Minuten im Zwischenspeicher des Servers;
// ist GeoSphere nicht erreichbar, kommt der letzte Stand (bis 6 Stunden alt).
// Neue Abrufe sind begrenzt (je Aufrufer 60 in 10 Minuten, insgesamt 150 je Stunde);
// darüber kommt der letzte Stand bzw. 429, damit dem Schnee-Alarm das Kontingent bleibt.
// Daten: GeoSphere Austria, CC BY 4.0.

declare(strict_types=1);

// Fehler nie in die Antwort (Serverpfade, Stacktraces), nur ins Fehlerprotokoll des Webspace
if (PHP_SAPI !== 'cli') {
    ini_set('display_errors', '0');
}

require __DIR__ . '/wetter-lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function antwort(int $status, array $daten): void
{
    http_response_code($status);
    echo json_encode($daten, JSON_UNESCAPED_UNICODE);
    exit;
}

// Grenze für neue Abrufe: Jeder neue Ort ist eine Anfrage des Webspace bei GeoSphere, und GeoSphere begrenzt die
// Anfragen je IP-Adresse. Ohne Grenze könnte jemand von außen das Kontingent des Webspace aufbrauchen (dann fehlen dem
// Schnee-Alarm die Wetterdaten) und den Zwischenspeicher mit beliebig vielen Orten füllen. Antworten aus dem
// Zwischenspeicher zählen nicht; der Schnee-Alarm (wetter-alarm.php) fragt selbst und zählt hier nicht mit.
const UMWEG_JE_AUFRUFER = [60, 600];  // neue Abrufe je IP-Adresse in 10 Minuten
const UMWEG_GESAMT = [150, 3600];     // neue Abrufe über wetter.php insgesamt je Stunde

/** Darf wetter.php jetzt neu bei GeoSphere abrufen? Prüft und zählt in einem Schritt (gesperrt). */
function umweg_frei(): bool
{
    $h = @fopen(rtrim(sys_get_temp_dir(), '/\\') . '/app-wetter-umweg.json', 'c+');
    if (!$h) {
        return true; // ohne beschreibbaren Temp-Ordner gibt es auch keinen Zwischenspeicher: wie bisher
    }
    flock($h, LOCK_EX);
    $d = json_decode((string) stream_get_contents($h), true);
    $jetzt = time();
    $alle = array_values(array_filter((array) ($d['alle'] ?? []), fn ($t) => (int) $t > $jetzt - UMWEG_GESAMT[1]));
    $je = [];
    foreach ((array) ($d['je'] ?? []) as $k => $liste) {
        $liste = array_values(array_filter((array) $liste, fn ($t) => (int) $t > $jetzt - UMWEG_JE_AUFRUFER[1]));
        if ($liste) {
            $je[$k] = $liste;
        }
    }
    $wer = substr(hash('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? '')), 0, 16); // Hashwert, keine IP-Adresse
    $frei = count($alle) < UMWEG_GESAMT[0] && count($je[$wer] ?? []) < UMWEG_JE_AUFRUFER[0];
    if ($frei) {
        $alle[] = $jetzt;
        $je[$wer][] = $jetzt;
    }
    ftruncate($h, 0);
    rewind($h);
    fwrite($h, (string) json_encode(['alle' => $alle, 'je' => $je]));
    fflush($h);
    flock($h, LOCK_UN);
    fclose($h);
    return $frei;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    antwort(405, ['fehler' => 'Nur GET']);
}
// Nur für die eigene App (Browser schicken Sec-Fetch-Site mit), kein offener Umweg für fremde Seiten
$herkunft = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
if ($herkunft !== '' && $herkunft !== 'same-origin' && $herkunft !== 'none') {
    antwort(403, ['fehler' => 'Nur für die App auf diesem Webspace']);
}

// Ort: nur Dezimalzahlen (ohne Leerzeichen, Exponent o. Ä.), in Österreich
$zahl = static fn ($v): ?float => is_string($v) && preg_match('/^\d{1,2}(\.\d{1,8})?$/D', $v) ? (float) $v : null;
$inOesterreich = static fn (?float $lat, ?float $lon): bool => $lat !== null && $lon !== null && $lat >= 46 && $lat <= 49.1 && $lon >= 9.4 && $lon <= 17.2;
$art = $_GET['art'] ?? '';

if ($art === 'nowcast') {
    $punkte = [];
    foreach (explode(';', (string) ($_GET['punkte'] ?? '')) as $teil) {
        $p = explode(',', $teil);
        $la = $zahl($p[0] ?? null);
        $lo = $zahl($p[1] ?? null);
        if (count($p) !== 2 || !$inOesterreich($la, $lo)) {
            antwort(400, ['fehler' => 'Orte fehlen oder liegen nicht in Österreich']);
        }
        $punkte[] = [$la, $lo];
    }
    if (count($punkte) > 16) {
        antwort(400, ['fehler' => 'Höchstens 16 Orte']);
    }
    $url = wetter_nowcast_url($punkte);
} elseif ($art === 'raster') {
    $quelle = (string) ($_GET['quelle'] ?? '');
    $b = array_map($zahl, explode(',', (string) ($_GET['bbox'] ?? '')));
    $raster = (string) ($_GET['raster'] ?? '0');
    // Ausschnitt: Süd, West, Nord, Ost; Österreich samt Rand, höchstens 1,6° × 2,4° (wie die App)
    if (!isset(WETTER_RASTER[$quelle]) || count($b) !== 4 || in_array(null, $b, true)
        || $b[0] < 45.8 || $b[2] > 49.4 || $b[1] < 9.0 || $b[3] > 17.6 || $b[2] <= $b[0] || $b[3] <= $b[1]
        || $b[2] - $b[0] > 1.6 + 1e-9 || $b[3] - $b[1] > 2.4 + 1e-9 || !preg_match('/^(0|[4-9]|1[0-6])$/D', $raster)) {
        antwort(400, ['fehler' => 'quelle=nowcast|inca|modell, bbox=Süd,West,Nord,Ost in Österreich, raster=4–16']);
    }
    $url = wetter_raster_url($quelle, $b, (int) $raster);
} else {
    $lat = $zahl($_GET['lat'] ?? ($art === 'metadaten' ? '47.8' : null));
    $lon = $zahl($_GET['lon'] ?? ($art === 'metadaten' ? '13.05' : null));
    if (!$inOesterreich($lat, $lon)) {
        antwort(400, ['fehler' => 'Ort fehlt oder liegt nicht in Österreich']);
    }
}

if (isset($url)) {
    // schon gebaut (Nowcast, Radar)
} elseif ($art === 'vorhersage') {
    $gewuenscht = explode(',', (string) ($_GET['parameter'] ?? '2t,tp'));
    $parameter = array_values(array_intersect(WETTER_PARAMETER, $gewuenscht));
    if (!$parameter || count($parameter) !== count(array_unique($gewuenscht))) {
        antwort(400, ['fehler' => 'Unbekannter Parameter']);
    }
    $url = wetter_vorhersage_url($lat, $lon, $parameter);
} elseif ($art === 'metadaten') {
    $url = wetter_ziel('vorhersage') . '/metadata';
} elseif ($art === 'warnungen') {
    $url = wetter_warnungen_url($lat, $lon);
} else {
    antwort(400, ['fehler' => 'art=vorhersage, warnungen, metadaten, nowcast oder raster']);
}

// Radarbilder sind größer: mehr Zeit lassen
@set_time_limit(60);
[$status, $inhalt, $woher] = wetter_abruf($url, $art === 'raster' ? 30 : 12, 'umweg_frei');
if ($status === 429) {
    antwort(429, ['fehler' => 'Zu viele neue Wetter-Abfragen über den Webspace. Bitte in ein paar Minuten noch einmal.']);
}
if ($status === 200) {
    if ($woher !== '') {
        header('X-Wetter: ' . $woher);
    }
    echo $inhalt;
    exit;
}
// Ort ohne Gemeinde (Warnungen) oder abgelehnte Parameter: so an die App weitergeben
if ($status === 400 || $status === 404) {
    antwort($status, ['fehler' => 'GeoSphere: Antwort ' . $status]);
}
antwort(502, ['fehler' => 'GeoSphere gerade nicht erreichbar' . ($status ? ' (Antwort ' . $status . ')' : '')]);
