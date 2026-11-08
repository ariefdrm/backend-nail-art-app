import * as scheduleRepo from "../repositories/schedule.repository.js";
import type { BlockedSlotInput, BusinessHourInput } from "../schemas/schedule.schema.js";
import { addDays, formatJakartaLong, jakartaDayStart, toJakartaIso } from "../utils/datetime.js";
import { AppError } from "../utils/errors.js";
import { STUDIO_NAME, firstName } from "../utils/studio.js";
import { buildWhatsAppUrl } from "../utils/whatsapp.js";

// Structural row types: repositories return Prisma rows, but this layer must not import Prisma.
interface BusinessHourRow {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
}

interface BlockedSlotRow {
  id: string;
  artistId: string | null;
  startAt: Date;
  endAt: Date;
  reason: string | null;
}

interface ConflictRow {
  id: string;
  bookingCode: string;
  status: string;
  startAt: Date;
  endAt: Date;
  customerName: string;
  customerPhone: string;
  service: { name: string };
}

export interface BusinessHourDto {
  day_of_week: number;
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
  break_start: string | null;
  break_end: string | null;
}

export interface BlockedSlotDto {
  id: string;
  artist_id: string | null;
  start_at: string;
  end_at: string;
  reason: string | null;
}

export interface AffectedBookingDto {
  id: string;
  booking_code: string;
  status: string;
  start_at: string;
  end_at: string;
  customer_name: string;
  service_name: string;
  contact_url: string;
}

export type BlockedSlotCreatedDto = BlockedSlotDto & { affected_bookings: AffectedBookingDto[] };

export interface BlockCheckDto {
  can_block: boolean;
  conflicts: AffectedBookingDto[];
}

// --- business hours (FR-09) ---

function toBusinessHourDto(row: BusinessHourRow): BusinessHourDto {
  return {
    day_of_week: row.dayOfWeek,
    is_open: row.isOpen,
    open_time: row.openTime,
    close_time: row.closeTime,
    break_start: row.breakStart,
    break_end: row.breakEnd,
  };
}

/** Always returns the 7 weekdays; a day with no stored row counts as closed. */
export async function getBusinessHours(): Promise<BusinessHourDto[]> {
  const rows = await scheduleRepo.listBusinessHours();
  return fillWeek(rows).map(toBusinessHourDto);
}

function fillWeek(rows: BusinessHourRow[]): BusinessHourRow[] {
  const byDay = new Map(rows.map((row) => [row.dayOfWeek, row]));
  return Array.from(
    { length: 7 },
    (_, day) =>
      byDay.get(day) ?? {
        dayOfWeek: day,
        isOpen: false,
        openTime: null,
        closeTime: null,
        breakStart: null,
        breakEnd: null,
      },
  );
}

/** New hours apply to future slots only; existing bookings are never touched. */
export async function replaceBusinessHours(hours: BusinessHourInput[]): Promise<BusinessHourDto[]> {
  const rows = await scheduleRepo.replaceBusinessHours(
    hours.map((hour) => ({
      dayOfWeek: hour.day_of_week,
      isOpen: hour.is_open,
      openTime: hour.open_time,
      closeTime: hour.close_time,
      breakStart: hour.break_start,
      breakEnd: hour.break_end,
    })),
  );
  return fillWeek(rows).map(toBusinessHourDto);
}

// --- blocked slots (FR-09) ---

function toBlockedSlotDto(row: BlockedSlotRow): BlockedSlotDto {
  return {
    id: row.id,
    artist_id: row.artistId,
    start_at: toJakartaIso(row.startAt),
    end_at: toJakartaIso(row.endAt),
    reason: row.reason,
  };
}

/**
 * The prefilled WhatsApp text. It addresses the customer by first name and never includes the
 * owner's internal reason for the block; the owner can edit it before sending.
 */
function buildContactMessage(row: ConflictRow): string {
  return (
    `Halo ${firstName(row.customerName)}, kami dari ${STUDIO_NAME}. Mohon maaf, jadwal Anda (${row.bookingCode}) pada ` +
    `${formatJakartaLong(row.startAt)} terkena perubahan jadwal studio. Apakah Anda bersedia memilih jadwal ` +
    `pengganti? Jika tidak, kami siap membantu membatalkannya. Terima kasih atas pengertiannya.`
  );
}

function toAffectedBookingDto(row: ConflictRow): AffectedBookingDto {
  return {
    id: row.id,
    booking_code: row.bookingCode,
    status: row.status,
    start_at: toJakartaIso(row.startAt),
    end_at: toJakartaIso(row.endAt),
    customer_name: row.customerName,
    service_name: row.service.name,
    contact_url: buildWhatsAppUrl(row.customerPhone, buildContactMessage(row)),
  };
}

export async function listBlockedSlots(dateFrom?: string, dateTo?: string): Promise<BlockedSlotDto[]> {
  const rows = await scheduleRepo.listBlockedSlots({
    from: dateFrom ? jakartaDayStart(dateFrom) : undefined,
    // date_to is inclusive: the range ends when the next day starts
    to: dateTo ? addDays(jakartaDayStart(dateTo), 1) : undefined,
  });
  return rows.map(toBlockedSlotDto);
}

async function assertArtistExists(artistId: string | null | undefined): Promise<void> {
  if (artistId && !(await scheduleRepo.artistExists(artistId))) {
    throw AppError.validation([{ field: "artist_id", message: "Nail artist tidak ditemukan" }]);
  }
}

/** Preview only: lists the active bookings that the block would overlap; saves nothing. */
export async function checkBlock(input: BlockedSlotInput): Promise<BlockCheckDto> {
  await assertArtistExists(input.artist_id);
  const conflicts = await scheduleRepo.findConflicts({
    startAt: input.start_at,
    endAt: input.end_at,
    artistId: input.artist_id,
  });
  return { can_block: conflicts.length === 0, conflicts: conflicts.map(toAffectedBookingDto) };
}

/**
 * Creates a block. If active bookings overlap it, the caller must pass `acknowledge_conflicts`;
 * otherwise nothing is created and a 409 lists the bookings. Nothing is ever cancelled here: the owner
 * settles each affected booking with the customer. The check and the insert run under the schedule
 * advisory lock, so a booking created at the same moment cannot slip through.
 */
export async function createBlock(input: BlockedSlotInput): Promise<BlockedSlotCreatedDto> {
  await assertArtistExists(input.artist_id);

  return scheduleRepo.withScheduleLock(async (tx) => {
    const conflicts = await tx.findConflicts({
      startAt: input.start_at,
      endAt: input.end_at,
      artistId: input.artist_id,
    });
    const affected = conflicts.map(toAffectedBookingDto);
    if (affected.length > 0 && !input.acknowledge_conflicts) {
      throw AppError.blockHasBookings(affected);
    }

    const slot = await tx.createBlockedSlot({
      artistId: input.artist_id ?? null,
      startAt: input.start_at,
      endAt: input.end_at,
      reason: input.reason || null,
    });
    return { ...toBlockedSlotDto(slot), affected_bookings: affected };
  });
}

export async function deleteBlock(id: string): Promise<void> {
  if (!(await scheduleRepo.deleteBlockedSlot(id))) throw AppError.notFound("Blokir tidak ditemukan");
}
