import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppError } from "../../../src/utils/errors.js";

interface HourRow {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
}

const conflict = (overrides: Record<string, unknown> = {}) => ({
  id: "b1",
  bookingCode: "NP-20261110-A7K2",
  status: "confirmed",
  startAt: new Date("2026-11-10T03:00:00Z"),
  endAt: new Date("2026-11-10T04:30:00Z"),
  customerName: "  Siti Rahayu ",
  customerPhone: "+6281234567890",
  service: { name: "Gel Polish" },
  ...overrides,
});

let hourRows: HourRow[] = [];
let conflicts: ReturnType<typeof conflict>[] = [];
let artistKnown = true;
let deleteResult = true;
const calls = {
  replaced: [] as unknown[],
  listed: [] as unknown[],
  findConflicts: [] as unknown[],
  created: [] as unknown[],
  lockTaken: 0,
};

await mock.module("../../../src/repositories/schedule.repository.js", () => ({
  listBusinessHours: () => Promise.resolve(hourRows),
  replaceBusinessHours: (rows: HourRow[]) => {
    calls.replaced.push(rows);
    return Promise.resolve(rows);
  },
  listBlockedSlots: (range: unknown) => {
    calls.listed.push(range);
    return Promise.resolve([]);
  },
  deleteBlockedSlot: () => Promise.resolve(deleteResult),
  artistExists: () => Promise.resolve(artistKnown),
  findConflicts: (range: unknown) => {
    calls.findConflicts.push(range);
    return Promise.resolve(conflicts);
  },
  withScheduleLock: (fn: (tx: unknown) => Promise<unknown>) => {
    calls.lockTaken += 1;
    return fn({
      findConflicts: (range: unknown) => {
        calls.findConflicts.push(range);
        return Promise.resolve(conflicts);
      },
      createBlockedSlot: (data: Record<string, unknown>) => {
        calls.created.push(data);
        return Promise.resolve({ id: "slot-1", ...data });
      },
    });
  },
}));

const schedule = await import("../../../src/services/schedule.service.js");

const input = (overrides: Record<string, unknown> = {}) => ({
  artist_id: null,
  start_at: new Date("2026-11-10T02:00:00Z"),
  end_at: new Date("2026-11-10T05:00:00Z"),
  reason: "Cuti pribadi",
  acknowledge_conflicts: false,
  ...overrides,
});

async function failure(promise: Promise<unknown>): Promise<AppError> {
  return promise.then(
    () => {
      throw new Error("expected the promise to reject");
    },
    (e: AppError) => e,
  );
}

beforeEach(() => {
  hourRows = [];
  conflicts = [];
  artistKnown = true;
  deleteResult = true;
  calls.replaced = [];
  calls.listed = [];
  calls.findConflicts = [];
  calls.created = [];
  calls.lockTaken = 0;
});

describe("business hours", () => {
  test("always returns the 7 weekdays, treating missing days as closed", async () => {
    hourRows = [
      { dayOfWeek: 1, isOpen: true, openTime: "10:00", closeTime: "20:00", breakStart: "12:00", breakEnd: "13:00" },
    ];
    const hours = await schedule.getBusinessHours();
    expect(hours.map((h) => h.day_of_week)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(hours[1]).toEqual({
      day_of_week: 1,
      is_open: true,
      open_time: "10:00",
      close_time: "20:00",
      break_start: "12:00",
      break_end: "13:00",
    });
    expect(hours[0]).toEqual({
      day_of_week: 0,
      is_open: false,
      open_time: null,
      close_time: null,
      break_start: null,
      break_end: null,
    });
  });

  test("maps the snake_case input to repository rows", async () => {
    await schedule.replaceBusinessHours([
      { day_of_week: 2, is_open: true, open_time: "09:00", close_time: "17:00", break_start: null, break_end: null },
    ]);
    expect(calls.replaced).toEqual([
      [
        {
          dayOfWeek: 2,
          isOpen: true,
          openTime: "09:00",
          closeTime: "17:00",
          breakStart: null,
          breakEnd: null,
        },
      ],
    ]);
  });
});

describe("listing blocked slots", () => {
  test("date_from starts the day in WIB and date_to is inclusive (until the next day starts)", async () => {
    await schedule.listBlockedSlots("2026-11-10", "2026-11-12");
    const range = calls.listed[0] as { from: Date; to: Date };
    expect(range.from.toISOString()).toBe("2026-11-09T17:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-11-12T17:00:00.000Z");
  });

  test("passes no bounds when no dates are given", async () => {
    await schedule.listBlockedSlots();
    expect(calls.listed).toEqual([{ from: undefined, to: undefined }]);
  });
});

describe("checkBlock", () => {
  test("reports can_block when nothing overlaps", async () => {
    expect(await schedule.checkBlock(input())).toEqual({ can_block: true, conflicts: [] });
  });

  test("lists the overlapping bookings with a ready-to-send WhatsApp link", async () => {
    conflicts = [conflict()];
    const result = await schedule.checkBlock(input());
    expect(result.can_block).toBe(false);

    const [first] = result.conflicts;
    expect(first).toMatchObject({
      id: "b1",
      booking_code: "NP-20261110-A7K2",
      status: "confirmed",
      start_at: "2026-11-10T10:00:00+07:00",
      end_at: "2026-11-10T11:30:00+07:00",
      customer_name: "  Siti Rahayu ",
      service_name: "Gel Polish",
    });

    const url = new URL(first?.contact_url ?? "");
    expect(url.pathname).toBe("/6281234567890");
    const text = url.searchParams.get("text") ?? "";
    expect(text).toContain("Halo Siti,");
    expect(text).toContain("NP-20261110-A7K2");
    expect(text).toContain("Selasa, 10 November 2026 pukul 10.00 WIB");
    expect(text).not.toContain("Cuti pribadi");
  });

  test("scopes the lookup to one artist, or to every artist when none is given", async () => {
    await schedule.checkBlock(input({ artist_id: "a1" }));
    await schedule.checkBlock(input());
    expect(calls.findConflicts).toMatchObject([{ artistId: "a1" }, { artistId: null }]);
  });

  test("an unknown artist is a validation error pointing at artist_id", async () => {
    artistKnown = false;
    const error = await failure(schedule.checkBlock(input({ artist_id: "a1" })));
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details).toEqual([{ field: "artist_id", message: "Nail artist tidak ditemukan" }]);
  });
});

describe("createBlock", () => {
  test("creates a whole-studio block under the schedule lock when nothing overlaps", async () => {
    const created = await schedule.createBlock(input({ reason: "" }));
    expect(calls.lockTaken).toBe(1);
    expect(calls.created).toEqual([
      {
        artistId: null,
        startAt: new Date("2026-11-10T02:00:00Z"),
        endAt: new Date("2026-11-10T05:00:00Z"),
        reason: null,
      },
    ]);
    expect(created).toMatchObject({
      id: "slot-1",
      artist_id: null,
      start_at: "2026-11-10T09:00:00+07:00",
      end_at: "2026-11-10T12:00:00+07:00",
      reason: null,
      affected_bookings: [],
    });
  });

  test("refuses with 409 BLOCK_HAS_BOOKINGS and creates nothing when bookings overlap", async () => {
    conflicts = [conflict()];
    const error = await failure(schedule.createBlock(input()));
    expect(error.code).toBe("BLOCK_HAS_BOOKINGS");
    expect(error.httpStatus).toBe(409);
    expect(error.conflicts).toHaveLength(1);
    expect(calls.created).toHaveLength(0);
  });

  test("with acknowledge_conflicts it creates the block, cancels nothing, and returns the affected bookings", async () => {
    conflicts = [conflict(), conflict({ id: "b2", bookingCode: "NP-20261110-B8L3", status: "pending" })];
    const created = await schedule.createBlock(input({ acknowledge_conflicts: true, artist_id: "a1" }));
    expect(calls.created).toHaveLength(1);
    expect(created.affected_bookings.map((b) => b.booking_code)).toEqual(["NP-20261110-A7K2", "NP-20261110-B8L3"]);
    expect(created.artist_id).toBe("a1");
  });

  test("an unknown artist fails before taking the lock", async () => {
    artistKnown = false;
    const error = await failure(schedule.createBlock(input({ artist_id: "a1" })));
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(calls.lockTaken).toBe(0);
  });
});

describe("deleteBlock", () => {
  test("resolves when the block existed and is a 404 otherwise", async () => {
    await schedule.deleteBlock("slot-1");
    deleteResult = false;
    const error = await failure(schedule.deleteBlock("slot-1"));
    expect([error.code, error.httpStatus]).toEqual(["NOT_FOUND", 404]);
  });
});
