import type { ArtistInput, ServiceInput } from "../schemas/catalog.schema.js";
import * as artistRepo from "../repositories/artist.repository.js";
import * as serviceRepo from "../repositories/service.repository.js";
import { AppError } from "../utils/errors.js";
import { toArtistDto, toServiceDto, type ArtistDto, type ServiceDto } from "./catalog.dto.js";

export type { ArtistDto, ServiceDto };

function toServiceData(input: ServiceInput): serviceRepo.ServiceData {
  return {
    name: input.name,
    description: input.description || null,
    category: input.category,
    price: input.price,
    durationMinutes: input.duration_minutes,
    imageUrl: input.image_url ?? null,
    isActive: input.is_active,
  };
}

function toArtistData(input: ArtistInput): artistRepo.ArtistData {
  return { name: input.name, photoUrl: input.photo_url ?? null, isActive: input.is_active };
}

const SERVICE_NOT_FOUND = "Layanan tidak ditemukan";
const ARTIST_NOT_FOUND = "Nail artist tidak ditemukan";

// --- public (FR-01, FR-02) ---

export async function listPublicServices(category?: string): Promise<ServiceDto[]> {
  const rows = await serviceRepo.listServices({ activeOnly: true, category });
  return rows.map(toServiceDto);
}

/** Inactive services are hidden from customers, so they answer 404 like missing ones. */
export async function getPublicService(id: string): Promise<ServiceDto> {
  const row = await serviceRepo.findServiceById(id);
  if (!row?.isActive) throw AppError.notFound(SERVICE_NOT_FOUND);
  return toServiceDto(row);
}

export async function listPublicArtists(): Promise<ArtistDto[]> {
  const rows = await artistRepo.listArtists({ activeOnly: true });
  return rows.map(toArtistDto);
}

// --- admin services (FR-08) ---

export async function listAdminServices(): Promise<ServiceDto[]> {
  const rows = await serviceRepo.listServices({ activeOnly: false });
  return rows.map(toServiceDto);
}

export async function createService(input: ServiceInput): Promise<ServiceDto> {
  return toServiceDto(await serviceRepo.createService(toServiceData(input)));
}

export async function updateService(id: string, input: ServiceInput): Promise<ServiceDto> {
  const row = await serviceRepo.updateService(id, toServiceData(input));
  if (!row) throw AppError.notFound(SERVICE_NOT_FOUND);
  return toServiceDto(row);
}

/**
 * Deletes a service nobody has booked. A service that already has bookings is kept
 * (bookings reference it) and deactivated instead, so history stays intact.
 */
export async function removeService(id: string): Promise<void> {
  if (!(await serviceRepo.findServiceById(id))) throw AppError.notFound(SERVICE_NOT_FOUND);
  if (await serviceRepo.deleteServiceIfUnused(id)) return;
  await serviceRepo.updateService(id, { isActive: false });
}

// --- admin artists (FR-08) ---

export async function listAdminArtists(): Promise<ArtistDto[]> {
  const rows = await artistRepo.listArtists({ activeOnly: false });
  return rows.map(toArtistDto);
}

export async function createArtist(input: ArtistInput): Promise<ArtistDto> {
  return toArtistDto(await artistRepo.createArtist(toArtistData(input)));
}

export async function updateArtist(id: string, input: ArtistInput): Promise<ArtistDto> {
  const row = await artistRepo.updateArtist(id, toArtistData(input));
  if (!row) throw AppError.notFound(ARTIST_NOT_FOUND);
  return toArtistDto(row);
}

/** Artists are never hard-deleted (their bookings must stay readable); deactivate instead. */
export async function deactivateArtist(id: string): Promise<void> {
  const row = await artistRepo.updateArtist(id, { isActive: false });
  if (!row) throw AppError.notFound(ARTIST_NOT_FOUND);
}
