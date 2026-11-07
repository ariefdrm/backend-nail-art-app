import { pingDatabase } from "../repositories/health.repository.js";
import { logger } from "../utils/logger.js";

export async function isReady(): Promise<boolean> {
  try {
    await pingDatabase();
    return true;
  } catch (err) {
    logger.error({ err }, "readiness check failed");
    return false;
  }
}
