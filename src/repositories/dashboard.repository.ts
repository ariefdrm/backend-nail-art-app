import { getPrisma } from "../utils/prisma.js";

export interface DashboardRange {
  from: Date;
  /** Exclusive. */
  to: Date;
}

export interface DashboardStats {
  /** Booking count per status; a status with no bookings is absent. */
  byStatus: Record<string, number>;
  onlineCount: number;
  revenueCompleted: number;
  /** Average minutes from creation to confirmation (online bookings only); null when there are none. */
  avgConfirmationMinutes: number | null;
}

/** Aggregates for bookings whose start_at falls in [from, to). Every number is computed by the database. */
export async function getDashboardStats(range: DashboardRange): Promise<DashboardStats> {
  const prisma = getPrisma();
  const inRange = { startAt: { gte: range.from, lt: range.to } };

  const [groups, onlineCount, revenue, confirmation] = await Promise.all([
    prisma.booking.groupBy({ by: ["status"], where: inRange, _count: { _all: true } }),
    prisma.booking.count({ where: { ...inRange, source: "online" } }),
    prisma.booking.aggregate({ where: { ...inRange, status: "completed" }, _sum: { totalPrice: true } }),
    // Raw SQL: Prisma cannot average a difference between two columns.
    prisma.$queryRaw<{ avg: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM (confirmed_at - created_at)) / 60)::float8 AS avg
      FROM bookings
      WHERE source = 'online'
        AND confirmed_at IS NOT NULL
        AND start_at >= ${range.from}
        AND start_at < ${range.to}`,
  ]);

  return {
    byStatus: Object.fromEntries(groups.map((g) => [g.status, g._count._all])),
    onlineCount,
    revenueCompleted: revenue._sum.totalPrice ?? 0,
    avgConfirmationMinutes: confirmation[0]?.avg ?? null,
  };
}
