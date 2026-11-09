<?php
// Kundenbereich: persönliche Seite für Kunden bzw. Objekte, ohne Anmeldung (wie mein-plan.php).
//
// Jeder Link (kunden.php?k=CODE) gehört zu einem Kunden oder Objekt. Dort sieht der Kunde, was die
// App für diesen Link veröffentlicht: die Leistungsnachweise je Monat als PDF, den Winterdienst-
// Nachweis, die nächsten periodischen Leistungen und Termine im Objekt. Er kann eine Reklamation
// melden (Text, optional Foto, Kontakt) und sieht ihren Stand: eingegangen, in Arbeit, erledigt.
// Das Büro bekommt einen Push (ntfy, ohne Inhalt) bzw. eine E-Mail; die App übernimmt die Meldung
// als Reklamation mit Eingang „Kundenbereich“ und meldet den Stand zurück.
//
// Gespeichert wird nur, was die App schickt, unter privat/kundenbereich/ (per .htaccess gesperrt):
// je Link eine Datei mit Hashwert des Codes (der Code selbst liegt nie am Server), die PDFs je Link,
// die Meldungen. Grenzen: falsche Codes je Adresse, Meldungen je Link und je Adresse, Fotos nur als
// Bild (JPEG, PNG, WebP; mit GD neu gespeichert, ohne Metadaten), PDFs nur als PDF.
//
// Rechnungen (je Link einschaltbar): festgeschriebene Rechnungen, Storno- und Korrekturbelege der
// Kunden des Links mit Stand und PDF, offene mit Bankverbindung und EPC-QR-Code. Das QR-Bild erzeugt
// die App beim Übertragen (PNG), PHP prüft es nur. Keine Zahlung über die Seite.
//
// Mattenwechsel (je Link einschaltbar): Lieferscheine der Kunden des Links an seinen Objekten mit Nummer, Datum,
// Objekt, Liegeplätzen mit Mengen, wer unterschrieben hat (Name und Funktion, kein Bild) und dem PDF ohne Preise;
// dazu der nächste Mattenwechsel je Liegeplatz (nur das Datum). Die App schickt nur, was sie zeigen darf; PHP liest nur
// bekannte Felder (Preise und Beträge gibt es in der Liste nicht).
//
// Angebot online annehmen (kunden.php?a=CODE): eigener Code je Angebot (am Server nur der Hashwert),
// Nummer, Datum, Summe, gültig bis und das PDF; Annahme mit Name, Funktion, Häkchen und freiwilliger
// Unterschrift (Striche als Pfad, kein Bild). Gespeichert: Zeitpunkt, Name, Funktion, Nummer und der
// SHA-256 des veröffentlichten PDF, keine IP-Adresse. Abgelaufene Angebote lassen sich nicht annehmen.
// Das Büro bekommt Push (nur die Nummer) bzw. E-Mail; die App holt die Annahme ab.
//
// Kundenzufriedenheit (je Runde, ein Quartal): Die App schickt die Runden, die nicht vorbei sind (aktion=umfrage:
// Quartal, von, bis, Fragen, teilnehmende Links). Solange eine Runde offen ist, zeigt die Seite des Links die Umfrage
// (Sterne 1–5, Weiterempfehlung 0–10, Freitext, Rückruf; Name und Funktion freiwillig), eine Antwort je Runde und Link.
// Gespeichert unter privat/kundenbereich/umfrage/ ohne IP-Adresse; die App holt die Antworten ab (umfrage-antworten)
// und meldet die Übernahme (umfrage-status), danach bleibt am Webspace nur der Vermerk „hat geantwortet“ (ohne
// Inhalt). Bei Gesamt 1–2 oder Rückruf bekommt das Büro einen Push (ohne Inhalt) bzw. eine E-Mail. Keine Werbung,
// kein Tracking, keine Cookies.
//
// Aufrufe der App (Schlüssel im Kopf X-Schluessel):
//   aktion=einrichten | speichern | datei | meldungen | meldung-status | foto | status
//   aktion=angebot | angebot-datei | angebot-entfernen | annahmen | annahme-status
//   aktion=umfrage | umfrage-antworten | umfrage-status
// Erste Einrichtung: privat/kundenbereich.json per FTP, oder „einrichten“ mit dem Schlüssel von
// Plan am Handy bzw. Schnee-Alarm im Kopf X-Freigabe, solange es noch keine Einstellungen gibt.

declare(strict_types=1);

// Fehler nie in die Antwort (Serverpfade, Stacktraces), nur ins Fehlerprotokoll des Webspace
if (PHP_SAPI !== 'cli') {
    ini_set('display_errors', '0');
}

require __DIR__ . '/wetter-lib.php';
require __DIR__ . '/webspace-lib.php';

const ARTEN = ['Reinigung mangelhaft' => 'Reinigung nicht in Ordnung', 'Leistung nicht erbracht' => 'Leistung nicht erbracht', 'Schaden' => 'Schaden', 'Sonstiges' => 'Sonstiges'];
const STATUS = ['eingegangen' => 'eingegangen', 'arbeit' => 'in Arbeit', 'erledigt' => 'erledigt'];
const ZEIGE = ['nachweise', 'winter', 'leistungen', 'termine', 'reklamation', 'rechnungen', 'lieferscheine', 'mattenwechsel'];
const BILD_TYPEN = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
const BILD_MAX = 8 * 1024 * 1024;
const PDF_MAX = 8 * 1024 * 1024;
const MONATE = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
// Grenzen: [Anzahl, Sekunden]
const GRENZE_FEHLVERSUCHE = [20, 900];
const GRENZE_MELDUNG_LINK = [5, 86400];
const GRENZE_MELDUNG_ADRESSE = [10, 86400];
const DATEI_MUSTER = '/^\d{4}-\d{2}-(leistung|winter)-\d{1,3}\.pdf$/';
const LINK_MUSTER = '/^kb[a-f0-9]{10}$/';
// Rechnungen: Dateiname aus Belegart und Nummer, Stand wie in der App (core/customer-invoices.js)
const BELEG_MUSTER = '/^(rechnung|storno|korrektur)-[A-Za-z0-9-]{1,40}\.pdf$/';
const BELEG_STATUS = ['offen' => 'offen', 'ueberfaellig' => 'überfällig', 'teilbezahlt' => 'teilweise bezahlt', 'bezahlt' => 'bezahlt', 'storniert' => 'storniert', 'verrechnet' => 'verrechnet'];
const QR_MAX = 24000; // Base64 des QR-Bilds (PNG)
// Mattenwechsel: Lieferscheine (Dateiname aus der Nummer wie in der App, core/customer-matten.js)
const LS_MUSTER = '/^lieferschein-[A-Za-z0-9-]{1,40}\.pdf$/';
// Angebot online annehmen
const ANGEBOT_MUSTER = '/^an[a-f0-9]{10}$/';
const UNTERSCHRIFT_MUSTER = '/^M[0-9. ML]{2,16000}$/';
const GRENZE_ANNAHME = [10, 86400]; // Versuche je Angebot und Tag
// Kundenzufriedenheit (Felder wie in der App: core/zufriedenheit.js)
const RUNDE_MUSTER = '/^\d{4}-Q[1-4]$/';
const FRAGE_MUSTER = '/^[a-z][a-z0-9]{1,23}$/';
const ANTWORT_MUSTER = '/^[a-f0-9]{12}$/';
const TELEFON_MUSTER = '/^[0-9 +\/()-]{5,40}$/';
const GRENZE_UMFRAGE_LINK = [6, 86400]; // Absende-Versuche je Link und Tag
const GRENZE_UMFRAGE_ADRESSE = [10, 86400]; // Antworten je Adresse und Tag
const UMFRAGE_VORGABE = ['gesamt' => 'Wie zufrieden sind Sie insgesamt mit unserer Arbeit?', 'nps' => 'Wie wahrscheinlich ist es, dass Sie uns weiterempfehlen?', 'freitext' => 'Was sollen wir besser machen, was gefällt Ihnen?'];

function jetzt(): int
{
    $t = getenv('WETTER_JETZT'); // nur für Tests
    return $t !== false && $t !== '' ? (int) $t : time();
}

function ordner(): string
{
    return getenv('KUNDEN_ORDNER') ?: __DIR__ . '/privat';
}

function heute(): string
{
    return (new DateTimeImmutable('@' . jetzt()))->setTimezone(new DateTimeZone('Europe/Vienna'))->format('Y-m-d');
}

function tag_plus(string $datum, int $tage): string
{
    return (new DateTimeImmutable($datum, new DateTimeZone('UTC')))->modify(($tage >= 0 ? '+' : '') . $tage . ' days')->format('Y-m-d');
}

function speicher(string $unter = ''): string
{
    $d = ordner() . '/kundenbereich' . ($unter !== '' ? '/' . $unter : '');
    if (!is_dir($d)) {
        @mkdir($d, 0775, true);
    }
    return $d;
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
    $ergebnis = $fn($daten);
    ftruncate($h, 0);
    rewind($h);
    fwrite($h, json_encode($daten, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    fflush($h);
    flock($h, LOCK_UN);
    fclose($h);
    return $ergebnis;
}

function einstellungen(): ?array
{
    $e = json_lesen(ordner() . '/kundenbereich.json');
    return is_string($e['schluessel'] ?? null) && strlen($e['schluessel']) >= 32 ? $e : null;
}

function json_ausgabe(int $status, array $daten): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($daten, JSON_UNESCAPED_UNICODE);
    exit;
}

function kurz($wert, int $n): string
{
    return mb_substr(trim(preg_replace('/[\x00-\x09\x0B-\x1F\x7F]/u', '', (string) $wert) ?? ''), 0, $n);
}

function link_datei(string $id): string
{
    return speicher('links') . '/' . $id . '.json';
}

function link_ordner(string $id): string
{
    return speicher('dateien/' . $id);
}

/** Link zu einem Code (nur über den Hashwert auffindbar). */
function link_zum_code(string $code): ?array
{
    if (!preg_match('/^[A-Za-z0-9]{16,40}$/', $code)) {
        return null;
    }
    $hash = hash('sha256', $code);
    $id = (string) (json_lesen(speicher() . '/index.json')[$hash] ?? '');
    if (!preg_match(LINK_MUSTER, $id)) {
        return null;
    }
    $link = json_lesen(link_datei($id));
    return $link && hash_equals((string) ($link['hash'] ?? ''), $hash) ? $link : null;
}

function link_entfernen(string $id): bool
{
    if (!preg_match(LINK_MUSTER, $id)) {
        return false;
    }
    gesperrt(speicher() . '/index.json', function (array &$index) use ($id) {
        $index = array_filter($index, fn ($v) => $v !== $id);
    });
    foreach (glob(link_ordner($id) . '/*') ?: [] as $f) {
        @unlink($f);
    }
    @rmdir(link_ordner($id));
    return @unlink(link_datei($id));
}

/**
 * Zähler je Art und Absender (Hashwert, kein Klartext): true, wenn die Grenze erreicht ist.
 * $zaehlen: diesen Aufruf mitzählen. Alte Einträge fallen nach dem Zeitfenster weg.
 */
function grenze(string $art, string $wer, array $grenze, bool $zaehlen): bool
{
    [$max, $sekunden] = $grenze;
    $schluessel = substr(hash('sha256', $art . '|' . $wer . '|' . date('Y')), 0, 20);
    $erreicht = gesperrt(speicher() . '/grenzen.json', function (array &$alle) use ($schluessel, $max, $sekunden, $zaehlen) {
        $ab = jetzt() - $sekunden;
        $alle = array_filter(array_map(fn ($l) => array_values(array_filter((array) $l, fn ($t) => (int) $t > jetzt() - 86400)), $alle));
        $liste = array_values(array_filter($alle[$schluessel] ?? [], fn ($t) => (int) $t > $ab));
        if (count($liste) >= $max) {
            return true;
        }
        if ($zaehlen) {
            $liste[] = jetzt();
            $alle[$schluessel] = $liste;
        }
        return false;
    });
    return $erreicht === true;
}

function adresse_des_aufrufs(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

/** Formular von einer fremden Seite? (Browser schicken Sec-Fetch-Site mit) */
function fremde_herkunft(): bool
{
    $herkunft = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    return $herkunft !== '' && $herkunft !== 'same-origin' && $herkunft !== 'none';
}

/** Meldungen gesperrt ändern; erledigte nach 180 Tagen, alle nach 400 Tagen weg (mit Foto). */
function meldungen(callable $fn)
{
    return gesperrt(speicher() . '/meldungen.json', function (array &$liste) use ($fn) {
        $ergebnis = $fn($liste);
        $bleibt = [];
        foreach ($liste as $m) {
            $alt = ($m['status'] ?? '') === 'erledigt' ? (int) ($m['geaendert'] ?? 0) < jetzt() - 180 * 86400 : (int) ($m['erstellt'] ?? 0) < jetzt() - 400 * 86400;
            if ($alt) {
                foto_loeschen($m);
                continue;
            }
            // Foto am Webspace höchstens 60 Tage (danach liegt es in SharePoint oder ist nicht mehr nötig)
            if (!empty($m['foto']) && (int) ($m['erstellt'] ?? 0) < jetzt() - 60 * 86400) {
                foto_loeschen($m);
                $m['foto'] = '';
            }
            $bleibt[] = $m;
        }
        $liste = $bleibt;
        return $ergebnis;
    });
}

function foto_loeschen(array $m): void
{
    if (preg_match('/^[a-f0-9]{12}\.(jpg|png|webp)$/', (string) ($m['foto'] ?? ''))) {
        @unlink(speicher('fotos') . '/' . $m['foto']);
    }
}

/**
 * Hochgeladenes Foto prüfen und speichern: Fehler, Größe, Typ laut Inhalt (fileinfo), Maße. Mit GD
 * wird es neu als JPEG gespeichert (längste Seite 1600 px, ohne Metadaten wie GPS); ohne GD nur
 * nach strenger Prüfung übernommen. Liefert [Dateiname, Fehlertext].
 */
function foto_speichern(?array $f, string $id): array
{
    if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return ['', ''];
    }
    if (is_array($f['error'])) {
        return ['', 'Bitte nur ein Foto anhängen.'];
    }
    if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file((string) $f['tmp_name'])) {
        return ['', 'Das Foto ist zu groß oder nicht angekommen. Bitte ein kleineres Foto wählen.'];
    }
    if ((int) $f['size'] > BILD_MAX || (int) $f['size'] < 100) {
        return ['', 'Das Foto darf höchstens 8 MB groß sein.'];
    }
    $typ = class_exists('finfo') ? (string) (new finfo(FILEINFO_MIME_TYPE))->file((string) $f['tmp_name']) : '';
    $mass = @getimagesize((string) $f['tmp_name']);
    if (!isset(BILD_TYPEN[$typ]) || !$mass || ($mass['mime'] ?? '') !== $typ || $mass[0] < 1 || $mass[1] < 1 || $mass[0] > 12000 || $mass[1] > 12000) {
        return ['', 'Bitte ein Foto als JPEG, PNG oder WebP anhängen.'];
    }
    $ziel = speicher('fotos') . '/' . $id;
    $lesen = ['image/jpeg' => 'imagecreatefromjpeg', 'image/png' => 'imagecreatefrompng', 'image/webp' => 'imagecreatefromwebp'][$typ];
    if (function_exists($lesen) && function_exists('imagejpeg') && $mass[0] * $mass[1] <= 40e6) {
        $bild = @$lesen((string) $f['tmp_name']);
        if (!$bild) {
            return ['', 'Das Foto lässt sich nicht öffnen. Bitte ein anderes wählen.'];
        }
        $faktor = min(1, 1600 / max($mass[0], $mass[1]));
        $b = max(1, (int) round($mass[0] * $faktor));
        $hoehe = max(1, (int) round($mass[1] * $faktor));
        $neu = imagecreatetruecolor($b, $hoehe);
        imagefill($neu, 0, 0, imagecolorallocate($neu, 255, 255, 255)); // durchsichtige PNG auf Weiß
        imagecopyresampled($neu, $bild, 0, 0, 0, 0, $b, $hoehe, $mass[0], $mass[1]);
        $ok = imagejpeg($neu, $ziel . '.jpg', 82);
        imagedestroy($bild);
        imagedestroy($neu);
        return $ok ? [$id . '.jpg', ''] : ['', 'Das Foto konnte nicht gespeichert werden.'];
    }
    if ($typ === 'image/webp') {
        return ['', 'Bitte das Foto als JPEG oder PNG anhängen.'];
    }
    return move_uploaded_file((string) $f['tmp_name'], $ziel . '.' . BILD_TYPEN[$typ]) ? [$id . '.' . BILD_TYPEN[$typ], ''] : ['', 'Das Foto konnte nicht gespeichert werden.'];
}

/** PDF der App aus dem Rumpf (nur echte PDFs bis 8 MB); sonst Fehler an die App. */
function pdf_aus_anfrage(): string
{
    $laenge = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($laenge > PDF_MAX) {
        json_ausgabe(413, ['fehler' => 'PDF zu groß (höchstens 8 MB)']);
    }
    $inhalt = (string) file_get_contents('php://input', false, null, 0, PDF_MAX + 1);
    if (strlen($inhalt) > PDF_MAX || strlen($inhalt) < 200 || !str_starts_with($inhalt, '%PDF-') || !str_contains(substr($inhalt, -1024), '%%EOF')) {
        json_ausgabe(400, ['fehler' => 'Kein gültiges PDF']);
    }
    return $inhalt;
}

/** Datei ersetzen (erst unter anderem Namen schreiben, dann umbenennen). */
function datei_schreiben(string $ziel, string $inhalt): bool
{
    $tmp = $ziel . '.' . bin2hex(random_bytes(4));
    return @file_put_contents($tmp, $inhalt, LOCK_EX) !== false && @rename($tmp, $ziel);
}

/** PDF an den Browser (zum Ansehen, mit Dateinamen). */
function pdf_senden(string $pfad, string $name): void
{
    header('Content-Type: application/pdf');
    header('Content-Disposition: inline; filename="' . preg_replace('/[^A-Za-z0-9._-]/', '_', $name) . '"; filename*=UTF-8\'\'' . rawurlencode($name));
    header('Content-Length: ' . filesize($pfad));
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    header('X-Robots-Tag: noindex, nofollow');
    readfile($pfad);
    exit;
}

// ---------------------------------------------------------------- Rechnungen und Angebote

function betrag($wert): float
{
    return is_int($wert) || is_float($wert) || (is_string($wert) && is_numeric($wert)) ? round((float) $wert, 2) : 0.0;
}

function datum_gueltig($d): string
{
    return is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && DateTimeImmutable::createFromFormat('!Y-m-d', $d) ? $d : '';
}

/** QR-Bild der App: nur ein echtes PNG (Base64), nicht zu groß; sonst leer. PHP erzeugt keinen QR-Code. */
function qr_pruefen($b64): string
{
    if (!is_string($b64) || $b64 === '' || strlen($b64) > QR_MAX || !preg_match('/^[A-Za-z0-9+\/]+={0,2}$/', $b64)) {
        return '';
    }
    $png = base64_decode($b64, true);
    if ($png === false || !str_starts_with($png, "\x89PNG\r\n\x1a\n")) {
        return '';
    }
    $info = @getimagesizefromstring($png);
    return $info && $info[2] === IMAGETYPE_PNG && $info[0] >= 21 && $info[0] <= 1200 && $info[1] >= 21 && $info[1] <= 1200 ? $b64 : '';
}

/** Dateiname für den Download: Umlaute erlaubt, sonst nur sichere Zeichen, endet auf .pdf. */
function pdf_name($name, string $sonst): string
{
    $n = preg_replace('/[^A-Za-z0-9ÄÖÜäöüß._-]+/u', '-', kurz($name ?? $sonst, 120)) ?: $sonst;
    return str_ends_with($n, '.pdf') ? $n : $n . '.pdf';
}

/** Rechnungen eines Links aus „speichern“: nur bekannte Felder, geprüft und gekürzt. */
function rechnungen_lesen(array $liste): array
{
    $aus = [];
    foreach (array_slice($liste, 0, 300) as $r) {
        if (!is_array($r)) {
            continue;
        }
        $datei = (string) ($r['datei'] ?? '');
        if (!preg_match(BELEG_MUSTER, $datei, $art) || !preg_match('/^[a-f0-9]{16,64}$/', (string) ($r['sig'] ?? ''))) {
            continue;
        }
        $z = is_array($r['zahlung'] ?? null) ? $r['zahlung'] : null;
        $iban = $z ? strtoupper((string) preg_replace('/\s+/', '', (string) ($z['iban'] ?? ''))) : '';
        $zahlung = $z && preg_match('/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/', $iban) ? [
            'empfaenger' => kurz($z['empfaenger'] ?? '', 70),
            'iban' => trim(chunk_split($iban, 4, ' ')),
            'bic' => preg_match('/^[A-Z0-9]{8,11}$/', (string) ($z['bic'] ?? '')) ? (string) $z['bic'] : '',
            'betrag' => betrag($z['betrag'] ?? 0),
            'zweck' => kurz($z['zweck'] ?? '', 140),
        ] : null;
        $aus[] = [
            'datei' => $datei,
            'art' => $art[1],
            'titel' => kurz($r['titel'] ?? '', 40) ?: 'Rechnung',
            'nummer' => kurz($r['nummer'] ?? '', 40),
            'betreff' => kurz($r['betreff'] ?? '', 120),
            'datum' => datum_gueltig($r['datum'] ?? ''),
            'faellig' => datum_gueltig($r['faellig'] ?? ''),
            'brutto' => betrag($r['brutto'] ?? 0),
            'offen' => max(0.0, betrag($r['offen'] ?? 0)),
            'status' => isset(BELEG_STATUS[$r['status'] ?? '']) ? (string) $r['status'] : 'offen',
            'bezug' => kurz($r['bezug'] ?? '', 40),
            'name' => pdf_name($r['name'] ?? null, $datei),
            'sig' => (string) $r['sig'],
            'zahlung' => $zahlung,
            'lastschrift' => !empty($r['lastschrift']),
            'qr' => $zahlung ? qr_pruefen($r['qr'] ?? '') : '',
        ];
    }
    return $aus;
}

/** Lieferscheine des Mattenwechsels aus „speichern“: nur bekannte Felder, geprüft und gekürzt, keine Preise. */
function lieferscheine_lesen(array $liste): array
{
    $aus = [];
    foreach (array_slice($liste, 0, 300) as $r) {
        if (!is_array($r)) {
            continue;
        }
        $datei = (string) ($r['datei'] ?? '');
        if (!preg_match(LS_MUSTER, $datei) || !preg_match('/^[a-f0-9]{16,64}$/', (string) ($r['sig'] ?? ''))) {
            continue;
        }
        $plaetze = [];
        foreach (array_slice(is_array($r['liegeplaetze'] ?? null) ? $r['liegeplaetze'] : [], 0, 30) as $p) {
            if (!is_array($p)) {
                continue;
            }
            $matten = [];
            foreach (array_slice(is_array($p['matten'] ?? null) ? $p['matten'] : [], 0, 12) as $m) {
                if (is_array($m)) {
                    $matten[] = ['text' => kurz($m['text'] ?? '', 120) ?: 'Matte', 'menge' => max(0, min(9999, (int) ($m['menge'] ?? 0)))];
                }
            }
            $hinweise = [];
            foreach (array_slice(is_array($p['hinweise'] ?? null) ? $p['hinweise'] : [], 0, 6) as $t) {
                if (is_string($t) && trim($t) !== '') {
                    $hinweise[] = kurz($t, 160);
                }
            }
            $plaetze[] = ['name' => kurz($p['name'] ?? '', 120) ?: 'Liegeplatz', 'matten' => $matten, 'hinweise' => $hinweise];
        }
        $u = is_array($r['unterschrift'] ?? null) ? $r['unterschrift'] : null;
        $unterschrift = !$u ? null : (!empty($u['ohne'])
            ? ['ohne' => true, 'grund' => kurz($u['grund'] ?? '', 120)]
            : ['name' => kurz($u['name'] ?? '', 80), 'funktion' => kurz($u['funktion'] ?? '', 60)]);
        $zeit = (string) ($r['zeit'] ?? '');
        $aus[] = [
            'datei' => $datei,
            'nummer' => kurz($r['nummer'] ?? '', 40),
            'datum' => datum_gueltig($r['datum'] ?? ''),
            'zeit' => preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $zeit) ? $zeit : '',
            'objekt' => kurz($r['objekt'] ?? '', 120),
            'liegeplaetze' => $plaetze,
            'unterschrift' => $unterschrift,
            'name' => pdf_name($r['name'] ?? null, $datei),
            'sig' => (string) $r['sig'],
        ];
    }
    return $aus;
}

/** Nächster Mattenwechsel je Liegeplatz aus „speichern“: nur Datum, Liegeplatz und Objekt. */
function mattenwechsel_lesen(array $liste): array
{
    $aus = [];
    foreach (array_slice($liste, 0, 200) as $n) {
        if (!is_array($n) || datum_gueltig($n['datum'] ?? '') === '') {
            continue;
        }
        $aus[] = ['datum' => $n['datum'], 'liegeplatz' => kurz($n['liegeplatz'] ?? '', 120) ?: 'Liegeplatz', 'objekt' => kurz($n['objekt'] ?? '', 120)];
    }
    return $aus;
}

function angebot_datei(string $id): string
{
    return speicher('angebote') . '/' . $id . '.json';
}

function angebot_pdf(string $id): string
{
    return speicher('angebote') . '/' . $id . '.pdf';
}

/** Angebot zu einem Code (nur über den Hashwert auffindbar). */
function angebot_zum_code(string $code): ?array
{
    if (!preg_match('/^[A-Za-z0-9]{16,40}$/', $code)) {
        return null;
    }
    $hash = hash('sha256', $code);
    $id = (string) (json_lesen(speicher('angebote') . '/index.json')[$hash] ?? '');
    if (!preg_match(ANGEBOT_MUSTER, $id)) {
        return null;
    }
    $a = json_lesen(angebot_datei($id));
    return $a && empty($a['entfernt']) && hash_equals((string) ($a['hash'] ?? ''), $hash) ? $a : null;
}

function angebot_entfernen(string $id): void
{
    gesperrt(speicher('angebote') . '/index.json', function (array &$index) use ($id) {
        $index = array_filter($index, fn ($v) => $v !== $id);
    });
    @unlink(angebot_pdf($id));
    @unlink(angebot_datei($id));
}

/** Alte Angebote löschen: angenommene 180 Tage nach der Übernahme in die App, andere 180 Tage nach „gültig bis“. */
function angebote_aufraeumen(): void
{
    $grenze = tag_plus(heute(), -180);
    foreach (glob(speicher('angebote') . '/an*.json') ?: [] as $f) {
        $a = json_lesen($f);
        $id = (string) ($a['id'] ?? '');
        if (!preg_match(ANGEBOT_MUSTER, $id)) {
            @unlink($f); // leer geblieben (z. B. gleichzeitig entfernt)
            continue;
        }
        $annahme = is_array($a['annahme'] ?? null) ? $a['annahme'] : null;
        $alt = $annahme ? (int) ($annahme['uebernommen'] ?? 0) > 0 && (int) $annahme['uebernommen'] < jetzt() - 180 * 86400 : (string) ($a['gueltigBis'] ?? '') < $grenze;
        if ($alt) {
            angebot_entfernen($id);
        }
    }
}

function betrag_text(float $x): string
{
    return ($x < 0 ? '−' : '') . '€ ' . number_format(abs($x), 2, ',', '.');
}

/** Zeitpunkt in Wien: „06.11.2026, 14:32“. */
function zeit_text(int $t): string
{
    return (new DateTimeImmutable('@' . $t))->setTimezone(new DateTimeZone('Europe/Vienna'))->format('d.m.Y, H:i');
}

// ---------------------------------------------------------------- Kundenzufriedenheit

/** Runden der Umfrage, wie die App sie zuletzt geschickt hat. */
function umfrage_runden(): array
{
    return array_values(array_filter((array) (json_lesen(speicher('umfrage') . '/runden.json')['runden'] ?? []), 'is_array'));
}

/** Offene Runde eines Links (heute zwischen von und bis), bei mehreren die neueste; sonst null. */
function offene_runde(string $linkId): ?array
{
    $heute = heute();
    $treffer = null;
    foreach (umfrage_runden() as $r) {
        if (in_array($linkId, (array) ($r['links'] ?? []), true) && (string) ($r['von'] ?? '') <= $heute && $heute <= (string) ($r['bis'] ?? '') && (!$treffer || strcmp((string) $r['id'], (string) $treffer['id']) > 0)) {
            $treffer = $r;
        }
    }
    return $treffer;
}

/**
 * Antworten gesperrt ändern. Übernommene behalten nur den Vermerk „hat geantwortet“ (Kennung, Runde, Link, Zeit),
 * bis 30 Tage nach dem Ende der Runde (steht die Runde nicht mehr in der Liste: 30 Tage nach der Übernahme);
 * nicht übernommene höchstens 400 Tage.
 */
function antworten(callable $fn)
{
    return gesperrt(speicher('umfrage') . '/antworten.json', function (array &$liste) use ($fn) {
        $ergebnis = $fn($liste);
        $ende = [];
        foreach (umfrage_runden() as $r) {
            $ende[(string) ($r['id'] ?? '')] = (string) ($r['bis'] ?? '');
        }
        $bleibt = [];
        foreach ($liste as $a) {
            if (!is_array($a) || (int) ($a['zeit'] ?? 0) < jetzt() - 400 * 86400) {
                continue;
            }
            if (!empty($a['uebernommen'])) {
                $a = array_intersect_key($a, array_flip(['id', 'runde', 'link', 'zeit', 'uebernommen']));
                $bis = $ende[(string) ($a['runde'] ?? '')] ?? '';
                if ($bis !== '' ? tag_plus($bis, 30) < heute() : (int) $a['uebernommen'] < jetzt() - 30 * 86400) {
                    continue;
                }
            }
            $bleibt[] = $a;
        }
        $liste = $bleibt;
        return $ergebnis;
    });
}

/** Hat dieser Link in dieser Runde schon geantwortet? */
function beantwortet(string $linkId, string $runde): bool
{
    foreach (antworten(fn (array &$l) => $l) ?? [] as $a) {
        if (($a['link'] ?? '') === $linkId && ($a['runde'] ?? '') === $runde) {
            return true;
        }
    }
    return false;
}

/** Ganze Zahl aus einem Formularfeld im Bereich, sonst null. */
function wahl_wert($v, int $min, int $max): ?int
{
    $s = is_string($v) ? trim($v) : '';
    return preg_match('/^\d{1,2}$/', $s) && (int) $s >= $min && (int) $s <= $max ? (int) $s : null;
}

function svg_stern(): string
{
    return '<svg class="stern" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>';
}

// ---------------------------------------------------------------- Darstellung

$h = fn ($t): string => htmlspecialchars((string) $t, ENT_QUOTES);

function datum_text(string $d, bool $tag = true, bool $jahr = true): string
{
    $t = DateTimeImmutable::createFromFormat('!Y-m-d', $d);
    return $t ? ($tag ? TAGE[(int) $t->format('N') - 1] . ' ' : '') . $t->format($jahr ? 'd.m.Y' : 'd.m.') : $d;
}

function monat_text(string $m): string
{
    return preg_match('/^(\d{4})-(\d{2})$/', $m, $x) ? MONATE[(int) $x[2] - 1] . ' ' . $x[1] : $m;
}

function groesse_text(int $bytes): string
{
    return $bytes >= 1048576 ? str_replace('.', ',', (string) round($bytes / 1048576, 1)) . ' MB' : max(1, (int) round($bytes / 1024)) . ' KB';
}

function svg_pdf(): string
{
    return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5M9 13h6M9 17h4"/></svg>';
}

function svg_pfeil(): string
{
    return '<svg class="pfeil" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
}

/** „Fragen? Telefon … · E-Mail …“ aus den Einstellungen (leer, wenn nichts eingetragen ist). */
function kontakt_html(array $e): string
{
    $h = fn ($t) => htmlspecialchars((string) $t, ENT_QUOTES);
    $kontakt = array_filter([
        !empty($e['firma']['telefon']) ? 'Telefon <a href="tel:' . $h(preg_replace('/[^0-9+]/', '', (string) $e['firma']['telefon'])) . '">' . $h($e['firma']['telefon']) . '</a>' : '',
        !empty($e['firma']['email']) ? 'E-Mail <a href="mailto:' . $h($e['firma']['email']) . '">' . $h($e['firma']['email']) . '</a>' : '',
    ]);
    return $kontakt ? '<p>Fragen? ' . implode(' · ', $kontakt) . '</p>' : '';
}

/** Seite für Kunden: eigenes, ruhiges Design (Sie-Form), Logo und Hausfarbe aus config.json. */
function seite(string $inhalt, int $status = 200, string $titel = 'Kundenbereich', string $firma = '', string $wo = 'Kundenbereich', string $skript = 'wetter-foto.js'): void
{
    $m = marke();
    $h = fn ($t) => htmlspecialchars((string) $t, ENT_QUOTES);
    $name = $firma !== '' ? $firma : $m['app'];
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');
    header('Referrer-Policy: no-referrer');
    $f = $m['farbe'];
    echo '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="' . $h($f) . '">'
        . '<title>' . $h($titel) . ' – ' . $h($name) . '</title>'
        . ($m['symbol'] ? '<link rel="icon" href="' . $h($m['symbol']) . '"><link rel="apple-touch-icon" href="' . $h($m['symbol']) . '">' : '')
        . '<style>'
        . ':root{--farbe:' . $f . ';--text:#13232f;--leise:#4b5b67;--linie:#dde5ea;--grund:#f3f6f8;--weich:#e8f1fa;--blau:#0a5a96;--ok:#3f6a12;--ok-grund:#eef6e2;--warn:#8a5300;--warn-grund:#fdf0d5;--fehler:#b3261e;--fehler-grund:#fce8e6}'
        . '*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--grund);color:var(--text);font:1rem/1.55 "Segoe UI",Roboto,"Helvetica Neue",Arial,system-ui,sans-serif;overflow-wrap:anywhere}'
        . 'a{color:var(--blau)}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid var(--farbe);outline-offset:2px}'
        . '.kopf{background:#fff;border-bottom:1px solid var(--linie)}.kopf-innen{max-width:68rem;margin:0 auto;padding:.9rem 1rem;display:flex;align-items:center;gap:.8rem;flex-wrap:wrap}'
        . '.kopf img{display:block;max-height:46px;max-width:180px}.kopf .marke{font-weight:700;font-size:1.15rem;color:var(--text)}.kopf .wo{margin-left:auto;color:var(--leise);font-size:.95rem}'
        . '.seite{max-width:68rem;margin:0 auto;padding:1rem 1rem 2.5rem}'
        . '.hallo{padding:.4rem 0 1rem}.hallo h1{font-size:1.6rem;line-height:1.25;margin:0 0 .25rem}.hallo p{margin:0;color:var(--leise)}'
        . '.objekte{display:flex;flex-wrap:wrap;gap:.5rem;margin:.8rem 0 0;padding:0;list-style:none}.objekte li{background:#fff;border:1px solid var(--linie);border-radius:10px;padding:.45rem .75rem;font-size:.95rem}.objekte b{display:block}.objekte span{color:var(--leise)}'
        . '.sprung{display:flex;gap:.5rem;flex-wrap:wrap;margin:0 0 1rem}.sprung a{background:#fff;border:1px solid var(--linie);border-radius:999px;padding:.35rem .9rem;text-decoration:none;color:var(--text);font-size:.95rem}.sprung a:hover{border-color:var(--farbe)}'
        . '.spalten{display:grid;gap:1rem}@media(min-width:900px){.spalten{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);align-items:start}}.spalte{display:grid;gap:1rem;min-width:0}'
        . '.karte{background:#fff;border-radius:14px;padding:1.1rem 1.1rem 1.2rem;box-shadow:0 1px 2px rgb(19 35 47/.06),0 4px 16px rgb(19 35 47/.06);min-width:0}'
        . '.karte h2{font-size:1.15rem;margin:0 0 .15rem}.karte .unter{color:var(--leise);margin:0 0 .8rem;font-size:.95rem}'
        . '.liste{list-style:none;margin:0;padding:0}.liste>li{display:flex;gap:.8rem;align-items:flex-start;padding:.65rem 0;border-top:1px solid var(--linie)}.liste>li:first-child{border-top:0}'
        . '.datum{flex:0 0 3.6rem;text-align:center;background:var(--weich);color:var(--blau);border-radius:10px;padding:.3rem .2rem;line-height:1.15}.datum b{display:block;font-size:1.25rem}.datum span{font-size:.85rem}'
        . '.was{min-width:0;flex:1}.was b{display:block}.was .leise{font-size:.92rem}'
        . '.pill{display:inline-block;border-radius:999px;padding:.05rem .65rem;font-size:.85rem;font-weight:600;background:var(--weich);color:var(--blau);white-space:nowrap}.pill.termin{background:#efe9fa;color:#5b3fa6}'
        . '.st-eingegangen{background:var(--weich);color:var(--blau)}.st-arbeit{background:var(--warn-grund);color:var(--warn)}.st-erledigt{background:var(--ok-grund);color:var(--ok)}'
        . '.monat{margin:.9rem 0 .2rem;font-size:1rem;color:var(--leise);font-weight:600}.monat:first-of-type{margin-top:0}'
        . '.pdf{display:flex;align-items:center;gap:.7rem;padding:.6rem .7rem;border:1px solid var(--linie);border-radius:10px;text-decoration:none;color:var(--text);margin:.4rem 0}.pdf:hover{border-color:var(--farbe);background:#fafcfd}'
        . '.pdf svg{flex:0 0 auto;color:var(--farbe)}.pdf .was b{font-weight:600}.pdf .was .leise{display:block}.pdf .pfeil{margin-left:auto;color:var(--leise)}'
        . 'details.aelter{margin-top:.6rem}details.aelter summary{cursor:pointer;color:var(--blau);font-weight:600;padding:.3rem 0}'
        . 'label{display:block;margin:.85rem 0 .25rem;font-weight:600}label.haken{display:flex;gap:.6rem;align-items:flex-start;font-weight:400;margin:.8rem 0 .2rem}label.haken input{width:1.25rem;height:1.25rem;margin:.15rem 0 0;flex:0 0 auto}'
        . 'input[type=text],input[type=tel],input[type=email],input[type=date],select,textarea{font:inherit;width:100%;padding:.6rem .7rem;border:1px solid #b9c7d1;border-radius:8px;background:#fff;color:inherit;min-height:2.75rem}textarea{resize:vertical}'
        . 'input[type=file]{font:inherit;width:100%;padding:.5rem;border:1px dashed #b9c7d1;border-radius:8px;background:#fafcfd}'
        . 'fieldset{border:0;padding:0;margin:1rem 0 0}legend{font-weight:700;padding:0;margin:0}.zwei{display:grid;gap:0 .8rem}@media(min-width:560px){.zwei{grid-template-columns:1fr 1fr}}'
        . 'button{display:block;width:100%;font:inherit;font-weight:700;font-size:1.05rem;color:#fff;background:var(--farbe);border:0;border-radius:8px;padding:.85rem 1.2rem;margin-top:1.1rem;cursor:pointer}button:hover{filter:brightness(.95)}'
        . '.hinweis{font-size:.9rem;color:var(--leise);margin:.6rem 0 0}'
        . '.ok,.fehler{border-radius:10px;padding:.7rem .9rem;margin:0 0 1rem;font-weight:600}.ok{background:var(--ok-grund);color:var(--ok)}.fehler{background:var(--fehler-grund);color:var(--fehler)}'
        . '.meldung{display:block!important}.zeile{display:flex;gap:.6rem;align-items:flex-start;justify-content:space-between}.meldung-text{margin:.35rem 0 0;white-space:pre-line}.antwort{margin:.5rem 0 0;padding:.5rem .7rem;background:var(--ok-grund);border-radius:8px;color:#26420b}.antwort b{display:block;font-size:.88rem}'
        . '.leer{color:var(--leise);margin:.2rem 0}'
        // Rechnungen und Angebot
        . '.st-offen{background:var(--weich);color:var(--blau)}.st-ueberfaellig{background:var(--fehler-grund);color:var(--fehler)}.st-teilbezahlt{background:var(--warn-grund);color:var(--warn)}.st-bezahlt{background:var(--ok-grund);color:var(--ok)}.st-storniert,.st-verrechnet{background:var(--grund);color:var(--leise)}'
        . '.pdf .summe{margin-left:auto;text-align:right;white-space:nowrap;display:flex;flex-direction:column;align-items:flex-end;gap:.2rem}.pdf .summe b{font-weight:700}'
        . '.offen-summe{margin:0 0 .6rem;font-size:1.05rem}'
        . '.beleg{margin:.4rem 0 1rem}.beleg .pdf{margin-bottom:0}'
        . '.zahlen{display:flex;flex-wrap:wrap;gap:.6rem 1rem;align-items:flex-start;background:var(--grund);border-radius:10px;padding:.8rem;margin:.3rem 0 0}'
        . '.zahlen .qr{display:block;flex:0 0 auto;image-rendering:pixelated;background:#fff;border-radius:6px}.zahlen .was{flex:1 1 13rem}.zahlen .hinweis{margin:.2rem 0 0}'
        . '.werte{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:.15rem .8rem;margin:.2rem 0 .6rem}.werte dt{color:var(--leise)}.werte dd{margin:0;overflow-wrap:break-word}.nr{display:inline-block;max-width:100%}'
        . '@media(max-width:480px){.zahlen .werte{grid-template-columns:minmax(0,1fr);gap:0}.zahlen .werte dd{margin:0 0 .35rem}}'
        // Mattenwechsel: Liegeplätze unter dem Lieferschein, „bald“ statt eines vergangenen Tages
        . '.ls .plaetze{list-style:none;margin:.35rem 0 0;padding:0 .2rem;font-size:.95rem}.ls .plaetze li{padding:.15rem 0}.ls .plaetze .leise{display:block;color:var(--leise);font-size:.9rem}'
        . '.ls .wer{margin:.25rem 0 0;padding:0 .2rem;color:var(--leise);font-size:.92rem}.ls-hinweis{margin:0 0 .3rem}.datum.bald{display:flex;align-items:center;justify-content:center;min-height:3.2rem}.datum.bald b{font-size:1rem}'
        . '.feldname{display:block;margin:.85rem 0 .25rem;font-weight:600}'
        . '.unterschrift canvas{display:block;width:100%;max-width:600px;aspect-ratio:3/1;border:1px dashed #b9c7d1;border-radius:8px;background:#fff;touch-action:none;cursor:crosshair}'
        . 'button.leise{display:inline-block;width:auto;font-size:.95rem;font-weight:600;color:var(--blau);background:#fff;border:1px solid #b9c7d1;padding:.4rem .9rem;margin-top:.4rem}'
        // Kundenzufriedenheit: Sterne und 0–10 als große Felder (Handy), Auswahl ohne Skript; Sterne bis zur Wahl gefüllt
        . '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
        . '.umfrage{margin:0 0 1rem}.umfrage .frage{margin:1.1rem 0 0}.umfrage legend{font-weight:700;margin:0 0 .45rem}.umfrage .frei{font-weight:400;color:var(--leise)}'
        . '.wahl{position:absolute;opacity:0;width:1px;height:1px;margin:0}'
        . '.sterne{display:flex;flex-wrap:wrap;gap:.4rem}.nps{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:.4rem}@media(min-width:620px){.nps{grid-template-columns:repeat(11,minmax(0,1fr))}}'
        . '.sterne label,.nps label,.keine-angabe label{display:inline-flex;align-items:center;justify-content:center;gap:.2rem;min-width:2.9rem;min-height:2.9rem;margin:0;padding:0 .45rem;border:1px solid #b9c7d1;border-radius:10px;background:#fff;color:var(--text);font-weight:600;cursor:pointer;font-variant-numeric:tabular-nums}'
        . '.sterne .stern{color:#8a5300}.keine-angabe{margin:.4rem 0 0}.keine-angabe label{font-weight:400;min-height:2.4rem}'
        . '.wahl:checked+label{border-color:var(--farbe);background:var(--weich);box-shadow:inset 0 0 0 1px var(--farbe)}.wahl:focus-visible+label{outline:3px solid var(--farbe);outline-offset:2px}'
        . '.sterne:has(.wahl:nth-of-type(1):checked) label:nth-of-type(-n+1) .stern,.sterne:has(.wahl:nth-of-type(2):checked) label:nth-of-type(-n+2) .stern,.sterne:has(.wahl:nth-of-type(3):checked) label:nth-of-type(-n+3) .stern,.sterne:has(.wahl:nth-of-type(4):checked) label:nth-of-type(-n+4) .stern,.sterne:has(.wahl:nth-of-type(5):checked) label:nth-of-type(-n+5) .stern{fill:currentColor}'
        . '.skala{display:flex;justify-content:space-between;gap:1rem;margin:.3rem 0 0;font-size:.88rem;color:var(--leise)}'
        . '.fuss{max-width:68rem;margin:0 auto;padding:0 1rem 2rem;color:var(--leise);font-size:.9rem}.fuss p{margin:.4rem 0}'
        . '</style>'
        . '<script src="' . $h($skript) . '" defer></script></head><body>'
        . '<header class="kopf"><div class="kopf-innen">' . ($m['logo'] ? '<img src="' . $h($m['logo']) . '" alt="' . $h($name) . '">' : '<span class="marke">' . $h($name) . '</span>') . '<span class="wo">' . $h($wo) . '</span></div></header>'
        . $inhalt . '</body></html>';
}

function fehlerseite(string $titel, string $text, int $status, string $firma = ''): void
{
    $h = fn ($t) => htmlspecialchars((string) $t, ENT_QUOTES);
    seite('<main class="seite"><div class="karte"><h1 style="font-size:1.4rem;margin:0 0 .4rem">' . $h($titel) . '</h1><p>' . $h($text) . '</p></div></main>', $status, $titel, $firma);
    exit;
}

// ---------------------------------------------------------------- Aufrufe der App (mit Schlüssel)

$aktion = (string) ($_GET['aktion'] ?? '');
$methode = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$e = einstellungen();

if (in_array($aktion, ['einrichten', 'speichern', 'datei', 'meldungen', 'meldung-status', 'foto', 'status', 'angebot', 'angebot-datei', 'angebot-entfernen', 'annahmen', 'annahme-status', 'umfrage', 'umfrage-antworten', 'umfrage-status'], true)) {
    $gegeben = (string) ($_SERVER['HTTP_X_SCHLUESSEL'] ?? '');
    if (!$e) {
        // erste Einrichtung ohne FTP: mit dem Schlüssel von Plan am Handy oder Schnee-Alarm
        $freigabe = (string) ($_SERVER['HTTP_X_FREIGABE'] ?? '');
        $andere = array_filter([
            (string) (json_lesen((getenv('MEIN_PLAN_ORDNER') ?: ordner()) . '/mitarbeiter.json')['schluessel'] ?? ''),
            (string) (json_lesen((getenv('WETTER_ALARM_ORDNER') ?: ordner()) . '/wetter-alarm.json')['schluessel'] ?? ''),
        ], fn ($k) => strlen($k) >= 32);
        $frei = $aktion === 'einrichten' && $freigabe !== '' && in_array(true, array_map(fn ($k) => hash_equals($k, $freigabe), $andere), true);
        if (!$frei) {
            json_ausgabe(503, ['fehler' => 'Kundenbereich noch nicht eingerichtet: privat/kundenbereich.json fehlt (App → Kundenbereich → Einstellungen).']);
        }
    } elseif ($gegeben === '' || !hash_equals((string) $e['schluessel'], $gegeben)) {
        json_ausgabe(403, ['fehler' => 'Schlüssel fehlt oder falsch']);
    }

    if ($aktion === 'status') {
        $offen = count(array_filter(json_lesen(speicher() . '/meldungen.json'), fn ($m) => empty($m['uebernommen'])));
        $angebote = array_map('json_lesen', glob(speicher('angebote') . '/an*.json') ?: []);
        $neueAnnahmen = count(array_filter($angebote, fn ($a) => !empty($a['annahme']) && empty($a['annahme']['uebernommen'])));
        $neueAntworten = count(array_filter(json_lesen(speicher('umfrage') . '/antworten.json'), fn ($a) => is_array($a) && empty($a['uebernommen'])));
        json_ausgabe(200, ['links' => count(json_lesen(speicher() . '/index.json')), 'neueMeldungen' => $offen, 'angebote' => count($angebote), 'neueAnnahmen' => $neueAnnahmen, 'runden' => count(umfrage_runden()), 'neueAntworten' => $neueAntworten, 'gd' => function_exists('imagejpeg'), 'jetzt' => jetzt()]);
    }
    // Antworten der Umfrage (die App übernimmt sie und meldet „übernommen“ zurück; danach nur noch der Vermerk)
    if ($aktion === 'umfrage-antworten') {
        json_ausgabe(200, ['antworten' => antworten(fn (array &$l) => $l) ?? [], 'runden' => array_column(umfrage_runden(), 'id'), 'jetzt' => jetzt()]);
    }
    // Angebote mit Annahme (die App übernimmt sie und meldet „übernommen“ zurück)
    if ($aktion === 'annahmen') {
        angebote_aufraeumen();
        $liste = [];
        foreach (glob(speicher('angebote') . '/an*.json') ?: [] as $f) {
            $a = json_lesen($f);
            if (!empty($a['annahme']) && preg_match(ANGEBOT_MUSTER, (string) ($a['id'] ?? ''))) {
                $liste[] = ['id' => $a['id'], 'nummer' => (string) ($a['nummer'] ?? ''), 'annahme' => $a['annahme']];
            }
        }
        json_ausgabe(200, ['annahmen' => $liste, 'jetzt' => jetzt()]);
    }
    if ($aktion === 'meldungen') {
        json_ausgabe(200, ['meldungen' => meldungen(fn (array &$l) => $l) ?? [], 'jetzt' => jetzt()]);
    }
    if ($aktion === 'foto') {
        $datei = (string) ($_GET['datei'] ?? '');
        $pfad = speicher('fotos') . '/' . $datei;
        if (!preg_match('/^[a-f0-9]{12}\.(jpg|png|webp)$/', $datei) || !is_file($pfad)) {
            json_ausgabe(404, ['fehler' => 'Foto nicht gefunden']);
        }
        header('Content-Type: ' . array_search(pathinfo($datei, PATHINFO_EXTENSION), BILD_TYPEN, true));
        header('Cache-Control: private, no-store');
        header('X-Content-Type-Options: nosniff');
        header('Content-Length: ' . filesize($pfad));
        readfile($pfad);
        exit;
    }
    if ($methode !== 'POST') {
        json_ausgabe(400, ['fehler' => 'POST erwartet']);
    }

    // PDF eines Links (Rohdaten im Rumpf), nur wenn er in der Liste des Links steht (Nachweis, Rechnung, Lieferschein)
    if ($aktion === 'datei') {
        $id = (string) ($_GET['link'] ?? '');
        $datei = (string) ($_GET['datei'] ?? '');
        $link = preg_match(LINK_MUSTER, $id) ? json_lesen(link_datei($id)) : [];
        $eintrag = null;
        foreach (array_merge((array) ($link['nachweise'] ?? []), (array) ($link['rechnungen'] ?? []), (array) ($link['lieferscheine'] ?? [])) as $n) {
            if (($n['datei'] ?? '') === $datei) {
                $eintrag = $n;
            }
        }
        if (!$link || !(preg_match(DATEI_MUSTER, $datei) || preg_match(BELEG_MUSTER, $datei) || preg_match(LS_MUSTER, $datei)) || !$eintrag) {
            json_ausgabe(404, ['fehler' => 'Link oder Datei unbekannt (zuerst speichern)']);
        }
        $inhalt = pdf_aus_anfrage();
        if (!datei_schreiben(link_ordner($id) . '/' . $datei, $inhalt)) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        $link['dateien'][$datei] = ['sig' => (string) $eintrag['sig'], 'groesse' => strlen($inhalt), 'stand' => jetzt()];
        json_schreiben(link_datei($id), $link);
        json_ausgabe(200, ['gespeichert' => $datei, 'groesse' => strlen($inhalt)]);
    }

    // PDF eines Angebots: nur solange es nicht angenommen ist (das angenommene PDF bleibt, wie es war)
    if ($aktion === 'angebot-datei') {
        $id = (string) ($_GET['angebot'] ?? '');
        if (!preg_match(ANGEBOT_MUSTER, $id) || !is_file(angebot_datei($id))) {
            json_ausgabe(404, ['fehler' => 'Angebot unbekannt (zuerst übertragen)']);
        }
        $inhalt = pdf_aus_anfrage();
        $sha = hash('sha256', $inhalt);
        $ergebnis = gesperrt(angebot_datei($id), function (array &$a) use ($id, $inhalt, $sha) {
            if (empty($a['id']) || !empty($a['entfernt'])) {
                return 'unbekannt';
            }
            if (!empty($a['annahme'])) {
                return 'angenommen';
            }
            if (!datei_schreiben(angebot_pdf($id), $inhalt)) {
                return 'fehler';
            }
            $a['pdfSha256'] = $sha;
            $a['pdfGroesse'] = strlen($inhalt);
            $a['stand'] = jetzt();
            return 'ok';
        });
        if ($ergebnis === 'angenommen') {
            json_ausgabe(409, ['fehler' => 'Das Angebot ist schon angenommen; das PDF bleibt, wie es war.', 'angenommen' => true]);
        }
        if ($ergebnis === 'unbekannt') {
            json_ausgabe(404, ['fehler' => 'Angebot unbekannt (zuerst übertragen)']);
        }
        if ($ergebnis !== 'ok') {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        json_ausgabe(200, ['gespeichert' => true, 'sha256' => $sha, 'groesse' => strlen($inhalt)]);
    }

    $daten = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($daten)) {
        json_ausgabe(400, ['fehler' => 'JSON erwartet']);
    }

    if ($aktion === 'einrichten') {
        if (!is_string($daten['schluessel'] ?? null) || strlen($daten['schluessel']) < 32) {
            json_ausgabe(400, ['fehler' => 'Ungültige Einstellungen']);
        }
        if (!$e && !hash_equals((string) $daten['schluessel'], $gegeben)) {
            json_ausgabe(400, ['fehler' => 'Schlüssel im Kopf und in den Einstellungen müssen gleich sein']);
        }
        if (!json_schreiben(ordner() . '/kundenbereich.json', $daten)) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        json_ausgabe(200, ['gespeichert' => true]);
    }

    if ($aktion === 'meldung-status') {
        $ergebnis = meldungen(function (array &$l) use ($daten, $e) {
            $n = 0;
            $mails = 0;
            $updates = [];
            foreach ((array) ($daten['updates'] ?? []) as $u) {
                if (is_array($u) && isset(STATUS[$u['status'] ?? ''])) {
                    $updates[(string) ($u['id'] ?? '')] = $u;
                }
            }
            $uebernommen = array_map('strval', (array) ($daten['uebernommen'] ?? []));
            $fotos = array_map('strval', (array) ($daten['fotosLoeschen'] ?? []));
            foreach ($l as &$m) {
                $id = (string) ($m['id'] ?? '');
                if (in_array($id, $uebernommen, true) && empty($m['uebernommen'])) {
                    $m['uebernommen'] = jetzt();
                }
                if (in_array($id, $fotos, true) && !empty($m['foto'])) {
                    foto_loeschen($m);
                    $m['foto'] = '';
                }
                $u = $updates[$id] ?? null;
                if (!$u) {
                    continue;
                }
                $antwort = kurz($u['antwort'] ?? '', 1000);
                if (($m['status'] ?? '') === $u['status'] && ($m['antwort'] ?? '') === $antwort) {
                    continue;
                }
                $vorher = $m['status'] ?? '';
                $m['status'] = $u['status'];
                $m['antwort'] = $antwort;
                $m['geaendert'] = jetzt();
                $n++;
                // auf Wunsch den Kunden per E-Mail informieren (nur bei neuem Status)
                $an = (string) ($m['kontakt']['email'] ?? '');
                if (!empty($m['info']) && $vorher !== $u['status'] && filter_var($an, FILTER_VALIDATE_EMAIL)) {
                    $firma = (string) ($e['firma']['name'] ?? marke()['app']);
                    $text = "Guten Tag,\n\nIhre Meldung vom " . datum_text(date('Y-m-d', (int) $m['erstellt']), false) . ' (' . ($m['objekt'] ?? '') . ') ist jetzt: ' . STATUS[$u['status']] . '.'
                        . ($antwort !== '' ? "\n\nUnsere Rückmeldung:\n" . $antwort : '') . "\n\nDen Stand sehen Sie jederzeit in Ihrem Kundenbereich.\n\nMit freundlichen Grüßen\n" . $firma . "\n";
                    if (mail_senden($an, 'Ihre Meldung: ' . STATUS[$u['status']], $text, (string) ($e['absender'] ?? ''), 'Kundenbereich')) {
                        $mails++;
                    }
                }
            }
            unset($m);
            return ['aktualisiert' => $n, 'benachrichtigt' => $mails];
        });
        if ($ergebnis === null) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        json_ausgabe(200, $ergebnis);
    }

    // Angebot veröffentlichen bzw. erneuern (neuer Code ersetzt den alten). Ein angenommenes Angebot
    // ändert niemand mehr. Antwort pdf: true, wenn das PDF (noch) fehlt.
    if ($aktion === 'angebot') {
        $id = (string) ($daten['id'] ?? '');
        $hash = (string) ($daten['hash'] ?? '');
        $gueltig = datum_gueltig($daten['gueltigBis'] ?? '');
        if (!preg_match(ANGEBOT_MUSTER, $id) || !preg_match('/^[a-f0-9]{64}$/', $hash) || $gueltig === '' || kurz($daten['nummer'] ?? '', 40) === '' || !preg_match('/^[a-f0-9]{16,64}$/', (string) ($daten['sig'] ?? ''))) {
            json_ausgabe(400, ['fehler' => 'Angebot unvollständig (Kennung, Code, Nummer, gültig bis)']);
        }
        $ergebnis = gesperrt(angebot_datei($id), function (array &$a) use ($daten, $id, $hash, $gueltig) {
            if (!empty($a['annahme'])) {
                return 'angenommen';
            }
            $sig = (string) $daten['sig'];
            $pdf = ($a['sig'] ?? '') === $sig && is_file(angebot_pdf($id)) ? (string) ($a['pdfSha256'] ?? '') : '';
            $a = [
                'id' => $id, 'hash' => $hash, 'nummer' => kurz($daten['nummer'], 40), 'datum' => datum_gueltig($daten['datum'] ?? ''), 'gueltigBis' => $gueltig,
                'titel' => kurz($daten['titel'] ?? '', 160), 'empfaenger' => kurz($daten['empfaenger'] ?? '', 120),
                'netto' => betrag($daten['netto'] ?? 0), 'ust' => betrag($daten['ust'] ?? 0), 'brutto' => betrag($daten['brutto'] ?? 0),
                'verbraucher' => !empty($daten['verbraucher']), 'name' => pdf_name($daten['name'] ?? null, 'Angebot.pdf'), 'sig' => $sig,
                'pdfSha256' => $pdf, 'pdfGroesse' => $pdf !== '' ? (int) ($a['pdfGroesse'] ?? 0) : 0, 'erstellt' => (int) ($a['erstellt'] ?? jetzt()), 'stand' => jetzt(), 'annahme' => null,
            ];
            return $pdf === '' ? 'pdf' : 'ok';
        });
        if ($ergebnis === null) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        if ($ergebnis === 'angenommen') {
            json_ausgabe(409, ['fehler' => 'Das Angebot ist schon angenommen und lässt sich nicht mehr ändern.', 'angenommen' => true]);
        }
        gesperrt(speicher('angebote') . '/index.json', function (array &$index) use ($id, $hash) {
            $index = array_filter($index, fn ($v) => $v !== $id); // neuer Code: der alte gilt nicht mehr
            $index[$hash] = $id;
        });
        json_ausgabe(200, ['gespeichert' => true, 'pdf' => $ergebnis === 'pdf']);
    }

    // Angebote zurückziehen; eine Annahme, die die App noch nicht abgeholt hat, bleibt (sonst ginge sie verloren)
    if ($aktion === 'angebot-entfernen') {
        $entfernt = 0;
        $behalten = [];
        foreach (array_slice((array) ($daten['ids'] ?? []), 0, 200) as $id) {
            if (!is_string($id) || !preg_match(ANGEBOT_MUSTER, $id) || !is_file(angebot_datei($id))) {
                continue;
            }
            $weg = gesperrt(angebot_datei($id), function (array &$a) {
                if (!empty($a['annahme']) && empty($a['annahme']['uebernommen'])) {
                    return false;
                }
                $a['entfernt'] = jetzt(); // gleichzeitige Annahme sieht das und lehnt ab
                return true;
            });
            if ($weg) {
                angebot_entfernen($id);
                $entfernt++;
            } else {
                $behalten[] = $id;
            }
        }
        json_ausgabe(200, ['entfernt' => $entfernt, 'behalten' => $behalten]);
    }

    // Runden der Umfrage: ersetzt die bisherige Liste (die App schickt alle, die nicht vorbei sind)
    if ($aktion === 'umfrage') {
        $runden = [];
        foreach (array_slice((array) ($daten['runden'] ?? []), 0, 12) as $r) {
            if (!is_array($r)) {
                continue;
            }
            $rid = (string) ($r['id'] ?? '');
            $von = datum_gueltig($r['von'] ?? '');
            $bis = datum_gueltig($r['bis'] ?? '');
            if (!preg_match(RUNDE_MUSTER, $rid) || $von === '' || $bis === '' || $bis < $von || isset($runden[$rid])) {
                continue;
            }
            $f = is_array($r['fragen'] ?? null) ? $r['fragen'] : [];
            $einzeln = [];
            foreach (array_slice((array) ($f['einzeln'] ?? []), 0, 5) as $q) {
                $qid = is_array($q) ? (string) ($q['id'] ?? '') : '';
                $text = is_array($q) ? kurz($q['text'] ?? '', 160) : '';
                if (preg_match(FRAGE_MUSTER, $qid) && $text !== '' && !isset($einzeln[$qid])) {
                    $einzeln[$qid] = ['id' => $qid, 'text' => $text];
                }
            }
            $links = [];
            foreach (array_slice((array) ($r['links'] ?? []), 0, 500) as $l) {
                if (is_string($l) && preg_match(LINK_MUSTER, $l)) {
                    $links[$l] = $l;
                }
            }
            $runden[$rid] = ['id' => $rid, 'von' => $von, 'bis' => $bis, 'fragen' => ['gesamt' => kurz($f['gesamt'] ?? '', 160) ?: UMFRAGE_VORGABE['gesamt'], 'einzeln' => array_values($einzeln), 'nps' => kurz($f['nps'] ?? '', 160) ?: UMFRAGE_VORGABE['nps'], 'freitext' => kurz($f['freitext'] ?? '', 160) ?: UMFRAGE_VORGABE['freitext']], 'links' => array_values($links)];
        }
        if (!json_schreiben(speicher('umfrage') . '/runden.json', ['runden' => array_values($runden), 'stand' => jetzt()])) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        json_ausgabe(200, ['runden' => count($runden)]);
    }

    if ($aktion === 'umfrage-status') {
        $ids = array_values(array_filter(array_slice((array) ($daten['uebernommen'] ?? []), 0, 500), fn ($x) => is_string($x) && preg_match(ANTWORT_MUSTER, $x)));
        $n = antworten(function (array &$l) use ($ids) {
            $n = 0;
            foreach ($l as &$a) {
                if (in_array((string) ($a['id'] ?? ''), $ids, true) && empty($a['uebernommen'])) {
                    $a['uebernommen'] = jetzt();
                    $n++;
                }
            }
            unset($a);
            return $n;
        });
        if ($n === null) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        json_ausgabe(200, ['aktualisiert' => $n]);
    }

    if ($aktion === 'annahme-status') {
        $n = 0;
        foreach (array_slice((array) ($daten['uebernommen'] ?? []), 0, 200) as $id) {
            if (!is_string($id) || !preg_match(ANGEBOT_MUSTER, $id) || !is_file(angebot_datei($id))) {
                continue;
            }
            $n += (int) gesperrt(angebot_datei($id), function (array &$a) {
                if (empty($a['annahme']) || !empty($a['annahme']['uebernommen'])) {
                    return 0;
                }
                $a['annahme']['uebernommen'] = jetzt();
                return 1;
            });
        }
        json_ausgabe(200, ['aktualisiert' => $n]);
    }

    // speichern: je Link Titel, Objekte, was er zeigt, Termine, die Liste der Nachweise und der Rechnungen.
    // Antwort: welche PDFs fehlen oder sich geändert haben (die App lädt nur diese hoch).
    $entfernt = 0;
    foreach ((array) ($daten['entfernen'] ?? []) as $id) {
        if (is_string($id) && link_entfernen($id)) {
            $entfernt++;
        }
    }
    $fehlend = [];
    $anzahl = 0;
    foreach ((array) ($daten['links'] ?? []) as $l) {
        $id = (string) ($l['id'] ?? '');
        $hash = (string) ($l['hash'] ?? '');
        if (!preg_match(LINK_MUSTER, $id) || !preg_match('/^[a-f0-9]{64}$/', $hash)) {
            continue;
        }
        $alt = json_lesen(link_datei($id));
        $objekte = [];
        foreach (array_slice((array) ($l['objekte'] ?? []), 0, 50) as $i => $o) {
            $objekte[] = ['nr' => $i + 1, 'id' => kurz($o['id'] ?? '', 60), 'name' => kurz($o['name'] ?? '', 120) ?: 'Objekt', 'adresse' => kurz($o['adresse'] ?? '', 160)];
        }
        $zeige = [];
        foreach (ZEIGE as $k) {
            $zeige[$k] = !empty($l['zeige'][$k]);
        }
        $termine = $alt['termine'] ?? [];
        if (is_array($l['termine'] ?? null)) {
            $termine = [];
            foreach (array_slice($l['termine'], 0, 40) as $t) {
                if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($t['datum'] ?? ''))) {
                    continue;
                }
                $termine[] = ['datum' => $t['datum'], 'zeit' => kurz($t['zeit'] ?? '', 20), 'titel' => kurz($t['titel'] ?? '', 120), 'art' => ($t['art'] ?? '') === 'termin' ? 'termin' : 'leistung', 'objekt' => kurz($t['objekt'] ?? '', 120), 'hinweis' => kurz($t['hinweis'] ?? '', 80)];
            }
        }
        $nachweise = $alt['nachweise'] ?? [];
        if (is_array($l['nachweise'] ?? null)) {
            $nachweise = [];
            foreach (array_slice($l['nachweise'], 0, 200) as $n) {
                $datei = (string) ($n['datei'] ?? '');
                if (!preg_match(DATEI_MUSTER, $datei) || !preg_match('/^[a-f0-9]{16,64}$/', (string) ($n['sig'] ?? ''))) {
                    continue;
                }
                $name = preg_replace('/[^A-Za-z0-9ÄÖÜäöüß._-]+/u', '-', kurz($n['name'] ?? $datei, 120)) ?: $datei;
                $nachweise[] = ['datei' => $datei, 'monat' => substr($datei, 0, 7), 'art' => str_contains($datei, '-winter-') ? 'winter' : 'leistung', 'titel' => kurz($n['titel'] ?? '', 160), 'objekt' => kurz($n['objekt'] ?? '', 120), 'name' => str_ends_with($name, '.pdf') ? $name : $name . '.pdf', 'sig' => (string) $n['sig']];
            }
        }
        // Rechnungen: null = unverändert (die Rolle sieht die Fakturierung nicht), [] = keine
        $rechnungen = $alt['rechnungen'] ?? [];
        $monate = (int) ($alt['rechnungenMonate'] ?? 13);
        if (is_array($l['rechnungen'] ?? null)) {
            $rechnungen = rechnungen_lesen($l['rechnungen']);
            $monate = max(1, min(36, (int) ($l['rechnungenMonate'] ?? 13)));
        }
        // Mattenwechsel: Lieferscheine und nächster Wechsel, null = unverändert (Rolle ohne Recht), [] = keine
        $lieferscheine = $alt['lieferscheine'] ?? [];
        $lsMonate = (int) ($alt['lieferscheineMonate'] ?? 13);
        if (is_array($l['lieferscheine'] ?? null)) {
            $lieferscheine = lieferscheine_lesen($l['lieferscheine']);
            $lsMonate = max(1, min(36, (int) ($l['lieferscheineMonate'] ?? 13)));
        }
        $naechste = $alt['mattenwechsel'] ?? [];
        if (is_array($l['mattenwechsel'] ?? null)) {
            $naechste = mattenwechsel_lesen($l['mattenwechsel']);
        }
        // Dateien, die nicht mehr in der Liste stehen, löschen; fehlende oder geänderte melden
        $liste = array_column(array_merge($nachweise, $rechnungen, $lieferscheine), null, 'datei');
        $dateien = array_filter((array) ($alt['dateien'] ?? []), fn ($d, $name) => isset($liste[$name]) && is_file(link_ordner($id) . '/' . $name), ARRAY_FILTER_USE_BOTH);
        foreach (glob(link_ordner($id) . '/*.pdf') ?: [] as $f) {
            if (!isset($liste[basename($f)])) {
                @unlink($f);
            }
        }
        foreach ($liste as $n) {
            if (($dateien[$n['datei']]['sig'] ?? '') !== $n['sig']) {
                $fehlend[$id][] = $n['datei'];
            }
        }
        $link = ['id' => $id, 'hash' => $hash, 'titel' => kurz($l['titel'] ?? '', 120), 'objekte' => $objekte, 'zeige' => $zeige, 'termine' => $termine, 'nachweise' => $nachweise, 'rechnungen' => $rechnungen, 'rechnungenMonate' => $monate, 'lieferscheine' => $lieferscheine, 'lieferscheineMonate' => $lsMonate, 'mattenwechsel' => $naechste, 'dateien' => $dateien, 'erstellt' => $alt['erstellt'] ?? jetzt(), 'stand' => jetzt()];
        if (!json_schreiben(link_datei($id), $link)) {
            json_ausgabe(500, ['fehler' => 'Ordner privat/ ist am Webspace nicht beschreibbar']);
        }
        gesperrt(speicher() . '/index.json', function (array &$index) use ($id, $hash) {
            $index = array_filter($index, fn ($v) => $v !== $id); // neuer Code: der alte gilt nicht mehr
            $index[$hash] = $id;
        });
        $anzahl++;
    }
    json_ausgabe(200, ['links' => $anzahl, 'entfernt' => $entfernt, 'fehlend' => (object) $fehlend]);
}

// ---------------------------------------------------------------- Seite für den Kunden

$firma = (string) ($e['firma']['name'] ?? '');
if (!$e) {
    fehlerseite('Kundenbereich', 'Diese Seite ist noch nicht eingerichtet. Bitte wenden Sie sich an Ihre Ansprechperson.', 503);
}
$wer = adresse_des_aufrufs();
if (grenze('fehlversuch', $wer, GRENZE_FEHLVERSUCHE, false)) {
    fehlerseite('Bitte später noch einmal', 'Von dieser Verbindung kamen zu viele ungültige Aufrufe. Bitte versuchen Sie es in einer Viertelstunde wieder.', 429, $firma);
}

// ---------------------------------------------------------------- Angebot online annehmen (kunden.php?a=CODE)

$angebotCode = (string) ($_POST['a'] ?? $_GET['a'] ?? '');
if ($angebotCode !== '' && !isset($_GET['k']) && !isset($_POST['k'])) {
    $a = angebot_zum_code($angebotCode);
    if (!$a) {
        grenze('fehlversuch', $wer, GRENZE_FEHLVERSUCHE, true);
        fehlerseite('Link ungültig', 'Dieser Link gilt nicht (mehr). Bitte wenden Sie sich an Ihre Ansprechperson.', 404, $firma);
    }
    $aid = (string) $a['id'];
    $pdf = angebot_pdf($aid);
    $bereit = is_file($pdf) && (string) ($a['pdfSha256'] ?? '') !== '';
    $annahme = is_array($a['annahme'] ?? null) ? $a['annahme'] : null;
    $abgelaufen = !$annahme && (string) ($a['gueltigBis'] ?? '') < heute();
    if (isset($_GET['datei'])) {
        if (!$bereit) {
            fehlerseite('Nicht gefunden', 'Dieses Dokument ist nicht (mehr) verfügbar.', 404, $firma);
        }
        pdf_senden($pdf, (string) ($a['name'] ?? 'Angebot.pdf'));
    }
    if (!$bereit && !$annahme) {
        fehlerseite('Noch nicht bereit', 'Dieses Angebot wird gerade bereitgestellt. Bitte versuchen Sie es in ein paar Minuten noch einmal.', 503, $firma);
    }
    $nr = (string) ($a['nummer'] ?? '');
    $summe = betrag_text((float) ($a['brutto'] ?? 0));
    $fehler = '';
    $eingabe = [];
    if ($aktion === 'annehmen' && $methode === 'POST') {
        if (fremde_herkunft()) {
            fehlerseite('Nicht erlaubt', 'Das Formular kam von einer anderen Seite.', 403, $firma);
        }
        if ($annahme) {
            header('Location: kunden.php?a=' . rawurlencode($angebotCode), true, 303);
            exit;
        }
        $eingabe = ['name' => kurz($_POST['name'] ?? '', 80), 'funktion' => kurz($_POST['funktion'] ?? '', 80), 'zustimmung' => !empty($_POST['zustimmung']), 'unterschrift' => trim((string) ($_POST['unterschrift'] ?? ''))];
        if ($abgelaufen) {
            $fehler = 'Dieses Angebot ist abgelaufen und lässt sich nicht mehr annehmen.';
        } elseif (grenze('annahme', $aid, GRENZE_ANNAHME, true)) {
            $fehler = 'Heute gab es zu diesem Angebot schon viele Versuche. Bitte rufen Sie uns an.';
        } elseif (mb_strlen($eingabe['name']) < 2) {
            $fehler = 'Bitte geben Sie Ihren Namen an.';
        } elseif (!$eingabe['zustimmung']) {
            $fehler = 'Bitte bestätigen Sie mit dem Häkchen, dass Sie das Angebot annehmen.';
        } elseif ($eingabe['unterschrift'] !== '' && !preg_match(UNTERSCHRIFT_MUSTER, $eingabe['unterschrift'])) {
            $fehler = 'Die Unterschrift ließ sich nicht lesen. Bitte noch einmal unterschreiben oder ohne Unterschrift senden.';
        }
        if (!$fehler) {
            // Nachweis: Zeitpunkt, Name, Funktion, Nummer und der SHA-256 genau des PDF, das hier liegt; keine IP-Adresse
            $neu = ['zeit' => jetzt(), 'name' => $eingabe['name'], 'funktion' => $eingabe['funktion'], 'nummer' => $nr, 'pdfSha256' => (string) hash_file('sha256', $pdf), 'unterschrift' => $eingabe['unterschrift'], 'uebernommen' => null];
            $ok = gesperrt(angebot_datei($aid), function (array &$x) use ($neu) {
                if (empty($x['id']) || !empty($x['entfernt'])) {
                    return 'weg';
                }
                if (!empty($x['annahme'])) {
                    return 'schon';
                }
                if ((string) ($x['gueltigBis'] ?? '') < heute()) {
                    return 'abgelaufen';
                }
                $x['annahme'] = $neu;
                return 'ok';
            });
            if ($ok === 'ok') {
                // Büro: Push nur mit der Nummer (geht über einen fremden Dienst), E-Mail mit allem
                $app = rtrim((string) ($e['adresse'] ?? ''), '/') . '/#fakturierung';
                $titel = 'Angebot online angenommen: ' . $nr;
                $text = 'Das Angebot ' . $nr . (($a['titel'] ?? '') !== '' ? ' (' . $a['titel'] . ')' : '') . ' über ' . $summe . ' wurde am ' . zeit_text($neu['zeit']) . " Uhr online angenommen.\n"
                    . 'Angenommen von: ' . $neu['name'] . ($neu['funktion'] !== '' ? ' (' . $neu['funktion'] . ')' : '') . "\n"
                    . (($a['empfaenger'] ?? '') !== '' ? 'Empfänger laut Angebot: ' . $a['empfaenger'] . "\n" : '')
                    . ($neu['unterschrift'] !== '' ? "Mit Unterschrift.\n" : '')
                    . 'SHA-256 des angenommenen PDF: ' . $neu['pdfSha256'] . "\n\nIn der App unter „Fakturierung → Angebote“ die Auftragsbestätigung erstellen.";
                foreach ((array) ($e['buero'] ?? []) as $b) {
                    if (!empty($b['ntfy'])) {
                        ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $b['ntfy'], 'title' => $titel, 'message' => 'In der App unter „Fakturierung → Angebote“.', 'priority' => 4, 'click' => $app]);
                    }
                    if (!empty($b['email'])) {
                        mail_senden((string) $b['email'], $titel, $text . "\n\nApp: $app\n", (string) ($e['absender'] ?? ''), 'Kundenbereich');
                    }
                }
            }
            if ($ok === 'ok' || $ok === 'schon') {
                header('Location: kunden.php?a=' . rawurlencode($angebotCode) . '&angenommen=1', true, 303);
                exit;
            }
            $fehler = $ok === 'abgelaufen' ? 'Dieses Angebot ist abgelaufen und lässt sich nicht mehr annehmen.' : 'Das Angebot ließ sich nicht annehmen. Bitte rufen Sie uns an.';
        }
    }

    $k = rawurlencode($angebotCode);
    $datum = fn (string $d) => datum_text($d, false);
    $werte = '<dl class="werte"><dt>Nummer</dt><dd>' . $h($nr) . '</dd>' . (($a['datum'] ?? '') !== '' ? '<dt>Datum</dt><dd>' . $h($datum((string) $a['datum'])) . '</dd>' : '')
        . '<dt>Summe</dt><dd><b>' . $h($summe) . '</b>' . ((float) ($a['ust'] ?? 0) ? ' inkl. USt<br><span class="leise">netto ' . $h(betrag_text((float) $a['netto'])) . '</span>' : '') . '</dd>'
        . '<dt>Gültig bis</dt><dd>' . $h($datum((string) $a['gueltigBis'])) . '</dd></dl>';
    $pdfLink = $bereit ? '<a class="pdf" href="kunden.php?a=' . $k . '&amp;datei=1" target="_blank" rel="noopener">' . svg_pdf() . '<span class="was"><b>Angebot als PDF</b><span class="leise">' . $h($a['name'] ?? '') . ' · PDF, ' . groesse_text((int) ($a['pdfGroesse'] ?? 0)) . '</span></span>' . svg_pfeil() . '</a>' : '';
    $datenschutz = (string) ($e['firma']['datenschutz'] ?? '');
    $status = 200;
    if ($annahme) {
        $teil = '<h2>Angenommen</h2>' . (($_GET['angenommen'] ?? '') === '1' ? '<p class="ok" role="status">Danke! Ihre Annahme ist bei uns eingegangen.</p>' : '')
            . '<p>Sie haben dieses Angebot am <b>' . $h(zeit_text((int) ($annahme['zeit'] ?? 0))) . ' Uhr</b> angenommen.</p>'
            . '<dl class="werte"><dt>Angenommen von</dt><dd>' . $h($annahme['name'] ?? '') . (($annahme['funktion'] ?? '') !== '' ? ', ' . $h($annahme['funktion']) : '') . '</dd>'
            . '<dt>Unterschrift</dt><dd>' . (($annahme['unterschrift'] ?? '') !== '' ? 'ja' : 'ohne') . '</dd></dl>'
            . '<p class="hinweis">Wir melden uns mit der Auftragsbestätigung. Das PDF ist genau das Angebot, das Sie angenommen haben.</p>';
    } elseif ($abgelaufen) {
        $status = 410;
        $teil = '<h2>Abgelaufen</h2><p class="fehler" role="status">Dieses Angebot war bis ' . $h($datum((string) $a['gueltigBis'])) . ' gültig und ist abgelaufen.</p><p>Für ein neues Angebot melden Sie sich bitte bei uns.</p>';
    } else {
        $status = $fehler ? 400 : 200;
        $teil = '<h2>Angebot annehmen</h2><p class="unter">Passt alles? Dann können Sie das Angebot hier verbindlich annehmen.</p>'
            . ($fehler ? '<p class="fehler" role="alert">' . $h($fehler) . '</p>' : '')
            . '<form method="post" action="kunden.php?aktion=annehmen" data-unterschrift><input type="hidden" name="a" value="' . $h($angebotCode) . '">'
            . '<label for="a-name">Ihr Name</label><input type="text" id="a-name" name="name" maxlength="80" autocomplete="name" required value="' . $h($eingabe['name'] ?? '') . '">'
            . '<label for="a-funktion">Funktion (optional)</label><input type="text" id="a-funktion" name="funktion" maxlength="80" autocomplete="organization-title" placeholder="z. B. Geschäftsführung, Hausverwaltung" value="' . $h($eingabe['funktion'] ?? '') . '">'
            . '<div class="unterschrift" hidden><span class="feldname" id="a-unterschrift-titel">Unterschrift (optional)</span><canvas width="600" height="200" role="img" aria-labelledby="a-unterschrift-titel"></canvas><input type="hidden" name="unterschrift" value=""><button type="button" class="leise" data-loeschen>Unterschrift löschen</button></div>'
            . '<label class="haken"><input type="checkbox" name="zustimmung" value="1" required> Ich nehme das Angebot ' . $h($nr) . (($a['datum'] ?? '') !== '' ? ' vom ' . $h($datum((string) $a['datum'])) : '') . ' über ' . $h($summe) . ' verbindlich an.</label>'
            . (!empty($a['verbraucher']) ? '<p class="hinweis">Hinweis für Verbraucher: Ihr Rücktrittsrecht und die Belehrung dazu finden Sie im Angebot (PDF).</p>' : '')
            . '<button type="submit">Angebot verbindlich annehmen</button>'
            . '<p class="hinweis">Als Nachweis speichern wir zum Angebot Ihren Namen, die Funktion, die Unterschrift (wenn Sie unterschreiben) und den Zeitpunkt, aber nicht Ihre IP-Adresse.' . ($datenschutz !== '' && preg_match('#^https://#', $datenschutz) ? ' <a href="' . $h($datenschutz) . '" target="_blank" rel="noopener">Datenschutzerklärung</a>' : '') . '</p></form>';
    }
    $unter = array_filter([(string) ($a['titel'] ?? ''), ($a['empfaenger'] ?? '') !== '' ? 'für ' . $a['empfaenger'] : '']);
    seite('<main class="seite"><div class="hallo"><h1>Angebot ' . $h($nr) . '</h1><p>' . $h(implode(' · ', $unter) ?: 'Ihr Angebot' . ($firma !== '' ? ' von ' . $firma : '')) . '</p></div>'
        . '<div class="spalten"><div class="spalte"><section class="karte" id="angebot"><h2>Ihr Angebot</h2><p class="unter">Alle Einzelheiten stehen im PDF.</p>' . $werte . $pdfLink . '</section></div>'
        . '<div class="spalte"><section class="karte" id="annahme">' . $teil . '</section></div></div></main>'
        . '<footer class="fuss">' . kontakt_html($e) . '<p>Dieser Link gehört zu diesem Angebot: Bitte geben Sie ihn nur an Personen weiter, die darüber entscheiden.</p></footer>', $status, 'Angebot', $firma, 'Angebot', 'kunden-unterschrift.js');
    exit;
}

$code = (string) ($_POST['k'] ?? $_GET['k'] ?? '');
$link = link_zum_code($code);
if (!$link) {
    grenze('fehlversuch', $wer, GRENZE_FEHLVERSUCHE, true);
    fehlerseite('Link ungültig', 'Dieser Link gilt nicht (mehr). Bitte fordern Sie bei Ihrer Ansprechperson einen neuen an.', 404, $firma);
}
$zeige = array_merge(array_fill_keys(ZEIGE, false), (array) ($link['zeige'] ?? []));
$objekte = (array) ($link['objekte'] ?? []);
$id = (string) $link['id'];

// PDF herunterladen (nur Dateien aus der Liste dieses Links: Nachweise, Rechnungen bzw. Lieferscheine, wenn der Link sie zeigt)
if (isset($_GET['datei'])) {
    $datei = (string) $_GET['datei'];
    $eintrag = null;
    foreach ((array) ($link['nachweise'] ?? []) as $n) {
        if (($n['datei'] ?? '') === $datei && !empty($zeige[$n['art'] === 'winter' ? 'winter' : 'nachweise']) && preg_match(DATEI_MUSTER, $datei)) {
            $eintrag = $n;
        }
    }
    foreach (!empty($zeige['rechnungen']) ? (array) ($link['rechnungen'] ?? []) : [] as $r) {
        if (($r['datei'] ?? '') === $datei && preg_match(BELEG_MUSTER, $datei)) {
            $eintrag = $r;
        }
    }
    foreach (!empty($zeige['lieferscheine']) ? (array) ($link['lieferscheine'] ?? []) : [] as $r) {
        if (($r['datei'] ?? '') === $datei && preg_match(LS_MUSTER, $datei)) {
            $eintrag = $r;
        }
    }
    $pfad = link_ordner($id) . '/' . $datei;
    if (!$eintrag || !is_file($pfad)) {
        fehlerseite('Nicht gefunden', 'Dieses Dokument ist nicht (mehr) verfügbar.', 404, $firma);
    }
    pdf_senden($pfad, (string) $eintrag['name']);
}

// Reklamation melden
$fehler = '';
$eingabe = [];
if ($aktion === 'melden' && $methode === 'POST') {
    if (fremde_herkunft()) {
        fehlerseite('Nicht erlaubt', 'Das Formular kam von einer anderen Seite.', 403, $firma);
    }
    if (empty($zeige['reklamation'])) {
        fehlerseite('Nicht möglich', 'Über diesen Link können keine Reklamationen gemeldet werden.', 403, $firma);
    }
    $eingabe = [
        'objekt' => (int) ($_POST['objekt'] ?? (count($objekte) === 1 ? 1 : 0)),
        'art' => (string) ($_POST['art'] ?? ''),
        'datum' => (string) ($_POST['datum'] ?? ''),
        'text' => kurz($_POST['text'] ?? '', 2000),
        'name' => kurz($_POST['name'] ?? '', 80),
        'telefon' => kurz($_POST['telefon'] ?? '', 40),
        'email' => kurz($_POST['email'] ?? '', 120),
        'info' => !empty($_POST['info']),
    ];
    $objekt = null;
    foreach ($objekte as $o) {
        if ((int) $o['nr'] === $eingabe['objekt']) {
            $objekt = $o;
        }
    }
    $gueltig = fn ($d) => (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && DateTimeImmutable::createFromFormat('!Y-m-d', $d);
    if (!$objekt) {
        $fehler = 'Bitte wählen Sie das Objekt.';
    } elseif (!isset(ARTEN[$eingabe['art']])) {
        $fehler = 'Bitte wählen Sie, worum es geht.';
    } elseif (mb_strlen($eingabe['text']) < 5) {
        $fehler = 'Bitte beschreiben Sie kurz, was Ihnen aufgefallen ist.';
    } elseif ($eingabe['datum'] !== '' && (!$gueltig($eingabe['datum']) || $eingabe['datum'] > heute() || $eingabe['datum'] < tag_plus(heute(), -60))) {
        $fehler = 'Bitte ein Datum aus den letzten 60 Tagen angeben.';
    } elseif ($eingabe['name'] === '') {
        $fehler = 'Bitte geben Sie Ihren Namen an.';
    } elseif ($eingabe['telefon'] === '' && $eingabe['email'] === '') {
        $fehler = 'Bitte geben Sie eine Telefonnummer oder E-Mail-Adresse an, damit wir Sie erreichen.';
    } elseif ($eingabe['telefon'] !== '' && !preg_match('/^[0-9 +\/()-]{5,40}$/', $eingabe['telefon'])) {
        $fehler = 'Bitte prüfen Sie die Telefonnummer.';
    } elseif ($eingabe['email'] !== '' && !filter_var($eingabe['email'], FILTER_VALIDATE_EMAIL)) {
        $fehler = 'Bitte prüfen Sie die E-Mail-Adresse.';
    } elseif ($eingabe['info'] && $eingabe['email'] === '') {
        $fehler = 'Für die Nachricht bei Änderungen bitte die E-Mail-Adresse angeben.';
    } elseif (grenze('meldung-link', $id, GRENZE_MELDUNG_LINK, false) || grenze('meldung-adresse', $wer, GRENZE_MELDUNG_ADRESSE, false)) {
        $fehler = 'Heute sind schon viele Meldungen eingegangen. Bitte rufen Sie uns an.';
    }
    $mid = bin2hex(random_bytes(6));
    $foto = '';
    if (!$fehler) {
        [$foto, $fehler] = foto_speichern($_FILES['foto'] ?? null, $mid);
    }
    // Grenzen prüfen und zählen in einem Schritt (gesperrt): gleichzeitig gesendete Meldungen kämen sonst alle an der
    // Prüfung oben vorbei, bevor die erste gezählt ist
    if (!$fehler && (grenze('meldung-link', $id, GRENZE_MELDUNG_LINK, true) || grenze('meldung-adresse', $wer, GRENZE_MELDUNG_ADRESSE, true))) {
        foto_loeschen(['foto' => $foto]);
        $fehler = 'Heute sind schon viele Meldungen eingegangen. Bitte rufen Sie uns an.';
    }
    if (!$fehler) {
        $neu = ['id' => $mid, 'link' => $id, 'titel' => (string) ($link['titel'] ?? ''), 'objektNr' => (int) $objekt['nr'], 'objektId' => (string) $objekt['id'], 'objekt' => (string) $objekt['name'], 'art' => $eingabe['art'], 'datum' => $eingabe['datum'] ?: heute(), 'text' => $eingabe['text'],
            'kontakt' => ['name' => $eingabe['name'], 'telefon' => $eingabe['telefon'], 'email' => $eingabe['email']], 'info' => $eingabe['info'], 'foto' => $foto, 'erstellt' => jetzt(), 'status' => 'eingegangen', 'antwort' => '', 'geaendert' => jetzt(), 'uebernommen' => null];
        $ok = meldungen(function (array &$l) use ($neu) {
            $l[] = $neu;
            return true;
        });
        if (!$ok) {
            foto_loeschen($neu);
            $fehler = 'Ihre Meldung konnte nicht gespeichert werden. Bitte rufen Sie uns an.';
        } else {
            // Büro: Push nur mit Objekt und Art (geht über einen fremden Dienst), E-Mail mit allem
            $app = rtrim((string) ($e['adresse'] ?? ''), '/') . '/#reklamationen';
            $titel = 'Reklamation im Kundenbereich: ' . $objekt['name'];
            $text = ARTEN[$eingabe['art']] . ($eingabe['datum'] ? ', aufgefallen am ' . datum_text($neu['datum'], false) : '') . "\n„" . $eingabe['text'] . "“\n"
                . 'Kontakt: ' . implode(', ', array_filter([$eingabe['name'], $eingabe['telefon'], $eingabe['email']])) . ($foto ? "\nMit Foto." : '') . "\nIn der App unter „Reklamationen“.";
            foreach ((array) ($e['buero'] ?? []) as $b) {
                if (!empty($b['ntfy'])) {
                    ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $b['ntfy'], 'title' => $titel, 'message' => ARTEN[$eingabe['art']] . '. In der App unter „Reklamationen“.', 'priority' => 4, 'tags' => ['speech_balloon'], 'click' => $app]);
                }
                if (!empty($b['email'])) {
                    mail_senden((string) $b['email'], $titel, $text . "\n\nApp: $app\n", (string) ($e['absender'] ?? ''), 'Kundenbereich');
                }
            }
            header('Location: kunden.php?k=' . rawurlencode($code) . '&gesendet=1#meldungen', true, 303);
            exit;
        }
    }
}

// Kundenzufriedenheit: Umfrage der offenen Runde (eine Antwort je Runde und Link)
$umfrage = offene_runde($id);
$uFehler = '';
$uStatus = 200;
$uEingabe = [];
if ($aktion === 'bewerten' && $methode === 'POST') {
    if (fremde_herkunft()) {
        fehlerseite('Nicht erlaubt', 'Das Formular kam von einer anderen Seite.', 403, $firma);
    }
    $werte = is_array($_POST['wert'] ?? null) ? $_POST['wert'] : [];
    $uEingabe = [
        'gesamt' => wahl_wert($_POST['gesamt'] ?? '', 1, 5),
        'werte' => [],
        'nps' => wahl_wert($_POST['nps'] ?? '', 0, 10),
        'text' => kurz($_POST['text'] ?? '', 2000),
        'name' => kurz($_POST['name'] ?? '', 80),
        'funktion' => kurz($_POST['funktion'] ?? '', 80),
        'rueckruf' => !empty($_POST['rueckruf']),
        'telefon' => kurz($_POST['telefon'] ?? '', 40),
        'objekt' => (int) ($_POST['objekt'] ?? 0),
    ];
    foreach ((array) ($umfrage['fragen']['einzeln'] ?? []) as $q) {
        $v = wahl_wert($werte[$q['id']] ?? '', 1, 5);
        if ($v !== null) {
            $uEingabe['werte'][$q['id']] = $v;
        }
    }
    $uObjekt = null;
    foreach ($objekte as $o) {
        if ((int) $o['nr'] === $uEingabe['objekt'] && count($objekte) > 1) {
            $uObjekt = $o;
        }
    }
    if (!$umfrage || (string) ($_POST['runde'] ?? '') !== (string) $umfrage['id']) {
        [$uFehler, $uStatus] = ['Diese Umfrage ist abgeschlossen. Danke für Ihr Interesse!', 410];
    } elseif (beantwortet($id, (string) $umfrage['id'])) {
        [$uFehler, $uStatus] = ['Für diese Umfrage ist Ihre Antwort schon bei uns eingegangen. Danke!', 409];
    } elseif (grenze('umfrage-link', $id, GRENZE_UMFRAGE_LINK, true) || grenze('umfrage-adresse', $wer, GRENZE_UMFRAGE_ADRESSE, false)) {
        [$uFehler, $uStatus] = ['Heute gab es schon viele Versuche. Bitte versuchen Sie es morgen wieder oder rufen Sie uns an.', 429];
    } elseif ($uEingabe['gesamt'] === null) {
        [$uFehler, $uStatus] = ['Bitte geben Sie an, wie zufrieden Sie insgesamt sind (1 bis 5 Sterne).', 400];
    } elseif ($uEingabe['rueckruf'] && !preg_match(TELEFON_MUSTER, $uEingabe['telefon'])) {
        [$uFehler, $uStatus] = ['Für den Rückruf bitte eine Telefonnummer angeben.', 400];
    } elseif ($uEingabe['telefon'] !== '' && !preg_match(TELEFON_MUSTER, $uEingabe['telefon'])) {
        [$uFehler, $uStatus] = ['Bitte prüfen Sie die Telefonnummer.', 400];
    }
    if (!$uFehler) {
        $neu = ['id' => bin2hex(random_bytes(6)), 'runde' => (string) $umfrage['id'], 'link' => $id, 'zeit' => jetzt(), 'objekt' => $uObjekt ? ['nr' => (int) $uObjekt['nr'], 'id' => (string) $uObjekt['id'], 'name' => (string) $uObjekt['name']] : null,
            'gesamt' => $uEingabe['gesamt'], 'werte' => (object) $uEingabe['werte'], 'nps' => $uEingabe['nps'], 'text' => $uEingabe['text'], 'rueckruf' => $uEingabe['rueckruf'], 'telefon' => $uEingabe['telefon'], 'name' => $uEingabe['name'], 'funktion' => $uEingabe['funktion'], 'uebernommen' => null];
        $ok = antworten(function (array &$l) use ($neu) {
            foreach ($l as $a) {
                if (($a['link'] ?? '') === $neu['link'] && ($a['runde'] ?? '') === $neu['runde']) {
                    return 'schon';
                }
            }
            $l[] = $neu;
            return 'ok';
        });
        if ($ok === 'schon') {
            [$uFehler, $uStatus] = ['Für diese Umfrage ist Ihre Antwort schon bei uns eingegangen. Danke!', 409];
        } elseif ($ok !== 'ok') {
            [$uFehler, $uStatus] = ['Ihre Antwort konnte nicht gespeichert werden. Bitte versuchen Sie es später noch einmal.', 500];
        } else {
            grenze('umfrage-adresse', $wer, GRENZE_UMFRAGE_ADRESSE, true);
            // Büro: nur bei schlechter Bewertung oder Rückruf; Push ohne Inhalt (fremder Dienst), E-Mail mit allem
            if ($neu['gesamt'] <= 2 || $neu['rueckruf']) {
                $app = rtrim((string) ($e['adresse'] ?? ''), '/') . '/#zufriedenheit';
                $titel = $neu['rueckruf'] ? 'Kundenumfrage: Rückruf erwünscht' : 'Kundenumfrage: schlechte Bewertung';
                $text = 'Kunde: ' . ($link['titel'] ?? '') . ($uObjekt ? ' (' . $uObjekt['name'] . ')' : '') . "\nGesamt: " . $neu['gesamt'] . ' von 5 Sternen'
                    . ($neu['nps'] !== null ? "\nWeiterempfehlung: " . $neu['nps'] . ' von 10' : '')
                    . ($neu['rueckruf'] ? "\nRückruf erwünscht: " . $neu['telefon'] : '')
                    . ($neu['name'] !== '' ? "\nVon: " . $neu['name'] . ($neu['funktion'] !== '' ? ' (' . $neu['funktion'] . ')' : '') : '')
                    . ($neu['text'] !== '' ? "\n„" . $neu['text'] . '“' : '') . "\nIn der App unter „Kundenzufriedenheit“.";
                foreach ((array) ($e['buero'] ?? []) as $b) {
                    if (!empty($b['ntfy'])) {
                        ntfy_senden((string) ($e['ntfy'] ?? ''), ['topic' => (string) $b['ntfy'], 'title' => $titel, 'message' => 'In der App unter „Kundenzufriedenheit“.', 'priority' => 4, 'click' => $app]);
                    }
                    if (!empty($b['email'])) {
                        mail_senden((string) $b['email'], $titel, $text . "\n\nApp: $app\n", (string) ($e['absender'] ?? ''), 'Kundenbereich');
                    }
                }
            }
            header('Location: kunden.php?k=' . rawurlencode($code) . '&danke=' . ($neu['rueckruf'] ? '2' : '1') . '#umfrage', true, 303);
            exit;
        }
    }
}

// Inhalte der Seite
$heute = heute();
$termine = array_values(array_filter((array) ($link['termine'] ?? []), fn ($t) => ($t['datum'] ?? '') >= $heute && !empty($zeige[($t['art'] ?? '') === 'termin' ? 'termine' : 'leistungen'])));
$nachweise = array_values(array_filter((array) ($link['nachweise'] ?? []), fn ($n) => !empty($zeige[($n['art'] ?? '') === 'winter' ? 'winter' : 'nachweise']) && isset($link['dateien'][$n['datei']])));
$meine = array_values(array_filter(meldungen(fn (array &$l) => $l) ?? [], fn ($m) => ($m['link'] ?? '') === $id));
usort($meine, fn ($a, $b) => (int) $b['erstellt'] <=> (int) $a['erstellt']);
$k = rawurlencode($code);
$mehrere = count($objekte) > 1;

$teile = [];
$sprung = [];
// Nächste Termine
if (!empty($zeige['leistungen']) || !empty($zeige['termine'])) {
    $zeilen = '';
    foreach ($termine as $t) {
        $d = DateTimeImmutable::createFromFormat('!Y-m-d', $t['datum']);
        $zeilen .= '<li><div class="datum"><span>' . $h(TAGE[(int) $d->format('N') - 1]) . '</span><b>' . $d->format('d') . '</b><span>' . $h(mb_substr(MONATE[(int) $d->format('n') - 1], 0, 3)) . '</span></div><div class="was"><b>' . $h($t['titel']) . '</b>'
            . '<span class="leise">' . $h(datum_text($t['datum'])) . ($t['zeit'] !== '' ? ', ' . $h($t['zeit'] === 'ganztägig' ? 'ganztägig' : $t['zeit'] . ' Uhr') : '') . ($mehrere && $t['objekt'] !== '' ? ' · ' . $h($t['objekt']) : '') . '</span>'
            . ($t['hinweis'] !== '' || $t['art'] === 'termin' ? '<br><span class="pill' . ($t['art'] === 'termin' ? ' termin' : '') . '">' . $h($t['hinweis'] !== '' ? $t['hinweis'] : 'Termin') . '</span>' : '') . '</div></li>';
    }
    $sprung[] = '<a href="#termine">Termine</a>';
    $teile['links'][] = '<section class="karte" id="termine"><h2>Nächste Termine</h2><p class="unter">' . (!empty($zeige['leistungen']) && !empty($zeige['termine']) ? 'Periodische Leistungen und vereinbarte Termine in Ihrem Objekt.' : (!empty($zeige['leistungen']) ? 'Periodische Leistungen in Ihrem Objekt, z. B. Grund- oder Glasreinigung.' : 'Vereinbarte Termine und Begehungen.')) . '</p>'
        . ($zeilen ? '<ul class="liste">' . $zeilen . '</ul>' : '<p class="leer">In den nächsten Wochen stehen keine besonderen Termine an.</p>') . '</section>';
}
// Nachweise je Monat
if (!empty($zeige['nachweise']) || !empty($zeige['winter'])) {
    $symbol = svg_pdf();
    $pfeil = svg_pfeil();
    $monate = [];
    foreach ($nachweise as $n) {
        $monate[$n['monat']][] = $n;
    }
    krsort($monate);
    $html = '';
    $i = 0;
    foreach ($monate as $monat => $liste) {
        usort($liste, fn ($a, $b) => [$a['art'] === 'winter', $a['objekt']] <=> [$b['art'] === 'winter', $b['objekt']]);
        $block = '<h3 class="monat">' . $h(monat_text($monat)) . '</h3>';
        foreach ($liste as $n) {
            $block .= '<a class="pdf" href="kunden.php?k=' . $k . '&amp;datei=' . $h($n['datei']) . '" target="_blank" rel="noopener">' . $symbol . '<span class="was"><b>' . ($n['art'] === 'winter' ? 'Winterdienst-Nachweis' : 'Leistungsnachweis') . '</b>'
                . '<span class="leise">' . ($mehrere ? $h($n['objekt']) . ' · ' : '') . 'PDF, ' . groesse_text((int) ($link['dateien'][$n['datei']]['groesse'] ?? 0)) . '</span></span>' . $pfeil . '</a>';
        }
        $html .= $i === 3 ? '<details class="aelter"><summary>Ältere Nachweise</summary>' . $block : $block;
        $i++;
    }
    if ($i > 3) {
        $html .= '</details>';
    }
    $tag = max(1, min(28, (int) ($e['firma']['freigabeTag'] ?? 5)));
    $sprung[] = '<a href="#nachweise">Nachweise</a>';
    $teile['links'][] = '<section class="karte" id="nachweise"><h2>Leistungsnachweise</h2><p class="unter">Was wir in Ihrem Objekt geleistet haben, je Monat als PDF. Der Nachweis eines Monats erscheint ab dem ' . $tag . '. des Folgemonats.</p>'
        . ($html ?: '<p class="leer">Noch keine Nachweise vorhanden.</p>') . '</section>';
}
// Mattenwechsel: nächster Wechsel je Liegeplatz (nur Datum) und Lieferscheine (nur mit PDF am Server), ohne Preise
if (!empty($zeige['mattenwechsel']) || !empty($zeige['lieferscheine'])) {
    $html = '';
    if (!empty($zeige['mattenwechsel'])) {
        $zeilen = '';
        foreach ((array) ($link['mattenwechsel'] ?? []) as $n) {
            $d = DateTimeImmutable::createFromFormat('!Y-m-d', (string) ($n['datum'] ?? ''));
            if (!$d) {
                continue;
            }
            // seit dem letzten Übertragen vorbei: der Wechsel steht kurz bevor
            $bald = $n['datum'] < $heute;
            $zeilen .= '<li>' . ($bald ? '<div class="datum bald"><b>bald</b></div>' : '<div class="datum"><span>' . $h(TAGE[(int) $d->format('N') - 1]) . '</span><b>' . $d->format('d') . '</b><span>' . $h(mb_substr(MONATE[(int) $d->format('n') - 1], 0, 3)) . '</span></div>')
                . '<div class="was"><b>' . $h($n['liegeplatz']) . '</b><span class="leise">' . ($bald ? 'in Kürze' : $h(datum_text($n['datum']))) . ($mehrere && $n['objekt'] !== '' ? ' · ' . $h($n['objekt']) : '') . '</span></div></li>';
        }
        $html .= '<h3 class="monat">Nächster Wechsel</h3>' . ($zeilen ? '<ul class="liste">' . $zeilen . '</ul>' : '<p class="leer">Zurzeit ist kein Wechsel geplant.</p>');
    }
    if (!empty($zeige['lieferscheine'])) {
        $belege = array_values(array_filter((array) ($link['lieferscheine'] ?? []), fn ($r) => isset($link['dateien'][$r['datei'] ?? ''])));
        $block = '';
        foreach ($belege as $i => $r) {
            $teil = [$r['datum'] !== '' ? datum_text($r['datum'], false) . ($r['zeit'] !== '' ? ', ' . $r['zeit'] . ' Uhr' : '') : '', $r['objekt']];
            $plaetze = '';
            foreach ((array) $r['liegeplaetze'] as $p) {
                $matten = implode(', ', array_map(fn ($m) => (int) $m['menge'] . ' × ' . $m['text'], (array) $p['matten']));
                $plaetze .= '<li><b>' . $h($p['name']) . '</b>' . ($matten !== '' ? ': ' . $h($matten) : '')
                    . implode('', array_map(fn ($t) => '<span class="leise">' . $h($t) . '</span>', (array) $p['hinweise'])) . '</li>';
            }
            $u = $r['unterschrift'];
            $wer = !$u ? '' : (!empty($u['ohne']) ? 'Ohne Unterschrift: ' . $u['grund'] : ($u['name'] !== '' ? 'Unterschrieben von ' . $u['name'] . ($u['funktion'] !== '' ? ' (' . $u['funktion'] . ')' : '') : ''));
            $block .= ($i === 8 ? '<details class="aelter"><summary>Ältere Lieferscheine</summary>' : '')
                . '<div class="beleg ls"><a class="pdf" href="kunden.php?k=' . $k . '&amp;datei=' . $h($r['datei']) . '" target="_blank" rel="noopener">' . svg_pdf() . '<span class="was"><b>Lieferschein <span class="nr">' . $h($r['nummer']) . '</span></b>'
                . '<span class="leise">' . $h(implode(' · ', array_filter($teil))) . ' · PDF, ' . groesse_text((int) ($link['dateien'][$r['datei']]['groesse'] ?? 0)) . '</span></span>' . svg_pfeil() . '</a>'
                . ($plaetze !== '' ? '<ul class="plaetze">' . $plaetze . '</ul>' : '') . ($wer !== '' ? '<p class="wer">' . $h($wer) . '</p>' : '') . '</div>';
        }
        $block .= count($belege) > 8 ? '</details>' : '';
        $monateLs = max(1, (int) ($link['lieferscheineMonate'] ?? 13));
        $html .= '<h3 class="monat">Lieferscheine</h3><p class="hinweis ls-hinweis">Je Wechsel ein Lieferschein der letzten ' . $monateLs . ' Monate mit den gewechselten Matten, als PDF.</p>'
            . ($block ?: '<p class="leer">Noch keine Lieferscheine in diesem Zeitraum.</p>');
    }
    $sprung[] = '<a href="#mattenwechsel">Mattenwechsel</a>';
    $teile['links'][] = '<section class="karte" id="mattenwechsel"><h2>Mattenwechsel</h2><p class="unter">Ihre Schmutzfangmatten: wann wir wieder wechseln und was wir gewechselt haben. Stand: ' . $h(zeit_text((int) ($link['stand'] ?? jetzt()))) . ' Uhr.</p>'
        . $html . '</section>';
}
// Rechnungen und offene Posten (nur mit PDF am Server); offene mit Bankverbindung und QR-Code der App
if (!empty($zeige['rechnungen'])) {
    $belege = array_values(array_filter((array) ($link['rechnungen'] ?? []), fn ($r) => isset($link['dateien'][$r['datei'] ?? ''])));
    foreach ($belege as &$r) {
        // Stand am Tag des Aufrufs: nach der Fälligkeit überfällig
        if (in_array($r['status'], ['offen', 'teilbezahlt'], true) && $r['faellig'] !== '' && $r['faellig'] < $heute) {
            $r['status'] = 'ueberfaellig';
        }
    }
    unset($r);
    $istOffen = fn (array $r) => (float) $r['offen'] > 0.004 && in_array($r['status'], ['offen', 'ueberfaellig', 'teilbezahlt'], true);
    $offene = array_values(array_filter($belege, $istOffen));
    $uebrige = array_values(array_filter($belege, fn ($r) => !$istOffen($r)));
    usort($offene, fn ($x, $y) => strcmp($x['faellig'] ?: $x['datum'], $y['faellig'] ?: $y['datum']));
    $beleg = function (array $r) use ($h, $k, $link): string {
        $teil = [$r['datum'] !== '' ? 'vom ' . datum_text($r['datum'], false) : '', $r['art'] === 'rechnung' && $r['faellig'] !== '' ? 'fällig ' . datum_text($r['faellig'], false) : '', $r['bezug'] !== '' ? 'zu ' . $r['bezug'] : '', $r['betreff']];
        $offen = $r['art'] === 'rechnung' && (float) $r['offen'] > 0.004 && abs((float) $r['offen'] - (float) $r['brutto']) > 0.004 ? '<span class="leise">offen ' . $h(betrag_text((float) $r['offen'])) . '</span>' : '';
        return '<a class="pdf" href="kunden.php?k=' . $k . '&amp;datei=' . $h($r['datei']) . '" target="_blank" rel="noopener">' . svg_pdf() . '<span class="was"><b>' . $h($r['titel']) . ' <span class="nr">' . $h($r['nummer']) . '</span></b>'
            . '<span class="leise">' . $h(implode(' · ', array_filter($teil))) . ' · PDF, ' . groesse_text((int) ($link['dateien'][$r['datei']]['groesse'] ?? 0)) . '</span></span>'
            . '<span class="summe"><b>' . $h(betrag_text((float) $r['brutto'])) . '</b>' . $offen . '<span class="pill st-' . $h($r['status']) . '">' . $h(BELEG_STATUS[$r['status']] ?? $r['status']) . '</span></span></a>';
    };
    $html = '';
    foreach ($offene as $r) {
        $z = $r['zahlung'];
        $zahlen = '';
        if ($r['lastschrift']) {
            $zahlen = '<div class="zahlen"><p class="hinweis">Wird per SEPA-Lastschrift von Ihrem Konto eingezogen. Bitte nicht überweisen.</p></div>';
        } elseif ($z) {
            $zahlen = '<div class="zahlen">' . ($r['qr'] !== '' ? '<img class="qr" src="data:image/png;base64,' . $r['qr'] . '" width="148" height="148" alt="QR-Code zum Bezahlen von ' . $h($r['nummer']) . '">' : '')
                . '<div class="was"><dl class="werte"><dt>Empfänger</dt><dd>' . $h($z['empfaenger']) . '</dd><dt>IBAN</dt><dd>' . $h($z['iban']) . '</dd>' . ($z['bic'] !== '' ? '<dt>BIC</dt><dd>' . $h($z['bic']) . '</dd>' : '')
                . '<dt>Betrag</dt><dd><b>' . $h(betrag_text((float) $z['betrag'])) . '</b></dd><dt>Verwendungszweck</dt><dd>' . $h($z['zweck']) . '</dd></dl>'
                . ($r['qr'] !== '' ? '<p class="hinweis">Mit der Banking-App scannen: Empfänger, Betrag und Verwendungszweck sind dann schon ausgefüllt.</p>' : '') . '</div></div>';
        } elseif ($r['faellig'] !== '') {
            $zahlen = '<div class="zahlen"><p class="hinweis">Zahlbar bis ' . $h(datum_text($r['faellig'], false)) . ', Bankverbindung siehe Rechnung.</p></div>';
        }
        $html .= '<div class="beleg">' . $beleg($r) . $zahlen . '</div>';
    }
    if ($uebrige) {
        $html .= ($offene ? '<h3 class="monat">Bezahlt und erledigt</h3>' : '');
        foreach ($uebrige as $i => $r) {
            $html .= ($i === 8 ? '<details class="aelter"><summary>Ältere Rechnungen</summary>' : '') . $beleg($r);
        }
        $html .= count($uebrige) > 8 ? '</details>' : '';
    }
    $summe = array_sum(array_map(fn ($r) => (float) $r['offen'], $offene));
    $ueber = array_sum(array_map(fn ($r) => (float) $r['offen'], array_filter($offene, fn ($r) => $r['status'] === 'ueberfaellig')));
    $stand = $offene
        ? '<p class="offen-summe">Offen: <b>' . $h(betrag_text($summe)) . '</b> (' . count($offene) . (count($offene) === 1 ? ' Rechnung' : ' Rechnungen') . ')' . ($ueber > 0.004 ? ', davon überfällig <b>' . $h(betrag_text($ueber)) . '</b>' : '') . '</p>'
        : ($belege ? '<p class="offen-summe">Keine offenen Rechnungen.</p>' : '');
    $monate = max(1, (int) ($link['rechnungenMonate'] ?? 13));
    $sprung[] = '<a href="#rechnungen">Rechnungen</a>';
    $teile['rechts'][] = '<section class="karte" id="rechnungen"><h2>Rechnungen</h2><p class="unter">Ihre Rechnungen der letzten ' . $monate . ' Monate und alle noch offenen, je als PDF. Stand: ' . $h(zeit_text((int) ($link['stand'] ?? jetzt()))) . ' Uhr.</p>'
        . $stand . ($html ?: '<p class="leer">Keine Rechnungen in diesem Zeitraum.</p>') . '</section>';
}
// Reklamation melden und Stand
if (!empty($zeige['reklamation'])) {
    $gesendet = ($_GET['gesendet'] ?? '') === '1';
    $wert = fn ($k) => $h($eingabe[$k] ?? '');
    $auswahl = $mehrere
        ? '<label for="r-objekt">Objekt</label><select id="r-objekt" name="objekt" required><option value="">Bitte wählen</option>' . implode('', array_map(fn ($o) => '<option value="' . (int) $o['nr'] . '"' . ((int) ($eingabe['objekt'] ?? 0) === (int) $o['nr'] ? ' selected' : '') . '>' . $h($o['name'] . ($o['adresse'] ? ', ' . $o['adresse'] : '')) . '</option>', $objekte)) . '</select>'
        : '<input type="hidden" name="objekt" value="1">';
    $arten = implode('', array_map(fn ($wertArt, $text) => '<option value="' . $h($wertArt) . '"' . (($eingabe['art'] ?? '') === $wertArt ? ' selected' : '') . '>' . $h($text) . '</option>', array_keys(ARTEN), ARTEN));
    $datenschutz = (string) ($e['firma']['datenschutz'] ?? '');
    $form = ($fehler ? '<p class="fehler" role="alert">' . $h($fehler) . '</p>' : '')
        . '<form method="post" action="kunden.php?aktion=melden" enctype="multipart/form-data" data-fotos-verkleinern><input type="hidden" name="k" value="' . $h($code) . '">'
        . $auswahl
        . '<label for="r-art">Worum geht es?</label><select id="r-art" name="art" required>' . $arten . '</select>'
        . '<label for="r-text">Beschreibung</label><textarea id="r-text" name="text" rows="4" maxlength="2000" required placeholder="Was ist Ihnen aufgefallen, und wo genau?">' . $wert('text') . '</textarea>'
        . '<label for="r-datum">Aufgefallen am</label><input type="date" id="r-datum" name="datum" value="' . $h($eingabe['datum'] ?? $heute) . '" min="' . tag_plus($heute, -60) . '" max="' . $heute . '">'
        . '<label for="r-foto">Foto (optional)</label><input type="file" id="r-foto" name="foto" accept="image/jpeg,image/png,image/webp">'
        . '<fieldset><legend>So erreichen wir Sie</legend><label for="r-name">Name</label><input type="text" id="r-name" name="name" maxlength="80" autocomplete="name" required value="' . $wert('name') . '">'
        . '<div class="zwei"><div><label for="r-tel">Telefon</label><input type="tel" id="r-tel" name="telefon" maxlength="40" autocomplete="tel" value="' . $wert('telefon') . '"></div>'
        . '<div><label for="r-mail">E-Mail</label><input type="email" id="r-mail" name="email" maxlength="120" autocomplete="email" value="' . $wert('email') . '"></div></div>'
        . '<label class="haken"><input type="checkbox" name="info" value="1"' . (!empty($eingabe['info']) ? ' checked' : '') . '> Bitte informieren Sie mich per E-Mail, wenn sich der Stand ändert.</label></fieldset>'
        . '<button type="submit">Meldung senden</button>'
        . '<p class="hinweis">Telefon oder E-Mail genügt. Bitte fotografieren Sie keine Personen. Ihre Angaben verwenden wir nur, um diese Meldung zu bearbeiten und Sie dazu zu kontaktieren.' . ($datenschutz !== '' && preg_match('#^https://#', $datenschutz) ? ' <a href="' . $h($datenschutz) . '" target="_blank" rel="noopener">Datenschutzerklärung</a>' : '') . '</p></form>';
    $sprung[] = '<a href="#reklamation">Reklamation melden</a>';
    // eigene Meldungen zuerst (wer wiederkommt, will den Stand sehen), dann das Formular
    $zeilen = '';
    foreach ($meine as $m) {
        $st = (string) ($m['status'] ?? 'eingegangen');
        $zeilen .= '<li class="meldung"><div class="zeile"><b>' . $h(ARTEN[$m['art']] ?? $m['art']) . '</b><span class="pill st-' . $h($st) . '">' . $h(STATUS[$st] ?? $st) . '</span></div>'
            . '<span class="leise">gemeldet am ' . $h(datum_text(date('Y-m-d', (int) $m['erstellt']), false)) . ($mehrere ? ' · ' . $h($m['objekt'] ?? '') : '') . (($m['kontakt']['name'] ?? '') !== '' ? ' von ' . $h($m['kontakt']['name']) : '') . '</span>'
            . '<p class="meldung-text">' . $h($m['text']) . '</p>'
            . ($st === 'erledigt' && ($m['antwort'] ?? '') !== '' ? '<div class="antwort"><b>Unsere Rückmeldung</b>' . nl2br($h($m['antwort'])) . '</div>' : '') . '</li>';
    }
    if ($zeilen) {
        $teile['rechts'][] = '<section class="karte" id="meldungen"><h2>Ihre Meldungen</h2><p class="unter">Stand: eingegangen, in Arbeit oder erledigt.</p>'
            . ($gesendet ? '<p class="ok" role="status">Danke! Ihre Meldung ist bei uns eingegangen. Wir kümmern uns darum.</p>' : '') . '<ul class="liste">' . $zeilen . '</ul></section>';
    }
    $teile['rechts'][] = '<section class="karte" id="reklamation"><h2>' . ($zeilen ? 'Neue Reklamation melden' : 'Reklamation melden') . '</h2><p class="unter">Ist etwas nicht in Ordnung? Schreiben Sie uns, wir kümmern uns darum.</p>' . $form . '</section>';
}

// Umfrage (oben, über den Spalten): Formular, solange die Runde offen ist und der Link nicht geantwortet hat
$umfrageHtml = '';
if ($umfrage || $uStatus === 410) {
    $bisText = $umfrage ? datum_text((string) $umfrage['bis'], false) : '';
    $fertig = $umfrage && !$uFehler && beantwortet($id, (string) $umfrage['id']);
    if ($uStatus === 409 || $uStatus === 410) {
        $umfrageHtml = '<section class="karte umfrage" id="umfrage"><h2>Umfrage</h2><p class="fehler" role="alert">' . $h($uFehler) . '</p></section>';
    } elseif ($fertig) {
        $danke = (string) ($_GET['danke'] ?? '');
        $umfrageHtml = '<section class="karte umfrage" id="umfrage"><h2>Danke für Ihre Meinung!</h2>'
            . ($danke !== '' ? '<p class="ok" role="status">Ihre Antwort ist bei uns eingegangen.' . ($danke === '2' ? ' Wir rufen Sie in den nächsten Tagen zurück.' : '') . '</p>' : '')
            . '<p class="leer">Ihre Antwort zu dieser Umfrage haben wir. Die nächste Umfrage kommt in einigen Monaten.</p></section>';
    } else {
        $f = (array) ($umfrage['fragen'] ?? []);
        $sterne = function (string $name, string $frage, string $basis, ?int $wahl, bool $pflicht) use ($h): string {
            $chips = '';
            for ($i = 1; $i <= 5; $i++) {
                $chips .= '<input type="radio" class="wahl" id="' . $basis . '-' . $i . '" name="' . $h($name) . '" value="' . $i . '"' . ($wahl === $i ? ' checked' : '') . ($pflicht ? ' required' : '') . '>'
                    . '<label for="' . $basis . '-' . $i . '">' . svg_stern() . '<span>' . $i . '</span><span class="sr"> von 5 Sternen</span></label>';
            }
            $keine = $pflicht ? '' : '<div class="keine-angabe"><input type="radio" class="wahl" id="' . $basis . '-x" name="' . $h($name) . '" value=""><label for="' . $basis . '-x">keine Angabe</label></div>';
            return '<fieldset class="frage"><legend>' . $h($frage) . ($pflicht ? '' : ' <span class="frei">(optional)</span>') . '</legend><div class="sterne">' . $chips . '</div>' . $keine
                . '<p class="skala" aria-hidden="true"><span>1 = sehr unzufrieden</span><span>5 = sehr zufrieden</span></p></fieldset>';
        };
        $einzeln = '';
        foreach ((array) ($f['einzeln'] ?? []) as $i => $q) {
            $einzeln .= $sterne('wert[' . $q['id'] . ']', (string) $q['text'], 'u-w' . $i, $uEingabe['werte'][$q['id']] ?? null, false);
        }
        $nps = '';
        for ($i = 0; $i <= 10; $i++) {
            $nps .= '<input type="radio" class="wahl" id="u-nps-' . $i . '" name="nps" value="' . $i . '"' . (($uEingabe['nps'] ?? null) === $i ? ' checked' : '') . '><label for="u-nps-' . $i . '">' . $i . '</label>';
        }
        $objektWahl = count($objekte) > 1
            ? '<label for="u-objekt">Zu welchem Objekt? (optional)</label><select id="u-objekt" name="objekt"><option value="0">alle Objekte</option>' . implode('', array_map(fn ($o) => '<option value="' . (int) $o['nr'] . '"' . ((int) ($uEingabe['objekt'] ?? 0) === (int) $o['nr'] ? ' selected' : '') . '>' . $h($o['name']) . '</option>', $objekte)) . '</select>'
            : '';
        $datenschutz = (string) ($e['firma']['datenschutz'] ?? '');
        $umfrageHtml = '<section class="karte umfrage" id="umfrage"><h2>Wie zufrieden sind Sie mit uns?</h2><p class="unter">Kurze Umfrage, etwa zwei Minuten. Offen bis ' . $h($bisText) . '.</p>'
            . ($uFehler ? '<p class="fehler" role="alert">' . $h($uFehler) . '</p>' : '')
            . '<form method="post" action="kunden.php?aktion=bewerten"><input type="hidden" name="k" value="' . $h($code) . '"><input type="hidden" name="runde" value="' . $h($umfrage['id']) . '">'
            . $objektWahl
            . $sterne('gesamt', (string) ($f['gesamt'] ?? UMFRAGE_VORGABE['gesamt']), 'u-gesamt', $uEingabe['gesamt'] ?? null, true)
            . $einzeln
            . '<fieldset class="frage"><legend>' . $h((string) ($f['nps'] ?? UMFRAGE_VORGABE['nps'])) . ' <span class="frei">(optional)</span></legend><div class="nps">' . $nps . '</div>'
            . '<div class="keine-angabe"><input type="radio" class="wahl" id="u-nps-x" name="nps" value=""><label for="u-nps-x">keine Angabe</label></div>'
            . '<p class="skala" aria-hidden="true"><span>0 = gar nicht</span><span>10 = sehr wahrscheinlich</span></p></fieldset>'
            . '<label for="u-text">' . $h((string) ($f['freitext'] ?? UMFRAGE_VORGABE['freitext'])) . ' <span class="frei">(optional)</span></label><textarea id="u-text" name="text" rows="4" maxlength="2000">' . $h($uEingabe['text'] ?? '') . '</textarea>'
            . '<fieldset><legend>Rückruf</legend><label class="haken"><input type="checkbox" name="rueckruf" value="1"' . (!empty($uEingabe['rueckruf']) ? ' checked' : '') . '> Bitte rufen Sie mich zurück.</label>'
            . '<label for="u-tel">Telefon (für den Rückruf)</label><input type="tel" id="u-tel" name="telefon" maxlength="40" autocomplete="tel" value="' . $h($uEingabe['telefon'] ?? '') . '"></fieldset>'
            . '<div class="zwei"><div><label for="u-name">Ihr Name (optional)</label><input type="text" id="u-name" name="name" maxlength="80" autocomplete="name" value="' . $h($uEingabe['name'] ?? '') . '"></div>'
            . '<div><label for="u-funktion">Funktion (optional)</label><input type="text" id="u-funktion" name="funktion" maxlength="80" autocomplete="organization-title" placeholder="z. B. Hausverwaltung" value="' . $h($uEingabe['funktion'] ?? '') . '"></div></div>'
            . '<button type="submit">Antwort senden</button>'
            . '<p class="hinweis">Die Teilnahme ist freiwillig. Wir verwenden Ihre Antworten nur, um unsere Arbeit in Ihrem Objekt zu verbessern: keine Werbung, kein Tracking. Name, Funktion und Telefon sind freiwillig; die Telefonnummer verwenden wir nur für den Rückruf.' . ($datenschutz !== '' && preg_match('#^https://#', $datenschutz) ? ' <a href="' . $h($datenschutz) . '" target="_blank" rel="noopener">Datenschutzerklärung</a>' : '') . '</p></form></section>';
    }
    array_unshift($sprung, '<a href="#umfrage">Umfrage</a>');
}

$kontakt = array_filter([
    !empty($e['firma']['telefon']) ? 'Telefon <a href="tel:' . $h(preg_replace('/[^0-9+]/', '', (string) $e['firma']['telefon'])) . '">' . $h($e['firma']['telefon']) . '</a>' : '',
    !empty($e['firma']['email']) ? 'E-Mail <a href="mailto:' . $h($e['firma']['email']) . '">' . $h($e['firma']['email']) . '</a>' : '',
]);
$objekteHtml = '<ul class="objekte">' . implode('', array_map(fn ($o) => '<li><b>' . $h($o['name']) . '</b>' . ($o['adresse'] ? '<span>' . $h($o['adresse']) . '</span>' : '') . '</li>', $objekte)) . '</ul>';
$spalten = isset($teile['links'], $teile['rechts'])
    ? '<div class="spalten"><div class="spalte">' . implode('', $teile['links']) . '</div><div class="spalte">' . implode('', $teile['rechts']) . '</div></div>'
    : '<div class="spalte">' . implode('', array_merge($teile['links'] ?? [], $teile['rechts'] ?? [])) . '</div>';
seite('<main class="seite"><div class="hallo"><h1>' . $h($link['titel'] ?: 'Ihr Kundenbereich') . '</h1><p>Willkommen in Ihrem Kundenbereich' . ($firma !== '' ? ' bei ' . $h($firma) : '') . '.</p>' . $objekteHtml . '</div>'
    . (count($sprung) > 1 ? '<nav class="sprung" aria-label="Bereiche">' . implode('', $sprung) . '</nav>' : '')
    . $umfrageHtml . $spalten . '</main>'
    . '<footer class="fuss">' . ($kontakt ? '<p>Fragen? ' . implode(' · ', $kontakt) . '</p>' : '')
    . '<p>Diese Seite ist persönlich für Sie: Bitte geben Sie den Link nur an Personen weiter, die ihn brauchen. Tipp: als Lesezeichen speichern.</p></footer>', $fehler ? 400 : $uStatus, 'Kundenbereich', $firma);
