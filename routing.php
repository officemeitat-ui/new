<?php
// Google-Routing für den Mattenwechsel: Durchreicher zur Google Maps Platform (Routes API „computeRoutes“ mit
// optimierter Reihenfolge, Geocoding API). Entscheidung E8 der Geschäftsführung vom 9.11.2026; Muster ki.php.
// Der API-Schlüssel liegt nur hier am Webspace (privat/routing.json), nie im Browser und nie in SharePoint.
//
// Die App schickt das Microsoft-Token der angemeldeten Person im Kopf X-Microsoft-Token mit. routing.php prüft:
//  - das Token stammt aus dem eigenen Tenant und gehört zur eigenen App (tid, appid aus config.json) und ist echt
//    (Microsoft Graph /me antwortet; Ergebnis kurz zwischengespeichert, nur der Hashwert des Tokens). Wer den
//    Mattenwechsel planen darf, prüft die App über die Gruppen; hier genügt die Anmeldung im eigenen Tenant.
//  - Monats- und Tageslimit für alle Anfragen an Google zusammen (Vorgabe 1000 im Monat, damit es im Gratis-Kontingent
//    bleibt, und 100 am Tag); gezählt wird nur, was Google beantwortet hat.
//  - nur geprüfte Felder: Koordinaten als Zahlen im gültigen Bereich, 1 bis 25 Stopps, kurze Kennungen ohne
//    Sonderzeichen, Adresse als kurzer Text. An Google gehen nur Koordinaten bzw. die Adresse, keine Namen.
// Zurück an die App gehen nur Reihenfolge, Dauer und Strecke je Abschnitt (keine Linie der Route).
//
// Aktionen:
//   routing.php?aktion=status      (GET)  eingerichtet, Limits, Nutzung des Monats; Ende des Schlüssels nur für Vollzugriff
//   routing.php?aktion=einrichten  (POST) { schluessel?, limitMonat?, limitTag?, entfernen? } – nur Vollzugriff
//                                         (config.json → access.planners)
//   routing.php?aktion=optimize    (POST) { depot { lat, lon }, stops [{ id, lat, lon }] (1–25), keepOrder? }
//                                  → { order [id], legs [{ seconds, meters }] (Stopps + 1, ab Betriebshof), seconds, meters, nutzung }
//                                  keepOrder: true rechnet nur die Fahrzeiten einer festen Reihenfolge (ohne Optimierung)
//   routing.php?aktion=geocode     (POST) { address } → { hit { lat, lon, label, precision, partial } | null, nutzung }
// Gespeichert: privat/routing.json (Schlüssel, Limits), privat/routing-nutzung.json (Zähler je Monat und Tag),
// privat/routing-cache/ (geprüfte Anmeldungen, nur Hashwerte, eine Stunde).
// Für Tests: ROUTING_ORDNER, ROUTING_CONFIG, ROUTING_GRAPH_URL und ROUTING_GOOGLE_URL (ersetzt die Adressen
// https://routes.googleapis.com und https://maps.googleapis.com, z. B. durch eine Attrappe).

declare(strict_types=1);

const LIMIT_MONAT = 1000;
const LIMIT_TAG = 100;
const MAX_STOPPS = 25;
const MAX_ANFRAGE = 32768;
// nur, was die App braucht: optimierte Reihenfolge, Dauer und Strecke je Abschnitt
const FELDMASKE = 'routes.optimizedIntermediateWaypointIndex,routes.legs.duration,routes.legs.distanceMeters';
const SCHLUESSEL_MUSTER = '/^AIza[0-9A-Za-z_-]{35}$/';

header('Cache-Control: no-store');

function ordner(): string
{
    return getenv('ROUTING_ORDNER') ?: __DIR__ . '/privat';
}

function json_lesen(string $datei): array
{
    $d = is_file($datei) ? json_decode((string) @file_get_contents($datei), true) : null;
    return is_array($d) ? $d : [];
}

function json_schreiben(string $datei, array $daten): bool
{
    if (!is_dir(dirname($datei)) && !@mkdir(dirname($datei), 0775, true)) {
        return false;
    }
    $tmp = $datei . '.' . bin2hex(random_bytes(4)) . '.tmp';
    return @file_put_contents($tmp, json_encode($daten, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)) !== false && @rename($tmp, $datei);
}

/** Fehler wie bei ki.php: { type: 'error', error: { type, message, … } }. */
function fehler(int $status, string $typ, string $text, array $mehr = []): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['type' => 'error', 'error' => ['type' => $typ, 'message' => $text] + $mehr], JSON_UNESCAPED_UNICODE);
    exit;
}

function antwort(array $daten): void
{
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($daten, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function app_config(): array
{
    return json_lesen(getenv('ROUTING_CONFIG') ?: __DIR__ . '/config.json');
}

function einstellungen(): array
{
    return json_lesen(ordner() . '/routing.json');
}

function b64url(string $s): string
{
    return (string) base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4));
}

function heute(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('Europe/Vienna')))->format('Y-m-d');
}

function limit_monat(array $e): int
{
    return max(1, min(100000, (int) ($e['limitMonat'] ?? LIMIT_MONAT)));
}

function limit_tag(array $e): int
{
    return max(1, min(10000, (int) ($e['limitTag'] ?? LIMIT_TAG)));
}

/** Zähler mit Sperre lesen und ändern (privat/routing-nutzung.json); ohne beschreibbaren Ordner keine Anfrage an Google. */
function nutzung(callable $fn)
{
    $datei = ordner() . '/routing-nutzung.json';
    if (!is_dir(ordner())) {
        @mkdir(ordner(), 0775, true);
    }
    $h = @fopen($datei, 'c+');
    if (!$h) {
        fehler(500, 'api_error', 'Ordner privat/ ist am Webspace nicht beschreibbar: ohne Zähler gehen keine Anfragen an Google.');
    }
    flock($h, LOCK_EX);
    $d = json_decode((string) stream_get_contents($h), true);
    $d = is_array($d) ? $d : [];
    $res = $fn($d);
    ftruncate($h, 0);
    rewind($h);
    fwrite($h, json_encode($d, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    flock($h, LOCK_UN);
    fclose($h);
    return $res;
}

/** Stand der Nutzung (nur lesen): Monat, Routen, Adressen, zusammen, heute, Limits. */
function nutzung_stand(array $e, ?array $d = null): array
{
    $d = $d ?? json_lesen(ordner() . '/routing-nutzung.json');
    $tag = heute();
    $monat = substr($tag, 0, 7);
    $m = (is_array($d['monate'][$monat] ?? null) ? $d['monate'][$monat] : []) + ['routen' => 0, 'geocode' => 0];
    return [
        'monat' => $monat,
        'routen' => (int) $m['routen'],
        'geocode' => (int) $m['geocode'],
        'anfragen' => (int) $m['routen'] + (int) $m['geocode'],
        'heute' => ($d['tag'] ?? '') === $tag ? (int) ($d['heute'] ?? 0) : 0,
        'limitMonat' => limit_monat($e),
        'limitTag' => limit_tag($e),
    ];
}

/**
 * Microsoft-Token prüfen (wie ki.php): eigener Tenant, eigene App, nicht abgelaufen, von Microsoft Graph angenommen.
 * Liefert ['upn' => …, 'name' => …].
 */
function person(array $cfg): array
{
    $t = (string) ($_SERVER['HTTP_X_MICROSOFT_TOKEN'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]*$/', $t, $m)) {
        fehler(401, 'authentication_error', 'Nicht angemeldet: Bitte die App neu laden und mit Microsoft anmelden.');
    }
    $p = json_decode(b64url($m[1]), true);
    if (!is_array($p)) {
        fehler(401, 'authentication_error', 'Anmeldung ungültig.');
    }
    if ((int) ($p['exp'] ?? 0) < time()) {
        fehler(401, 'authentication_error', 'Anmeldung abgelaufen: Bitte die App neu laden.');
    }
    $tenant = strtolower((string) ($cfg['sharepoint']['tenantId'] ?? ''));
    $client = strtolower((string) ($cfg['sharepoint']['clientId'] ?? ''));
    if ($tenant === '' || strtolower((string) ($p['tid'] ?? '')) !== $tenant) {
        fehler(403, 'permission_error', 'Nur für Konten der eigenen Firma.');
    }
    if ($client !== '' && strtolower((string) ($p['appid'] ?? $p['azp'] ?? '')) !== $client) {
        fehler(403, 'permission_error', 'Token gehört nicht zu dieser App.');
    }
    // Echtheit: Graph nimmt das Token an (gefälschte Tokens fallen hier durch)
    $cache = ordner() . '/routing-cache/' . hash('sha256', $t) . '.json';
    $c = json_lesen($cache);
    if (($c['bis'] ?? 0) > time() && !empty($c['upn'])) {
        return $c;
    }
    $ch = curl_init(getenv('ROUTING_GRAPH_URL') ?: 'https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,mail,displayName');
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $t]]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $me = is_string($raw) ? json_decode($raw, true) : null;
    if ($code !== 200 || !is_array($me)) {
        fehler(401, 'authentication_error', 'Microsoft hat die Anmeldung nicht bestätigt: Bitte neu anmelden.');
    }
    $person = ['upn' => strtolower((string) ($me['userPrincipalName'] ?? $me['mail'] ?? '')), 'name' => (string) ($me['displayName'] ?? ''), 'bis' => min((int) $p['exp'], time() + 600)];
    foreach (glob(ordner() . '/routing-cache/*.json') ?: [] as $f) {
        if (filemtime($f) < time() - 3600) {
            @unlink($f);
        }
    }
    json_schreiben($cache, $person);
    return $person;
}

function ist_vollzugriff(array $cfg, string $upn): bool
{
    $planner = array_map('strtolower', array_map('strval', (array) ($cfg['access']['planners'] ?? [])));
    return $upn !== '' && in_array(strtolower($upn), $planner, true);
}

function status(array $cfg, array $person): array
{
    $e = einstellungen();
    $voll = ist_vollzugriff($cfg, $person['upn']);
    $da = !empty($e['schluessel']);
    return [
        'eingerichtet' => $da,
        'vollzugriff' => $voll,
        // vom Schlüssel nur die letzten 4 Zeichen und nur für Vollzugriff
        'schluesselEnde' => $voll && $da ? substr((string) $e['schluessel'], -4) : null,
        'limitMonat' => limit_monat($e),
        'limitTag' => limit_tag($e),
        'nutzung' => nutzung_stand($e),
        'geaendert' => $e['geaendert'] ?? null,
        'privat' => ['beschreibbar' => is_dir(ordner()) && is_writable(ordner())],
    ];
}

/** JSON-Inhalt der Anfrage (höchstens 32 KB). */
function inhalt(): array
{
    $roh = (string) file_get_contents('php://input');
    if (strlen($roh) > MAX_ANFRAGE) {
        fehler(413, 'request_too_large', 'Anfrage zu groß.');
    }
    $d = json_decode($roh, true);
    if (!is_array($d)) {
        fehler(400, 'invalid_request_error', 'JSON erwartet.');
    }
    return $d;
}

/** Koordinaten prüfen: Zahlen (keine Texte) im gültigen Bereich. */
function punkt($p, string $was): array
{
    $lat = is_array($p) ? ($p['lat'] ?? null) : null;
    $lon = is_array($p) ? ($p['lon'] ?? null) : null;
    if (!(is_int($lat) || is_float($lat)) || !(is_int($lon) || is_float($lon))) {
        fehler(400, 'invalid_request_error', "$was: Koordinaten fehlen oder sind keine Zahlen.");
    }
    if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
        fehler(400, 'invalid_request_error', "$was: Koordinaten außerhalb des gültigen Bereichs.");
    }
    return ['location' => ['latLng' => ['latitude' => (float) $lat, 'longitude' => (float) $lon]]];
}

/** Schlüssel aus Texten entfernen (Fehlermeldungen von curl oder Google). */
function ohne_schluessel(string $text, string $schluessel): string
{
    $text = $schluessel !== '' ? str_replace($schluessel, '…', $text) : $text;
    return mb_substr(preg_replace('/AIza[0-9A-Za-z_-]{10,}/', '…', $text) ?? '', 0, 160);
}

/** Anfrage an Google: [HTTP-Status, JSON oder null, curl-Fehler]. */
function google(string $url, ?array $body, array $kopf): array
{
    $ch = curl_init($url);
    $opt = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_HTTPHEADER => $kopf];
    if ($body !== null) {
        $opt[CURLOPT_POST] = true;
        $opt[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    curl_setopt_array($ch, $opt);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    $json = is_string($raw) ? json_decode($raw, true) : null;
    return [$code, is_array($json) ? $json : null, $err];
}

/** Gründe aus einer Fehlerantwort von Google (google.rpc.ErrorInfo), z. B. API_KEY_INVALID, SERVICE_DISABLED. */
function gruende(?array $j): array
{
    $out = [];
    foreach ((array) ($j['error']['details'] ?? []) as $x) {
        if (is_array($x) && is_string($x['reason'] ?? null)) {
            $out[] = $x['reason'];
        }
    }
    return $out;
}

/** Fehler von Google verständlich auf Deutsch weitergeben (ohne Schlüssel, ohne englischen Originaltext). */
function google_fehler(int $code, ?array $j, string $err, string $api, string $schluessel): void
{
    if ($code === 0) {
        fehler(502, 'google_error', 'Google nicht erreichbar: Der Webspace kommt nicht ins Internet (' . ohne_schluessel($err, $schluessel) . ').', ['google' => 'NETZ']);
    }
    $status = (string) ($j['error']['status'] ?? $j['status'] ?? '');
    $gruende = gruende($j);
    $hat = fn (string $g) => in_array($g, $gruende, true);
    if ($hat('API_KEY_INVALID') || $hat('API_KEY_EXPIRED') || $status === 'REQUEST_DENIED' && preg_match('/key/i', (string) ($j['error_message'] ?? ''))) {
        $text = 'Google lehnt den API-Schlüssel ab (ungültig oder gelöscht): im Google-Cloud-Konto einen gültigen Schlüssel erstellen und im Dialog „Routing“ eintragen.';
    } elseif ($hat('SERVICE_DISABLED') || $hat('API_DISABLED')) {
        $text = "Google: Die $api ist im Google-Cloud-Projekt nicht aktiviert (APIs und Dienste → Bibliothek).";
    } elseif ($hat('BILLING_DISABLED')) {
        $text = 'Google: Für das Google-Cloud-Projekt ist keine Abrechnung eingerichtet.';
    } elseif ($hat('API_KEY_IP_ADDRESS_BLOCKED') || $hat('API_KEY_SERVICE_BLOCKED')) {
        $text = "Google: Der Schlüssel ist für diese IP-Adresse oder für die $api gesperrt (Beschränkungen des Schlüssels prüfen).";
    } elseif ($code === 401 || $code === 403 || $status === 'PERMISSION_DENIED' || $status === 'REQUEST_DENIED') {
        $text = "Google lehnt die Anfrage ab: Schlüssel, aktivierte APIs (Routes API, Geocoding API), Abrechnung und die Beschränkung auf die IP-Adresse des Webspace im Google-Cloud-Konto prüfen.";
    } elseif ($code === 429 || $status === 'RESOURCE_EXHAUSTED' || $status === 'OVER_QUERY_LIMIT' || $status === 'OVER_DAILY_LIMIT') {
        $text = 'Google: Kontingent erschöpft (Grenze je Minute oder je Tag im Google-Cloud-Konto). Bitte später noch einmal.';
    } elseif ($code === 400 || $status === 'INVALID_ARGUMENT' || $status === 'INVALID_REQUEST') {
        $text = 'Google kann die Anfrage nicht verarbeiten (Koordinaten bzw. Adresse prüfen).';
    } elseif ($status === 'UNKNOWN_ERROR') {
        $text = 'Google antwortet gerade nicht. Bitte später noch einmal.';
    } elseif ($code >= 500) {
        $text = "Google antwortet gerade nicht (Fehler $code). Bitte später noch einmal.";
    } else {
        $text = "Google meldet einen Fehler ($code).";
    }
    fehler(502, 'google_error', $text, ['google' => $status !== '' ? $status : (string) $code]);
}

/** Anfrage vormerken (Limits prüfen, zählen); 'ok', 'monat' oder 'tag'. */
function vormerken(array $e, string $art): string
{
    return nutzung(function (array &$d) use ($e, $art) {
        $tag = heute();
        $monat = substr($tag, 0, 7);
        if (($d['tag'] ?? '') !== $tag) {
            $d['tag'] = $tag;
            $d['heute'] = 0;
        }
        $m = (is_array($d['monate'][$monat] ?? null) ? $d['monate'][$monat] : []) + ['routen' => 0, 'geocode' => 0];
        if ((int) $m['routen'] + (int) $m['geocode'] >= limit_monat($e)) {
            return 'monat';
        }
        if ((int) $d['heute'] >= limit_tag($e)) {
            return 'tag';
        }
        $m[$art] = (int) $m[$art] + 1;
        $d['heute'] = (int) $d['heute'] + 1;
        $d['monate'] = is_array($d['monate'] ?? null) ? $d['monate'] : [];
        $d['monate'][$monat] = $m;
        // nur die letzten 13 Monate behalten
        ksort($d['monate']);
        $d['monate'] = array_slice($d['monate'], -13, null, true);
        return 'ok';
    });
}

/** Vorgemerkte Anfrage zurückgeben (Google hat nicht geantwortet bzw. abgelehnt: zählt nicht). */
function zurueckgeben(string $art): void
{
    nutzung(function (array &$d) use ($art) {
        $tag = heute();
        $monat = substr($tag, 0, 7);
        if (is_array($d['monate'][$monat] ?? null)) {
            $d['monate'][$monat][$art] = max(0, (int) ($d['monate'][$monat][$art] ?? 0) - 1);
        }
        if (($d['tag'] ?? '') === $tag) {
            $d['heute'] = max(0, (int) ($d['heute'] ?? 0) - 1);
        }
    });
}

function limit_fehler(string $grund, array $e): void
{
    if ($grund === 'monat') {
        fehler(429, 'rate_limit_error', 'Monatslimit erreicht (' . limit_monat($e) . ' Anfragen an Google). Im Dialog „Routing“ erhöhen (Vollzugriff) oder bis zum nächsten Monat warten.', ['limit' => 'monat']);
    }
    fehler(429, 'rate_limit_error', 'Tageslimit erreicht (' . limit_tag($e) . ' Anfragen an Google). Morgen geht es weiter.', ['limit' => 'tag']);
}

/** Dauer von Google („523s“, „12.5s“) in ganzen Sekunden; null, wenn sie nicht so aussieht. */
function sekunden($v): ?int
{
    if (!is_string($v) || !preg_match('/^\d+(\.\d+)?s$/', $v)) {
        return null;
    }
    return (int) round((float) substr($v, 0, -1));
}

// ---------------------------------------------------------------- Ablauf

$cfg = app_config();
$aktion = (string) ($_GET['aktion'] ?? '');
$methode = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($aktion, ['status', 'einrichten', 'optimize', 'geocode'], true)) {
    fehler(404, 'not_found_error', 'Unbekannte Aktion. Erlaubt: status, einrichten, optimize, geocode.');
}
if ($aktion !== 'status' && $methode !== 'POST') {
    fehler(405, 'invalid_request_error', 'POST erwartet.');
}
$person = person($cfg);

if ($aktion === 'status') {
    antwort(status($cfg, $person));
}

if ($aktion === 'einrichten') {
    if (!ist_vollzugriff($cfg, $person['upn'])) {
        fehler(403, 'permission_error', 'Einrichten nur mit Vollzugriff (Büro, IT).');
    }
    $d = inhalt();
    $alt = einstellungen();
    $schluessel = trim((string) ($d['schluessel'] ?? ''));
    if ($schluessel !== '' && !preg_match(SCHLUESSEL_MUSTER, $schluessel)) {
        fehler(400, 'invalid_request_error', 'Der API-Schlüssel sieht nicht richtig aus (39 Zeichen, beginnt mit AIza).');
    }
    $zahl = fn ($v) => is_int($v) || (is_string($v) && preg_match('/^\d{1,6}$/', $v)) ? (int) $v : null;
    $neu = [
        'schluessel' => !empty($d['entfernen']) ? '' : ($schluessel !== '' ? $schluessel : (string) ($alt['schluessel'] ?? '')),
        'limitMonat' => max(1, min(100000, $zahl($d['limitMonat'] ?? null) ?? limit_monat($alt))),
        'limitTag' => max(1, min(10000, $zahl($d['limitTag'] ?? null) ?? limit_tag($alt))),
        'geaendert' => date('c'),
        'von' => $person['upn'],
    ];
    if ($neu['schluessel'] === '' && empty($d['entfernen'])) {
        fehler(400, 'invalid_request_error', 'Bitte den API-Schlüssel eintragen.');
    }
    if (!json_schreiben(ordner() . '/routing.json', $neu)) {
        fehler(500, 'api_error', 'Ordner privat/ ist am Webspace nicht beschreibbar.');
    }
    antwort(status($cfg, $person));
}

// optimize, geocode: nur mit Schlüssel und innerhalb der Limits
$e = einstellungen();
$schluessel = (string) ($e['schluessel'] ?? '');
if ($schluessel === '') {
    fehler(503, 'not_configured', 'Google-Routing ist am Webspace noch nicht eingerichtet (Vollzugriff: Matten-Tourenplanung → Mehr → Routing).');
}
$d = inhalt();
@set_time_limit(60);

if ($aktion === 'optimize') {
    // nur geprüfte Felder: Betriebshof und 1 bis 25 Stopps mit Kennung und Koordinaten; alles andere bleibt hier
    $depot = punkt($d['depot'] ?? null, 'Betriebshof');
    $stopps = $d['stops'] ?? null;
    if (!is_array($stopps) || count($stopps) < 1 || array_keys($stopps) !== range(0, count($stopps) - 1)) {
        fehler(400, 'invalid_request_error', 'Mindestens ein Stopp mit Koordinaten erwartet.');
    }
    if (count($stopps) > MAX_STOPPS) {
        fehler(400, 'invalid_request_error', 'Höchstens ' . MAX_STOPPS . ' Stopps je Tour (Grenze von Google).');
    }
    $ids = [];
    $zwischen = [];
    foreach ($stopps as $i => $s) {
        $id = is_array($s) ? ($s['id'] ?? null) : null;
        if (!is_string($id) || !preg_match('/^[A-Za-z0-9_.:-]{1,80}$/', $id)) {
            fehler(400, 'invalid_request_error', 'Stopp ' . ($i + 1) . ': Kennung fehlt oder enthält Sonderzeichen.');
        }
        if (in_array($id, $ids, true)) {
            fehler(400, 'invalid_request_error', "Stopp $id doppelt.");
        }
        $ids[] = $id;
        $zwischen[] = punkt($s, 'Stopp ' . ($i + 1));
    }
    $optimieren = ($d['keepOrder'] ?? false) !== true;
    $anfrage = [
        'origin' => $depot,
        'destination' => $depot,
        'intermediates' => $zwischen,
        'travelMode' => 'DRIVE',
        'routingPreference' => 'TRAFFIC_UNAWARE',
        'optimizeWaypointOrder' => $optimieren,
        'languageCode' => 'de-AT',
        'units' => 'METRIC',
    ];
    $grund = vormerken($e, 'routen');
    if ($grund !== 'ok') {
        limit_fehler($grund, $e);
    }
    $url = rtrim(getenv('ROUTING_GOOGLE_URL') ?: 'https://routes.googleapis.com', '/') . '/directions/v2:computeRoutes';
    [$code, $j, $err] = google($url, $anfrage, ['Content-Type: application/json', 'X-Goog-Api-Key: ' . $schluessel, 'X-Goog-FieldMask: ' . FELDMASKE]);
    if ($code !== 200 || $j === null) {
        zurueckgeben('routen');
        google_fehler($code === 200 ? 502 : $code, $j, $err, 'Routes API', $schluessel);
    }
    $route = is_array($j['routes'][0] ?? null) ? $j['routes'][0] : null;
    if ($route === null) {
        fehler(422, 'google_error', 'Google findet keine Route zwischen diesen Punkten (Koordinaten prüfen).', ['google' => 'KEINE_ROUTE', 'nutzung' => nutzung_stand($e)]);
    }
    $n = count($ids);
    $index = $optimieren && is_array($route['optimizedIntermediateWaypointIndex'] ?? null) ? $route['optimizedIntermediateWaypointIndex'] : range(0, $n - 1);
    $sortiert = $index;
    sort($sortiert);
    if (count($index) !== $n || $sortiert !== range(0, $n - 1)) {
        fehler(502, 'google_error', 'Antwort von Google unvollständig (Reihenfolge).', ['google' => 'ANTWORT']);
    }
    $abschnitte = is_array($route['legs'] ?? null) ? $route['legs'] : [];
    if (count($abschnitte) !== $n + 1) {
        fehler(502, 'google_error', 'Antwort von Google unvollständig (Abschnitte).', ['google' => 'ANTWORT']);
    }
    $legs = [];
    foreach ($abschnitte as $a) {
        // fehlende Felder heißen bei Google 0 (gleicher Ort)
        $s = isset($a['duration']) ? sekunden($a['duration']) : 0;
        $m = $a['distanceMeters'] ?? 0;
        if ($s === null || !is_int($m) || $m < 0) {
            fehler(502, 'google_error', 'Antwort von Google unvollständig (Dauer oder Strecke).', ['google' => 'ANTWORT']);
        }
        $legs[] = ['seconds' => $s, 'meters' => $m];
    }
    antwort([
        'order' => array_map(fn ($k) => $ids[(int) $k], $index),
        'legs' => $legs,
        'seconds' => array_sum(array_column($legs, 'seconds')),
        'meters' => array_sum(array_column($legs, 'meters')),
        'optimized' => $optimieren,
        'nutzung' => nutzung_stand($e),
    ]);
}

// geocode: eine Adresse (Text, höchstens 200 Zeichen, ohne Steuerzeichen)
$adresse = is_string($d['address'] ?? null) ? trim($d['address']) : '';
if (mb_strlen($adresse) < 3 || mb_strlen($adresse) > 200 || preg_match('/[\x00-\x1F\x7F]/', $adresse)) {
    fehler(400, 'invalid_request_error', 'Adresse fehlt oder ist zu lang (höchstens 200 Zeichen).');
}
$grund = vormerken($e, 'geocode');
if ($grund !== 'ok') {
    limit_fehler($grund, $e);
}
// Geocoding API: der Schlüssel geht als Parameter key mit (so verlangt es diese Schnittstelle), nur vom Webspace aus
$url = rtrim(getenv('ROUTING_GOOGLE_URL') ?: 'https://maps.googleapis.com', '/') . '/maps/api/geocode/json?' . http_build_query(['address' => $adresse, 'language' => 'de', 'region' => 'at', 'key' => $schluessel]);
[$code, $j, $err] = google($url, null, ['Accept: application/json']);
$st = (string) ($j['status'] ?? '');
if ($code !== 200 || $j === null || !in_array($st, ['OK', 'ZERO_RESULTS'], true)) {
    zurueckgeben('geocode');
    google_fehler($code === 200 ? ($st === 'OVER_QUERY_LIMIT' || $st === 'OVER_DAILY_LIMIT' ? 429 : ($st === 'REQUEST_DENIED' ? 403 : ($st === 'INVALID_REQUEST' ? 400 : 502))) : $code, $j, $err, 'Geocoding API', $schluessel);
}
$treffer = null;
$r = is_array($j['results'][0] ?? null) ? $j['results'][0] : null;
$lat = $r['geometry']['location']['lat'] ?? null;
$lon = $r['geometry']['location']['lng'] ?? null;
if ($st === 'OK' && (is_int($lat) || is_float($lat)) && (is_int($lon) || is_float($lon)) && abs($lat) <= 90 && abs($lon) <= 180) {
    $genau = (string) ($r['geometry']['location_type'] ?? '');
    $treffer = [
        'lat' => (float) $lat,
        'lon' => (float) $lon,
        'label' => mb_substr((string) ($r['formatted_address'] ?? ''), 0, 200),
        'precision' => in_array($genau, ['ROOFTOP', 'RANGE_INTERPOLATED', 'GEOMETRIC_CENTER', 'APPROXIMATE'], true) ? $genau : '',
        'partial' => !empty($r['partial_match']),
    ];
}
antwort(['hit' => $treffer, 'nutzung' => nutzung_stand($e)]);
