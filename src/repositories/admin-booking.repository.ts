import type { BookingStatus } from "../generated/prisma/enums.js";
import { getPrisma } from "../utils/prisma.js";
import { ACTIVE_BOOKING_STATUSES } from "./booking.repository.js";

export { findBookableService } from "./booking.repository.js";
import { SCHEDULE_LOCK_KEY } from "./schedule-lock.js";

const withRelations = { service: true, artist: true } as const;

export interface BookingFilter {
  from?: Date | undefined;
  to?: Date | undefined;
  status?: BookingStatus | undefined;
  artistId?: string | undefined;
  /** Free text: matched against the customer name and the booking code. */
  q?: string | undefined;
  /** Digits (country code form, e.g. 62812...) matched against the stored E.164 phone. */
  phoneFragment?: string | undefined;
}

export async function listBookings(filter: BookingFilter, page: number, perPage: number) {
  const search = [
    ...(filter.q
      ? [
          { customerName: { contains: filter.q, mode: "insensitive" as const } },
          { bookingCode: { contains: filter.q, mode: "insensitive" as const } },
        ]
      : []),
    ...(filter.phoneFragment ? [{ customerPhone: { contains: filter.phoneFragment } }] : []),
  ];
  const where = {
    ...(filter.from || filter.to
      ? { startAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } }
      : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.artistId ? { artistId: filter.artistId } : {}),
    ...(search.length > 0 ? { OR: search } : {}),
  };
  const prisma = getPrisma();
  const [rows, total] = await prisma.$transaction([
    prisma.booking.findMany({
      where,
      include: withRelations,
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.booking.count({ where }),
  ]);
  return { rows, total };
}

export function findBookingById(id: string) {
  return getPrisma().booking.findUnique({ where: { id }, include: withRelations });
}

/** Blocked slots overlapping [from, to): used to flag schedule conflicts without one query per booking. */
export function findBlockedSlotsBetween(from: Date, to: Date) {
  return getPrisma().blockedSlot.findMany({ where: { startAt: { lt: to }, endAt: { gt: from } } });
}

export interface NotesPatch {
  customerNote?: string | null | undefined;
  adminNote?: string | null | undefined;
}

/** Returns null when the booking does not exist. */
export async function updateNotes(id: string, patch: NotesPatch) {
  const result = await getPrisma().booking.updateMany({
    where: { id },
    data: {
      ...(patch.customerNote !== undefined ? { customerNote: patch.customerNote } : {}),
      ...(patch.adminNote !== undefined ? { adminNote: patch.adminNote } : {}),
    },
  });
  return result.count === 0 ? null : findBookingById(id);
}

export interface ReschedulePatch extends NotesPatch {
  serviceId: string;
  artistId: string;
  startAt: Date;
  endAt: Date;
  totalPrice: number;
}

export type RescheduleResult =
  | { kind: "updated"; booking: NonNullable<Awaited<ReturnType<typeof findBookingById>>> }
  | { kind: "refused"; reason: "blocked" | "buffer_conflict" }
  | { kind: "not_found" }
  | { kind: "not_active" };

/**
 * Moves an active booking under the schedule advisory lock, re-checking blocked slots and the booking buffer
 * (ignoring the booking itself) now that nobody else can interleave. An overlap that still slips through is
 * stopped by the database constraint and surfaces as an error the caller maps to SLOT_UNAVAILABLE.
 */
export function rescheduleLocked(id: string, patch: ReschedulePatch, bufferMinutes: number): Promise<RescheduleResult> {
  return getPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SCHEDULE_LOCK_KEY}::bigint)`;

    const current = await tx.booking.findUnique({ where: { id }, select: { status: true } });
    if (!current) return { kind: "not_found" } as const;
    if (!(ACTIVE_BOOKING_STATUSES as readonly string[]).includes(current.status))
      return { kind: "not_active" } as const;

    const blocked = await tx.blockedSlot.count({
      where: {
        OR: [{ artistId: null }, { artistId: patch.artistId }],
        startAt: { lt: patch.endAt },
        endAt: { gt: patch.startAt },
      },
    });
    if (blocked > 0) return { kind: "refused", reason: "blocked" } as const;

    const bufferMs = bufferMinutes * 60_000;
    const tooClose = await tx.booking.count({
      where: {
        id: { not: id },
        artistId: patch.artistId,
        status: { in: [...ACTIVE_BOOKING_STATUSES] },
        startAt: { lt: new Date(patch.endAt.getTime() + bufferMs) },
        endAt: { gt: new Date(patch.startAt.getTime() - bufferMs) },
      },
    });
    if (tooClose > 0) return { kind: "refused", reason: "buffer_conflict" } as const;

    const booking = await tx.booking.update({
      where: { id },
      data: {
        serviceId: patch.serviceId,
        artistId: patch.artistId,
        startAt: patch.startAt,
        endAt: patch.endAt,
        totalPrice: patch.totalPrice,
        ...(patch.customerNote !== undefined ? { customerNote: patch.customerNote } : {}),
        ...(patch.adminNote !== undefined ? { adminNote: patch.adminNote } : {}),
      },
      include: withRelations,
    });
    return { kind: "updated", booking } as const;
  });
}

export interface StatusChange {
  changedBy: string;
  reason: string | null;
  confirmedAt?: Date | undefined;
  cancelReason?: string | null | undefined;
}

/**
 * Moves a booking from `from` to `to` and writes the history row, in one transaction. The update only matches
 * while the booking is still in `from`, so two admins acting at once cannot both succeed (null = lost the race).
 */
export function transitionStatus(id: string, fromStatus: string, toStatus: string, change: StatusChange) {
  const from = fromStatus as BookingStatus;
  const to = toStatus as BookingStatus;
  return getPrisma().$transaction(async (tx) => {
    const result = await tx.booking.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        ...(change.confirmedAt ? { confirmedAt: change.confirmedAt } : {}),
        ...(change.cancelReason !== undefined ? { cancelReason: change.cancelReason } : {}),
      },
    });
    if (result.count === 0) return null;
    await tx.bookingStatusHistory.create({
      data: { bookingId: id, fromStatus: from, toStatus: to, changedBy: change.changedBy, reason: change.reason },
    });
    return tx.booking.findUniqueOrThrow({ where: { id }, include: withRelations });
  });
}
