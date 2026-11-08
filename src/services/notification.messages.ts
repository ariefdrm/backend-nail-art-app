import { formatJakartaLong } from "../utils/datetime.js";
import { firstName } from "../utils/studio.js";

// What an admin reads in the inbox (and, later, in a push). Only the booking code, service, time and the customer's
// FIRST name: never a phone number or free text the customer typed (UU No. 27 Tahun 2022).

export type NotificationType =
  "new_booking" | "booking_cancelled" | "unconfirmed_reminder" | "upcoming_reminder" | "schedule_conflict";

export interface BookingFacts {
  bookingCode: string;
  customerName: string;
  serviceName: string;
  startAt: Date;
}

export interface NotificationContent {
  type: NotificationType;
  title: string;
  body: string;
  /** One notification per event: the same key never produces a second row. */
  dedupeKey: string;
}

const when = (facts: BookingFacts) => formatJakartaLong(facts.startAt);

export function newBookingContent(facts: BookingFacts): NotificationContent {
  return {
    type: "new_booking",
    title: "Reservasi baru",
    body: `${firstName(facts.customerName)} memesan ${facts.serviceName} pada ${when(facts)} (${facts.bookingCode}). Menunggu konfirmasi.`,
    dedupeKey: `new_booking:${facts.bookingCode}`,
  };
}

export function cancelledContent(facts: BookingFacts): NotificationContent {
  return {
    type: "booking_cancelled",
    title: "Reservasi dibatalkan customer",
    body: `${firstName(facts.customerName)} membatalkan ${facts.serviceName} pada ${when(facts)} (${facts.bookingCode}).`,
    dedupeKey: `booking_cancelled:${facts.bookingCode}`,
  };
}

export function unconfirmedContent(
  facts: BookingFacts,
  bookingId: string,
  waitingMinutes: number,
): NotificationContent {
  return {
    type: "unconfirmed_reminder",
    title: "Reservasi belum dikonfirmasi",
    body: `${facts.bookingCode} dari ${firstName(facts.customerName)} (${facts.serviceName}, ${when(facts)}) sudah menunggu konfirmasi lebih dari ${waitingMinutes} menit.`,
    dedupeKey: `unconfirmed_reminder:${bookingId}`,
  };
}

export function upcomingContent(facts: BookingFacts, bookingId: string): NotificationContent {
  return {
    type: "upcoming_reminder",
    title: "Jadwal segera dimulai",
    body: `${facts.serviceName} untuk ${firstName(facts.customerName)} dimulai ${when(facts)} (${facts.bookingCode}).`,
    dedupeKey: `upcoming_reminder:${bookingId}`,
  };
}

export function conflictContent(facts: BookingFacts, bookingId: string): NotificationContent {
  return {
    type: "schedule_conflict",
    title: "Jadwal bentrok dengan blokir waktu",
    body: `${facts.bookingCode} dari ${firstName(facts.customerName)} (${facts.serviceName}, ${when(facts)}) bertabrakan dengan waktu yang diblokir. Hubungi customer untuk memilih jadwal pengganti.`,
    dedupeKey: `schedule_conflict:${bookingId}`,
  };
}
