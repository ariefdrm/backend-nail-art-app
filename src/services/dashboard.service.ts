import * as dashboardRepo from "../repositories/dashboard.repository.js";
import { addDays, jakartaDayStart } from "../utils/datetime.js";

const STATUSES = ["pending", "confirmed", "completed", "cancelled", "no_show"] as const;

export interface DashboardSummaryDto {
  period: { date_from: string; date_to: string };
  total_bookings: number;
  by_status: Record<(typeof STATUSES)[number], number>;
  no_show_rate: number | null;
  online_booking_ratio: number | null;
  revenue_completed: number;
  avg_confirmation_minutes: number | null;
}

/** A ratio rounded to 4 decimals, or null when there is nothing to divide by. */
function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 10_000) / 10_000;
}

export async function getSummary(dateFrom: string, dateTo: string): Promise<DashboardSummaryDto> {
  const stats = await dashboardRepo.getDashboardStats({
    from: jakartaDayStart(dateFrom),
    // date_to is inclusive: the range ends when the next day starts
    to: addDays(jakartaDayStart(dateTo), 1),
  });

  const byStatus = Object.fromEntries(STATUSES.map((status) => [status, stats.byStatus[status] ?? 0])) as Record<
    (typeof STATUSES)[number],
    number
  >;
  const total = STATUSES.reduce((sum, status) => sum + byStatus[status], 0);

  return {
    period: { date_from: dateFrom, date_to: dateTo },
    total_bookings: total,
    by_status: byStatus,
    // Only visits that were due count: pending, confirmed and cancelled bookings say nothing about no-shows.
    no_show_rate: ratio(byStatus.no_show, byStatus.completed + byStatus.no_show),
    online_booking_ratio: ratio(stats.onlineCount, total),
    revenue_completed: stats.revenueCompleted,
    avg_confirmation_minutes:
      stats.avgConfirmationMinutes === null ? null : Math.round(stats.avgConfirmationMinutes * 10) / 10,
  };
}
