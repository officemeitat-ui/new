import { promises as dns } from "node:dns";
import tls from "node:tls";

// Automatische Domain-Prüfung: Mailserver (MX), SPF, DMARC, DKIM und das Zertifikat der Website.
// Nur öffentliche Informationen (DNS, TLS-Handshake) – nichts wird verändert, kein Login nötig.

export type CheckLevel = "fehler" | "warnung" | "info";
export type DomainFinding = { level: CheckLevel; text: string; hint?: string };
export type CertInfo = { host: string; validTo: string; daysLeft: number; issuer: string | null; trusted: boolean };

export type DomainCheck = {
  domain: string;
  checkedAt: string;
  mx: { hosts: string[]; provider: string | null };
  spf: string | null;
  dmarc: string | null;
  dmarcPolicy: string | null;
  dkim: string[];
  tls: CertInfo | null;
  tlsError: string | null;
  findings: DomainFinding[];
  grade: "A" | "B" | "C" | "D" | "F";
  /** Letzte Wiederholung fehlgeschlagen – das Ergebnis stammt von der vorherigen Prüfung. */
  refreshError?: string;
};

export type CheckDeps = {
  resolveMx(name: string): Promise<{ exchange: string; priority: number }[]>;
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
  certificate(host: string): Promise<{ validTo: string; issuer: string | null; trusted: boolean }>;
  /** Liefert der DNS-Server überhaupt MX/TXT? (Manche Umgebungen beantworten nur A-Einträge – dann wären alle Befunde falsch.) */
  verifyResolver?(): Promise<boolean>;
};

let resolverOk: { ok: boolean; until: number } | undefined;

const DKIM_SELECTORS = ["selector1", "selector2", "google", "default", "dkim", "k1", "s1", "s2", "mail"];

function realDeps(): CheckDeps {
  const resolver = new dns.Resolver({ timeout: 4000, tries: 2 });
  if (process.env.CHECK_DNS_SERVERS) resolver.setServers(process.env.CHECK_DNS_SERVERS.split(",").map((s) => s.trim()));
  return {
    resolveMx: (name) => resolver.resolveMx(name),
    resolveTxt: (name) => resolver.resolveTxt(name),
    resolveCname: (name) => resolver.resolveCname(name),
    verifyResolver: async () => {
      if (resolverOk && resolverOk.until > Date.now()) return resolverOk.ok;
      const ok = await resolver
        .resolveMx("gmail.com")
        .then((records) => records.length > 0)
        .catch(() => false);
      resolverOk = { ok, until: Date.now() + 10 * 60_000 };
      return ok;
    },
    certificate: (host) =>
      new Promise((resolve, reject) => {
        const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 8000 }, () => {
          const cert = socket.getPeerCertificate();
          socket.end();
          if (!cert?.valid_to) return reject(new Error("kein Zertifikat"));
          const issuer = cert.issuer as Record<string, string> | undefined;
          resolve({ validTo: new Date(cert.valid_to).toISOString(), issuer: issuer?.O ?? issuer?.CN ?? null, trusted: socket.authorized });
        });
        socket.on("timeout", () => {
          socket.destroy();
          reject(new Error("Zeitüberschreitung"));
        });
        socket.on("error", reject);
      }),
  };
}

/** Kein Eintrag (NXDOMAIN/NODATA) ist ein Ergebnis, kein Fehler. */
async function maybe<T>(task: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ENOTIMP" || code === "EREFUSED") return fallback;
    throw error;
  }
}

function mailProvider(hosts: string[]): string | null {
  const all = hosts.join(" ");
  if (/mail\.protection\.outlook\.com/.test(all)) return "Microsoft 365";
  if (/google\.com|googlemail\.com/.test(all)) return "Google Workspace";
  if (/world4you/.test(all)) return "World4You";
  if (/easyname/.test(all)) return "easyname";
  if (/mimecast|hornetsecurity|hornet|antispameurope|retarus/.test(all)) return "Mail-Gateway";
  return hosts.length ? "eigener bzw. anderer Server" : null;
}

export async function checkDomain(domain: string, deps: CheckDeps = realDeps(), now = new Date()): Promise<DomainCheck> {
  const findings: DomainFinding[] = [];
  const add = (level: CheckLevel, text: string, hint?: string) => findings.push({ level, text, hint });

  if (deps.verifyResolver && !(await deps.verifyResolver())) {
    throw new Error(
      "Der DNS-Server liefert keine MX/TXT-Einträge (Gegenprobe mit gmail.com fehlgeschlagen) – CHECK_DNS_SERVERS setzen, z. B. 1.1.1.1",
    );
  }
  let mxRecords: { exchange: string; priority: number }[];
  try {
    mxRecords = await maybe(() => deps.resolveMx(domain), []);
  } catch (error) {
    throw new Error(`DNS nicht erreichbar (${(error as { code?: string }).code ?? (error as Error).message})`);
  }
  const hosts = mxRecords.sort((a, b) => a.priority - b.priority).map((m) => m.exchange.toLowerCase());
  const provider = mailProvider(hosts);

  const txt = (await maybe(() => deps.resolveTxt(domain), [])).map((parts) => parts.join(""));
  const spfRecords = txt.filter((t) => /^v=spf1\b/i.test(t));
  const dmarcRecords = (await maybe(() => deps.resolveTxt(`_dmarc.${domain}`), []))
    .map((parts) => parts.join(""))
    .filter((t) => /^v=DMARC1/i.test(t));
  const dkim: string[] = [];
  for (const selector of DKIM_SELECTORS) {
    const name = `${selector}._domainkey.${domain}`;
    const cname = await maybe(() => deps.resolveCname(name), []);
    const record = cname.length ? [] : (await maybe(() => deps.resolveTxt(name), [])).map((p) => p.join(""));
    if (cname.length || record.some((r) => /v=DKIM1|p=/i.test(r))) dkim.push(selector);
  }

  // Mail
  const spf = spfRecords[0] ?? null;
  if (!hosts.length) {
    add("info", "Keine Mailserver (MX) – die Domain empfängt keine E-Mails.");
  }
  if (spfRecords.length > 1)
    add("fehler", "Mehrere SPF-Einträge – das ist ungültig, Empfänger werten SPF dann als Fehler.", "Zu einem Eintrag zusammenführen.");
  if (!spf) {
    add(
      "fehler",
      "Kein SPF-Eintrag – jeder kann im Namen dieser Domain E-Mails verschicken.",
      hosts.length
        ? provider === "Microsoft 365"
          ? "TXT: v=spf1 include:spf.protection.outlook.com -all"
          : "SPF für den Mailanbieter anlegen."
        : "Für Domains ohne Mail: TXT v=spf1 -all",
    );
  } else if (/[+]all\b/i.test(spf)) {
    add("fehler", "SPF erlaubt jedem Server das Versenden (+all).", "Auf -all bzw. ~all umstellen.");
  } else if (/\?all\b/i.test(spf)) {
    add("warnung", "SPF ist neutral (?all) – schützt kaum.", "Auf -all bzw. ~all umstellen.");
  } else if (!/[-~]all\b/i.test(spf) && !/redirect=/i.test(spf)) {
    add("warnung", "SPF endet ohne -all bzw. ~all.", "Eintrag mit -all abschließen.");
  }

  const dmarc = dmarcRecords[0] ?? null;
  const policy = dmarc?.match(/\bp=(\w+)/i)?.[1]?.toLowerCase() ?? null;
  if (!dmarc) {
    add(
      "fehler",
      "Kein DMARC – gefälschte Absender dieser Domain werden nicht abgewiesen.",
      "TXT _dmarc: v=DMARC1; p=quarantine; rua=mailto:…",
    );
  } else if (policy === "none") {
    add(
      "warnung",
      "DMARC nur im Beobachtungsmodus (p=none) – Fälschungen kommen weiter an.",
      "Nach Auswertung der Berichte auf p=quarantine, dann p=reject.",
    );
  } else if (policy === "quarantine") {
    add("info", "DMARC p=quarantine – gut. Ziel ist p=reject.");
  }
  if (dmarc && !/\brua=/i.test(dmarc)) add("info", "DMARC ohne Berichtsadresse (rua) – man sieht nicht, wer im Namen der Domain sendet.");

  if (hosts.length && !dkim.length) {
    if (provider === "Microsoft 365") {
      add(
        "warnung",
        "DKIM ist für Microsoft 365 nicht aktiviert (selector1/selector2 fehlen).",
        "Im Defender-Portal DKIM aktivieren und die beiden CNAME-Einträge setzen.",
      );
    } else {
      add("info", "Kein DKIM unter den üblichen Selektoren gefunden (kann einen anderen Namen haben).");
    }
  }

  // Website-Zertifikat
  let cert: CertInfo | null = null;
  let tlsError: string | null = null;
  for (const host of [domain, `www.${domain}`]) {
    try {
      const info = await deps.certificate(host);
      cert = { host, ...info, daysLeft: Math.floor((new Date(info.validTo).getTime() - now.getTime()) / 86_400_000) };
      break;
    } catch (error) {
      tlsError = error instanceof Error ? error.message : String(error);
    }
  }
  if (cert) {
    tlsError = null;
    if (cert.daysLeft < 0) add("fehler", `Das Zertifikat von ${cert.host} ist abgelaufen.`, "Zertifikat sofort erneuern.");
    else if (cert.daysLeft < 14)
      add(
        "fehler",
        `Das Zertifikat von ${cert.host} läuft in ${cert.daysLeft} Tagen ab.`,
        "Erneuerung prüfen (Let's Encrypt automatisch?).",
      );
    else if (cert.daysLeft < 30) add("warnung", `Das Zertifikat von ${cert.host} läuft in ${cert.daysLeft} Tagen ab.`);
    if (!cert.trusted)
      add("warnung", `Das Zertifikat von ${cert.host} ist nicht vertrauenswürdig (selbst signiert oder unvollständige Kette).`);
  } else {
    add("info", `Website nicht per HTTPS erreichbar (${tlsError}).`);
  }

  const errors = findings.filter((f) => f.level === "fehler").length;
  const warnings = findings.filter((f) => f.level === "warnung").length;
  const grade = errors >= 2 ? "F" : errors === 1 ? "D" : warnings >= 2 ? "C" : warnings === 1 ? "B" : "A";
  const order = { fehler: 0, warnung: 1, info: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return {
    domain,
    checkedAt: now.toISOString(),
    mx: { hosts, provider },
    spf,
    dmarc,
    dmarcPolicy: policy,
    dkim,
    tls: cert,
    tlsError,
    findings,
    grade,
  };
}

export const GRADE_STYLE: Record<DomainCheck["grade"], string> = {
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-lime-100 text-lime-800",
  C: "bg-amber-100 text-amber-800",
  D: "bg-orange-100 text-orange-800",
  F: "bg-red-100 text-red-800",
};
