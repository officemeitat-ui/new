import "server-only";
import { workspace } from "@/config/workspace";
import { listAssessments, listLearners } from "@/lib/awareness/store";
import { SELF_ASSESSMENT } from "@/lib/awareness/content";
import { localDate } from "@/lib/calendar";
import { type DomainCheck } from "@/lib/checks/domain";
import { isCheckError } from "@/lib/checks/run";
import { db } from "@/lib/db";
import { eolStatus } from "@/lib/lifecycle";
import { serviceMap } from "@/lib/workspace/catalog";
import { checkResults, listRecords } from "@/lib/workspace/records";
import { VaultLockedError } from "@/lib/workspace/vault";

// Umsatz-Radar (aus dem ME-IT Cockpit): findet regelbasiert Verkaufschancen mit €-Wert – nachvollziehbar, ohne KI.
// Grundlage sind die eigenen Daten: Vertrag/Paket, gebuchte Leistungen, Geräte aus Atera und Inventar (Support-Ende,
// Alter, Garantie), Domain-Prüfung, Datensicherung, Selbstbewertung, Schulungsstand und wiederkehrende Ticket-Themen.

export type OpportunityKind = "lifecycle" | "managed" | "vertrag" | "security" | "compliance" | "ki" | "projekt";
export const KIND_LABELS: Record<OpportunityKind, string> = {
  lifecycle: "Lebenszyklus",
  managed: "Managed Service",
  vertrag: "Vertrag",
  security: "Sicherheit",
  compliance: "NIS2/Compliance",
  ki: "KI",
  projekt: "Projekt",
};

export type Opportunity = {
  customerId: string;
  customer: string;
  kind: OpportunityKind;
  title: string;
  reason: string;
  code: string;
  service: string;
  once: number;
  monthly: number;
  annual: number;
  priority: 1 | 2 | 3;
};

export type RadarResult = {
  opportunities: Opportunity[];
  totalOnce: number;
  totalMonthly: number;
  totalAnnual: number;
  /** Inventar aus der Doku war gesperrt und wurde nicht berücksichtigt */
  inventoryLocked: boolean;
};

const SENSITIVE = /steuer|gesundheit|arzt|ordination|recht|anwalt|notar|kanzlei|versicherung|bank/i;
const NIS2_SECTORS =
  /energie|verkehr|transport|logistik|bank|finanz|gesundheit|krankenhaus|labor|wasser|abwasser|digital|rechenzentrum|cloud|it-dienst|verwaltung|post|kurier|abfall|chemie|lebensmittel|maschinenbau|elektro|fahrzeug|medizinprodukt|forschung|industrie/i;
const CONTACT_HEAVY =
  /tourismus|hotel|gastro|handwerk|steuer|gesundheit|ordination|kanzlei|handel|immobilien|logistik|spedition|versicherung|dienstleistung/i;
const CLIENT_TYPES = /^(pc|notebook|laptop|workstation|client)$/i;
const NETWORK_TYPES = /^(access point|switch|firewall|router)$/i;
const TICKET_TOPICS: { label: string; pattern: RegExp; code: string }[] = [
  { label: "Netzwerk", pattern: /wlan|wifi|netzwerk|vpn|internet|switch|langsam|verbindung/i, code: "NET" },
  { label: "Hardware", pattern: /drucker|pc startet|laptop|notebook|bildschirm|monitor|festplatte|hardware|akku/i, code: "NEWPC" },
  { label: "Sicherheit", pattern: /phishing|virus|spam|gehackt|verdächtig|trojaner|passwort.*gestohlen/i, code: "AWR" },
  { label: "E-Mail/M365", pattern: /outlook|e-?mail|teams|onedrive|sharepoint|m365|office|postfach/i, code: "M365MIG" },
];

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const fmt = (iso: string) => new Intl.DateTimeFormat("de-AT", { dateStyle: "medium" }).format(new Date(`${iso}T12:00:00Z`));

type Asset = { name: string; type: string; os: string | null; bought: string | null; warranty: string | null };

export async function scanRadar(customerId?: string, now = new Date()): Promise<RadarResult> {
  const today = localDate(now, workspace.timeZone);
  const services = await serviceMap();
  const price = (code: string) => services.get(code)?.price ?? 0;
  const name = (code: string) => services.get(code)?.name ?? code;
  const client = await db();
  const customers = (
    await client.execute({
      sql: `SELECT id, name, industry, employees, package, contract_end, notes FROM customers${customerId ? " WHERE id = ?" : ""} ORDER BY name`,
      args: customerId ? [customerId] : [],
    })
  ).rows;
  const booked = new Map<string, Set<string>>();
  for (const r of (await client.execute("SELECT customer_id, code FROM customer_services")).rows) {
    const set = booked.get(String(r.customer_id)) ?? new Set<string>();
    set.add(String(r.code));
    booked.set(String(r.customer_id), set);
  }
  const ateraDevices = (await client.execute("SELECT customer_id, name, os FROM devices")).rows;
  const backups = new Set(
    (await client.execute("SELECT DISTINCT customer_id FROM records WHERE kind = 'backup'")).rows.map((r) => String(r.customer_id)),
  );
  const since = new Date(now.getTime() - 180 * 86_400_000).toISOString();
  const tickets = (await client.execute({ sql: "SELECT customer_id, title FROM tickets WHERE created_at >= ?", args: [since] })).rows;
  const checks = await checkResults();

  const opportunities: Opportunity[] = [];
  let inventoryLocked = false;

  for (const c of customers) {
    const id = String(c.id);
    const customer = String(c.name);
    const employees = Number(c.employees ?? 0);
    const pkg = String(c.package ?? "keins");
    const industry = `${c.industry ?? ""} ${c.notes ?? ""}`;
    const has = booked.get(id) ?? new Set<string>();
    const add = (kind: OpportunityKind, title: string, reason: string, code: string, once = 0, monthly = 0, priority: 1 | 2 | 3 = 2) => {
      if (!services.get(code)?.active) return;
      opportunities.push({
        customerId: id,
        customer,
        kind,
        title,
        reason,
        code,
        service: name(code),
        once: Math.round(once * 100) / 100,
        monthly: Math.round(monthly * 100) / 100,
        annual: Math.round((once + 12 * monthly) * 100) / 100,
        priority,
      });
    };

    // ── Geräte: Support-Ende, Alter, Garantie ──
    const assets: Asset[] = ateraDevices
      .filter((d) => d.customer_id === id)
      .map((d) => ({
        name: String(d.name),
        type: /server/i.test(String(d.os ?? "")) ? "server" : "pc",
        os: (d.os as string | null) ?? null,
        bought: null,
        warranty: null,
      }));
    try {
      for (const r of await listRecords(id, "geraet")) {
        if (r.data.status === "ausgemustert") continue;
        const existing = assets.find((a) => a.name.toLowerCase() === r.title.toLowerCase());
        const asset: Asset = {
          name: r.title,
          type: (r.data.art ?? "").toLowerCase(),
          os: r.data.betriebssystem || existing?.os || null,
          bought: r.data.gekauft || null,
          warranty: r.data.garantie || null,
        };
        if (existing) Object.assign(existing, { ...asset, type: asset.type || existing.type });
        else assets.push(asset);
      }
    } catch (error) {
      if (!(error instanceof VaultLockedError)) throw error;
      inventoryLocked = true;
    }
    const eolGroups = new Map<string, { names: string[]; server: boolean; end: string; state: string }>();
    const oldClients: string[] = [];
    const oldNetwork: string[] = [];
    for (const a of assets) {
      const eol = eolStatus(a.os, today);
      if (eol && eol.state !== "ok") {
        const key = `${eol.label}|${eol.state}`;
        const group = eolGroups.get(key) ?? { names: [], server: eol.server || a.type === "server", end: eol.end, state: eol.state };
        group.names.push(a.name);
        eolGroups.set(key, group);
        continue;
      }
      const ageYears = a.bought ? (now.getTime() - new Date(a.bought).getTime()) / (365 * 86_400_000) : 0;
      const warrantyOut = a.warranty !== null && a.warranty <= addDays(today, 90);
      if (CLIENT_TYPES.test(a.type) && ageYears >= 5 && warrantyOut) oldClients.push(a.name);
      else if (NETWORK_TYPES.test(a.type) && ageYears >= 6) oldNetwork.push(a.name);
    }
    for (const [key, group] of eolGroups) {
      const label = key.split("|")[0];
      const list = group.names.join(", ");
      if (group.state === "abgelaufen") {
        if (group.server)
          add(
            "lifecycle",
            `${label} ablösen (${group.names.length}×)`,
            `${label} erhält keine Sicherheitsupdates mehr: ${list}. Hohes Risiko, Versicherung/NIS2 kritisch.`,
            "SRVMOD",
            price("SRVMOD"),
            0,
            3,
          );
        else
          add(
            "lifecycle",
            `${label}-Migration (${group.names.length} ${group.names.length === 1 ? "Gerät" : "Geräte"})`,
            `${label} ohne regulären Support seit ${fmt(group.end)} (ESU nur gegen Aufpreis): ${list}.`,
            "WIN11",
            price("WIN11") * group.names.length,
            0,
            3,
          );
      } else {
        const urgent = group.end <= addDays(today, 120);
        add(
          "lifecycle",
          `${label}-Ablöse planen (${group.names.length}×)`,
          `Support-Ende am ${fmt(group.end)}: ${list}. ${urgent ? "Jetzt umsetzen – die Zeit wird knapp." : "Jetzt budgetieren."}`,
          group.server ? "SRVMOD" : "WIN11",
          group.server ? price("SRVMOD") : price("WIN11") * group.names.length,
          0,
          urgent ? 3 : 2,
        );
      }
    }
    if (oldClients.length)
      add(
        "lifecycle",
        `Hardware-Erneuerung (${oldClients.length} Geräte)`,
        `Geräte ≥ 5 Jahre alt und ohne Garantie: ${oldClients.join(", ")}.`,
        "NEWPC",
        price("NEWPC") * oldClients.length,
      );
    if (oldNetwork.length)
      add("lifecycle", "Netzwerk/WLAN modernisieren", `Netzwerkkomponenten ≥ 6 Jahre alt: ${oldNetwork.join(", ")}.`, "NET", price("NET"));

    // ── Vertrag & Paket ──
    if (pkg === "keins" && employees >= 5) {
      add(
        "managed",
        "Auf Managed-Services-Vertrag umstellen",
        `Bisher Abrechnung auf Zuruf. ${employees} Benutzer × Flatrate = planbarer Umsatz für beide Seiten.`,
        "MW",
        0,
        price("MW") * employees,
        3,
      );
    }
    const end = c.contract_end ? String(c.contract_end) : null;
    if (end && end >= today && end <= addDays(today, 60)) {
      add(
        "vertrag",
        "Vertragsverlängerung + Paket-Upgrade",
        `Vertrag endet am ${fmt(end)}. Jahresgespräch mit Bericht und Upgrade-Angebot.`,
        "MW",
        0,
        0,
        3,
      );
    }

    // ── Sicherheit ──
    const assessment = (await listAssessments(id))[0];
    const secScore = assessment ? Math.round((assessment.score / SELF_ASSESSMENT.max) * 100) : null;
    if (employees > 0 && !has.has("SEC")) {
      add(
        "security",
        "Security-Paket (EDR/MDR)",
        `Kein EDR/MDR gebucht.${secScore !== null ? ` Selbstbewertung nur ${secScore} %.` : ""}`,
        "SEC",
        0,
        price("SEC") * employees,
        secScore !== null && secScore < 60 ? 3 : 2,
      );
    }
    if (employees > 0 && !has.has("BCK")) {
      add(
        "security",
        "Backup & Recovery einführen",
        backups.has(id)
          ? "Sicherung vorhanden, aber nicht als verwaltete, unveränderbare Sicherung mit Restore-Test gebucht."
          : "Keine Datensicherung dokumentiert – größtes Ransomware-Risiko.",
        "BCK",
        0,
        price("BCK"),
        backups.has(id) ? 2 : 3,
      );
    }
    const learners = (await listLearners(id, now)).filter((l) => !l.disabled).length;
    if (employees >= 10 && !has.has("AWR") && learners === 0) {
      add(
        "security",
        "Security-Awareness-Training",
        "Die meisten Angriffe starten mit Phishing. Laufende Schulung mit Nachweis (AI Act Art. 4) senkt das Risiko deutlich.",
        "AWR",
        0,
        price("AWR") * employees,
        1,
      );
    }
    const domainChecks = checks
      .filter((r) => r.customerId === id)
      .map((r) => (r.result && !isCheckError(r.result) ? (r.result as DomainCheck) : null))
      .filter((r): r is DomainCheck => Boolean(r));
    const weak = domainChecks.filter((d) => ["C", "D", "F"].includes(d.grade));
    if (weak.length && !has.has("MAILSEC")) {
      add(
        "security",
        "E-Mail-Absicherung (SPF/DKIM/DMARC)",
        `Domain-Prüfung: ${weak.map((d) => `${d.domain} Note ${d.grade}`).join(", ")} – Absender können gefälscht werden.`,
        "MAILSEC",
        price("MAILSEC") * weak.length,
        0,
        weak.some((d) => d.grade === "F" || d.grade === "D") ? 3 : 2,
      );
    }

    // ── NIS2 / NISG 2026 ──
    const recentCheck = assessment && assessment.createdAt >= addDays(today, -365) && (secScore ?? 0) >= 80;
    if (employees >= 50 && !has.has("VCISO") && !recentCheck) {
      add(
        "compliance",
        "NIS2/NISG-2026: Betroffenheit & Gap-Analyse",
        `${employees} Mitarbeiter${NIS2_SECTORS.test(industry) ? " in einem NIS2-Sektor" : ""} – mögliche Registrierungs- und Nachweispflicht (NISG 2026). Geschäftsführung haftet persönlich.`,
        "NIS2GAP",
        price("NIS2GAP"),
        price("VCISO"),
        3,
      );
    } else if (employees >= 20 && employees < 50 && !has.has("VCISO")) {
      add(
        "compliance",
        "NIS2-Lieferketten-Check",
        "NIS2-pflichtige Auftraggeber verlangen zunehmend Sicherheitsnachweise von Zulieferern.",
        "NIS2GAP",
        price("NIS2GAP"),
        0,
        1,
      );
    }

    // ── KI ──
    const sensitive = SENSITIVE.test(industry);
    if (employees >= 5 && !has.has("KIWS")) {
      add(
        "ki",
        "KI-Workshop & AI-Act-Kompetenzschulung",
        "Seit Feb. 2025 müssen Unternehmen, die KI einsetzen, für KI-Kompetenz ihrer Mitarbeiter sorgen (Art. 4 AI Act).",
        "KIWS",
        price("KIWS"),
        0,
        sensitive ? 2 : 1,
      );
    }
    if ((sensitive || /\bki\b/i.test(industry)) && !has.has("KIBOX")) {
      add(
        "ki",
        "Private KI-Box (lokal, DSGVO-konform)",
        "Sensible Daten – KI-Nutzung nur ohne Cloud sinnvoll. Lokaler KI-Server mit Dokumentensuche.",
        "KIBOX",
        price("KIBOX"),
        price("KIBOXM"),
        2,
      );
    }
    if (employees >= 5 && !has.has("KIMA")) {
      const heavy = CONTACT_HEAVY.test(industry);
      add(
        "ki",
        "KI-Mitarbeiter für Routinearbeit",
        `Posteingang sortieren, Anfragen ins CRM, Antwortentwürfe, Belege für den Steuerberater, Angebote nachfassen.${heavy ? " Viel Kundenkontakt in der Branche – hoher Nutzen." : ""}`,
        "KIMA",
        price("KIMA"),
        price("KIMAM"),
        heavy ? 2 : 1,
      );
    }

    // ── Wiederkehrende Ticket-Themen ──
    const own = tickets.filter((t) => t.customer_id === id).map((t) => String(t.title));
    for (const topic of TICKET_TOPICS) {
      const count = own.filter((title) => topic.pattern.test(title)).length;
      if (count >= 3) {
        add(
          "projekt",
          `Wiederkehrende ${topic.label}-Probleme lösen`,
          `${count} Tickets zum Thema ${topic.label} in 6 Monaten – Ursache beheben statt Symptome.`,
          topic.code,
          price(topic.code) * (topic.code === "NET" ? 1 : Math.max(1, Math.min(employees, 10))),
        );
      }
    }
  }

  opportunities.sort((a, b) => b.priority - a.priority || b.annual - a.annual);
  const sum = (key: "once" | "monthly" | "annual") => Math.round(opportunities.reduce((s, o) => s + o[key], 0) * 100) / 100;
  return { opportunities, totalOnce: sum("once"), totalMonthly: sum("monthly"), totalAnnual: sum("annual"), inventoryLocked };
}
