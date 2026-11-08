import { getPrisma, prismaErrorCode } from "../utils/prisma.js";

export interface ServiceData {
  name: string;
  description: string | null;
  category: string;
  price: number;
  durationMinutes: number;
  imageUrl: string | null;
  isActive: boolean;
}

export function listServices(filter: { activeOnly: boolean; category?: string | undefined }) {
  return getPrisma().service.findMany({
    where: {
      ...(filter.activeOnly ? { isActive: true } : {}),
      ...(filter.category ? { category: filter.category } : {}),
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}

export function findServiceById(id: string) {
  return getPrisma().service.findUnique({ where: { id } });
}

export function createService(data: ServiceData) {
  return getPrisma().service.create({ data });
}

/** Returns null when the service does not exist. */
export async function updateService(id: string, data: Partial<ServiceData>) {
  try {
    return await getPrisma().service.update({ where: { id }, data });
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") return null;
    throw err;
  }
}

/**
 * Hard-deletes a service that has no bookings. Returns false (and deletes nothing)
 * when bookings still reference it. The foreign key is ON DELETE RESTRICT, which
 * PostgreSQL reports as SQLSTATE 23001; Prisma maps foreign key failures to P2003.
 */
export async function deleteServiceIfUnused(id: string): Promise<boolean> {
  try {
    await getPrisma().service.delete({ where: { id } });
    return true;
  } catch (err) {
    if (prismaErrorCode(err) === "P2003") return false;
    throw err;
  }
}
