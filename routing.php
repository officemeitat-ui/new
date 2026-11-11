<?php
// Routing für den Mattenwechsel: Durchreicher zu zwei Anbietern, Muster ki.php. Entscheidung E8 der Geschäftsführung
// vom 9.11.2026 (Google), Zusatz vom 9.11.2026: OpenRouteService als kostenlose Wahl.
//  - google: Google Maps Platform (Routes API „computeRoutes“ mit optimierter Reihenfolge, Geocoding API)
//  - ors:    OpenRouteService (HeiGIT Heidelberg, auf OpenStreetMap; kostenloser Schlüssel): Optimierung (VROOM),
//            Fahrzeiten (Directions driving-car), Adresssuche (Geocode)
// Die Schlüssel liegen nur hier am Webspace (privat/routing.json, je Anbieter getrennt), nie im Browser und nie in
// SharePoint. Welcher Anbieter: Parameter anbieter=google|ors (ohne Angabe google).
//
// Die App schickt das Microsoft-Token der angemeldeten Person im Kopf X-Microsoft-Token mit. routing.php prüft:
//  - das Token stammt aus dem eigenen Tenant und gehört zur eigenen App (tid, appid aus config.json) und ist echt
//    (Microsoft Graph /me antwortet; Ergebnis kurz zwischengespeichert, nur der Hashwert des Tokens); keine Gastkonten
//    (B2B), außer config.json → sharepoint.allowGuests. Wer den Mattenwechsel planen darf, prüft die App über die
//    Gruppen; hier genügt die Anmeldung im eigenen Tenant.
//  - Monats- und Tageslimit je Anbieter für alle seine Anfragen zusammen (Google: Vorgabe 1000 im Monat, damit es im
//    Gratis-Kontingent bleibt, und 100 am Tag; OpenRouteService: 3000 im Monat, 200 am Tag); gezählt wird nur, was der
//    Anbieter beantwortet hat. Eine Anfrage ist eine Aktion der App (bei OpenRouteService eine Optimierung und die
//    Fahrzeiten dazu bzw. eine Adresssuche).
//  - nur geprüfte Felder: Koordinaten als Zahlen im gültigen Bereich, 1 bis 25 (Google) bzw. 50 (OpenRouteService)
//    Stopps, kurze Kennungen ohne Sonderzeichen, Adresse als kurzer Text; bei OpenRouteService dazu Arbeitszeit je Stopp,
//    Zeitfenster und Arbeitszeit des Fahrers (Uhrzeiten). An den Anbieter gehen nur Koordinaten bzw. die Adresse und
//    diese Zeiten, keine Namen und keine Kennungen.
// Zurück an die App gehen nur Reihenfolge, Dauer und Strecke je Abschnitt (keine Linie der Route), bei beiden
// Anbietern im selben Format.
//
// Aktionen (anbieter=google|ors, ohne Angabe google):
//   routing.php?aktion=status      (GET)  eingerichtet, Limits, Nutzung des Monats; Ende des Schlüssels nur für Vollzugriff
//   routing.php?aktion=einrichten  (POST) { schluessel?, limitMonat?, limitTag?, entfernen? } – nur Vollzugriff
//                                         (config.json → access.planners)
//   routing.php?aktion=optimize    (POST) { depot { lat, lon }, stops [{ id, lat, lon }] (1–25 bzw. 1–50), keepOrder? }
//                                  → { order [id], legs [{ seconds, meters }] (Stopps + 1, ab Betriebshof), seconds, meters,
//                                      optimized, nutzung }
//                                  keepOrder: true rechnet nur die Fahrzeiten einer festen Reihenfolge (ohne Optimierung)
//                                  nur ors: stops[].minutes (Arbeit), stops[].window { from, to } ('HH:MM' oder ''),
//                                  shift { from, to } (Arbeitszeit), baseMin (Zuschlag je Fahrt in Minuten); hält die
//                                  Optimierung nicht alle Zeitfenster ein, gilt die Reihenfolge der App (optimized false)
//   routing.php?aktion=geocode     (POST) { address } → { hit | null, nutzung }
//                                  google: hit { lat, lon, label, precision, partial }
//                                  ors:    hit { lat, lon, precision, partial } (zuerst in Österreich, sonst ohne Grenze)
// Gespeichert: privat/routing.json (Google: Schlüssel, Limits oben; OpenRouteService unter „ors“),
// privat/routing-nutzung.json (Zähler je Monat und Tag; OpenRouteService unter „ors“), privat/routing-cache/
// (geprüfte Anmeldungen, nur Hashwerte, eine Stunde).
// Für Tests: ROUTING_ORDNER, ROUTING_CONFIG, ROUTING_GRAPH_URL, ROUTING_GRAPH_GRUPPEN_URL, ROUTING_GOOGLE_URL (ersetzt die Adressen
// https://routes.googleapis.com und https://maps.googleapis.com, z. B. durch eine Attrappe) und ROUTING_ORS_URL
// (ersetzt https://api.openrouteservice.org).

declare(strict_types=1);

// Fehler nie in die Antwort (Serverpfade, Stacktraces), nur ins Fehlerprotokoll des Webspace
if (PHP_SAPI !== 'cli') {
    ini_set('display_errors', '0');
}

const LIMIT_MONAT = 1000;
const LIMIT_TAG = 100;
const MAX_STOPPS = 25;
const MAX_ANFRAGE = 32768;
// nur, was die App braucht: optimierte Reihenfolge, Dauer und Strecke je Abschnitt
const FELDMASKE = 'routes.optimizedIntermediateWaypointIndex,routes.legs.duration,routes.legs.distanceMeters';
const SCHLUESSEL_MUSTER = '/^AIza[0-9A-Za-z_-]{35}$/';
// OpenRouteService: eigener Schlüssel, eigene Limits (das Gratis-Kontingent laut Anbieter liegt deutlich darüber)
const ANBIETER = ['google' => 'Google', 'ors' => 'OpenRouteService'];
const LIMIT_MONAT_ORS = 3000;
const LIMIT_TAG_ORS = 200;
const MAX_STOPPS_ORS = 50;
// Wegpunkte je Anfrage an die Fahrzeiten (Directions); bei mehr in Teilen
const ORS_WEGPUNKTE = 50;
// alte Schlüssel: 56 Hex-Zeichen; neue: Base64-Text (beginnt mit eyJ)
const ORS_SCHLUESSEL_MUSTER = '/^[A-Za-z0-9+\/=_-]{40,200}$/';

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

/** Einstellungen eines Anbieters: Google oben in routing.json (wie bisher), OpenRouteService unter „ors“. */
function einstellungen(string $a = 'google'): array
{
    $alle = json_lesen(ordner() . '/routing.json');
    if ($a === 'google') {
        unset($alle['ors']);
        return $alle;
    }
    return is_array($alle[$a] ?? null) ? $alle[$a] : [];
}

/** Einstellungen eines Anbieters speichern; die des anderen bleiben. */
function speichern(string $a, array $neu): bool
{
    $alle = json_lesen(ordner() . '/routing.json');
    if ($a === 'google') {
        $alle = $neu + (is_array($alle['ors'] ?? null) ? ['ors' => $alle['ors']] : []);
    } else {
        $alle[$a] = $neu;
    }
    return json_schreiben(ordner() . '/routing.json', $alle);
}

function b64url(string $s): string
{
    return (string) base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4));
}

function heute(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('Europe/Vienna')))->format('Y-m-d');
}

function limit_monat(array $e, string $a = 'google'): int
{
    return max(1, min(100000, (int) ($e['limitMonat'] ?? ($a === 'ors' ? LIMIT_MONAT_ORS : LIMIT_MONAT))));
}

function limit_tag(array $e, string $a = 'google'): int
{
    return max(1, min(10000, (int) ($e['limitTag'] ?? ($a === 'ors' ? LIMIT_TAG_ORS : LIMIT_TAG))));
}

/** Zähler eines Anbieters (Google oben in der Datei wie bisher, OpenRouteService unter „ors“). */
function zaehler(array $d, string $a): array
{
    return $a === 'google' ? $d : (is_array($d[$a] ?? null) ? $d[$a] : []);
}

/**
 * Zähler mit Sperre lesen und ändern (privat/routing-nutzung.json, je Anbieter); ohne beschreibbaren Ordner keine
 * Anfrage an den Anbieter.
 */
function nutzung(callable $fn, string $a = 'google')
{
    $datei = ordner() . '/routing-nutzung.json';
    if (!is_dir(ordner())) {
        @mkdir(ordner(), 0775, true);
    }
    $h = @fopen($datei, 'c+');
    if (!$h) {
        fehler(500, 'api_error', 'Ordner privat/ ist am Webspace nicht beschreibbar: ohne Zähler gehen keine Anfragen an ' . ANBIETER[$a] . '.');
    }
    flock($h, LOCK_EX);
    $d = json_decode((string) stream_get_contents($h), true);
    $d = is_array($d) ? $d : [];
    if ($a === 'google') {
        $res = $fn($d);
    } else {
        $z = zaehler($d, $a);
        $res = $fn($z);
        $d[$a] = $z;
    }
    ftruncate($h, 0);
    rewind($h);
    fwrite($h, json_encode($d, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    flock($h, LOCK_UN);
    fclose($h);
    return $res;
}

/** Stand der Nutzung (nur lesen): Monat, Routen, Adressen, zusammen, heute, Limits. */
function nutzung_stand(array $e, ?array $d = null, string $a = 'google'): array
{
    $d = zaehler($d ?? json_lesen(ordner() . '/routing-nutzung.json'), $a);
    $tag = heute();
    $monat = substr($tag, 0, 7);
    $m = (is_array($d['monate'][$monat] ?? null) ? $d['monate'][$monat] : []) + ['routen' => 0, 'geocode' => 0];
    return [
        'monat' => $monat,
        'routen' => (int) $m['routen'],
        'geocode' => (int) $m['geocode'],
        'anfragen' => (int) $m['routen'] + (int) $m['geocode'],
        'heute' => ($d['tag'] ?? '') === $tag ? (int) ($d['heute'] ?? 0) : 0,
        'limitMonat' => limit_monat($e, $a),
        'limitTag' => limit_tag($e, $a),
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
    if (($c['bis'] ?? 0) > time() && !empty($c['upn']) && is_bool($c['rolle'] ?? null)) {
        return $c;
    }
    $ch = curl_init(getenv('ROUTING_GRAPH_URL') ?: 'https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,mail,displayName,userType');
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
    $person['rolle'] = hat_rolle($cfg, $person['upn'], $t, getenv('ROUTING_GRAPH_GRUPPEN_URL') ?: 'https://graph.microsoft.com/v1.0/me/transitiveMemberOf?$select=id&$top=999');
    foreach (glob(ordner() . '/routing-cache/*.json') ?: [] as $f) {
        if (filemtime($f) < time() - 3600) {
            @unlink($f);
        }
    }
    if ($person['rolle'] !== null) {
        json_schreiben($cache, $person);
    }
    return $person;
}

/**
 * Hat die Person eine Rolle in der App? Wie die App im Betrieb (core/access.js): E-Mail in access.planners bzw.
 * access.members oder Mitglied (auch verschachtelt) einer Gruppe aus access.groups – laut Microsoft Graph
 * (/me/transitiveMemberOf, dafür reicht User.Read). Wichtig, wenn in Entra „Zuweisung erforderlich“ aus ist: Dann
 * kommt jedes Firmenkonto bis hierher. Ist access ohne Personen und Gruppen, gilt wie bisher jedes Firmenkonto.
 * → true | false | null (Graph gerade nicht erreichbar)
 */
function hat_rolle(array $cfg, string $upn, string $token, string $gruppenUrl): ?bool
{
    $a = is_array($cfg['access'] ?? null) ? $cfg['access'] : [];
    $mails = [];
    $listen = [(array) ($a['planners'] ?? [])];
    foreach ((array) ($a['members'] ?? []) as $liste) {
        $listen[] = (array) $liste;
    }
    foreach ($listen as $liste) {
        foreach ($liste as $e) {
            $e = strtolower(trim((string) $e));
            if ($e !== '') {
                $mails[$e] = true;
            }
        }
    }
    $gruppen = [];
    foreach ((array) ($a['groups'] ?? []) as $liste) {
        foreach ((array) $liste as $g) {
            $g = strtolower(trim((string) $g));
            if ($g !== '') {
                $gruppen[$g] = true;
            }
        }
    }
    if (!$mails && !$gruppen) {
        return true;
    }
    if ($upn !== '' && isset($mails[strtolower($upn)])) {
        return true;
    }
    if (!$gruppen) {
        return false;
    }
    $port = parse_url($gruppenUrl, PHP_URL_PORT);
    $host = (string) parse_url($gruppenUrl, PHP_URL_SCHEME) . '://' . (string) parse_url($gruppenUrl, PHP_URL_HOST) . ($port ? ':' . $port : '') . '/';
    $url = $gruppenUrl;
    for ($seite = 0; $url !== '' && $seite < 20; $seite++) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token]]);
        $raw = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $d = is_string($raw) ? json_decode($raw, true) : null;
        if ($code !== 200 || !is_array($d)) {
            return null;
        }
        foreach ((array) ($d['value'] ?? []) as $o) {
            if (is_array($o) && isset($gruppen[strtolower((string) ($o['id'] ?? ''))])) {
                return true;
            }
        }
        // weiter nur bei Microsoft Graph selbst (dieselbe Adresse wie die erste Seite)
        $naechste = $d['@odata.nextLink'] ?? '';
        $url = is_string($naechste) && str_starts_with($naechste, $host) ? $naechste : '';
    }
    return false;
}

function ist_vollzugriff(array $cfg, string $upn): bool
{
    $planner = array_map('strtolower', array_map('strval', (array) ($cfg['access']['planners'] ?? [])));
    return $upn !== '' && in_array(strtolower($upn), $planner, true);
}

function status(array $cfg, array $person, string $a = 'google'): array
{
    $e = einstellungen($a);
    $voll = ist_vollzugriff($cfg, $person['upn']);
    $da = !empty($e['schluessel']);
    return [
        'anbieter' => $a,
        'eingerichtet' => $da,
        'vollzugriff' => $voll,
        // vom Schlüssel nur die letzten 4 Zeichen und nur für Vollzugriff
        'schluesselEnde' => $voll && $da ? substr((string) $e['schluessel'], -4) : null,
        'limitMonat' => limit_monat($e, $a),
        'limitTag' => limit_tag($e, $a),
        'nutzung' => nutzung_stand($e, null, $a),
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

/** Koordinaten prüfen: Zahlen (keine Texte) im gültigen Bereich → [lat, lon]. */
function koordinaten($p, string $was): array
{
    $lat = is_array($p) ? ($p['lat'] ?? null) : null;
    $lon = is_array($p) ? ($p['lon'] ?? null) : null;
    if (!(is_int($lat) || is_float($lat)) || !(is_int($lon) || is_float($lon))) {
        fehler(400, 'invalid_request_error', "$was: Koordinaten fehlen oder sind keine Zahlen.");
    }
    if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
        fehler(400, 'invalid_request_error', "$was: Koordinaten außerhalb des gültigen Bereichs.");
    }
    return [(float) $lat, (float) $lon];
}

/** Koordinaten für Google (Routes API). */
function punkt($p, string $was): array
{
    [$lat, $lon] = koordinaten($p, $was);
    return ['location' => ['latLng' => ['latitude' => $lat, 'longitude' => $lon]]];
}

/** Kennungen der Stopps prüfen (Text ohne Sonderzeichen, keine doppelten) → Liste der Kennungen. */
function kennungen($stopps, int $max, string $grenze): array
{
    if (!is_array($stopps) || count($stopps) < 1 || array_keys($stopps) !== range(0, count($stopps) - 1)) {
        fehler(400, 'invalid_request_error', 'Mindestens ein Stopp mit Koordinaten erwartet.');
    }
    if (count($stopps) > $max) {
        fehler(400, 'invalid_request_error', 'Höchstens ' . $max . " Stopps je Tour ($grenze).");
    }
    $ids = [];
    foreach ($stopps as $i => $s) {
        $id = is_array($s) ? ($s['id'] ?? null) : null;
        if (!is_string($id) || !preg_match('/^[A-Za-z0-9_.:-]{1,80}$/', $id)) {
            fehler(400, 'invalid_request_error', 'Stopp ' . ($i + 1) . ': Kennung fehlt oder enthält Sonderzeichen.');
        }
        if (in_array($id, $ids, true)) {
            fehler(400, 'invalid_request_error', "Stopp $id doppelt.");
        }
        $ids[] = $id;
    }
    return $ids;
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
    return anfrage($url, $body, $kopf);
}

/** Anfrage an einen Anbieter mit curl: [HTTP-Status, JSON oder null, curl-Fehler]. */
function anfrage(string $url, ?array $body, array $kopf): array
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
function vormerken(array $e, string $art, string $a = 'google'): string
{
    return nutzung(function (array &$d) use ($e, $art, $a) {
        $tag = heute();
        $monat = substr($tag, 0, 7);
        if (($d['tag'] ?? '') !== $tag) {
            $d['tag'] = $tag;
            $d['heute'] = 0;
        }
        $m = (is_array($d['monate'][$monat] ?? null) ? $d['monate'][$monat] : []) + ['routen' => 0, 'geocode' => 0];
        if ((int) $m['routen'] + (int) $m['geocode'] >= limit_monat($e, $a)) {
            return 'monat';
        }
        if ((int) $d['heute'] >= limit_tag($e, $a)) {
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
    }, $a);
}

/** Vorgemerkte Anfrage zurückgeben (der Anbieter hat nicht geantwortet bzw. abgelehnt: zählt nicht). */
function zurueckgeben(string $art, string $a = 'google'): void
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
    }, $a);
}

function limit_fehler(string $grund, array $e, string $a = 'google'): void
{
    $wer = ANBIETER[$a];
    if ($grund === 'monat') {
        fehler(429, 'rate_limit_error', 'Monatslimit erreicht (' . limit_monat($e, $a) . " Anfragen an $wer). Im Dialog „Routing“ erhöhen (Vollzugriff) oder bis zum nächsten Monat warten.", ['limit' => 'monat']);
    }
    fehler(429, 'rate_limit_error', 'Tageslimit erreicht (' . limit_tag($e, $a) . " Anfragen an $wer). Morgen geht es weiter.", ['limit' => 'tag']);
}

/** Dauer von Google („523s“, „12.5s“) in ganzen Sekunden; null, wenn sie nicht so aussieht. */
function sekunden($v): ?int
{
    if (!is_string($v) || !preg_match('/^\d+(\.\d+)?s$/', $v)) {
        return null;
    }
    return (int) round((float) substr($v, 0, -1));
}

/** Adresse für geocode: Text, 3 bis 200 Zeichen, ohne Steuerzeichen. */
function adresse(array $d): string
{
    $adresse = is_string($d['address'] ?? null) ? trim($d['address']) : '';
    if (mb_strlen($adresse) < 3 || mb_strlen($adresse) > 200 || preg_match('/[\x00-\x1F\x7F]/', $adresse)) {
        fehler(400, 'invalid_request_error', 'Adresse fehlt oder ist zu lang (höchstens 200 Zeichen).');
    }
    return $adresse;
}

// ---------------------------------------------------------------- OpenRouteService

/** Anfrage an OpenRouteService (Basis-Adresse für Tests über ROUTING_ORS_URL), Schlüssel im Kopf Authorization. */
function ors(string $pfad, ?array $body, string $schluessel, array $abfrage = []): array
{
    $url = rtrim(getenv('ROUTING_ORS_URL') ?: 'https://api.openrouteservice.org', '/') . $pfad . ($abfrage ? '?' . http_build_query($abfrage) : '');
    $kopf = ['Accept: application/json', 'Authorization: ' . $schluessel];
    if ($body !== null) {
        $kopf[] = 'Content-Type: application/json; charset=utf-8';
    }
    return anfrage($url, $body, $kopf);
}

/** Text und Fehlernummer aus einer Fehlerantwort von OpenRouteService (Directions, VROOM, Geocode, Zugang). */
function ors_meldung(?array $j): array
{
    $e = $j['error'] ?? null;
    $text = is_array($e) ? (string) ($e['message'] ?? '') : (is_string($e) ? $e : (string) ($j['message'] ?? ''));
    $nr = is_array($e) ? (int) ($e['code'] ?? 0) : (int) ($j['code'] ?? 0);
    return [$text, $nr];
}

/** Keine Route bzw. kein befahrbarer Punkt in der Nähe (OpenRouteService hat geantwortet: zählt wie bei Google). */
function ors_keine_route(int $code, ?array $j, bool $optimierung = false): bool
{
    [, $nr] = ors_meldung($j);
    // Directions: 2009 keine Route, 2010 kein befahrbarer Punkt, 2004 Strecke zu lang; VROOM: 3 Routing-Fehler
    return in_array($nr, [2004, 2009, 2010], true) || ($optimierung && $nr === 3 && $code >= 400);
}

/** Fehler von OpenRouteService verständlich auf Deutsch weitergeben (ohne Schlüssel, ohne englischen Originaltext). */
function ors_fehler(int $code, ?array $j, string $err, string $dienst, string $schluessel, bool $optimierung = false): void
{
    if ($code === 0) {
        fehler(502, 'ors_error', 'OpenRouteService nicht erreichbar: Der Webspace kommt nicht ins Internet (' . ohne_schluessel($err, $schluessel) . ').', ['ors' => 'NETZ']);
    }
    [$text, $nr] = ors_meldung($j);
    $kontingent = preg_match('/quota|daily|limit reached/i', $text) === 1;
    if (ors_keine_route($code, $j, $optimierung)) {
        $status = 422;
        $kennung = 'KEINE_ROUTE';
        $deutsch = $nr === 2010
            ? 'OpenRouteService findet bei einem Stopp keine befahrbare Straße in der Nähe (Koordinaten am Liegeplatz prüfen).'
            : ($nr === 2004 ? 'OpenRouteService: Die Strecke ist zu lang (Koordinaten prüfen).' : 'OpenRouteService findet keine Route zwischen diesen Punkten (Koordinaten prüfen).');
    } elseif ($kontingent) {
        $status = 502;
        $kennung = 'KONTINGENT';
        $deutsch = "Tageskontingent von OpenRouteService erschöpft ($dienst, Gratis-Plan). Morgen geht es weiter; bis dahin rechnet der eingebaute Anbieter.";
    } elseif ($code === 429) {
        $status = 502;
        $kennung = 'MINUTE';
        $deutsch = 'OpenRouteService: zu viele Anfragen in kurzer Zeit (Grenze je Minute). Bitte gleich noch einmal.';
    } elseif ($code === 401 || $code === 403) {
        $status = 502;
        $kennung = 'SCHLUESSEL';
        $deutsch = 'OpenRouteService lehnt den Schlüssel ab (ungültig, gesperrt oder für diesen Dienst nicht freigeschaltet): auf openrouteservice.org im Dashboard prüfen und im Dialog „Routing“ neu eintragen.';
    } elseif ($code === 413) {
        $status = 502;
        $kennung = 'GROESSE';
        $deutsch = 'OpenRouteService: zu viele Stopps in einer Anfrage.';
    } elseif ($code === 400 || $code === 404) {
        $status = 502;
        $kennung = 'ANFRAGE';
        $deutsch = 'OpenRouteService kann die Anfrage nicht verarbeiten (Koordinaten bzw. Zeiten prüfen).';
    } elseif ($code >= 500) {
        $status = 502;
        $kennung = 'DIENST';
        $deutsch = "OpenRouteService antwortet gerade nicht (Fehler $code). Bitte später noch einmal.";
    } else {
        $status = 502;
        $kennung = 'ANTWORT';
        $deutsch = "OpenRouteService meldet einen Fehler ($code).";
    }
    fehler($status, 'ors_error', $deutsch, ['ors' => $kennung]);
}

/** Uhrzeit „HH:MM“ → Sekunden ab Mitternacht; '' bzw. fehlend → null; sonst 400. */
function uhrzeit($v, string $was): ?int
{
    if ($v === null || $v === '') {
        return null;
    }
    if (!is_string($v) || !preg_match('/^([01]\d|2[0-3]):([0-5]\d)$/', $v, $m)) {
        fehler(400, 'invalid_request_error', "$was: Uhrzeit als HH:MM erwartet.");
    }
    return (int) $m[1] * 3600 + (int) $m[2] * 60;
}

/** Zahl im Bereich (Minuten) → Sekunden; fehlend → 0; sonst 400. */
function minuten($v, int $max, string $was): int
{
    if ($v === null) {
        return 0;
    }
    if (!(is_int($v) || is_float($v)) || $v < 0 || $v > $max) {
        fehler(400, 'invalid_request_error', "$was: Minuten als Zahl von 0 bis $max erwartet.");
    }
    return (int) round($v * 60);
}

/** Fahrzeiten einer festen Reihenfolge [[lon, lat], …] (Directions driving-car, ab 51 Punkten in Teilen) → legs. */
function ors_fahrzeiten(array $punkte, string $schluessel): array
{
    $legs = [];
    for ($i = 0; $i < count($punkte) - 1; $i += ORS_WEGPUNKTE - 1) {
        $teil = array_slice($punkte, $i, ORS_WEGPUNKTE);
        // instructions: die Abschnitte (segments) kommen nur mit; keine Linie der Route (geometry false)
        [$code, $j, $err] = ors('/v2/directions/driving-car', ['coordinates' => $teil, 'instructions' => true, 'geometry' => false, 'units' => 'm', 'preference' => 'fastest'], $schluessel);
        if ($code !== 200 || $j === null) {
            return ['fehler' => [$code === 200 ? 502 : $code, $j, $err]];
        }
        $abschnitte = $j['routes'][0]['segments'] ?? null;
        if (!is_array($abschnitte) || count($abschnitte) !== count($teil) - 1) {
            fehler(502, 'ors_error', 'Antwort von OpenRouteService unvollständig (Abschnitte).', ['ors' => 'ANTWORT']);
        }
        foreach ($abschnitte as $a) {
            $s = $a['duration'] ?? 0;
            $m = $a['distance'] ?? 0;
            if (!(is_int($s) || is_float($s)) || !(is_int($m) || is_float($m)) || $s < 0 || $m < 0) {
                fehler(502, 'ors_error', 'Antwort von OpenRouteService unvollständig (Dauer oder Strecke).', ['ors' => 'ANTWORT']);
            }
            $legs[] = ['seconds' => (int) round($s), 'meters' => (int) round($m)];
        }
    }
    return ['legs' => $legs];
}

/**
 * optimize mit OpenRouteService: Optimierung (VROOM, ein Fahrzeug mit Start und Ende am Betriebshof und der Arbeitszeit,
 * je Stopp ein Job mit Arbeitszeit und Zeitfenster), danach Fahrzeiten der Reihenfolge (Directions). Hält die
 * Optimierung nicht alle Zeitfenster ein (Stopps übrig), gilt die Reihenfolge der App (optimized false).
 */
function ors_optimize(array $d, array $e, string $schluessel): void
{
    [$dLat, $dLon] = koordinaten($d['depot'] ?? null, 'Betriebshof');
    $stopps = $d['stops'] ?? null;
    $ids = kennungen($stopps, MAX_STOPPS_ORS, 'Grenze für OpenRouteService');
    $optimieren = ($d['keepOrder'] ?? false) !== true;
    $orte = [];
    $jobs = [];
    $zuschlag = minuten($d['baseMin'] ?? null, 60, 'Zuschlag je Fahrt');
    $schicht = is_array($d['shift'] ?? null) ? $d['shift'] : [];
    $start = uhrzeit($schicht['from'] ?? null, 'Arbeitszeit');
    $ende = uhrzeit($schicht['to'] ?? null, 'Arbeitszeit');
    foreach ($stopps as $i => $s) {
        $was = 'Stopp ' . ($i + 1);
        [$lat, $lon] = koordinaten($s, $was);
        $orte[] = [$lon, $lat];
        $arbeit = minuten($s['minutes'] ?? null, 600, $was);
        $fenster = is_array($s['window'] ?? null) ? $s['window'] : [];
        $von = uhrzeit($fenster['from'] ?? null, $was);
        $bis = uhrzeit($fenster['to'] ?? null, $was);
        // Zeitfenster wie in der App: Beginn ab „von“, fertig bis „bis“ (VROOM: Beginn spätestens bis − Arbeit)
        $job = ['id' => $i + 1, 'location' => [$lon, $lat], 'service' => $arbeit];
        if ($zuschlag > 0) {
            $job['setup'] = $zuschlag;
        }
        if ($von !== null || $bis !== null) {
            $a = $von ?? 0;
            $job['time_windows'] = [[$a, max($a, $bis !== null ? $bis - $arbeit : 172800)]];
        }
        $jobs[] = $job;
    }
    $grund = vormerken($e, 'routen', 'ors');
    if ($grund !== 'ok') {
        limit_fehler($grund, $e, 'ors');
    }
    $n = count($ids);
    $folge = range(0, $n - 1);
    $optimiert = $optimieren;
    if ($optimieren && $n > 1) {
        $fahrzeug = ['id' => 1, 'profile' => 'driving-car', 'start' => [$dLon, $dLat], 'end' => [$dLon, $dLat]];
        if ($start !== null || $ende !== null) {
            $fahrzeug['time_window'] = [$start ?? 0, max($start ?? 0, $ende ?? 172800)];
        }
        [$code, $j, $err] = ors('/optimization', ['jobs' => $jobs, 'vehicles' => [$fahrzeug]], $schluessel);
        if ($code !== 200 || $j === null || (int) ($j['code'] ?? 0) !== 0) {
            $code = $code === 200 ? 502 : $code;
            if (!ors_keine_route($code, $j, true)) {
                zurueckgeben('routen', 'ors');
            }
            ors_fehler($code, $j, $err, 'Optimierung', $schluessel, true);
        }
        $neu = [];
        foreach ((array) ($j['routes'][0]['steps'] ?? []) as $schritt) {
            if (is_array($schritt) && ($schritt['type'] ?? '') === 'job') {
                $k = (int) ($schritt['id'] ?? ($schritt['job'] ?? 0)) - 1;
                if ($k < 0 || $k >= $n || in_array($k, $neu, true)) {
                    fehler(502, 'ors_error', 'Antwort von OpenRouteService unvollständig (Reihenfolge).', ['ors' => 'ANTWORT']);
                }
                $neu[] = $k;
            }
        }
        if (count($neu) === $n) {
            $folge = $neu;
        } else {
            // nicht alle Stopps eingeplant (Zeitfenster bzw. Arbeitszeit mit echten Fahrzeiten): Reihenfolge der App
            $optimiert = false;
        }
    }
    $punkte = array_merge([[$dLon, $dLat]], array_map(fn ($k) => $orte[$k], $folge), [[$dLon, $dLat]]);
    $r = ors_fahrzeiten($punkte, $schluessel);
    if (isset($r['fehler'])) {
        [$code, $j, $err] = $r['fehler'];
        if (!ors_keine_route($code, $j)) {
            zurueckgeben('routen', 'ors');
        }
        ors_fehler($code, $j, $err, 'Fahrzeiten', $schluessel);
    }
    $legs = $r['legs'];
    antwort([
        'order' => array_map(fn ($k) => $ids[$k], $folge),
        'legs' => $legs,
        'seconds' => array_sum(array_column($legs, 'seconds')),
        'meters' => array_sum(array_column($legs, 'meters')),
        'optimized' => $optimiert,
        'nutzung' => nutzung_stand($e, null, 'ors'),
    ]);
}

/** Genauigkeit eines Treffers der Adresssuche (Pelias): hausnummer | interpoliert | strasse | ort. */
function ors_genauigkeit(array $p): string
{
    $ebene = (string) ($p['layer'] ?? '');
    $art = (string) ($p['match_type'] ?? '');
    if ($ebene === 'address' || $ebene === 'venue') {
        return $art === 'interpolated' ? 'interpoliert' : 'hausnummer';
    }
    return $ebene === 'street' ? 'strasse' : 'ort';
}

/** geocode mit OpenRouteService: zuerst in Österreich (boundary.country=AT), ohne Treffer ohne Grenze. */
function ors_geocode(string $adresse, array $e, string $schluessel): void
{
    $grund = vormerken($e, 'geocode', 'ors');
    if ($grund !== 'ok') {
        limit_fehler($grund, $e, 'ors');
    }
    $f = null;
    foreach ([['boundary.country' => 'AT'], []] as $grenze) {
        [$code, $j, $err] = ors('/geocode/search', null, $schluessel, ['text' => $adresse, 'size' => 1] + $grenze);
        if ($code !== 200 || $j === null) {
            zurueckgeben('geocode', 'ors');
            ors_fehler($code === 200 ? 502 : $code, $j, $err, 'Adresssuche', $schluessel);
        }
        $f = is_array($j['features'][0] ?? null) ? $j['features'][0] : null;
        if ($f !== null) {
            break;
        }
    }
    $treffer = null;
    $lon = $f['geometry']['coordinates'][0] ?? null;
    $lat = $f['geometry']['coordinates'][1] ?? null;
    if ((is_int($lat) || is_float($lat)) && (is_int($lon) || is_float($lon)) && abs($lat) <= 90 && abs($lon) <= 180) {
        $p = is_array($f['properties'] ?? null) ? $f['properties'] : [];
        // nur Koordinaten und Genauigkeit (keine Adresse, keine Kennungen von OpenStreetMap)
        $treffer = [
            'lat' => (float) $lat,
            'lon' => (float) $lon,
            'precision' => ors_genauigkeit($p),
            'partial' => ($p['match_type'] ?? '') === 'fallback' || (is_numeric($p['confidence'] ?? null) && (float) $p['confidence'] < 0.6),
        ];
    }
    antwort(['hit' => $treffer, 'nutzung' => nutzung_stand($e, null, 'ors')]);
}

// ---------------------------------------------------------------- Ablauf

$cfg = app_config();
$aktion = (string) ($_GET['aktion'] ?? '');
$methode = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($aktion, ['status', 'einrichten', 'optimize', 'geocode'], true)) {
    fehler(404, 'not_found_error', 'Unbekannte Aktion. Erlaubt: status, einrichten, optimize, geocode.');
}
$anbieter = $_GET['anbieter'] ?? 'google';
if (!is_string($anbieter) || !isset(ANBIETER[$anbieter])) {
    fehler(404, 'not_found_error', 'Unbekannter Anbieter. Erlaubt: google, ors.');
}
if ($aktion !== 'status' && $methode !== 'POST') {
    fehler(405, 'invalid_request_error', 'POST erwartet.');
}
$person = person($cfg);
if ($aktion !== 'status' && $aktion !== 'einrichten' && $person['rolle'] !== true) {
    if ($person['rolle'] === null) {
        fehler(503, 'api_error', 'Die Rolle in der App ließ sich gerade nicht prüfen (Microsoft Graph). Bitte gleich noch einmal versuchen.');
    }
    fehler(403, 'permission_error', 'Routing nur für Personen mit einer Rolle in der App (Gruppe bzw. E-Mail in config.json → access).');
}

if ($aktion === 'status') {
    antwort(status($cfg, $person, $anbieter));
}

if ($aktion === 'einrichten') {
    if (!ist_vollzugriff($cfg, $person['upn'])) {
        fehler(403, 'permission_error', 'Einrichten nur mit Vollzugriff (Büro, IT).');
    }
    $d = inhalt();
    $alt = einstellungen($anbieter);
    $schluessel = trim((string) ($d['schluessel'] ?? ''));
    if ($schluessel !== '' && $anbieter === 'google' && !preg_match(SCHLUESSEL_MUSTER, $schluessel)) {
        fehler(400, 'invalid_request_error', 'Der API-Schlüssel sieht nicht richtig aus (39 Zeichen, beginnt mit AIza).');
    }
    if ($schluessel !== '' && $anbieter === 'ors' && !preg_match(ORS_SCHLUESSEL_MUSTER, $schluessel)) {
        fehler(400, 'invalid_request_error', 'Der Schlüssel von OpenRouteService sieht nicht richtig aus (40 bis 200 Zeichen, Buchstaben und Ziffern ohne Leerzeichen).');
    }
    $zahl = fn ($v) => is_int($v) || (is_string($v) && preg_match('/^\d{1,6}$/', $v)) ? (int) $v : null;
    $neu = [
        'schluessel' => !empty($d['entfernen']) ? '' : ($schluessel !== '' ? $schluessel : (string) ($alt['schluessel'] ?? '')),
        'limitMonat' => max(1, min(100000, $zahl($d['limitMonat'] ?? null) ?? limit_monat($alt, $anbieter))),
        'limitTag' => max(1, min(10000, $zahl($d['limitTag'] ?? null) ?? limit_tag($alt, $anbieter))),
        'geaendert' => date('c'),
        'von' => $person['upn'],
    ];
    if ($neu['schluessel'] === '' && empty($d['entfernen'])) {
        fehler(400, 'invalid_request_error', 'Bitte den API-Schlüssel eintragen.');
    }
    // Schlüssel je Anbieter getrennt: die Einstellungen des anderen bleiben
    if (!speichern($anbieter, $neu)) {
        fehler(500, 'api_error', 'Ordner privat/ ist am Webspace nicht beschreibbar.');
    }
    antwort(status($cfg, $person, $anbieter));
}

// optimize, geocode: nur mit Schlüssel und innerhalb der Limits
$e = einstellungen($anbieter);
$schluessel = (string) ($e['schluessel'] ?? '');
if ($schluessel === '') {
    fehler(503, 'not_configured', ($anbieter === 'ors' ? 'OpenRouteService' : 'Google-Routing') . ' ist am Webspace noch nicht eingerichtet (Vollzugriff: Matten-Tourenplanung → Mehr → Routing).');
}
$d = inhalt();
@set_time_limit(60);

if ($anbieter === 'ors') {
    if ($aktion === 'optimize') {
        ors_optimize($d, $e, $schluessel);
    }
    ors_geocode(adresse($d), $e, $schluessel);
}

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
$adresse = adresse($d);
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
