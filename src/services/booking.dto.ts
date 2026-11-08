import { toJakartaIso } from "../utils/datetime.js";
import {
  toArtistDto,
  toServiceDto,
  type ArtistDto,
  type ArtistRow,
  type ServiceDto,
  type ServiceRow,
} from "./catalog.dto.js";

// Structural row type: repositories return Prisma rows, but this layer must not import Prisma.
export interface BookingRow {
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

export function toBookingDto(row: BookingRow, scheduleConflict: boolean): BookingDto {
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
