import type { PrismaClient } from "../generated/prisma/client.js";
import { getPrisma } from "../utils/prisma.js";
import { SCHEDULE_LOCK_KEY } from "./schedule-lock.js";

/** Bookings that occupy time: only these block a slot or conflict with a blocked range. */
export const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed"] as const;

export interface TimeRange {
  startAt: Date;
  endAt: Date;
  /** null / undefined = every artist (a whole-studio range). */
  artistId?: string | null | undefined;
}

/**
 * Active bookings overlapping a range. Half-open semantics: a booking that ends exactly
 * when the range starts (or starts exactly when it ends) does not overlap.
 * `client` lets a caller run the query inside its own transaction.
 */
export function findActiveBookingsOverlapping(range: TimeRange, client: Pick<PrismaClient, "booking"> = getPrisma()) {
  return client.booking.findMany({
    where: {
      status: { in: [...ACTIVE_BOOKING_STATUSES] },
      startAt: { lt: range.endAt },
      endAt: { gt: range.startAt },
      ...(range.artistId ? { artistId: range.artistId } : {}),
    },
    include: { service: { select: { name: true } } },
    orderBy: { startAt: "asc" },
  });
}

const withRelations = { service: true, artist: true } as const;

export interface NewBooking {
  bookingCode: string;
  serviceId: string;
  artistId: string;
  startAt: Date;
  endAt: Date;
  customerName: string;
  customerPhone: string;
  customerNote: string | null;
  referenceImageUrl: string | null;
  totalPrice: number;
}

/** Why a booking could not be inserted under the schedule lock. */
export type CreateRefusal = "blocked" | "buffer_conflict";

export type CreateResult =
  { created: true; booking: Awaited<ReturnType<typeof insertBooking>> } | { created: false; reason: CreateRefusal };

function insertBooking(tx: Pick<PrismaClient, "booking">, data: NewBooking) {
  return tx.booking.create({
    data: { ...data, history: { create: { fromStatus: null, toStatus: "pending", changedBy: null } } },
    include: withRelations,
  });
}

/**
 * Inserts a booking and its first history row in one transaction holding the schedule advisory lock
 * (the same lock blocked-slot creation takes), after re-checking, now that nobody else can interleave:
 *  - a blocked slot (studio-wide or for this artist) overlapping the range, and
 *  - another active booking of the artist closer than `bufferMinutes` (the DB EXCLUDE constraint only
 *    knows the raw ranges, so the buffer is enforced here).
 * Overlap that slips past both (a path that does not take the lock) is still stopped by the EXCLUDE
 * constraint, which surfaces as a Prisma error the caller maps to SLOT_UNAVAILABLE.
 */
export function createBookingLocked(data: NewBooking, bufferMinutes: number): Promise<CreateResult> {
  return getPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SCHEDULE_LOCK_KEY}::bigint)`;

    const blocked = await tx.blockedSlot.count({
      where: {
        OR: [{ artistId: null }, { artistId: data.artistId }],
        startAt: { lt: data.endAt },
        endAt: { gt: data.startAt },
      },
    });
    if (blocked > 0) return { created: false, reason: "blocked" } as const;

    const bufferMs = bufferMinutes * 60_000;
    const tooClose = await tx.booking.count({
      where: {
        artistId: data.artistId,
        status: { in: [...ACTIVE_BOOKING_STATUSES] },
        startAt: { lt: new Date(data.endAt.getTime() + bufferMs) },
        endAt: { gt: new Date(data.startAt.getTime() - bufferMs) },
      },
    });
    if (tooClose > 0) return { created: false, reason: "buffer_conflict" } as const;

    return { created: true, booking: await insertBooking(tx, data) } as const;
  });
}

export function findBookingByCode(bookingCode: string) {
  return getPrisma().booking.findUnique({ where: { bookingCode }, include: withRelations });
}

/** True when a blocked slot (studio-wide or for this artist) overlaps the range. */
export async function hasBlockedOverlap(range: { artistId: string; startAt: Date; endAt: Date }): Promise<boolean> {
  const count = await getPrisma().blockedSlot.count({
    where: {
      OR: [{ artistId: null }, { artistId: range.artistId }],
      startAt: { lt: range.endAt },
      endAt: { gt: range.startAt },
    },
  });
  return count > 0;
}

/**
 * Cancels a pending/confirmed booking and records the history row. Returns null when the booking is no
 * longer active (someone else changed it first), so a double cancel cannot write two history rows.
 */
export function cancelActiveBooking(id: string, fromStatus: string, reason: string | null) {
  return getPrisma().$transaction(async (tx) => {
    const result = await tx.booking.updateMany({
      where: { id, status: { in: [...ACTIVE_BOOKING_STATUSES] } },
      data: { status: "cancelled", cancelReason: reason },
    });
    if (result.count === 0) return null;
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: id,
        fromStatus: fromStatus as (typeof ACTIVE_BOOKING_STATUSES)[number],
        toStatus: "cancelled",
        changedBy: null,
        reason,
      },
    });
    return tx.booking.findUniqueOrThrow({ where: { id }, include: withRelations });
  });
}

/** The service a customer can book: it must exist and be active. */
export async function findBookableService(id: string) {
  const service = await getPrisma().service.findUnique({ where: { id } });
  return service?.isActive ? service : null;
}
