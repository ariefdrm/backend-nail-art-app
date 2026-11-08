import { getEnv } from "../config/env.js";
import * as availabilityRepo from "../repositories/availability.repository.js";
import { addDays, jakartaDayStart, toJakartaIso } from "../utils/datetime.js";
import { AppError } from "../utils/errors.js";

const MINUTE_MS = 60_000;

export interface SlotDto {
  start_at: string;
  end_at: string;
  available_artist_ids: string[];
}

export interface AvailabilityDto {
  date: string;
  service_id: string;
  slots: SlotDto[];
}

export interface AvailabilityQuery {
  service_id: string;
  date: string;
  artist_id?: string | undefined;
}

export interface AvailabilityOptions {
  /** Default to SLOT_STEP_MINUTES / MAX_ADVANCE_DAYS / BOOKING_BUFFER_MINUTES from the environment. */
  stepMinutes?: number;
  maxAdvanceDays?: number;
  bufferMinutes?: number;
  now?: Date;
  /** Ignore this booking when looking for conflicts, so it can be moved without blocking itself. */
  excludeBookingId?: string;
}

/** "HH:mm" to minutes since midnight. */
function toMinutes(time: string): number {
  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** Half-open overlap: ranges that only touch at an edge do not overlap. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function dayOfWeek(dayStart: Date): number {
  // Shift to WIB so getUTCDay() reports the Jakarta weekday (0 = Sunday).
  return new Date(dayStart.getTime() + 7 * 60 * MINUTE_MS).getUTCDay();
}

export async function getAvailability(
  query: AvailabilityQuery,
  options: AvailabilityOptions = {},
): Promise<AvailabilityDto> {
  const needsEnv =
    options.stepMinutes === undefined || options.maxAdvanceDays === undefined || options.bufferMinutes === undefined;
  const env = needsEnv ? getEnv() : undefined;
  const stepMinutes = options.stepMinutes ?? env?.SLOT_STEP_MINUTES ?? 30;
  const maxAdvanceDays = options.maxAdvanceDays ?? env?.MAX_ADVANCE_DAYS ?? 60;
  const bufferMinutes = options.bufferMinutes ?? env?.BOOKING_BUFFER_MINUTES ?? 0;
  const bufferMs = bufferMinutes * MINUTE_MS;
  const now = options.now ?? new Date();

  const today = jakartaDayStart(toJakartaIso(now).slice(0, 10));
  const dayStart = jakartaDayStart(query.date);
  if (dayStart.getTime() < today.getTime()) {
    throw AppError.validation([{ field: "query.date", message: "Tanggal tidak boleh di masa lalu" }]);
  }
  if (dayStart.getTime() > addDays(today, maxAdvanceDays).getTime()) {
    throw AppError.validation([
      { field: "query.date", message: `Tanggal maksimal ${maxAdvanceDays} hari dari hari ini` },
    ]);
  }

  const service = await availabilityRepo.findServiceById(query.service_id);
  if (!service?.isActive) throw AppError.notFound("Layanan tidak ditemukan");

  let artistIds: string[];
  if (query.artist_id) {
    const artist = await availabilityRepo.findArtistById(query.artist_id);
    if (!artist?.isActive) throw AppError.notFound("Artist tidak ditemukan");
    artistIds = [artist.id];
  } else {
    artistIds = (await availabilityRepo.listActiveArtists()).map((a) => a.id);
  }

  const empty: AvailabilityDto = { date: query.date, service_id: service.id, slots: [] };
  const hours = (await availabilityRepo.listBusinessHours()).find((h) => h.dayOfWeek === dayOfWeek(dayStart));
  if (!hours?.isOpen || !hours.openTime || !hours.closeTime || artistIds.length === 0) return empty;

  const dayEnd = addDays(dayStart, 1);
  // A booking also occupies its artist for the buffer after it ends, so look slightly past the day edges.
  const { bookings, blocks } = await availabilityRepo.findBusyRanges({
    startAt: new Date(dayStart.getTime() - bufferMs),
    endAt: new Date(dayEnd.getTime() + bufferMs),
    ...(options.excludeBookingId ? { excludeBookingId: options.excludeBookingId } : {}),
  });

  const open = toMinutes(hours.openTime);
  const close = toMinutes(hours.closeTime);
  const breakStart = hours.breakStart ? toMinutes(hours.breakStart) : null;
  const breakEnd = hours.breakEnd ? toMinutes(hours.breakEnd) : null;

  const slots: SlotDto[] = [];
  for (let start = open; start + service.durationMinutes <= close; start += stepMinutes) {
    const end = start + service.durationMinutes;
    if (breakStart !== null && breakEnd !== null && overlaps(start, end, breakStart, breakEnd)) continue;

    const startAt = new Date(dayStart.getTime() + start * MINUTE_MS);
    const endAt = new Date(dayStart.getTime() + end * MINUTE_MS);
    if (startAt.getTime() <= now.getTime()) continue;

    const free = artistIds.filter((artistId) => {
      const forArtist = (r: { artistId: string | null }) => r.artistId === null || r.artistId === artistId;
      // Two bookings may sit side by side only if their occupied ranges [start, end + buffer) do not overlap.
      const bookingBusy = (r: { artistId: string | null; startAt: Date; endAt: Date }) =>
        r.artistId === artistId &&
        startAt.getTime() < r.endAt.getTime() + bufferMs &&
        r.startAt.getTime() < endAt.getTime() + bufferMs;
      const blockBusy = (r: { artistId: string | null; startAt: Date; endAt: Date }) =>
        forArtist(r) && r.startAt < endAt && r.endAt > startAt;
      return !bookings.some(bookingBusy) && !blocks.some(blockBusy);
    });
    if (free.length === 0) continue;

    slots.push({ start_at: toJakartaIso(startAt), end_at: toJakartaIso(endAt), available_artist_ids: free });
  }

  return { date: query.date, service_id: service.id, slots };
}
