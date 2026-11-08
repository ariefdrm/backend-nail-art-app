import { dispatchPending, getPushConfig } from "../services/push.service.js";
import { logger } from "../utils/logger.js";
import { startScheduler, type SchedulerHandle } from "./notification-scheduler.js";

/** Short, so "new booking" reaches the phone within seconds; the scheduler that creates reminders runs every minute. */
const INTERVAL_MS = 5_000;

/** Starts the Web Push sender when VAPID keys are configured; otherwise it does nothing. server.ts only. */
export function startPushSender(): SchedulerHandle {
  if (!getPushConfig()) {
    logger.info("Web Push is not configured (VAPID_*), so the sender is off");
    return { stop: () => undefined };
  }
  return startScheduler(() => dispatchPending(), INTERVAL_MS);
}
