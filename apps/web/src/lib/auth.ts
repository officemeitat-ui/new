import "server-only";
import { getEnv } from "@nexus/core/env";
import { getDatabase } from "@nexus/db";
import { authSchema } from "@nexus/db/schema";
import {
  accountUsesTwoFactor,
  hasPendingInvitation,
  isValidInvitationForEmail,
  sendMagicLinkEmail,
  sendTwoFactorLoginHintEmail,
} from "@nexus/domain";
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
        //
        // E-mail sign-up additionally needs the invitation token (header x-invite-token, sent by
        // the invite page): an address with a pending invitation is not enough, or someone could
        // register it first and keep a session once the real person joins. First SSO logins
        // keep the plain invitation check – the identity provider has verified the address.
        before: async (user, context) => {
          const db = getDatabase().db;
          const forbidden = () =>
            new APIError("FORBIDDEN", {
              message: "Bitte nutzen Sie den Link aus Ihrer Einladung, um ein Konto anzulegen.",
            });
          if (context?.path?.startsWith("/sign-up/")) {
            const token =
              context.headers?.get("x-invite-token") ??
              context.request?.headers.get("x-invite-token") ??
              "";
            if (!(await isValidInvitationForEmail(db, token, user.email))) throw forbidden();
            return { data: user };
          }
          if (!(await hasPendingInvitation(db, user.email))) throw forbidden();
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
      // A link alone would bypass the second factor: accounts with 2FA get a hint instead.
      sendMagicLink: async ({ email, url }) =>
        (await accountUsesTwoFactor(getDatabase().db, email))
          ? sendTwoFactorLoginHintEmail(email, `${env.APP_URL}/login`)
          : sendMagicLinkEmail(email, url),
    }),
    twoFactor({ issuer: env.BRAND_PRODUCT_NAME }),
    nextCookies(),
  ],
});

export const enabledSocialProviders = Object.keys(socialProviders()) as ("microsoft" | "google")[];
