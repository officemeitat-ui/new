import "server-only";
import { getEnv } from "@nexus/core/env";
import { getDatabase } from "@nexus/db";
import { authSchema } from "@nexus/db/schema";
import { hasPendingInvitation, sendMagicLinkEmail } from "@nexus/domain";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { twoFactor } from "better-auth/plugins/two-factor";

const env = getEnv();

/** SSO providers are only enabled when their credentials are configured (docs/adr/0004). */
function socialProviders() {
  const providers: Parameters<typeof betterAuth>[0]["socialProviders"] = {};
  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    providers.microsoft = {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      tenantId: env.MICROSOFT_TENANT_ID,
    };
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  return providers;
}

export const auth = betterAuth({
  appName: env.BRAND_PRODUCT_NAME,
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET ?? "development-secret-change-me-0000000000",
  database: drizzleAdapter(getDatabase().db, { provider: "pg", schema: authSchema }),
  advanced: { database: { generateId: "uuid" } },
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  databaseHooks: {
    user: {
      create: {
        // No public self-registration (M1): accounts – including first SSO logins – are only
        // created for addresses with a pending invitation. Partner staff are seeded.
        before: async (user) => {
          if (!(await hasPendingInvitation(getDatabase().db, user.email))) {
            throw new APIError("FORBIDDEN", {
              message: "Für diese E-Mail-Adresse liegt keine Einladung vor.",
            });
          }
          return { data: user };
        },
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  // Limits per IP address and path. Offices often share one IP behind NAT, so the limits are
  // per minute rather than Better Auth's default 3 per 10 seconds; brute force on passwords
  // and codes stays impractical (10 attempts/minute, 2FA codes additionally lock after 5).
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/*": { window: 60, max: 10 },
      "/sign-up/*": { window: 60, max: 10 },
      "/two-factor/*": { window: 60, max: 10 },
      "/magic-link/*": { window: 60, max: 5 },
    },
  },
  socialProviders: socialProviders(),
  plugins: [
    magicLink({
      expiresIn: 60 * 10,
      disableSignUp: true,
      sendMagicLink: async ({ email, url }) => sendMagicLinkEmail(email, url),
    }),
    twoFactor({ issuer: env.BRAND_PRODUCT_NAME }),
    nextCookies(),
  ],
});

export const enabledSocialProviders = Object.keys(socialProviders()) as ("microsoft" | "google")[];
