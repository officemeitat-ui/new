<?php
// Wetter-Umweg der App für den Webspace (z. B. World4You mit PHP).
//
// Die App lädt Vorhersage und Warnungen zuerst direkt bei GeoSphere Austria.
// Lässt der Browser das nicht zu (CORS) oder ist der Dienst aus dem Firmennetz
// gesperrt, fragt sie hier am eigenen Webspace. Diese Datei holt genau zwei
// Adressen von GeoSphere und gibt die Antwort unverändert weiter:
//
//   wetter.php?art=vorhersage&lat=47.8095&lon=13.055&parameter=2t,tp,sf,10fg
//   wetter.php?art=warnungen&lat=47.8095&lon=13.055
//   wetter.php?art=metadaten   (welche Parameter der Datensatz hat)
//
// Nur Orte in Österreich, nur bekannte Parameter, keine anderen Ziele und keine
// Firmendaten. Antworten bleiben 10 Minuten im Zwischenspeicher des Servers;
// ist GeoSphere nicht erreichbar, kommt der letzte Stand (bis 6 Stunden alt).
// Daten: GeoSphere Austria, CC BY 4.0.

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const FRISCH = 600;       // Sekunden: so lange gilt eine Antwort als aktuell
const NOTFALL = 6 * 3600; // so alt darf der letzte Stand sein, wenn GeoSphere ausfällt
const PARAMETER = ['2t', 't2m', 'tp', 'rain', 'rr', 'rr_acc', 'rain_acc', 'sf', 'snow', 'snow_acc', '10fg', 'fg10'];

function antwort(int $status, array $daten): void
{
    http_response_code($status);
    echo json_encode($daten, JSON_UNESCAPED_UNICODE);
    exit;
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
$art = $_GET['art'] ?? '';
$lat = $zahl($_GET['lat'] ?? ($art === 'metadaten' ? '47.8' : null));
$lon = $zahl($_GET['lon'] ?? ($art === 'metadaten' ? '13.05' : null));
if ($lat === null || $lon === null || $lat < 46 || $lat > 49.1 || $lon < 9.4 || $lon > 17.2) {
    antwort(400, ['fehler' => 'Ort fehlt oder liegt nicht in Österreich']);
}
$ort = sprintf('lat=%.4F&lon=%.4F', $lat, $lon);

// Ziele fest; für Tests über Umgebungsvariablen umstellbar (nur der Server-Betreiber kann sie setzen)
$vorhersage = getenv('WETTER_VORHERSAGE') ?: 'https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/nwp-v2-1h-1km';
$warnungen = getenv('WETTER_WARNUNGEN') ?: 'https://warnungen.zamg.at/wsapp/api/getWarningsForCoords';

if ($art === 'vorhersage') {
    $gewuenscht = explode(',', (string) ($_GET['parameter'] ?? '2t,tp'));
    $parameter = array_values(array_intersect(PARAMETER, $gewuenscht));
    if (!$parameter || count($parameter) !== count(array_unique($gewuenscht))) {
        antwort(400, ['fehler' => 'Unbekannter Parameter']);
    }
    $url = $vorhersage . sprintf('?lat_lon=%.4F,%.4F&parameters=', $lat, $lon) . implode(',', $parameter);
} elseif ($art === 'metadaten') {
    $url = $vorhersage . '/metadata';
} elseif ($art === 'warnungen') {
    $url = $warnungen . '?' . $ort . '&lang=de';
} else {
    antwort(400, ['fehler' => 'art=vorhersage, art=warnungen oder art=metadaten']);
}

/** GET mit Zeitlimit, ohne Weiterleitungen; liefert [Status, Inhalt]. */
function holen(string $url): array
{
    if (function_exists('curl_init')) {
        $c = curl_init($url);
        curl_setopt_array($c, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_USERAGENT => 'App-Wetter/1 (Webspace)',
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP,
        ]);
        $inhalt = curl_exec($c);
        $status = (int) curl_getinfo($c, CURLINFO_RESPONSE_CODE);
        curl_close($c);
        return [$inhalt === false ? 0 : $status, $inhalt === false ? '' : (string) $inhalt];
    }
    $kontext = stream_context_create(['http' => ['timeout' => 12, 'follow_location' => 0, 'ignore_errors' => true, 'header' => "Accept: application/json\r\nUser-Agent: App-Wetter/1 (Webspace)\r\n"]]);
    $inhalt = @file_get_contents($url, false, $kontext);
    $status = 0;
    foreach ($http_response_header ?? [] as $zeile) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $zeile, $m)) {
            $status = (int) $m[1];
        }
    }
    return [$inhalt === false ? 0 : $status, $inhalt === false ? '' : $inhalt];
}

$datei = rtrim(sys_get_temp_dir(), '/\\') . '/app-wetter-' . sha1($url) . '.json';
$alter = is_file($datei) ? time() - (int) filemtime($datei) : PHP_INT_MAX;
if ($alter < FRISCH) {
    header('X-Wetter: Zwischenspeicher');
    readfile($datei);
    exit;
}

[$status, $inhalt] = holen($url);
if ($status === 200 && json_decode($inhalt) !== null) {
    @file_put_contents($datei, $inhalt, LOCK_EX);
    echo $inhalt;
    exit;
}
// Ort ohne Gemeinde (Warnungen) oder abgelehnte Parameter: so an die App weitergeben
if ($status === 400 || $status === 404) {
    antwort($status, ['fehler' => 'GeoSphere: Antwort ' . $status]);
}
if ($alter < NOTFALL) {
    header('X-Wetter: letzter Stand');
    readfile($datei);
    exit;
}
antwort(502, ['fehler' => 'GeoSphere gerade nicht erreichbar' . ($status ? ' (Antwort ' . $status . ')' : '')]);
