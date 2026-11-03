import { withTenant } from "@nexus/db";
import { openTestDatabase } from "@nexus/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appendAudit,
  canonicalJson,
  GENESIS_HASH,
  verifyAuditChain,
  verifyEntries,
} from "../src/audit";
import { createPartnerWithTenant } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let tenantId: string;

beforeAll(async () => {
  tenantId = (await createPartnerWithTenant(db)).tenant.id;
});
afterAll(() => handle.close());

describe("canonicalJson", () => {
  it("sorts keys so equal content hashes equally", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}',
    );
  });
});

describe("audit hash chain", () => {
  it("links entries and verifies the chain", async () => {
    await withTenant(db, tenantId, async (tx) => {
      const first = await appendAudit(tx, tenantId, { actorType: "system", action: "a.one" });
      const second = await appendAudit(tx, tenantId, {
        actorType: "user",
        actorId: "u1",
        action: "a.two",
        metadata: { z: 1, a: "ä" },
      });
      expect(first.seq).toBe(1);
      expect(first.prevHash).toBe(GENESIS_HASH);
      expect(second.prevHash).toBe(first.hash);
      expect(await verifyAuditChain(tx, tenantId)).toEqual({ valid: true, count: 2 });
    });
  });

  it("serialises concurrent writers without gaps or duplicates", async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        withTenant(db, tenantId, (tx) =>
          appendAudit(tx, tenantId, { actorType: "system", action: `parallel.${i}` }),
        ),
      ),
    );
    const check = await withTenant(db, tenantId, (tx) => verifyAuditChain(tx, tenantId));
    expect(check).toEqual({ valid: true, count: 10 });
  });

  it("detects a manipulated entry", async () => {
    const entry = (seq: number, prevHash: string, hash: string, action = "x") => ({
      tenantId,
      seq,
      actorType: "system" as const,
      actorId: null,
      action,
      targetType: null,
      targetId: null,
      metadata: {},
      createdAt: new Date("2026-11-03T10:00:00Z"),
      prevHash,
      hash,
    });
    // Build a valid two-entry chain in memory, then change the action of the first entry.
    const { computeAuditHash } = await import("../src/audit");
    const base = { ...entry(1, GENESIS_HASH, ""), createdAt: "2026-11-03T10:00:00.000Z" };
    const { prevHash: _p, hash: _h, ...fields1 } = base;
    const h1 = computeAuditHash(GENESIS_HASH, fields1);
    const fields2 = { ...fields1, seq: 2 };
    const h2 = computeAuditHash(h1, fields2);
    const chain = [entry(1, GENESIS_HASH, h1), entry(2, h1, h2)];
    expect(verifyEntries(chain)).toEqual({ valid: true, count: 2 });

    const tampered = [entry(1, GENESIS_HASH, h1, "verändert"), entry(2, h1, h2)];
    expect(verifyEntries(tampered)).toEqual({ valid: false, brokenAtSeq: 1 });
    expect(verifyEntries([chain[1]!])).toEqual({ valid: false, brokenAtSeq: 2 });
  });
});
