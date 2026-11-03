/**
 * Identity tables managed by Better Auth (docs/adr/0004-auth-better-auth.md).
 * Generated with the Better Auth CLI for better-auth 1.7 (email/password, magic link,
 * two-factor) and adapted to `auth_*` table names. These tables are global: they hold
 * identities, not tenant data, and therefore have no Row Level Security.
 */
import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = () => timestamp({ withTimezone: true });

export const authUser = pgTable("auth_user", {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().default(false).notNull(),
  image: text(),
  createdAt: ts().defaultNow().notNull(),
  updatedAt: ts()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  twoFactorEnabled: boolean().default(false),
});

export const authSession = pgTable(
  "auth_session",
  {
    id: uuid().defaultRandom().primaryKey(),
    expiresAt: ts().notNull(),
    token: text().notNull().unique(),
    createdAt: ts().defaultNow().notNull(),
    updatedAt: ts()
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: uuid()
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (t) => [index("auth_session_user_id_idx").on(t.userId)],
);

export const authAccount = pgTable(
  "auth_account",
  {
    id: uuid().defaultRandom().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: ts(),
    refreshTokenExpiresAt: ts(),
    scope: text(),
    password: text(),
    createdAt: ts().defaultNow().notNull(),
    updatedAt: ts()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("auth_account_user_id_idx").on(t.userId)],
);

export const authVerification = pgTable(
  "auth_verification",
  {
    id: uuid().defaultRandom().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: ts().notNull(),
    createdAt: ts().defaultNow().notNull(),
    updatedAt: ts()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);

export const authTwoFactor = pgTable(
  "auth_two_factor",
  {
    id: uuid().defaultRandom().primaryKey(),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    verified: boolean().default(true),
    failedVerificationCount: integer().default(0),
    lockedUntil: ts(),
  },
  (t) => [
    index("auth_two_factor_secret_idx").on(t.secret),
    index("auth_two_factor_user_id_idx").on(t.userId),
  ],
);

/** Model names as Better Auth expects them for the Drizzle adapter. */
export const authSchema = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  twoFactor: authTwoFactor,
};
