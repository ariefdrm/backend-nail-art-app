// Idempotent seed: safe to run repeatedly and never overwrites data edited by the admin.
//
// Not seeded here yet:
//   - the admin account (needs password hashing, added with the auth module)
//   - services and real business hours (waiting for services.csv / jam_operasional.csv)
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required to seed");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
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
