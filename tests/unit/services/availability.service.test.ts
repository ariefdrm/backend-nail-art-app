import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppError } from "../../../src/utils/errors.js";

interface Range {
  artistId: string | null;
  startAt: Date;
  endAt: Date;
}

const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const SERVICE_ID = "33333333-3333-4333-8333-333333333333";

// 2026-11-10 is a Tuesday (day_of_week 2). 09:00 WIB = 02:00Z.
const at = (hhmm: string, date = "2026-11-10") => new Date(`${date}T${hhmm}:00+07:00`);

let service: { id: string; durationMinutes: number; isActive: boolean } | null;
let artists: { id: string; isActive: boolean }[];
let hours: Record<string, unknown>[];
let bookings: Range[];
let blocks: Range[];

await mock.module("../../../src/repositories/availability.repository.js", () => ({
  findServiceById: () => Promise.resolve(service),
  findArtistById: (id: string) => Promise.resolve(artists.find((a) => a.id === id) ?? null),
  listActiveArtists: () => Promise.resolve(artists.filter((a) => a.isActive)),
  listBusinessHours: () => Promise.resolve(hours),
  findBusyRanges: () => Promise.resolve({ bookings, blocks }),
}));

const { getAvailability } = await import("../../../src/services/availability.service.js");

const options = { stepMinutes: 30, maxAdvanceDays: 60, bufferMinutes: 0, now: new Date("2026-11-09T01:00:00Z") };
const query = { service_id: SERVICE_ID, date: "2026-11-10" };
const starts = (r: Awaited<ReturnType<typeof getAvailability>>) => r.slots.map((s) => s.start_at.slice(11, 16));

const tuesday = (overrides: Record<string, unknown> = {}) => ({
  dayOfWeek: 2,
  isOpen: true,
  openTime: "09:00",
  closeTime: "17:00",
  breakStart: null,
  breakEnd: null,
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

beforeEach(() => {
  service = { id: SERVICE_ID, durationMinutes: 60, isActive: true };
  artists = [{ id: A1, isActive: true }];
  hours = [tuesday()];
  bookings = [];
  blocks = [];
});

describe("getAvailability", () => {
  test("lists slots on the step grid, none that run past closing time", async () => {
    const result = await getAvailability(query, options);
    expect(starts(result)[0]).toBe("09:00");
    expect(starts(result).at(-1)).toBe("16:00");
    expect(result.slots[0]).toEqual({
      start_at: "2026-11-10T09:00:00+07:00",
      end_at: "2026-11-10T10:00:00+07:00",
      available_artist_ids: [A1],
    });
    expect(result.date).toBe("2026-11-10");
    expect(result.service_id).toBe(SERVICE_ID);
  });

  test("a longer service drops the starts that would end after closing", async () => {
    service = { id: SERVICE_ID, durationMinutes: 90, isActive: true };
    expect(starts(await getAvailability(query, options)).at(-1)).toBe("15:30");
  });

  test("returns no slots on a closed day or when no hours row exists", async () => {
    hours = [tuesday({ isOpen: false, openTime: null, closeTime: null })];
    expect((await getAvailability(query, options)).slots).toEqual([]);
    hours = [];
    expect((await getAvailability(query, options)).slots).toEqual([]);
  });

  test("skips slots that overlap the break but allows ones touching its edges", async () => {
    hours = [tuesday({ breakStart: "12:00", breakEnd: "13:00" })];
    const result = starts(await getAvailability(query, options));
    expect(result).toContain("11:00"); // ends exactly at the break start
    expect(result).not.toContain("11:30");
    expect(result).not.toContain("12:00");
    expect(result).not.toContain("12:30");
    expect(result).toContain("13:00"); // starts exactly at the break end
  });

  test("a booking removes the overlapping slots for its artist only", async () => {
    artists = [
      { id: A1, isActive: true },
      { id: A2, isActive: true },
    ];
    bookings = [{ artistId: A1, startAt: at("10:00"), endAt: at("11:00") }];
    const result = await getAvailability(query, options);
    const byStart = new Map(result.slots.map((s) => [s.start_at.slice(11, 16), s.available_artist_ids]));
    expect(byStart.get("09:00")).toEqual([A1, A2]); // ends when the booking starts
    expect(byStart.get("09:30")).toEqual([A2]);
    expect(byStart.get("10:00")).toEqual([A2]);
    expect(byStart.get("10:30")).toEqual([A2]);
    expect(byStart.get("11:00")).toEqual([A1, A2]); // starts when the booking ends
  });

  test("the buffer keeps the artist busy for BOOKING_BUFFER_MINUTES around a booking", async () => {
    // 60 minute service, booking 10:00-11:00: it occupies the artist until 11:15, and a slot needs 15 free minutes after it
    bookings = [{ artistId: A1, startAt: at("10:00"), endAt: at("11:00") }];
    const withBuffer = starts(await getAvailability(query, { ...options, bufferMinutes: 15 }));
    expect(withBuffer.slice(0, 1)).toEqual(["11:30"]); // 09:00 would leave no gap before 10:00, 11:00 starts inside the buffer
    const withoutBuffer = starts(await getAvailability(query, options));
    expect(withoutBuffer).toContain("09:00"); // the same slots are free when there is no buffer
    expect(withoutBuffer).toContain("11:00");
  });

  test("a buffer does not apply to blocked slots, the break or closing time", async () => {
    blocks = [{ artistId: null, startAt: at("13:00"), endAt: at("14:00") }];
    hours = [tuesday({ breakStart: "12:00", breakEnd: "13:00" })];
    const result = starts(await getAvailability(query, { ...options, bufferMinutes: 15 }));
    expect(result).toContain("11:00"); // ends exactly at the break
    expect(result).toContain("14:00"); // starts exactly when the block ends
    expect(result).toContain("16:00"); // ends exactly at closing time
  });

  test("a slot disappears when every artist is busy", async () => {
    bookings = [{ artistId: A1, startAt: at("10:00"), endAt: at("11:00") }];
    const result = starts(await getAvailability(query, options));
    expect(result).not.toContain("10:00");
    expect(result).not.toContain("09:30");
  });

  test("an artist block affects that artist, a studio block affects everyone", async () => {
    artists = [
      { id: A1, isActive: true },
      { id: A2, isActive: true },
    ];
    blocks = [
      { artistId: A2, startAt: at("09:00"), endAt: at("10:00") },
      { artistId: null, startAt: at("14:00"), endAt: at("15:00") },
    ];
    const result = await getAvailability(query, options);
    const byStart = new Map(result.slots.map((s) => [s.start_at.slice(11, 16), s.available_artist_ids]));
    expect(byStart.get("09:00")).toEqual([A1]);
    expect(byStart.has("14:00")).toBe(false);
    expect(byStart.has("14:30")).toBe(false);
    expect(byStart.has("13:30")).toBe(false); // would run into the block
    expect(byStart.has("13:00")).toBe(true); // ends exactly when the block starts
    expect(byStart.get("15:00")).toEqual([A1, A2]);
  });

  test("artist_id limits the result to that artist", async () => {
    artists = [
      { id: A1, isActive: true },
      { id: A2, isActive: true },
    ];
    const result = await getAvailability({ ...query, artist_id: A2 }, options);
    expect(result.slots.every((s) => s.available_artist_ids.length === 1 && s.available_artist_ids[0] === A2)).toBe(
      true,
    );
  });

  test("returns no slots when there is no active artist", async () => {
    artists = [{ id: A1, isActive: false }];
    expect((await getAvailability(query, options)).slots).toEqual([]);
  });

  test("today: drops slots whose start already passed", async () => {
    hours = [tuesday({ dayOfWeek: 1 })]; // 2026-11-09 is a Monday
    const now = new Date("2026-11-09T03:15:00Z"); // 10:15 WIB
    const result = await getAvailability({ ...query, date: "2026-11-09" }, { ...options, now });
    expect(starts(result)[0]).toBe("10:30");
  });

  test("rejects a past date and a date beyond the advance window with 422", async () => {
    const past = await failure(getAvailability({ ...query, date: "2026-11-08" }, options));
    expect(past.code).toBe("VALIDATION_ERROR");
    expect(past.httpStatus).toBe(422);
    const far = await failure(getAvailability({ ...query, date: "2027-01-09" }, options));
    expect(far.httpStatus).toBe(422);
    // the last allowed day (today + 60 days) is accepted
    const edge = await getAvailability({ ...query, date: "2027-01-08" }, options);
    expect(edge.date).toBe("2027-01-08");
  });

  test("returns 404 for an unknown or inactive service or artist", async () => {
    service = null;
    expect((await failure(getAvailability(query, options))).httpStatus).toBe(404);
    service = { id: SERVICE_ID, durationMinutes: 60, isActive: false };
    expect((await failure(getAvailability(query, options))).httpStatus).toBe(404);
    service = { id: SERVICE_ID, durationMinutes: 60, isActive: true };
    expect((await failure(getAvailability({ ...query, artist_id: A2 }, options))).httpStatus).toBe(404);
    artists = [{ id: A2, isActive: false }];
    expect((await failure(getAvailability({ ...query, artist_id: A2 }, options))).httpStatus).toBe(404);
  });
});
