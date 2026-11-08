import { getEnv } from "../config/env.js";
import * as bookingRepo from "../repositories/booking.repository.js";
import type { CreateBookingInput } from "../schemas/booking.schema.js";
import { generateBookingCode } from "../utils/booking-code.js";
import { addDays, jakartaDayStart, toJakartaIso } from "../utils/datetime.js";
import { AppError } from "../utils/errors.js";
import { normalizePhone } from "../utils/phone.js";
import { prismaErrorCode, sqlState } from "../utils/prisma.js";
import type { AvailabilityDto, AvailabilityQuery } from "./availability.service.js";
import {
  toArtistDto,
  toServiceDto,
  type ArtistDto,
  type ArtistRow,
  type ServiceDto,
  type ServiceRow,
} from "./catalog.dto.js";

const HOUR_MS = 60 * 60_000;
const CODE_ATTEMPTS = 5;
const ACTIVE = new Set(["pending", "confirmed"]);

// Structural row type: repositories return Prisma rows, but this layer must not import Prisma.
interface BookingRow {
  id: string;
  bookingCode: string;
  status: string;
  source: string;
  serviceId: string;
  artistId: string;
  startAt: Date;
  endAt: Date;
  customerName: string;
  customerPhone: string;
  customerNote: string | null;
  referenceImageUrl: string | null;
  totalPrice: number;
  cancelReason: string | null;
  adminNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  service: ServiceRow;
  artist: ArtistRow;
}

export interface BookingDto {
  id: string;
  booking_code: string;
  status: string;
  service: ServiceDto;
  artist: ArtistDto;
  start_at: string;
  end_at: string;
  customer_name: string;
  customer_phone: string;
  customer_note: string | null;
  reference_image_url: string | null;
  total_price: number;
  source: string;
  cancel_reason: string | null;
  admin_note: string | null;
  schedule_conflict: boolean;
  created_at: string;
  updated_at: string;
}

export interface BookingOptions {
  /** Default to MAX_ADVANCE_DAYS / BOOKING_BUFFER_MINUTES / CANCEL_MIN_HOURS_BEFORE from the environment. */
  maxAdvanceDays?: number;
  bufferMinutes?: number;
  cancelMinHoursBefore?: number;
  now?: Date;
  /** Injectable so the booking rules can be tested without the whole availability calculation. */
  getAvailability?: (query: AvailabilityQuery) => Promise<AvailabilityDto>;
}

function toBookingDto(row: BookingRow, scheduleConflict: boolean): BookingDto {
  return {
    id: row.id,
    booking_code: row.bookingCode,
    status: row.status,
    service: toServiceDto(row.service),
    artist: toArtistDto(row.artist),
    start_at: toJakartaIso(row.startAt),
    end_at: toJakartaIso(row.endAt),
    customer_name: row.customerName,
    customer_phone: row.customerPhone,
    customer_note: row.customerNote,
    reference_image_url: row.referenceImageUrl,
    total_price: row.totalPrice,
    source: row.source,
    cancel_reason: row.cancelReason,
    admin_note: row.adminNote,
    schedule_conflict: scheduleConflict,
    created_at: toJakartaIso(row.createdAt),
    updated_at: toJakartaIso(row.updatedAt),
  };
}

function notFound(): AppError {
  return AppError.notFound("Reservasi tidak ditemukan");
}

export async function createBooking(input: CreateBookingInput, options: BookingOptions = {}): Promise<BookingDto> {
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
  if (startAt.getTime() <= now.getTime()) {
    throw AppError.validation([{ field: "start_at", message: "Waktu mulai harus di masa depan" }]);
  }
  const date = toJakartaIso(startAt).slice(0, 10);
  const today = jakartaDayStart(toJakartaIso(now).slice(0, 10));
  if (jakartaDayStart(date).getTime() > addDays(today, maxAdvanceDays).getTime()) {
    throw AppError.validation([
      { field: "start_at", message: `Tanggal maksimal ${maxAdvanceDays} hari dari hari ini` },
    ]);
  }

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
          },
          bufferMinutes,
        );
        if (result.created) return toBookingDto(result.booking, false);
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
