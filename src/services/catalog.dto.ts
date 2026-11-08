// Structural row types: the repositories return Prisma rows, but the services must not import Prisma.
export interface ServiceRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price: number;
  durationMinutes: number;
  imageUrl: string | null;
  isActive: boolean;
}

export interface ArtistRow {
  id: string;
  name: string;
  photoUrl: string | null;
  isActive: boolean;
}

export interface ServiceDto {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price: number;
  duration_minutes: number;
  image_url: string | null;
  is_active: boolean;
}

export interface ArtistDto {
  id: string;
  name: string;
  photo_url: string | null;
  is_active: boolean;
}

export function toServiceDto(row: ServiceRow): ServiceDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    price: row.price,
    duration_minutes: row.durationMinutes,
    image_url: row.imageUrl,
    is_active: row.isActive,
  };
}

export function toArtistDto(row: ArtistRow): ArtistDto {
  return { id: row.id, name: row.name, photo_url: row.photoUrl, is_active: row.isActive };
}
