import type { PrismaClient } from "../generated/prisma/client.js";
import { getPrisma } from "../utils/prisma.js";

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
