import { beforeEach, describe, expect, mock, test } from "bun:test";

const SECRET = "s".repeat(40);
const ADMIN = "55555555-5555-4555-8555-555555555555";

interface Row {
  id: string;
  status: string;
  source: string;
  serviceId: string;
  artistId: string;
  startAt: Date;
  endAt: Date;
  totalPrice: number;
  createdAt: Date;
  confirmedAt: Date | null;
  customerPhone: string;
  customerNote: string | null;
  referenceImageUrl: string | null;
  service: { name: string; category: string; durationMinutes: number };
  history: { fromStatus: string | null; toStatus: string; changedBy: string | null; changedAt: Date }[];
}

const row = (n: number, overrides: Partial<Row> = {}): Row => ({
  id: `id-${String(n).padStart(3, "0")}`,
  status: "completed",
  source: "online",
  serviceId: "svc-1",
  artistId: "art-1",
  startAt: new Date(Date.UTC(2026, 2, 10, 3, n)),
  endAt: new Date(Date.UTC(2026, 2, 10, 4, n)),
  totalPrice: 150000,
  createdAt: new Date("2026-03-08T01:00:00Z"),
  confirmedAt: new Date("2026-03-08T01:30:00Z"),
  customerPhone: "+6281234567890",
  customerNote: null,
  referenceImageUrl: null,
  service: { name: "Gel Polish", category: "gel_polish", durationMinutes: 90 },
  history: [
    { fromStatus: null, toStatus: "pending", changedBy: null, changedAt: new Date("2026-03-08T01:00:00Z") },
    { fromStatus: "pending", toStatus: "confirmed", changedBy: ADMIN, changedAt: new Date("2026-03-08T01:30:00Z") },
  ],
  ...overrides,
});

let all: Row[];
const calls: { filter: Record<string, unknown>; after: { startAt: Date; id: string } | undefined; take: number }[] = [];

await mock.module("../../../src/repositories/export.repository.js", () => ({
  findBookingsForExport: (
    filter: Record<string, unknown>,
    after: { startAt: Date; id: string } | undefined,
    take: number,
  ) => {
    calls.push({ filter, after, take });
    const start = after ? all.findIndex((r) => r.id === after.id) + 1 : 0;
    return Promise.resolve(all.slice(start, start + take));
  },
}));

const { exportBookings, exportFilename } = await import("../../../src/services/export.service.js");

async function collect(query = {}, options = {}) {
  const lines: string[] = [];
  for await (const line of exportBookings(query, { secret: SECRET, ...options })) lines.push(line);
  return lines;
}

const parse = (line: string) => line.replace(/\r\n$/, "").split(",");

beforeEach(() => {
  all = [row(1)];
  calls.length = 0;
});

describe("exportBookings", () => {
  test("starts with the header, then one CRLF-terminated line per booking", async () => {
    const lines = await collect();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      "booking_id,status,source,service_id,service_name,service_category,artist_id,start_at,end_at,duration_minutes," +
        "total_price,created_at,confirmed_at,lead_time_hours,confirmation_minutes,has_reference_image,has_customer_note," +
        "customer_ref,status_changes,last_status_change_at,cancelled_by\r\n",
    );
    expect(lines.every((l) => l.endsWith("\r\n"))).toBe(true);
  });

  test("writes the values the data team asked for, in WIB", async () => {
    const [, line] = await collect();
    const cells = parse(line as string);
    expect(cells).toEqual([
      "id-001",
      "completed",
      "online",
      "svc-1",
      "Gel Polish",
      "gel_polish",
      "art-1",
      "2026-03-10T10:01:00+07:00",
      "2026-03-10T11:01:00+07:00",
      "90",
      "150000",
      "2026-03-08T08:00:00+07:00",
      "2026-03-08T08:30:00+07:00",
      "50.02", // hours from creation to the appointment
      "30", // minutes to confirm
      "false",
      "false",
      cells[17] as string, // customer_ref, checked below
      "1", // pending -> confirmed
      "2026-03-08T08:30:00+07:00",
      "",
    ]);
    expect(cells[17]).toMatch(/^[0-9a-f]{16}$/);
  });

  test("exports no personal data: no phone, name, note or booking code", async () => {
    all = [row(1, { customerNote: "Tolong warna pink, hubungi saya", referenceImageUrl: "https://x.test/a.png" })];
    const text = (await collect()).join("");
    expect(text).not.toContain("81234567890");
    expect(text).not.toContain("pink");
    expect(text).not.toContain("x.test");
    const cells = parse((await collect())[1] as string);
    expect(cells.slice(15, 17)).toEqual(["true", "true"]); // only that a note and an image exist
  });

  test("the same customer gets the same ref, another one a different ref", async () => {
    all = [row(1), row(2), row(3, { customerPhone: "+6289999999999" })];
    const refs = (await collect()).slice(1).map((l) => parse(l)[17]);
    expect(refs[0]).toBe(refs[1]);
    expect(refs[0]).not.toBe(refs[2]);
  });

  test("says who cancelled: an admin id in the history means admin, none means the customer", async () => {
    const cancelledBy = (changedBy: string | null) =>
      row(1, {
        status: "cancelled",
        history: [
          { fromStatus: null, toStatus: "pending", changedBy: null, changedAt: new Date("2026-03-08T01:00:00Z") },
          { fromStatus: "pending", toStatus: "cancelled", changedBy, changedAt: new Date("2026-03-09T01:00:00Z") },
        ],
      });
    all = [cancelledBy(ADMIN)];
    expect(parse((await collect())[1] as string).at(-1)).toBe("admin");
    all = [cancelledBy(null)];
    expect(parse((await collect())[1] as string).at(-1)).toBe("customer");
    all = [row(1)];
    expect(parse((await collect())[1] as string).at(-1)).toBe(""); // not cancelled
  });

  test("an unconfirmed booking has empty confirmation columns", async () => {
    all = [
      row(1, {
        status: "pending",
        confirmedAt: null,
        history: [
          { fromStatus: null, toStatus: "pending", changedBy: null, changedAt: new Date("2026-03-08T01:00:00Z") },
        ],
      }),
    ];
    const cells = parse((await collect())[1] as string);
    expect(cells.slice(12, 15)).toEqual(["", "50.02", ""]); // confirmed_at, lead time, confirmation minutes
    expect(cells[18]).toBe("0"); // status_changes: creation is not a change
  });

  test("defuses a service name that would run as a formula", async () => {
    all = [row(1, { service: { name: "=cmd|' /C calc'!A0", category: "x", durationMinutes: 60 } })];
    expect((await collect())[1]).toContain("'=cmd|' /C calc'!A0");
  });

  test("reads in batches that continue after the last row, without gaps or repeats", async () => {
    all = Array.from({ length: 7 }, (_, i) => row(i + 1));
    const lines = await collect({}, { batchSize: 3 });
    expect(lines.slice(1).map((l) => parse(l)[0])).toEqual(all.map((r) => r.id));
    expect(calls.map((c) => c.after?.id)).toEqual([undefined, "id-003", "id-006"]); // 3 + 3 + 1 rows
    expect(calls.every((c) => c.take === 3)).toBe(true);
  });

  test("asks for another batch only when the last one was full, and an empty export is just the header", async () => {
    all = Array.from({ length: 6 }, (_, i) => row(i + 1));
    await collect({}, { batchSize: 3 });
    expect(calls).toHaveLength(3); // the third, empty batch ends it
    calls.length = 0;
    all = [];
    expect(await collect()).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test("turns the date range into inclusive WIB days and passes the status on", async () => {
    await collect({ date_from: "2026-03-01", date_to: "2026-03-31", status: "no_show" });
    expect(calls[0]?.filter).toEqual({
      from: new Date("2026-03-01T00:00:00+07:00"),
      to: new Date("2026-04-01T00:00:00+07:00"),
      status: "no_show",
    });
    calls.length = 0;
    await collect({});
    expect(calls[0]?.filter["from"]).toBeUndefined();
    expect(calls[0]?.filter["to"]).toBeUndefined();
  });

  test("a database error before the first line surfaces from the first read", async () => {
    all = null as never;
    const lines = exportBookings({}, { secret: SECRET });
    await expect(lines.next()).rejects.toThrow();
  });
});

describe("exportFilename", () => {
  test("names the file after its range and status", () => {
    expect(exportFilename({ date_from: "2026-03-01", date_to: "2026-03-31" })).toBe(
      "bookings_2026-03-01_2026-03-31.csv",
    );
    expect(exportFilename({})).toBe("bookings_start_all.csv");
    expect(exportFilename({ date_from: "2026-03-01", status: "no_show" })).toBe("bookings_2026-03-01_all_no_show.csv");
  });
});
