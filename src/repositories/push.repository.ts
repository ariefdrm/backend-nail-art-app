import { getPrisma } from "../utils/prisma.js";

export interface SubscriptionData {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Registers a device. The endpoint is unique, so registering it again updates its keys and hands it to the admin who
 * is signed in now (a shared device). One statement, so two simultaneous registrations cannot collide.
 */
export async function upsertSubscription(adminId: string, data: SubscriptionData) {
  const rows = await getPrisma().$queryRaw<{ id: string; created_at: Date; inserted: boolean }[]>`
    INSERT INTO push_subscriptions (admin_id, endpoint, p256dh, auth)
    VALUES (${adminId}::uuid, ${data.endpoint}, ${data.p256dh}, ${data.auth})
    ON CONFLICT (endpoint) DO UPDATE
      SET admin_id = EXCLUDED.admin_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
    RETURNING id, created_at, (xmax = 0) AS inserted`;
  const row = rows[0];
  if (!row) throw new Error("push subscription upsert returned no row");
  return { id: row.id, createdAt: row.created_at, created: row.inserted };
}

/** Removes this admin's subscription for the endpoint. Returns how many were removed (0 is fine). */
export async function deleteSubscription(adminId: string, endpoint: string): Promise<number> {
  const result = await getPrisma().pushSubscription.deleteMany({ where: { adminId, endpoint } });
  return result.count;
}

/** Removes a subscription the push service reported as gone, whoever owns it. */
export async function deleteByEndpoint(endpoint: string): Promise<void> {
  await getPrisma().pushSubscription.deleteMany({ where: { endpoint } });
}

export function listSubscriptions() {
  return getPrisma().pushSubscription.findMany({ select: { endpoint: true, p256dh: true, auth: true } });
}

export interface ClaimedNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  bookingId: string | null;
}

/**
 * Takes the notifications that have not been pushed yet and marks them pushed, in one statement. `SKIP LOCKED` lets
 * two senders (two instances, or two overlapping runs) split the work instead of sending the same one twice, so a
 * notification is pushed at most once. Notifications older than `since` are left alone: a push hours late is noise.
 */
export function claimUnpushed(now: Date, since: Date, take: number) {
  return getPrisma().$queryRaw<ClaimedNotification[]>`
    UPDATE notifications SET pushed_at = ${now}
    WHERE id IN (
      SELECT id FROM notifications
      WHERE pushed_at IS NULL AND created_at >= ${since}
      ORDER BY created_at ASC
      LIMIT ${take}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type::text AS type, title, body, booking_id AS "bookingId"`;
}
