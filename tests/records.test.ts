import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { findLayout, noticeDays } from "@/config/records";
import { checkDomain, type CheckDeps } from "@/lib/checks/domain";

process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "records-")), "test.db")}`;
process.env.SESSION_SECRET = "test-session-geheimnis";

let records: typeof import("@/lib/workspace/records");
let customerId: string;
const now = new Date("2026-11-17T08:00:00Z");

beforeAll(async () => {
  records = await import("@/lib/workspace/records");
  customerId = (await (await import("@/lib/workspace/customers")).createCustomer({ name: "Huber Steuerberatung" })).id;
});

describe("Feldvorlagen", () => {
  it("prüft und bereinigt Eingaben", () => {
    const kontakt = findLayout("kontakt")!;
    expect(() => records.cleanRecordData(kontakt, {})).toThrow("„Name“ ausfüllen");
    expect(() => records.cleanRecordData(kontakt, { name: "Maria", email: "keine-mail" })).toThrow("keine gültige E-Mail");
    expect(() => records.cleanRecordData(kontakt, { name: "Maria", rolle: "Chefin" })).toThrow("ungültige Auswahl");
    expect(records.cleanRecordData(kontakt, { name: " Maria Huber ", email: "Maria@Huber.AT", freigabe: "on", vip: "" })).toEqual({
      name: "Maria Huber",
      email: "maria@huber.at",
      freigabe: "ja",
    });
    const domain = findLayout("domain")!;
    expect(records.cleanRecordData(domain, { domain: "https://www.Huber-STB.at/kontakt" }).domain).toBe("huber-stb.at");
    expect(() => records.cleanRecordData(domain, { domain: "kein domainname" })).toThrow("gültige Domain");
    expect(() => records.cleanRecordData(findLayout("lizenz")!, { produkt: "X", ablauf: "17.11.2026" })).toThrow("JJJJ-MM-TT");
  });

  it("rechnet Fristen: Kündigungstermin, Backup-Test, Garantie", () => {
    expect(noticeDays("3 Monate")).toBe(90);
    expect(noticeDays("6 Wochen")).toBe(42);
    expect(findLayout("vertrag")!.due!.compute({ ende: "2027-03-31", kuendigungsfrist: "3 Monate" })).toBe("2026-12-31");
    expect(findLayout("vertrag")!.due!.compute({ ende: "2027-03-31" })).toBe("2027-03-31");
    expect(findLayout("backup")!.due!.compute({ letzter_test: "2026-05-17" })).toBe("2026-11-17");
    expect(findLayout("geraet")!.due!.compute({ garantie: "2027-01-01", status: "ausgemustert" })).toBeNull();
  });
});

describe("Einträge in der Kundenakte", () => {
  it("speichert verschlüsselt, listet, sucht und zeigt Fristen – auch bei gesperrter Doku ohne Inhalt", async () => {
    const vault = await import("@/lib/workspace/vault");
    const { key } = await vault.setupVault("ein langes Doku-Passwort", async () => 0);
    await vault.runWithDocKey(key, async () => {
      await records.saveRecord(
        { customerId, kind: "lizenz", data: { produkt: "Securepoint UTM", ablauf: "2026-12-01", anzahl: "1" } },
        "Max",
        now,
      );
      await records.saveRecord(
        { customerId, kind: "kontakt", data: { name: "Maria Huber", rolle: "Geschäftsführung", email: "maria@huber.at" } },
        "Max",
        now,
      );
      const domain = await records.saveRecord({ customerId, kind: "domain", data: { domain: "Huber-STB.at" } }, "Max", now);
      expect(domain).toMatchObject({ title: "huber-stb.at", checkTarget: "huber-stb.at" });
      expect((await records.listRecords(customerId, "kontakt"))[0]).toMatchObject({ title: "Maria Huber", updatedBy: "Max" });
      const { searchDocs } = await import("@/lib/workspace/docs");
      expect((await searchDocs("geschäftsführung maria"))[0]).toMatchObject({ kind: "record", title: "Maria Huber" });
      expect((await records.dueRecords("2026-12-31"))[0]).toMatchObject({
        title: "Securepoint UTM",
        dueLabel: "Lizenz läuft ab",
        dueAt: "2026-12-01",
      });
    });
    const { db } = await import("@/lib/db");
    const raw = (await (await db()).execute("SELECT title, data FROM records")).rows;
    expect(raw.every((r) => String(r.title).startsWith("enc1:") && String(r.data).startsWith("enc1:"))).toBe(true);
    // Gesperrt: Frist sichtbar, Bezeichnung nicht
    expect((await records.dueRecords("2026-12-31"))[0]).toMatchObject({
      title: null,
      kindLabel: "Lizenz",
      customerName: "Huber Steuerberatung",
    });
    expect(await records.countRecords(customerId)).toEqual({ lizenz: 1, kontakt: 1, domain: 1 });
    expect(await records.checkTargets()).toEqual([expect.objectContaining({ target: "huber-stb.at" })]);
  });
});

describe("Domain-Prüfung", () => {
  const dns = (
    zone: Record<string, { mx?: string[]; txt?: string[]; cname?: string[] }>,
    cert?: { days: number; trusted?: boolean },
  ): CheckDeps => {
    const missing = () => Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return {
      resolveMx: async (name) =>
        zone[name]?.mx ? zone[name].mx!.map((exchange, i) => ({ exchange, priority: i })) : Promise.reject(missing()),
      resolveTxt: async (name) => (zone[name]?.txt ? zone[name].txt!.map((t) => [t]) : Promise.reject(missing())),
      resolveCname: async (name) => (zone[name]?.cname ? zone[name].cname! : Promise.reject(missing())),
      certificate: async () =>
        cert
          ? {
              validTo: new Date(now.getTime() + cert.days * 86_400_000).toISOString(),
              issuer: "Let's Encrypt",
              trusted: cert.trusted ?? true,
            }
          : Promise.reject(new Error("ECONNREFUSED")),
    };
  };

  it("bewertet eine sauber eingerichtete M365-Domain mit A", async () => {
    const result = await checkDomain(
      "huber-stb.at",
      dns(
        {
          "huber-stb.at": {
            mx: ["huber-stb-at.mail.protection.outlook.com"],
            txt: ["v=spf1 include:spf.protection.outlook.com -all", "MS=ms123"],
          },
          "_dmarc.huber-stb.at": { txt: ["v=DMARC1; p=reject; rua=mailto:dmarc@huber-stb.at"] },
          "selector1._domainkey.huber-stb.at": { cname: ["selector1-huber._domainkey.huberstb.onmicrosoft.com"] },
        },
        { days: 60 },
      ),
      now,
    );
    expect(result).toMatchObject({ grade: "A", dmarcPolicy: "reject", dkim: ["selector1"], mx: { provider: "Microsoft 365" } });
    expect(result.findings).toEqual([]);
    expect(result.tls).toMatchObject({ host: "huber-stb.at", daysLeft: 60 });
  });

  it("findet fehlendes SPF/DMARC, DKIM in M365 und ein bald ablaufendes Zertifikat", async () => {
    const result = await checkDomain(
      "gruber.at",
      dns({ "gruber.at": { mx: ["gruber-at.mail.protection.outlook.com"], txt: ["google-site-verification=x"] } }, { days: 9 }),
      now,
    );
    expect(result.grade).toBe("F");
    expect(result.findings.map((f) => `${f.level}: ${f.text}`)).toEqual([
      "fehler: Kein SPF-Eintrag – jeder kann im Namen dieser Domain E-Mails verschicken.",
      "fehler: Kein DMARC – gefälschte Absender dieser Domain werden nicht abgewiesen.",
      "fehler: Das Zertifikat von gruber.at läuft in 9 Tagen ab.",
      "warnung: DKIM ist für Microsoft 365 nicht aktiviert (selector1/selector2 fehlen).",
    ]);
    expect(result.findings[0].hint).toBe("TXT: v=spf1 include:spf.protection.outlook.com -all");
  });

  it("erkennt schwache Richtlinien und Domains ohne Mail", async () => {
    const weak = await checkDomain(
      "berger.at",
      dns(
        {
          "berger.at": { mx: ["mx.hoster.at"], txt: ["v=spf1 a mx ?all", "v=spf1 -all"] },
          "_dmarc.berger.at": { txt: ["v=DMARC1; p=none"] },
          "default._domainkey.berger.at": { txt: ["v=DKIM1; k=rsa; p=MIIB"] },
        },
        { days: 200, trusted: false },
      ),
      now,
    );
    expect(weak.findings.map((f) => f.text)).toEqual(
      expect.arrayContaining([
        "Mehrere SPF-Einträge – das ist ungültig, Empfänger werten SPF dann als Fehler.",
        "SPF ist neutral (?all) – schützt kaum.",
        "DMARC nur im Beobachtungsmodus (p=none) – Fälschungen kommen weiter an.",
        "Das Zertifikat von berger.at ist nicht vertrauenswürdig (selbst signiert oder unvollständige Kette).",
      ]),
    );
    expect(weak.dkim).toEqual(["default"]);
    const parked = await checkDomain(
      "geparkt.at",
      dns({ "geparkt.at": { txt: ["v=spf1 -all"] }, "_dmarc.geparkt.at": { txt: ["v=DMARC1; p=reject; rua=mailto:x@y.at"] } }),
      now,
    );
    expect(parked.findings.map((f) => f.text)).toEqual([
      "Keine Mailserver (MX) – die Domain empfängt keine E-Mails.",
      "Website nicht per HTTPS erreichbar (ECONNREFUSED).",
    ]);
    expect(parked.grade).toBe("A");
  });

  it("prüft nicht mit einem DNS-Server, der keine MX/TXT liefert (keine falschen Befunde)", async () => {
    await expect(checkDomain("x.at", { ...dns({}), verifyResolver: async () => false }, now)).rejects.toThrow(
      "Gegenprobe mit gmail.com fehlgeschlagen",
    );
  });

  it("meldet ein nicht erreichbares DNS als Fehler der Prüfung", async () => {
    const broken: CheckDeps = {
      ...dns({}),
      resolveMx: async () => Promise.reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })),
    };
    await expect(checkDomain("x.at", broken, now)).rejects.toThrow("DNS nicht erreichbar (ETIMEOUT)");
  });
});

describe("Prüflauf", () => {
  it("behält bei einem Fehler das letzte gültige Ergebnis", async () => {
    const vault = await import("@/lib/workspace/vault");
    const key = (await vault.unlockVault("ein langes Doku-Passwort"))!;
    const domain = (await vault.runWithDocKey(key, () => records.listRecords(customerId, "domain")))[0];
    const good = {
      domain: "huber-stb.at",
      checkedAt: "2026-11-16T05:00:00.000Z",
      grade: "A",
      findings: [],
      mx: { hosts: [], provider: null },
      dkim: [],
    };
    await records.saveCheckResult(domain.id, good, new Date("2026-11-16T05:00:00Z"));
    process.env.CHECK_DNS_SERVERS = "127.0.0.1:9"; // nichts antwortet dort
    const { runDomainChecks } = await import("@/lib/checks/run");
    expect(await runDomainChecks([domain.id])).toEqual({ checked: 0, failed: 1 });
    delete process.env.CHECK_DNS_SERVERS;
    const stored = (await records.checkResults(customerId))[0];
    expect(stored.result).toMatchObject({ grade: "A", refreshError: expect.stringContaining("DNS") });
    expect(stored.checkedAt).toBe("2026-11-16T05:00:00.000Z");
  }, 30_000);
});

describe("Checklisten", () => {
  it("legt aus Vorlagen an, hakt ab und schließt ab", async () => {
    const checklists = await import("@/lib/workspace/checklists");
    const id = await checklists.createChecklist({ customerId, templateId: "pc", subject: "PC-EMPFANG" }, "Max", now);
    let list = (await checklists.getChecklist(id))!;
    expect(list).toMatchObject({ title: "Neuer Arbeitsplatz-PC: PC-EMPFANG", done: 0 });
    expect(list.items[0]).toMatchObject({ section: "Einrichtung", text: "Seriennummer und Garantie im Inventar erfasst" });
    for (const item of list.items) await checklists.toggleChecklistItem(id, item.idx, "Lisa", now);
    list = (await checklists.getChecklist(id))!;
    expect(list).toMatchObject({ done: list.total, doneAt: now.toISOString() });
    await checklists.toggleChecklistItem(id, 0, "Lisa", now);
    expect((await checklists.getChecklist(id))!.doneAt).toBeNull();
    expect((await checklists.listChecklists({ customerId, open: true })).map((c) => c.id)).toEqual([id]);
    await expect(checklists.createChecklist({ customerId, templateId: "gibts-nicht" }, null, now)).rejects.toThrow("Unbekannte Vorlage");
  });
});

describe("Demo-Daten, Fristen, Gesundheit", () => {
  it("füllt eine Demo-Welt und räumt sie vollständig wieder weg", async () => {
    const demo = await import("@/lib/demo");
    const vault = await import("@/lib/workspace/vault");
    const { key } = await vault.unlockVault("ein langes Doku-Passwort").then((k) => ({ key: k! }));
    await vault.runWithDocKey(key, () => demo.seedDemo("Max", now));
    expect(await demo.demoLoaded()).toBe(true);

    const { allDeadlines } = await import("@/lib/workspace/deadlines");
    const deadlines = await vault.runWithDocKey(key, () => allDeadlines(30, now));
    const labels = deadlines.map((d) => `${d.label}: ${d.title} (${d.customerName})`);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Garantie endet: NB-LEITNER (Huber Steuerberatung (Demo))",
        "Lizenz läuft ab: Kassensoftware Gastro Pro (Bäckerei Gruber (Demo))",
        "Kündigen bis: Internet Magenta Business 300/50 (Huber Steuerberatung (Demo))",
        "Zertifikat läuft ab: baeckerei-gruber.example (Bäckerei Gruber (Demo))",
        "Schulung auffrischen: 1 Person (Huber Steuerberatung (Demo))",
      ]),
    );

    const { healthForCustomers } = await import("@/lib/workspace/health");
    const health = await healthForCustomers(["demo-huber", "demo-gruber", "demo-berger"], now);
    expect(health.get("demo-huber")!.score).toBeGreaterThan(health.get("demo-gruber")!.score);
    expect(health.get("demo-gruber")!.factors.find((f) => f.label === "E-Mail-Sicherheit")).toMatchObject({
      points: 0,
      note: "schlechteste Domain: F",
    });
    expect(health.get("demo-huber")!.factors.find((f) => f.label === "Schulung")).toMatchObject({ note: "3 von 5 geschult" });

    await demo.removeDemo();
    expect(await demo.demoLoaded()).toBe(false);
    const { db } = await import("@/lib/db");
    for (const table of [
      "records",
      "tickets",
      "alerts",
      "devices",
      "checklists",
      "network_models",
      "doc_pages",
      "racks",
      "patch_ports",
      "hour_packages",
    ]) {
      const left = (
        await (
          await db()
        ).execute(
          `SELECT COUNT(*) AS n FROM ${table} WHERE ${table === "tickets" || table === "alerts" || table === "devices" ? "id" : "customer_id"} LIKE 'demo-%'`,
        )
      ).rows[0].n;
      expect([table, Number(left)]).toEqual([table, 0]);
    }
    expect(Number((await (await db()).execute("SELECT COUNT(*) AS n FROM awareness_learners WHERE org LIKE 'demo-%'")).rows[0].n)).toBe(0);
  });
});
