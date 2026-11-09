<?php
// KI-Assistent: Durchreicher zur Claude-API (Anthropic). Der API-Schlüssel liegt nur hier am Webspace
// (privat/ki.json), nie im Browser und nie in SharePoint.
//
// Die App ruft ki.php/v1/messages wie die Claude-API selbst auf (offizielles SDK mit baseURL ki.php) und
// schickt das Microsoft-Token der angemeldeten Person im Kopf X-Microsoft-Token mit. ki.php prüft:
//  - das Token stammt aus dem eigenen Tenant und gehört zur eigenen App (tid, appid aus config.json) und ist
//    echt (Microsoft Graph /me antwortet; Ergebnis kurz zwischengespeichert, nur der Hashwert des Tokens); keine
//    Gastkonten (B2B), außer config.json → sharepoint.allowGuests (wie die App)
//  - Tageslimit je Person und gesamt
//  - nur POST /v1/messages ohne Streaming; Modell, Aufwand und Obergrenze der Antwortlänge bestimmt der Webspace
//  - Dateien (Foto oder PDF eines Belegs, Sicherheitsdatenblatt): nur als base64 in der Anfrage (keine Links, keine
//    Files-API), nur Bilder (JPEG, PNG, GIF, WebP) und PDF, höchstens 4 je Anfrage, je höchstens 4,5 MB (base64);
//    mit Dateien darf die Anfrage bis 6 MB groß sein, ohne bis 3 MB. post_max_size des Webspace meldet der Status.
// Was der Assistent darf, entscheidet die App: Er arbeitet mit den Rechten der Person, Änderungen nur nach Bestätigung.
//
// Aktionen: ki.php?aktion=status (GET) | ki.php?aktion=einrichten (POST JSON, nur Vollzugriff laut config.json → access.planners)
// Gespeichert: privat/ki.json (Einstellungen mit Schlüssel), privat/ki-nutzung.json (Zähler, Tokens je Monat), privat/ki-cache/

declare(strict_types=1);

// Fehler nie in die Antwort (Serverpfade, Stacktraces), nur ins Fehlerprotokoll des Webspace
if (PHP_SAPI !== 'cli') {
    ini_set('display_errors', '0');
}

const MODELLE = ['claude-opus-5-5' => 'Claude Opus 5.5', 'claude-sonnet-5-5' => 'Claude Sonnet 5.5', 'claude-haiku-5-5' => 'Claude Haiku 5.5'];
const AUFWAND = ['low', 'medium', 'high'];
const MAX_TOKENS = 16000;
const MAX_ANFRAGE = 3 * 1024 * 1024;        // ohne Dateien
const MAX_ANFRAGE_DATEI = 6 * 1024 * 1024;  // mit Foto oder PDF (base64)
const MAX_DATEI = 4718592;                  // je Datei, base64 (4,5 MB ≈ 3,3 MB Datei)
const MAX_DATEIEN = 4;
const BILD_TYPEN = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
// Preise je Million Tokens in US-Dollar (Eingabe, Ausgabe, Cache lesen) für die Kostenschätzung
const PREISE = ['claude-opus-5-5' => [4.0, 20.0, 0.2], 'claude-sonnet-5-5' => [2.0, 10.0, 0.2], 'claude-haiku-5-5' => [0.1, 0.5, 0.01]];
const BETAS_ERLAUBT = '/^(server-side-fallback-2026-07-01)$/';

header('Cache-Control: no-store');

function ordner(): string
{
    return getenv('KI_ORDNER') ?: __DIR__ . '/privat';
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

/** Antwort im Fehlerformat der Claude-API (das SDK zeigt die Meldung dann lesbar an). */
function fehler(int $status, string $typ, string $text): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['type' => 'error', 'error' => ['type' => $typ, 'message' => $text]], JSON_UNESCAPED_UNICODE);
    exit;
}

function antwort(array $daten): void
{
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($daten, JSON_UNESCAPED_UNICODE);
    exit;
}

function app_config(): array
{
    return json_lesen(getenv('KI_CONFIG') ?: __DIR__ . '/config.json');
}

function einstellungen(): array
{
    return json_lesen(ordner() . '/ki.json');
}

function b64url(string $s): string
{
    return (string) base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4));
}

/** Zähler mit Sperre lesen und ändern. */
function nutzung(callable $fn)
{
    $datei = ordner() . '/ki-nutzung.json';
    $h = @fopen($datei, 'c+');
    if (!$h) {
        return $fn([]);
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

function heute(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('Europe/Vienna')))->format('Y-m-d');
}

/**
 * Microsoft-Token prüfen: eigener Tenant, eigene App, nicht abgelaufen, von Microsoft Graph angenommen.
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
    $cache = ordner() . '/ki-cache/' . hash('sha256', $t) . '.json';
    $c = json_lesen($cache);
    if (($c['bis'] ?? 0) > time() && !empty($c['upn'])) {
        return $c;
    }
    $ch = curl_init(getenv('KI_GRAPH_URL') ?: 'https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,mail,displayName,userType');
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $t]]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $me = is_string($raw) ? json_decode($raw, true) : null;
    if ($code !== 200 || !is_array($me)) {
        fehler(401, 'authentication_error', 'Microsoft hat die Anmeldung nicht bestätigt: Bitte neu anmelden.');
    }
    $person = ['upn' => strtolower((string) ($me['userPrincipalName'] ?? $me['mail'] ?? '')), 'name' => (string) ($me['displayName'] ?? ''), 'bis' => min((int) $p['exp'], time() + 600)];
    // Gastkonten (B2B) bekommen im eigenen Tenant ein echtes Token dieser App; die App weist sie ab (config.json →
    // sharepoint.allowGuests), der Durchreicher ebenso (laut Graph, nicht laut ungeprüftem Token)
    if (empty($cfg['sharepoint']['allowGuests']) && (($me['userType'] ?? '') === 'Guest' || str_contains($person['upn'], '#ext#'))) {
        fehler(403, 'permission_error', 'Gastkonten sind gesperrt: Bitte mit dem eigenen Firmenkonto anmelden.');
    }
    // alte Einträge wegräumen, neuen merken
    foreach (glob(ordner() . '/ki-cache/*.json') ?: [] as $f) {
        if (filemtime($f) < time() - 3600) {
            @unlink($f);
        }
    }
    json_schreiben($cache, $person);
    return $person;
}

/** PHP-Größenangabe („8M“, „1G“, „512K“) in Bytes; 0 = unbegrenzt bzw. unbekannt. */
function ini_bytes(string $v): int
{
    $v = trim($v);
    if ($v === '' || $v === '-1') {
        return 0;
    }
    $n = (int) $v;
    switch (strtoupper(substr($v, -1))) {
        case 'G':
            $n *= 1024;
            // weiter
        case 'M':
            $n *= 1024;
            // weiter
        case 'K':
            $n *= 1024;
    }
    return max(0, $n);
}

/**
 * Dateien in der Anfrage prüfen (auch in tool_result): nur base64, nur erlaubte Typen, Anzahl und Größe begrenzt.
 * Liefert die Zahl der Dateien; bei einem Verstoß Fehler im Format der API.
 */
function dateien_pruefen(array $messages): int
{
    $n = 0;
    $pruefe = function (array $blocks) use (&$pruefe, &$n): void {
        foreach ($blocks as $b) {
            if (!is_array($b)) {
                continue;
            }
            $typ = (string) ($b['type'] ?? '');
            if ($typ === 'tool_result' && is_array($b['content'] ?? null)) {
                $pruefe($b['content']);
                continue;
            }
            if ($typ !== 'image' && $typ !== 'document') {
                continue;
            }
            $src = is_array($b['source'] ?? null) ? $b['source'] : [];
            if (($src['type'] ?? '') !== 'base64') {
                fehler(400, 'invalid_request_error', 'Dateien nur direkt aus der App (keine Links).');
            }
            $media = (string) ($src['media_type'] ?? '');
            if ($typ === 'image' ? !in_array($media, BILD_TYPEN, true) : $media !== 'application/pdf') {
                fehler(400, 'invalid_request_error', 'Dateityp nicht erlaubt (nur Foto oder PDF).');
            }
            $data = $src['data'] ?? null;
            $ohne = is_string($data) ? rtrim($data, '=') : '';
            if ($ohne === '' || strlen($data) - strlen($ohne) > 2 || strspn($ohne, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/') !== strlen($ohne)) {
                fehler(400, 'invalid_request_error', 'Datei beschädigt.');
            }
            if (strlen($data) > MAX_DATEI) {
                fehler(413, 'request_too_large', 'Die Datei ist zu groß für die KI (höchstens etwa 3 MB). Bitte ein Foto oder nur die nötigen Seiten als PDF nehmen.');
            }
            if (++$n > MAX_DATEIEN) {
                fehler(413, 'request_too_large', 'Zu viele Dateien in einer Anfrage.');
            }
        }
    };
    foreach ($messages as $m) {
        if (is_array($m) && is_array($m['content'] ?? null)) {
            $pruefe($m['content']);
        }
    }
    return $n;
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
    $n = nutzung(fn (array &$d) => $d);
    $monat = substr(heute(), 0, 7);
    $m = ($n['monate'][$monat] ?? []) + ['anfragen' => 0, 'eingabe' => 0, 'ausgabe' => 0, 'cache' => 0, 'kosten' => 0.0];
    return [
        'eingerichtet' => !empty($e['schluessel']),
        'aktiv' => !empty($e['schluessel']) && ($e['aktiv'] ?? true) !== false,
        'modell' => $e['modell'] ?? 'claude-opus-5-5',
        'modellName' => MODELLE[$e['modell'] ?? 'claude-opus-5-5'] ?? '',
        'aufwand' => $e['aufwand'] ?? 'medium',
        'limitPerson' => (int) ($e['limitPerson'] ?? 150),
        'limitGesamt' => (int) ($e['limitGesamt'] ?? 1500),
        'heutePerson' => (int) (($n['tag'] ?? '') === heute() ? ($n['personen'][$person['upn']] ?? 0) : 0),
        'vollzugriff' => $voll,
        'schluesselEnde' => $voll && !empty($e['schluessel']) ? substr((string) $e['schluessel'], -4) : null,
        'monat' => $voll ? $m + ['monat' => $monat] : null,
        'modelle' => MODELLE,
        'php' => ['zeitlimit' => (int) ini_get('max_execution_time'), 'postMax' => ini_bytes((string) ini_get('post_max_size'))],
    ];
}

// ---------------------------------------------------------------- Ablauf

$cfg = app_config();
$aktion = (string) ($_GET['aktion'] ?? '');
$methode = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$pfad = (string) ($_SERVER['PATH_INFO'] ?? '');
if ($pfad === '' && preg_match('#/ki\.php(/[^?]*)#', (string) ($_SERVER['REQUEST_URI'] ?? ''), $mm)) {
    $pfad = $mm[1];
}

if ($aktion === 'status') {
    antwort(status($cfg, person($cfg)));
}

if ($aktion === 'einrichten') {
    if ($methode !== 'POST') {
        fehler(405, 'invalid_request_error', 'POST erwartet');
    }
    $person = person($cfg);
    if (!ist_vollzugriff($cfg, $person['upn'])) {
        fehler(403, 'permission_error', 'Einrichten nur mit Vollzugriff (Büro, IT).');
    }
    $d = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($d)) {
        fehler(400, 'invalid_request_error', 'JSON erwartet');
    }
    $alt = einstellungen();
    $schluessel = trim((string) ($d['schluessel'] ?? ''));
    if ($schluessel !== '' && !preg_match('/^sk-ant-[A-Za-z0-9_-]{20,}$/', $schluessel)) {
        fehler(400, 'invalid_request_error', 'Der API-Schlüssel sieht nicht richtig aus (beginnt mit sk-ant-).');
    }
    $neu = [
        'schluessel' => $schluessel !== '' ? $schluessel : ($alt['schluessel'] ?? ''),
        'modell' => isset(MODELLE[$d['modell'] ?? '']) ? $d['modell'] : ($alt['modell'] ?? 'claude-opus-5-5'),
        'aufwand' => in_array($d['aufwand'] ?? '', AUFWAND, true) ? $d['aufwand'] : ($alt['aufwand'] ?? 'medium'),
        'limitPerson' => max(1, min(2000, (int) ($d['limitPerson'] ?? $alt['limitPerson'] ?? 150))),
        'limitGesamt' => max(1, min(20000, (int) ($d['limitGesamt'] ?? $alt['limitGesamt'] ?? 1500))),
        'aktiv' => ($d['aktiv'] ?? true) !== false,
        'geaendert' => date('c'),
        'von' => $person['upn'],
    ];
    if ($neu['schluessel'] === '') {
        fehler(400, 'invalid_request_error', 'Bitte den API-Schlüssel eintragen.');
    }
    if (!json_schreiben(ordner() . '/ki.json', $neu)) {
        fehler(500, 'api_error', 'Ordner privat/ ist am Webspace nicht beschreibbar.');
    }
    antwort(status($cfg, $person));
}

// Durchreichen: nur POST /v1/messages
if ($pfad !== '/v1/messages' || $methode !== 'POST') {
    fehler(404, 'not_found_error', 'Nur POST ki.php/v1/messages');
}
$person = person($cfg);
$e = einstellungen();
if (empty($e['schluessel']) || ($e['aktiv'] ?? true) === false) {
    fehler(503, 'api_error', 'Der KI-Assistent ist noch nicht eingerichtet (Vollzugriff: Assistent → Einstellungen).');
}
// über post_max_size verwirft PHP den Inhalt: lieber gleich sagen, woran es liegt
$postMax = ini_bytes((string) ini_get('post_max_size'));
if ($postMax > 0 && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $postMax) {
    fehler(413, 'request_too_large', 'Die Datei ist zu groß für den Webspace (post_max_size ' . round($postMax / 1048576, 1) . ' MB). Bitte ein Foto oder nur die nötigen Seiten nehmen.');
}
$roh = (string) file_get_contents('php://input');
if (strlen($roh) > MAX_ANFRAGE_DATEI) {
    fehler(413, 'request_too_large', 'Anfrage zu groß.');
}
$body = json_decode($roh, true);
if (!is_array($body) || !is_array($body['messages'] ?? null)) {
    fehler(400, 'invalid_request_error', 'Anfrage ungültig.');
}
if (dateien_pruefen($body['messages']) === 0 && strlen($roh) > MAX_ANFRAGE) {
    fehler(413, 'request_too_large', 'Anfrage zu groß.');
}
if (!empty($body['stream'])) {
    fehler(400, 'invalid_request_error', 'Streaming wird über ki.php nicht unterstützt.');
}
// Weitergereicht wird die Anfrage als Objekte gelesen: so bleiben leere {} erhalten (Werkzeug ohne Angaben,
// Eingabe {} im Verlauf, Schema ohne Felder); als Liste gelesen würden sie zu [] und die API lehnte ab.
$senden = json_decode($roh);
// Webspace bestimmt Modell, Aufwand und Obergrenze
$modell = isset(MODELLE[$e['modell'] ?? '']) ? $e['modell'] : 'claude-opus-5-5';
$senden->model = $modell;
$senden->max_tokens = max(1, min(MAX_TOKENS, (int) ($body['max_tokens'] ?? 4096)));
$senden->output_config = (object) array_merge(is_object($senden->output_config ?? null) ? get_object_vars($senden->output_config) : [], ['effort' => in_array($e['aufwand'] ?? '', AUFWAND, true) ? $e['aufwand'] : 'medium']);
$betas = array_values(array_filter(array_map('trim', explode(',', (string) ($_SERVER['HTTP_ANTHROPIC_BETA'] ?? ''))), fn ($b) => preg_match(BETAS_ERLAUBT, $b)));
// Haiku hat keine Ausweich-Modelle
if (str_starts_with($modell, 'claude-haiku')) {
    unset($senden->fallbacks);
    $betas = array_values(array_filter($betas, fn ($b) => !str_starts_with($b, 'server-side-fallback')));
} elseif (isset($body['fallbacks']) && !in_array('server-side-fallback-2026-07-01', $betas, true)) {
    unset($senden->fallbacks);
}

// Tageslimits
$limitPerson = (int) ($e['limitPerson'] ?? 150);
$limitGesamt = (int) ($e['limitGesamt'] ?? 1500);
$erlaubt = nutzung(function (array &$d) use ($person, $limitPerson, $limitGesamt) {
    if (($d['tag'] ?? '') !== heute()) {
        $d['tag'] = heute();
        $d['personen'] = [];
        $d['gesamt'] = 0;
    }
    $n = (int) ($d['personen'][$person['upn']] ?? 0);
    if ($n >= $limitPerson) {
        return 'person';
    }
    if ((int) ($d['gesamt'] ?? 0) >= $limitGesamt) {
        return 'gesamt';
    }
    $d['personen'][$person['upn']] = $n + 1;
    $d['gesamt'] = (int) ($d['gesamt'] ?? 0) + 1;
    return 'ok';
});
if ($erlaubt !== 'ok') {
    fehler(429, 'rate_limit_error', $erlaubt === 'person' ? "Tageslimit erreicht ({$limitPerson} Anfragen je Person). Morgen geht es weiter." : 'Tageslimit der Firma erreicht. Morgen geht es weiter.');
}

@set_time_limit(180);
$url = rtrim(getenv('KI_API_URL') ?: 'https://api.anthropic.com', '/') . '/v1/messages' . (($_GET['beta'] ?? '') === 'true' ? '?beta=true' : '');
$kopf = ['Content-Type: application/json', 'x-api-key: ' . $e['schluessel'], 'anthropic-version: ' . (preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_SERVER['HTTP_ANTHROPIC_VERSION'] ?? '')) ? $_SERVER['HTTP_ANTHROPIC_VERSION'] : '2023-06-01')];
if ($betas) {
    $kopf[] = 'anthropic-beta: ' . implode(',', $betas);
}
$ch = curl_init($url);
curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($senden, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 170, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_HTTPHEADER => $kopf]);
$raw = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
curl_close($ch);
if (!is_string($raw) || $code === 0) {
    fehler(502, 'api_error', 'Claude-API nicht erreichbar: ' . $err);
}
// Verbrauch je Monat (für die Kostenschätzung in den Einstellungen)
$res = json_decode($raw, true);
if ($code === 200 && is_array($res['usage'] ?? null)) {
    $u = $res['usage'];
    nutzung(function (array &$d) use ($u, $modell) {
        $monat = substr(heute(), 0, 7);
        $m = ($d['monate'][$monat] ?? []) + ['anfragen' => 0, 'eingabe' => 0, 'ausgabe' => 0, 'cache' => 0, 'kosten' => 0.0];
        $ein = (int) ($u['input_tokens'] ?? 0) + (int) ($u['cache_creation_input_tokens'] ?? 0);
        $aus = (int) ($u['output_tokens'] ?? 0);
        $cache = (int) ($u['cache_read_input_tokens'] ?? 0);
        [$pe, $pa, $pc] = PREISE[$modell] ?? [4.0, 20.0, 0.2];
        $m['anfragen']++;
        $m['eingabe'] += $ein;
        $m['ausgabe'] += $aus;
        $m['cache'] += $cache;
        $m['kosten'] = round($m['kosten'] + ($ein * $pe + $aus * $pa + $cache * $pc) / 1e6, 4);
        $d['monate'][$monat] = $m;
        // nur die letzten 13 Monate behalten
        $d['monate'] = array_slice($d['monate'], -13, null, true);
    });
}
http_response_code($code);
header('Content-Type: application/json; charset=utf-8');
echo $raw;
