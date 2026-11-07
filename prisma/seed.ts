// Idempotent seed: safe to run repeatedly and never overwrites data edited by the admin.
//
// Seeds: the owner admin (only when ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are set),
// one artist, and closed business hours.
// Not seeded yet: services and real business hours (waiting for services.csv / jam_operasional.csv).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/utils/password.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required to seed");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const MIN_SEED_PASSWORD_LENGTH = 12;

try {
  const adminEmail = process.env.ADMIN_SEED_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_SEED_PASSWORD;
  if (adminEmail && adminPassword) {
    if (adminPassword.length < MIN_SEED_PASSWORD_LENGTH) {
      throw new Error(`ADMIN_SEED_PASSWORD must be at least ${MIN_SEED_PASSWORD_LENGTH} characters`);
    }
    // Never overwrite an existing admin (the password may have been changed since).
    const existing = await prisma.admin.findUnique({ where: { email: adminEmail } });
    if (!existing) {
      await prisma.admin.create({
        data: { email: adminEmail, passwordHash: await hashPassword(adminPassword), name: "Owner", role: "owner" },
      });
      console.log(`Created admin ${adminEmail}`);
    }
  } else {
    console.log("ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD not set: skipping admin");
  }

  // The studio has a single nail artist (the owner); the model still supports more.
  if ((await prisma.artist.count()) === 0) {
    await prisma.artist.create({ data: { name: "Owner" } });
  }

  // One row per weekday (0 = Sunday ... 6 = Saturday), closed until the owner sets hours.
  await prisma.businessHour.createMany({
    data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isOpen: false })),
    skipDuplicates: true,
  });

  console.log("Seed complete");
} finally {
  await prisma.$disconnect();
}
