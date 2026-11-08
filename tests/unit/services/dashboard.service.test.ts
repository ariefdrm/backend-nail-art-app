import { beforeEach, describe, expect, mock, test } from "bun:test";

let stats: {
  byStatus: Record<string, number>;
  onlineCount: number;
  revenueCompleted: number;
  avgConfirmationMinutes: number | null;
};
const ranges: { from: Date; to: Date }[] = [];

await mock.module("../../../src/repositories/dashboard.repository.js", () => ({
  getDashboardStats: (range: { from: Date; to: Date }) => {
    ranges.push(range);
    return Promise.resolve(stats);
  },
}));

const { getSummary } = await import("../../../src/services/dashboard.service.js");

beforeEach(() => {
  ranges.length = 0;
  stats = { byStatus: {}, onlineCount: 0, revenueCompleted: 0, avgConfirmationMinutes: null };
});

describe("getSummary", () => {
  test("asks for the WIB days inclusively: from 00:00 of date_from until the end of date_to", async () => {
    await getSummary("2026-03-10", "2026-03-11");
    expect(ranges[0]).toEqual({
      from: new Date("2026-03-10T00:00:00+07:00"),
      to: new Date("2026-03-12T00:00:00+07:00"),
    });
  });

  test("an empty period is all zeros and nulls, not NaN", async () => {
    expect(await getSummary("2026-03-10", "2026-03-10")).toEqual({
      period: { date_from: "2026-03-10", date_to: "2026-03-10" },
      total_bookings: 0,
      by_status: { pending: 0, confirmed: 0, completed: 0, cancelled: 0, no_show: 0 },
      no_show_rate: null,
      online_booking_ratio: null,
      revenue_completed: 0,
      avg_confirmation_minutes: null,
    });
  });

  test("totals every status and measures no-shows against visits that were due", async () => {
    stats = {
      byStatus: { pending: 1, confirmed: 2, completed: 5, cancelled: 3, no_show: 1 },
      onlineCount: 9,
      revenueCompleted: 750000,
      avgConfirmationMinutes: 22.46,
    };
    const summary = await getSummary("2026-03-01", "2026-03-31");
    expect(summary.total_bookings).toBe(12);
    expect(summary.by_status).toEqual({ pending: 1, confirmed: 2, completed: 5, cancelled: 3, no_show: 1 });
    expect(summary.no_show_rate).toBe(0.1667); // 1 / (5 + 1), rounded to 4 decimals
    expect(summary.online_booking_ratio).toBe(0.75); // 9 / 12
    expect(summary.revenue_completed).toBe(750000);
    expect(summary.avg_confirmation_minutes).toBe(22.5);
  });

  test("no_show_rate is null until a booking has been completed or missed", async () => {
    stats = { ...stats, byStatus: { pending: 2, cancelled: 1 }, onlineCount: 3 };
    const summary = await getSummary("2026-03-01", "2026-03-31");
    expect(summary.no_show_rate).toBeNull();
    expect(summary.online_booking_ratio).toBe(1);
  });

  test("a zero average confirmation time is kept (it is a value, not missing data)", async () => {
    stats = { ...stats, avgConfirmationMinutes: 0 };
    expect((await getSummary("2026-03-01", "2026-03-01")).avg_confirmation_minutes).toBe(0);
  });
});
