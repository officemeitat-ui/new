<?php
// Mein Dienstplan: die veröffentlichten Wochen für Mitarbeitende am Handy, ohne Anmeldung.
//
// Jede Person bekommt aus der App einen persönlichen Link (mein-plan.php?p=CODE, per WhatsApp
// oder E-Mail). Beim ersten Öffnen merkt sich das Handy den Code (Cookie), danach genügt
// mein-plan.php, z. B. als Symbol am Startbildschirm. Dort sieht die Person ihre Einsätze
// (Zeit, Objekt, Adresse, Hinweise, Fahrten, Stunden, Zeitkonto) und kann Urlaub, Zeitausgleich
// oder Pflegefreistellung beantragen oder sich krank melden. Das Büro bekommt dazu einen
// Push (ntfy) bzw. eine E-Mail, die App zeigt den Antrag unter „Zu erledigen“.
//
// Gespeichert wird nur, was die App beim Veröffentlichen schickt: je Person eine Datei unter
// privat/mitarbeiter/ (Name nur über den Hashwert des Codes auffindbar), dazu die Anträge.
// Der Ordner privat/ ist per .htaccess gesperrt.
//
// Aufrufe der App (Schlüssel im Kopf X-Schluessel): aktion=speichern | antraege | antrag-status | einrichten

declare(strict_types=1);

require __DIR__ . '/wetter-lib.php';
require __DIR__ . '/webspace-lib.php';

const COOKIE = 'mein_plan';
const ARTEN = ['Urlaub', 'Zeitausgleich', 'Pflegefreistellung', 'Krankenstand'];
const STATUS_TEXT = ['offen' => 'offen', 'genehmigt' => 'genehmigt', 'abgelehnt' => 'abgelehnt', 'erledigt' => 'eingetragen'];
const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function jetzt(): int
{
    $t = getenv('WETTER_JETZT'); // nur für Tests
    return $t !== false && $t !== '' ? (int) $t : time();
}

function ordner(): string
{
    return getenv('MEIN_PLAN_ORDNER') ?: __DIR__ . '/privat';
}

function heute(): string
{
    return (new DateTimeImmutable('@' . jetzt()))->setTimezone(new DateTimeZone('Europe/Vienna'))->format('Y-m-d');
}

function einstellungen(): ?array
{
    $e = json_decode((string) @file_get_contents(ordner() . '/mitarbeiter.json'), true);
    return is_array($e) && is_string($e['schluessel'] ?? null) && strlen($e['schluessel']) >= 32 ? $e : null;
}

/** Datum (JJJJ-MM-TT) plus/minus Tage, unabhängig von der Zeitzone des Servers. */
function tag_plus(string $datum, int $tage): string
{
    return (new DateTimeImmutable($datum, new DateTimeZone('UTC')))->modify(($tage >= 0 ? '+' : '') . $tage . ' days')->format('Y-m-d');
}

function json_ausgabe(int $status, array $daten): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($daten, JSON_UNESCAPED_UNICODE);
    exit;
}

function speicher(): string
{
    $d = ordner() . '/mitarbeiter';
    if (!is_dir($d)) {
        @mkdir($d, 0775, true);
    }
    return $d;
}

function person_datei(string $hash): string
{
    return speicher() . '/' . $hash . '.json';
}

function json_lesen(string $datei): array
{
    $d = is_file($datei) ? json_decode((string) file_get_contents($datei), true) : null;
    return is_array($d) ? $d : [];
}

function json_schreiben(string $datei, array $daten): bool
{
    $tmp = $datei . '.' . bin2hex(random_bytes(4));
    return @file_put_contents($tmp, json_encode($daten, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX) !== false && @rename($tmp, $datei);
}

/** Anträge gesperrt ändern; $fn bekommt die Liste per Referenz, Rückgabe wird durchgereicht. */
function antraege(callable $fn)
{
    $h = @fopen(speicher() . '/antraege.json', 'c+');
    if (!$h) {
        return null;
    }
    flock($h, LOCK_EX);
    $liste = json_decode((string) stream_get_contents($h), true);
    $liste = is_array($liste) ? $liste : [];
    $ergebnis = $fn($liste);
    // Datensparsam: Entschiedenes nach 120 Tagen weg, Notiz einer Krankmeldung nach dem Eintragen leeren
    $grenze = tag_plus(heute(), -120);
    $liste = array_values(array_filter($liste, fn ($a) => ($a['status'] ?? '') === 'offen' || ($a['bis'] ?? '') >= $grenze));
    foreach ($liste as &$a) {
        if (($a['art'] ?? '') === 'Krankenstand' && ($a['status'] ?? '') === 'erledigt') {
            $a['notiz'] = '';
        }
    }
    unset($a);
    ftruncate($h, 0);
    rewind($h);
    fwrite($h, json_encode(array_values($liste), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    fflush($h);
    flock($h, LOCK_UN);
    fclose($h);
    return $ergebnis;
}

$h = fn (string $t): string => htmlspecialchars($t, ENT_QUOTES);
$tag = function (string $d): string {
    $t = DateTimeImmutable::createFromFormat('!Y-m-d', $d);
    return $t ? TAGE[(int) $t->format('N') - 1] . ' ' . $t->format('d.m.') : $d;
};
$zeitraum = fn (string $von, string $bis): string => $von === $bis ? $tag($von) : $tag($von) . ' – ' . $tag($bis);
$stunden = fn ($min): string => str_replace('.', ',', (string) round(((int) $min) / 60, 2));
$konto = fn ($min): string => ($min > 0 ? '+' : ($min < 0 ? '−' : '±')) . str_replace('.', ',', (string) round(abs((int) $min) / 60, 2));

$e = einstellungen();
$aktion = (string) ($_GET['aktion'] ?? '');
$methode = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ---------------------------------------------------------------- Aufrufe der App (mit Schlüssel)

if (in_array($aktion, ['speichern', 'antraege', 'antrag-status', 'einrichten'], true)) {
    if (!$e) {
        json_ausgabe(503, ['fehler' => 'Mein Dienstplan noch nicht eingerichtet: privat/mitarbeiter.json fehlt (App → Mitarbeitende → Plan am Handy).']);
    }
    $gegeben = (string) ($_SERVER['HTTP_X_SCHLUESSEL'] ?? '');
    if ($gegeben === '' || !hash_equals((string) $e['schluessel'], $gegeben)) {
        json_ausgabe(403, ['fehler' => 'Schlüssel fehlt oder falsch']);
    }
    $daten = $methode === 'POST' ? json_decode((string) file_get_contents('php://input'), true) : null;

    if ($aktion === 'antraege') {
        $grenze = tag_plus(heute(), -120);
        $liste = antraege(fn (array &$l) => $l) ?? [];
        json_ausgabe(200, ['antraege' => array_values(array_filter($liste, fn ($a) => ($a['bis'] ?? '') >= $grenze || ($a['status'] ?? '') === 'offen'))]);
    }
    if ($methode !== 'POST' || !is_array($daten)) {
        json_ausgabe(400, ['fehler' => 'POST mit JSON erwartet']);
    }
    if ($aktion === 'einrichten') {
        if (!is_string($daten['schluessel'] ?? null) || strlen($daten['schluessel']) < 32) {
            json_ausgabe(400, ['fehler' => 'Ungültige Einstellungen']);
        }
        if (!json_schreiben(ordner() . '/mitarbeiter.json', $daten)) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        json_ausgabe(200, ['gespeichert' => true]);
    }
    if ($aktion === 'antrag-status') {
        $status = (string) ($daten['status'] ?? '');
        if (!isset(STATUS_TEXT[$status]) || $status === 'offen') {
            json_ausgabe(400, ['fehler' => 'Status genehmigt, abgelehnt oder erledigt']);
        }
        $a = antraege(function (array &$l) use ($daten, $status) {
            foreach ($l as &$x) {
                if (($x['id'] ?? '') === (string) ($daten['id'] ?? '')) {
                    $x['status'] = $status;
                    $x['antwort'] = mb_substr(trim((string) ($daten['antwort'] ?? '')), 0, 300);
                    $x['entschieden'] = jetzt();
                    return $x;
                }
            }
            return null;
        });
        if (!$a) {
            json_ausgabe(404, ['fehler' => 'Antrag nicht gefunden']);
        }
        // der Person Bescheid geben (Krankmeldung „eingetragen“: kein Push nötig)
        $p = json_lesen(person_datei((string) $a['hash']));
        if (!empty($p['ntfy']) && $status !== 'erledigt') {
            ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $p['ntfy'], 'title' => $a['art'] . ' ' . $zeitraum($a['von'], $a['bis']) . ': ' . STATUS_TEXT[$status], 'message' => $a['antwort'] ?: 'Details in deinem Dienstplan.', 'priority' => 3, 'tags' => [$status === 'genehmigt' ? 'white_check_mark' : 'x'], 'click' => rtrim((string) ($e['adresse'] ?? ''), '/') . '/mein-plan.php']);
        }
        json_ausgabe(200, ['antrag' => $a]);
    }
    // speichern: veröffentlichte Wochen je Person; geänderte Wochen per Push melden
    $benachrichtigt = 0;
    $personen = 0;
    $montag = (new DateTimeImmutable(heute() . ' monday this week'))->format('Y-m-d');
    foreach ((array) ($daten['entfernen'] ?? []) as $hash) {
        if (is_string($hash) && preg_match('/^[a-f0-9]{64}$/', $hash)) {
            @unlink(person_datei($hash));
        }
    }
    foreach ((array) ($daten['personen'] ?? []) as $person) {
        $hash = (string) ($person['hash'] ?? '');
        if (!preg_match('/^[a-f0-9]{64}$/', $hash)) {
            continue;
        }
        $p = json_lesen(person_datei($hash));
        $p['name'] = mb_substr((string) ($person['name'] ?? ''), 0, 80);
        $p['ntfy'] = is_string($person['ntfy'] ?? null) && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $person['ntfy']) ? $person['ntfy'] : '';
        $p['wochen'] = (array) ($p['wochen'] ?? []);
        $meldungen = [];
        foreach ((array) ($daten['wochen'][$hash] ?? []) as $mo => $woche) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $mo) || !is_array($woche)) {
                continue;
            }
            $sig = sha1(json_encode([$woche['tage'] ?? [], $woche['summe'] ?? [], $woche['konto'] ?? null]));
            $alt = $p['wochen'][$mo] ?? null;
            if (!$alt && $mo >= $montag) {
                $meldungen[] = 'Dein Dienstplan für KW ' . ($woche['kw'] ?? '') . ' ist da';
            } elseif ($alt && ($alt['sig'] ?? '') !== $sig && $mo >= $montag) {
                $meldungen[] = 'Dein Dienstplan KW ' . ($woche['kw'] ?? '') . ' wurde geändert';
            }
            $woche['sig'] = $sig;
            $woche['veroeffentlicht'] = $alt['veroeffentlicht'] ?? jetzt();
            $woche['geaendert'] = $alt && ($alt['sig'] ?? '') !== $sig ? jetzt() : ($alt['geaendert'] ?? null);
            $p['wochen'][$mo] = $woche;
        }
        // nur die letzten 8 Wochen und die kommenden behalten
        $grenze = tag_plus($montag, -56);
        $p['wochen'] = array_filter($p['wochen'], fn ($k) => $k >= $grenze, ARRAY_FILTER_USE_KEY);
        ksort($p['wochen']);
        if (!json_schreiben(person_datei($hash), $p)) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        $personen++;
        if ($meldungen && $p['ntfy']) {
            if (ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => $p['ntfy'], 'title' => implode(' · ', $meldungen), 'message' => 'Antippen öffnet deinen Plan.', 'priority' => 3, 'tags' => ['calendar'], 'click' => rtrim((string) ($e['adresse'] ?? ''), '/') . '/mein-plan.php'])) {
                $benachrichtigt++;
            }
        }
    }
    json_ausgabe(200, ['personen' => $personen, 'benachrichtigt' => $benachrichtigt]);
}

// ---------------------------------------------------------------- Seite für Mitarbeitende

if (!$e) {
    html_seite('<h1>Mein Dienstplan</h1><p>Noch nicht eingerichtet. Bitte im Büro melden.</p>', 503, '', 'Mein Dienstplan');
    exit;
}
$code = (string) ($_GET['p'] ?? $_POST['p'] ?? $_COOKIE[COOKIE] ?? '');
if ($aktion === 'vergessen') {
    setcookie(COOKIE, '', ['expires' => 1, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']), 'httponly' => true, 'samesite' => 'Lax']);
    html_seite('<h1>Mein Dienstplan</h1><p>Dieses Gerät hat den persönlichen Link vergessen. Zum Öffnen wieder den Link aus der Nachricht verwenden.</p>', 200, '', 'Mein Dienstplan');
    exit;
}
$hash = preg_match('/^[A-Za-z0-9]{16,40}$/', $code) ? hash('sha256', $code) : '';
$person = $hash ? json_lesen(person_datei($hash)) : [];
if (!$person) {
    html_seite('<h1>Mein Dienstplan</h1><p>Dieser Link gilt nicht (mehr). Bitte im Büro um einen neuen Link bitten.</p>', 404, '', 'Mein Dienstplan');
    exit;
}
if (isset($_GET['p'])) {
    // merken: danach genügt mein-plan.php (z. B. am Startbildschirm)
    setcookie(COOKIE, $code, ['expires' => jetzt() + 400 * 86400, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']), 'httponly' => true, 'samesite' => 'Lax']);
}

// Antrag oder Krankmeldung
if ($aktion === 'antrag' && $methode === 'POST') {
    $herkunft = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    if ($herkunft !== '' && $herkunft !== 'same-origin' && $herkunft !== 'none') {
        html_seite('<p>Nicht erlaubt.</p>', 403, '', 'Mein Dienstplan');
        exit;
    }
    $art = (string) ($_POST['art'] ?? '');
    $von = (string) ($_POST['von'] ?? '');
    $bis = (string) ($_POST['bis'] ?? '') ?: $von;
    $notiz = mb_substr(trim((string) ($_POST['notiz'] ?? '')), 0, 300);
    $fehler = '';
    $gueltig = fn ($d) => (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && DateTimeImmutable::createFromFormat('!Y-m-d', $d);
    if (!in_array($art, ARTEN, true)) {
        $fehler = 'Bitte die Art wählen.';
    } elseif (!$gueltig($von) || !$gueltig($bis) || $bis < $von) {
        $fehler = 'Bitte einen gültigen Zeitraum angeben.';
    } elseif ($bis > tag_plus($von, 60)) {
        $fehler = 'Höchstens 60 Tage je Antrag.';
    } elseif ($von < tag_plus(heute(), -7)) {
        $fehler = 'Der Beginn liegt zu weit zurück. Bitte im Büro melden.';
    }
    $neu = null;
    if (!$fehler) {
        $neu = antraege(function (array &$l) use ($hash, $person, $art, $von, $bis, $notiz) {
            $heute = array_filter($l, fn ($a) => $a['hash'] === $hash && (int) $a['erstellt'] > jetzt() - 86400);
            if (count($heute) >= 10) {
                return false;
            }
            $a = ['id' => bin2hex(random_bytes(6)), 'hash' => $hash, 'name' => $person['name'] ?? '', 'art' => $art, 'von' => $von, 'bis' => $bis, 'notiz' => $notiz, 'erstellt' => jetzt(), 'status' => 'offen', 'antwort' => ''];
            $l[] = $a;
            return $a;
        });
        if ($neu === false) {
            $fehler = 'Zu viele Anträge heute. Bitte im Büro melden.';
        } elseif ($neu === null) {
            $fehler = 'Konnte nicht speichern. Bitte im Büro anrufen.';
        }
    }
    if ($fehler) {
        $meldung = '<p class="fehler">' . $h($fehler) . '</p>';
    } else {
        // Büro benachrichtigen (Krankmeldung dringender)
        $krank = $art === 'Krankenstand';
        $titel = ($krank ? 'Krankmeldung: ' : $art . ': ') . ($person['name'] ?? '');
        $text = ($krank ? 'Krank ab ' . $tag($von) . ($bis !== $von ? ', voraussichtlich bis ' . $tag($bis) : '') : $zeitraum($von, $bis)) . ($notiz ? "\n„{$notiz}“" : '') . "\nIn der App unter „Zu erledigen“.";
        $app = rtrim((string) ($e['adresse'] ?? ''), '/') . '/#home';
        foreach ((array) ($e['buero'] ?? []) as $b) {
            if (!empty($b['ntfy'])) {
                ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $b['ntfy'], 'title' => $titel, 'message' => $text, 'priority' => $krank ? 4 : 3, 'tags' => [$krank ? 'face_with_thermometer' : 'palm_tree'], 'click' => $app]);
            }
            if (!empty($b['email'])) {
                mail_senden((string) $b['email'], $titel, $text . "\n\nApp: $app\n", (string) ($e['absender'] ?? ''), 'Mein Dienstplan');
            }
        }
        header('Location: mein-plan.php?gesendet=' . ($krank ? 'krank' : 'antrag'), true, 303);
        exit;
    }
}

// Plan: diese Woche und die kommenden (sonst die letzte veröffentlichte)
$montag = (new DateTimeImmutable(heute() . ' monday this week'))->format('Y-m-d');
$wochen = array_filter((array) ($person['wochen'] ?? []), fn ($k) => $k >= $montag, ARRAY_FILTER_USE_KEY);
if (!$wochen && !empty($person['wochen'])) {
    $wochen = array_slice((array) $person['wochen'], -1, 1, true);
}
$meldung = $meldung ?? '';
if (($_GET['gesendet'] ?? '') === 'krank') {
    $meldung = '<p class="ok">Krankmeldung ist im Büro. Gute Besserung!</p>';
} elseif (($_GET['gesendet'] ?? '') === 'antrag') {
    $meldung = '<p class="ok">Antrag gesendet. Die Antwort steht dann hier.</p>';
}
$planHtml = '';
foreach ($wochen as $mo => $w) {
    $tageHtml = '';
    foreach ((array) ($w['tage'] ?? []) as $t) {
        $eintraege = (array) ($t['eintraege'] ?? []);
        if (!$eintraege && empty($t['abwesend']) && empty($t['feiertag'])) {
            continue;
        }
        $zeilen = '';
        foreach ($eintraege as $x) {
            $adresse = (string) ($x['adresse'] ?? '');
            $karte = $adresse !== '' ? ' · <a href="https://www.google.com/maps/search/?api=1&amp;query=' . rawurlencode($adresse) . '" target="_blank" rel="noopener">Karte</a>' : '';
            $zeilen .= '<div class="einsatz' . (!empty($x['entfaellt']) ? ' weg' : '') . '"><b>' . $h((string) ($x['zeit'] ?? '')) . '</b> ' . $h((string) ($x['objekt'] ?? ''))
                . (!empty($x['leistung']) ? ' <span class="leise">· ' . $h((string) $x['leistung']) . '</span>' : '')
                . ($adresse !== '' ? '<br><span class="leise">' . $h($adresse) . $karte . '</span>' : '')
                . (!empty($x['notizen']) ? '<br><span class="hinweis">' . $h(implode(' · ', (array) $x['notizen'])) . '</span>' : '')
                . (!empty($x['hinweis']) || !empty($x['schluessel']) ? '<details><summary>Objektinfo</summary>' . (!empty($x['hinweis']) ? '<p>' . nl2br($h((string) $x['hinweis'])) . '</p>' : '') . (!empty($x['schluessel']) ? '<p class="leise">Schlüssel: ' . $h((string) $x['schluessel']) . '</p>' : '') . '</details>' : '')
                . '</div>';
        }
        $tageHtml .= '<section class="tag"><h3>' . $h($tag((string) $t['datum'])) . (!empty($t['feiertag']) ? ' <span class="pill">' . $h((string) $t['feiertag']) . '</span>' : '') . (!empty($t['abwesend']) ? ' <span class="pill abw">' . $h((string) $t['abwesend']) . '</span>' : '') . '</h3>' . ($zeilen ?: '<p class="leise">frei</p>') . '</section>';
    }
    $summe = (array) ($w['summe'] ?? []);
    $planHtml .= '<h2>KW ' . $h((string) ($w['kw'] ?? '')) . ' <span class="leise">' . $h($zeitraum((string) ($w['von'] ?? $mo), (string) ($w['bis'] ?? $mo))) . '</span></h2>'
        . (!empty($w['geaendert']) ? '<p class="pill neu">geändert am ' . (new DateTimeImmutable('@' . (int) $w['geaendert']))->setTimezone(new DateTimeZone('Europe/Vienna'))->format('d.m. H:i') . '</p>' : '')
        . ($tageHtml ?: '<p class="leise">Keine Einsätze in dieser Woche.</p>')
        . '<p class="summe">Stunden: <b>' . $stunden($summe['ist'] ?? 0) . ' h</b>' . (isset($summe['soll']) ? ' · Soll ' . $stunden($summe['soll']) . ' h' : '') . (isset($w['konto']) && $w['konto'] !== null ? ' · Zeitkonto danach ' . $konto($w['konto']) . ' h' : '') . '</p>';
}
// eigene Anträge
$meine = array_values(array_filter(antraege(fn (array &$l) => $l) ?? [], fn ($a) => $a['hash'] === $hash && (($a['bis'] ?? '') >= tag_plus(heute(), -60) || $a['status'] === 'offen')));
usort($meine, fn ($a, $b) => $b['erstellt'] <=> $a['erstellt']);
$antraegeHtml = $meine ? '<h2>Meine Anträge</h2><ul class="antraege">' . implode('', array_map(fn ($a) => '<li><b>' . $h($a['art']) . '</b> ' . $h($zeitraum($a['von'], $a['bis'])) . ' <span class="pill st-' . $h($a['status']) . '">' . $h(STATUS_TEXT[$a['status']] ?? $a['status']) . '</span>' . ($a['antwort'] ? '<br><span class="leise">' . $h($a['antwort']) . '</span>' : '') . '</li>', $meine)) . '</ul>' : '';
$p = '<input type="hidden" name="p" value="' . $h($code) . '">';
$heute = heute();
$formulare = '<h2>Abwesenheit</h2>'
    . '<details><summary>Krank melden</summary><form method="post" action="mein-plan.php?aktion=antrag">' . $p . '<input type="hidden" name="art" value="Krankenstand">'
    . '<label for="k-von">Krank ab</label><input type="date" id="k-von" name="von" value="' . $heute . '" required>'
    . '<label for="k-bis">Voraussichtlich bis (wenn bekannt)</label><input type="date" id="k-bis" name="bis">'
    . '<label for="k-notiz">Notiz (optional, keine Diagnose)</label><textarea id="k-notiz" name="notiz" rows="2" maxlength="300"></textarea>'
    . '<button type="submit">Krankmeldung senden</button><p class="leise">Bitte zusätzlich wie gewohnt anrufen, wenn der Dienst schon bald beginnt. Die Krankenstandsbestätigung bleibt nötig.</p></form></details>'
    . '<details><summary>Urlaub, Zeitausgleich oder Pflegefreistellung beantragen</summary><form method="post" action="mein-plan.php?aktion=antrag">' . $p
    . '<label for="a-art">Art</label><select id="a-art" name="art"><option>Urlaub</option><option>Zeitausgleich</option><option>Pflegefreistellung</option></select>'
    . '<label for="a-von">Von</label><input type="date" id="a-von" name="von" required><label for="a-bis">Bis</label><input type="date" id="a-bis" name="bis" required>'
    . '<label for="a-notiz">Notiz (optional)</label><textarea id="a-notiz" name="notiz" rows="2" maxlength="300"></textarea>'
    . '<button type="submit">Antrag senden</button></form></details>';
html_seite('<h1>Mein Dienstplan</h1><p>' . $h((string) ($person['name'] ?? '')) . '</p>' . $meldung
    . '<style>.tag{border-top:1px solid #dde5ea;padding:.5rem 0}.tag h3{font-size:1rem;margin:.2rem 0}.einsatz{margin:.35rem 0}.einsatz.weg{text-decoration:line-through;color:#6f8596}.hinweis{color:#8a5300;font-size:.95rem}.pill{display:inline-block;border-radius:999px;padding:0 .6rem;font-size:.85rem;background:#e8f1fa;color:#0a5a96;font-weight:600}.pill.abw{background:#fdf0d5;color:#8a5300}.pill.neu{background:#fce8e6;color:#b3261e}.st-genehmigt,.st-erledigt{background:#eef6e2!important;color:#4e7a1e!important}.st-abgelehnt{background:#fce8e6!important;color:#b3261e!important}.summe{background:#f3f6f8;border-radius:8px;padding:.5rem .7rem}details{margin:.6rem 0}summary{font-weight:600;cursor:pointer;padding:.3rem 0}input[type=date]{font:inherit;width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #c9d6df;border-radius:8px}</style>'
    . ($planHtml ?: '<p class="leise">Noch kein veröffentlichter Plan.</p>')
    . $antraegeHtml . $formulare
    . '<p class="leise" style="margin-top:2rem;font-size:.9rem">Diese Seite ist persönlich: den Link nicht weitergeben. Tipp: im Browser-Menü „Zum Startbildschirm“ wählen. <a href="mein-plan.php?aktion=vergessen">Auf diesem Gerät vergessen</a></p>', 200, '', 'Mein Dienstplan');
