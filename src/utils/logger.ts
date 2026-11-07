import pino from "pino";

// Reads LOG_LEVEL directly (validated in config/env.ts at boot) so importing the
// app, e.g. in tests or the smoke test, does not require the full environment.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.refresh_token",
      "*.phone",
      "*.customer_phone",
    ],
    censor: "[redacted]",
  },
});
