import app from "./app.js";
import { EnvError, getEnv, type Env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { disconnectPrisma } from "./utils/prisma.js";

let env: Env;
try {
  env = getEnv();
} catch (err) {
  // Fail fast: never start with missing or invalid configuration.
  console.error(err instanceof EnvError ? err.message : err);
  process.exit(1);
}

// Needs the validated env, so it is set here rather than in app.ts (which must import without env).
app.set("trust proxy", env.TRUST_PROXY);

const server = app.listen(env.PORT, "0.0.0.0", () => {
  logger.info(`Server listening on port ${env.PORT}`);
});

function shutdown(signal: string): void {
  logger.info(`${signal} received, shutting down`);
  // Force exit if connections do not drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close((err) => {
    void disconnectPrisma().finally(() => process.exit(err ? 1 : 0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
