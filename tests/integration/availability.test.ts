// GET /availability over HTTP against a real PostgreSQL (DATABASE_URL_TEST).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { addDays, jakartaDayStart, toJakartaIso } from "../../src/utils/datetime.js";
import { disconnectPrisma } from "../../src/utils/prisma.js";
import { at, bookingData, cleanDatabase, createTestPrisma, seedBase, testDatabaseUrl } from "../helpers/db.js";
import { api, startServer, type TestServer } from "../helpers/http.js";

const suite = testDatabaseUrl ? describe : describe.skip;

interface SlotBody {
  start_at: string;
  end_at: string;
  available_artist_ids: string[];
}

/** A date inside the booking window, in WIB, so the test does not depend on the calendar day it runs. */
const day = toJakartaIso(addDays(jakartaDayStart(toJakartaIso(new Date()).slice(0, 10)), 3)).slice(0, 10);

suite("availability", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  let server: TestServer;
  let base: Awaited<ReturnType<typeof seedBase>>;

  const get = (query: string) => api(server.base).get(`/availability?${query}`);
  const slots = async (query: string) =>
    ((await (await get(query)).json()) as { data: { slots: SlotBody[] } }).data.slots;

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

  test("returns slots on the step grid outside the break, with both artists", async () => {
    const res = await get(`service_id=${base.service.id}&date=${day}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { date: string; service_id: string; slots: SlotBody[] } };
    expect(body.data.date).toBe(day);
    expect(body.data.service_id).toBe(base.service.id);
    const first = body.data.slots[0];
    expect(first?.start_at).toBe(`${day}T09:00:00+07:00`);
    expect(first?.end_at).toBe(`${day}T10:30:00+07:00`); // 90 minute service
    expect(first?.available_artist_ids.sort()).toEqual([base.artist.id, base.otherArtist.id].sort());
    const starts = body.data.slots.map((s) => s.start_at.slice(11, 16));
    expect(starts).toContain("10:30"); // ends exactly at the break
    expect(starts).not.toContain("11:00");
    expect(starts).not.toContain("12:30");
    expect(starts).toContain("13:00");
    expect(starts.at(-1)).toBe("15:30"); // 15:30 + 90 min = 17:00
  });

  test("a pending booking removes the slot for that artist only; a cancelled one does not", async () => {
    await prisma.booking.create({
      data: {
        ...bookingData({ serviceId: base.service.id, artistId: base.artist.id, start: "09:00", end: "10:30" }),
        startAt: at("09:00", day),
        endAt: at("10:30", day),
      },
    });
    await prisma.booking.create({
      data: {
        ...bookingData({
          serviceId: base.service.id,
          artistId: base.otherArtist.id,
          start: "09:00",
          end: "10:30",
          status: "cancelled",
        }),
        startAt: at("09:00", day),
        endAt: at("10:30", day),
      },
    });
    const first = (await slots(`service_id=${base.service.id}&date=${day}`)).find((s) => s.start_at.includes("T09:00"));
    expect(first?.available_artist_ids).toEqual([base.otherArtist.id]);

    const onlyBusy = await slots(`service_id=${base.service.id}&date=${day}&artist_id=${base.artist.id}`);
    expect(onlyBusy.some((s) => s.start_at.includes("T09:00"))).toBe(false);
    // the booking ends 10:30 and the 15 minute buffer keeps the artist busy until 10:45
    expect(onlyBusy.some((s) => s.start_at.includes("T10:30"))).toBe(false);
    // 11:00-12:30 would run into the break, so the next slot is after it
    expect(onlyBusy.some((s) => s.start_at.includes("T13:00"))).toBe(true);
  });

  test("a studio-wide blocked slot removes the overlapping slots for everyone", async () => {
    await prisma.blockedSlot.create({
      data: { artistId: null, startAt: at("13:00", day), endAt: at("15:00", day), reason: "Libur" },
    });
    const starts = (await slots(`service_id=${base.service.id}&date=${day}`)).map((s) => s.start_at.slice(11, 16));
    expect(starts).not.toContain("13:00");
    expect(starts).not.toContain("14:30");
    expect(starts).toContain("15:00");
  });

  test("a closed day has no slots", async () => {
    await prisma.businessHour.updateMany({
      data: { isOpen: false, openTime: null, closeTime: null, breakStart: null, breakEnd: null },
    });
    expect(await slots(`service_id=${base.service.id}&date=${day}`)).toEqual([]);
  });

  test("422 for a missing, malformed, past, or too distant date and for a bad service_id", async () => {
    const id = base.service.id;
    expect((await get(`service_id=${id}`)).status).toBe(422);
    expect((await get(`service_id=${id}&date=10-11-2026`)).status).toBe(422);
    expect((await get(`service_id=${id}&date=2026-02-30`)).status).toBe(422);
    expect((await get(`service_id=${id}&date=2020-01-01`)).status).toBe(422);
    expect((await get(`service_id=${id}&date=2999-01-01`)).status).toBe(422);
    expect((await get(`service_id=not-a-uuid&date=${day}`)).status).toBe(422);
    const body = (await (await get(`service_id=${id}&date=2020-01-01`)).json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("404 for an unknown or inactive service or artist", async () => {
    const unknown = "99999999-9999-4999-8999-999999999999";
    expect((await get(`service_id=${unknown}&date=${day}`)).status).toBe(404);
    await prisma.service.update({ where: { id: base.service.id }, data: { isActive: false } });
    expect((await get(`service_id=${base.service.id}&date=${day}`)).status).toBe(404);
    await prisma.service.update({ where: { id: base.service.id }, data: { isActive: true } });
    expect((await get(`service_id=${base.service.id}&date=${day}&artist_id=${unknown}`)).status).toBe(404);
    await prisma.artist.update({ where: { id: base.artist.id }, data: { isActive: false } });
    expect((await get(`service_id=${base.service.id}&date=${day}&artist_id=${base.artist.id}`)).status).toBe(404);
  });
});
