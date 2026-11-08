import { z } from "zod";
import { DURATION_PATTERN } from "../utils/duration.js";

/** `.env` files often carry `KEY=` for an unset value; treat it as missing. */
function blankToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, "must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "must be at least 32 characters"),
  ACCESS_TOKEN_TTL: z.string().regex(DURATION_PATTERN, "use a duration like 15m, 2h or 7d").default("15m"),
  REFRESH_TOKEN_TTL: z.string().regex(DURATION_PATTERN, "use a duration like 15m, 2h or 7d").default("7d"),
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
  // Admin notifications (FR-17): nudge when a booking waits for confirmation this long, and when a confirmed one starts this soon.
  NOTIFY_UNCONFIRMED_AFTER_MINUTES: z.coerce.number().int().positive().default(15),
  NOTIFY_UPCOMING_MINUTES_BEFORE: z.coerce.number().int().positive().default(120),
  // Requests per IP in each window (windows are fixed in middleware/rate-limit.ts).
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_BOOKING_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_LOOKUP_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_GENERAL_MAX: z.coerce.number().int().positive().default(300),
  // Number of reverse proxies in front of the app (so `req.ip` is the client, not the proxy).
  // Unset: 1 in production (the supported deployment sits behind one HTTPS proxy), 0 elsewhere.
  TRUST_PROXY: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(10).optional()),
  // /docs in production: served only when DOCS_PASSWORD is set, behind HTTP Basic auth.
  DOCS_USER: z.string().min(1).default("docs"),
  DOCS_PASSWORD: z.preprocess(blankToUndefined, z.string().min(12, "must be at least 12 characters").optional()),
  // Only used by the seed script; validated there.
  ADMIN_SEED_EMAIL: z.string().optional(),
  ADMIN_SEED_PASSWORD: z.string().optional(),
});

const envSchema = baseSchema.transform((env) => ({
  ...env,
  TRUST_PROXY: env.TRUST_PROXY ?? (env.NODE_ENV === "production" ? 1 : 0),
}));

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
