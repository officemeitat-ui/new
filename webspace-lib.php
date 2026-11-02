<?php
// Gemeinsame Bausteine der PHP-Seiten am Webspace (wetter-alarm.php, mein-plan.php):
// Marke aus config.json, Seiten im Design der App, Push über ntfy, E-Mail.
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
    echo '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="' . $m['farbe'] . '"><title>' . $h($m['app']) . ' – ' . $h($titel) . '</title>'
        . ($m['symbol'] ? '<link rel="icon" href="' . $h($m['symbol']) . '"><link rel="apple-touch-icon" href="' . $h($m['symbol']) . '">' : '')
        . '<meta name="apple-mobile-web-app-title" content="' . $h($titel === 'Winterdienst' ? $m['app'] : $titel) . '">'
        . '<style>body{margin:0;padding:1rem;background:#f3f6f8;color:#13232f;font:1.1rem/1.5 "Segoe UI",Roboto,"Helvetica Neue",Arial,system-ui,sans-serif}'
        . 'main{max-width:30rem;margin:1rem auto;padding:1.5rem;background:#fff;border-radius:12px;box-shadow:0 1px 2px rgb(19 35 47/.06),0 6px 20px rgb(19 35 47/.08)}'
        . 'img.logo{display:block;max-width:180px;max-height:64px;margin:0 0 1rem}h1{font-size:1.4rem;margin:0 0 .5rem}h2{font-size:1.1rem;margin:1.5rem 0 .4rem}p,.leise{color:' . $m['leise'] . '}'
        . 'label{display:block;margin:.8rem 0 .2rem;font-weight:600}label.haken{display:flex;gap:.6rem;align-items:center;font-weight:400;margin:.4rem 0}label.haken input{width:1.4rem;height:1.4rem}'
        . 'select,input[type=time],textarea,input[type=file]{font:inherit;width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #c9d6df;border-radius:8px;background:#fff;color:inherit}'
        . 'button,a.knopf{display:block;box-sizing:border-box;text-align:center;text-decoration:none;font:inherit;font-weight:700;font-size:1.2rem;color:#fff;background:' . $m['farbe'] . ';border:0;border-radius:8px;padding:.85rem 1.4rem;width:100%;cursor:pointer;margin-top:1.2rem}'
        . '.ok{background:#eef6e2;color:#4e7a1e;border-radius:8px;padding:.6rem .8rem;font-weight:600}.fehler{background:#fce8e6;color:#b3261e;border-radius:8px;padding:.6rem .8rem}'
        . 'ul{padding-left:1.2rem}li{margin:.2rem 0}</style>' . ($skript ? '<script src="' . $h($skript) . '" defer></script>' : '') . '</head>'
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
