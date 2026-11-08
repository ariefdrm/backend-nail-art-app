// Asia/Jakarta (WIB) has no daylight saving time and is always UTC+7, so a fixed offset is exact.
// Using it avoids a date library, and behaves the same on Bun and Node.
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"] as const;
const MONTH_NAMES = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** ISO 8601 with the +07:00 offset, as the API contract requires (e.g. 2026-11-10T10:00:00+07:00). */
export function toJakartaIso(date: Date): string {
  return new Date(date.getTime() + JAKARTA_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, "+07:00");
}

/** Start (00:00 WIB) of a calendar day given as YYYY-MM-DD. */
export function jakartaDayStart(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+07:00`);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Human readable, for messages to customers: "Selasa, 10 November 2026 pukul 10.00 WIB". */
export function formatJakartaLong(date: Date): string {
  const local = new Date(date.getTime() + JAKARTA_OFFSET_MS);
  const day = DAY_NAMES[local.getUTCDay()];
  const month = MONTH_NAMES[local.getUTCMonth()];
  return `${day}, ${local.getUTCDate()} ${month} ${local.getUTCFullYear()} pukul ${pad(local.getUTCHours())}.${pad(local.getUTCMinutes())} WIB`;
}
