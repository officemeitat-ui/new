/**
 * Seeds the platform partner (ME-IT), its first admin and the demo tenant
 * "Huber Haustechnik GmbH" (see prompts/00_MASTER_PROMPT.md, DEMO-MANDANT). Idempotent.
 *
 *   SEED_ADMIN_EMAIL     default admin@me-it.local
 *   SEED_ADMIN_PASSWORD  default: random, printed once
 */
import { randomBytes } from "node:crypto";
import { createLogger } from "@nexus/core/logger";
import { and, createDatabase, eq, withSystem } from "@nexus/db";
import {
  authAccount,
  authUser,
  memberships,
  partnerMemberships,
  partners,
  tenants,
} from "@nexus/db/schema";
import { hashPassword } from "better-auth/crypto";
import { appendAudit } from "../audit";
import { normalizeEmail } from "../invitations";

const log = createLogger("seed");
const url = process.env.DATABASE_URL;
if (!url) {
  log.error("DATABASE_URL ist nicht gesetzt (siehe .env.example).");
  process.exit(1);
}

const email = normalizeEmail(process.env.SEED_ADMIN_EMAIL ?? "admin@me-it.local");
const givenPassword = process.env.SEED_ADMIN_PASSWORD;
const password = givenPassword ?? randomBytes(12).toString("base64url");

const handle = createDatabase(url, { max: 1 });
try {
  const result = await withSystem(
    handle.db,
    "Seed: Partner, Admin und Demo-Mandant",
    async (tx) => {
      let [partner] = await tx.select().from(partners).where(eq(partners.slug, "me-it"));
      partner ??= (
        await tx
          .insert(partners)
          .values({
            name: "ME-IT",
            slug: "me-it",
            productName: "ME-IT Nexus",
            brandColor: "#2454d6",
          })
          .returning()
      )[0]!;

      let [user] = await tx.select().from(authUser).where(eq(authUser.email, email));
      let createdUser = false;
      if (!user) {
        user = (
          await tx
            .insert(authUser)
            .values({ name: "ME-IT Admin", email, emailVerified: true })
            .returning()
        )[0]!;
        await tx.insert(authAccount).values({
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: await hashPassword(password),
        });
        createdUser = true;
      }

      await tx
        .insert(partnerMemberships)
        .values({ partnerId: partner.id, userId: user.id, role: "partner_admin" })
        .onConflictDoNothing();

      let [demo] = await tx.select().from(tenants).where(eq(tenants.slug, "huber-haustechnik"));
      if (!demo) {
        demo = (
          await tx
            .insert(tenants)
            .values({
              partnerId: partner.id,
              name: "Huber Haustechnik GmbH",
              slug: "huber-haustechnik",
              plan: "business",
            })
            .returning()
        )[0]!;
        await appendAudit(tx, demo.id, {
          actorType: "system",
          action: "tenant.created",
          targetType: "tenant",
          targetId: demo.id,
          metadata: { source: "seed", demo: true },
        });
      }

      const [existing] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.tenantId, demo.id), eq(memberships.userId, user.id)));
      if (!existing) {
        await tx.insert(memberships).values({ tenantId: demo.id, userId: user.id, role: "owner" });
        await appendAudit(tx, demo.id, {
          actorType: "system",
          action: "member.added",
          targetType: "user",
          targetId: user.id,
          metadata: { role: "owner", source: "seed" },
        });
      }
      return { createdUser };
    },
  );

  log.info({ email }, "seed complete");
  if (result.createdUser && !givenPassword) {
    // Printed once so the first login is possible; change it after signing in.
    process.stdout.write(`\nAdmin-Zugang: ${email} / ${password}\n\n`);
  }
} finally {
  await handle.close();
}
