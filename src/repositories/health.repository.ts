import { getPrisma } from "../utils/prisma.js";

export async function pingDatabase(): Promise<void> {
  await getPrisma().$queryRaw`SELECT 1`;
}
