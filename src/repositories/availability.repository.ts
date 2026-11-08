import { findArtistById, listArtists } from "./artist.repository.js";
import { findActiveBookingsOverlapping } from "./booking.repository.js";
import { listBlockedSlots, listBusinessHours } from "./schedule.repository.js";
import { findServiceById } from "./service.repository.js";

/** Everything the slot calculation reads, gathered here so the service depends on one repository. */
export { findArtistById, findServiceById, listBusinessHours };

export function listActiveArtists() {
  return listArtists({ activeOnly: true });
}

/** Active bookings and blocked slots touching [startAt, endAt), for all artists. */
export async function findBusyRanges(range: { startAt: Date; endAt: Date }) {
  const [bookings, blocks] = await Promise.all([
    findActiveBookingsOverlapping(range),
    listBlockedSlots({ from: range.startAt, to: range.endAt }),
  ]);
  return { bookings, blocks };
}
