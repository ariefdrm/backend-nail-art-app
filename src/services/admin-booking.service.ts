import { getEnv } from "../config/env.js";
import * as adminRepo from "../repositories/admin-booking.repository.js";
import type { ChangeStatusInput, UpdateAdminBookingInput } from "../schemas/admin-booking.schema.js";
import type { CreateBookingInput } from "../schemas/booking.schema.js";
import { canTransition, isActiveStatus, requiresStarted } from "../utils/booking-status.js";
import { assertStartInWindow } from "../utils/booking-window.js";
import { addDays, formatJakartaLong, jakartaDayStart, toJakartaIso } from "../utils/datetime.js";
import { AppError } from "../utils/errors.js";
import { sqlState } from "../utils/prisma.js";
import { buildPagination, type Pagination } from "../utils/response.js";
import { STUDIO_NAME, firstName } from "../utils/studio.js";
import { buildWhatsAppUrl } from "../utils/whatsapp.js";
import type { AvailabilityDto, AvailabilityOptions, AvailabilityQuery } from "./availability.service.js";
import { toBookingDto, type BookingDto, type BookingRow } from "./booking.dto.js";
import type { BookingOptions, BookingOrigin } from "./booking.service.js";

export interface AdminBookingDto extends BookingDto {
  /** wa.me link with a ready-to-send reminder; null once the booking is no longer pending/confirmed. */
  reminder_url: string | null;
}

export interface AdminBookingOptions extends BookingOptions {
  /** Injectable so the rules can be tested without loading the slot calculation or the locked insert. */
  placeBooking?: (input: CreateBookingInput, origin: BookingOrigin, options: BookingOptions) => Promise<BookingRow>;
  getAvailabilityFor?: (query: AvailabilityQuery, options: AvailabilityOptions) => Promise<AvailabilityDto>;
}

interface BlockRange {
  artistId: string | null;
  startAt: Date;
  endAt: Date;
}

function reminderMessage(row: BookingRow): string {
  return (
    `Halo ${firstName(row.customerName)}, kami dari ${STUDIO_NAME} mengingatkan jadwal ${row.service.name} Anda ` +
    `(${row.bookingCode}) pada ${formatJakartaLong(row.startAt)}. Mohon konfirmasi kehadiran Anda ya. Terima kasih.`
  );
}

function toAdminDto(row: BookingRow, scheduleConflict: boolean): AdminBookingDto {
  return {
    ...toBookingDto(row, scheduleConflict),
    reminder_url: isActiveStatus(row.status) ? buildWhatsAppUrl(row.customerPhone, reminderMessage(row)) : null,
  };
}

function hasConflict(row: BookingRow, blocks: BlockRange[]): boolean {
  return (
    isActiveStatus(row.status) &&
    blocks.some(
      (b) => (b.artistId === null || b.artistId === row.artistId) && b.startAt < row.endAt && b.endAt > row.startAt,
    )
  );
}

/** One blocked-slot query for a whole page of bookings, instead of one per booking. */
async function toAdminDtos(rows: BookingRow[]): Promise<AdminBookingDto[]> {
  if (rows.length === 0) return [];
  const from = new Date(Math.min(...rows.map((r) => r.startAt.getTime())));
  const to = new Date(Math.max(...rows.map((r) => r.endAt.getTime())));
  const blocks = await adminRepo.findBlockedSlotsBetween(from, to);
  return rows.map((row) => toAdminDto(row, hasConflict(row, blocks)));
}

/** SQLSTATE 23P01: the booking no-overlap constraint rejected the write. */
function isOverlapError(error: unknown): boolean {
  return sqlState(error) === "23P01";
}

async function loadOrFail(id: string) {
  const row = await adminRepo.findBookingById(id);
  if (!row) throw AppError.notFound("Reservasi tidak ditemukan");
  return row;
}

/** Digits of a search term in the form stored in the database (62...), or undefined if it is too short to be a phone. */
function phoneFragment(q: string): string | undefined {
  const digits = q.replace(/\D/g, "");
  if (digits.length < 3) return undefined;
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}

export interface ListQuery {
  date_from?: string | undefined;
  date_to?: string | undefined;
  status?: "pending" | "confirmed" | "completed" | "cancelled" | "no_show" | undefined;
  artist_id?: string | undefined;
  q?: string | undefined;
  page: number;
  per_page: number;
}

export async function listBookings(query: ListQuery): Promise<{ data: AdminBookingDto[]; meta: Pagination }> {
  const { rows, total } = await adminRepo.listBookings(
    {
      from: query.date_from ? jakartaDayStart(query.date_from) : undefined,
      // date_to is inclusive: the range ends when the next day starts
      to: query.date_to ? addDays(jakartaDayStart(query.date_to), 1) : undefined,
      status: query.status,
      artistId: query.artist_id,
      q: query.q,
      phoneFragment: query.q ? phoneFragment(query.q) : undefined,
    },
    query.page,
    query.per_page,
  );
  return { data: await toAdminDtos(rows), meta: buildPagination(query.page, query.per_page, total) };
}

export async function getBooking(id: string): Promise<AdminBookingDto> {
  const [dto] = await toAdminDtos([await loadOrFail(id)]);
  return dto as AdminBookingDto;
}

/** A booking made by the owner (walk-in or from chat): confirmed straight away, same slot rules as online. */
export async function createManualBooking(
  input: CreateBookingInput,
  adminId: string,
  options: AdminBookingOptions = {},
): Promise<AdminBookingDto> {
  // Loaded lazily: the admin rules do not need the locked insert unless it is actually used.
  const place = options.placeBooking ?? (await import("./booking.service.js")).placeBooking;
  const row = await place(input, { source: "admin", status: "confirmed", changedBy: adminId }, options);
  return toAdminDto(row, false);
}

export async function updateBooking(
  id: string,
  patch: UpdateAdminBookingInput,
  options: AdminBookingOptions = {},
): Promise<AdminBookingDto> {
  const row = await loadOrFail(id);
  // An empty note clears it.
  const notes = {
    customerNote: patch.customer_note === undefined ? undefined : patch.customer_note || null,
    adminNote: patch.admin_note === undefined ? undefined : patch.admin_note || null,
  };

  const startChanged = patch.start_at !== undefined && patch.start_at.getTime() !== row.startAt.getTime();
  const artistChanged = patch.artist_id !== undefined && patch.artist_id !== row.artistId;
  const serviceChanged = patch.service_id !== undefined && patch.service_id !== row.serviceId;

  if (!startChanged && !artistChanged && !serviceChanged) {
    const updated =
      notes.customerNote === undefined && notes.adminNote === undefined ? row : await adminRepo.updateNotes(id, notes);
    if (!updated) throw AppError.notFound("Reservasi tidak ditemukan");
    const [dto] = await toAdminDtos([updated]);
    return dto as AdminBookingDto;
  }

  if (!isActiveStatus(row.status)) {
    throw AppError.invalidStatusTransition(`Reservasi dengan status ${row.status} tidak dapat dijadwalkan ulang`);
  }

  const env = options.maxAdvanceDays === undefined || options.bufferMinutes === undefined ? getEnv() : undefined;
  const maxAdvanceDays = options.maxAdvanceDays ?? env?.MAX_ADVANCE_DAYS ?? 60;
  const bufferMinutes = options.bufferMinutes ?? env?.BOOKING_BUFFER_MINUTES ?? 0;
  const now = options.now ?? new Date();

  let service = row.service;
  if (serviceChanged) {
    const next = await adminRepo.findBookableService(patch.service_id as string);
    if (!next) throw AppError.notFound("Layanan tidak ditemukan");
    service = next;
  }

  const startAt = patch.start_at ?? row.startAt;
  // Only the customer-facing rules for a NEW time apply: a booking that keeps its time can still change artist.
  if (startChanged) assertStartInWindow(startAt, now, maxAdvanceDays);
  const artistId = patch.artist_id ?? row.artistId;

  const getAvailability = options.getAvailabilityFor ?? (await import("./availability.service.js")).getAvailability;
  const availability = await getAvailability(
    { service_id: service.id, date: toJakartaIso(startAt).slice(0, 10), artist_id: artistId },
    { excludeBookingId: id, ...(options.now ? { now: options.now } : {}) },
  );
  if (!availability.slots.some((s) => s.start_at === toJakartaIso(startAt))) throw AppError.slotUnavailable();

  let result;
  try {
    result = await adminRepo.rescheduleLocked(
      id,
      {
        serviceId: service.id,
        artistId,
        startAt,
        endAt: new Date(startAt.getTime() + service.durationMinutes * 60_000),
        totalPrice: serviceChanged ? service.price : row.totalPrice,
        ...notes,
      },
      bufferMinutes,
    );
  } catch (error) {
    // The database no-overlap constraint is the last line of defence.
    if (isOverlapError(error)) throw AppError.slotUnavailable();
    throw error;
  }

  switch (result.kind) {
    case "updated":
      return toAdminDto(result.booking, false);
    case "refused":
      throw AppError.slotUnavailable();
    case "not_active":
      throw AppError.invalidStatusTransition("Reservasi sudah tidak dapat dijadwalkan ulang");
    case "not_found":
      throw AppError.notFound("Reservasi tidak ditemukan");
  }
}

export async function changeStatus(
  id: string,
  input: ChangeStatusInput,
  adminId: string,
  options: { now?: Date } = {},
): Promise<AdminBookingDto> {
  const now = options.now ?? new Date();
  const row = await loadOrFail(id);

  if (!canTransition(row.status, input.status)) {
    throw AppError.invalidStatusTransition(`Status ${row.status} tidak dapat diubah menjadi ${input.status}`);
  }
  if (input.status === "cancelled" && !input.reason) {
    throw AppError.validation([{ field: "reason", message: "Alasan wajib diisi untuk pembatalan" }]);
  }
  if (requiresStarted(input.status) && now.getTime() < row.startAt.getTime()) {
    throw AppError.invalidStatusTransition(`Status ${input.status} hanya dapat diberikan setelah jadwal dimulai`);
  }

  const updated = await adminRepo.transitionStatus(id, row.status, input.status, {
    changedBy: adminId,
    reason: input.reason || null,
    ...(input.status === "confirmed" ? { confirmedAt: now } : {}),
    ...(input.status === "cancelled" ? { cancelReason: input.reason ?? null } : {}),
  });
  if (!updated) throw AppError.invalidStatusTransition("Status reservasi baru saja diubah, muat ulang halaman");
  return toAdminDto(updated, false);
}
