// Web Push: subscriptions over HTTP and the sender against a real PostgreSQL (DATABASE_URL_TEST).
// The sender is always a fake: nothing here talks to a real push service.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { dispatchPending, getPushConfig } from "../../src/services/push.service.js";
import { addDays, jakartaDayStart, toJakartaIso } from "../../src/utils/datetime.js";
import { disconnectPrisma } from "../../src/utils/prisma.js";
import type { PushResult, PushSender } from "../../src/utils/web-push.js";
import { cleanDatabase, createTestPrisma, seedBase, testDatabaseUrl } from "../helpers/db.js";
import { api, loginAdmin, startServer, type TestServer } from "../helpers/http.js";

const suite = testDatabaseUrl ? describe : describe.skip;

const KEYS = {
  p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
  auth: "tBHItJI5svbpez7KI4CCXg",
};
const ENDPOINT_A = "https://fcm.googleapis.com/fcm/send/device-a";
const ENDPOINT_B = "https://updates.push.services.mozilla.com/wpush/v2/device-b";
const subscription = (endpoint: string) => ({ endpoint, keys: KEYS });

const inDays = (n: number) =>
  toJakartaIso(addDays(jakartaDayStart(toJakartaIso(new Date()).slice(0, 10)), n)).slice(0, 10);
const day = inDays(3);
const MIN = 60_000;

suite("web push", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  let server: TestServer;
  let tokenA: string;
  let tokenB: string;
  let base: Awaited<ReturnType<typeof seedBase>>;

  const as = (token: string) => api(server.base, token);
  const config = () => getPushConfig();

  /** Records every delivery and answers per endpoint. */
  function fakeSender(outcome: (endpoint: string) => PushResult = () => "ok") {
    const deliveries: { endpoint: string; payload: Record<string, unknown> }[] = [];
    const sender: PushSender = (target, payload) => {
      deliveries.push({ endpoint: target.endpoint, payload: JSON.parse(payload) as Record<string, unknown> });
      return Promise.resolve(outcome(target.endpoint));
    };
    return { sender, deliveries };
  }

  const publicBooking = (overrides: Record<string, unknown> = {}) =>
    api(server.base).post("/bookings", {
      service_id: base.service.id,
      start_at: `${day}T09:00:00+07:00`,
      customer_name: "Siti Rahayu",
      customer_phone: "081234567890",
      ...overrides,
    });
  const addNotification = (key: string, createdAgoMin = 0) =>
    prisma.notification.create({
      data: {
        type: "new_booking",
        title: "Reservasi baru",
        body: `Isi ${key}`,
        dedupeKey: key,
        createdAt: new Date(Date.now() - createdAgoMin * MIN),
      },
    });
  const subscribeBoth = async () => {
    await as(tokenA).post("/admin/push-subscriptions", subscription(ENDPOINT_A));
    await as(tokenB).post("/admin/push-subscriptions", subscription(ENDPOINT_B));
  };

  beforeAll(async () => {
    server = await startServer();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    base = await seedBase(prisma);
    await prisma.businessHour.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        isOpen: true,
        openTime: "09:00",
        closeTime: "17:00",
      })),
    });
    tokenA = await loginAdmin(prisma, server.base, "a@nailpalace.test");
    tokenB = await loginAdmin(prisma, server.base, "b@nailpalace.test", "staff");
  });

  afterAll(async () => {
    server.close();
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  describe("subscriptions", () => {
    test("every endpoint needs an admin token", async () => {
      const anon = api(server.base);
      expect((await anon.get("/admin/push/public-key")).status).toBe(401);
      expect((await anon.post("/admin/push-subscriptions", subscription(ENDPOINT_A))).status).toBe(401);
      expect((await anon.delete("/admin/push-subscriptions")).status).toBe(401);
    });

    test("hands out the configured VAPID public key to any admin", async () => {
      for (const token of [tokenA, tokenB]) {
        const res = await as(token).get("/admin/push/public-key");
        expect(res.status).toBe(200);
        expect(((await res.json()) as { data: { public_key: string } }).data.public_key).toBe(
          process.env["VAPID_PUBLIC_KEY"] as string,
        );
      }
    });

    test("registers a device (201) and registering it again is harmless (200, same id)", async () => {
      const first = await as(tokenA).post("/admin/push-subscriptions", subscription(ENDPOINT_A));
      expect(first.status).toBe(201);
      const created = ((await first.json()) as { data: { id: string; created_at: string } }).data;
      expect(created.created_at).toMatch(/\+07:00$/);

      const again = await as(tokenA).post("/admin/push-subscriptions", {
        endpoint: ENDPOINT_A,
        keys: { ...KEYS, auth: "bmV3LWF1dGg" },
      });
      expect(again.status).toBe(200);
      expect(((await again.json()) as { data: { id: string } }).data.id).toBe(created.id);
      const stored = await prisma.pushSubscription.findMany();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.auth).toBe("bmV3LWF1dGg"); // keys refreshed
    });

    test("a device used by another admin moves to whoever registered it last", async () => {
      await as(tokenA).post("/admin/push-subscriptions", subscription(ENDPOINT_A));
      await as(tokenB).post("/admin/push-subscriptions", subscription(ENDPOINT_A));
      const stored = await prisma.pushSubscription.findMany({ include: { admin: true } });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.admin.email).toBe("b@nailpalace.test");
    });

    test("two registrations of the same device at once leave one row", async () => {
      const results = await Promise.all([
        as(tokenA).post("/admin/push-subscriptions", subscription(ENDPOINT_A)),
        as(tokenA).post("/admin/push-subscriptions", subscription(ENDPOINT_A)),
        as(tokenB).post("/admin/push-subscriptions", subscription(ENDPOINT_A)),
      ]);
      expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
      expect(await prisma.pushSubscription.count()).toBe(1);
    });

    test("422 for an endpoint that is not a known push service, or for missing keys", async () => {
      for (const endpoint of [
        "https://evil.test/push",
        "http://fcm.googleapis.com/x",
        "https://169.254.169.254/latest",
        "nope",
      ]) {
        expect((await as(tokenA).post("/admin/push-subscriptions", subscription(endpoint))).status).toBe(422);
      }
      expect((await as(tokenA).post("/admin/push-subscriptions", { endpoint: ENDPOINT_A })).status).toBe(422);
      expect(
        (await as(tokenA).post("/admin/push-subscriptions", { endpoint: ENDPOINT_A, keys: { p256dh: "x" } })).status,
      ).toBe(422);
      expect(await prisma.pushSubscription.count()).toBe(0);
    });

    test("unsubscribing removes only your own device, and repeating it is fine", async () => {
      await subscribeBoth();
      const remove = (token: string, endpoint: string) => as(token).delete("/admin/push-subscriptions", { endpoint });

      expect((await remove(tokenA, ENDPOINT_B)).status).toBe(204); // not A's device: nothing happens
      expect(await prisma.pushSubscription.count()).toBe(2);
      expect((await remove(tokenA, ENDPOINT_A)).status).toBe(204);
      expect((await remove(tokenA, ENDPOINT_A)).status).toBe(204);
      expect(await prisma.pushSubscription.count()).toBe(1);
      expect((await as(tokenA).delete("/admin/push-subscriptions", {})).status).toBe(422);
    });

    test("deleting an admin removes their devices", async () => {
      await subscribeBoth();
      await prisma.admin.delete({ where: { email: "b@nailpalace.test" } });
      expect((await prisma.pushSubscription.findMany()).map((s) => s.endpoint)).toEqual([ENDPOINT_A]);
    });
  });

  describe("sending", () => {
    test("a booking does not wait for the push: it is created first, and the push follows", async () => {
      await subscribeBoth();
      const res = await publicBooking();
      expect(res.status).toBe(201);
      const notification = await prisma.notification.findFirstOrThrow();
      expect(notification.pushedAt).toBeNull(); // nothing was sent while the request ran

      const { sender, deliveries } = fakeSender();
      const result = await dispatchPending({ config: config(), sender });
      expect(result).toEqual({ notifications: 1, sent: 2, gone: 0, failed: 0 });
      expect(deliveries.map((d) => d.endpoint).sort()).toEqual([ENDPOINT_A, ENDPOINT_B].sort());
      expect((await prisma.notification.findFirstOrThrow()).pushedAt).not.toBeNull();
    });

    test("the push carries the inbox text and ids, and no phone number or surname", async () => {
      await subscribeBoth();
      await publicBooking();
      const { sender, deliveries } = fakeSender();
      await dispatchPending({ config: config(), sender });
      const notification = await prisma.notification.findFirstOrThrow();
      expect(deliveries[0]?.payload).toEqual({
        notification_id: notification.id,
        booking_id: notification.bookingId,
        type: "new_booking",
        title: notification.title,
        body: notification.body,
      });
      const text = JSON.stringify(deliveries);
      expect(text).not.toContain("81234567890");
      expect(text).not.toContain("Rahayu");
    });

    test("a notification is pushed once, however many times the sender runs", async () => {
      await subscribeBoth();
      await addNotification("one");
      const { sender, deliveries } = fakeSender();
      await dispatchPending({ config: config(), sender });
      await dispatchPending({ config: config(), sender });
      expect(deliveries).toHaveLength(2); // one notification x two devices, not four
    });

    test("overlapping senders split the work: every notification reaches every device exactly once", async () => {
      await subscribeBoth();
      for (let i = 0; i < 6; i += 1) await addNotification(`n${i}`);
      const { sender, deliveries } = fakeSender();
      await Promise.all([1, 2, 3].map(() => dispatchPending({ config: config(), sender })));
      const pairs = deliveries.map((d) => `${String(d.payload["notification_id"])}|${d.endpoint}`);
      expect(pairs).toHaveLength(12);
      expect(new Set(pairs).size).toBe(12);
    });

    test("a subscription the push service reports as gone is deleted, the others still get the push", async () => {
      await subscribeBoth();
      await addNotification("one");
      const { sender, deliveries } = fakeSender((endpoint) => (endpoint === ENDPOINT_B ? "gone" : "ok"));
      const result = await dispatchPending({ config: config(), sender });
      expect(result).toMatchObject({ sent: 1, gone: 1 });
      expect(deliveries).toHaveLength(2);
      expect((await prisma.pushSubscription.findMany()).map((s) => s.endpoint)).toEqual([ENDPOINT_A]);
    });

    test("a failing push service does not delete anything or throw", async () => {
      await subscribeBoth();
      await addNotification("one");
      const result = await dispatchPending({ config: config(), sender: fakeSender(() => "failed").sender });
      expect(result).toMatchObject({ sent: 0, failed: 2 });
      expect(await prisma.pushSubscription.count()).toBe(2);
    });

    test("with nobody subscribed the notifications wait, and reach a device that joins soon after", async () => {
      await addNotification("early");
      const { sender, deliveries } = fakeSender();
      expect((await dispatchPending({ config: config(), sender })).notifications).toBe(0);
      expect((await prisma.notification.findFirstOrThrow()).pushedAt).toBeNull();

      await as(tokenA).post("/admin/push-subscriptions", subscription(ENDPOINT_A));
      await dispatchPending({ config: config(), sender });
      expect(deliveries).toHaveLength(1);
    });

    test("a notification older than 15 minutes is not pushed", async () => {
      await subscribeBoth();
      await addNotification("stale", 20);
      await addNotification("fresh", 1);
      const { sender, deliveries } = fakeSender();
      await dispatchPending({ config: config(), sender });
      expect(deliveries.map((d) => d.payload["body"])).toEqual(["Isi fresh", "Isi fresh"]);
    });

    test("without Web Push configured nothing is claimed or sent", async () => {
      await subscribeBoth();
      await addNotification("one");
      const { sender, deliveries } = fakeSender();
      expect(await dispatchPending({ config: null, sender })).toEqual({
        notifications: 0,
        sent: 0,
        gone: 0,
        failed: 0,
      });
      expect(deliveries).toHaveLength(0);
      expect((await prisma.notification.findFirstOrThrow()).pushedAt).toBeNull();
    });
  });
});
