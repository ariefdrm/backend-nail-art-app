// Dashboard summary over HTTP against a real PostgreSQL (DATABASE_URL_TEST).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { disconnectPrisma } from "../../src/utils/prisma.js";
import { at, bookingData, cleanDatabase, createTestPrisma, seedBase, testDatabaseUrl } from "../helpers/db.js";
import { api, loginAdmin, startServer, type TestServer } from "../helpers/http.js";

const suite = testDatabaseUrl ? describe : describe.skip;

interface Summary {
  period: { date_from: string; date_to: string };
  total_bookings: number;
  by_status: Record<string, number>;
  no_show_rate: number | null;
  online_booking_ratio: number | null;
  revenue_completed: number;
  avg_confirmation_minutes: number | null;
}

const D = "2026-03-10";
const D1 = "2026-03-11";
const D2 = "2026-03-12";

suite("dashboard summary", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  let server: TestServer;
  let token: string;
  let base: Awaited<ReturnType<typeof seedBase>>;

  const summary = async (from: string, to: string) => {
    const res = await api(server.base, token).get(`/admin/dashboard/summary?date_from=${from}&date_to=${to}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: Summary }).data;
  };

  /** Inserts a booking directly; `created`/`confirmed` are minutes after midnight WIB of its own day. */
  const add = (input: {
    day: string;
    start: string;
    end: string;
    status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
    source?: "online" | "admin";
    price?: number;
    createdAt?: Date;
    confirmedAt?: Date | null;
    artistId?: string;
  }) =>
    prisma.booking.create({
      data: {
        ...bookingData({
          serviceId: base.service.id,
          artistId: input.artistId ?? base.artist.id,
          start: input.start,
          end: input.end,
          status: input.status,
        }),
        startAt: at(input.start, input.day),
        endAt: at(input.end, input.day),
        source: input.source ?? "online",
        totalPrice: input.price ?? 150000,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        ...(input.confirmedAt !== undefined ? { confirmedAt: input.confirmedAt } : {}),
      },
    });

  beforeAll(async () => {
    server = await startServer();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    base = await seedBase(prisma);
    token = await loginAdmin(prisma, server.base);
  });

  afterAll(async () => {
    server.close();
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  test("requires an admin token", async () => {
    const res = await api(server.base).get(`/admin/dashboard/summary?date_from=${D}&date_to=${D}`);
    expect(res.status).toBe(401);
  });

  test("an empty period is zeros and nulls", async () => {
    expect(await summary(D, D1)).toEqual({
      period: { date_from: D, date_to: D1 },
      total_bookings: 0,
      by_status: { pending: 0, confirmed: 0, completed: 0, cancelled: 0, no_show: 0 },
      no_show_rate: null,
      online_booking_ratio: null,
      revenue_completed: 0,
      avg_confirmation_minutes: null,
    });
  });

  test("computes status counts, rates, revenue and the average confirmation time", async () => {
    await add({
      day: D,
      start: "09:00",
      end: "10:30",
      status: "completed",
      price: 150000,
      createdAt: at("08:00", D),
      confirmedAt: at("08:20", D), // confirmed after 20 minutes
    });
    await add({
      day: D,
      start: "11:00",
      end: "12:30",
      status: "completed",
      source: "admin",
      price: 150000,
      createdAt: at("08:00", D),
      confirmedAt: at("08:00", D), // admin booking: born confirmed, must not drag the average to 0
    });
    await add({
      day: D,
      start: "13:00",
      end: "14:30",
      status: "no_show",
      createdAt: at("10:00", D),
      confirmedAt: at("10:40", D), // 40 minutes
    });
    await add({ day: D, start: "15:00", end: "16:30", status: "cancelled", confirmedAt: null });
    await add({ day: D1, start: "16:00", end: "17:30", status: "pending", confirmedAt: null });
    await add({ day: D2, start: "09:00", end: "10:30", status: "confirmed", source: "admin" }); // outside the range

    const result = await summary(D, D1);
    expect(result.total_bookings).toBe(5);
    expect(result.by_status).toEqual({ pending: 1, confirmed: 0, completed: 2, cancelled: 1, no_show: 1 });
    expect(result.no_show_rate).toBe(0.3333); // 1 no-show / (2 completed + 1 no-show)
    expect(result.online_booking_ratio).toBe(0.8); // 4 of 5 were online
    expect(result.revenue_completed).toBe(300000);
    expect(result.avg_confirmation_minutes).toBe(30); // (20 + 40) / 2, online and confirmed only
  });

  test("days are Jakarta days: 00:00 WIB of date_from is in, 00:00 WIB after date_to is out", async () => {
    // 00:00 WIB is 17:00 UTC the previous day, so a UTC-based range would get both of these wrong
    await add({ day: D, start: "00:00", end: "01:00", status: "completed" });
    await add({ day: D1, start: "23:00", end: "23:45", status: "completed" });
    await add({ day: D2, start: "00:00", end: "01:00", status: "completed", artistId: base.otherArtist.id });
    await add({ day: "2026-03-09", start: "23:00", end: "23:45", status: "completed" });

    expect((await summary(D, D1)).by_status.completed).toBe(2);
    expect((await summary(D, D)).by_status.completed).toBe(1);
    expect((await summary(D2, D2)).by_status.completed).toBe(1);
  });

  test("no_show_rate stays null while nothing has been completed or missed", async () => {
    await add({ day: D, start: "09:00", end: "10:30", status: "pending", confirmedAt: null });
    const result = await summary(D, D);
    expect(result.no_show_rate).toBeNull();
    expect(result.online_booking_ratio).toBe(1);
    expect(result.avg_confirmation_minutes).toBeNull();
  });

  test("422 for missing dates, a reversed range or a range over 366 days", async () => {
    const client = api(server.base, token);
    expect((await client.get("/admin/dashboard/summary")).status).toBe(422);
    expect((await client.get(`/admin/dashboard/summary?date_from=${D1}&date_to=${D}`)).status).toBe(422);
    expect((await client.get(`/admin/dashboard/summary?date_from=2025-01-01&date_to=2026-03-01`)).status).toBe(422);
    expect((await client.get(`/admin/dashboard/summary?date_from=nope&date_to=${D}`)).status).toBe(422);
  });
});
