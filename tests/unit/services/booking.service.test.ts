import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppError } from "../../../src/utils/errors.js";

const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const SERVICE_ID = "33333333-3333-4333-8333-333333333333";

const NOW = new Date("2026-11-09T01:00:00Z"); // Monday 08:00 WIB
const START = new Date("2026-11-10T03:00:00Z"); // Tuesday 10:00 WIB
const START_ISO = "2026-11-10T10:00:00+07:00";

const serviceRow = {
  id: SERVICE_ID,
  name: "Gel Polish",
  description: null,
  category: "gel_polish",
  price: 150000,
  durationMinutes: 90,
  imageUrl: null,
  isActive: true,
};

const bookingRow = (overrides: Record<string, unknown> = {}) => ({
  id: "b1",
  bookingCode: "NP-20261110-A7K2",
  status: "pending",
  source: "online",
  serviceId: SERVICE_ID,
  artistId: A1,
  startAt: START,
  endAt: new Date(START.getTime() + 90 * 60_000),
  customerName: "Siti",
  customerPhone: "+6281234567890",
  customerNote: null,
  referenceImageUrl: null,
  totalPrice: 150000,
  cancelReason: null,
  adminNote: null,
  createdAt: NOW,
  updatedAt: NOW,
  service: serviceRow,
  artist: { id: A1, name: "Owner", photoUrl: null, isActive: true },
  ...overrides,
});

type Created = { created: true; booking: ReturnType<typeof bookingRow> } | { created: false; reason: string };

let bookableService: typeof serviceRow | null;
let found: ReturnType<typeof bookingRow> | null;
let blockedOverlap: boolean;
let cancelResult: ReturnType<typeof bookingRow> | null;
let createBehaviour: (data: Record<string, unknown>, call: number) => Created | Error;
const calls = {
  created: [] as { data: Record<string, unknown>; buffer: number }[],
  cancelled: [] as unknown[][],
  blockedChecks: 0,
};

await mock.module("../../../src/repositories/booking.repository.js", () => ({
  ACTIVE_BOOKING_STATUSES: ["pending", "confirmed"],
  findActiveBookingsOverlapping: () => Promise.resolve([]),
  findBookableService: () => Promise.resolve(bookableService),
  findBookingByCode: () => Promise.resolve(found),
  hasBlockedOverlap: () => {
    calls.blockedChecks += 1;
    return Promise.resolve(blockedOverlap);
  },
  createBookingLocked: (data: Record<string, unknown>, buffer: number) => {
    calls.created.push({ data, buffer });
    const outcome = createBehaviour(data, calls.created.length);
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  },
  cancelActiveBooking: (...args: unknown[]) => {
    calls.cancelled.push(args);
    return Promise.resolve(cancelResult);
  },
}));

const { createBooking, getBookingStatus, cancelBooking } = await import("../../../src/services/booking.service.js");

const slot = (artistIds: string[]) => ({
  start_at: START_ISO,
  end_at: "2026-11-10T11:30:00+07:00",
  available_artist_ids: artistIds,
});
let slots: ReturnType<typeof slot>[];
const availabilityQueries: unknown[] = [];

const options = {
  now: NOW,
  maxAdvanceDays: 60,
  bufferMinutes: 15,
  cancelMinHoursBefore: 0,
  getAvailability: (query: { service_id: string; date: string }) => {
    availabilityQueries.push(query);
    return Promise.resolve({ date: query.date, service_id: query.service_id, slots });
  },
};

const input = (overrides: Record<string, unknown> = {}) => ({
  service_id: SERVICE_ID,
  start_at: START,
  customer_name: "Siti",
  customer_phone: "+6281234567890",
  ...overrides,
});

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error("expected the call to fail");
}

const dbError = (shape: Record<string, unknown>) => Object.assign(new Error("db"), shape);
const overlapError = () =>
  dbError({ code: "P2039", meta: { driverAdapterError: { cause: { originalCode: "23P01" } } } });

beforeEach(() => {
  bookableService = serviceRow;
  found = bookingRow();
  blockedOverlap = false;
  cancelResult = bookingRow({ status: "cancelled", cancelReason: "berhalangan" });
  slots = [slot([A1, A2])];
  availabilityQueries.length = 0;
  calls.created.length = 0;
  calls.cancelled.length = 0;
  calls.blockedChecks = 0;
  createBehaviour = (data) => ({ created: true, booking: bookingRow({ artistId: data["artistId"] }) });
});

describe("createBooking", () => {
  test("creates a pending booking with a price snapshot, the end time and the buffer", async () => {
    const result = await createBooking(input({ customer_note: "", reference_image_url: null }), options);
    expect(result.status).toBe("pending");
    expect(result.booking_code).toBe("NP-20261110-A7K2");
    expect(result.start_at).toBe(START_ISO);
    expect(result.schedule_conflict).toBe(false);
    const [call] = calls.created;
    expect(call?.buffer).toBe(15);
    expect(call?.data).toMatchObject({
      serviceId: SERVICE_ID,
      startAt: START,
      endAt: new Date("2026-11-10T04:30:00Z"), // 90 minute service
      customerPhone: "+6281234567890",
      totalPrice: 150000,
      customerNote: null,
      referenceImageUrl: null,
    });
    expect(String(call?.data["bookingCode"])).toMatch(/^NP-20261110-[A-Z2-9]{4}$/);
    expect(availabilityQueries).toEqual([{ service_id: SERVICE_ID, date: "2026-11-10" }]);
  });

  test("picks the first free artist when none is requested", async () => {
    await createBooking(input(), options);
    expect(calls.created[0]?.data["artistId"]).toBe(A1);
  });

  test("a requested artist is passed to the availability check and used as the only candidate", async () => {
    createBehaviour = () => ({ created: false, reason: "blocked" });
    const error = await failure(createBooking(input({ artist_id: A2 }), options));
    expect(error.code).toBe("SLOT_UNAVAILABLE");
    expect(availabilityQueries).toEqual([{ service_id: SERVICE_ID, date: "2026-11-10", artist_id: A2 }]);
    expect(calls.created.map((c) => c.data["artistId"])).toEqual([A2]);
  });

  test("falls back to the next artist when the first is refused or hits the exclusion constraint", async () => {
    createBehaviour = (_data, call) => (call === 1 ? overlapError() : { created: true, booking: bookingRow() });
    await createBooking(input(), options);
    expect(calls.created.map((c) => c.data["artistId"])).toEqual([A1, A2]);

    calls.created.length = 0;
    createBehaviour = (_data, call) =>
      call === 1 ? { created: false, reason: "buffer_conflict" } : { created: true, booking: bookingRow() };
    await createBooking(input(), options);
    expect(calls.created).toHaveLength(2);
  });

  test("409 SLOT_UNAVAILABLE when every artist is refused", async () => {
    createBehaviour = () => ({ created: false, reason: "blocked" });
    const error = await failure(createBooking(input(), options));
    expect(error.code).toBe("SLOT_UNAVAILABLE");
    expect(error.httpStatus).toBe(409);
    expect(calls.created).toHaveLength(2);
  });

  test("409 when the requested start is not one of the offered slots", async () => {
    slots = [];
    expect((await failure(createBooking(input(), options))).code).toBe("SLOT_UNAVAILABLE");
    expect(calls.created).toHaveLength(0);
  });

  test("draws a new booking code when the unique index rejects the first", async () => {
    createBehaviour = (_data, call) =>
      call === 1 ? dbError({ code: "P2002" }) : { created: true, booking: bookingRow() };
    await createBooking(input(), options);
    expect(calls.created).toHaveLength(2);
    expect(calls.created[0]?.data["artistId"]).toBe(calls.created[1]?.data["artistId"]);
  });

  test("rethrows unexpected database errors", async () => {
    createBehaviour = () => dbError({ code: "P1001" });
    expect((await failure(createBooking(input(), options))).message).toBe("db");
  });

  test("404 for an unknown or inactive service", async () => {
    bookableService = null;
    const error = await failure(createBooking(input(), options));
    expect(error.httpStatus).toBe(404);
    expect(availabilityQueries).toHaveLength(0);
  });

  test("422 for a start in the past and for a start beyond the advance window", async () => {
    const past = await failure(createBooking(input({ start_at: new Date("2026-11-09T00:00:00Z") }), options));
    expect(past.code).toBe("VALIDATION_ERROR");
    expect(past.details?.[0]?.field).toBe("start_at");
    const far = await failure(createBooking(input({ start_at: new Date("2027-01-09T03:00:00Z") }), options));
    expect(far.httpStatus).toBe(422);
    expect(calls.created).toHaveLength(0);
  });

  test("a start on the last allowed day passes the date check", async () => {
    slots = [];
    const error = await failure(createBooking(input({ start_at: new Date("2027-01-08T03:00:00Z") }), options));
    expect(error.code).toBe("SLOT_UNAVAILABLE"); // got past the 422 date checks
  });
});

describe("getBookingStatus", () => {
  test("returns the booking for the right code and phone, accepting other phone formats", async () => {
    const result = await getBookingStatus("NP-20261110-A7K2", "081234567890");
    expect(result.booking_code).toBe("NP-20261110-A7K2");
    expect(result.schedule_conflict).toBe(false);
  });

  test("flags a schedule conflict for an active booking", async () => {
    blockedOverlap = true;
    expect((await getBookingStatus("NP-20261110-A7K2", "+6281234567890")).schedule_conflict).toBe(true);
  });

  test("does not look for conflicts on a finished booking", async () => {
    found = bookingRow({ status: "completed" });
    blockedOverlap = true;
    expect((await getBookingStatus("NP-20261110-A7K2", "+6281234567890")).schedule_conflict).toBe(false);
    expect(calls.blockedChecks).toBe(0);
  });

  test("404, not 403, for a wrong phone, an unparsable phone or an unknown code", async () => {
    for (const phone of ["+6289999999999", "not-a-phone"]) {
      const error = await failure(getBookingStatus("NP-20261110-A7K2", phone));
      expect(error.httpStatus).toBe(404);
      expect(error.code).toBe("NOT_FOUND");
    }
    found = null;
    expect((await failure(getBookingStatus("NP-20261110-ZZZZ", "+6281234567890"))).httpStatus).toBe(404);
  });
});

describe("cancelBooking", () => {
  test("cancels a pending booking, recording who it came from and the reason", async () => {
    const result = await cancelBooking("NP-20261110-A7K2", "+6281234567890", "berhalangan", options);
    expect(result.status).toBe("cancelled");
    expect(calls.cancelled).toHaveLength(1);
    expect(calls.cancelled[0]?.slice(0, 3)).toEqual(["b1", "pending", "berhalangan"]);
  });

  test("a confirmed booking can be cancelled too, and the reason is optional", async () => {
    found = bookingRow({ status: "confirmed" });
    await cancelBooking("NP-20261110-A7K2", "+6281234567890", undefined, options);
    expect(calls.cancelled).toHaveLength(1);
    expect(calls.cancelled[0]?.slice(0, 3)).toEqual(["b1", "confirmed", null]);
  });

  test("404 for a wrong phone, without touching the booking", async () => {
    expect((await failure(cancelBooking("NP-20261110-A7K2", "+6289999999999", undefined, options))).httpStatus).toBe(
      404,
    );
    expect(calls.cancelled).toHaveLength(0);
  });

  test("409 INVALID_STATUS_TRANSITION for a booking that is not pending or confirmed", async () => {
    for (const status of ["completed", "cancelled", "no_show"]) {
      found = bookingRow({ status });
      const error = await failure(cancelBooking("NP-20261110-A7K2", "+6281234567890", undefined, options));
      expect(error.code).toBe("INVALID_STATUS_TRANSITION");
      expect(error.httpStatus).toBe(409);
    }
    expect(calls.cancelled).toHaveLength(0);
  });

  test("409 once the appointment has started", async () => {
    const error = await failure(
      cancelBooking("NP-20261110-A7K2", "+6281234567890", undefined, { ...options, now: START }),
    );
    expect(error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  test("CANCEL_MIN_HOURS_BEFORE moves the deadline earlier", async () => {
    const oneHourBefore = new Date(START.getTime() - 60 * 60_000);
    const late = { ...options, cancelMinHoursBefore: 2, now: oneHourBefore };
    expect((await failure(cancelBooking("NP-20261110-A7K2", "+6281234567890", undefined, late))).code).toBe(
      "INVALID_STATUS_TRANSITION",
    );
    const early = { ...options, cancelMinHoursBefore: 2, now: new Date(START.getTime() - 3 * 60 * 60_000) };
    expect((await cancelBooking("NP-20261110-A7K2", "+6281234567890", undefined, early)).status).toBe("cancelled");
  });

  test("409 when someone else changed the booking first (the update matched nothing)", async () => {
    cancelResult = null;
    const error = await failure(cancelBooking("NP-20261110-A7K2", "+6281234567890", undefined, options));
    expect(error.code).toBe("INVALID_STATUS_TRANSITION");
  });
});
