// Public booking (create, look up, cancel) over HTTP against a real PostgreSQL (DATABASE_URL_TEST).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SCHEDULE_LOCK_KEY } from "../../src/repositories/schedule-lock.js";
import { addDays, jakartaDayStart, toJakartaIso } from "../../src/utils/datetime.js";
import { disconnectPrisma } from "../../src/utils/prisma.js";
import { at, bookingData, cleanDatabase, createTestPrisma, seedBase, testDatabaseUrl } from "../helpers/db.js";
import { api, startServer, type TestServer } from "../helpers/http.js";

const suite = testDatabaseUrl ? describe : describe.skip;

interface BookingBody {
  id: string;
  booking_code: string;
  status: string;
  source: string;
  service: { id: string; price: number };
  artist: { id: string; name: string };
  start_at: string;
  end_at: string;
  customer_phone: string;
  total_price: number;
  cancel_reason: string | null;
  schedule_conflict: boolean;
}

const inDays = (n: number) =>
  toJakartaIso(addDays(jakartaDayStart(toJakartaIso(new Date()).slice(0, 10)), n)).slice(0, 10);
/** A date inside the booking window, in WIB, so the test does not depend on the day it runs. */
const day = inDays(3);
const startAt = (hhmm: string, date = day) => `${date}T${hhmm}:00+07:00`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

suite("public booking", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  let server: TestServer;
  let base: Awaited<ReturnType<typeof seedBase>>;

  const client = () => api(server.base);
  const json = async <T>(res: Response) => ((await res.json()) as { data: T }).data;
  const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

  const body = (overrides: Record<string, unknown> = {}) => ({
    service_id: base.service.id,
    start_at: startAt("09:00"),
    customer_name: "Siti Rahayu",
    customer_phone: "081234567890",
    ...overrides,
  });
  const book = (overrides: Record<string, unknown> = {}) => client().post("/bookings", body(overrides));
  const created = async (overrides: Record<string, unknown> = {}) => {
    const res = await book(overrides);
    expect(res.status).toBe(201);
    return json<BookingBody>(res);
  };

  beforeAll(async () => {
    server = await startServer();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    // "Owner" sorts before "Second", so Owner is the artist picked first when none is requested.
    base = await seedBase(prisma);
    await prisma.businessHour.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        isOpen: true,
        openTime: "09:00",
        closeTime: "17:00",
        breakStart: "12:00",
        breakEnd: "13:00",
      })),
    });
  });

  afterAll(async () => {
    server.close();
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  describe("POST /bookings", () => {
    test("creates a pending online booking with a normalized phone, a price snapshot and a history row", async () => {
      const res = await book();
      expect(res.status).toBe(201);
      const booking = await json<BookingBody>(res);
      expect(booking).toMatchObject({
        status: "pending",
        source: "online",
        customer_phone: "+6281234567890",
        total_price: 150000,
        start_at: startAt("09:00"),
        end_at: startAt("10:30"), // 90 minute service
        schedule_conflict: false,
      });
      expect(booking.booking_code).toMatch(new RegExp(`^NP-${day.replaceAll("-", "")}-[A-Z2-9]{4}$`));
      expect(booking.artist.id).toBe(base.artist.id);

      const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: booking.id } });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ fromStatus: null, toStatus: "pending", changedBy: null });

      // the price is a snapshot: changing the service later does not touch the booking
      await prisma.service.update({ where: { id: base.service.id }, data: { price: 999000 } });
      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(stored.totalPrice).toBe(150000);
    });

    test("assigns the second artist when the first is busy, then answers 409 when everyone is", async () => {
      expect((await created()).artist.id).toBe(base.artist.id);
      expect((await created()).artist.id).toBe(base.otherArtist.id);
      const res = await book();
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe("SLOT_UNAVAILABLE");
    });

    test("409 for a requested artist who is busy, even if another artist is free", async () => {
      await created({ artist_id: base.artist.id });
      const res = await book({ artist_id: base.artist.id });
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe("SLOT_UNAVAILABLE");
    });

    test("enforces the buffer after a booking, but not at its exact end plus buffer", async () => {
      await created({ artist_id: base.artist.id }); // 09:00-10:30, artist busy until 10:45
      expect((await book({ artist_id: base.artist.id, start_at: startAt("10:30") })).status).toBe(409);
      expect((await book({ artist_id: base.artist.id, start_at: startAt("13:00") })).status).toBe(201);
    });

    test("409 for a time that is off the slot grid, in the break, or after closing", async () => {
      for (const time of ["10:07", "12:00", "16:00"]) {
        expect((await book({ start_at: startAt(time) })).status).toBe(409);
      }
      expect(await prisma.booking.count()).toBe(0);
    });

    test("409 for a time covered by a blocked slot", async () => {
      await prisma.blockedSlot.create({
        data: { artistId: null, startAt: at("09:00", day), endAt: at("11:00", day), reason: "Libur" },
      });
      expect((await book()).status).toBe(409);
    });

    test("two simultaneous requests for the same slot and artist: one 201, one 409", async () => {
      const results = await Promise.all([book({ artist_id: base.artist.id }), book({ artist_id: base.artist.id })]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.booking.count()).toBe(1);
    });

    test("six simultaneous requests without an artist: exactly one per artist succeeds", async () => {
      const results = await Promise.all(Array.from({ length: 6 }, () => book()));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 201, 409, 409, 409, 409]);
      const bookings = await prisma.booking.findMany();
      expect(new Set(bookings.map((b) => b.artistId)).size).toBe(2);
    });

    test("creating a booking waits for the schedule advisory lock shared with blocked slots", async () => {
      const release = deferred();
      const holding = deferred();
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SCHEDULE_LOCK_KEY}::bigint)`;
          holding.resolve();
          await release.promise;
        },
        { timeout: 15_000 },
      );
      await holding.promise;

      let finished = false;
      const request = book().then((res) => {
        finished = true;
        return res;
      });
      await Bun.sleep(400);
      expect(finished).toBe(false);
      expect(await prisma.booking.count()).toBe(0);

      release.resolve();
      await holder;
      expect((await request).status).toBe(201);
    });

    test("422 for a past start, a start beyond the advance window, a bad phone, or malformed input", async () => {
      expect((await book({ start_at: startAt("09:00", inDays(-1)) })).status).toBe(422);
      expect((await book({ start_at: startAt("09:00", inDays(90)) })).status).toBe(422);
      expect((await book({ customer_phone: "0741123456" })).status).toBe(422);
      expect((await book({ customer_phone: "abc" })).status).toBe(422);
      expect((await book({ start_at: "tomorrow" })).status).toBe(422);
      expect((await book({ start_at: `${day}T09:00:00` })).status).toBe(422); // no offset
      expect((await book({ service_id: "nope" })).status).toBe(422);
      expect((await book({ customer_name: "  " })).status).toBe(422);
      expect((await book({ customer_note: "x".repeat(501) })).status).toBe(422);
      expect((await book({ reference_image_url: "ftp://x.test/a.png" })).status).toBe(422);
      expect((await client().post("/bookings", {})).status).toBe(422);
      expect(await prisma.booking.count()).toBe(0);
    });

    test("404 for an unknown or inactive service or artist", async () => {
      const unknown = "99999999-9999-4999-8999-999999999999";
      expect((await book({ service_id: unknown })).status).toBe(404);
      expect((await book({ artist_id: unknown })).status).toBe(404);
      await prisma.service.update({ where: { id: base.service.id }, data: { isActive: false } });
      expect((await book()).status).toBe(404);
    });
  });

  describe("GET /bookings/:booking_code", () => {
    const lookup = (code: string, phone: string) =>
      client().get(`/bookings/${code}?phone=${encodeURIComponent(phone)}`);

    test("returns the booking for the right code and phone, in any accepted phone format", async () => {
      const booking = await created();
      for (const phone of ["+6281234567890", "081234567890", "6281234567890"]) {
        const res = await lookup(booking.booking_code, phone);
        expect(res.status).toBe(200);
        expect((await json<BookingBody>(res)).id).toBe(booking.id);
      }
      expect((await lookup(booking.booking_code.toLowerCase(), "081234567890")).status).toBe(200);
    });

    test("404 (not 403) for a wrong phone, an unparsable phone, an unknown code or a missing phone", async () => {
      const booking = await created();
      for (const phone of ["+6289999999999", "garbage"]) {
        const res = await lookup(booking.booking_code, phone);
        expect(res.status).toBe(404);
        expect(await errorCode(res)).toBe("NOT_FOUND");
      }
      expect((await lookup("NP-20261110-ZZZZ", "081234567890")).status).toBe(404);
      expect((await client().get(`/bookings/${booking.booking_code}`)).status).toBe(422);
    });

    test("flags schedule_conflict when a blocked slot overlaps the booking, and clears it when the block goes", async () => {
      const booking = await created();
      const block = await prisma.blockedSlot.create({
        data: { artistId: null, startAt: at("10:00", day), endAt: at("12:00", day), reason: "Cuti" },
      });
      const conflicted = await json<BookingBody>(await lookup(booking.booking_code, "081234567890"));
      expect(conflicted.schedule_conflict).toBe(true);

      await prisma.blockedSlot.delete({ where: { id: block.id } });
      const cleared = await json<BookingBody>(await lookup(booking.booking_code, "081234567890"));
      expect(cleared.schedule_conflict).toBe(false);
    });
  });

  describe("PATCH /bookings/:booking_code/cancel", () => {
    const cancel = (code: string, payload: Record<string, unknown>) =>
      client().patch(`/bookings/${code}/cancel`, payload);

    test("cancels, records the reason and a history row, and frees the slot", async () => {
      const booking = await created({ artist_id: base.artist.id });
      const res = await cancel(booking.booking_code, { phone: "081234567890", reason: "Berhalangan hadir" });
      expect(res.status).toBe(200);
      const cancelled = await json<BookingBody>(res);
      expect(cancelled).toMatchObject({ status: "cancelled", cancel_reason: "Berhalangan hadir" });

      const history = await prisma.bookingStatusHistory.findMany({
        where: { bookingId: booking.id },
        orderBy: { changedAt: "asc" },
      });
      expect(history.map((h) => [h.fromStatus, h.toStatus])).toEqual([
        [null, "pending"],
        ["pending", "cancelled"],
      ]);
      expect(history[1]).toMatchObject({ changedBy: null, reason: "Berhalangan hadir" });

      // the slot is bookable again
      expect((await book({ artist_id: base.artist.id })).status).toBe(201);
    });

    test("a confirmed booking can be cancelled without a reason", async () => {
      const booking = await created();
      await prisma.booking.update({ where: { id: booking.id }, data: { status: "confirmed" } });
      const res = await cancel(booking.booking_code, { phone: "+6281234567890" });
      expect(res.status).toBe(200);
      expect((await json<BookingBody>(res)).cancel_reason).toBeNull();
    });

    test("404 for a wrong phone and leaves the booking untouched", async () => {
      const booking = await created();
      const res = await cancel(booking.booking_code, { phone: "+6289999999999" });
      expect(res.status).toBe(404);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("pending");
    });

    test("409 INVALID_STATUS_TRANSITION for a booking that is already cancelled or completed", async () => {
      const booking = await created();
      expect((await cancel(booking.booking_code, { phone: "081234567890" })).status).toBe(200);
      const again = await cancel(booking.booking_code, { phone: "081234567890" });
      expect(again.status).toBe(409);
      expect(await errorCode(again)).toBe("INVALID_STATUS_TRANSITION");

      const done = await prisma.booking.create({
        data: {
          ...bookingData({
            serviceId: base.service.id,
            artistId: base.otherArtist.id,
            start: "13:00",
            end: "14:30",
            status: "completed",
          }),
          startAt: at("13:00", day),
          endAt: at("14:30", day),
        },
      });
      expect((await cancel(done.bookingCode, { phone: "+6281234567890" })).status).toBe(409);
    });

    test("409 once the appointment time has passed", async () => {
      const booking = await created();
      await prisma.booking.update({
        where: { id: booking.id },
        data: { startAt: new Date(Date.now() - 2 * 3600_000), endAt: new Date(Date.now() - 3600_000) },
      });
      const res = await cancel(booking.booking_code, { phone: "081234567890" });
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe("INVALID_STATUS_TRANSITION");
    });

    test("concurrent cancels: one 200, the other 409, and a single history row", async () => {
      const booking = await created();
      const results = await Promise.all([
        cancel(booking.booking_code, { phone: "081234567890" }),
        cancel(booking.booking_code, { phone: "081234567890" }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const cancelledRows = await prisma.bookingStatusHistory.count({
        where: { bookingId: booking.id, toStatus: "cancelled" },
      });
      expect(cancelledRows).toBe(1);
    });

    test("422 for a missing phone or an over-long reason", async () => {
      const booking = await created();
      expect((await cancel(booking.booking_code, {})).status).toBe(422);
      expect((await cancel(booking.booking_code, { phone: "081234567890", reason: "x".repeat(256) })).status).toBe(422);
    });
  });
});
