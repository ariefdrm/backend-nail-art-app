import { getPrisma } from "../utils/prisma.js";

export function findAdminByEmail(email: string) {
  return getPrisma().admin.findUnique({ where: { email } });
}

export function findAdminById(id: string) {
  return getPrisma().admin.findUnique({ where: { id } });
}
