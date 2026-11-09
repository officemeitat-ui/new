<?php
// Gemeinsame Bausteine der PHP-Seiten am Webspace (wetter-alarm.php, mein-plan.php):
// Marke aus config.json, Seiten im Design der App, Push über ntfy, E-Mail, Sprachen der Seiten für
// Mitarbeitende (Texte in mein-plan-texte.php), Fotos ohne Metadaten speichern.
// Nur Funktionen, gibt nichts aus. Braucht holen() aus wetter-lib.php.

declare(strict_types=1);

/** Marke aus config.json der App (Name, Hausfarbe, Logo, App-Symbol) für die Seite „Bin wach“ und die Nachrichten. */
function marke(): array
{
    static $m = null;
    if ($m !== null) {
        return $m;
    }
    $c = json_decode((string) @file_get_contents(__DIR__ . '/config.json'), true);
    $b = is_array($c['brand'] ?? null) ? $c['brand'] : [];
    $farbe = fn ($v, string $sonst) => is_string($v) && preg_match('/^#[0-9a-f]{6}$/i', $v) ? $v : $sonst;
    $datei = fn ($v) => is_string($v) && preg_match('#^[a-z0-9][a-z0-9/_.-]*\.(png|svg|jpg|webp)$#i', $v) && !str_contains($v, '..') ? $v : '';
    return $m = [
        'app' => is_string($b['app'] ?? null) ? $b['app'] : (is_string($b['name'] ?? null) ? $b['name'] : 'App'),
        'farbe' => $farbe($b['colors']['primary'] ?? null, '#1d4ea6'),
        'leise' => $farbe($b['colors']['muted'] ?? null, '#4b5b67'),
        'logo' => $datei($b['logoOnLight'] ?? $b['logo'] ?? ''),
        'symbol' => $datei($b['appIcons'][0] ?? $b['icon'] ?? ''),
    ];
}

/** Seite im Design der App (Logo, Hausfarbe, Systemschrift, Knöpfe mit 8 px Ecken). */
function html_seite(string $inhalt, int $status = 200, string $skript = '', string $titel = 'Winterdienst'): void
{
    $m = marke();
    $h = fn (string $t) => htmlspecialchars($t, ENT_QUOTES);
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    echo '<!doctype html><html lang="' . $h(html_sprache()) . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="' . $m['farbe'] . '"><title>' . $h($m['app']) . ' – ' . $h($titel) . '</title>'
        . ($m['symbol'] ? '<link rel="icon" href="' . $h($m['symbol']) . '"><link rel="apple-touch-icon" href="' . $h($m['symbol']) . '">' : '')
        . '<meta name="apple-mobile-web-app-title" content="' . $h($titel === 'Winterdienst' ? $m['app'] : $titel) . '">'
        . '<style>body{margin:0;padding:1rem;background:#f3f6f8;color:#13232f;font:1.1rem/1.5 "Segoe UI",Roboto,"Helvetica Neue",Arial,system-ui,sans-serif}'
        . 'main{max-width:30rem;margin:1rem auto;padding:1.5rem;background:#fff;border-radius:12px;box-shadow:0 1px 2px rgb(19 35 47/.06),0 6px 20px rgb(19 35 47/.08)}'
        . 'img.logo{display:block;max-width:180px;max-height:64px;margin:0 0 1rem}h1{font-size:1.4rem;margin:0 0 .5rem}h2{font-size:1.1rem;margin:1.5rem 0 .4rem}p,.leise{color:' . $m['leise'] . '}'
        . 'label{display:block;margin:.8rem 0 .2rem;font-weight:600}label.haken{display:flex;gap:.6rem;align-items:center;font-weight:400;margin:.4rem 0}label.haken input{width:1.4rem;height:1.4rem}'
        . 'select,input[type=time],textarea,input[type=file]{font:inherit;width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #c9d6df;border-radius:8px;background:#fff;color:inherit}'
        . 'button,a.knopf{display:block;box-sizing:border-box;text-align:center;text-decoration:none;font:inherit;font-weight:700;font-size:1.2rem;color:#fff;background:' . $m['farbe'] . ';border:0;border-radius:8px;padding:.85rem 1.4rem;width:100%;cursor:pointer;margin-top:1.2rem}'
        . '.ok{background:#eef6e2;color:#4e7a1e;border-radius:8px;padding:.6rem .8rem;font-weight:600}.fehler{background:#fce8e6;color:#b3261e;border-radius:8px;padding:.6rem .8rem}'
        . 'ul{padding-left:1.2rem}li{margin:.2rem 0}main{overflow-wrap:break-word}'
        . '.sprachwahl{float:right;margin:-.6rem -.4rem .4rem .6rem;font-size:.95rem;position:relative}.sprachwahl summary{list-style:none;cursor:pointer;display:flex;gap:.35rem;align-items:center;padding:.35rem .5rem;border:1px solid #c9d6df;border-radius:8px;color:#13232f;font-weight:600}.sprachwahl summary::-webkit-details-marker{display:none}.sprachwahl svg{width:1.1rem;height:1.1rem}'
        . '.sprachwahl ul{position:absolute;right:0;z-index:2;list-style:none;margin:.3rem 0 0;padding:.3rem;background:#fff;border:1px solid #c9d6df;border-radius:8px;box-shadow:0 6px 20px rgb(19 35 47/.15);min-width:12rem;max-width:calc(100vw - 3rem)}.sprachwahl li{margin:0}.sprachwahl a,.sprachwahl b{display:block;padding:.45rem .6rem;border-radius:6px;color:#0a5a96;text-decoration:none}.sprachwahl b{color:#13232f;background:#e8f1fa}'
        . '.veraltet{background:#fdf0d5;color:#6b4100;border-radius:8px;padding:.4rem .6rem;font-weight:600}</style>' . ($skript ? '<script src="' . $h($skript) . '" defer></script>' : '') . '</head>'
        . '<body><main>' . ($m['logo'] ? '<img class="logo" src="' . $h($m['logo']) . '" alt="' . $h($m['app']) . '">' : '') . $inhalt . '</main></body></html>';
}

/** Push über ntfy (JSON an den Server); liefert true bei Erfolg. */
function ntfy_senden(string $server, array $nachricht): bool
{
    [$status] = holen(rtrim($server ?: 'https://ntfy.sh', '/'), json_encode(array_filter($nachricht, fn ($v) => $v !== null), JSON_UNESCAPED_UNICODE));
    return $status >= 200 && $status < 300;
}

/** Einfache E-Mail (Text, UTF-8) im Namen der App; liefert true bei Erfolg. */
function mail_senden(string $an, string $betreff, string $text, string $absender = '', string $zusatz = ''): bool
{
    if (!filter_var($an, FILTER_VALIDATE_EMAIL)) {
        return false;
    }
    $von = filter_var($absender, FILTER_VALIDATE_EMAIL) ? $absender : null;
    $kopf = ['MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', 'Auto-Submitted: auto-generated'];
    if ($von) {
        $kopf[] = 'From: =?UTF-8?B?' . base64_encode(marke()['app'] . ($zusatz ? " – $zusatz" : '')) . '?= <' . $von . '>';
    }
    return @mail($an, '=?UTF-8?B?' . base64_encode($betreff) . '?=', $text, implode("\r\n", $kopf), $von ? '-f' . $von : '');
}

// ---------------------------------------------------------------- Sprachen (Seiten für Mitarbeitende)

const SPRACH_COOKIE = 'mein_plan_sprache';
const GLOBUS = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>';

/**
 * Alle Texte (mein-plan-texte.php): Sprache → Schlüssel → Text; Deutsch ist die Vorlage. $dazu: Texte einer weiteren
 * Seite (z. B. aushang-texte.php für den Aushang im Kundenbereich) für die Sprachen, die es schon gibt, dazunehmen.
 */
function texte(?array $dazu = null): array
{
    static $t = null;
    if ($t === null) {
        $d = is_file(__DIR__ . '/mein-plan-texte.php') ? require __DIR__ . '/mein-plan-texte.php' : null;
        $t = is_array($d) && is_array($d['de'] ?? null) ? $d : ['de' => []];
    }
    foreach ($dazu ?? [] as $s => $liste) {
        if (isset($t[$s]) && is_array($liste)) {
            $t[$s] = array_merge($t[$s], $liste);
        }
    }
    return $t;
}

/** Die Kennung, wenn es diese Sprache gibt (de, bks, ro, tr, hu, en), sonst null. */
function sprache_gueltig($s): ?string
{
    return is_string($s) && $s !== '' && isset(texte()[$s]) ? $s : null;
}

/** Sprache der Seite; mit $neu umstellen. */
function sprache(?string $neu = null): string
{
    static $s = 'de';
    if ($neu !== null && sprache_gueltig($neu)) {
        $s = $neu;
    }
    return $s;
}

/** Sprachangabe für <html lang> (Bosnisch/Kroatisch/Serbisch: hbs). */
function html_sprache(?string $s = null): string
{
    $l = texte()[$s ?? sprache()]['html_lang'] ?? 'de';
    return is_string($l) && preg_match('/^[a-z]{2,3}$/', $l) ? $l : 'de';
}

/** Text in der Sprache der Seite (oder $sprache), Platzhalter {name} ersetzt. Fehlt die Übersetzung: Deutsch. */
function t(string $key, array $werte = [], ?string $sprache = null): string
{
    $alle = texte();
    $text = $alle[$sprache ?? sprache()][$key] ?? null;
    if (!is_string($text) || trim($text) === '') {
        $text = $alle['de'][$key] ?? $key;
    }
    if (!is_string($text)) {
        return $key;
    }
    $ersetzen = [];
    foreach ($werte as $k => $v) {
        $ersetzen['{' . $k . '}'] = (string) $v;
    }
    return $ersetzen ? strtr($text, $ersetzen) : $text;
}

/** Wie t(), aber für HTML: der Text escapt, die Platzhalter bekommen fertiges (schon escaptes) HTML. */
function th(string $key, array $html = [], ?string $sprache = null): string
{
    $ersetzen = [];
    foreach ($html as $k => $v) {
        $ersetzen['{' . $k . '}'] = (string) $v;
    }
    $text = htmlspecialchars(t($key, [], $sprache), ENT_QUOTES);
    return $ersetzen ? strtr($text, $ersetzen) : $text;
}

/** Liste (z. B. Wochentage) in der Sprache; fehlt sie oder ist sie unvollständig: Deutsch. */
function t_liste(string $key, ?string $sprache = null): array
{
    $alle = texte();
    $de = (array) ($alle['de'][$key] ?? []);
    $l = $alle[$sprache ?? sprache()][$key] ?? null;
    return is_array($l) && count($l) === count($de) ? array_values($l) : array_values($de);
}

/** Datum JJJJ-MM-TT als Text, z. B. „Mo 02.11.“ bzw. „Pazartesi 02.11“ ($lang: voller Wochentag). */
function datum_sprache(string $d, bool $lang = false, ?string $sprache = null): string
{
    $t = DateTimeImmutable::createFromFormat('!Y-m-d', $d);
    if (!$t) {
        return $d;
    }
    $tage = t_liste($lang ? 'tage_lang' : 'tage', $sprache);
    return t('datum', ['tag' => $tage[(int) $t->format('N') - 1] ?? '', 'd' => $t->format('d'), 'm' => $t->format('m')], $sprache);
}

/**
 * Sprache der Seite wählen und setzen: ?sprache= (das Gerät merkt sie sich per Cookie), sonst Cookie,
 * sonst die zuletzt auf der Seite gewählte der Person, sonst die aus dem Stammblatt. Ohne bekannte Person
 * ($browser) die Sprache des Browsers, sonst Deutsch. $nur: nur diese Sprachen (Seite nicht in allen übersetzt).
 */
function sprache_waehlen(array $person = [], bool $browser = false, array $nur = []): string
{
    $sprache_gueltig = fn ($s) => ($g = sprache_gueltig($s)) && (!$nur || in_array($g, $nur, true)) ? $g : null;
    $wahl = $sprache_gueltig($_GET['sprache'] ?? null);
    if ($wahl) {
        if (!headers_sent()) {
            setcookie(SPRACH_COOKIE, $wahl, ['expires' => time() + 400 * 86400, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']), 'httponly' => true, 'samesite' => 'Lax']);
        }
        return sprache($wahl);
    }
    foreach ([$_COOKIE[SPRACH_COOKIE] ?? null, $person['spracheWahl'] ?? null, $person['sprache'] ?? null] as $s) {
        if ($sprache_gueltig($s)) {
            return sprache($s);
        }
    }
    if ($browser && !$person) {
        foreach (explode(',', (string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '')) as $teil) {
            $code = strtolower(substr(trim($teil), 0, 2));
            $code = in_array($code, ['bs', 'hr', 'sr', 'sh'], true) ? 'bks' : $code;
            if ($sprache_gueltig($code)) {
                return sprache($code);
            }
        }
    }
    return sprache('de');
}

/** Sprache für Nachrichten an die Person (Push): zuletzt am Handy gewählt, sonst Stammblatt, sonst Deutsch. */
function sprache_von(array $person): string
{
    return sprache_gueltig($person['spracheWahl'] ?? null) ?? sprache_gueltig($person['sprache'] ?? null) ?? 'de';
}

/** Auswahl der Sprache oben auf der Seite (Links, ohne Skript). $basis: Adresse der Seite ohne „sprache“; $nur: nur diese Sprachen. */
function sprachwahl_html(string $basis, array $nur = []): string
{
    $h = fn (string $t): string => htmlspecialchars($t, ENT_QUOTES);
    $punkte = '';
    foreach (texte() as $id => $tx) {
        if ($nur && !in_array($id, $nur, true)) {
            continue;
        }
        $name = (string) ($tx['sprache_name'] ?? $id);
        $lang = html_sprache($id);
        $punkte .= $id === sprache()
            ? '<li><b lang="' . $h($lang) . '" aria-current="true">' . $h($name) . '</b></li>'
            : '<li><a href="' . $h($basis . (str_contains($basis, '?') ? '&' : '?') . 'sprache=' . rawurlencode((string) $id)) . '" lang="' . $h($lang) . '" hreflang="' . $h($lang) . '">' . $h($name) . '</a></li>';
    }
    return '<details class="sprachwahl"><summary title="' . $h(t('sprache_waehlen')) . '">' . GLOBUS . '<span>' . $h((string) (texte()[sprache()]['sprache_name'] ?? 'Deutsch')) . '</span></summary><ul aria-label="' . $h(t('sprache_waehlen')) . '">' . $punkte . '</ul></details>';
}

/**
 * Hochgeladenes Foto prüfen und neu speichern (Fahrerseite mattentour.php, Checkliste in mein-plan.php): Typ laut
 * Inhalt, Maße, mit GD als JPEG (längste Seite 1600 px, ohne Metadaten wie den Ort der Aufnahme); ohne GD bzw. über
 * 40 Megapixel nur JPEG, unverändert, aber ohne EXIF/GPS (bild_ohne_metadaten). Liefert '' (gespeichert) oder den
 * Fehler: 'gross' (Upload-Fehler, zu groß oder leer), 'typ' (kein Foto) bzw. 'speichern'.
 */
function bild_speichern(string $tmp, int $groesse, int $fehler, string $ziel, int $max): string
{
    if ($fehler !== UPLOAD_ERR_OK || !is_uploaded_file($tmp) || $groesse > $max || $groesse < 100) {
        return 'gross';
    }
    $typ = class_exists('finfo') ? (string) (new finfo(FILEINFO_MIME_TYPE))->file($tmp) : '';
    $mass = @getimagesize($tmp);
    $typen = ['image/jpeg' => 'imagecreatefromjpeg', 'image/png' => 'imagecreatefrompng', 'image/webp' => 'imagecreatefromwebp'];
    if (!isset($typen[$typ]) || !$mass || ($mass['mime'] ?? '') !== $typ || $mass[0] < 1 || $mass[1] < 1 || $mass[0] > 12000 || $mass[1] > 12000) {
        return 'typ';
    }
    $lesen = $typen[$typ];
    if (function_exists($lesen) && function_exists('imagejpeg') && $mass[0] * $mass[1] <= 40e6) {
        $bild = @$lesen($tmp);
        if (!$bild) {
            return 'typ';
        }
        $faktor = min(1, 1600 / max($mass[0], $mass[1]));
        $b = max(1, (int) round($mass[0] * $faktor));
        $h = max(1, (int) round($mass[1] * $faktor));
        $neu = imagecreatetruecolor($b, $h);
        imagefill($neu, 0, 0, imagecolorallocate($neu, 255, 255, 255));
        imagecopyresampled($neu, $bild, 0, 0, 0, 0, $b, $h, $mass[0], $mass[1]);
        $ok = imagejpeg($neu, $ziel, 82);
        imagedestroy($bild);
        imagedestroy($neu);
        return $ok ? '' : 'speichern';
    }
    if ($typ !== 'image/jpeg') {
        return 'typ';
    }
    // ohne GD bzw. über 40 Megapixel: unverändert, aber ohne Metadaten wie den Ort der Aufnahme (ohne Neukodieren)
    if (!move_uploaded_file($tmp, $ziel)) {
        return 'speichern';
    }
    if (!bild_ohne_metadaten($ziel)) {
        @unlink($ziel);
        return 'typ';
    }
    return '';
}

/**
 * Ortsdaten und andere Metadaten aus einem gespeicherten Foto entfernen, ohne es neu zu kodieren (für Fotos, die ohne
 * GD durchgehen: Winterdienst-Protokoll ohne JavaScript, Kundenbereich über 40 Megapixel oder ohne GD, Fahrerseite
 * ohne GD). JPEG: APP1 (EXIF mit GPS, XMP) und APP13 (IPTC) weg; PNG: eXIf- und Text-Blöcke weg; WebP: EXIF- und
 * XMP-Blöcke weg (Merker im VP8X-Kopf gelöscht). Liefert false, wenn die Datei nicht lesbar ist oder kein solches Bild
 * (dann gehört sie nicht gespeichert).
 */
function bild_ohne_metadaten(string $datei): bool
{
    $d = @file_get_contents($datei);
    if (!is_string($d) || strlen($d) < 12) {
        return false;
    }
    $neu = null;
    if (substr($d, 0, 2) === "\xFF\xD8") {
        $neu = jpeg_ohne_metadaten($d);
    } elseif (substr($d, 0, 8) === "\x89PNG\r\n\x1A\n") {
        $neu = png_ohne_metadaten($d);
    } elseif (substr($d, 0, 4) === 'RIFF' && substr($d, 8, 4) === 'WEBP') {
        $neu = webp_ohne_metadaten($d);
    }
    if ($neu === null) {
        return false;
    }
    return $neu === $d || file_put_contents($datei, $neu, LOCK_EX) === strlen($neu);
}

/** JPEG ohne APP1- und APP13-Segmente (bis zum Bildbeginn SOS; der Rest bleibt Byte für Byte); null = kaputt. */
function jpeg_ohne_metadaten(string $d): ?string
{
    $aus = "\xFF\xD8";
    $n = strlen($d);
    $i = 2;
    while ($i < $n) {
        if ($d[$i] !== "\xFF") {
            return null;
        }
        $m = $i;
        while ($m < $n && $d[$m] === "\xFF") {
            $m++; // Füllbytes
        }
        if ($m >= $n) {
            return null;
        }
        $marke = ord($d[$m]);
        if ($marke === 0xD9 || $marke === 0xDA) {
            return $aus . substr($d, $i); // Ende bzw. Bilddaten: unverändert
        }
        if (($marke >= 0xD0 && $marke <= 0xD7) || $marke === 0x01) {
            $aus .= substr($d, $i, $m - $i + 1);
            $i = $m + 1;
            continue;
        }
        if ($m + 2 >= $n) {
            return null;
        }
        $laenge = (ord($d[$m + 1]) << 8) | ord($d[$m + 2]);
        if ($laenge < 2 || $m + 1 + $laenge > $n) {
            return null;
        }
        $ende = $m + 1 + $laenge;
        if ($marke !== 0xE1 && $marke !== 0xED) {
            $aus .= substr($d, $i, $ende - $i);
        }
        $i = $ende;
    }
    return null;
}

/** PNG ohne eXIf-, tEXt-, zTXt- und iTXt-Blöcke; null = kaputt. */
function png_ohne_metadaten(string $d): ?string
{
    $aus = substr($d, 0, 8);
    $n = strlen($d);
    $i = 8;
    while ($i + 12 <= $n) {
        $laenge = unpack('N', substr($d, $i, 4))[1];
        $typ = substr($d, $i + 4, 4);
        if ($laenge > $n - $i - 12) {
            return null;
        }
        if (!in_array($typ, ['eXIf', 'tEXt', 'zTXt', 'iTXt'], true)) {
            $aus .= substr($d, $i, 12 + $laenge);
        }
        $i += 12 + $laenge;
        if ($typ === 'IEND') {
            return $aus;
        }
    }
    return null;
}

/** WebP ohne EXIF- und XMP-Blöcke, Merker im VP8X-Kopf gelöscht, RIFF-Länge neu; null = kaputt. */
function webp_ohne_metadaten(string $d): ?string
{
    $n = strlen($d);
    $i = 12;
    $teile = '';
    while ($i + 8 <= $n) {
        $typ = substr($d, $i, 4);
        $laenge = unpack('V', substr($d, $i + 4, 4))[1];
        if ($laenge > $n - $i - 8) {
            return null;
        }
        $platz = min($laenge + ($laenge & 1), $n - $i - 8);
        $block = substr($d, $i, 8 + $platz);
        if ($typ === 'VP8X' && $laenge >= 1) {
            $block[8] = chr(ord($block[8]) & ~0x0C); // Merker EXIF (0x08) und XMP (0x04)
        }
        if ($typ !== 'EXIF' && $typ !== 'XMP ') {
            $teile .= $block;
        }
        $i += 8 + $platz;
    }
    return 'RIFF' . pack('V', 4 + strlen($teile)) . 'WEBP' . $teile;
}
