import { findActiveBookingsOverlapping, type TimeRange } from "./booking.repository.js";
import { getPrisma } from "../utils/prisma.js";

/**
 * Key of the PostgreSQL advisory lock that serializes every code path which must not
 * run concurrently with the others: creating a blocked slot (it checks for bookings)
 * and, in the booking module, creating a booking (it checks for blocked slots).
 * Without it a block and a booking created at the same instant could both succeed.
 */
export const SCHEDULE_LOCK_KEY = 726_001;

export interface BusinessHourData {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
}

export interface BlockedSlotData {
  artistId: string | null;
  startAt: Date;
  endAt: Date;
  reason: string | null;
}

// --- business hours ---

export function listBusinessHours() {
  return getPrisma().businessHour.findMany({ orderBy: { dayOfWeek: "asc" } });
}

/** Replaces all weekdays atomically: either every row is written or none. */
export async function replaceBusinessHours(rows: BusinessHourData[]) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    for (const { dayOfWeek, ...rest } of rows) {
      await tx.businessHour.upsert({
        where: { dayOfWeek },
        create: { dayOfWeek, ...rest },
        update: rest,
      });
    }
    return tx.businessHour.findMany({ orderBy: { dayOfWeek: "asc" } });
  });
}

// --- blocked slots ---

/** Blocked slots overlapping [from, to), ordered by start. Either bound may be omitted. */
export function listBlockedSlots(range: { from?: Date | undefined; to?: Date | undefined }) {
  return getPrisma().blockedSlot.findMany({
    where: {
      ...(range.to ? { startAt: { lt: range.to } } : {}),
      ...(range.from ? { endAt: { gt: range.from } } : {}),
    },
    orderBy: { startAt: "asc" },
  });
}

/** Returns false when the blocked slot does not exist. */
export async function deleteBlockedSlot(id: string): Promise<boolean> {
  const result = await getPrisma().blockedSlot.deleteMany({ where: { id } });
  return result.count > 0;
}

/** Lets a blocked slot name an artist without depending on the catalog module. */
export async function artistExists(id: string): Promise<boolean> {
  return (await getPrisma().artist.count({ where: { id } })) > 0;
}

/** Read-only conflict lookup (no lock): used by the preview endpoint. */
export function findConflicts(range: TimeRange) {
  return findActiveBookingsOverlapping(range);
}

export interface ScheduleTx {
  findConflicts(range: TimeRange): ReturnType<typeof findActiveBookingsOverlapping>;
  createBlockedSlot(data: BlockedSlotData): Promise<{
    id: string;
    artistId: string | null;
    startAt: Date;
    endAt: Date;
    reason: string | null;
  }>;
}

/**
 * Runs `fn` in one transaction holding the schedule advisory lock, so the conflict check
 * and the insert cannot interleave with another block or booking being created.
 */
export function withScheduleLock<T>(fn: (tx: ScheduleTx) => Promise<T>): Promise<T> {
  return getPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SCHEDULE_LOCK_KEY}::bigint)`;
    return fn({
      findConflicts: (range) => findActiveBookingsOverlapping(range, tx),
      createBlockedSlot: (data) => tx.blockedSlot.create({ data }),
    });
  });
}
