<?php
// Gemeinsame Teile für wetter.php (Umweg der App) und wetter-alarm.php (Schnee-Alarm):
// Abruf bei GeoSphere Austria mit Zwischenspeicher, Vorhersage und Warnungen lesen.
// Nur Funktionen, gibt nichts aus. Daten: GeoSphere Austria, CC BY 4.0.

declare(strict_types=1);

const WETTER_FRISCH = 600;       // Sekunden: so lange gilt eine Antwort als aktuell
const WETTER_NOTFALL = 6 * 3600; // so alt darf der letzte Stand sein, wenn GeoSphere ausfällt
// Parameter je Größe, in dieser Reihenfolge bevorzugt (wie src/core/weather.js)
const WETTER_ALIASE = [
    't' => ['2t', 't2m'],
    'precip' => ['tp', 'rain', 'rr', 'rr_acc', 'rain_acc'],
    'snow' => ['sf', 'snow', 'snow_acc'],
    'gust' => ['10fg', 'fg10'],
];
const WETTER_PARAMETER = ['2t', 't2m', 'tp', 'rain', 'rr', 'rr_acc', 'rain_acc', 'sf', 'snow', 'snow_acc', '10fg', 'fg10'];
const WETTER_SAETZE = [['2t', 'tp', 'sf', '10fg'], ['2t', 'tp', 'sf'], ['2t', 'tp']];
const WETTER_ARTEN = [1 => 'sturm', 2 => 'regen', 3 => 'schnee', 4 => 'glatteis', 5 => 'gewitter', 6 => 'hitze', 7 => 'kaelte'];

/** Ziele fest; für Tests über Umgebungsvariablen umstellbar (nur der Server-Betreiber kann sie setzen). */
function wetter_ziel(string $art): string
{
    if ($art === 'warnungen') {
        return getenv('WETTER_WARNUNGEN') ?: 'https://warnungen.zamg.at/wsapp/api/getWarningsForCoords';
    }
    return getenv('WETTER_VORHERSAGE') ?: 'https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/nwp-v2-1h-1km';
}

function wetter_vorhersage_url(float $lat, float $lon, array $parameter): string
{
    return wetter_ziel('vorhersage') . sprintf('?lat_lon=%.4F,%.4F&parameters=', $lat, $lon) . implode(',', $parameter);
}

function wetter_warnungen_url(float $lat, float $lon): string
{
    return wetter_ziel('warnungen') . sprintf('?lat=%.4F&lon=%.4F&lang=de', $lat, $lon);
}

/** HTTP mit Zeitlimit, ohne Weiterleitungen; liefert [Status, Inhalt] (Status 0 = nicht erreichbar). */
function holen(string $url, ?string $json = null): array
{
    $kopf = ['Accept: application/json'];
    if ($json !== null) {
        $kopf[] = 'Content-Type: application/json';
    }
    if (function_exists('curl_init')) {
        $c = curl_init($url);
        curl_setopt_array($c, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_HTTPHEADER => $kopf,
            CURLOPT_USERAGENT => 'App-Wetter/1 (Webspace)',
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP,
        ]);
        if ($json !== null) {
            curl_setopt($c, CURLOPT_POST, true);
            curl_setopt($c, CURLOPT_POSTFIELDS, $json);
        }
        $inhalt = curl_exec($c);
        $status = (int) curl_getinfo($c, CURLINFO_RESPONSE_CODE);
        curl_close($c);
        return [$inhalt === false ? 0 : $status, $inhalt === false ? '' : (string) $inhalt];
    }
    $http = ['timeout' => 12, 'follow_location' => 0, 'ignore_errors' => true, 'header' => implode("\r\n", $kopf) . "\r\nUser-Agent: App-Wetter/1 (Webspace)\r\n"];
    if ($json !== null) {
        $http += ['method' => 'POST', 'content' => $json];
    }
    $inhalt = @file_get_contents($url, false, stream_context_create(['http' => $http]));
    $status = 0;
    foreach ($http_response_header ?? [] as $zeile) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $zeile, $m)) {
            $status = (int) $m[1];
        }
    }
    return [$inhalt === false ? 0 : $status, $inhalt === false ? '' : $inhalt];
}

/**
 * GeoSphere-Abruf mit Zwischenspeicher im Temp-Ordner: [Status, Inhalt, Herkunft].
 * Herkunft: '' (frisch geholt), 'Zwischenspeicher' (jünger als 10 min) oder
 * 'letzter Stand' (GeoSphere fällt aus, Stand bis 6 h alt). 400/404 kommen unverändert zurück.
 */
function wetter_abruf(string $url): array
{
    $datei = rtrim(sys_get_temp_dir(), '/\\') . '/app-wetter-' . sha1($url) . '.json';
    $alter = is_file($datei) ? time() - (int) filemtime($datei) : PHP_INT_MAX;
    if ($alter < WETTER_FRISCH) {
        return [200, (string) file_get_contents($datei), 'Zwischenspeicher'];
    }
    [$status, $inhalt] = holen($url);
    if ($status === 200 && json_decode($inhalt) !== null) {
        @file_put_contents($datei, $inhalt, LOCK_EX);
        return [200, $inhalt, ''];
    }
    if ($status === 400 || $status === 404) {
        return [$status, $inhalt, ''];
    }
    if ($alter < WETTER_NOTFALL) {
        return [200, (string) file_get_contents($datei), 'letzter Stand'];
    }
    return [$status, $inhalt, ''];
}

/** Aus den Metadaten des Datensatzes die passenden Parameter wählen (wie pickParams in der App). */
function wetter_parameter_aus_metadaten(?array $meta): ?array
{
    $liste = $meta['parameters'] ?? [];
    $namen = [];
    foreach ((array) $liste as $p) {
        $namen[] = is_array($p) ? ($p['name'] ?? '') : (string) $p;
    }
    $wahl = [];
    foreach (WETTER_ALIASE as $art => $aliase) {
        foreach ($aliase as $n) {
            if (in_array($n, $namen, true)) {
                $wahl[$art] = $n;
                break;
            }
        }
    }
    return isset($wahl['t'], $wahl['precip']) ? array_values($wahl) : null;
}

/** Stündliche Vorhersage für einen Ort: [['at' => s, 't' => °C, 'precip' => mm, 'snow' => cm], …]. */
function wetter_vorhersage(float $lat, float $lon): array
{
    $letzter = 0;
    $saetze = WETTER_SAETZE;
    for ($i = 0; $i < count($saetze); $i++) {
        [$status, $inhalt] = wetter_abruf(wetter_vorhersage_url($lat, $lon, $saetze[$i]));
        if ($status === 200) {
            return wetter_stunden(json_decode($inhalt, true));
        }
        $letzter = $status;
        if ($status !== 400) {
            break;
        }
        // alle Sätze abgelehnt: Namen aus den Metadaten nehmen
        if ($i === count($saetze) - 1) {
            [$s, $meta] = wetter_abruf(wetter_ziel('vorhersage') . '/metadata');
            $wahl = $s === 200 ? wetter_parameter_aus_metadaten(json_decode($meta, true)) : null;
            if ($wahl && !in_array($wahl, $saetze, true)) {
                $saetze[] = $wahl;
            }
        }
    }
    throw new RuntimeException('Vorhersage nicht erreichbar' . ($letzter ? " (Antwort $letzter)" : ''));
}

/** Antwort der Data-Hub-Zeitreihe → Stunden; Kelvin, Summen (*_acc), m/s und m umgerechnet. */
function wetter_stunden(?array $json): array
{
    $zeiten = $json['timestamps'] ?? null;
    $p = $json['features'][0]['properties']['parameters'] ?? null;
    if (!is_array($zeiten) || !is_array($p)) {
        throw new RuntimeException('Unerwartete Antwort der Wettervorhersage');
    }
    $reihe = function (string $art) use ($p): ?array {
        foreach (WETTER_ALIASE[$art] as $name) {
            if (!isset($p[$name]['data']) || !is_array($p[$name]['data'])) {
                continue;
            }
            $d = array_map(fn ($v) => is_numeric($v) ? (float) $v : null, $p[$name]['data']);
            if (str_ends_with($name, '_acc')) {
                $vorher = 0.0;
                foreach ($d as $i => $v) {
                    if ($v === null) {
                        continue;
                    }
                    $d[$i] = max(0.0, $v - $vorher);
                    $vorher = $v;
                }
            }
            $einheit = (string) ($p[$name]['unit'] ?? '');
            $max = max(array_map(fn ($v) => $v ?? -INF, $d) ?: [-INF]);
            if ($art === 't' && ($einheit === 'K' || $max > 150)) {
                $d = array_map(fn ($v) => $v === null ? null : $v - 273.15, $d);
            }
            if (($art === 'precip' || $art === 'snow') && $einheit === 'm') {
                $d = array_map(fn ($v) => $v === null ? null : $v * 1000, $d);
            }
            if ($art === 'gust' && !str_contains($einheit, 'km')) {
                $d = array_map(fn ($v) => $v === null ? null : $v * 3.6, $d);
            }
            return $d;
        }
        return null;
    };
    $t = $reihe('t');
    $n = $reihe('precip');
    $s = $reihe('snow');
    $stunden = [];
    foreach ($zeiten as $i => $z) {
        $at = strtotime((string) $z);
        if ($at === false) {
            continue;
        }
        $stunden[] = ['at' => $at, 't' => $t[$i] ?? null, 'precip' => $n[$i] ?? null, 'snow' => $s[$i] ?? null];
    }
    return $stunden;
}

/** Amtliche Warnungen für einen Ort: [['type' => 'schnee', 'level' => 1–3, 'start' => s, 'end' => s, 'text' => …], …]. */
function wetter_warnungen(float $lat, float $lon): array
{
    [$status, $inhalt] = wetter_abruf(wetter_warnungen_url($lat, $lon));
    if ($status === 404) {
        return []; // Ort ohne Gemeinde: keine Warnungen
    }
    if ($status !== 200) {
        throw new RuntimeException('Warnungen nicht erreichbar' . ($status ? " (Antwort $status)" : ''));
    }
    $json = json_decode($inhalt, true);
    $liste = $json['properties']['warnings'] ?? $json['warnings'] ?? [];
    $aus = [];
    foreach ((array) $liste as $w) {
        $p = $w['properties'] ?? $w;
        $roh = $p['rawinfo'] ?? [];
        $typ = WETTER_ARTEN[(int) ($p['warntypid'] ?? $roh['wtype'] ?? 0)] ?? null;
        $stufe = (int) ($p['warnstufeid'] ?? $roh['wlevel'] ?? 0);
        $start = isset($roh['start']) && is_numeric($roh['start']) ? (int) $roh['start'] : wetter_ortszeit((string) ($p['begin'] ?? ''));
        $ende = isset($roh['end']) && is_numeric($roh['end']) ? (int) $roh['end'] : wetter_ortszeit((string) ($p['end'] ?? ''));
        if ($typ && $stufe >= 1 && $stufe <= 3 && $start && $ende) {
            $aus[] = ['type' => $typ, 'level' => $stufe, 'start' => $start, 'end' => $ende, 'text' => trim((string) ($p['text'] ?? ''))];
        }
    }
    return $aus;
}

/** „31.10.2026 18:00“ (Wien) → Zeitstempel */
function wetter_ortszeit(string $text): ?int
{
    $d = DateTimeImmutable::createFromFormat('d.m.Y H:i', trim($text), new DateTimeZone('Europe/Vienna'));
    return $d ? $d->getTimestamp() : null;
}
