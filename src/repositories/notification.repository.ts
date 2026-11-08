import type { NotificationType } from "../generated/prisma/enums.js";
import { getPrisma } from "../utils/prisma.js";

export interface NewNotification {
  type: string;
  title: string;
  body: string;
  dedupeKey: string;
  bookingId?: string | null | undefined;
}

// --- the admin's inbox ---

/** `reads` holds at most one row: the one for this admin. */
function forAdmin(adminId: string) {
  return { reads: { where: { adminId }, select: { readAt: true } } } as const;
}

export async function listForAdmin(
  adminId: string,
  filter: { since: Date; unreadOnly: boolean },
  page: number,
  perPage: number,
) {
  const prisma = getPrisma();
  const where = {
    createdAt: { gte: filter.since },
    ...(filter.unreadOnly ? { reads: { none: { adminId } } } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      include: forAdmin(adminId),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.notification.count({ where }),
  ]);
  return { rows, total };
}

export function countUnread(adminId: string, since: Date) {
  return getPrisma().notification.count({
    where: { createdAt: { gte: since }, reads: { none: { adminId } } },
  });
}

export function findNotification(id: string, adminId: string) {
  return getPrisma().notification.findUnique({ where: { id }, include: forAdmin(adminId) });
}

/** Marks one notification read for this admin; reading it again changes nothing. */
export async function markRead(notificationId: string, adminId: string): Promise<void> {
  await getPrisma().notificationRead.createMany({ data: [{ notificationId, adminId }], skipDuplicates: true });
}

/** Marks every visible unread notification read for this admin. Returns how many were newly marked. */
export function markAllRead(adminId: string, since: Date): Promise<number> {
  return getPrisma().$executeRaw`
    INSERT INTO notification_reads (notification_id, admin_id)
    SELECT n.id, ${adminId}::uuid
    FROM notifications n
    WHERE n.created_at >= ${since}
      AND NOT EXISTS (
        SELECT 1 FROM notification_reads r WHERE r.notification_id = n.id AND r.admin_id = ${adminId}::uuid
      )
    ON CONFLICT DO NOTHING`;
}

// --- the scheduler ---

const bookingFacts = { service: { select: { name: true } } } as const;

/** Online bookings still pending after `createdBefore`, in the future, without a reminder yet. */
export function findUnconfirmedCandidates(createdBefore: Date, now: Date, take: number) {
  return getPrisma().booking.findMany({
    where: {
      status: "pending",
      createdAt: { lte: createdBefore },
      startAt: { gt: now },
      notifications: { none: { type: "unconfirmed_reminder" } },
    },
    include: bookingFacts,
    orderBy: { createdAt: "asc" },
    take,
  });
}

/** Confirmed bookings starting between now and `until`, without a reminder yet. */
export function findUpcomingCandidates(now: Date, until: Date, take: number) {
  return getPrisma().booking.findMany({
    where: {
      status: "confirmed",
      startAt: { gt: now, lte: until },
      notifications: { none: { type: "upcoming_reminder" } },
    },
    include: bookingFacts,
    orderBy: { startAt: "asc" },
    take,
  });
}

/** Blocked slots that have not ended yet; each is checked for bookings it runs over. */
export function findBlockedSlotsEndingAfter(after: Date, take: number) {
  return getPrisma().blockedSlot.findMany({ where: { endAt: { gt: after } }, orderBy: { startAt: "asc" }, take });
}

/** Active future bookings that overlap this blocked slot and have not been flagged as conflicting yet. */
export function findConflictingBookings(
  block: { artistId: string | null; startAt: Date; endAt: Date },
  now: Date,
  take: number,
) {
  return getPrisma().booking.findMany({
    where: {
      status: { in: ["pending", "confirmed"] },
      startAt: { gt: now, lt: block.endAt },
      endAt: { gt: block.startAt },
      ...(block.artistId ? { artistId: block.artistId } : {}),
      notifications: { none: { type: "schedule_conflict" } },
    },
    include: bookingFacts,
    orderBy: { startAt: "asc" },
    take,
  });
}

/** Inserts the rows that do not exist yet (by dedupe key). Returns how many were new. */
export async function insertNew(rows: NewNotification[]): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await getPrisma().notification.createMany({
    data: rows.map((row) => ({
      type: row.type as NotificationType,
      title: row.title,
      body: row.body,
      dedupeKey: row.dedupeKey,
      bookingId: row.bookingId ?? null,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
