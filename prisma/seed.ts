// Idempotent seed: safe to run repeatedly and never overwrites data edited by the admin.
//
// Always seeds: the owner admin (only when ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are set), one artist,
// the studio's service catalogue and business hours (prisma/data/ds/*.json, from the data science team's
// services.csv / jam_operasional.csv).
// Only with SEED_DEMO_BOOKINGS=true (never in production): past holidays and demo bookings with their status history.
// The demo bookings depend on the seeding date: regenerate them with `buat_seed_demo.py --hari-ini <date>` in the
// data science repo and copy the JSON files over before seeding.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import type { BookingSource, BookingStatus } from "../src/generated/prisma/enums.js";
import { hashPassword } from "../src/utils/password.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required to seed");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const MIN_SEED_PASSWORD_LENGTH = 12;
const dataDir = resolve(process.env.DS_SEED_DIR ?? "prisma/data/ds");

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(dataDir, file), "utf8")) as T;
}

interface ServiceRow {
  service_code: string;
  name: string;
  description: string | null;
  category: string;
  price: number;
  duration_minutes: number;
  image_url: string | null;
  is_active: boolean;
}
interface HourRow {
  day_of_week: number;
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
  break_start: string | null;
  break_end: string | null;
}
interface BlockedRow {
  artist_id: string | null;
  start_at: string;
  end_at: string;
  reason: string | null;
}
interface BookingRow {
  booking_code: string;
  status: BookingStatus;
  source: BookingSource;
  service_name: string;
  start_at: string;
  end_at: string;
  customer_name: string;
  customer_phone: string;
  customer_note: string | null;
  reference_image_url: string | null;
  total_price: number;
  cancel_reason: string | null;
  admin_note: string | null;
  confirmed_at: string | null;
  created_at: string;
}
interface HistoryRow {
  booking_code: string;
  from_status: BookingStatus | null;
  to_status: BookingStatus;
  changed_by: string | null; // "owner", atau kosong (pelanggan/sistem)
  changed_at: string;
  reason: string | null;
}

async function seedServices(): Promise<void> {
  const rows = readJson<ServiceRow[]>("services.json");
  let created = 0;
  for (const row of rows) {
    // Service.name tidak unik di schema, tetapi unik di file DS. Jadi cocokkan lewat name.
    if (await prisma.service.findFirst({ where: { name: row.name } })) continue;
    await prisma.service.create({
      data: {
        name: row.name,
        description: row.description,
        category: row.category,
        price: row.price,
        durationMinutes: row.duration_minutes,
        imageUrl: row.image_url,
        isActive: row.is_active,
      },
    });
    created++;
  }
  console.log(`Layanan: ${created} dibuat, ${rows.length - created} sudah ada`);
}

async function seedBusinessHours(): Promise<void> {
  const rows = readJson<HourRow[]>("jam_operasional.json");
  let updated = 0;
  for (const row of rows) {
    // Hanya isi baris yang masih "tertutup dan kosong" (hasil seed.ts), supaya jam hasil edit admin tidak tertimpa.
    const result = await prisma.businessHour.updateMany({
      where: { dayOfWeek: row.day_of_week, isOpen: false, openTime: null },
      data: {
        isOpen: row.is_open,
        openTime: row.open_time,
        closeTime: row.close_time,
        breakStart: row.break_start,
        breakEnd: row.break_end,
      },
    });
    updated += result.count;
  }
  console.log(`Jam operasional: ${updated} baris diisi`);
}

async function seedHolidays(): Promise<void> {
  const rows = readJson<BlockedRow[]>("blocked_slots.json");
  let created = 0;
  for (const row of rows) {
    const where = { artistId: row.artist_id, startAt: new Date(row.start_at), endAt: new Date(row.end_at) };
    if (await prisma.blockedSlot.findFirst({ where })) continue;
    await prisma.blockedSlot.create({ data: { ...where, reason: row.reason } });
    created++;
  }
  console.log(`Libur/blokir: ${created} dibuat, ${rows.length - created} sudah ada`);
}

async function seedDemoBookings(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Menolak memasukkan reservasi demo saat NODE_ENV=production");
  }

  const artist = await prisma.artist.findFirst({ orderBy: { createdAt: "asc" } });
  if (!artist) throw new Error("Belum ada artist: jalankan prisma/seed.ts dulu");
  const admin = await prisma.admin.findFirst({ where: { role: "owner" }, orderBy: { createdAt: "asc" } });

  const serviceIdByName = new Map((await prisma.service.findMany()).map((s) => [s.name, s.id]));
  const bookings = readJson<BookingRow[]>("reservasi.json");
  const history = readJson<HistoryRow[]>("booking_status_history.json");

  const unknown = [...new Set(bookings.map((b) => b.service_name))].filter((name) => !serviceIdByName.has(name));
  if (unknown.length > 0) {
    throw new Error(`Layanan tidak ditemukan di database: ${unknown.join(", ")}`);
  }

  const existing = new Set(
    (
      await prisma.booking.findMany({
        where: { bookingCode: { in: bookings.map((b) => b.booking_code) } },
        select: { bookingCode: true },
      })
    ).map((b) => b.bookingCode),
  );
  const fresh = bookings.filter((b) => !existing.has(b.booking_code));
  if (fresh.length === 0) {
    console.log("Reservasi demo: semua sudah ada");
    return;
  }
  const freshCodes = new Set(fresh.map((b) => b.booking_code));

  await prisma.$transaction(
    async (tx) => {
      await tx.booking.createMany({
        data: fresh.map((b) => ({
          bookingCode: b.booking_code,
          status: b.status,
          source: b.source,
          serviceId: serviceIdByName.get(b.service_name) as string,
          artistId: artist.id,
          startAt: new Date(b.start_at),
          endAt: new Date(b.end_at),
          customerName: b.customer_name,
          customerPhone: b.customer_phone,
          customerNote: b.customer_note,
          referenceImageUrl: b.reference_image_url,
          totalPrice: b.total_price,
          cancelReason: b.cancel_reason,
          adminNote: b.admin_note,
          confirmedAt: b.confirmed_at ? new Date(b.confirmed_at) : null,
          createdAt: new Date(b.created_at),
        })),
      });

      const idByCode = new Map(
        (
          await tx.booking.findMany({
            where: { bookingCode: { in: [...freshCodes] } },
            select: { id: true, bookingCode: true },
          })
        ).map((b) => [b.bookingCode, b.id]),
      );

      await tx.bookingStatusHistory.createMany({
        data: history
          .filter((h) => freshCodes.has(h.booking_code))
          .map((h) => ({
            bookingId: idByCode.get(h.booking_code) as string,
            fromStatus: h.from_status,
            toStatus: h.to_status,
            // "owner" -> UUID admin owner; kosong -> null (pelanggan atau sistem)
            changedBy: h.changed_by === "owner" ? (admin?.id ?? null) : null,
            changedAt: new Date(h.changed_at),
            reason: h.reason,
          })),
      });
    },
    { timeout: 60_000 },
  );
  console.log(`Reservasi demo: ${fresh.length} dibuat, ${existing.size} sudah ada`);
}

async function seedBase(): Promise<void> {
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

  // One row per weekday (0 = Sunday ... 6 = Saturday), closed until the real hours are filled in below.
  await prisma.businessHour.createMany({
    data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isOpen: false })),
    skipDuplicates: true,
  });
}

try {
  await seedBase();
  await seedServices();
  await seedBusinessHours();
  if (process.env.SEED_DEMO_BOOKINGS === "true") {
    await seedHolidays();
    await seedDemoBookings();
  }
  console.log("Seed complete");
} finally {
  await prisma.$disconnect();
}
