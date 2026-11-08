// Business hours and blocked slots over HTTP against a real PostgreSQL (DATABASE_URL_TEST).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import app from "../../src/app.js";
import { SCHEDULE_LOCK_KEY } from "../../src/repositories/schedule.repository.js";
import { hashPassword } from "../../src/utils/password.js";
import { disconnectPrisma } from "../../src/utils/prisma.js";
import { at, bookingData, cleanDatabase, createTestPrisma, seedBase, testDatabaseUrl } from "../helpers/db.js";

const suite = testDatabaseUrl ? describe : describe.skip;
const PASSWORD = "a-long-enough-password";

interface HourBody {
  day_of_week: number;
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
  break_start: string | null;
  break_end: string | null;
}
interface AffectedBody {
  id: string;
  booking_code: string;
  status: string;
  start_at: string;
  end_at: string;
  customer_name: string;
  service_name: string;
  contact_url: string;
}
interface SlotBody {
  id: string;
  artist_id: string | null;
  start_at: string;
  end_at: string;
  reason: string | null;
  affected_bookings?: AffectedBody[];
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const week = (override: Record<number, Record<string, unknown>> = {}) =>
  Array.from({ length: 7 }, (_, day) => override[day] ?? { day_of_week: day, is_open: false });
const openDay = (day: number, extra: Record<string, unknown> = {}) => ({
  day_of_week: day,
  is_open: true,
  open_time: "10:00",
  close_time: "20:00",
  ...extra,
});

suite("schedule management", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  let server: Server;
  let base: string;
  let token: string;

  const call = (method: string, path: string, body?: unknown, auth: string | null = token) =>
    fetch(`${base}/api/v1${path}`, {
      method,
      headers: {
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const json = async <T>(res: Response) => ((await res.json()) as { data: T }).data;

  /** An active booking on `artistId` between two WIB clock times on 2026-11-10. */
  async function book(
    artistId: string,
    serviceId: string,
    start: string,
    end: string,
    extra: Record<string, unknown> = {},
  ) {
    return prisma.booking.create({ data: { ...bookingData({ serviceId, artistId, start, end }), ...extra } });
  }

  const slotBody = (start: string, end: string, extra: Record<string, unknown> = {}) => ({
    start_at: at(start).toISOString(),
    end_at: at(end).toISOString(),
    ...extra,
  });

  beforeAll(async () => {
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    await prisma.admin.create({
      data: { email: "owner@nailpalace.test", passwordHash: await hashPassword(PASSWORD), name: "Owner" },
    });
    const login = await call("POST", "/auth/login", { email: "owner@nailpalace.test", password: PASSWORD }, null);
    token = (await json<{ access_token: string }>(login)).access_token;
  });

  afterAll(async () => {
    server.close();
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  describe("authorization", () => {
    test("every schedule route answers 401 without a token", async () => {
      const id = "99999999-9999-4999-8999-999999999999";
      const responses = await Promise.all([
        call("GET", "/admin/business-hours", undefined, null),
        call("PUT", "/admin/business-hours", { hours: week() }, null),
        call("GET", "/admin/blocked-slots", undefined, null),
        call("POST", "/admin/blocked-slots", slotBody("10:00", "11:00"), null),
        call("POST", "/admin/blocked-slots/check", slotBody("10:00", "11:00"), null),
        call("DELETE", `/admin/blocked-slots/${id}`, undefined, null),
      ]);
      expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401]);
    });
  });

  describe("business hours", () => {
    test("GET returns all 7 days as closed when nothing is stored yet", async () => {
      const res = await call("GET", "/admin/business-hours");
      expect(res.status).toBe(200);
      const hours = await json<HourBody[]>(res);
      expect(hours.map((h) => h.day_of_week)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(hours.every((h) => !h.is_open && h.open_time === null)).toBe(true);
    });

    test("PUT stores the week atomically and GET reflects it, with breaks", async () => {
      const put = await call("PUT", "/admin/business-hours", {
        hours: week({
          1: openDay(1, { break_start: "12:00", break_end: "13:00" }),
          2: openDay(2),
          6: openDay(6, { open_time: "09:00", close_time: "17:00" }),
        }),
      });
      expect(put.status).toBe(200);
      const saved = await json<HourBody[]>(put);
      expect(saved[1]).toEqual({
        day_of_week: 1,
        is_open: true,
        open_time: "10:00",
        close_time: "20:00",
        break_start: "12:00",
        break_end: "13:00",
      });

      const again = await json<HourBody[]>(await call("GET", "/admin/business-hours"));
      expect(again).toEqual(saved);
      expect(await prisma.businessHour.count()).toBe(7);
    });

    test("PUT again replaces the previous week instead of adding rows", async () => {
      await call("PUT", "/admin/business-hours", { hours: week({ 1: openDay(1) }) });
      await call("PUT", "/admin/business-hours", { hours: week({ 3: openDay(3, { close_time: "18:00" }) }) });
      const hours = await json<HourBody[]>(await call("GET", "/admin/business-hours"));
      expect(hours[1]?.is_open).toBe(false);
      expect(hours[3]).toMatchObject({ is_open: true, close_time: "18:00" });
      expect(await prisma.businessHour.count()).toBe(7);
    });

    test("a closed day is stored without any times", async () => {
      const put = await call("PUT", "/admin/business-hours", {
        hours: week({
          0: { day_of_week: 0, is_open: false, open_time: "10:00", break_start: "12:00", break_end: "13:00" },
        }),
      });
      expect((await json<HourBody[]>(put))[0]).toMatchObject({ is_open: false, open_time: null, break_start: null });
      const row = await prisma.businessHour.findUnique({ where: { dayOfWeek: 0 } });
      expect(row).toMatchObject({ openTime: null, closeTime: null, breakStart: null, breakEnd: null });
    });

    test.each([
      ["fewer than 7 days", () => week().slice(0, 6)],
      ["a duplicated day", () => week({ 3: { day_of_week: 2, is_open: false } })],
      ["an open day without times", () => week({ 1: { day_of_week: 1, is_open: true } })],
      ["close before open", () => week({ 1: openDay(1, { open_time: "20:00", close_time: "10:00" }) })],
      ["a malformed time", () => week({ 1: openDay(1, { open_time: "9:00" }) })],
      ["a break with only a start", () => week({ 1: openDay(1, { break_start: "12:00" }) })],
      ["a break outside opening hours", () => week({ 1: openDay(1, { break_start: "08:00", break_end: "09:00" }) })],
    ])("PUT rejects %s with 422 and changes nothing", async (_label, makeHours) => {
      await call("PUT", "/admin/business-hours", { hours: week({ 2: openDay(2) }) });
      const res = await call("PUT", "/admin/business-hours", { hours: makeHours() });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

      const hours = await json<HourBody[]>(await call("GET", "/admin/business-hours"));
      expect(hours[2]).toMatchObject({ is_open: true, open_time: "10:00" });
      expect(hours.filter((h) => h.is_open)).toHaveLength(1);
    });

    test("PUT without a hours array is a 422", async () => {
      expect((await call("PUT", "/admin/business-hours", {})).status).toBe(422);
    });
  });

  describe("blocked slots: creating", () => {
    test("blocks the whole studio when no artist is given (201, no affected bookings)", async () => {
      const res = await call("POST", "/admin/blocked-slots", slotBody("10:00", "12:00", { reason: "  Libur  " }));
      expect(res.status).toBe(201);
      const slot = await json<SlotBody>(res);
      expect(slot).toMatchObject({
        artist_id: null,
        start_at: "2026-11-10T10:00:00+07:00",
        end_at: "2026-11-10T12:00:00+07:00",
        reason: "Libur",
        affected_bookings: [],
      });
      expect(await prisma.blockedSlot.count()).toBe(1);
    });

    test("blocks a single artist", async () => {
      const { artist } = await seedBase(prisma);
      const res = await call("POST", "/admin/blocked-slots", slotBody("10:00", "12:00", { artist_id: artist.id }));
      expect(res.status).toBe(201);
      expect((await json<SlotBody>(res)).artist_id).toBe(artist.id);
    });

    test("an unknown artist is a 422 pointing at artist_id", async () => {
      const res = await call(
        "POST",
        "/admin/blocked-slots",
        slotBody("10:00", "12:00", { artist_id: "99999999-9999-4999-8999-999999999999" }),
      );
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: { details: { field: string }[] } };
      expect(body.error.details.map((d) => d.field)).toEqual(["artist_id"]);
      expect(await prisma.blockedSlot.count()).toBe(0);
    });

    test.each([
      ["end before start", slotBody("12:00", "10:00")],
      ["end equal to start", slotBody("10:00", "10:00")],
      ["a missing end", { start_at: at("10:00").toISOString() }],
      ["a time without offset", { start_at: "2026-11-10T10:00:00", end_at: "2026-11-10T12:00:00" }],
      ["a range over 366 days", { start_at: at("10:00").toISOString(), end_at: "2027-11-20T10:00:00+07:00" }],
    ])("rejects %s with 422", async (_label, body) => {
      const res = await call("POST", "/admin/blocked-slots", body);
      expect(res.status).toBe(422);
      expect(await prisma.blockedSlot.count()).toBe(0);
    });
  });

  describe("blocked slots: bookings in the way", () => {
    test("409 BLOCK_HAS_BOOKINGS lists the bookings and creates nothing", async () => {
      const { artist, service } = await seedBase(prisma);
      const booking = await book(artist.id, service.id, "10:00", "11:30", { customerName: "Siti Rahayu" });

      const res = await call("POST", "/admin/blocked-slots", slotBody("09:00", "12:00"));
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string; message: string; conflicts: AffectedBody[] } };
      expect(body.error.code).toBe("BLOCK_HAS_BOOKINGS");
      expect(body.error.conflicts).toHaveLength(1);
      expect(body.error.conflicts[0]).toMatchObject({
        id: booking.id,
        booking_code: booking.bookingCode,
        status: "pending",
        start_at: "2026-11-10T10:00:00+07:00",
        end_at: "2026-11-10T11:30:00+07:00",
        customer_name: "Siti Rahayu",
        service_name: "Gel Polish",
      });
      expect(await prisma.blockedSlot.count()).toBe(0);
    });

    test("acknowledge_conflicts creates the block, cancels nothing, and returns the affected bookings", async () => {
      const { artist, service } = await seedBase(prisma);
      await book(artist.id, service.id, "10:00", "11:30");
      await book(artist.id, service.id, "13:00", "14:30", { status: "confirmed" });

      const res = await call(
        "POST",
        "/admin/blocked-slots",
        slotBody("09:00", "15:00", { acknowledge_conflicts: true }),
      );
      expect(res.status).toBe(201);
      const slot = await json<SlotBody>(res);
      expect(slot.affected_bookings?.map((b) => b.status)).toEqual(["pending", "confirmed"]);
      expect(await prisma.blockedSlot.count()).toBe(1);
      expect(await prisma.booking.count({ where: { status: { in: ["pending", "confirmed"] } } })).toBe(2);
    });

    test("the contact link opens a chat with the customer and a ready message", async () => {
      const { artist, service } = await seedBase(prisma);
      await book(artist.id, service.id, "10:00", "11:30", {
        customerName: "Siti Rahayu",
        customerPhone: "+6281234567890",
      });

      const check = await json<{ can_block: boolean; conflicts: AffectedBody[] }>(
        await call("POST", "/admin/blocked-slots/check", slotBody("09:00", "12:00", { reason: "Rahasia pemilik" })),
      );
      const url = new URL(check.conflicts[0]?.contact_url ?? "");
      expect(url.origin + url.pathname).toBe("https://wa.me/6281234567890");
      const text = url.searchParams.get("text") ?? "";
      expect(text).toContain("Halo Siti,");
      expect(text).toContain("Selasa, 10 November 2026 pukul 10.00 WIB");
      expect(text).not.toContain("Rahasia pemilik");
    });

    test("only pending and confirmed bookings conflict", async () => {
      const { artist, service } = await seedBase(prisma);
      for (const [index, status] of (["completed", "cancelled", "no_show"] as const).entries()) {
        await book(artist.id, service.id, `1${index}:00`, `1${index}:30`, { status });
      }
      const res = await call("POST", "/admin/blocked-slots", slotBody("09:00", "16:00"));
      expect(res.status).toBe(201);
    });

    test("a booking that only touches the block's edge does not conflict", async () => {
      const { artist, service } = await seedBase(prisma);
      await book(artist.id, service.id, "09:00", "10:00");
      await book(artist.id, service.id, "12:00", "13:00");
      const res = await call("POST", "/admin/blocked-slots", slotBody("10:00", "12:00"));
      expect(res.status).toBe(201);
    });

    test("an artist block only conflicts with that artist's bookings; a studio block with everyone's", async () => {
      const { artist, otherArtist, service } = await seedBase(prisma);
      await book(otherArtist.id, service.id, "10:00", "11:30");

      const forArtist = await call(
        "POST",
        "/admin/blocked-slots",
        slotBody("10:00", "12:00", { artist_id: artist.id }),
      );
      expect(forArtist.status).toBe(201);

      const forStudio = await call("POST", "/admin/blocked-slots", slotBody("10:00", "12:00"));
      expect(forStudio.status).toBe(409);
    });

    test("POST /check previews the conflicts without saving anything", async () => {
      const { artist, service } = await seedBase(prisma);
      const clear = await json<{ can_block: boolean; conflicts: unknown[] }>(
        await call("POST", "/admin/blocked-slots/check", slotBody("10:00", "12:00")),
      );
      expect(clear).toEqual({ can_block: true, conflicts: [] });

      await book(artist.id, service.id, "10:00", "11:30");
      const blocked = await json<{ can_block: boolean; conflicts: AffectedBody[] }>(
        await call("POST", "/admin/blocked-slots/check", slotBody("10:00", "12:00", { acknowledge_conflicts: true })),
      );
      expect(blocked.can_block).toBe(false);
      expect(blocked.conflicts).toHaveLength(1);
      expect(await prisma.blockedSlot.count()).toBe(0);
    });

    test("POST /check validates its input like the create endpoint", async () => {
      expect((await call("POST", "/admin/blocked-slots/check", slotBody("12:00", "10:00"))).status).toBe(422);
    });
  });

  describe("blocked slots: concurrency", () => {
    test("concurrent block requests are serialized and all succeed", async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => call("POST", "/admin/blocked-slots", slotBody(`0${i}:00`, `0${i}:30`))),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
      expect(await prisma.blockedSlot.count()).toBe(6);
    });

    test("creating a block waits for the schedule advisory lock (shared with booking creation)", async () => {
      const release = deferred();
      const holding = deferred();

      // Another transaction (standing in for a booking being created) holds the lock.
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
      const request = call("POST", "/admin/blocked-slots", slotBody("10:00", "11:00")).then((res) => {
        finished = true;
        return res;
      });

      await Bun.sleep(400);
      expect(finished).toBe(false);
      expect(await prisma.blockedSlot.count()).toBe(0);

      release.resolve();
      await holder;
      expect((await request).status).toBe(201);
      expect(await prisma.blockedSlot.count()).toBe(1);
    });
  });

  describe("blocked slots: listing and deleting", () => {
    test("GET lists blocks overlapping the date range, ordered by start", async () => {
      await prisma.blockedSlot.createMany({
        data: [
          { startAt: new Date("2026-11-12T03:00:00Z"), endAt: new Date("2026-11-12T05:00:00Z"), reason: "c" },
          { startAt: new Date("2026-11-10T03:00:00Z"), endAt: new Date("2026-11-10T05:00:00Z"), reason: "a" },
          { startAt: new Date("2026-11-20T03:00:00Z"), endAt: new Date("2026-11-20T05:00:00Z"), reason: "far" },
          // 23:00 to 01:00 WIB across the date boundary of 11 to 12 November
          { startAt: new Date("2026-11-11T16:00:00Z"), endAt: new Date("2026-11-11T18:00:00Z"), reason: "b" },
        ],
      });
      const all = await json<SlotBody[]>(await call("GET", "/admin/blocked-slots"));
      expect(all.map((s) => s.reason)).toEqual(["a", "b", "c", "far"]);

      const ranged = await json<SlotBody[]>(
        await call("GET", "/admin/blocked-slots?date_from=2026-11-10&date_to=2026-11-12"),
      );
      expect(ranged.map((s) => s.reason)).toEqual(["a", "b", "c"]);

      const one = await json<SlotBody[]>(
        await call("GET", "/admin/blocked-slots?date_from=2026-11-11&date_to=2026-11-11"),
      );
      expect(one.map((s) => s.reason)).toEqual(["b"]);
    });

    test("GET rejects reversed or malformed dates with 422", async () => {
      expect((await call("GET", "/admin/blocked-slots?date_from=2026-11-12&date_to=2026-11-10")).status).toBe(422);
      expect((await call("GET", "/admin/blocked-slots?date_from=nope")).status).toBe(422);
    });

    test("DELETE removes a block (204) and 404s for an unknown one; a bad id is 422", async () => {
      const created = await json<SlotBody>(await call("POST", "/admin/blocked-slots", slotBody("10:00", "11:00")));
      expect((await call("DELETE", `/admin/blocked-slots/${created.id}`)).status).toBe(204);
      expect(await prisma.blockedSlot.count()).toBe(0);
      expect((await call("DELETE", `/admin/blocked-slots/${created.id}`)).status).toBe(404);
      expect((await call("DELETE", "/admin/blocked-slots/not-a-uuid")).status).toBe(422);
    });

    test("deleting a block leaves existing bookings untouched", async () => {
      const { artist, service } = await seedBase(prisma);
      await book(artist.id, service.id, "10:00", "11:30");
      const created = await json<SlotBody>(
        await call("POST", "/admin/blocked-slots", slotBody("09:00", "12:00", { acknowledge_conflicts: true })),
      );
      await call("DELETE", `/admin/blocked-slots/${created.id}`);
      expect(await prisma.booking.count({ where: { status: "pending" } })).toBe(1);
    });
  });
});
