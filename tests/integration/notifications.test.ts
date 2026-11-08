// Admin notifications: events, inbox and scheduler over a real PostgreSQL (DATABASE_URL_TEST).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { runSchedulerTick } from "../../src/services/notification.service.js";
import { addDays, jakartaDayStart, toJakartaIso } from "../../src/utils/datetime.js";
import { disconnectPrisma } from "../../src/utils/prisma.js";
import { bookingData, cleanDatabase, createTestPrisma, seedBase, testDatabaseUrl } from "../helpers/db.js";
import { api, loginAdmin, startServer, type TestServer } from "../helpers/http.js";

const suite = testDatabaseUrl ? describe : describe.skip;

interface NotificationBody {
  id: string;
  type: string;
  title: string;
  body: string;
  booking_id: string | null;
  created_at: string;
  read: boolean;
  read_at: string | null;
}

const inDays = (n: number) =>
  toJakartaIso(addDays(jakartaDayStart(toJakartaIso(new Date()).slice(0, 10)), n)).slice(0, 10);
const day = inDays(3);
const startAt = (hhmm: string) => `${day}T${hhmm}:00+07:00`;
const MIN = 60_000;

suite("notifications", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  let server: TestServer;
  let tokenA: string;
  let tokenB: string;
  let base: Awaited<ReturnType<typeof seedBase>>;

  const as = (token: string) => api(server.base, token);
  const json = async <T>(res: Response) => ((await res.json()) as { data: T }).data;
  const inbox = async (token: string, query = "") => {
    const res = await as(token).get(`/admin/notifications${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as { data: NotificationBody[]; meta: Record<string, number> };
  };
  const unread = async (token: string) =>
    (await json<{ unread: number }>(await as(token).get("/admin/notifications/unread-count"))).unread;

  const publicBooking = (overrides: Record<string, unknown> = {}) =>
    api(server.base).post("/bookings", {
      service_id: base.service.id,
      start_at: startAt("09:00"),
      customer_name: "Siti Rahayu",
      customer_phone: "081234567890",
      ...overrides,
    });

  /** A booking inserted directly, so its created_at and start_at can be placed relative to "now". */
  const bookingAt = (input: {
    startOffsetMin: number;
    createdAgoMin?: number;
    status?: "pending" | "confirmed" | "completed" | "cancelled";
    artistId?: string;
    durationMin?: number;
  }) => {
    const start = new Date(Date.now() + input.startOffsetMin * MIN);
    return prisma.booking.create({
      data: {
        ...bookingData({
          serviceId: base.service.id,
          artistId: input.artistId ?? base.artist.id,
          start: "09:00",
          end: "10:00",
          status: input.status ?? "pending",
        }),
        startAt: start,
        endAt: new Date(start.getTime() + (input.durationMin ?? 60) * MIN),
        createdAt: new Date(Date.now() - (input.createdAgoMin ?? 0) * MIN),
      },
    });
  };
  const rows = (type: string) => prisma.notification.findMany({ where: { type: type as never } });

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

  describe("events written with the booking", () => {
    test("a customer's booking creates one notification, linked to it, with no phone or surname", async () => {
      const res = await publicBooking();
      expect(res.status).toBe(201);
      const booking = await json<{ id: string; booking_code: string }>(res);

      const stored = await prisma.notification.findMany();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ type: "new_booking", bookingId: booking.id });
      expect(stored[0]?.body).toContain("Siti memesan Gel Polish");
      expect(stored[0]?.body).toContain(booking.booking_code);
      expect(stored[0]?.dedupeKey).toBe(`new_booking:${booking.booking_code}`);
      for (const text of [stored[0]?.title, stored[0]?.body]) {
        expect(text).not.toContain("81234567890");
        expect(text).not.toContain("Rahayu");
      }
    });

    test("a booking that is refused (409) leaves no notification behind", async () => {
      expect((await publicBooking({ artist_id: base.artist.id })).status).toBe(201);
      expect((await publicBooking({ artist_id: base.artist.id })).status).toBe(409);
      expect(await prisma.notification.count()).toBe(1);
    });

    test("a booking the admin makes is not news to the admins", async () => {
      const res = await as(tokenA).post("/admin/bookings", {
        service_id: base.service.id,
        start_at: startAt("09:00"),
        customer_name: "Walk In",
        customer_phone: "08123456789",
      });
      expect(res.status).toBe(201);
      expect(await prisma.notification.count()).toBe(0);
    });

    test("a customer cancelling creates one notification without their reason; an admin cancelling does not", async () => {
      const booking = await json<{ id: string; booking_code: string }>(await publicBooking());
      await prisma.notification.deleteMany();

      const cancel = await api(server.base).patch(`/bookings/${booking.booking_code}/cancel`, {
        phone: "081234567890",
        reason: "Hubungi saya di 081299998888",
      });
      expect(cancel.status).toBe(200);
      const stored = await prisma.notification.findMany();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ type: "booking_cancelled", bookingId: booking.id });
      expect(stored[0]?.body).toContain("Siti membatalkan Gel Polish");
      expect(stored[0]?.body).not.toContain("081299998888");

      const other = await json<{ id: string }>(await publicBooking({ start_at: startAt("13:00") }));
      await prisma.notification.deleteMany();
      const adminCancel = await as(tokenA).patch(`/admin/bookings/${other.id}/status`, {
        status: "cancelled",
        reason: "Owner membatalkan",
      });
      expect(adminCancel.status).toBe(200);
      expect(await prisma.notification.count()).toBe(0);
    });

    test("cancelling twice does not create a second notification", async () => {
      const booking = await json<{ booking_code: string }>(await publicBooking());
      await prisma.notification.deleteMany();
      const cancel = () =>
        api(server.base).patch(`/bookings/${booking.booking_code}/cancel`, { phone: "081234567890" });
      const results = await Promise.all([cancel(), cancel()]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await prisma.notification.count()).toBe(1);
    });
  });

  describe("inbox", () => {
    test("every endpoint needs an admin token", async () => {
      const anon = api(server.base);
      const id = "99999999-9999-4999-8999-999999999999";
      expect((await anon.get("/admin/notifications")).status).toBe(401);
      expect((await anon.get("/admin/notifications/unread-count")).status).toBe(401);
      expect((await anon.post("/admin/notifications/read-all", {})).status).toBe(401);
      expect((await anon.patch(`/admin/notifications/${id}/read`, {})).status).toBe(401);
    });

    test("lists newest first with pagination, and each admin sees their own read state", async () => {
      for (let i = 0; i < 3; i += 1) {
        await prisma.notification.create({
          data: {
            type: "new_booking",
            title: `Notif ${i}`,
            body: "isi",
            dedupeKey: `k${i}`,
            createdAt: new Date(Date.now() - (3 - i) * MIN),
          },
        });
      }
      const first = await inbox(tokenA, "?per_page=2");
      expect(first.data.map((n) => n.title)).toEqual(["Notif 2", "Notif 1"]);
      expect(first.meta).toEqual({ page: 1, per_page: 2, total: 3, total_pages: 2 });
      expect((await inbox(tokenA, "?per_page=2&page=2")).data.map((n) => n.title)).toEqual(["Notif 0"]);

      const target = first.data[0] as NotificationBody;
      const read = await as(tokenA).patch(`/admin/notifications/${target.id}/read`, {});
      expect(read.status).toBe(200);
      expect(await json<NotificationBody>(read)).toMatchObject({ id: target.id, read: true });

      // A has read it; B has not
      expect(await unread(tokenA)).toBe(2);
      expect(await unread(tokenB)).toBe(3);
      expect((await inbox(tokenA)).data.find((n) => n.id === target.id)?.read).toBe(true);
      expect((await inbox(tokenB)).data.find((n) => n.id === target.id)?.read).toBe(false);
      expect((await inbox(tokenA, "?unread=true")).data).toHaveLength(2);
      expect((await inbox(tokenB, "?unread=true")).data).toHaveLength(3);
    });

    test("reading twice is harmless and keeps the first read time", async () => {
      const n = await prisma.notification.create({
        data: { type: "new_booking", title: "t", body: "b", dedupeKey: "x" },
      });
      const first = await json<NotificationBody>(await as(tokenA).patch(`/admin/notifications/${n.id}/read`, {}));
      await Bun.sleep(20);
      const second = await json<NotificationBody>(await as(tokenA).patch(`/admin/notifications/${n.id}/read`, {}));
      expect(second.read_at).toBe(first.read_at);
      expect(await prisma.notificationRead.count()).toBe(1);
    });

    test("read-all marks only what this admin had not read, and a later notification is unread again", async () => {
      await prisma.notification.createMany({
        data: [0, 1, 2].map((i) => ({ type: "new_booking" as const, title: `t${i}`, body: "b", dedupeKey: `r${i}` })),
      });
      const first = await json<{ marked: number }>(await as(tokenA).post("/admin/notifications/read-all", {}));
      expect(first.marked).toBe(3);
      expect(await unread(tokenA)).toBe(0);
      expect(await unread(tokenB)).toBe(3); // untouched
      expect((await json<{ marked: number }>(await as(tokenA).post("/admin/notifications/read-all", {}))).marked).toBe(
        0,
      );

      await prisma.notification.create({ data: { type: "new_booking", title: "new", body: "b", dedupeKey: "later" } });
      expect(await unread(tokenA)).toBe(1);
    });

    test("only the last 30 days are shown and counted", async () => {
      await prisma.notification.create({
        data: {
          type: "new_booking",
          title: "old",
          body: "b",
          dedupeKey: "old",
          createdAt: new Date(Date.now() - 31 * 86_400_000),
        },
      });
      await prisma.notification.create({
        data: {
          type: "new_booking",
          title: "recent",
          body: "b",
          dedupeKey: "recent",
          createdAt: new Date(Date.now() - 29 * 86_400_000),
        },
      });
      expect((await inbox(tokenA)).data.map((n) => n.title)).toEqual(["recent"]);
      expect(await unread(tokenA)).toBe(1);
    });

    test("404 for an unknown notification, 422 for a malformed id or bad paging", async () => {
      expect(
        (await as(tokenA).patch("/admin/notifications/99999999-9999-4999-8999-999999999999/read", {})).status,
      ).toBe(404);
      expect((await as(tokenA).patch("/admin/notifications/nope/read", {})).status).toBe(422);
      expect((await as(tokenA).get("/admin/notifications?page=0")).status).toBe(422);
      expect((await as(tokenA).get("/admin/notifications?unread=maybe")).status).toBe(422);
    });
  });

  describe("scheduler", () => {
    const tick = () => runSchedulerTick({ now: new Date(), unconfirmedAfterMinutes: 15, upcomingMinutesBefore: 120 });

    test("nudges a booking left pending for more than the wait, once", async () => {
      const late = await bookingAt({ startOffsetMin: 600, createdAgoMin: 20 });
      await bookingAt({ startOffsetMin: 700, createdAgoMin: 10, artistId: base.otherArtist.id }); // not waiting long enough
      expect(await tick()).toMatchObject({ unconfirmed: 1 });
      const stored = await rows("unconfirmed_reminder");
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ bookingId: late.id, dedupeKey: `unconfirmed_reminder:${late.id}` });
      expect(stored[0]?.body).toContain("lebih dari 15 menit");

      expect(await tick()).toMatchObject({ unconfirmed: 0 });
      expect(await rows("unconfirmed_reminder")).toHaveLength(1);
    });

    test("does not nudge a booking that was confirmed, cancelled, or whose time has already passed", async () => {
      await bookingAt({ startOffsetMin: 600, createdAgoMin: 30, status: "confirmed" });
      await bookingAt({ startOffsetMin: 700, createdAgoMin: 30, status: "cancelled", artistId: base.otherArtist.id });
      await bookingAt({ startOffsetMin: -120, createdAgoMin: 300, status: "pending" });
      expect(await tick()).toEqual({ unconfirmed: 0, upcoming: 0, conflicts: 0 });
    });

    test("reminds about a confirmed booking starting within the window, once", async () => {
      const soon = await bookingAt({ startOffsetMin: 90, status: "confirmed" });
      await bookingAt({ startOffsetMin: 300, status: "confirmed", artistId: base.otherArtist.id }); // too far
      await bookingAt({ startOffsetMin: 60, status: "pending", createdAgoMin: 1, artistId: base.otherArtist.id }); // not confirmed
      await bookingAt({ startOffsetMin: -30, status: "confirmed", artistId: base.otherArtist.id }); // already started
      expect(await tick()).toMatchObject({ upcoming: 1 });
      const stored = await rows("upcoming_reminder");
      expect(stored.map((n) => n.bookingId)).toEqual([soon.id]);

      expect(await tick()).toMatchObject({ upcoming: 0 });
      expect(await rows("upcoming_reminder")).toHaveLength(1);
    });

    test("flags an active booking that runs into a blocked slot, once, and ignores the rest", async () => {
      const clash = await bookingAt({ startOffsetMin: 600 });
      await bookingAt({ startOffsetMin: 600, artistId: base.otherArtist.id, status: "cancelled" });
      await bookingAt({ startOffsetMin: 2000, artistId: base.otherArtist.id }); // outside the block
      await prisma.blockedSlot.create({
        data: {
          artistId: null,
          startAt: new Date(Date.now() + 590 * MIN),
          endAt: new Date(Date.now() + 700 * MIN),
          reason: "Cuti",
        },
      });
      await prisma.blockedSlot.create({
        data: { artistId: null, startAt: new Date(Date.now() - 500 * MIN), endAt: new Date(Date.now() - 400 * MIN) }, // already over
      });
      expect(await tick()).toMatchObject({ conflicts: 1 });
      const stored = await rows("schedule_conflict");
      expect(stored.map((n) => n.bookingId)).toEqual([clash.id]);
      expect(stored[0]?.body).toContain("bertabrakan dengan waktu yang diblokir");
      expect(stored[0]?.body).not.toContain("Cuti"); // the owner's reason stays private

      expect(await tick()).toMatchObject({ conflicts: 0 });
    });

    test("an artist's block only affects that artist's bookings", async () => {
      await bookingAt({ startOffsetMin: 600, artistId: base.otherArtist.id });
      await prisma.blockedSlot.create({
        data: {
          artistId: base.artist.id,
          startAt: new Date(Date.now() + 590 * MIN),
          endAt: new Date(Date.now() + 700 * MIN),
        },
      });
      expect(await tick()).toMatchObject({ conflicts: 0 });
    });

    test("two runs at the same moment still produce one notification per event", async () => {
      await bookingAt({ startOffsetMin: 600, createdAgoMin: 20 });
      await bookingAt({ startOffsetMin: 90, status: "confirmed", artistId: base.otherArtist.id });
      await Promise.all([tick(), tick(), tick()]);
      expect(await prisma.notification.count()).toBe(2);
    });

    test("scheduled notifications reach every admin's inbox with no phone number in them", async () => {
      await bookingAt({ startOffsetMin: 600, createdAgoMin: 20 });
      await tick();
      for (const token of [tokenA, tokenB]) {
        const { data } = await inbox(token);
        expect(data).toHaveLength(1);
        expect(data[0]).toMatchObject({ type: "unconfirmed_reminder", read: false });
        expect(`${data[0]?.title} ${data[0]?.body}`).not.toMatch(/\+?62\d{6,}|08\d{6,}/);
      }
    });
  });
});
