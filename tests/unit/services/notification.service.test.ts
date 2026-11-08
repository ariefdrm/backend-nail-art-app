import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppError } from "../../../src/utils/errors.js";

const ADMIN = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-11-09T01:00:00Z"); // Monday 08:00 WIB
const START = new Date("2026-11-10T03:00:00Z");

const bookingRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  bookingCode: `NP-20261110-${id.toUpperCase()}`,
  customerName: "Siti Rahayu",
  startAt: START,
  service: { name: "Gel Polish" },
  ...overrides,
});

const notificationRow = (id: string, readAt?: Date) => ({
  id,
  type: "new_booking",
  title: "Reservasi baru",
  body: "isi",
  bookingId: "b1",
  createdAt: new Date("2026-11-08T01:00:00Z"),
  reads: readAt ? [{ readAt }] : [],
});

let listed: { rows: ReturnType<typeof notificationRow>[]; total: number };
let found: ReturnType<typeof notificationRow> | null;
let unreadCount: number;
let marked: number;
let unconfirmed: ReturnType<typeof bookingRow>[];
let upcoming: ReturnType<typeof bookingRow>[];
let blocks: { artistId: string | null; startAt: Date; endAt: Date }[];
let conflictsByBlock: ReturnType<typeof bookingRow>[][];
const calls = {
  list: [] as unknown[][],
  count: [] as unknown[][],
  markRead: [] as unknown[][],
  markAll: [] as unknown[][],
  unconfirmedQuery: [] as unknown[][],
  upcomingQuery: [] as unknown[][],
  conflictQuery: [] as unknown[][],
  inserted: [] as { type: string; dedupeKey: string; bookingId?: string | null; body: string }[][],
};

await mock.module("../../../src/repositories/notification.repository.js", () => ({
  listForAdmin: (...args: unknown[]) => {
    calls.list.push(args);
    return Promise.resolve(listed);
  },
  countUnread: (...args: unknown[]) => {
    calls.count.push(args);
    return Promise.resolve(unreadCount);
  },
  findNotification: () => Promise.resolve(found),
  markRead: (...args: unknown[]) => {
    calls.markRead.push(args);
    if (found) found = { ...found, reads: [{ readAt: NOW }] };
    return Promise.resolve();
  },
  markAllRead: (...args: unknown[]) => {
    calls.markAll.push(args);
    return Promise.resolve(marked);
  },
  findUnconfirmedCandidates: (...args: unknown[]) => {
    calls.unconfirmedQuery.push(args);
    return Promise.resolve(unconfirmed);
  },
  findUpcomingCandidates: (...args: unknown[]) => {
    calls.upcomingQuery.push(args);
    return Promise.resolve(upcoming);
  },
  findBlockedSlotsEndingAfter: () => Promise.resolve(blocks),
  findConflictingBookings: (...args: unknown[]) => {
    calls.conflictQuery.push(args);
    return Promise.resolve(conflictsByBlock[calls.conflictQuery.length - 1] ?? []);
  },
  insertNew: (rows: (typeof calls.inserted)[number]) => {
    calls.inserted.push(rows);
    return Promise.resolve(rows.length);
  },
}));

const service = await import("../../../src/services/notification.service.js");

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error("expected the call to fail");
}

beforeEach(() => {
  listed = { rows: [notificationRow("n1"), notificationRow("n2", NOW)], total: 2 };
  found = notificationRow("n1");
  unreadCount = 3;
  marked = 4;
  unconfirmed = [];
  upcoming = [];
  blocks = [];
  conflictsByBlock = [];
  for (const key of Object.keys(calls) as (keyof typeof calls)[]) calls[key].length = 0;
});

describe("inbox", () => {
  test("lists the last 30 days for this admin, with the read state of this admin", async () => {
    const result = await service.listNotifications(ADMIN, { unread: true, page: 2, per_page: 10 }, NOW);
    const [admin, filter, page, perPage] = calls.list[0] as [
      string,
      { since: Date; unreadOnly: boolean },
      number,
      number,
    ];
    expect(admin).toBe(ADMIN);
    expect(filter).toEqual({ since: new Date("2026-10-10T01:00:00Z"), unreadOnly: true });
    expect([page, perPage]).toEqual([2, 10]);
    expect(result.meta).toEqual({ page: 2, per_page: 10, total: 2, total_pages: 1 });
    expect(result.data[0]).toMatchObject({ id: "n1", read: false, read_at: null, booking_id: "b1" });
    expect(result.data[1]).toMatchObject({ id: "n2", read: true, read_at: "2026-11-09T08:00:00+07:00" });
    expect(result.data[0]?.created_at).toBe("2026-11-08T08:00:00+07:00");
  });

  test("counts unread within the same 30 days", async () => {
    expect(await service.getUnreadCount(ADMIN, NOW)).toEqual({ unread: 3 });
    expect(calls.count[0]).toEqual([ADMIN, new Date("2026-10-10T01:00:00Z")]);
  });

  test("reading marks it for this admin only and returns it as read", async () => {
    const dto = await service.markRead(ADMIN, "n1");
    expect(calls.markRead[0]).toEqual(["n1", ADMIN]);
    expect(dto).toMatchObject({ id: "n1", read: true });
  });

  test("404 for a notification that does not exist, without marking anything", async () => {
    found = null;
    expect((await failure(service.markRead(ADMIN, "nope"))).httpStatus).toBe(404);
    expect(calls.markRead).toHaveLength(0);
  });

  test("read-all reports how many were newly marked", async () => {
    expect(await service.markAllRead(ADMIN, NOW)).toEqual({ marked: 4 });
    expect(calls.markAll[0]).toEqual([ADMIN, new Date("2026-10-10T01:00:00Z")]);
  });
});

describe("runSchedulerTick", () => {
  const options = { now: NOW, unconfirmedAfterMinutes: 15, upcomingMinutesBefore: 120 };

  test("asks for pending bookings older than the wait and confirmed ones starting within the window", async () => {
    await service.runSchedulerTick(options);
    const [createdBefore, now] = calls.unconfirmedQuery[0] as [Date, Date];
    expect(createdBefore).toEqual(new Date("2026-11-09T00:45:00Z")); // now - 15 min
    expect(now).toEqual(NOW);
    const [from, until] = calls.upcomingQuery[0] as [Date, Date];
    expect(from).toEqual(NOW);
    expect(until).toEqual(new Date("2026-11-09T03:00:00Z")); // now + 120 min
  });

  test("creates one keyed notification per candidate and reports how many were new", async () => {
    unconfirmed = [bookingRow("u1"), bookingRow("u2")];
    upcoming = [bookingRow("p1")];
    const result = await service.runSchedulerTick(options);
    expect(result).toEqual({ unconfirmed: 2, upcoming: 1, conflicts: 0 });
    const keys = calls.inserted.flat().map((n) => n.dedupeKey);
    expect(keys).toEqual(["unconfirmed_reminder:u1", "unconfirmed_reminder:u2", "upcoming_reminder:p1"]);
    expect(calls.inserted[0]?.[0]).toMatchObject({ type: "unconfirmed_reminder", bookingId: "u1" });
    expect(calls.inserted[0]?.[0]?.body).toContain("lebih dari 15 menit");
  });

  test("flags a booking under two blocks only once", async () => {
    blocks = [
      { artistId: null, startAt: START, endAt: new Date(START.getTime() + 3600_000) },
      { artistId: "a1", startAt: START, endAt: new Date(START.getTime() + 7200_000) },
    ];
    const clash = bookingRow("c1");
    conflictsByBlock = [[clash], [clash, bookingRow("c2")]];
    const result = await service.runSchedulerTick(options);
    expect(result.conflicts).toBe(2);
    expect(calls.conflictQuery).toHaveLength(2);
    const keys = calls.inserted.flat().map((n) => n.dedupeKey);
    expect(keys.filter((k) => k.startsWith("schedule_conflict:")).sort()).toEqual([
      "schedule_conflict:c1",
      "schedule_conflict:c2",
    ]);
  });

  test("with nothing due it writes nothing", async () => {
    expect(await service.runSchedulerTick(options)).toEqual({ unconfirmed: 0, upcoming: 0, conflicts: 0 });
  });

  test("notification text never carries a phone number", async () => {
    unconfirmed = [bookingRow("u1", { customerPhone: "+6281234567890" })];
    await service.runSchedulerTick(options);
    expect(JSON.stringify(calls.inserted)).not.toContain("81234567890");
  });
});
