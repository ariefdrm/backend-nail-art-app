// CSV export over HTTP against a real PostgreSQL (DATABASE_URL_TEST).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { disconnectPrisma } from "../../src/utils/prisma.js";
import { at, bookingData, cleanDatabase, createTestPrisma, seedBase, testDatabaseUrl } from "../helpers/db.js";
import { api, loginAdmin, startServer, type TestServer } from "../helpers/http.js";

const suite = testDatabaseUrl ? describe : describe.skip;

const D = "2026-03-10";
const D1 = "2026-03-11";
const D2 = "2026-03-12";

/** Minimal RFC 4180 reader: enough to check quoting, which is the part that can go wrong. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else cell += char;
  }
  return rows;
}

suite("CSV export", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  let server: TestServer;
  let token: string;
  let adminId: string;
  let base: Awaited<ReturnType<typeof seedBase>>;

  const admin = () => api(server.base, token);
  const download = async (query = "") => {
    const res = await admin().get(`/admin/export/bookings.csv${query}`);
    expect(res.status).toBe(200);
    const rows = parseCsv(await res.text());
    const header = rows[0] as string[];
    const records = rows.slice(1).map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i]])));
    return { res, header, records };
  };

  const add = (input: {
    day: string;
    start: string;
    end: string;
    status?: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
    phone?: string;
    artistId?: string;
    extra?: Record<string, unknown>;
  }) =>
    prisma.booking.create({
      data: {
        ...bookingData({
          serviceId: base.service.id,
          artistId: input.artistId ?? base.artist.id,
          start: input.start,
          end: input.end,
          status: input.status ?? "completed",
        }),
        startAt: at(input.start, input.day),
        endAt: at(input.end, input.day),
        ...(input.phone ? { customerPhone: input.phone } : {}),
        ...input.extra,
      },
    });

  beforeAll(async () => {
    server = await startServer();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    base = await seedBase(prisma);
    token = await loginAdmin(prisma, server.base);
    adminId = (await prisma.admin.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    server.close();
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  test("only a signed-in owner may download it", async () => {
    expect((await api(server.base).get("/admin/export/bookings.csv")).status).toBe(401);
    const staff = await loginAdmin(prisma, server.base, "staff@nailpalace.test", "staff");
    const res = await api(server.base, staff).get("/admin/export/bookings.csv");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });

  test("is sent as a CSV download that is not cached", async () => {
    const res = await admin().get(`/admin/export/bookings.csv?date_from=${D}&date_to=${D1}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="bookings_${D}_${D1}.csv"`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toStartWith("booking_id,status,source,");
  });

  test("an empty database gives just the header row", async () => {
    const { header, records } = await download();
    expect(header).toHaveLength(21);
    expect(records).toEqual([]);
  });

  test("writes one row per booking in start order, with the derived columns", async () => {
    const later = await add({ day: D1, start: "09:00", end: "10:30", extra: { status: "no_show" } });
    const earlier = await add({
      day: D,
      start: "13:00",
      end: "14:30",
      extra: { createdAt: at("08:00", D), confirmedAt: at("08:20", D), referenceImageUrl: "https://x.test/a.png" },
    });
    const { records } = await download();
    expect(records.map((r) => r["booking_id"])).toEqual([earlier.id, later.id]);
    expect(records[0]).toMatchObject({
      status: "completed",
      source: "online",
      service_name: "Gel Polish",
      service_category: "gel_polish",
      duration_minutes: "90",
      total_price: "150000",
      start_at: `${D}T13:00:00+07:00`,
      end_at: `${D}T14:30:00+07:00`,
      created_at: `${D}T08:00:00+07:00`,
      confirmed_at: `${D}T08:20:00+07:00`,
      lead_time_hours: "5",
      confirmation_minutes: "20",
      has_reference_image: "true",
      has_customer_note: "false",
      cancelled_by: "",
    });
    expect(records[1]).toMatchObject({ status: "no_show", confirmed_at: "", confirmation_minutes: "" });
  });

  test("contains no personal data, and links a customer's bookings through customer_ref", async () => {
    await add({
      day: D,
      start: "09:00",
      end: "10:30",
      phone: "+6281234567890",
      extra: { customerNote: "Warna pink ya" },
    });
    await add({ day: D, start: "11:00", end: "12:30", phone: "+6281234567890" });
    await add({ day: D, start: "13:00", end: "14:30", phone: "+6289999999999" });
    const res = await admin().get("/admin/export/bookings.csv");
    const text = await res.text();
    for (const secret of ["81234567890", "89999999999", "Siti", "pink", "NP-"]) expect(text).not.toContain(secret);

    const refs = parseCsv(text)
      .slice(1)
      .map((cells) => cells[17]);
    expect(refs[0]).toMatch(/^[0-9a-f]{16}$/);
    expect(refs[0]).toBe(refs[1]);
    expect(refs[0]).not.toBe(refs[2]);
  });

  test("filters by an inclusive range of Jakarta days and by status", async () => {
    await add({ day: D, start: "00:00", end: "01:00" }); // 00:00 WIB is 17:00 UTC the day before
    await add({ day: D1, start: "23:00", end: "23:45", status: "no_show" });
    await add({ day: D2, start: "00:00", end: "01:00" });
    await add({ day: "2026-03-09", start: "23:00", end: "23:45" });

    expect((await download()).records).toHaveLength(4);
    expect((await download(`?date_from=${D}&date_to=${D1}`)).records).toHaveLength(2);
    expect((await download(`?date_from=${D2}`)).records).toHaveLength(1);
    expect((await download(`?date_to=${D}`)).records).toHaveLength(2);
    const noShows = (await download("?status=no_show")).records;
    expect(noShows.map((r) => r["status"])).toEqual(["no_show"]);
  });

  test("records who cancelled and how many times the status changed", async () => {
    const byCustomer = await add({ day: D, start: "09:00", end: "10:30", status: "pending" });
    const byAdmin = await add({ day: D, start: "11:00", end: "12:30", status: "confirmed" });
    await prisma.booking.update({ where: { id: byCustomer.id }, data: { status: "cancelled" } });
    await prisma.bookingStatusHistory.createMany({
      data: [
        { bookingId: byCustomer.id, fromStatus: null, toStatus: "pending", changedBy: null, changedAt: at("08:00", D) },
        {
          bookingId: byCustomer.id,
          fromStatus: "pending",
          toStatus: "cancelled",
          changedBy: null,
          changedAt: at("09:00", D),
        },
        { bookingId: byAdmin.id, fromStatus: null, toStatus: "pending", changedBy: null, changedAt: at("08:00", D) },
        {
          bookingId: byAdmin.id,
          fromStatus: "pending",
          toStatus: "confirmed",
          changedBy: adminId,
          changedAt: at("08:30", D),
        },
        {
          bookingId: byAdmin.id,
          fromStatus: "confirmed",
          toStatus: "cancelled",
          changedBy: adminId,
          changedAt: at("09:30", D),
        },
      ],
    });
    await prisma.booking.update({ where: { id: byAdmin.id }, data: { status: "cancelled" } });

    const { records } = await download();
    const byId = new Map(records.map((r) => [r["booking_id"], r]));
    expect(byId.get(byCustomer.id)).toMatchObject({
      cancelled_by: "customer",
      status_changes: "1",
      last_status_change_at: `${D}T09:00:00+07:00`,
    });
    expect(byId.get(byAdmin.id)).toMatchObject({
      cancelled_by: "admin",
      status_changes: "2",
      last_status_change_at: `${D}T09:30:00+07:00`,
    });
  });

  test("a spreadsheet formula in a service name is defused and quoting survives a round trip", async () => {
    const tricky = await prisma.service.create({
      data: { name: '=HYPERLINK("http://evil.test","x"),y', category: "x", price: 1000, durationMinutes: 30 },
    });
    await prisma.booking.create({
      data: {
        ...bookingData({
          serviceId: tricky.id,
          artistId: base.artist.id,
          start: "09:00",
          end: "09:30",
          status: "completed",
        }),
        startAt: at("09:00", D),
        endAt: at("09:30", D),
      },
    });
    const { records } = await download();
    expect(records[0]?.["service_name"]).toBe(`'=HYPERLINK("http://evil.test","x"),y`);
  });

  test("a long export reads in batches without losing, repeating or reordering rows, even with equal start times", async () => {
    // 1,150 rows over only 10 distinct start times: every batch boundary falls inside a group of ties
    const total = 1150;
    await prisma.booking.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        ...bookingData({
          serviceId: base.service.id,
          artistId: base.artist.id,
          start: "09:00",
          end: "10:00",
          status: "completed",
        }),
        bookingCode: `NP-20260310-${String(i).padStart(4, "0")}`,
        startAt: new Date(at("09:00", D).getTime() + (i % 10) * 3_600_000),
        endAt: new Date(at("10:00", D).getTime() + (i % 10) * 3_600_000),
      })),
    });
    const { records } = await download();
    expect(records).toHaveLength(total);
    expect(new Set(records.map((r) => r["booking_id"])).size).toBe(total);
    const keys = records.map((r) => `${r["start_at"]}|${r["booking_id"]}`);
    expect(keys).toEqual([...keys].sort());
  });

  test("422 for a reversed range, a malformed date or an unknown status", async () => {
    expect((await admin().get(`/admin/export/bookings.csv?date_from=${D1}&date_to=${D}`)).status).toBe(422);
    expect((await admin().get("/admin/export/bookings.csv?date_from=nope")).status).toBe(422);
    expect((await admin().get("/admin/export/bookings.csv?status=done")).status).toBe(422);
  });
});
