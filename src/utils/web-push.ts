import { sendNotification } from "web-push";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** ok = delivered to the push service; gone = the subscription no longer exists (delete it); failed = try later or give up. */
export type PushResult = "ok" | "gone" | "failed";

export type PushSender = (target: PushTarget, payload: string, config: VapidConfig) => Promise<PushResult>;

const TTL_SECONDS = 60 * 60;
const TIMEOUT_MS = 10_000;

/** What actually talks to the push service; replaceable so the status mapping can be tested without a network. */
export type Deliver = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL: number; timeout: number },
) => Promise<unknown>;

/** Builds a sender that never throws: a failed delivery must not affect the caller. */
export function createSender(deliver: Deliver): PushSender {
  return async (target, payload, config) => {
    try {
      await deliver({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, {
        vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
        TTL: TTL_SECONDS,
        timeout: TIMEOUT_MS,
      });
      return "ok";
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      // 404 and 410 mean the browser unsubscribed or the subscription expired.
      return status === 404 || status === 410 ? "gone" : "failed";
    }
  };
}

export const sendWebPush: PushSender = createSender((subscription, payload, options) =>
  sendNotification(subscription, payload, options),
);
