import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";

/** Connection string of the dedicated test database (created by scripts/db-init.sh). */
export const testDatabaseUrl = process.env.DATABASE_URL_TEST;

export function createTestPrisma(): PrismaClient {
  if (!testDatabaseUrl) throw new Error("DATABASE_URL_TEST is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
}

export async function cleanDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.pushSubscription.deleteMany();
  await prisma.notification.deleteMany(); // reads go with them
  await prisma.bookingStatusHistory.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.blockedSlot.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.businessHour.deleteMany();
  await prisma.service.deleteMany();
  await prisma.artist.deleteMany();
  await prisma.admin.deleteMany();
}

let counter = 0;

export function at(hhmm: string, day = "2026-11-10"): Date {
  return new Date(`${day}T${hhmm}:00+07:00`);
}

export async function seedBase(prisma: PrismaClient) {
  const artist = await prisma.artist.create({ data: { name: "Owner" } });
  const otherArtist = await prisma.artist.create({ data: { name: "Second" } });
  const service = await prisma.service.create({
    data: { name: "Gel Polish", category: "gel_polish", price: 150000, durationMinutes: 90 },
  });
  return { artist, otherArtist, service };
}

export function bookingData(input: {
  serviceId: string;
  artistId: string;
  start: string;
  end: string;
  status?: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
}) {
  counter += 1;
  return {
    bookingCode: `NP-20261110-${String(counter).padStart(4, "0")}`,
    serviceId: input.serviceId,
    artistId: input.artistId,
    startAt: at(input.start),
    endAt: at(input.end),
    customerName: "Siti",
    customerPhone: "+6281234567890",
    totalPrice: 150000,
    ...(input.status ? { status: input.status } : {}),
  };
}
