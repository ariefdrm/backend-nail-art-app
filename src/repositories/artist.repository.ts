import { getPrisma, prismaErrorCode } from "../utils/prisma.js";

export interface ArtistData {
  name: string;
  photoUrl: string | null;
  isActive: boolean;
}

export function listArtists(filter: { activeOnly: boolean }) {
  return getPrisma().artist.findMany({
    where: filter.activeOnly ? { isActive: true } : {},
    orderBy: { name: "asc" },
  });
}

export function findArtistById(id: string) {
  return getPrisma().artist.findUnique({ where: { id } });
}

export function createArtist(data: ArtistData) {
  return getPrisma().artist.create({ data });
}

/** Returns null when the artist does not exist. */
export async function updateArtist(id: string, data: Partial<ArtistData>) {
  try {
    return await getPrisma().artist.update({ where: { id }, data });
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") return null;
    throw err;
  }
}
