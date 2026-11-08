import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppError } from "../../../src/utils/errors.js";

const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const SERVICE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_SERVICE_ID = "44444444-4444-4444-8444-444444444444";
const ADMIN_ID = "55555555-5555-4555-8555-555555555555";

const NOW = new Date("2026-11-09T01:00:00Z"); // Monday 08:00 WIB
const START = new Date("2026-11-10T03:00:00Z"); // Tuesday 10:00 WIB
const iso = (d: Date) => d.toISOString();

const serviceRow = (overrides: Record<string, unknown> = {}) => ({
  id: SERVICE_ID,
  name: "Gel Polish",
  description: null,
  category: "gel_polish",
  price: 150000,
  durationMinutes: 90,
  imageUrl: null,
  isActive: true,
  ...overrides,
});

const bookingRow = (overrides: Record<string, unknown> = {}) => ({
  id: "b1",
  bookingCode: "NP-20261110-A7K2",
  status: "pending",
  source: "online",
  serviceId: SERVICE_ID,
  artistId: A1,
  startAt: START,
  endAt: new Date(START.getTime() + 90 * 60_000),
  customerName: "Siti Rahayu",
  customerPhone: "+6281234567890",
  customerNote: null,
  referenceImageUrl: null,
  totalPrice: 150000,
  cancelReason: null,
  adminNote: null,
  createdAt: NOW,
  updatedAt: NOW,
  service: serviceRow(),
  artist: { id: A1, name: "Owner", photoUrl: null, isActive: true },
  ...overrides,
});
type Row = ReturnType<typeof bookingRow>;

let found: Row | null;
let listed: { rows: Row[]; total: number };
let blocks: { artistId: string | null; startAt: Date; endAt: Date }[];
let bookable: ReturnType<typeof serviceRow> | null;
let rescheduleOutcome: unknown;
let rescheduleError: Error | null;
let transitionResult: Row | null;
let notesResult: Row | null;
const calls = {
  list: [] as unknown[][],
  blockedQueries: 0,
  notes: [] as unknown[][],
  reschedule: [] as unknown[][],
  transition: [] as unknown[][],
};

await mock.module("../../../src/repositories/admin-booking.repository.js", () => ({
  listBookings: (...args: unknown[]) => {
    calls.list.push(args);
    return Promise.resolve(listed);
  },
  findBookingById: () => Promise.resolve(found),
  findBlockedSlotsBetween: () => {
    calls.blockedQueries += 1;
    return Promise.resolve(blocks);
  },
  findBookableService: () => Promise.resolve(bookable),
  updateNotes: (...args: unknown[]) => {
    calls.notes.push(args);
    return Promise.resolve(notesResult);
  },
  rescheduleLocked: (...args: unknown[]) => {
    calls.reschedule.push(args);
    return rescheduleError ? Promise.reject(rescheduleError) : Promise.resolve(rescheduleOutcome);
  },
  transitionStatus: (...args: unknown[]) => {
    calls.transition.push(args);
    return Promise.resolve(transitionResult);
  },
}));

const admin = await import("../../../src/services/admin-booking.service.js");

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error("expected the call to fail");
}

const slotAt = (date: Date) => ({ start_at: iso(date), end_at: iso(date), available_artist_ids: [A1] });
const toJakarta = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "+07:00");

let offered: Date[];
const availabilityQueries: unknown[][] = [];
const options = {
  now: NOW,
  maxAdvanceDays: 60,
  bufferMinutes: 15,
  getAvailabilityFor: (query: { service_id: string; date: string }, opts: unknown) => {
    availabilityQueries.push([query, opts]);
    return Promise.resolve({
      date: query.date,
      service_id: query.service_id,
      slots: offered.map((d) => ({ ...slotAt(d), start_at: toJakarta(d) })),
    });
  },
};

beforeEach(() => {
  found = bookingRow();
  listed = { rows: [bookingRow()], total: 1 };
  blocks = [];
  bookable = serviceRow({ id: OTHER_SERVICE_ID, price: 80000, durationMinutes: 60 });
  rescheduleError = null;
  rescheduleOutcome = { kind: "updated", booking: bookingRow() };
  transitionResult = bookingRow({ status: "confirmed" });
  notesResult = bookingRow({ adminNote: "catatan" });
  offered = [new Date("2026-11-10T06:00:00Z")]; // 13:00 WIB
  availabilityQueries.length = 0;
  for (const key of ["list", "notes", "reschedule", "transition"] as const) calls[key].length = 0;
  calls.blockedQueries = 0;
});

describe("listBookings", () => {
  test("turns dates into an inclusive WIB range and a 0812 search into the stored 62812 form", async () => {
    const result = await admin.listBookings({
      date_from: "2026-11-10",
      date_to: "2026-11-11",
      status: "pending",
      artist_id: A1,
      q: "0812-345",
      page: 2,
      per_page: 10,
    });
    const [filter, page, perPage] = calls.list[0] as [Record<string, unknown>, number, number];
    expect(filter["from"]).toEqual(new Date("2026-11-10T00:00:00+07:00"));
    expect(filter["to"]).toEqual(new Date("2026-11-12T00:00:00+07:00")); // the end day is included
    expect(filter).toMatchObject({ status: "pending", artistId: A1, q: "0812-345", phoneFragment: "62812345" });
    expect([page, perPage]).toEqual([2, 10]);
    expect(result.meta).toEqual({ page: 2, per_page: 10, total: 1, total_pages: 1 });
  });

  test("a short or non-numeric search has no phone fragment; no filters means open dates", async () => {
    await admin.listBookings({ q: "siti", page: 1, per_page: 20 });
    await admin.listBookings({ q: "08", page: 1, per_page: 20 });
    const [first] = calls.list[0] as [Record<string, unknown>];
    const [second] = calls.list[1] as [Record<string, unknown>];
    expect(first["phoneFragment"]).toBeUndefined();
    expect(second["phoneFragment"]).toBeUndefined();
    expect(first["from"]).toBeUndefined();
    expect(first["to"]).toBeUndefined();
  });

  test("keeps +62 digits as they are", async () => {
    await admin.listBookings({ q: "+62811122", page: 1, per_page: 20 });
    expect((calls.list[0] as [Record<string, unknown>])[0]["phoneFragment"]).toBe("62811122");
  });

  test("flags conflicts with one blocked-slot query and drops reminder_url for finished bookings", async () => {
    listed = {
      rows: [
        bookingRow({ id: "a" }),
        bookingRow({ id: "b", artistId: A2, artist: { id: A2, name: "Second", photoUrl: null, isActive: true } }),
        bookingRow({ id: "c", status: "cancelled" }),
      ],
      total: 3,
    };
    blocks = [
      { artistId: A1, startAt: new Date(START.getTime() + 30 * 60_000), endAt: new Date(START.getTime() + 3600_000) },
    ];
    const { data } = await admin.listBookings({ page: 1, per_page: 20 });
    expect(calls.blockedQueries).toBe(1);
    expect(data.map((b) => b.schedule_conflict)).toEqual([true, false, false]); // another artist / finished: not affected
    expect(data.map((b) => b.reminder_url === null)).toEqual([false, false, true]);
  });

  test("a studio-wide block affects every artist; an empty page asks for no blocks", async () => {
    blocks = [{ artistId: null, startAt: START, endAt: new Date(START.getTime() + 1000) }];
    expect((await admin.listBookings({ page: 1, per_page: 20 })).data[0]?.schedule_conflict).toBe(true);
    listed = { rows: [], total: 0 };
    calls.blockedQueries = 0;
    expect((await admin.listBookings({ page: 1, per_page: 20 })).data).toEqual([]);
    expect(calls.blockedQueries).toBe(0);
  });
});

describe("getBooking", () => {
  test("includes a reminder link addressed to the customer with a greeting by first name", async () => {
    const dto = await admin.getBooking("b1");
    expect(dto.reminder_url).toStartWith("https://wa.me/6281234567890?text=");
    const text = decodeURIComponent(dto.reminder_url ?? "");
    expect(text).toContain("Halo Siti");
    expect(text).toContain("The Nail Palace");
    expect(text).toContain("NP-20261110-A7K2");
    expect(text).toContain("10.00 WIB");
  });

  test("404 when the booking does not exist", async () => {
    found = null;
    expect((await failure(admin.getBooking("nope"))).httpStatus).toBe(404);
  });
});

describe("createManualBooking", () => {
  test("places a confirmed admin booking attributed to the admin", async () => {
    const placed: unknown[][] = [];
    const dto = await admin.createManualBooking(
      { service_id: SERVICE_ID, start_at: START, customer_name: "Siti", customer_phone: "+6281234567890" },
      ADMIN_ID,
      {
        ...options,
        placeBooking: (...args) => {
          placed.push(args);
          return Promise.resolve(bookingRow({ status: "confirmed", source: "admin" }));
        },
      },
    );
    expect((placed[0] as unknown[])[1]).toEqual({ source: "admin", status: "confirmed", changedBy: ADMIN_ID });
    expect(dto).toMatchObject({ status: "confirmed", source: "admin", schedule_conflict: false });
    expect(dto.reminder_url).not.toBeNull();
  });
});

describe("updateBooking", () => {
  const patch = (body: Record<string, unknown>) => admin.updateBooking("b1", body, options);

  test("notes only: no schedule checks, empty string clears a note", async () => {
    notesResult = bookingRow({ adminNote: null });
    await patch({ admin_note: "", customer_note: "pink" });
    expect(calls.notes[0]).toEqual(["b1", { customerNote: "pink", adminNote: null }]);
    expect(calls.reschedule).toHaveLength(0);
    expect(availabilityQueries).toHaveLength(0);
  });

  test("notes on a finished booking are allowed", async () => {
    found = bookingRow({ status: "completed" });
    await patch({ admin_note: "puas" });
    expect(calls.notes).toHaveLength(1);
  });

  test("values equal to the current ones are not a schedule change", async () => {
    found = bookingRow({ status: "cancelled" });
    await patch({ start_at: START, artist_id: A1, service_id: SERVICE_ID });
    expect(calls.reschedule).toHaveLength(0);
    expect(calls.notes).toHaveLength(0); // nothing to write either
  });

  test("404 if the booking vanished while saving notes", async () => {
    notesResult = null;
    expect((await failure(patch({ admin_note: "x" }))).httpStatus).toBe(404);
  });

  test("moves the booking, excluding itself from the conflict check, keeping artist and price", async () => {
    const newStart = new Date("2026-11-10T06:00:00Z");
    await patch({ start_at: newStart });
    const [query, opts] = availabilityQueries[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(query).toEqual({ service_id: SERVICE_ID, date: "2026-11-10", artist_id: A1 });
    expect(opts["excludeBookingId"]).toBe("b1");
    const [id, change, buffer] = calls.reschedule[0] as [string, Record<string, unknown>, number];
    expect(id).toBe("b1");
    expect(change).toMatchObject({
      serviceId: SERVICE_ID,
      artistId: A1,
      startAt: newStart,
      endAt: new Date("2026-11-10T07:30:00Z"),
      totalPrice: 150000,
    });
    expect(buffer).toBe(15);
  });

  test("changing service copies the new price and uses its duration", async () => {
    offered = [START];
    await patch({ service_id: OTHER_SERVICE_ID });
    const [, change] = calls.reschedule[0] as [string, Record<string, unknown>];
    expect(change).toMatchObject({
      serviceId: OTHER_SERVICE_ID,
      totalPrice: 80000,
      endAt: new Date(START.getTime() + 60 * 60_000),
    });
  });

  test("changing artist asks availability about that artist", async () => {
    offered = [START];
    await patch({ artist_id: A2 });
    expect((availabilityQueries[0] as [Record<string, unknown>])[0]["artist_id"]).toBe(A2);
  });

  test("409 INVALID_STATUS_TRANSITION when the status no longer allows a schedule change", async () => {
    found = bookingRow({ status: "no_show" });
    const error = await failure(patch({ start_at: new Date("2026-11-10T06:00:00Z") }));
    expect(error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  test("404 for an unknown or inactive new service", async () => {
    bookable = null;
    expect((await failure(patch({ service_id: OTHER_SERVICE_ID }))).httpStatus).toBe(404);
  });

  test("422 for a new start in the past or beyond the window", async () => {
    expect((await failure(patch({ start_at: new Date("2026-11-09T00:00:00Z") }))).httpStatus).toBe(422);
    expect((await failure(patch({ start_at: new Date("2027-01-09T03:00:00Z") }))).httpStatus).toBe(422);
    expect(calls.reschedule).toHaveLength(0);
  });

  test("409 SLOT_UNAVAILABLE when the new time is not an offered slot", async () => {
    offered = [];
    const error = await failure(patch({ start_at: new Date("2026-11-10T06:00:00Z") }));
    expect(error.code).toBe("SLOT_UNAVAILABLE");
    expect(calls.reschedule).toHaveLength(0);
  });

  test("maps the locked re-check and the database constraint to the right errors", async () => {
    const move = { start_at: new Date("2026-11-10T06:00:00Z") };
    rescheduleOutcome = { kind: "refused", reason: "buffer_conflict" };
    expect((await failure(patch(move))).code).toBe("SLOT_UNAVAILABLE");
    rescheduleOutcome = { kind: "not_active" };
    expect((await failure(patch(move))).code).toBe("INVALID_STATUS_TRANSITION");
    rescheduleOutcome = { kind: "not_found" };
    expect((await failure(patch(move))).httpStatus).toBe(404);

    rescheduleError = Object.assign(new Error("db"), {
      meta: { driverAdapterError: { cause: { originalCode: "23P01" } } },
    });
    expect((await failure(patch(move))).code).toBe("SLOT_UNAVAILABLE");
    rescheduleError = new Error("connection lost");
    expect((await failure(patch(move))).message).toBe("connection lost");
  });
});

describe("changeStatus", () => {
  const change = (status: string, reason?: string, now = NOW) =>
    admin.changeStatus("b1", { status, ...(reason ? { reason } : {}) } as never, ADMIN_ID, { now });

  test("confirming stamps confirmed_at and records the admin", async () => {
    await change("confirmed");
    expect(calls.transition[0]).toEqual([
      "b1",
      "pending",
      "confirmed",
      { changedBy: ADMIN_ID, reason: null, confirmedAt: NOW },
    ]);
  });

  test("cancelling stores the reason on the booking and in the history", async () => {
    transitionResult = bookingRow({ status: "cancelled", cancelReason: "Batal" });
    const dto = await change("cancelled", "Batal");
    expect(calls.transition[0]).toEqual([
      "b1",
      "pending",
      "cancelled",
      { changedBy: ADMIN_ID, reason: "Batal", cancelReason: "Batal" },
    ]);
    expect(dto.reminder_url).toBeNull();
  });

  test("cancelling without a reason is a 422 and writes nothing", async () => {
    const error = await failure(change("cancelled"));
    expect(error.httpStatus).toBe(422);
    expect(error.details?.[0]?.field).toBe("reason");
    expect(calls.transition).toHaveLength(0);
  });

  test("409 for transitions that are not allowed", async () => {
    expect((await failure(change("completed"))).code).toBe("INVALID_STATUS_TRANSITION"); // pending cannot complete
    found = bookingRow({ status: "cancelled" });
    expect((await failure(change("confirmed"))).code).toBe("INVALID_STATUS_TRANSITION");
    expect(calls.transition).toHaveLength(0);
  });

  test("completed and no_show wait for the start time", async () => {
    found = bookingRow({ status: "confirmed" });
    expect((await failure(change("completed"))).code).toBe("INVALID_STATUS_TRANSITION");
    expect((await failure(change("no_show"))).code).toBe("INVALID_STATUS_TRANSITION");
    transitionResult = bookingRow({ status: "completed" });
    await change("completed", undefined, START);
    expect(calls.transition).toHaveLength(1);
  });

  test("409 when someone else changed the booking first, 404 for an unknown booking", async () => {
    transitionResult = null;
    expect((await failure(change("confirmed"))).code).toBe("INVALID_STATUS_TRANSITION");
    found = null;
    expect((await failure(change("confirmed"))).httpStatus).toBe(404);
  });
});
