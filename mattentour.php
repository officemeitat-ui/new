<?php
// Mattenwechsel: Fahrerseite am Webspace für Fahrer ohne Microsoft-Konto (Paket P10b, Entscheidung E7 „gemischt“).
//
// Fahrer mit Firmenkonto arbeiten in der App („Matten-Touren“). Wer kein Konto hat, bekommt einen persönlichen Link
// wie bei „Plan am Handy“ (mattentour.php?p=CODE); ist die Person in den Mitarbeitenden und hat sie schon den Link von
// „Plan am Handy“, gilt dieser (das Handy kennt ihn als Cookie mein_plan). Beim ersten Öffnen merkt sich das Handy den
// Code (Cookie mattentour, 400 Tage). Am Server liegt nur der Hashwert des Codes.
//
// Was der Fahrer sieht: die Touren, die das Büro für ihn freigegeben hat (heute bis +7 Tage, ältere offene oben), mit
// Fortschritt, Ladeliste (Mattenbedarf je Größe), „Tour starten“, „Navigation starten“ (Google Maps) und die Stopps der
// Reihe nach. Je Stopp: Kunde, Objekt, Adresse, Zeitfenster, Liegeplätze mit Stockwerk, Zugang, Hinweis und Soll-Matten;
// je Liegeplatz „Gewechselt“ (Menge mit Plus/Minus) oder „Nicht möglich“ mit Grund, Bemerkung, Fotos; Abschluss mit
// Unterschrift am Gerät (Name, Funktion) oder „ohne Unterschrift“ mit Grund, Ausnahmen wie „Kunde nicht angetroffen“;
// danach der nächste offene Stopp. Ohne Skript geht alles außer der Unterschrift (Formulare); mit Skript
// (mattentour.js) merkt sich das Handy die Eingaben und sendet nach einem Funkloch nach.
//
// Datenfluss: Die App überträgt beim Freigeben die Tour ohne Preise und ohne Kundenstammdaten (aktion=tour), beim
// Zurücknehmen entfernt sie sie wieder (aktion=tour-entfernen). Was der Fahrer meldet (Tour gestartet, unterwegs,
// Stopp abgeschlossen mit Fotos und Unterschrift), liegt hier als Meldung mit eigener Kennung: dieselbe Meldung zweimal
// gilt einmal. Die App holt die Meldungen ab (aktion=meldungen, Fotos über aktion=foto), übernimmt sie mit denselben
// Rechenkernen wie in der App in die Tour in SharePoint und meldet „übernommen“ (aktion=uebernommen): dann löscht der
// Webspace Fotos, Unterschrift, Name und Bemerkungen; es bleibt nur der Stand (für die Anzeige). Touren, deren Tag
// länger als die Frist (Vorgabe 14 Tage) zurückliegt, löscht der Webspace ganz, mit allem, was daran hängt.
//
// Gespeichert unter privat/ (per .htaccess gesperrt): privat/mattentour.json (Einstellungen mit Schlüssel),
// privat/matten/touren/<TourId>.json (Tour und Meldungen), privat/matten/fahrer/<Hash>.json (Name, Sprache, Touren),
// privat/matten/fotos/<Meldung>-<Nr>.jpg (bis zur Übernahme), privat/matten/grenzen.json (Zähler, ohne Klartext).
//
// Aufrufe der App (Schlüssel im Kopf X-Schluessel):
//   aktion=einrichten | status | fahrer | tour | tour-entfernen | meldungen | foto | uebernommen
// Erste Einrichtung: privat/mattentour.json per FTP, oder „einrichten“ mit dem Schlüssel von Plan am Handy,
// Schnee-Alarm oder Kundenbereich im Kopf X-Freigabe, solange es noch keine Einstellungen gibt.

declare(strict_types=1);

// Fehler nie in die Antwort (Serverpfade, Stacktraces), nur ins Fehlerprotokoll des Webspace
if (PHP_SAPI !== 'cli') {
    ini_set('display_errors', '0');
}

require __DIR__ . '/wetter-lib.php';
require __DIR__ . '/webspace-lib.php';

const COOKIE = 'mattentour';
const PLAN_COOKIE = 'mein_plan';
const ID_MUSTER = '/^[A-Za-z0-9_-]{4,40}$/';
const TEIL_MUSTER = '/^[A-Za-z0-9_.:-]{1,80}$/';
const HASH_MUSTER = '/^[a-f0-9]{64}$/';
const MELDUNG_MUSTER = '/^[a-z0-9]{8,32}$/';
const FOTO_MUSTER = '/^[a-z0-9]{8,32}-\d{1,2}\.jpg$/';
const UNTERSCHRIFT_MUSTER = '/^M[0-9. ML]{2,16000}$/';
const TOUR_STATUS = ['freigegeben', 'unterwegs', 'abgeschlossen'];
const STOPP_STATUS = ['geplant', 'unterwegs', 'in-bearbeitung', 'abgeschlossen', 'teilweise', 'nicht-angetroffen', 'nicht-durchgefuehrt'];
const FERTIG = ['abgeschlossen', 'teilweise', 'nicht-angetroffen', 'nicht-durchgefuehrt'];
const AUSNAHMEN = ['nicht-angetroffen', 'teilweise', 'nicht-durchgefuehrt'];
// Vorschläge wie in der App (core/matten-fahrt.js); der Wert bleibt deutsch (das Büro liest ihn), angezeigt wird die Übersetzung
const GRUENDE = ['kein Zugang' => 'mt_grund_zugang', 'Kunde nicht angetroffen' => 'mt_grund_nicht_da', 'Matte nicht vorhanden' => 'mt_grund_matte', 'Liegeplatz belegt (Baustelle, Umbau)' => 'mt_grund_belegt', 'Kunde wünscht keinen Wechsel' => 'mt_grund_kein_wechsel'];
const OHNE_GRUENDE = ['niemand vor Ort' => 'mt_ohne_niemand', 'Kunde nicht angetroffen' => 'mt_grund_nicht_da', 'keine Zeit beim Kunden' => 'mt_ohne_zeit', 'Bestätigung folgt per E-Mail' => 'mt_ohne_mail'];
const ROLLEN = ['Kunde' => 'mt_rolle_kunde', 'Hausbetreuung' => 'mt_rolle_haus', 'Portier' => 'mt_rolle_portier', 'Hausverwaltung' => 'mt_rolle_verwaltung', 'Filialleitung' => 'mt_rolle_filiale'];
const STATUS_TEXT = ['geplant' => 'mt_st_geplant', 'unterwegs' => 'mt_st_unterwegs', 'in-bearbeitung' => 'mt_st_bearbeitung', 'abgeschlossen' => 'mt_st_abgeschlossen', 'teilweise' => 'mt_st_teilweise', 'nicht-angetroffen' => 'mt_st_nicht_da', 'nicht-durchgefuehrt' => 'mt_st_nicht_durchgefuehrt', 'freigegeben' => 'mt_st_freigegeben'];
const STATUS_DE = ['abgeschlossen' => 'abgeschlossen', 'teilweise' => 'teilweise erledigt', 'nicht-angetroffen' => 'Kunde nicht angetroffen', 'nicht-durchgefuehrt' => 'nicht durchgeführt'];
const FOTO_MAX = 8;               // Fotos je Stopp
const FOTO_BYTES = 10 * 1024 * 1024;
const FRIST_TAGE = 14;            // Vorgabe: so lange bleiben Touren nach ihrem Tag am Webspace
// Grenzen: [Anzahl, Sekunden]
const GRENZE_FEHLVERSUCHE = [20, 900];   // unbekannte Codes je Adresse
const GRENZE_MELDUNGEN = [300, 86400];   // Meldungen je Fahrer und Tag
const GRENZE_FOTOS = [100, 86400];       // Fotos je Fahrer und Tag

// ---------------------------------------------------------------- Ablage

function jetzt(): int
{
    $t = getenv('WETTER_JETZT'); // nur für Tests
    return $t !== false && $t !== '' ? (int) $t : time();
}

function ordner(): string
{
    return getenv('MATTEN_ORDNER') ?: __DIR__ . '/privat';
}

function heute(): string
{
    return (new DateTimeImmutable('@' . jetzt()))->setTimezone(new DateTimeZone('Europe/Vienna'))->format('Y-m-d');
}

function tag_plus(string $datum, int $tage): string
{
    return (new DateTimeImmutable($datum, new DateTimeZone('UTC')))->modify(($tage >= 0 ? '+' : '') . $tage . ' days')->format('Y-m-d');
}

function uhr(int $ts): string
{
    return (new DateTimeImmutable('@' . $ts))->setTimezone(new DateTimeZone('Europe/Vienna'))->format('H:i');
}

function speicher(string $unter = ''): string
{
    $d = ordner() . '/matten' . ($unter !== '' ? '/' . $unter : '');
    if (!is_dir($d)) {
        @mkdir($d, 0775, true);
    }
    return $d;
}

/** JSON lesen; wartet, solange gerade jemand die Datei gesperrt ändert (gesperrt() schreibt an Ort und Stelle). */
function json_lesen(string $datei): array
{
    $h = is_file($datei) ? @fopen($datei, 'r') : false;
    if (!$h) {
        return [];
    }
    flock($h, LOCK_SH);
    $d = json_decode((string) stream_get_contents($h), true);
    flock($h, LOCK_UN);
    fclose($h);
    return is_array($d) ? $d : [];
}

function json_schreiben(string $datei, array $daten): bool
{
    $tmp = $datei . '.' . bin2hex(random_bytes(4));
    return @file_put_contents($tmp, json_encode($daten, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX) !== false && @rename($tmp, $datei);
}

/** Datei gesperrt ändern; $fn bekommt den Inhalt per Referenz, Rückgabe wird durchgereicht (null: nicht schreibbar). */
function gesperrt(string $datei, callable $fn)
{
    $h = @fopen($datei, 'c+');
    if (!$h) {
        return null;
    }
    flock($h, LOCK_EX);
    $daten = json_decode((string) stream_get_contents($h), true);
    $daten = is_array($daten) ? $daten : [];
    $vorher = $daten;
    $ergebnis = $fn($daten);
    if ($daten !== $vorher) {
        ftruncate($h, 0);
        rewind($h);
        fwrite($h, json_encode($daten, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
        fflush($h);
    }
    flock($h, LOCK_UN);
    fclose($h);
    return $ergebnis;
}

function einstellungen(): ?array
{
    $e = json_lesen(ordner() . '/mattentour.json');
    return is_string($e['schluessel'] ?? null) && strlen($e['schluessel']) >= 32 ? $e : null;
}

function frist(?array $e): int
{
    $f = (int) ($e['frist'] ?? FRIST_TAGE);
    return max(7, min(60, $f ?: FRIST_TAGE));
}

function json_ausgabe(int $status, array $daten): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($daten, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Text kürzen, Steuerzeichen weg (Zeilenumbrüche bleiben). */
function kurz($wert, int $n): string
{
    return mb_substr(trim(preg_replace('/[\x00-\x09\x0B-\x1F\x7F]/u', '', is_scalar($wert) ? (string) $wert : '') ?? ''), 0, $n);
}

function tour_datei(string $id): string
{
    return speicher('touren') . '/' . $id . '.json';
}

function fahrer_datei(string $hash): string
{
    return speicher('fahrer') . '/' . $hash . '.json';
}

function foto_pfad(string $datei): string
{
    return speicher('fotos') . '/' . $datei;
}

/** Zähler je Art und Absender (Hashwert, kein Klartext): true, wenn die Grenze erreicht ist. $zaehlen: mitzählen. */
function grenze(string $art, string $wer, array $grenze, bool $zaehlen, int $n = 1): bool
{
    [$max, $sekunden] = $grenze;
    $schluessel = substr(hash('sha256', $art . '|' . $wer . '|' . date('Y')), 0, 20);
    $erreicht = gesperrt(speicher() . '/grenzen.json', function (array &$alle) use ($schluessel, $max, $sekunden, $zaehlen, $n) {
        $alle = array_filter(array_map(fn ($l) => array_values(array_filter((array) $l, fn ($t) => (int) $t > jetzt() - 86400)), $alle));
        $liste = array_values(array_filter($alle[$schluessel] ?? [], fn ($t) => (int) $t > jetzt() - $sekunden));
        if (count($liste) >= $max || count($liste) + ($zaehlen ? $n : 0) > $max) {
            return true;
        }
        if ($zaehlen) {
            for ($i = 0; $i < $n; $i++) {
                $liste[] = jetzt();
            }
            $alle[$schluessel] = $liste;
        }
        return false;
    });
    return $erreicht === true;
}

/** Formular von einer fremden Seite? (Browser schicken Sec-Fetch-Site mit) */
function fremde_herkunft(): bool
{
    $herkunft = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    return $herkunft !== '' && $herkunft !== 'same-origin' && $herkunft !== 'none';
}

function will_json(): bool
{
    return str_contains((string) ($_SERVER['HTTP_ACCEPT'] ?? ''), 'application/json');
}

// ---------------------------------------------------------------- Touren und Meldungen

/** Zahl als Koordinate (oder null). */
function koordinate($v, float $grenze): ?float
{
    return is_numeric($v) && abs((float) $v) <= $grenze ? round((float) $v, 6) : null;
}

/**
 * Tour aus der App prüfen und auf das Nötige kürzen: Kunde (Name), Objekt, Adresse, Koordinaten, Zeitfenster,
 * Ankunft, Liegeplätze mit Stockwerk, Zugang, Hinweis und Matten (Bezeichnung, Soll), Ladeliste. Alles andere fällt weg
 * (keine Preise, keine Kundennummern, keine E-Mail-Adressen). null, wenn Kennung, Tag oder Fahrer nicht stimmen.
 */
function tour_bereinigen(array $d): ?array
{
    $id = (string) ($d['id'] ?? '');
    $datum = (string) ($d['datum'] ?? '');
    $f = is_array($d['fahrer'] ?? null) ? $d['fahrer'] : [];
    $hash = (string) ($f['hash'] ?? '');
    if (!preg_match(ID_MUSTER, $id) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $datum) || !preg_match(HASH_MUSTER, $hash)) {
        return null;
    }
    $zeit = fn ($v) => is_string($v) && preg_match('/^\d{2}:\d{2}$/', $v) ? $v : '';
    $stopps = [];
    $ids = [];
    foreach (array_slice(array_values((array) ($d['stopps'] ?? [])), 0, 80) as $s) {
        $sid = (string) ($s['id'] ?? '');
        if (!is_array($s) || !preg_match(TEIL_MUSTER, $sid) || isset($ids[$sid])) {
            continue;
        }
        $ids[$sid] = true;
        $lps = [];
        $lpIds = [];
        foreach (array_slice(array_values((array) ($s['liegeplaetze'] ?? [])), 0, 40) as $l) {
            $lid = (string) ($l['id'] ?? '');
            if (!is_array($l) || !preg_match(TEIL_MUSTER, $lid) || isset($lpIds[$lid])) {
                continue;
            }
            $lpIds[$lid] = true;
            $matten = [];
            foreach (array_slice(array_values((array) ($l['matten'] ?? [])), 0, 20) as $m) {
                $i = is_array($m) && is_numeric($m['i'] ?? null) ? (int) $m['i'] : -1;
                if ($i < 0 || $i > 999) {
                    continue;
                }
                $matten[] = ['i' => $i, 'bezeichnung' => kurz($m['bezeichnung'] ?? '', 80), 'soll' => max(0, min(999, (int) ($m['soll'] ?? 0)))];
            }
            $lps[] = ['id' => $lid, 'name' => kurz($l['name'] ?? '', 80), 'stockwerk' => kurz($l['stockwerk'] ?? '', 40), 'zugang' => kurz($l['zugang'] ?? '', 200), 'hinweis' => kurz($l['hinweis'] ?? '', 300), 'matten' => $matten];
        }
        $fenster = is_array($s['fenster'] ?? null) ? $s['fenster'] : [];
        $status = (string) ($s['status'] ?? 'geplant');
        $stopps[] = [
            'id' => $sid,
            'kunde' => kurz($s['kunde'] ?? '', 120),
            'objekt' => kurz($s['objekt'] ?? '', 120),
            'adresse' => kurz($s['adresse'] ?? '', 200),
            'lat' => koordinate($s['lat'] ?? null, 90),
            'lon' => koordinate($s['lon'] ?? null, 180),
            'ankunft' => $zeit($s['ankunft'] ?? ''),
            'fenster' => ['von' => $zeit($fenster['von'] ?? ''), 'bis' => $zeit($fenster['bis'] ?? ''), 'hinweis' => kurz($fenster['hinweis'] ?? '', 120)],
            'status' => in_array($status, STOPP_STATUS, true) ? $status : 'geplant',
            'liegeplaetze' => $lps,
        ];
    }
    $ladeliste = [];
    foreach (array_slice(array_values((array) ($d['ladeliste'] ?? [])), 0, 40) as $r) {
        if (is_array($r)) {
            $ladeliste[] = ['groesse' => kurz($r['groesse'] ?? '', 60), 'farbe' => kurz($r['farbe'] ?? '', 40), 'bezeichnung' => kurz($r['bezeichnung'] ?? '', 80), 'stueck' => max(0, min(9999, (int) ($r['stueck'] ?? 0))), 'stopps' => max(0, min(999, (int) ($r['stopps'] ?? 0)))];
        }
    }
    $status = (string) ($d['status'] ?? 'freigegeben');
    return [
        'id' => $id,
        'datum' => $datum,
        'status' => in_array($status, TOUR_STATUS, true) ? $status : 'freigegeben',
        'fahrer' => ['hash' => $hash, 'name' => kurz($f['name'] ?? '', 80), 'sprache' => sprache_gueltig($f['sprache'] ?? null) ?? 'de'],
        'fahrzeug' => kurz($d['fahrzeug'] ?? '', 80),
        'stopps' => $stopps,
        'ladeliste' => $ladeliste,
    ];
}

/** Fotos einer Meldung löschen. */
function fotos_loeschen(array $m): void
{
    foreach ((array) ($m['fotos'] ?? []) as $f) {
        if (preg_match(FOTO_MUSTER, (string) ($f['datei'] ?? ''))) {
            @unlink(foto_pfad((string) $f['datei']));
        }
    }
}

/**
 * Vorläufig gespeicherte Fotos einer neuen Meldung an ihre festen Namen ([fester Name => vorläufiger Name]); klappt
 * eines nicht, kommen die schon umbenannten wieder weg (false).
 */
function fotos_uebernehmen(array $vorlaeufig): bool
{
    $fertig = [];
    foreach ($vorlaeufig as $datei => $tmp) {
        if (!@rename(foto_pfad($tmp), foto_pfad((string) $datei))) {
            foreach ($fertig as $x) {
                @unlink(foto_pfad($x));
            }
            return false;
        }
        $fertig[] = (string) $datei;
    }
    return true;
}

/** Nach der Übernahme bleibt nur der Stand: keine Fotos, keine Unterschrift, keine Namen, keine Bemerkungen. */
function meldung_kuerzen(array $m): array
{
    fotos_loeschen($m);
    $m['fotos'] = [];
    $d = (array) ($m['daten'] ?? []);
    unset($d['unterschrift'], $d['ohne'], $d['notiz']);
    $d['liegeplaetze'] = array_map(function ($l) {
        unset($l['bemerkung'], $l['grund']);
        return $l;
    }, (array) ($d['liegeplaetze'] ?? []));
    $m['daten'] = $d;
    return $m;
}

/** Tour aus dem Index des Fahrers nehmen (bzw. eintragen). */
function fahrer_index(string $hash, string $tourId, ?string $datum): void
{
    if (!preg_match(HASH_MUSTER, $hash)) {
        return;
    }
    gesperrt(fahrer_datei($hash), function (array &$f) use ($tourId, $datum) {
        $f['touren'] = (array) ($f['touren'] ?? []);
        if ($datum === null) {
            unset($f['touren'][$tourId]);
        } else {
            $f['touren'][$tourId] = $datum;
        }
    });
}

/** Tour mit allem entfernen (Fotos, Meldungen, Index). */
function tour_loeschen(string $id): void
{
    $t = json_lesen(tour_datei($id));
    foreach ((array) ($t['meldungen'] ?? []) as $m) {
        fotos_loeschen((array) $m);
    }
    @unlink(tour_datei($id));
    fahrer_index((string) ($t['tour']['fahrer']['hash'] ?? ''), $id, null);
}

/** Aufräumen: Touren, deren Tag länger als die Frist zurückliegt, mit allem; verwaiste Fotos (älter als 2 Tage). */
function aufraeumen(?array $e): int
{
    $grenze = tag_plus(heute(), -frist($e));
    $n = 0;
    $bekannt = [];
    foreach (glob(speicher('touren') . '/*.json') ?: [] as $f) {
        $id = basename($f, '.json');
        if (!preg_match(ID_MUSTER, $id)) {
            continue;
        }
        $t = json_lesen($f);
        if ((string) ($t['tour']['datum'] ?? '') < $grenze) {
            tour_loeschen($id);
            $n++;
            continue;
        }
        foreach ((array) ($t['meldungen'] ?? []) as $m) {
            foreach ((array) ($m['fotos'] ?? []) as $x) {
                $bekannt[(string) ($x['datei'] ?? '')] = true;
            }
        }
    }
    foreach (glob(speicher('fotos') . '/*.jpg') ?: [] as $f) {
        if (!isset($bekannt[basename($f)]) && (int) @filemtime($f) < jetzt() - 2 * 86400) {
            @unlink($f);
        }
    }
    // Fahrer ohne Touren, die die App nicht mehr kennt
    foreach (glob(speicher('fahrer') . '/*.json') ?: [] as $f) {
        $x = json_lesen($f);
        $touren = array_filter((array) ($x['touren'] ?? []), fn ($d) => $d >= $grenze);
        if (!$touren && !empty($x['entfernt'])) {
            @unlink($f);
        }
    }
    return $n;
}

/**
 * Stand einer Tour für die Anzeige: gestartet, je Stopp Status (aus der App bzw. den Meldungen), Abschluss, unterwegs.
 * [ 'gestartet' => bool, 'stopps' => [ id => [ 'status', 'fertig', 'zeit', 'meldung' ] ] ]
 */
function stand(array $datei): array
{
    $t = (array) ($datei['tour'] ?? []);
    $out = ['gestartet' => in_array($t['status'] ?? '', ['unterwegs', 'abgeschlossen'], true), 'stopps' => []];
    foreach ((array) ($t['stopps'] ?? []) as $s) {
        $out['stopps'][$s['id']] = ['status' => (string) $s['status'], 'fertig' => in_array($s['status'], FERTIG, true), 'zeit' => 0, 'meldung' => null];
    }
    foreach ((array) ($datei['meldungen'] ?? []) as $m) {
        $sid = (string) ($m['stopp'] ?? '');
        if (($m['art'] ?? '') === 'start') {
            $out['gestartet'] = true;
        } elseif (($m['art'] ?? '') === 'unterwegs' && isset($out['stopps'][$sid]) && !$out['stopps'][$sid]['fertig']) {
            $out['gestartet'] = true;
            $out['stopps'][$sid]['status'] = 'unterwegs';
        } elseif (($m['art'] ?? '') === 'abschluss' && isset($out['stopps'][$sid])) {
            $out['gestartet'] = true;
            $out['stopps'][$sid] = ['status' => (string) $m['status'], 'fertig' => true, 'zeit' => (int) $m['zeit'], 'meldung' => $m];
        }
    }
    return $out;
}

/** Nächster offener Stopp nach $nach (übersprungene davor kommen am Ende dran); null = alle fertig. */
function naechster_stopp(array $tour, array $stand, string $nach = ''): ?array
{
    $liste = (array) ($tour['stopps'] ?? []);
    $i = -1;
    foreach ($liste as $k => $s) {
        if ($s['id'] === $nach) {
            $i = $k;
        }
    }
    $reihe = array_merge(array_slice($liste, $i + 1), array_slice($liste, 0, max(0, $i + 1)));
    foreach ($reihe as $s) {
        if ($s['id'] !== $nach && empty($stand['stopps'][$s['id']]['fertig'])) {
            return $s;
        }
    }
    return null;
}

/** Status eines Stopps aus den Ergebnissen je Liegeplatz (wie derivedStopStatus in der App). */
function abgeleiteter_status(array $ergebnisse, string $ausnahme): string
{
    $gew = count(array_filter($ergebnisse, fn ($e) => $e['ergebnis'] === 'gewechselt'));
    $offen = count(array_filter($ergebnisse, fn ($e) => $e['ergebnis'] === ''));
    if ($gew === count($ergebnisse) && $gew > 0) {
        return 'abgeschlossen';
    }
    if ($gew > 0) {
        return 'teilweise';
    }
    if ($offen && $ausnahme === 'nicht-angetroffen') {
        return 'nicht-angetroffen';
    }
    $alleNichtDa = $ergebnisse && !array_filter($ergebnisse, fn ($e) => !($e['ergebnis'] === 'nicht-moeglich' && $e['grund'] === 'Kunde nicht angetroffen') && !($e['ergebnis'] === '' && $ausnahme === 'nicht-angetroffen'));
    return $alleNichtDa ? 'nicht-angetroffen' : 'nicht-durchgefuehrt';
}

/** Zeitpunkt einer Meldung: Zeit am Handy (nachgesendet nach dem Funkloch), wenn plausibel, sonst die des Servers. */
function meldezeit($handy): int
{
    $ms = is_numeric($handy) ? (int) $handy : 0;
    $t = intdiv($ms, 1000);
    return $t > jetzt() - 2 * 86400 && $t <= jetzt() + 300 ? $t : jetzt();
}

/**
 * Meldung an eine Tour anhängen (gesperrt): dieselbe Kennung zweimal = einmal ('doppelt'); ein zweiter Abschluss
 * desselben Stopps ('schon'); Tour weg ('weg'). Sonst 'ok'. $vorher läuft nur für eine neue Meldung, noch unter der
 * Sperre (Fotos an ihren festen Namen); liefert es false, wird die Meldung nicht angehängt ('fehler').
 */
function meldung_anhaengen(string $tourId, array $m, ?callable $vorher = null): string
{
    return (string) gesperrt(tour_datei($tourId), function (array &$d) use ($m, $vorher) {
        if (empty($d['tour'])) {
            return 'weg';
        }
        $d['meldungen'] = (array) ($d['meldungen'] ?? []);
        foreach ($d['meldungen'] as $x) {
            if (($x['id'] ?? '') === $m['id']) {
                return 'doppelt';
            }
        }
        $st = stand($d);
        if ($m['art'] === 'abschluss' && !empty($st['stopps'][$m['stopp']]['fertig'])) {
            return 'schon';
        }
        if ($m['art'] === 'start' && $st['gestartet']) {
            return 'doppelt';
        }
        if ($m['art'] === 'unterwegs' && (!empty($st['stopps'][$m['stopp']]['fertig']) || ($st['stopps'][$m['stopp']]['status'] ?? '') === 'unterwegs')) {
            return 'doppelt';
        }
        if ($vorher && !$vorher()) {
            return 'fehler';
        }
        $d['meldungen'][] = $m;
        return 'ok';
    }) ?: 'fehler';
}

// ---------------------------------------------------------------- Fotos

/**
 * Hochgeladene Fotos eines Stopps: [[Liegeplatz, tmp, Größe, Fehler]] aus foto[<Liegeplatz>][]. Nur Liegeplätze
 * des Stopps zählen.
 */
function hochgeladene_fotos(array $liegeplaetze): array
{
    $f = $_FILES['foto'] ?? null;
    $out = [];
    if (!is_array($f) || !is_array($f['name'] ?? null)) {
        return $out;
    }
    foreach ($f['name'] as $lid => $namen) {
        if (!in_array((string) $lid, $liegeplaetze, true)) {
            continue;
        }
        foreach ((array) $namen as $k => $name) {
            $fehler = (int) ($f['error'][$lid][$k] ?? UPLOAD_ERR_NO_FILE);
            if ($fehler === UPLOAD_ERR_NO_FILE) {
                continue;
            }
            $out[] = [(string) $lid, (string) ($f['tmp_name'][$lid][$k] ?? ''), (int) ($f['size'][$lid][$k] ?? 0), $fehler];
        }
    }
    return $out;
}

/**
 * Foto prüfen und neu speichern (bild_speichern in webspace-lib.php: mit GD als JPEG, längste Seite 1600 px, ohne
 * Metadaten wie GPS; ohne GD nur JPEG ohne EXIF/GPS). Liefert den Fehler-Schlüssel ('' = gespeichert).
 */
function foto_speichern(string $tmp, int $groesse, int $fehler, string $ziel): string
{
    $f = bild_speichern($tmp, $groesse, $fehler, $ziel, FOTO_BYTES);
    return $f === '' ? '' : (['gross' => 'mt_fehler_foto_gross', 'typ' => 'mt_fehler_foto_typ'][$f] ?? 'mt_fehler_speichern');
}

// ---------------------------------------------------------------- Abschluss eines Stopps prüfen

/**
 * Formular „Stopp abschließen“ lesen und prüfen (wie finishProblem in der App). Liefert [Daten, Fehler-Schlüssel,
 * Werte für den Fehlertext]. Daten: liegeplaetze [{ id, ergebnis, mengen [{ i (Index der Matte im Stopp), ist }], grund, bemerkung }],
 * ausnahme, notiz, unterschrift { name, funktion, pfad } | null, ohne { grund } | null.
 */
function abschluss_lesen(array $stopp): array
{
    $erg = (array) ($_POST['ergebnis'] ?? []);
    $menge = (array) ($_POST['menge'] ?? []);
    $grund = (array) ($_POST['grund'] ?? []);
    $frei = (array) ($_POST['grund_frei'] ?? []);
    $bem = (array) ($_POST['bemerkung'] ?? []);
    $ausnahme = (string) ($_POST['ausnahme'] ?? '');
    $ausnahme = in_array($ausnahme, AUSNAHMEN, true) ? $ausnahme : '';
    $lps = [];
    $offen = [];
    foreach ((array) $stopp['liegeplaetze'] as $l) {
        $lid = $l['id'];
        $e = (string) ($erg[$lid] ?? '');
        $e = in_array($e, ['gewechselt', 'nicht-moeglich'], true) ? $e : '';
        $mengen = [];
        foreach ((array) $l['matten'] as $m) {
            $roh = $menge[(string) $m['i']] ?? null;
            $mengen[] = ['i' => (int) $m['i'], 'ist' => is_numeric($roh) ? max(0, min(999, (int) $roh)) : (int) $m['soll']];
        }
        $g = kurz($frei[$lid] ?? '', 120) ?: kurz($grund[$lid] ?? '', 120);
        if ($e === 'nicht-moeglich' && $g === '') {
            return [null, 'mt_fehler_grund', ['name' => $l['name'] ?: t('mt_liegeplatz')]];
        }
        if ($e === '') {
            $offen[] = $l['name'] ?: t('mt_liegeplatz');
        }
        $lps[] = ['id' => $lid, 'ergebnis' => $e, 'mengen' => $e === 'gewechselt' ? $mengen : [], 'grund' => $e === 'nicht-moeglich' ? $g : '', 'bemerkung' => kurz($bem[$lid] ?? '', 500)];
    }
    if ($offen && !$ausnahme) {
        return [null, 'mt_fehler_offen', ['namen' => implode(', ', $offen)]];
    }
    if (!$offen) {
        $ausnahme = '';
    }
    if ($ausnahme === 'teilweise' && !array_filter($lps, fn ($x) => $x['ergebnis'] === 'gewechselt')) {
        return [null, 'mt_fehler_teilweise', []];
    }
    $name = kurz($_POST['name'] ?? '', 80);
    $funktion = kurz($_POST['funktion'] ?? '', 80);
    $pfad = trim((string) ($_POST['unterschrift'] ?? ''));
    $ohne = !empty($_POST['ohne']);
    $ohneGrund = kurz($_POST['ohne_grund'] ?? '', 120);
    $status = abgeleiteter_status($lps, $ausnahme);
    $unterschrift = null;
    $ohneDaten = null;
    if (!$ohne && $pfad !== '') {
        if (!preg_match(UNTERSCHRIFT_MUSTER, $pfad)) {
            return [null, 'mt_fehler_unterschrift', []];
        }
        if (mb_strlen($name) < 2) {
            return [null, 'mt_fehler_name', []];
        }
        $unterschrift = ['name' => $name, 'funktion' => $funktion, 'pfad' => $pfad];
    } elseif ($ohne || $status === 'nicht-angetroffen') {
        if ($ohneGrund === '' && $status !== 'nicht-angetroffen') {
            return [null, 'mt_fehler_ohne_grund', []];
        }
        $ohneDaten = ['grund' => $ohneGrund ?: 'Kunde nicht angetroffen'];
    } else {
        return [null, 'mt_fehler_bestaetigung', []];
    }
    return [['liegeplaetze' => $lps, 'ausnahme' => $ausnahme, 'notiz' => kurz($_POST['notiz'] ?? '', 500), 'unterschrift' => $unterschrift, 'ohne' => $ohneDaten], '', ['status' => $status]];
}

// ---------------------------------------------------------------- Aufrufe der App (mit Schlüssel)

$aktion = (string) ($_GET['aktion'] ?? '');
$methode = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$e = einstellungen();

if (in_array($aktion, ['einrichten', 'status', 'fahrer', 'tour', 'tour-entfernen', 'meldungen', 'foto', 'uebernommen'], true)) {
    $gegeben = (string) ($_SERVER['HTTP_X_SCHLUESSEL'] ?? '');
    if (!$e) {
        // erste Einrichtung ohne FTP: mit dem Schlüssel von Plan am Handy, Schnee-Alarm oder Kundenbereich
        $freigabe = (string) ($_SERVER['HTTP_X_FREIGABE'] ?? '');
        $andere = array_filter([
            (string) (json_lesen((getenv('MEIN_PLAN_ORDNER') ?: ordner()) . '/mitarbeiter.json')['schluessel'] ?? ''),
            (string) (json_lesen((getenv('WETTER_ALARM_ORDNER') ?: ordner()) . '/wetter-alarm.json')['schluessel'] ?? ''),
            (string) (json_lesen((getenv('KUNDEN_ORDNER') ?: ordner()) . '/kundenbereich.json')['schluessel'] ?? ''),
        ], fn ($k) => strlen($k) >= 32);
        $frei = $aktion === 'einrichten' && $freigabe !== '' && in_array(true, array_map(fn ($k) => hash_equals($k, $freigabe), $andere), true);
        if (!$frei) {
            json_ausgabe(503, ['fehler' => 'Fahrerseite noch nicht eingerichtet: privat/mattentour.json fehlt (App → Matten-Tourenplanung → Mehr → Fahrerseite am Webspace).']);
        }
    } elseif ($gegeben === '' || !hash_equals((string) $e['schluessel'], $gegeben)) {
        json_ausgabe(403, ['fehler' => 'Schlüssel fehlt oder falsch']);
    }

    if ($aktion === 'status') {
        aufraeumen($e);
        $touren = glob(speicher('touren') . '/*.json') ?: [];
        $offen = 0;
        foreach ($touren as $f) {
            $offen += count(array_filter((array) (json_lesen($f)['meldungen'] ?? []), fn ($m) => empty($m['uebernommen'])));
        }
        json_ausgabe(200, ['touren' => count($touren), 'offen' => $offen, 'gd' => function_exists('imagejpeg'), 'frist' => frist($e), 'jetzt' => jetzt()]);
    }
    if ($aktion === 'meldungen') {
        aufraeumen($e);
        $liste = [];
        foreach (glob(speicher('touren') . '/*.json') ?: [] as $f) {
            $d = json_lesen($f);
            foreach ((array) ($d['meldungen'] ?? []) as $m) {
                if (empty($m['uebernommen'])) {
                    $liste[] = $m + ['tour' => (string) ($d['tour']['id'] ?? ''), 'datum' => (string) ($d['tour']['datum'] ?? ''), 'fahrer' => (string) ($d['tour']['fahrer']['name'] ?? '')];
                }
            }
        }
        usort($liste, fn ($a, $b) => [(int) $a['zeit'], (int) $a['eingang']] <=> [(int) $b['zeit'], (int) $b['eingang']]);
        json_ausgabe(200, ['meldungen' => $liste, 'jetzt' => jetzt()]);
    }
    if ($aktion === 'foto') {
        $datei = (string) ($_GET['datei'] ?? '');
        $pfad = foto_pfad($datei);
        if (!preg_match(FOTO_MUSTER, $datei) || !is_file($pfad)) {
            json_ausgabe(404, ['fehler' => 'Foto nicht gefunden']);
        }
        header('Content-Type: image/jpeg');
        header('Cache-Control: private, no-store');
        header('X-Content-Type-Options: nosniff');
        header('Content-Length: ' . filesize($pfad));
        readfile($pfad);
        exit;
    }
    $daten = $methode === 'POST' ? json_decode((string) file_get_contents('php://input', false, null, 0, 2 * 1024 * 1024), true) : null;
    if ($methode !== 'POST' || !is_array($daten)) {
        json_ausgabe(400, ['fehler' => 'POST mit JSON erwartet']);
    }
    if ($aktion === 'einrichten') {
        if (!is_string($daten['schluessel'] ?? null) || strlen($daten['schluessel']) < 32) {
            json_ausgabe(400, ['fehler' => 'Ungültige Einstellungen']);
        }
        $buero = [];
        foreach (array_slice((array) ($daten['buero'] ?? []), 0, 10) as $b) {
            $ntfy = is_string($b['ntfy'] ?? null) && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $b['ntfy']) ? $b['ntfy'] : '';
            $mail = filter_var($b['email'] ?? '', FILTER_VALIDATE_EMAIL) ? (string) $b['email'] : '';
            if ($ntfy || $mail) {
                $buero[] = ['name' => kurz($b['name'] ?? 'Büro', 40), 'ntfy' => $ntfy, 'email' => $mail];
            }
        }
        $neu = ['version' => 1, 'schluessel' => $daten['schluessel'], 'adresse' => preg_match('#^https?://#', (string) ($daten['adresse'] ?? '')) ? kurz($daten['adresse'], 200) : '', 'ntfy' => preg_match('#^https?://#', (string) ($daten['ntfy'] ?? '')) ? kurz($daten['ntfy'], 200) : '', 'absender' => filter_var($daten['absender'] ?? '', FILTER_VALIDATE_EMAIL) ? (string) $daten['absender'] : '', 'buero' => $buero, 'frist' => max(7, min(60, (int) ($daten['frist'] ?? FRIST_TAGE)))];
        if (!json_schreiben(ordner() . '/mattentour.json', $neu)) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        json_ausgabe(200, ['gespeichert' => true]);
    }
    if ($aktion === 'fahrer') {
        // die Fahrer ohne Konto (Hash, Name, Sprache): Link gilt sofort, auch vor der ersten Tour; nicht mehr genannte gelten nicht mehr
        $genannt = [];
        foreach (array_slice((array) ($daten['fahrer'] ?? []), 0, 200) as $f) {
            $hash = (string) ($f['hash'] ?? '');
            if (!preg_match(HASH_MUSTER, $hash)) {
                continue;
            }
            $genannt[$hash] = true;
            gesperrt(fahrer_datei($hash), function (array &$x) use ($f) {
                $x['name'] = kurz($f['name'] ?? '', 80);
                $neu = sprache_gueltig($f['sprache'] ?? null) ?? 'de';
                if ($neu !== ($x['sprache'] ?? null)) {
                    unset($x['spracheWahl']); // im Büro geändert: gilt wieder (am Handy weiter umstellbar)
                }
                $x['sprache'] = $neu;
                $x['touren'] = (array) ($x['touren'] ?? []);
                unset($x['entfernt']);
            });
        }
        $entfernt = 0;
        foreach (glob(speicher('fahrer') . '/*.json') ?: [] as $datei) {
            $hash = basename($datei, '.json');
            if (!isset($genannt[$hash]) && preg_match(HASH_MUSTER, $hash)) {
                // Link gilt nicht mehr; laufende Touren bleiben bis zur Frist (Meldungen gehen nicht verloren)
                gesperrt($datei, function (array &$x) {
                    $x['entfernt'] = jetzt();
                });
                $entfernt++;
            }
        }
        aufraeumen($e);
        json_ausgabe(200, ['fahrer' => count($genannt), 'entfernt' => $entfernt]);
    }
    if ($aktion === 'tour') {
        $neu = tour_bereinigen($daten);
        if (!$neu) {
            json_ausgabe(400, ['fehler' => 'Tour unvollständig (Kennung, Tag oder Fahrer fehlt)']);
        }
        $alt = '';
        $ergebnis = gesperrt(tour_datei($neu['id']), function (array &$d) use ($neu, &$alt) {
            $alt = (string) ($d['tour']['fahrer']['hash'] ?? '');
            $d['tour'] = $neu + ['uebertragen' => jetzt()];
            $d['meldungen'] = (array) ($d['meldungen'] ?? []);
            return count(array_filter($d['meldungen'], fn ($m) => empty($m['uebernommen'])));
        });
        if ($ergebnis === null) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        if ($alt !== '' && $alt !== $neu['fahrer']['hash']) {
            fahrer_index($alt, $neu['id'], null); // anderer Fahrer: aus seiner Liste
        }
        gesperrt(fahrer_datei($neu['fahrer']['hash']), function (array &$x) use ($neu) {
            $x['name'] = $neu['fahrer']['name'];
            if (empty($x['sprache'])) {
                $x['sprache'] = $neu['fahrer']['sprache'];
            }
            $x['touren'] = (array) ($x['touren'] ?? []);
            $x['touren'][$neu['id']] = $neu['datum'];
            unset($x['entfernt']); // die App gibt ihm eine Tour: der Link gilt
        });
        aufraeumen($e);
        json_ausgabe(200, ['gespeichert' => true, 'offen' => $ergebnis]);
    }
    if ($aktion === 'tour-entfernen') {
        $id = (string) ($daten['id'] ?? '');
        if (!preg_match(ID_MUSTER, $id)) {
            json_ausgabe(400, ['fehler' => 'Ungültige Kennung']);
        }
        $d = json_lesen(tour_datei($id));
        $offen = count(array_filter((array) ($d['meldungen'] ?? []), fn ($m) => empty($m['uebernommen'])));
        if ($offen && empty($daten['erzwingen'])) {
            json_ausgabe(409, ['fehler' => 'Der Fahrer hat zu dieser Tour schon gemeldet; zuerst die Meldungen abholen.', 'offen' => $offen]);
        }
        if ($d) {
            tour_loeschen($id);
        }
        json_ausgabe(200, ['entfernt' => (bool) $d]);
    }
    if ($aktion === 'uebernommen') {
        $ids = array_flip(array_filter(array_map('strval', (array) ($daten['ids'] ?? [])), fn ($x) => preg_match(MELDUNG_MUSTER, $x)));
        $n = 0;
        foreach (glob(speicher('touren') . '/*.json') ?: [] as $f) {
            $n += (int) gesperrt($f, function (array &$d) use ($ids) {
                $k = 0;
                foreach ((array) ($d['meldungen'] ?? []) as $i => $m) {
                    if (isset($ids[$m['id'] ?? '']) && empty($m['uebernommen'])) {
                        $d['meldungen'][$i] = meldung_kuerzen($m);
                        $d['meldungen'][$i]['uebernommen'] = jetzt();
                        $k++;
                    }
                }
                return $k;
            });
        }
        json_ausgabe(200, ['markiert' => $n]);
    }
}

// ---------------------------------------------------------------- Seite für den Fahrer

$h = fn (string $t): string => htmlspecialchars($t, ENT_QUOTES);
const SEITE_STIL = '<style>'
    . '@media(max-width:30rem){body{padding:.5rem}main{padding:1rem;margin:.5rem auto}}.sprachwahl summary{min-height:44px;box-sizing:border-box}'
    . 'h1{overflow-wrap:anywhere}.mww-kopf{display:flex;flex-wrap:wrap;gap:.4rem .6rem;align-items:center}.mww-kopf h1,.mww-kopf h2{margin:0}'
    . '.mww-zurueck{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin:0 0 .6rem;flex-wrap:wrap}.mww-zurueck a{display:inline-flex;align-items:center;min-height:44px;color:#0a5a96;font-weight:600;text-decoration:none}.mww-zurueck span{color:#4b5b67;font-size:.95rem}'
    . '.pill{display:inline-block;border-radius:999px;padding:.05rem .6rem;font-size:.85rem;font-weight:600;background:#e8f1fa;color:#0a5a96;white-space:nowrap}.pill.ok{background:#eef6e2;color:#3f6a12}.pill.warn{background:#fdf0d5;color:#6b4100}.pill.err{background:#fce8e6;color:#b3261e}'
    . '.mww-kacheln{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem;margin:.8rem 0}.mww-kachel{background:#f3f6f8;border-radius:10px;padding:.45rem .3rem;text-align:center}.mww-kachel b{display:block;font-size:1.4rem;color:#13232f}.mww-kachel span{font-size:.85rem;color:#4b5b67}'
    . '.mww-balken{display:block;height:.55rem;background:#dde5ea;border-radius:999px;overflow:hidden;margin:.3rem 0 .6rem}.mww-balken span{display:block;height:100%;background:#3f6a12}'
    . 'a.knopf.zweit,button.zweit{background:#fff;color:#0a5a96;border:2px solid #0a5a96}button.klein{display:inline-block;width:auto;font-size:1rem;padding:.55rem .9rem;margin:.4rem 0 0;min-height:44px}'
    . '.mww-karte{display:block;border:1px solid #dde5ea;border-radius:12px;padding:.7rem .8rem;margin:.6rem 0;color:inherit;text-decoration:none}.mww-karte b{color:#13232f}.mww-karte>span{display:block}.mww-karte.alt{border-color:#e0a83a}'
    . '.mww-tabelle{width:100%;border-collapse:collapse;font-size:1rem}.mww-tabelle th,.mww-tabelle td{text-align:left;padding:.35rem .25rem;border-bottom:1px solid #dde5ea;vertical-align:top}.mww-tabelle .zahl{text-align:right;white-space:nowrap}'
    . '.mww-stopps{list-style:none;margin:0;padding:0}.mww-stopps li{margin:.45rem 0}.mww-stopps a{display:flex;gap:.7rem;padding:.6rem;border:1px solid #dde5ea;border-radius:10px;color:inherit;text-decoration:none;min-height:44px}'
    . '.mww-stopps .nr{flex:0 0 2rem;height:2rem;border-radius:999px;background:#e8f1fa;color:#0a5a96;display:flex;align-items:center;justify-content:center;font-weight:700}.mww-stopps li.fertig .nr{background:#eef6e2;color:#3f6a12}'
    . '.mww-stopps li.naechster a{border-color:#0a5a96;box-shadow:inset 0 0 0 1px #0a5a96}.mww-stopps .text{min-width:0;flex:1}.mww-stopps .text>span{display:block}.mww-stopps .leise{font-size:.95rem}'
    . '.mww-teil{display:none}.mww-teil.aktiv{display:block}'
    . '.mww-pl{border:1px solid #dde5ea;border-radius:12px;padding:.8rem;margin:.9rem 0}.mww-pl h3{margin:0;font-size:1.1rem}.mww-pl .meta{margin:.25rem 0;color:#4b5b67;font-size:.95rem}.mww-pl .hinweis{margin:.35rem 0;background:#fdf0d5;color:#6b4100;border-radius:8px;padding:.35rem .55rem;font-size:.95rem}'
    . '.mww-matte{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.4rem .8rem;margin:.55rem 0;padding:.4rem 0;border-top:1px solid #eef2f5}.mww-matte .soll{min-width:0}'
    . '.mww-menge{display:inline-flex;align-items:center;gap:.3rem}.mww-menge label{margin:0;font-weight:600;font-size:.95rem}.mww-menge button{width:44px;height:44px;margin:0;padding:0;font-size:1.4rem;line-height:1;display:inline-flex;align-items:center;justify-content:center}'
    . '.mww-menge input{width:3.6rem;height:44px;box-sizing:border-box;text-align:center;font:inherit;font-weight:700;border:1px solid #c9d6df;border-radius:8px}'
    . '.mww-wahl{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin:.6rem 0;border:0;padding:0}.mww-wahl legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.mww-wahl input{position:absolute;opacity:0;width:1px;height:1px;margin:0}'
    . '.mww-wahl label{margin:0;display:flex;align-items:center;justify-content:center;min-height:48px;border:2px solid #c9d6df;border-radius:10px;font-weight:700;cursor:pointer;text-align:center;padding:.3rem;background:#fff}'
    . '.mww-wahl input:checked+label{border-color:#3f6a12;background:#eef6e2;color:#2f520c}.mww-wahl input.nm:checked+label{border-color:#b3261e;background:#fce8e6;color:#8c1d17}.mww-wahl input:focus-visible+label{outline:3px solid #0a5a96;outline-offset:2px}'
    . 'input[type=text]{font:inherit;width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #c9d6df;border-radius:8px;background:#fff;color:inherit;min-height:44px}select{min-height:44px}'
    . 'label.haken{min-height:44px}.mww-fotos{display:flex;flex-wrap:wrap;gap:.4rem;margin:.4rem 0}.mww-fotos figure{margin:0;position:relative}.mww-fotos img{display:block;width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #c9d6df}'
    . '.mww-fotos button{position:absolute;top:-6px;right:-6px;width:32px;height:32px;min-height:0;margin:0;padding:0;border-radius:999px;font-size:1rem;background:#b3261e}'
    . '.mww-kamera{position:relative;display:flex;align-items:center;justify-content:center;gap:.4rem;min-height:44px;border:2px dashed #0a5a96;border-radius:10px;color:#0a5a96;font-weight:600;margin:.5rem 0 0;cursor:pointer}.mww-kamera input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}.mww-kamera:focus-within{outline:3px solid #0a5a96;outline-offset:2px}'
    . '.mww-abschluss{border-top:2px solid #dde5ea;margin-top:1.2rem;padding-top:.4rem}.mww-unterschrift canvas{display:block;width:100%;aspect-ratio:3/1;border:1px dashed #8a9aa5;border-radius:8px;background:#fff;touch-action:none}'
    . '.mww-fertig{background:#eef6e2;border-radius:12px;padding:.8rem;margin:.9rem 0}.mww-fertig.ausnahme{background:#fdf0d5}.mww-fertig h3{margin:0 0 .3rem;font-size:1.1rem}'
    . '.mww-ausgang{background:#fdf0d5;color:#6b4100;border-radius:10px;padding:.6rem .8rem;margin:.6rem 0}.mww-ausgang button{margin-top:.5rem}'
    . 'details.mww-ausnahmen summary{min-height:44px;display:flex;align-items:center;font-weight:600;cursor:pointer;color:#0a5a96}'
    . '@supports selector(:has(a)){.mww-pl .mww-grund{display:none}.mww-pl:has(input.nm:checked) .mww-grund{display:block}.mww-pl:has(input.nm:checked) .mww-mengen{display:none}'
    . '.mww-abschluss .mww-ohne-grund{display:none}.mww-abschluss:has(input[name=ohne]:checked) .mww-ohne-grund{display:block}.mww-abschluss:has(input[name=ohne]:checked) .mww-mit{display:none}}'
    . '</style>';

/** Seite im Design der App mit dem Stil der Fahrerseite und dem Skript (Eingaben merken, Unterschrift, nachsenden). */
function mt_seite(string $inhalt, int $status = 200): void
{
    html_seite(SEITE_STIL . $inhalt, $status, 'mattentour.js', t('mt_titel'));
    exit;
}

/** Datum als „heute, Mo 09.11.“ bzw. „morgen, …“ in der Sprache der Seite. */
function tag_text(string $d): string
{
    $wann = $d === heute() ? t('mt_heute') : ($d === tag_plus(heute(), 1) ? t('mt_morgen') : ($d === tag_plus(heute(), -1) ? t('mt_gestern') : ''));
    return ($wann !== '' ? $wann . ', ' : '') . datum_sprache($d);
}

function status_pill(string $status): string
{
    $cls = in_array($status, ['abgeschlossen'], true) ? 'ok' : (in_array($status, ['teilweise', 'in-bearbeitung', 'unterwegs'], true) ? 'warn' : (in_array($status, ['nicht-angetroffen', 'nicht-durchgefuehrt'], true) ? 'err' : ''));
    return '<span class="pill ' . $cls . '">' . htmlspecialchars(isset(STATUS_TEXT[$status]) ? t(STATUS_TEXT[$status]) : $status, ENT_QUOTES) . '</span>';
}

/** Google-Maps-Link wie navigationUrl in der App (Koordinaten, sonst Adresse); kein Schlüssel nötig. */
function navi_url(array $s): string
{
    $ziel = $s['lat'] !== null && $s['lon'] !== null ? $s['lat'] . ',' . $s['lon'] : (string) $s['adresse'];
    return 'https://www.google.com/maps/dir/?api=1&destination=' . rawurlencode($ziel);
}

function fenster_text(array $s): string
{
    $f = (array) ($s['fenster'] ?? []);
    if (($f['von'] ?? '') === '' && ($f['bis'] ?? '') === '') {
        return '';
    }
    return t('mt_zeitfenster', ['von' => ($f['von'] ?? '') ?: '…', 'bis' => ($f['bis'] ?? '') ?: '…']) . (($f['hinweis'] ?? '') !== '' ? ' · ' . $f['hinweis'] : '');
}

function stopp_titel(array $s): string
{
    return (string) ($s['kunde'] ?: ($s['objekt'] ?: t('mt_stopp')));
}

if (!$e) {
    sprache_waehlen([], true);
    mt_seite('<h1>' . th('mt_titel') . '</h1><p>' . th('nicht_eingerichtet') . '</p>', 503);
}
if ($aktion === 'vergessen') {
    sprache_waehlen([], true);
    setcookie(COOKIE, '', ['expires' => 1, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']), 'httponly' => true, 'samesite' => 'Lax']);
    mt_seite('<h1>' . th('mt_titel') . '</h1><p>' . th('vergessen_text') . '</p>');
}

// Wer ist das? Code aus dem Link (bzw. Formular), sonst das Gerät (eigener Cookie, dann der von Plan am Handy)
$wer = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
if (grenze('fehlversuch', $wer, GRENZE_FEHLVERSUCHE, false)) {
    // zu viele falsche Codes von dieser Verbindung: eine Viertelstunde warten (wie im Kundenbereich)
    sprache_waehlen([], true);
    mt_seite('<h1>' . th('mt_titel') . '</h1><p>' . th('mt_zu_viele') . '</p>', 429);
}
$explizit = (string) ($_POST['p'] ?? $_GET['p'] ?? '');
$codes = array_values(array_unique(array_filter([$explizit, (string) ($_COOKIE[COOKIE] ?? ''), (string) ($_COOKIE[PLAN_COOKIE] ?? '')])));
$code = '';
$hash = '';
$fahrer = [];
foreach ($codes as $c) {
    if (!preg_match('/^[A-Za-z0-9]{16,40}$/', $c)) {
        continue;
    }
    $x = json_lesen(fahrer_datei(hash('sha256', $c)));
    if ($x && empty($x['entfernt'])) {
        [$code, $hash, $fahrer] = [$c, hash('sha256', $c), $x];
        break;
    }
}
sprache_waehlen($fahrer, true);
if (!$fahrer || ($explizit !== '' && $code !== $explizit)) {
    if ($explizit !== '') {
        grenze('fehlversuch', $wer, GRENZE_FEHLVERSUCHE, true); // nur ausdrücklich genannte Codes zählen
    }
    if (will_json()) {
        json_ausgabe(404, ['fehler' => t('mt_link_ungueltig'), 'code' => 'link']);
    }
    mt_seite('<h1>' . th('mt_titel') . '</h1><p>' . th('mt_link_ungueltig') . '</p>', $codes ? 404 : 200);
}
$gewaehlt = sprache_gueltig($_GET['sprache'] ?? null);
if ($gewaehlt && $gewaehlt !== ($fahrer['spracheWahl'] ?? null)) {
    gesperrt(fahrer_datei($hash), function (array &$x) use ($gewaehlt) {
        $x['spracheWahl'] = $gewaehlt;
    });
}
if (isset($_GET['p']) && $code === (string) $_GET['p'] && !headers_sent()) {
    // merken: danach genügt mattentour.php (z. B. als Symbol am Startbildschirm)
    setcookie(COOKIE, $code, ['expires' => jetzt() + 400 * 86400, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']), 'httponly' => true, 'samesite' => 'Lax']);
}

// Touren des Fahrers: heute bis +7 Tage, ältere noch offene (bis zur Frist), heute abgeschlossene
$meine = [];
foreach ((array) ($fahrer['touren'] ?? []) as $tid => $datum) {
    if (!preg_match(ID_MUSTER, (string) $tid) || $datum > tag_plus(heute(), 7) || $datum < tag_plus(heute(), -frist($e))) {
        continue;
    }
    $d = json_lesen(tour_datei((string) $tid));
    if (($d['tour']['fahrer']['hash'] ?? '') !== $hash) {
        continue;
    }
    $st = stand($d);
    $fertig = $d['tour']['stopps'] && !array_filter($st['stopps'], fn ($x) => !$x['fertig']);
    if ($datum < heute() && $fertig) {
        continue;
    }
    $meine[(string) $tid] = ['datei' => $d, 'stand' => $st, 'fertig' => $fertig, 'alt' => $datum < heute() && !$fertig];
}
uasort($meine, fn ($a, $b) => [!$a['alt'], $a['fertig'], $a['datei']['tour']['datum']] <=> [!$b['alt'], $b['fertig'], $b['datei']['tour']['datum']]);

// ---------------------------------------------------------------- Meldung des Fahrers (Start, unterwegs, Abschluss)

if ($aktion === 'meldung' && $methode === 'POST') {
    $antwort = function (int $status, string $schluessel, array $werte = [], array $extra = []) {
        if (will_json()) {
            json_ausgabe($status, ['fehler' => t($schluessel, $werte), 'code' => $schluessel] + $extra);
        }
        mt_seite('<h1>' . th('mt_titel') . '</h1><p class="fehler" role="alert">' . htmlspecialchars(t($schluessel, $werte), ENT_QUOTES) . '</p><p><a class="knopf" href="mattentour.php">' . th('mt_zurueck_tour') . '</a></p>', $status);
    };
    if (fremde_herkunft()) {
        $antwort(403, 'nicht_erlaubt');
    }
    // zu groß für den Webspace (post_max_size): PHP verwirft dann das ganze Formular
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0 && !$_POST) {
        $antwort(413, 'mt_fehler_zu_gross');
    }
    $tid = (string) ($_POST['tour'] ?? '');
    $sid = (string) ($_POST['stopp'] ?? '');
    $art = (string) ($_POST['art'] ?? '');
    $mid = (string) ($_POST['meldung'] ?? '');
    $eintrag = $meine[$tid] ?? null;
    if (!$eintrag || !preg_match(MELDUNG_MUSTER, $mid) || !in_array($art, ['start', 'unterwegs', 'abschluss'], true)) {
        $antwort(404, 'mt_tour_weg');
    }
    $tour = $eintrag['datei']['tour'];
    $stopp = null;
    foreach ($tour['stopps'] as $s) {
        if ($s['id'] === $sid) {
            $stopp = $s;
        }
    }
    if ($art !== 'start' && !$stopp) {
        $antwort(404, 'mt_tour_weg');
    }
    if (grenze('meldung', $hash, GRENZE_MELDUNGEN, true)) {
        $antwort(429, 'mt_zu_viele');
    }
    $m = ['id' => $mid, 'art' => $art, 'stopp' => $art === 'start' ? '' : $sid, 'zeit' => meldezeit($_POST['zeit'] ?? null), 'eingang' => jetzt(), 'uebernommen' => null];
    $fotos = [];
    // Fotos zuerst unter vorläufigen Namen; an ihre festen Namen (Kennung der Meldung) kommen sie nur mit einer neuen
    // Meldung. Dieselbe Meldung noch einmal gesendet (Ausgang nach einem Funkloch, Formular neu gesendet) darf die Fotos
    // des schon angenommenen Abschlusses weder ersetzen noch löschen: der Stopp ist fest, die App holt sie noch ab.
    $vorlaeufig = [];
    $verwerfen = function () use (&$vorlaeufig): void {
        foreach ($vorlaeufig as $tmp) {
            @unlink(foto_pfad($tmp));
        }
    };
    if ($art === 'abschluss') {
        [$daten, $fehler, $werte] = abschluss_lesen($stopp);
        if ($fehler) {
            $antwort(400, $fehler, $werte, ['stopp' => $sid]);
        }
        $m['status'] = $werte['status'];
        $m['daten'] = $daten;
        $roh = hochgeladene_fotos(array_column($stopp['liegeplaetze'], 'id'));
        if (count($roh) > FOTO_MAX) {
            $antwort(400, 'mt_fehler_foto_max', ['n' => FOTO_MAX]);
        }
        if ($roh && grenze('foto', $hash, GRENZE_FOTOS, true, count($roh))) {
            $antwort(429, 'mt_zu_viele');
        }
        foreach ($roh as $k => [$lid, $tmp, $groesse, $fehlerCode]) {
            $datei = $mid . '-' . ($k + 1) . '.jpg';
            $vorlaeufig[$datei] = $mid . '-' . ($k + 1) . '.' . bin2hex(random_bytes(6)) . '.jpg';
            $f = foto_speichern($tmp, $groesse, $fehlerCode, foto_pfad($vorlaeufig[$datei]));
            if ($f) {
                $verwerfen();
                $antwort(400, $f);
            }
            $fotos[] = ['datei' => $datei, 'liegeplatz' => $lid, 'groesse' => (int) filesize(foto_pfad($vorlaeufig[$datei]))];
        }
        $m['fotos'] = $fotos;
    }
    $ergebnis = meldung_anhaengen($tid, $m, $vorlaeufig ? fn () => fotos_uebernehmen($vorlaeufig) : null);
    if ($ergebnis !== 'ok') {
        $verwerfen(); // schon da bzw. nicht gespeichert: nur die vorläufigen Fotos dieses Versuchs weg
    }
    if ($ergebnis === 'weg') {
        $antwort(404, 'mt_tour_weg');
    }
    if ($ergebnis === 'fehler') {
        $antwort(500, 'mt_fehler_speichern');
    }
    if ($ergebnis === 'schon' && $art === 'abschluss') {
        $antwort(409, 'mt_schon_abgeschlossen', [], ['stopp' => $sid]);
    }
    $nach = json_lesen(tour_datei($tid));
    $st = stand($nach);
    // Büro benachrichtigen: Ausnahme bei einem Stopp, Tour fertig (Push ohne Kundennamen: geht über einen fremden Dienst)
    if ($ergebnis === 'ok' && $art === 'abschluss') {
        $alle = count($tour['stopps']);
        $fertig = count(array_filter($st['stopps'], fn ($x) => $x['fertig']));
        $nr = (int) array_search($sid, array_column($tour['stopps'], 'id'), true) + 1;
        $teile = [];
        if ($m['status'] !== 'abgeschlossen') {
            $teile[] = 'Stopp ' . $nr . ' ' . (STATUS_DE[$m['status']] ?? $m['status']);
        }
        if ($fertig === $alle) {
            $teile[] = 'alle ' . $alle . ' Stopps erledigt';
        }
        $titel = $teile ? 'Matten-Tour ' . $tour['fahrer']['name'] . ': ' . implode(' · ', $teile) : '';
        if ($titel !== '') {
            $text = 'Tour vom ' . datum_sprache($tour['datum'], false, 'de') . ', ' . $fertig . ' von ' . $alle . " Stopps erledigt.\nDie App holt die Rückmeldung ab (Matten-Tourenplanung bzw. Matten-Touren).";
            $app = rtrim((string) ($e['adresse'] ?? ''), '/') . '/#mw-planung';
            foreach ((array) ($e['buero'] ?? []) as $b) {
                if (!empty($b['ntfy'])) {
                    ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $b['ntfy'], 'title' => $titel, 'message' => $text, 'priority' => $m['status'] !== 'abgeschlossen' ? 4 : 3, 'tags' => [$m['status'] !== 'abgeschlossen' ? 'warning' : 'white_check_mark'], 'click' => $app]);
                }
                if (!empty($b['email'])) {
                    mail_senden((string) $b['email'], $titel, $text . "\n\nApp: $app\n", (string) ($e['absender'] ?? ''), 'Matten-Tour');
                }
            }
        }
    }
    $next = naechster_stopp($tour, $st, $art === 'start' ? '' : $sid);
    $weiter = 'mattentour.php?tour=' . rawurlencode($tid) . ($art !== 'start' && $next && $art === 'abschluss' ? '&stopp=' . rawurlencode($next['id']) : ($art === 'unterwegs' ? '&stopp=' . rawurlencode($sid) : '')) . '&gesendet=' . $art;
    if (will_json()) {
        json_ausgabe(200, ['ok' => true, 'doppelt' => $ergebnis !== 'ok', 'status' => $ergebnis === 'ok' ? ($m['status'] ?? '') : (string) ($st['stopps'][$sid]['status'] ?? ''), 'weiter' => $weiter]);
    }
    header('Location: ' . $weiter, true, 303);
    exit;
}

// ---------------------------------------------------------------- Ansicht

$hier = 'mattentour.php' . (isset($_GET['p']) ? '?p=' . rawurlencode($code) : '');
$kopf = sprachwahl_html($hier . (isset($_GET['tour']) ? (str_contains($hier, '?') ? '&' : '?') . 'tour=' . rawurlencode((string) $_GET['tour']) : ''));
$fuss = '<p class="leise" style="margin-top:2rem;font-size:.9rem">' . th('mt_fuss') . ' <a href="mattentour.php?aktion=vergessen">' . th('vergessen') . '</a></p>';
$pFeld = '<input type="hidden" name="p" value="' . $h($code) . '">';
$tid = (string) ($_GET['tour'] ?? '');
if ($tid === '' && count($meine) === 1) {
    $tid = (string) array_key_first($meine);
}
$eintrag = $meine[$tid] ?? null;

if (!$eintrag) {
    // Liste der Touren
    $karten = '';
    foreach ($meine as $id => $x) {
        $t = $x['datei']['tour'];
        $alle = count($t['stopps']);
        $fertig = count(array_filter($x['stand']['stopps'], fn ($s) => $s['fertig']));
        $pct = $alle ? (int) round($fertig / $alle * 100) : 0;
        $karten .= '<a class="mww-karte' . ($x['alt'] ? ' alt' : '') . '" href="mattentour.php?tour=' . $h((string) $id) . '"><span class="mww-kopf"><b>' . $h(tag_text($t['datum'])) . '</b> ' . status_pill($x['fertig'] ? 'abgeschlossen' : ($x['stand']['gestartet'] ? 'unterwegs' : 'freigegeben')) . '</span>'
            . '<span>' . th('mt_stopps_stand', ['alle' => (string) $alle, 'fertig' => (string) $fertig, 'offen' => (string) ($alle - $fertig)]) . '</span>'
            . '<span class="mww-balken" role="img" aria-label="' . $h(t('mt_fortschritt', ['fertig' => (string) $fertig, 'alle' => (string) $alle])) . '"><span style="width:' . $pct . '%"></span></span>'
            . ($x['alt'] ? '<span class="leise">' . th('mt_alt_offen') . '</span>' : '') . '</a>';
    }
    mt_seite($kopf . '<h1>' . th('mt_titel') . '</h1><p>' . $h((string) ($fahrer['name'] ?? '')) . '</p>'
        . ($karten ?: '<p>' . th('mt_keine_tour') . '</p>') . $fuss);
}

$datei = $eintrag['datei'];
$tour = $datei['tour'];
$stand = $eintrag['stand'];
$stopps = $tour['stopps'];
$alle = count($stopps);
$fertig = count(array_filter($stand['stopps'], fn ($s) => $s['fertig']));
$next = naechster_stopp($tour, $stand);
$aktiv = (string) ($_GET['stopp'] ?? '');
if (!array_filter($stopps, fn ($s) => $s['id'] === $aktiv)) {
    $aktiv = '';
}
$tourUrl = 'mattentour.php?tour=' . rawurlencode($tid);
$meldungsfelder = fn (string $art, string $sid = '') => $pFeld . '<input type="hidden" name="art" value="' . $art . '"><input type="hidden" name="tour" value="' . $h($tid) . '"><input type="hidden" name="stopp" value="' . $h($sid) . '"><input type="hidden" name="meldung" value="' . bin2hex(random_bytes(12)) . '"><input type="hidden" name="zeit" value="">';
$gesendet = ['start' => 'mt_ok_start', 'abschluss' => 'mt_ok_abschluss'][(string) ($_GET['gesendet'] ?? '')] ?? '';
$hinweis = $gesendet ? '<p class="ok" role="status">' . th($gesendet) . '</p>' : '';
$naviLink = fn (array $s, string $cls = 'knopf') => '<a class="' . $cls . '" href="' . $h(navi_url($s)) . '" target="_blank" rel="noopener" data-mww-unterwegs="' . $h($s['id']) . '">' . th('mt_navigation') . '</a>';

// Übersicht der Tour
$liste = '';
foreach ($stopps as $i => $s) {
    $st = $stand['stopps'][$s['id']] ?? ['status' => 'geplant', 'fertig' => false];
    $matten = [];
    foreach ($s['liegeplaetze'] as $l) {
        foreach ($l['matten'] as $m) {
            $matten[] = $m['soll'] . ' × ' . $m['bezeichnung'];
        }
    }
    $zeile = array_filter([count($s['liegeplaetze']) === 1 ? t('mt_liegeplatz_1') : t('mt_liegeplaetze_n', ['n' => (string) count($s['liegeplaetze'])]), implode(' · ', $matten), $s['ankunft'] ? t('mt_ca', ['zeit' => $s['ankunft']]) : '', fenster_text($s)]);
    $liste .= '<li class="' . ($st['fertig'] ? 'fertig' : '') . ($next && $next['id'] === $s['id'] ? ' naechster' : '') . '" data-mww-stopp-li="' . $h($s['id']) . '"><a href="' . $h($tourUrl . '&stopp=' . rawurlencode($s['id'])) . '" data-mww-zu="' . $h($s['id']) . '">'
        . '<span class="nr" aria-hidden="true">' . ($i + 1) . '</span><span class="text"><span class="mww-kopf"><b>' . $h(stopp_titel($s)) . '</b> <span data-mww-pill>' . status_pill($st['status']) . '</span></span>'
        . '<span>' . $h(implode(' · ', array_filter([$s['objekt'], $s['adresse']]))) . '</span><span class="leise">' . $h(implode(' · ', $zeile)) . '</span></span></a></li>';
}
$lade = '';
foreach ($tour['ladeliste'] as $r) {
    $lade .= '<tr><td>' . $h($r['groesse'] ?: $r['bezeichnung']) . '</td><td>' . $h($r['farbe']) . '</td><td class="zahl"><b>' . (int) $r['stueck'] . '</b></td><td class="zahl">' . (int) $r['stopps'] . '</td></tr>';
}
$knoepfe = ($stand['gestartet'] ? '' : '<form method="post" action="mattentour.php?aktion=meldung" data-mww-meldung>' . $meldungsfelder('start') . '<button type="submit">' . th('mt_tour_starten') . '</button></form>')
    . ($next ? $naviLink($next, $stand['gestartet'] ? 'knopf' : 'knopf zweit') . '<a class="knopf zweit" href="' . $h($tourUrl . '&stopp=' . rawurlencode($next['id'])) . '" data-mww-zu="' . $h($next['id']) . '" data-mww-naechster>' . th('mt_naechster', ['name' => $h(stopp_titel($next))]) . '</a>' : '<p class="ok">' . th('mt_alle_erledigt') . '</p>');
$pct = $alle ? (int) round($fertig / $alle * 100) : 0;
$uebersicht = '<section class="mww-teil' . ($aktiv === '' ? ' aktiv' : '') . '" id="tour" data-mww-teil="">'
    . (count($meine) > 1 ? '<div class="mww-zurueck"><a href="mattentour.php?tour=">' . th('mt_alle_touren') . '</a></div>' : '')
    . '<div class="mww-kopf"><h1>' . th('mt_tour_am', ['tag' => $h(tag_text($tour['datum']))]) . '</h1> <span data-mww-tourstatus>' . status_pill($fertig === $alle && $alle ? 'abgeschlossen' : ($stand['gestartet'] ? 'unterwegs' : 'freigegeben')) . '</span></div>'
    . '<p>' . $h((string) ($fahrer['name'] ?? '')) . ($tour['fahrzeug'] ? ' · ' . th('mt_fahrzeug', ['fahrzeug' => $h($tour['fahrzeug'])]) : '') . '</p>'
    . ($eintrag['alt'] ? '<p class="fehler">' . th('mt_alt_offen') . '</p>' : '')
    . $hinweis
    . '<div class="mww-kacheln"><div class="mww-kachel"><b data-mww-zahl="alle">' . $alle . '</b><span>' . th('mt_stopps_gesamt') . '</span></div><div class="mww-kachel"><b data-mww-zahl="fertig">' . $fertig . '</b><span>' . th('mt_erledigt') . '</span></div><div class="mww-kachel"><b data-mww-zahl="offen">' . ($alle - $fertig) . '</b><span>' . th('mt_offen') . '</span></div></div>'
    . '<span class="mww-balken" role="img" aria-label="' . $h(t('mt_fortschritt', ['fertig' => (string) $fertig, 'alle' => (string) $alle])) . '"><span style="width:' . $pct . '%" data-mww-balken></span></span>'
    . '<div data-mww-knoepfe>' . $knoepfe . '</div>'
    . '<h2>' . th('mt_ladeliste') . '</h2>' . ($lade ? '<table class="mww-tabelle"><thead><tr><th>' . th('mt_groesse') . '</th><th>' . th('mt_farbe') . '</th><th class="zahl">' . th('mt_stueck') . '</th><th class="zahl">' . th('mt_stopps') . '</th></tr></thead><tbody>' . $lade . '</tbody></table><p class="leise">' . th('mt_ladeliste_info') . '</p>' : '<p class="leise">' . th('mt_keine_matten') . '</p>')
    . '<h2>' . th('mt_reihenfolge') . '</h2><ol class="mww-stopps">' . $liste . '</ol>'
    . '</section>';

// je Stopp ein Teil der Seite (mit Skript ohne Netz umschaltbar), offene mit dem Formular „Stopp abschließen“
$grundOptionen = '<option value="">' . th('mt_grund_waehlen') . '</option>' . implode('', array_map(fn ($wert, $key) => '<option value="' . $h($wert) . '">' . th($key) . '</option>', array_keys(GRUENDE), GRUENDE));
$ohneListe = implode('', array_map(fn ($wert, $key) => '<option value="' . $h($wert) . '">' . th($key) . '</option>', array_keys(OHNE_GRUENDE), OHNE_GRUENDE));
$rollenListe = implode('', array_map(fn ($wert, $key) => '<option value="' . $h($wert) . '">' . th($key) . '</option>', array_keys(ROLLEN), ROLLEN));
$teile = '';
foreach ($stopps as $i => $s) {
    $st = $stand['stopps'][$s['id']] ?? ['status' => 'geplant', 'fertig' => false, 'meldung' => null];
    $sid = $s['id'];
    $kopfzeilen = array_filter([$s['ankunft'] ? t('mt_geplant_ca', ['zeit' => $s['ankunft']]) : '', fenster_text($s)]);
    $teil = '<div class="mww-zurueck"><a href="' . $h($tourUrl) . '" data-mww-zu="">' . th('mt_zur_uebersicht') . '</a><span>' . th('mt_stopp_von', ['nr' => (string) ($i + 1), 'alle' => (string) $alle]) . '</span></div>'
        . '<div class="mww-kopf"><h2>' . $h(stopp_titel($s)) . '</h2> <span data-mww-pill>' . status_pill($st['status']) . '</span></div>'
        . '<p>' . ($s['objekt'] ? '<b>' . $h($s['objekt']) . '</b><br>' : '') . $h($s['adresse']) . '</p>'
        . ($kopfzeilen ? '<p class="leise">' . $h(implode(' · ', $kopfzeilen)) . '</p>' : '')
        . ($aktiv === $sid ? $hinweis : '');
    if ($st['fertig']) {
        $m = $st['meldung'];
        $teil .= '<div class="mww-fertig' . ($st['status'] !== 'abgeschlossen' ? ' ausnahme' : '') . '"><h3>' . status_pill($st['status']) . ($m ? ' ' . th('mt_um', ['zeit' => uhr((int) $m['zeit'])]) : '') . '</h3><p>' . th('mt_fertig_fest') . '</p></div>';
        $n = naechster_stopp($tour, $stand, $sid);
        $teil .= $n ? '<a class="knopf" href="' . $h($tourUrl . '&stopp=' . rawurlencode($n['id'])) . '" data-mww-zu="' . $h($n['id']) . '">' . th('mt_naechster', ['name' => $h(stopp_titel($n))]) . '</a>' : '<a class="knopf zweit" href="' . $h($tourUrl) . '" data-mww-zu="">' . th('mt_zur_uebersicht') . '</a>';
        $teile .= '<section class="mww-teil' . ($aktiv === $sid ? ' aktiv' : '') . '" id="stopp-' . $h($sid) . '" data-mww-teil="' . $h($sid) . '">' . $teil . '</section>';
        continue;
    }
    $teil .= $naviLink($s);
    $form = '';
    foreach ($s['liegeplaetze'] as $k => $l) {
        $lid = $l['id'];
        $fid = 'f' . $i . '-' . $k;
        $meta = array_filter([$l['stockwerk'] ? t('mt_stockwerk', ['stock' => $l['stockwerk']]) : '', $l['zugang'] ? t('mt_zugang', ['zugang' => $l['zugang']]) : '']);
        $matten = '';
        foreach ($l['matten'] as $m) {
            $mid = $fid . '-m' . $m['i'];
            $matten .= '<div class="mww-matte"><span class="soll"><span class="leise">' . th('mt_soll') . '</span> <b>' . $h($m['soll'] . ' × ' . $m['bezeichnung']) . '</b></span>'
                . '<span class="mww-menge"><label for="' . $mid . '">' . th('mt_menge') . '</label><button type="button" class="zweit" data-mww-schritt="-1" aria-label="' . $h(t('mt_weniger', ['matte' => $m['bezeichnung']])) . '" hidden>−</button>'
                . '<input type="number" inputmode="numeric" min="0" max="999" id="' . $mid . '" name="menge[' . $m['i'] . ']" value="' . (int) $m['soll'] . '" data-mww-soll="' . (int) $m['soll'] . '">'
                . '<button type="button" class="zweit" data-mww-schritt="1" aria-label="' . $h(t('mt_mehr', ['matte' => $m['bezeichnung']])) . '" hidden>+</button></span></div>';
        }
        $form .= '<fieldset class="mww-pl" data-mww-pl="' . $h($lid) . '" style="min-width:0"><legend class="mww-kopf" style="padding:0"><h3>' . $h($l['name'] ?: t('mt_liegeplatz')) . '</h3></legend>'
            . ($meta ? '<p class="meta">' . $h(implode(' · ', $meta)) . '</p>' : '')
            . ($l['hinweis'] ? '<p class="hinweis">' . $h($l['hinweis']) . '</p>' : '')
            . '<div class="mww-wahl" role="radiogroup" aria-label="' . $h(t('mt_ergebnis', ['name' => $l['name'] ?: t('mt_liegeplatz')])) . '">'
            . '<input type="radio" class="gw" id="' . $fid . '-gw" name="ergebnis[' . $h($lid) . ']" value="gewechselt"><label for="' . $fid . '-gw">' . th('mt_gewechselt') . '</label>'
            . '<input type="radio" class="nm" id="' . $fid . '-nm" name="ergebnis[' . $h($lid) . ']" value="nicht-moeglich"><label for="' . $fid . '-nm">' . th('mt_nicht_moeglich') . '</label></div>'
            . '<div class="mww-mengen">' . $matten . '</div>'
            . '<div class="mww-grund"><label for="' . $fid . '-g">' . th('mt_warum') . '</label><select id="' . $fid . '-g" name="grund[' . $h($lid) . ']">' . $grundOptionen . '</select>'
            . '<label for="' . $fid . '-gf">' . th('mt_anderer_grund') . '</label><input type="text" id="' . $fid . '-gf" name="grund_frei[' . $h($lid) . ']" maxlength="120" autocomplete="off" placeholder="' . th('mt_anderer_grund_bsp') . '"></div>'
            . '<label for="' . $fid . '-b">' . th('mt_bemerkung') . '</label><textarea id="' . $fid . '-b" name="bemerkung[' . $h($lid) . ']" rows="2" maxlength="500" placeholder="' . th('mt_bemerkung_bsp') . '"></textarea>'
            . '<div class="mww-fotos" data-mww-fotos="' . $h($lid) . '"></div>'
            . '<label class="mww-kamera" for="' . $fid . '-f">' . th('mt_foto') . '<input type="file" id="' . $fid . '-f" name="foto[' . $h($lid) . '][]" accept="image/*" capture="environment" multiple data-mww-foto="' . $h($lid) . '"></label>'
            . '</fieldset>';
    }
    $form .= '<section class="mww-abschluss"><h3>' . th('mt_abschliessen') . '</h3>'
        . '<details class="mww-ausnahmen"><summary>' . th('mt_ausnahme_frage') . '</summary><p class="leise">' . th('mt_ausnahme_info') . '</p>'
        . '<label class="haken"><input type="radio" name="ausnahme" value="" checked> ' . th('mt_keine_ausnahme') . '</label>'
        . '<label class="haken"><input type="radio" name="ausnahme" value="nicht-angetroffen"> ' . th('mt_st_nicht_da') . '</label>'
        . '<label class="haken"><input type="radio" name="ausnahme" value="teilweise"> ' . th('mt_st_teilweise') . '</label>'
        . '<label class="haken"><input type="radio" name="ausnahme" value="nicht-durchgefuehrt"> ' . th('mt_st_nicht_durchgefuehrt') . '</label></details>'
        . '<label for="s' . $i . '-n">' . th('mt_notiz') . '</label><textarea id="s' . $i . '-n" name="notiz" rows="2" maxlength="500" placeholder="' . th('mt_notiz_bsp') . '"></textarea>'
        . '<div class="mww-mit"><p class="leise">' . th('mt_bestaetigung_info') . '</p>'
        . '<label for="s' . $i . '-name">' . th('mt_name') . '</label><input type="text" id="s' . $i . '-name" name="name" maxlength="80" autocomplete="off">'
        . '<label for="s' . $i . '-fn">' . th('mt_funktion') . '</label><input type="text" id="s' . $i . '-fn" name="funktion" maxlength="80" list="mww-rollen" autocomplete="off" placeholder="' . th('mt_funktion_bsp') . '">'
        . '<div class="mww-unterschrift" data-mww-unterschrift hidden><span class="feldname" id="s' . $i . '-ut" style="display:block;margin:.8rem 0 .2rem;font-weight:600">' . th('mt_unterschrift') . '</span><canvas width="600" height="200" role="img" aria-labelledby="s' . $i . '-ut"></canvas><input type="hidden" name="unterschrift" value=""><button type="button" class="klein zweit" data-mww-loeschen>' . th('mt_unterschrift_loeschen') . '</button></div>'
        . '<p class="leise" data-mww-ohne-skript>' . th('mt_ohne_skript') . '</p></div>'
        . '<label class="haken"><input type="checkbox" name="ohne" value="1"> ' . th('mt_ohne_unterschrift') . '</label>'
        . '<div class="mww-ohne-grund"><label for="s' . $i . '-og">' . th('mt_ohne_warum') . '</label><input type="text" id="s' . $i . '-og" name="ohne_grund" maxlength="120" list="mww-ohne" autocomplete="off"></div>'
        . '<p class="fehler" role="alert" data-mww-fehler hidden></p>'
        . '<button type="submit">' . th('mt_stopp_abschliessen') . '</button><p class="leise">' . th('mt_abschluss_info') . '</p></section>';
    $teil .= '<form method="post" action="mattentour.php?aktion=meldung" enctype="multipart/form-data" data-mww-meldung data-mww-stopp="' . $h($sid) . '">' . $meldungsfelder('abschluss', $sid) . $form . '</form>';
    $teile .= '<section class="mww-teil' . ($aktiv === $sid ? ' aktiv' : '') . '" id="stopp-' . $h($sid) . '" data-mww-teil="' . $h($sid) . '">' . $teil . '</section>';
}
$listen = '<datalist id="mww-rollen">' . $rollenListe . '</datalist><datalist id="mww-ohne">' . $ohneListe . '</datalist>';
// Texte für das Skript (in der Sprache der Seite)
$skriptTexte = ['ausgang' => t('mt_ausgang'), 'ausgang_n' => t('mt_ausgang_n'), 'senden' => t('mt_jetzt_senden'), 'gesendet' => t('mt_wird_gesendet'), 'foto_weg' => t('mt_foto_entfernen'), 'foto_max' => t('mt_fehler_foto_max', ['n' => (string) FOTO_MAX]), 'foto_speicher' => t('mt_foto_speicher'), 'wartet' => t('mt_wartet'), 'nicht_gesendet' => t('mt_nicht_gesendet'), 'naechster' => t('mt_naechster'), 'uebersicht' => t('mt_zur_uebersicht'), 'gesendet_kurz' => t('mt_sendet')];
mt_seite($kopf . '<div data-mww-tour="' . $h($tid) . '" data-mww-texte="' . $h((string) json_encode($skriptTexte, JSON_UNESCAPED_UNICODE)) . '">'
    . '<div class="mww-ausgang" data-mww-ausgang hidden role="status"></div>'
    . $uebersicht . $teile . $listen . '</div>' . $fuss);
