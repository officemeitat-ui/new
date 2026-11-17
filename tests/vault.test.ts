import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "vault-")), "test.db")}`;
process.env.SESSION_SECRET = "test-session-geheimnis";

let vault: typeof import("@/lib/workspace/vault");
let docs: typeof import("@/lib/workspace/docs");
let customers: typeof import("@/lib/workspace/customers");
let network: typeof import("@/lib/workspace/network");
let db: typeof import("@/lib/db");
let customerId: string;
let recoveryCode: string;
let key: Buffer;

beforeAll(async () => {
  vault = await import("@/lib/workspace/vault");
  docs = await import("@/lib/workspace/docs");
  customers = await import("@/lib/workspace/customers");
  network = await import("@/lib/workspace/network");
  db = await import("@/lib/db");
  customerId = (await customers.createCustomer({ name: "Huber Steuerberatung" })).id;
  // Vorhandene, noch unverschlüsselte Doku
  await docs.savePort(customerId, {
    panel: "PP1",
    panelPort: "6",
    outlet: "2.14",
    room: "Kopierraum",
    switchName: "SW-Core",
    switchPort: "Gi1/0/6",
    vlan: "30",
    device: "Drucker 2. Stock",
    cable: null,
    notes: null,
  });
  await docs.createPage({ customerId, title: "Notfallplan", content: "Hotline Internet: 0800 100 100" });
  await network.saveNetwork(customerId, {
    ...network.emptyModel(),
    devices: [{ id: "d1", name: "FW-01", kind: "firewall", vendor: "Securepoint", model: "RC100" }],
  });
});

describe("Verschlüsselung einzelner Werte", () => {
  it("verschlüsselt mit Schlüssel, lässt ohne Tresor alles im Klartext", () => {
    const k = Buffer.alloc(32, 7);
    const sealed = vault.seal(k, "Gi1/0/6")!;
    expect(sealed.startsWith("enc1:")).toBe(true);
    expect(sealed).not.toContain("Gi1/0/6");
    expect(vault.unseal(k, sealed)).toBe("Gi1/0/6");
    expect(vault.seal(k, "Gi1/0/6")).not.toBe(sealed); // jedes Mal anderer Zufallswert
    expect(vault.seal(null, "klar")).toBe("klar");
    expect(vault.unseal(null, "klar")).toBe("klar");
    expect(() => vault.unseal(null, sealed)).toThrow(vault.VaultLockedError);
    expect(() => vault.unseal(Buffer.alloc(32, 8), sealed)).toThrow();
  });
});

describe("Doku-Tresor", () => {
  it("verlangt ein langes Passwort", async () => {
    await expect(vault.setupVault("kurz", docs.encryptExistingDocs)).rejects.toThrow("mindestens 12 Zeichen");
    expect(await vault.vaultConfigured()).toBe(false);
  });

  it("verschlüsselt beim Einrichten alle vorhandenen Daten – in der Datenbank steht nichts mehr lesbar", async () => {
    const result = await vault.setupVault("Patchkabel-im-Keller-42", docs.encryptExistingDocs);
    key = result.key;
    recoveryCode = result.recoveryCode;
    expect(recoveryCode).toMatch(/^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
    expect(await vault.vaultConfigured()).toBe(true);

    const client = await db.db();
    const raw = JSON.stringify([
      ...(await client.execute("SELECT * FROM patch_ports")).rows,
      ...(await client.execute("SELECT * FROM doc_pages")).rows,
      ...(await client.execute("SELECT * FROM network_models")).rows,
    ]);
    for (const secret of ["Drucker", "Gi1/0/6", "Kopierraum", "Notfallplan", "0800 100 100", "FW-01", "Securepoint"]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("ist ohne Entsperren gesperrt und mit Schlüssel normal nutzbar", async () => {
    await expect(docs.listPorts(customerId)).rejects.toThrow(vault.VaultLockedError);
    expect(await vault.docAccess()).toBe("gesperrt");
    await vault.runWithDocKey(key, async () => {
      expect((await docs.listPorts(customerId))[0]).toMatchObject({ device: "Drucker 2. Stock", switchPort: "Gi1/0/6" });
      expect((await docs.listPages(customerId))[0].content).toBe("Hotline Internet: 0800 100 100");
      expect((await network.loadNetwork(customerId)).devices[0]).toMatchObject({ name: "FW-01", vendor: "Securepoint" });
      expect((await docs.searchDocs("drucker kopierraum")).map((h) => h.title)).toEqual(["Drucker 2. Stock"]);
      // Neue Daten werden gleich verschlüsselt gespeichert
      await docs.createPage({ customerId, title: "Server", content: "DC01 auf Hyper-V" });
    });
    const client = await db.db();
    expect(JSON.stringify((await client.execute("SELECT * FROM doc_pages")).rows)).not.toContain("Hyper-V");
  });

  it("entsperrt mit Passwort oder Wiederherstellungsschlüssel, nicht mit falschen Angaben", async () => {
    expect((await vault.unlockVault("Patchkabel-im-Keller-42"))?.equals(key)).toBe(true);
    expect((await vault.unlockVault(recoveryCode))?.equals(key)).toBe(true);
    expect((await vault.unlockVault(recoveryCode.toLowerCase().replace(/-/g, "")))?.equals(key)).toBe(true);
    expect(await vault.unlockVault("falsches-passwort-123")).toBeNull();
    expect(await vault.unlockVault("")).toBeNull();
  });

  it("ändert das Passwort – der Wiederherstellungsschlüssel bleibt gültig", async () => {
    await vault.changeVaultPassword(key, "Neues-Doku-Passwort-2027");
    expect(await vault.unlockVault("Patchkabel-im-Keller-42")).toBeNull();
    expect((await vault.unlockVault("Neues-Doku-Passwort-2027"))?.equals(key)).toBe(true);
    expect((await vault.unlockVault(recoveryCode))?.equals(key)).toBe(true);
    await expect(vault.setupVault("Noch-ein-Passwort-123", docs.encryptExistingDocs)).rejects.toThrow("bereits eingerichtet");
  });

  it("hält den entsperrten Zustand nur befristet und fälschungssicher", () => {
    const now = Date.now();
    const token = vault.unlockToken(key, 30, now);
    expect(vault.keyFromToken(token, now + 29 * 60_000)?.equals(key)).toBe(true);
    expect(vault.keyFromToken(token, now + 31 * 60_000)).toBeNull();
    const tampered = token.slice(0, -2) + (token.endsWith("A") ? "BB" : "AA");
    expect(vault.keyFromToken(tampered, now)).toBeNull();
    process.env.SESSION_SECRET = "anderes-geheimnis";
    expect(vault.keyFromToken(token, now)).toBeNull();
    process.env.SESSION_SECRET = "test-session-geheimnis";
  });
});
