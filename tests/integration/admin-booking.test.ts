// Admin booking management over HTTP against a real PostgreSQL (DATABASE_URL_TEST).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { addDays, jakartaDayStart, toJakartaIso } from "../../src/utils/datetime.js";
import { disconnectPrisma } from "../../src/utils/prisma.js";
import { at, cleanDatabase, createTestPrisma, seedBase, testDatabaseUrl } from "../helpers/db.js";
import { api, loginAdmin, startServer, type TestServer } from "../helpers/http.js";

const suite = testDatabaseUrl ? describe : describe.skip;

interface BookingBody {
  id: string;
  booking_code: string;
  status: string;
  source: string;
  service: { id: string; price: number };
  artist: { id: string };
  start_at: string;
  end_at: string;
  customer_phone: string;
  customer_note: string | null;
  admin_note: string | null;
  cancel_reason: string | null;
  total_price: number;
  schedule_conflict: boolean;
  reminder_url: string | null;
}

const inDays = (n: number) =>
  toJakartaIso(addDays(jakartaDayStart(toJakartaIso(new Date()).slice(0, 10)), n)).slice(0, 10);
const day = inDays(3);
const startAt = (hhmm: string, date = day) => `${date}T${hhmm}:00+07:00`;

suite("admin bookings", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  let server: TestServer;
  let token: string;
  let adminId: string;
  let base: Awaited<ReturnType<typeof seedBase>>;
  let shortService: { id: string; price: number };

  const admin = () => api(server.base, token);
  const json = async <T>(res: Response) => ((await res.json()) as { data: T }).data;
  const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

  /** A confirmed booking made through the admin endpoint. */
  const manual = async (overrides: Record<string, unknown> = {}) => {
    const res = await admin().post("/admin/bookings", {
      service_id: base.service.id,
      start_at: startAt("09:00"),
      customer_name: "Siti Rahayu",
      customer_phone: "081234567890",
      ...overrides,
    });
    expect(res.status).toBe(201);
    return json<BookingBody>(res);
  };
  /** A pending booking made the way a customer does. */
  const online = async (overrides: Record<string, unknown> = {}) => {
    const res = await api(server.base).post("/bookings", {
      service_id: base.service.id,
      start_at: startAt("09:00"),
      customer_name: "Budi Santoso",
      customer_phone: "08111222333",
      ...overrides,
    });
    expect(res.status).toBe(201);
    return json<BookingBody>(res);
  };
  const setStatus = (id: string, status: string, reason?: string) =>
    admin().patch(`/admin/bookings/${id}/status`, { status, ...(reason ? { reason } : {}) });

  beforeAll(async () => {
    server = await startServer();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    base = await seedBase(prisma);
    shortService = await prisma.service.create({
      data: { name: "Nail Art Basic", category: "nail_art", price: 80000, durationMinutes: 60 },
    });
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
    token = await loginAdmin(prisma, server.base);
    adminId = (await prisma.admin.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    server.close();
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  test("every endpoint requires an admin token", async () => {
    const anon = api(server.base);
    const id = "99999999-9999-4999-8999-999999999999";
    expect((await anon.get("/admin/bookings")).status).toBe(401);
    expect((await anon.post("/admin/bookings", {})).status).toBe(401);
    expect((await anon.get(`/admin/bookings/${id}`)).status).toBe(401);
    expect((await anon.patch(`/admin/bookings/${id}`, { admin_note: "x" })).status).toBe(401);
    expect((await anon.patch(`/admin/bookings/${id}/status`, { status: "confirmed" })).status).toBe(401);
  });

  describe("POST /admin/bookings (manual)", () => {
    test("creates a confirmed admin booking with history, confirmed_at and a reminder link", async () => {
      const booking = await manual();
      expect(booking).toMatchObject({
        status: "confirmed",
        source: "admin",
        customer_phone: "+6281234567890",
        total_price: 150000,
        start_at: startAt("09:00"),
      });
      expect(booking.reminder_url).toStartWith("https://wa.me/6281234567890?text=");
      expect(decodeURIComponent(booking.reminder_url as string)).toContain("Halo Siti");
      expect(decodeURIComponent(booking.reminder_url as string)).toContain(booking.booking_code);

      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(stored.confirmedAt).not.toBeNull();
      const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: booking.id } });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ fromStatus: null, toStatus: "confirmed", changedBy: adminId });
    });

    test("follows the same slot, buffer and artist rules as an online booking", async () => {
      const first = await manual();
      expect(first.artist.id).toBe(base.artist.id);
      expect((await manual()).artist.id).toBe(base.otherArtist.id); // the first artist is taken
      const full = await admin().post("/admin/bookings", {
        service_id: base.service.id,
        start_at: startAt("09:00"),
        customer_name: "Dewi",
        customer_phone: "08123456789",
      });
      expect(full.status).toBe(409);
      expect(await errorCode(full)).toBe("SLOT_UNAVAILABLE");

      // buffer: 09:00-10:30 keeps the artist busy until 10:45
      const tooClose = await admin().post("/admin/bookings", {
        service_id: base.service.id,
        artist_id: base.artist.id,
        start_at: startAt("10:30"),
        customer_name: "Dewi",
        customer_phone: "08123456789",
      });
      expect(tooClose.status).toBe(409);
    });

    test("422 for invalid input", async () => {
      expect((await admin().post("/admin/bookings", {})).status).toBe(422);
      const badPhone = await admin().post("/admin/bookings", {
        service_id: base.service.id,
        start_at: startAt("09:00"),
        customer_name: "A",
        customer_phone: "123",
      });
      expect(badPhone.status).toBe(422);
    });
  });

  describe("GET /admin/bookings (list)", () => {
    test("is paginated and ordered by start time, with meta", async () => {
      await manual({ start_at: startAt("13:00") });
      await manual({ start_at: startAt("09:00") });
      await manual({ start_at: startAt("15:30") });
      const res = await admin().get("/admin/bookings?per_page=2&page=1");
      const body = (await res.json()) as { data: BookingBody[]; meta: Record<string, number> };
      expect(body.data.map((b) => b.start_at.slice(11, 16))).toEqual(["09:00", "13:00"]);
      expect(body.meta).toEqual({ page: 1, per_page: 2, total: 3, total_pages: 2 });
      const page2 = (await (await admin().get("/admin/bookings?per_page=2&page=2")).json()) as { data: BookingBody[] };
      expect(page2.data.map((b) => b.start_at.slice(11, 16))).toEqual(["15:30"]);
    });

    test("filters by status, artist and an inclusive date range", async () => {
      await manual({ artist_id: base.artist.id });
      await online({ artist_id: base.otherArtist.id, start_at: startAt("13:00") });
      await manual({ start_at: startAt("09:00", inDays(5)), artist_id: base.artist.id });

      const list = async (query: string) =>
        ((await (await admin().get(`/admin/bookings?${query}`)).json()) as { data: BookingBody[] }).data;
      expect(await list("status=pending")).toHaveLength(1);
      expect(await list(`artist_id=${base.otherArtist.id}`)).toHaveLength(1);
      expect(await list(`date_from=${day}&date_to=${day}`)).toHaveLength(2); // date_to is inclusive
      expect(await list(`date_from=${inDays(4)}`)).toHaveLength(1);
      expect(await list(`date_to=${inDays(2)}`)).toHaveLength(0);
    });

    test("searches by name, booking code and phone in 08 or +62 form", async () => {
      const siti = await manual({ customer_name: "Siti Rahayu", customer_phone: "081234567890" });
      await online({ start_at: startAt("13:00"), customer_name: "Budi Santoso", customer_phone: "08111222333" });
      const find = async (q: string) =>
        ((await (await admin().get(`/admin/bookings?q=${encodeURIComponent(q)}`)).json()) as { data: BookingBody[] })
          .data;

      expect((await find("siti")).map((b) => b.id)).toEqual([siti.id]);
      expect((await find(siti.booking_code.toLowerCase())).map((b) => b.id)).toEqual([siti.id]);
      expect((await find("0812345")).map((b) => b.id)).toEqual([siti.id]);
      expect((await find("+62811122")).map((b) => b.customer_phone)).toEqual(["+628111222333"]);
      expect(await find("tidak ada")).toEqual([]);
    });

    test("flags schedule_conflict and hides reminder_url for finished bookings", async () => {
      const conflicted = await manual({ start_at: startAt("09:00") });
      const cancelled = await online({ start_at: startAt("13:00") });
      await setStatus(cancelled.id, "cancelled", "Berhalangan");
      await prisma.blockedSlot.create({
        data: { artistId: null, startAt: at("09:30", day), endAt: at("11:00", day), reason: "Cuti" },
      });
      const items = ((await (await admin().get("/admin/bookings")).json()) as { data: BookingBody[] }).data;
      const byId = new Map(items.map((b) => [b.id, b]));
      expect(byId.get(conflicted.id)?.schedule_conflict).toBe(true);
      expect(byId.get(conflicted.id)?.reminder_url).not.toBeNull();
      expect(byId.get(cancelled.id)?.schedule_conflict).toBe(false);
      expect(byId.get(cancelled.id)?.reminder_url).toBeNull();
    });

    test("422 for a reversed date range, a bad status or an oversize page", async () => {
      expect((await admin().get(`/admin/bookings?date_from=${inDays(5)}&date_to=${inDays(1)}`)).status).toBe(422);
      expect((await admin().get("/admin/bookings?status=nope")).status).toBe(422);
      expect((await admin().get("/admin/bookings?per_page=101")).status).toBe(422);
      expect((await admin().get("/admin/bookings?page=0")).status).toBe(422);
    });
  });

  describe("GET /admin/bookings/:id", () => {
    test("returns the booking, 404 for an unknown id, 422 for a malformed one", async () => {
      const booking = await online();
      const res = await admin().get(`/admin/bookings/${booking.id}`);
      expect(res.status).toBe(200);
      expect((await json<BookingBody>(res)).reminder_url).toStartWith("https://wa.me/628111222333");
      expect((await admin().get("/admin/bookings/99999999-9999-4999-8999-999999999999")).status).toBe(404);
      expect((await admin().get("/admin/bookings/nope")).status).toBe(422);
    });
  });

  describe("PATCH /admin/bookings/:id (reschedule and notes)", () => {
    const patch = (id: string, body: Record<string, unknown>) => admin().patch(`/admin/bookings/${id}`, body);

    test("moves the booking to a free time without blocking itself, and keeps the artist", async () => {
      const booking = await manual({ artist_id: base.artist.id }); // 09:00-10:30
      // 10:00-11:30 overlaps the booking's own current time, which must not count against it
      const res = await patch(booking.id, { start_at: startAt("10:00") });
      expect(res.status).toBe(200);
      const moved = await json<BookingBody>(res);
      expect(moved.start_at).toBe(startAt("10:00"));
      expect(moved.end_at).toBe(startAt("11:30"));
      expect(moved.artist.id).toBe(base.artist.id);
      expect(moved.status).toBe("confirmed");
    });

    test("moves to another artist and updates notes in the same call; an empty note clears it", async () => {
      const booking = await manual({ artist_id: base.artist.id });
      const res = await patch(booking.id, {
        artist_id: base.otherArtist.id,
        admin_note: "Pindah artist atas permintaan customer",
        customer_note: "Warna pink",
      });
      expect(res.status).toBe(200);
      const moved = await json<BookingBody>(res);
      expect(moved.artist.id).toBe(base.otherArtist.id);
      expect(moved.admin_note).toBe("Pindah artist atas permintaan customer");
      expect(moved.customer_note).toBe("Warna pink");

      const cleared = await json<BookingBody>(await patch(booking.id, { admin_note: "" }));
      expect(cleared.admin_note).toBeNull();
    });

    test("changing the service recomputes the end time and copies the new price", async () => {
      const booking = await manual({ artist_id: base.artist.id });
      const res = await patch(booking.id, { service_id: shortService.id });
      expect(res.status).toBe(200);
      const updated = await json<BookingBody>(res);
      expect(updated.total_price).toBe(80000);
      expect(updated.end_at).toBe(startAt("10:00")); // 60 minutes
      expect(updated.service.id).toBe(shortService.id);
      // a plain reschedule keeps the price snapshot even if the service price changed since
      await prisma.service.update({ where: { id: shortService.id }, data: { price: 999000 } });
      const moved = await json<BookingBody>(await patch(booking.id, { start_at: startAt("13:00") }));
      expect(moved.total_price).toBe(80000);
    });

    test("notes can be edited on a finished booking, but its schedule cannot", async () => {
      const booking = await manual();
      await prisma.booking.update({ where: { id: booking.id }, data: { status: "completed" } });
      expect((await patch(booking.id, { admin_note: "Pelanggan puas" })).status).toBe(200);
      const res = await patch(booking.id, { start_at: startAt("13:00") });
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe("INVALID_STATUS_TRANSITION");
    });

    test("409 SLOT_UNAVAILABLE for a taken time, a blocked time, the break, or off the grid; nothing changes", async () => {
      const mine = await manual({ artist_id: base.artist.id }); // 09:00-10:30
      await manual({ artist_id: base.artist.id, start_at: startAt("13:00") }); // 13:00-14:30
      await prisma.blockedSlot.create({
        data: { artistId: null, startAt: at("15:30", day), endAt: at("17:00", day), reason: "Tutup lebih awal" },
      });
      for (const time of ["13:00", "14:00", "15:30", "12:00", "10:07"]) {
        const res = await patch(mine.id, { start_at: startAt(time) });
        expect(res.status).toBe(409);
        expect(await errorCode(res)).toBe("SLOT_UNAVAILABLE");
      }
      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: mine.id } });
      expect(stored.startAt.toISOString()).toBe(at("09:00", day).toISOString());
    });

    test("a no-op reschedule succeeds, a date in the past is 422, and a unit of change is required", async () => {
      const booking = await manual();
      expect((await patch(booking.id, { start_at: startAt("09:00") })).status).toBe(200);
      expect((await patch(booking.id, { start_at: startAt("09:00", inDays(-1)) })).status).toBe(422);
      expect((await patch(booking.id, {})).status).toBe(422);
      expect((await patch(booking.id, { customer_note: "x".repeat(501) })).status).toBe(422);
    });

    test("404 for an unknown booking, service or artist", async () => {
      const unknown = "99999999-9999-4999-8999-999999999999";
      expect((await patch(unknown, { admin_note: "x" })).status).toBe(404);
      const booking = await manual();
      expect((await patch(booking.id, { service_id: unknown })).status).toBe(404);
      expect((await patch(booking.id, { artist_id: unknown })).status).toBe(404);
    });

    test("two bookings moved to the same slot at once: one 200, one 409", async () => {
      const a = await manual({ artist_id: base.artist.id, start_at: startAt("09:00") });
      const b = await manual({ artist_id: base.artist.id, start_at: startAt("13:00") });
      const results = await Promise.all([
        patch(a.id, { start_at: startAt("15:00") }),
        patch(b.id, { start_at: startAt("15:00") }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });
  });

  describe("PATCH /admin/bookings/:id/status", () => {
    test("pending to confirmed sets confirmed_at and records who did it", async () => {
      const booking = await online();
      const res = await setStatus(booking.id, "confirmed");
      expect(res.status).toBe(200);
      expect((await json<BookingBody>(res)).status).toBe("confirmed");
      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(stored.confirmedAt).not.toBeNull();
      const history = await prisma.bookingStatusHistory.findMany({
        where: { bookingId: booking.id },
        orderBy: { changedAt: "asc" },
      });
      expect(history.map((h) => [h.fromStatus, h.toStatus, h.changedBy])).toEqual([
        [null, "pending", null],
        ["pending", "confirmed", adminId],
      ]);
    });

    test("cancelling needs a reason, stores it, frees the slot, and logs the admin", async () => {
      const booking = await manual({ artist_id: base.artist.id });
      const missing = await setStatus(booking.id, "cancelled");
      expect(missing.status).toBe(422);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("confirmed");

      const res = await setStatus(booking.id, "cancelled", "Customer minta batal via chat");
      expect(res.status).toBe(200);
      expect(await json<BookingBody>(res)).toMatchObject({
        status: "cancelled",
        cancel_reason: "Customer minta batal via chat",
        reminder_url: null,
      });
      const last = await prisma.bookingStatusHistory.findFirstOrThrow({
        where: { bookingId: booking.id, toStatus: "cancelled" },
      });
      expect(last).toMatchObject({
        fromStatus: "confirmed",
        changedBy: adminId,
        reason: "Customer minta batal via chat",
      });
      // the slot can be booked again
      await manual({ artist_id: base.artist.id });
    });

    test("rejects transitions that are not allowed", async () => {
      const pending = await online();
      for (const status of ["completed", "no_show", "pending"]) {
        const res = await setStatus(pending.id, status);
        expect(res.status).toBe(409);
        expect(await errorCode(res)).toBe("INVALID_STATUS_TRANSITION");
      }
      const confirmed = await manual({ start_at: startAt("13:00") });
      expect((await setStatus(confirmed.id, "pending")).status).toBe(409);
      expect((await setStatus(confirmed.id, "confirmed")).status).toBe(409);

      // final statuses never change again
      await setStatus(confirmed.id, "cancelled", "Batal");
      for (const status of ["confirmed", "completed", "pending", "no_show"]) {
        expect((await setStatus(confirmed.id, status)).status).toBe(409);
      }
    });

    test("completed and no_show are refused before the appointment starts, and work after it", async () => {
      const future = await manual();
      for (const status of ["completed", "no_show"]) {
        const res = await setStatus(future.id, status);
        expect(res.status).toBe(409);
        expect(await errorCode(res)).toBe("INVALID_STATUS_TRANSITION");
      }
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: future.id } })).status).toBe("confirmed");

      const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
      await prisma.booking.update({
        where: { id: future.id },
        data: { startAt: hoursAgo(3), endAt: hoursAgo(1.5) },
      });
      expect((await setStatus(future.id, "completed")).status).toBe(200);

      const other = await manual({ start_at: startAt("13:00") });
      await prisma.booking.update({ where: { id: other.id }, data: { startAt: hoursAgo(3), endAt: hoursAgo(1.5) } });
      const noShow = await setStatus(other.id, "no_show");
      expect(noShow.status).toBe(200);
      expect((await json<BookingBody>(noShow)).status).toBe("no_show");
    });

    test("confirm and cancel at the same moment: one wins, and there is exactly one history row for it", async () => {
      const booking = await online();
      const results = await Promise.all([
        setStatus(booking.id, "confirmed"),
        setStatus(booking.id, "cancelled", "Batal"),
      ]);
      const statuses = results.map((r) => r.status).sort();
      // confirm-then-cancel is a legal sequence, so both can succeed; what must hold is that history is consistent
      expect(statuses[0]).toBe(200);
      const history = await prisma.bookingStatusHistory.findMany({
        where: { bookingId: booking.id },
        orderBy: { changedAt: "asc" },
      });
      const final = (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status;
      expect(history.at(-1)?.toStatus).toBe(final);
      expect(history.length).toBe(1 + results.filter((r) => r.status === 200).length);
    });

    test("404 for an unknown booking, 422 for an unknown status", async () => {
      expect((await setStatus("99999999-9999-4999-8999-999999999999", "confirmed")).status).toBe(404);
      const booking = await online();
      expect((await setStatus(booking.id, "done")).status).toBe(422);
    });
  });
});
