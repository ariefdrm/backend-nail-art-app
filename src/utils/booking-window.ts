import { addDays, jakartaDayStart, toJakartaIso } from "./datetime.js";
import { AppError } from "./errors.js";

/**
 * A booking start must lie in the future and no further ahead than `maxAdvanceDays`
 * (counted in WIB calendar days). Throws a 422 pointing at `field`.
 */
export function assertStartInWindow(startAt: Date, now: Date, maxAdvanceDays: number, field = "start_at"): void {
  if (startAt.getTime() <= now.getTime()) {
    throw AppError.validation([{ field, message: "Waktu mulai harus di masa depan" }]);
  }
  const today = jakartaDayStart(toJakartaIso(now).slice(0, 10));
  const startDay = jakartaDayStart(toJakartaIso(startAt).slice(0, 10));
  if (startDay.getTime() > addDays(today, maxAdvanceDays).getTime()) {
    throw AppError.validation([{ field, message: `Tanggal maksimal ${maxAdvanceDays} hari dari hari ini` }]);
  }
}
