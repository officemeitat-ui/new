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
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    BRAND_PRIMARY_COLOR: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "muss eine Hex-Farbe wie #2454d6 sein")
      .default("#2454d6"),
    BRAND_PRODUCT_NAME: z.string().default("ME-IT Nexus"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_SECRET"],
        message: "ist in Produktion Pflicht",
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
