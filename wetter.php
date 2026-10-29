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
//
// Nur Orte in Österreich, nur bekannte Parameter, keine anderen Ziele und keine
// Firmendaten. Antworten bleiben 10 Minuten im Zwischenspeicher des Servers;
// ist GeoSphere nicht erreichbar, kommt der letzte Stand (bis 6 Stunden alt).
// Daten: GeoSphere Austria, CC BY 4.0.

declare(strict_types=1);

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

if ($art === 'vorhersage') {
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
    antwort(400, ['fehler' => 'art=vorhersage, art=warnungen oder art=metadaten']);
}

[$status, $inhalt, $woher] = wetter_abruf($url);
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
