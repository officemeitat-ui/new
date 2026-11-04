import { z } from "zod";

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, "muss mit postgres:// oder postgresql:// beginnen");
const redisUrl = z.string().regex(/^rediss?:\/\//, "muss mit redis:// oder rediss:// beginnen");

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    APP_URL: z.url().default("http://localhost:3000"),

    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl.default("redis://localhost:6379"),

    BETTER_AUTH_SECRET: z.string().min(32, "mindestens 32 Zeichen").optional(),

    LLM_PROVIDER: z.enum(["anthropic", "bedrock", "vertex"]).default("anthropic"),
    ANTHROPIC_API_KEY: z.string().optional(),
    AWS_REGION: z.string().default("eu-central-1"),
    GOOGLE_VERTEX_PROJECT_ID: z.string().optional(),
    GOOGLE_VERTEX_REGION: z.string().default("eu"),

    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().default("ME-IT Nexus <noreply@localhost>"),

    MICROSOFT_CLIENT_ID: z.string().optional(),
    MICROSOFT_CLIENT_SECRET: z.string().optional(),
    MICROSOFT_TENANT_ID: z.string().default("common"),
    // Microsoft 365 / Intune connection (ADR 0008): multi-tenant Entra app with application
    // permissions, granted per customer by admin consent. Separate from the SSO app.
    MICROSOFT_GRAPH_CLIENT_ID: z.string().optional(),
    MICROSOFT_GRAPH_CLIENT_SECRET: z.string().optional(),
    MICROSOFT_LOGIN_URL: z.url().default("https://login.microsoftonline.com"),
    MICROSOFT_GRAPH_URL: z.url().default("https://graph.microsoft.com/v1.0"),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    BRAND_PRIMARY_COLOR: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "muss eine Hex-Farbe wie #2454d6 sein")
      .default("#2454d6"),
    BRAND_PRODUCT_NAME: z.string().default("ME-IT Nexus"),
    /** Hosting provider and location for the subprocessor list, e.g. "Hetzner Online GmbH, Falkenstein (DE)". */
    HOSTING_DESCRIPTION: z.string().optional(),

    /**
     * Key for secrets stored in the database (API keys of BookStack, Atera …): 32 random bytes,
     * base64 (`openssl rand -base64 32`). Required in production as soon as such a secret is saved.
     */
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine((value) => Buffer.from(value, "base64").length === 32, "muss 32 Byte (base64) sein")
      .optional(),
    /** Atera REST API (ADR 0010); only tests point this elsewhere. */
    ATERA_API_URL: z.url().default("https://app.atera.com/api/v3"),
    /**
     * Allows connector URLs on private networks and plain http (development and tests only).
     * In production, customer-entered URLs must be public https addresses (SSRF protection).
     */
    CONNECTOR_ALLOW_PRIVATE_URLS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_SECRET"],
        message: "ist in Produktion Pflicht",
      });
    }
    // Allowed only where the app itself runs locally (tests against a production build);
    // never for an installation reachable under a real domain (SSRF protection).
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.APP_URL).hostname);
    if (env.NODE_ENV === "production" && env.CONNECTOR_ALLOW_PRIVATE_URLS && !local) {
      ctx.addIssue({
        code: "custom",
        path: ["CONNECTOR_ALLOW_PRIVATE_URLS"],
        message: "darf in Produktion nicht gesetzt sein (SSRF-Schutz)",
      });
    }
    if (env.LLM_PROVIDER === "vertex" && !env.GOOGLE_VERTEX_PROJECT_ID) {
      ctx.addIssue({
        code: "custom",
        path: ["GOOGLE_VERTEX_PROJECT_ID"],
        message: "ist Pflicht, wenn LLM_PROVIDER=vertex",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Ungültige Umgebungsvariablen:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvError";
  }
}

/** Treat empty strings as unset, so `FOO=` in a .env file behaves like a missing variable. */
function stripEmpty(source: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== "") result[key] = value;
  }
  return result;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(stripEmpty(source));
  if (!parsed.success) {
    throw new EnvError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return parsed.data;
}

let cached: Env | undefined;

/** Validated environment of the current process. Throws a readable EnvError on misconfiguration. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
