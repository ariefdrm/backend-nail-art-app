import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, "must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "must be at least 32 characters"),
  ACCESS_TOKEN_TTL: z.string().min(1).default("15m"),
  REFRESH_TOKEN_TTL: z.string().min(1).default("7d"),
  // Comma-separated list of allowed origins.
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  TZ: z.string().min(1).default("Asia/Jakarta"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SLOT_STEP_MINUTES: z.coerce.number().int().positive().default(30),
  BOOKING_BUFFER_MINUTES: z.coerce.number().int().min(0).default(15),
  MAX_ADVANCE_DAYS: z.coerce.number().int().positive().default(60),
  CANCEL_MIN_HOURS_BEFORE: z.coerce.number().int().min(0).default(0),
  // Only used by the seed script; validated there.
  ADMIN_SEED_EMAIL: z.string().optional(),
  ADMIN_SEED_PASSWORD: z.string().optional(),
});

export type Env = z.output<typeof envSchema>;

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "EnvError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  return result.data;
}

let cached: Env | undefined;

/** Parses process.env once. Call it at boot so the app fails fast on bad config. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
