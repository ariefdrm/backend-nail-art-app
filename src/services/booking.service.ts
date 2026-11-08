import { getEnv } from "../config/env.js";
import * as bookingRepo from "../repositories/booking.repository.js";
import type { CreateBookingInput } from "../schemas/booking.schema.js";
import { generateBookingCode } from "../utils/booking-code.js";
import { assertStartInWindow } from "../utils/booking-window.js";
import { toJakartaIso } from "../utils/datetime.js";
import { AppError } from "../utils/errors.js";
import { normalizePhone } from "../utils/phone.js";
import { prismaErrorCode, sqlState } from "../utils/prisma.js";
import type { AvailabilityDto, AvailabilityQuery } from "./availability.service.js";
import { toBookingDto, type BookingDto, type BookingRow } from "./booking.dto.js";

export type { BookingDto, BookingRow };

const HOUR_MS = 60 * 60_000;
const CODE_ATTEMPTS = 5;
const ACTIVE = new Set(["pending", "confirmed"]);

export interface BookingOptions {
  /** Default to MAX_ADVANCE_DAYS / BOOKING_BUFFER_MINUTES / CANCEL_MIN_HOURS_BEFORE from the environment. */
  maxAdvanceDays?: number;
  bufferMinutes?: number;
  cancelMinHoursBefore?: number;
  now?: Date;
  /** Injectable so the booking rules can be tested without the whole availability calculation. */
  getAvailability?: (query: AvailabilityQuery) => Promise<AvailabilityDto>;
}

function notFound(): AppError {
  return AppError.notFound("Reservasi tidak ditemukan");
}

/** Who is making the booking, and the state it starts in. */
export interface BookingOrigin {
  source: "online" | "admin";
  status: "pending" | "confirmed";
  /** Admin id for a manual booking, null for the customer. */
  changedBy: string | null;
}

export async function createBooking(input: CreateBookingInput, options: BookingOptions = {}): Promise<BookingDto> {
  const row = await placeBooking(input, { source: "online", status: "pending", changedBy: null }, options);
  return toBookingDto(row, false);
}

/**
 * Finds a free artist for the requested slot and inserts the booking under the schedule lock.
 * Shared by the customer flow (pending) and the admin manual booking (confirmed): the slot, buffer
 * and blocked-slot rules are the same for both.
 */
export async function placeBooking(
  input: CreateBookingInput,
  origin: BookingOrigin,
  options: BookingOptions = {},
): Promise<BookingRow> {
  const needsEnv = options.maxAdvanceDays === undefined || options.bufferMinutes === undefined;
  const env = needsEnv ? getEnv() : undefined;
  const maxAdvanceDays = options.maxAdvanceDays ?? env?.MAX_ADVANCE_DAYS ?? 60;
  const bufferMinutes = options.bufferMinutes ?? env?.BOOKING_BUFFER_MINUTES ?? 0;
  const now = options.now ?? new Date();
  // Loaded lazily: the booking rules do not need the availability module (and its repositories) unless it is used.
  const getAvailability = options.getAvailability ?? (await import("./availability.service.js")).getAvailability;

  const service = await bookingRepo.findBookableService(input.service_id);
  if (!service) throw AppError.notFound("Layanan tidak ditemukan");

  const startAt = input.start_at;
  assertStartInWindow(startAt, now, maxAdvanceDays);
  const date = toJakartaIso(startAt).slice(0, 10);

  // The requested start must be one of the slots the customer was offered. Anything else (off the grid, in
  // the break, already taken) is the same answer: that time is not available.
  const availability = await getAvailability({
    service_id: service.id,
    date,
    ...(input.artist_id ? { artist_id: input.artist_id } : {}),
  });
  const slot = availability.slots.find((s) => s.start_at === toJakartaIso(startAt));
  if (!slot) throw AppError.slotUnavailable();

  const endAt = new Date(startAt.getTime() + service.durationMinutes * 60_000);
  // With no preferred artist, try each free one: another request may take the first between the check and the insert.
  const candidates = input.artist_id ? [input.artist_id] : slot.available_artist_ids;

  for (const artistId of candidates) {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      try {
        const result = await bookingRepo.createBookingLocked(
          {
            bookingCode: generateBookingCode(startAt),
            serviceId: service.id,
            artistId,
            startAt,
            endAt,
            customerName: input.customer_name,
            customerPhone: input.customer_phone,
            customerNote: input.customer_note || null,
            referenceImageUrl: input.reference_image_url ?? null,
            totalPrice: service.price,
            source: origin.source,
            status: origin.status,
            changedBy: origin.changedBy,
            confirmedAt: origin.status === "confirmed" ? now : null,
          },
          bufferMinutes,
        );
        if (result.created) return result.booking;
        break; // blocked or too close to another booking: try the next artist
      } catch (error) {
        if (prismaErrorCode(error) === "P2002") continue; // booking code collision: draw another code
        if (sqlState(error) === "23P01") break; // overlap caught by the database constraint
        throw error;
      }
    }
  }
  throw AppError.slotUnavailable();
}

/** The booking, but only for the right code AND phone: anything else is a 404, never a 403. */
async function findOwnBooking(bookingCode: string, rawPhone: string) {
  const row = await bookingRepo.findBookingByCode(bookingCode);
  const phone = normalizePhone(rawPhone);
  if (!row || !phone || row.customerPhone !== phone) throw notFound();
  return row;
}

export async function getBookingStatus(bookingCode: string, rawPhone: string): Promise<BookingDto> {
  const row = await findOwnBooking(bookingCode, rawPhone);
  const conflict = ACTIVE.has(row.status)
    ? await bookingRepo.hasBlockedOverlap({ artistId: row.artistId, startAt: row.startAt, endAt: row.endAt })
    : false;
  return toBookingDto(row, conflict);
}

export async function cancelBooking(
  bookingCode: string,
  rawPhone: string,
  reason: string | undefined,
  options: BookingOptions = {},
): Promise<BookingDto> {
  const minHours = options.cancelMinHoursBefore ?? getEnv().CANCEL_MIN_HOURS_BEFORE;
  const now = options.now ?? new Date();

  const row = await findOwnBooking(bookingCode, rawPhone);
  if (!ACTIVE.has(row.status)) {
    throw AppError.invalidStatusTransition(`Reservasi dengan status ${row.status} tidak dapat dibatalkan`);
  }
  if (now.getTime() >= row.startAt.getTime() - minHours * HOUR_MS) {
    throw AppError.invalidStatusTransition(
      minHours > 0
        ? `Pembatalan hanya bisa dilakukan paling lambat ${minHours} jam sebelum jadwal`
        : "Reservasi yang sudah dimulai tidak dapat dibatalkan",
    );
  }

  const cancelled = await bookingRepo.cancelActiveBooking(row.id, row.status, reason || null);
  if (!cancelled) throw AppError.invalidStatusTransition("Reservasi sudah tidak dapat dibatalkan");
  return toBookingDto(cancelled, false);
}
