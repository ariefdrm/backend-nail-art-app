import { runSchedulerTick } from "../services/notification.service.js";
import { logger } from "../utils/logger.js";

const DEFAULT_INTERVAL_MS = 60_000;

export interface SchedulerHandle {
  stop: () => void;
}

/**
 * Runs `tick` every `intervalMs`, one run at a time (a slow run is not overlapped by the next), and never lets a
 * failed run stop the schedule. Started from server.ts only, never from app.ts, so tests and the smoke test that
 * import the app do not start a timer.
 */
export function startScheduler(
  tick: () => Promise<unknown>,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): SchedulerHandle {
  let running = false;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (err) {
      logger.error({ err }, "notification scheduler run failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void run(), intervalMs);
  // The timer alone must not keep the process alive during shutdown.
  timer.unref();
  void run();

  return { stop: () => clearInterval(timer) };
}

export function startNotificationScheduler(): SchedulerHandle {
  return startScheduler(runSchedulerTick);
}
