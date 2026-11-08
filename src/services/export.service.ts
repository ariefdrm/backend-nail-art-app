import { getEnv } from "../config/env.js";
import * as exportRepo from "../repositories/export.repository.js";
import { addDays, jakartaDayStart, toJakartaIso } from "../utils/datetime.js";
import { csvRow, type CsvValue } from "../utils/csv.js";
import { customerRef } from "../utils/pseudonym.js";

const BATCH_SIZE = 500;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

// Structural row type: the repository returns Prisma rows, but this layer must not import Prisma.
interface ExportRow {
  id: string;
  status: string;
  source: string;
  serviceId: string;
  artistId: string;
  startAt: Date;
  endAt: Date;
  totalPrice: number;
  createdAt: Date;
  confirmedAt: Date | null;
  customerPhone: string;
  customerNote: string | null;
  referenceImageUrl: string | null;
  service: { name: string; category: string; durationMinutes: number };
  history: { fromStatus: string | null; toStatus: string; changedBy: string | null; changedAt: Date }[];
}

export interface ExportQuery {
  date_from?: string | undefined;
  date_to?: string | undefined;
  status?: string | undefined;
}

export interface ExportOptions {
  /** Key for customer_ref; defaults to the server's refresh-token secret. */
  secret?: string;
  batchSize?: number;
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Who cancelled it: an admin (the history row carries an admin id) or the customer/system (it does not). */
function cancelledBy(row: ExportRow): string | null {
  if (row.status !== "cancelled") return null;
  const change = [...row.history].reverse().find((h) => h.toStatus === "cancelled");
  return change?.changedBy ? "admin" : "customer";
}

const COLUMNS: { name: string; value: (row: ExportRow, secret: string) => CsvValue }[] = [
  { name: "booking_id", value: (r) => r.id },
  { name: "status", value: (r) => r.status },
  { name: "source", value: (r) => r.source },
  { name: "service_id", value: (r) => r.serviceId },
  { name: "service_name", value: (r) => r.service.name },
  { name: "service_category", value: (r) => r.service.category },
  { name: "artist_id", value: (r) => r.artistId },
  { name: "start_at", value: (r) => toJakartaIso(r.startAt) },
  { name: "end_at", value: (r) => toJakartaIso(r.endAt) },
  { name: "duration_minutes", value: (r) => r.service.durationMinutes },
  { name: "total_price", value: (r) => r.totalPrice },
  { name: "created_at", value: (r) => toJakartaIso(r.createdAt) },
  { name: "confirmed_at", value: (r) => (r.confirmedAt ? toJakartaIso(r.confirmedAt) : null) },
  { name: "lead_time_hours", value: (r) => round((r.startAt.getTime() - r.createdAt.getTime()) / HOUR_MS, 2) },
  {
    name: "confirmation_minutes",
    value: (r) => (r.confirmedAt ? round((r.confirmedAt.getTime() - r.createdAt.getTime()) / MINUTE_MS, 1) : null),
  },
  { name: "has_reference_image", value: (r) => r.referenceImageUrl !== null },
  { name: "has_customer_note", value: (r) => r.customerNote !== null && r.customerNote !== "" },
  { name: "customer_ref", value: (r, secret) => customerRef(r.customerPhone, secret) },
  { name: "status_changes", value: (r) => r.history.filter((h) => h.fromStatus !== null).length },
  {
    name: "last_status_change_at",
    value: (r) => {
      const last = r.history.at(-1);
      return last ? toJakartaIso(last.changedAt) : null;
    },
  },
  { name: "cancelled_by", value: cancelledBy },
];

/** Download name, e.g. bookings_2026-03-01_2026-03-31.csv; an open end is written as "all"/"start". */
export function exportFilename(query: ExportQuery): string {
  const parts = [query.date_from ?? "start", query.date_to ?? "all"];
  const status = query.status ? `_${query.status}` : "";
  return `bookings_${parts.join("_")}${status}.csv`;
}

/**
 * The CSV, line by line: the header, then one line per booking, read from the database in batches so a large
 * history never has to fit in memory. The first batch is read before the header is yielded, so a database error at
 * the start can still become a normal error response.
 */
export async function* exportBookings(query: ExportQuery, options: ExportOptions = {}): AsyncGenerator<string> {
  const secret = options.secret ?? getEnv().JWT_REFRESH_SECRET;
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const filter = {
    from: query.date_from ? jakartaDayStart(query.date_from) : undefined,
    // date_to is inclusive: the range ends when the next day starts
    to: query.date_to ? addDays(jakartaDayStart(query.date_to), 1) : undefined,
    status: query.status,
  };

  let batch: ExportRow[] = await exportRepo.findBookingsForExport(filter, undefined, batchSize);
  yield csvRow(COLUMNS.map((column) => column.name));

  while (batch.length > 0) {
    for (const row of batch) yield csvRow(COLUMNS.map((column) => column.value(row, secret)));
    if (batch.length < batchSize) return;
    const last = batch[batch.length - 1] as ExportRow;
    batch = await exportRepo.findBookingsForExport(filter, { startAt: last.startAt, id: last.id }, batchSize);
  }
}
