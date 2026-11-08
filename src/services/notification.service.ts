import { getEnv } from "../config/env.js";
import * as notificationRepo from "../repositories/notification.repository.js";
import { addDays, toJakartaIso } from "../utils/datetime.js";
import { AppError } from "../utils/errors.js";
import { buildPagination, type Pagination } from "../utils/response.js";
import {
  conflictContent,
  unconfirmedContent,
  upcomingContent,
  type NotificationContent,
} from "./notification.messages.js";

/** The inbox shows the last 30 days, so a new admin does not open to years of history. */
const VISIBLE_DAYS = 30;
/** Most notifications of one kind created in a single scheduler run; the rest follow on the next run. */
const BATCH = 100;
const MINUTE_MS = 60_000;

// Structural row types: repositories return Prisma rows, but this layer must not import Prisma.
interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  bookingId: string | null;
  createdAt: Date;
  /** Only this admin's read row, if any. */
  reads: { readAt: Date }[];
}

interface BookingFactsRow {
  id: string;
  bookingCode: string;
  customerName: string;
  startAt: Date;
  service: { name: string };
}

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  booking_id: string | null;
  created_at: string;
  read: boolean;
  read_at: string | null;
}

function toDto(row: NotificationRow): NotificationDto {
  const read = row.reads[0];
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    booking_id: row.bookingId,
    created_at: toJakartaIso(row.createdAt),
    read: read !== undefined,
    read_at: read ? toJakartaIso(read.readAt) : null,
  };
}

const visibleSince = (now: Date) => addDays(now, -VISIBLE_DAYS);

// --- the admin's inbox ---

export interface ListQuery {
  unread: boolean;
  page: number;
  per_page: number;
}

export async function listNotifications(
  adminId: string,
  query: ListQuery,
  now: Date = new Date(),
): Promise<{ data: NotificationDto[]; meta: Pagination }> {
  const { rows, total } = await notificationRepo.listForAdmin(
    adminId,
    { since: visibleSince(now), unreadOnly: query.unread },
    query.page,
    query.per_page,
  );
  return { data: rows.map(toDto), meta: buildPagination(query.page, query.per_page, total) };
}

export async function getUnreadCount(adminId: string, now: Date = new Date()): Promise<{ unread: number }> {
  return { unread: await notificationRepo.countUnread(adminId, visibleSince(now)) };
}

export async function markRead(adminId: string, id: string): Promise<NotificationDto> {
  const row = await notificationRepo.findNotification(id, adminId);
  if (!row) throw AppError.notFound("Notifikasi tidak ditemukan");
  await notificationRepo.markRead(id, adminId);
  const updated = await notificationRepo.findNotification(id, adminId);
  return toDto(updated ?? row);
}

export async function markAllRead(adminId: string, now: Date = new Date()): Promise<{ marked: number }> {
  return { marked: await notificationRepo.markAllRead(adminId, visibleSince(now)) };
}

// --- the scheduler (FR-17) ---

export interface TickOptions {
  now?: Date;
  /** Default to NOTIFY_UNCONFIRMED_AFTER_MINUTES / NOTIFY_UPCOMING_MINUTES_BEFORE. */
  unconfirmedAfterMinutes?: number;
  upcomingMinutesBefore?: number;
}

export interface TickResult {
  unconfirmed: number;
  upcoming: number;
  conflicts: number;
}

function toRow(content: NotificationContent, bookingId: string) {
  return { ...content, bookingId };
}

/**
 * One scheduler run: creates the reminders that are due and have not been created yet. Safe to run as often as
 * you like, or from two instances at once: every notification has a unique key (type + booking), so a repeat
 * is skipped by the database instead of duplicated.
 */
export async function runSchedulerTick(options: TickOptions = {}): Promise<TickResult> {
  const needsEnv = options.unconfirmedAfterMinutes === undefined || options.upcomingMinutesBefore === undefined;
  const env = needsEnv ? getEnv() : undefined;
  const unconfirmedAfter = options.unconfirmedAfterMinutes ?? env?.NOTIFY_UNCONFIRMED_AFTER_MINUTES ?? 15;
  const upcomingBefore = options.upcomingMinutesBefore ?? env?.NOTIFY_UPCOMING_MINUTES_BEFORE ?? 120;
  const now = options.now ?? new Date();

  const facts = (row: BookingFactsRow) => ({
    bookingCode: row.bookingCode,
    customerName: row.customerName,
    serviceName: row.service.name,
    startAt: row.startAt,
  });

  const unconfirmed: BookingFactsRow[] = await notificationRepo.findUnconfirmedCandidates(
    new Date(now.getTime() - unconfirmedAfter * MINUTE_MS),
    now,
    BATCH,
  );
  const upcoming: BookingFactsRow[] = await notificationRepo.findUpcomingCandidates(
    now,
    new Date(now.getTime() + upcomingBefore * MINUTE_MS),
    BATCH,
  );

  // A booking under several blocks is flagged once: the dedupe key is per booking.
  const conflicting = new Map<string, BookingFactsRow>();
  for (const block of await notificationRepo.findBlockedSlotsEndingAfter(now, BATCH)) {
    for (const booking of await notificationRepo.findConflictingBookings(block, now, BATCH)) {
      conflicting.set(booking.id, booking);
    }
  }

  return {
    unconfirmed: await notificationRepo.insertNew(
      unconfirmed.map((row) => toRow(unconfirmedContent(facts(row), row.id, unconfirmedAfter), row.id)),
    ),
    upcoming: await notificationRepo.insertNew(
      upcoming.map((row) => toRow(upcomingContent(facts(row), row.id), row.id)),
    ),
    conflicts: await notificationRepo.insertNew(
      [...conflicting.values()].map((row) => toRow(conflictContent(facts(row), row.id), row.id)),
    ),
  };
}
