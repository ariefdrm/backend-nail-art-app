import type { BookingStatus } from "../generated/prisma/enums.js";
import { getPrisma } from "../utils/prisma.js";

export interface ExportFilter {
  from?: Date | undefined;
  /** Exclusive. */
  to?: Date | undefined;
  status?: string | undefined;
}

/** Position after the last row of the previous batch; rows are ordered by (start_at, id). */
export interface ExportCursor {
  startAt: Date;
  id: string;
}

/** One batch of bookings with what the export needs, in a stable order so batches never overlap or skip. */
export function findBookingsForExport(filter: ExportFilter, after: ExportCursor | undefined, take: number) {
  return getPrisma().booking.findMany({
    where: {
      ...(filter.from || filter.to
        ? { startAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } }
        : {}),
      ...(filter.status ? { status: filter.status as BookingStatus } : {}),
      ...(after ? { OR: [{ startAt: { gt: after.startAt } }, { startAt: after.startAt, id: { gt: after.id } }] } : {}),
    },
    select: {
      id: true,
      status: true,
      source: true,
      serviceId: true,
      artistId: true,
      startAt: true,
      endAt: true,
      totalPrice: true,
      createdAt: true,
      confirmedAt: true,
      customerPhone: true,
      customerNote: true,
      referenceImageUrl: true,
      service: { select: { name: true, category: true, durationMinutes: true } },
      history: {
        select: { fromStatus: true, toStatus: true, changedBy: true, changedAt: true },
        orderBy: { changedAt: "asc" },
      },
    },
    orderBy: [{ startAt: "asc" }, { id: "asc" }],
    take,
  });
}
