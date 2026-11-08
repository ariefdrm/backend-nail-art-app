import { getEnv } from "../config/env.js";
import * as pushRepo from "../repositories/push.repository.js";
import type { PushSubscriptionInput } from "../schemas/push.schema.js";
import { toJakartaIso } from "../utils/datetime.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { sendWebPush, type PushSender, type VapidConfig } from "../utils/web-push.js";

/** Notifications older than this are not pushed: a late push is noise. */
const FRESH_MINUTES = 15;
const BATCH = 50;
/** Deliveries in flight at once. */
const CONCURRENCY = 10;
const MINUTE_MS = 60_000;

export interface PushSubscriptionDto {
  id: string;
  created_at: string;
}

/** Web Push is on only when the three VAPID variables are set (env validation makes it all or none). */
export function getPushConfig(): VapidConfig | null {
  const env = getEnv();
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

function requireConfig(config: VapidConfig | null): VapidConfig {
  if (!config) throw AppError.notFound("Web Push belum diaktifkan");
  return config;
}

export function getPublicKey(config: VapidConfig | null = getPushConfig()): { public_key: string } {
  return { public_key: requireConfig(config).publicKey };
}

export async function subscribe(
  adminId: string,
  input: PushSubscriptionInput,
  config: VapidConfig | null = getPushConfig(),
): Promise<{ subscription: PushSubscriptionDto; created: boolean }> {
  requireConfig(config);
  const saved = await pushRepo.upsertSubscription(adminId, {
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
  });
  return { subscription: { id: saved.id, created_at: toJakartaIso(saved.createdAt) }, created: saved.created };
}

/** Idempotent, and it does not need Web Push to be configured: leaving must always work. */
export async function unsubscribe(adminId: string, endpoint: string): Promise<void> {
  await pushRepo.deleteSubscription(adminId, endpoint);
}

export interface DispatchOptions {
  now?: Date;
  config?: VapidConfig | null;
  sender?: PushSender;
}

export interface DispatchResult {
  notifications: number;
  sent: number;
  gone: number;
  failed: number;
}

const NOTHING: DispatchResult = { notifications: 0, sent: 0, gone: 0, failed: 0 };

/** Runs the tasks with at most `limit` in flight. */
async function inBatches<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += limit) {
    results.push(...(await Promise.all(tasks.slice(i, i + limit).map((task) => task()))));
  }
  return results;
}

/**
 * Pushes the notifications that have not been pushed yet to every subscribed device. It runs apart from the
 * booking request, so a slow or broken push service can never delay or fail a reservation. Each notification is
 * taken once (see `claimUnpushed`); a subscription the push service reports as gone is deleted.
 */
export async function dispatchPending(options: DispatchOptions = {}): Promise<DispatchResult> {
  const config = options.config === undefined ? getPushConfig() : options.config;
  if (!config) return NOTHING;
  const send = options.sender ?? sendWebPush;
  const now = options.now ?? new Date();

  // With nobody subscribed there is nobody to tell, and the notifications stay available for a device that joins soon.
  const subscriptions = await pushRepo.listSubscriptions();
  if (subscriptions.length === 0) return NOTHING;

  const claimed = await pushRepo.claimUnpushed(now, new Date(now.getTime() - FRESH_MINUTES * MINUTE_MS), BATCH);
  const result: DispatchResult = { notifications: claimed.length, sent: 0, gone: 0, failed: 0 };

  const tasks = claimed.flatMap((notification) => {
    // The same text the inbox shows: code, service, time and first name, never a phone number.
    const payload = JSON.stringify({
      notification_id: notification.id,
      booking_id: notification.bookingId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
    });
    return subscriptions.map((subscription) => async () => {
      const outcome = await send(subscription, payload, config);
      if (outcome === "gone") await pushRepo.deleteByEndpoint(subscription.endpoint);
      return outcome;
    });
  });

  for (const outcome of await inBatches(tasks, CONCURRENCY)) result[outcome === "ok" ? "sent" : outcome] += 1;
  if (result.failed > 0) logger.warn({ failed: result.failed, sent: result.sent }, "some web push deliveries failed");
  return result;
}
