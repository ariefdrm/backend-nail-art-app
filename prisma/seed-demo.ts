// Dummy data for frontend development. NOT part of the regular seed: never run this in production.
//
// Idempotent: services/artists are matched by name, bookings by booking code, so running it twice
// adds nothing new. Dates are relative to today (Asia/Jakarta), so rerun it to refresh the calendar.
// Also sets Monday-Saturday business hours (10:00-20:00, break 12:00-13:00); Sunday stays closed.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required to seed");
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data when NODE_ENV=production");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DAY_MS = 86_400_000;
const WIB_OFFSET_MS = 7 * 3_600_000;

const SERVICES = [
  {
    name: "Manicure Basic",
    category: "Manicure",
    price: 60_000,
    durationMinutes: 60,
    description: "Perawatan kuku dasar: bentuk, kutikula, dan cat satu warna.",
  },
  {
    name: "Gel Polish",
    category: "Manicure",
    price: 120_000,
    durationMinutes: 60,
    description: "Cat gel tahan hingga 3 minggu.",
  },
  {
    name: "Nail Art Simple",
    category: "Nail Art",
    price: 150_000,
    durationMinutes: 90,
    description: "Gel polish dengan desain sederhana di beberapa kuku.",
  },
  {
    name: "Nail Art Premium",
    category: "Nail Art",
    price: 250_000,
    durationMinutes: 120,
    description: "Desain detail di semua kuku, termasuk hiasan dan chrome.",
  },
  {
    name: "Gel Extension",
    category: "Extension",
    price: 300_000,
    durationMinutes: 120,
    description: "Perpanjangan kuku dengan gel, termasuk gel polish.",
  },
  {
    name: "Full Set Acrylic",
    category: "Extension",
    price: 350_000,
    durationMinutes: 150,
    description: "Kuku akrilik satu set lengkap dengan desain pilihan.",
  },
  {
    name: "Remove Gel",
    category: "Perawatan",
    price: 40_000,
    durationMinutes: 30,
    description: "Pelepasan gel polish lama dengan aman.",
  },
  {
    name: "Pedicure Spa",
    category: "Perawatan",
    price: 130_000,
    durationMinutes: 90,
    description: "Pedicure dengan rendam, scrub, dan pijat kaki.",
  },
];

const ARTISTS = ["Owner", "Dewi"];

const CUSTOMERS = [
  ["Siti Rahmawati", "+6281234560001"],
  ["Putri Ayu", "+6281234560002"],
  ["Nadia Kusuma", "+6281234560003"],
  ["Rina Marlina", "+6281234560004"],
  ["Dinda Permata", "+6281234560005"],
  ["Maya Sari", "+6281234560006"],
  ["Anisa Fitri", "+6281234560007"],
  ["Citra Lestari", "+6281234560008"],
] as const;

const NOTES = [null, "Mau warna nude, pendek saja", "Referensi dari Pinterest", null, "Kuku saya agak rapuh", null];
const SLOT_HOURS = [
  { h: 10, m: 0, maxMinutes: 120 },
  { h: 13, m: 0, maxMinutes: 150 },
  { h: 16, m: 0, maxMinutes: 150 },
];

const pad = (n: number) => String(n).padStart(2, "0");
const wibDate = (ms: number) => new Date(ms + WIB_OFFSET_MS).toISOString().slice(0, 10);

try {
  const admin = await prisma.admin.findFirst({ orderBy: { createdAt: "asc" } });

  await prisma.businessHour.createMany({
    data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isOpen: false })),
    skipDuplicates: true,
  });
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    const open = dayOfWeek !== 0;
    await prisma.businessHour.update({
      where: { dayOfWeek },
      data: open
        ? { isOpen: true, openTime: "10:00", closeTime: "20:00", breakStart: "12:00", breakEnd: "13:00" }
        : { isOpen: false, openTime: null, closeTime: null, breakStart: null, breakEnd: null },
    });
  }

  const services = [];
  for (const s of SERVICES) {
    const found = await prisma.service.findFirst({ where: { name: s.name } });
    services.push(found ?? (await prisma.service.create({ data: s })));
  }

  const artists = [];
  for (const name of ARTISTS) {
    const found = await prisma.artist.findFirst({ where: { name } });
    artists.push(found ?? (await prisma.artist.create({ data: { name } })));
  }

  const now = Date.now();
  const todayStart = new Date(`${wibDate(now)}T00:00:00+07:00`).getTime();
  const BLOCKED_OFFSET = 9;
  let created = 0;
  let n = 0;

  for (let offset = -21; offset <= 10; offset++) {
    const dayStartMs = todayStart + offset * DAY_MS;
    const ymd = wibDate(dayStartMs);
    const dow = new Date(dayStartMs + WIB_OFFSET_MS).getUTCDay();
    if (dow === 0 || offset === BLOCKED_OFFSET) continue;

    for (const [slotIdx, slot] of SLOT_HOURS.entries()) {
      n++;
      // Roughly two thirds of the slots are taken; the owner (artist 0) is busier than Dewi.
      if (n % 3 === 0) continue;
      const artist = artists[slotIdx === 1 && n % 2 === 0 ? 1 : 0] ?? artists[0];
      const eligible = services.filter((s) => s.durationMinutes <= slot.maxMinutes);
      const service = eligible[n % eligible.length];
      const customer = CUSTOMERS[n % CUSTOMERS.length];
      if (!artist || !service || !customer) continue;
      const [customerName, customerPhone] = customer;

      const startAt = new Date(`${ymd}T${pad(slot.h)}:${pad(slot.m)}:00+07:00`);
      const endAt = new Date(startAt.getTime() + service.durationMinutes * 60_000);
      const bookingCode = `NP-${ymd.replaceAll("-", "")}-${pad(slotIdx + 1)}${pad(artists.indexOf(artist) + 1)}`;
      if (await prisma.booking.findUnique({ where: { bookingCode } })) continue;

      const isPast = endAt.getTime() < now;
      const source = n % 5 === 0 ? "admin" : "online";
      let status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
      if (isPast) status = n % 11 === 0 ? "no_show" : n % 7 === 0 ? "cancelled" : "completed";
      else status = source === "online" && n % 3 === 1 ? "pending" : "confirmed";

      const createdAt = new Date(Math.min(startAt.getTime() - 2 * DAY_MS, now - 60_000));
      const confirmedAt =
        status === "pending" || (status === "cancelled" && n % 2 === 0)
          ? null
          : new Date(createdAt.getTime() + 20 * 60_000);
      const cancelReason = status === "cancelled" ? "Pelanggan berhalangan hadir" : null;

      const booking = await prisma.booking.create({
        data: {
          bookingCode,
          status,
          source,
          serviceId: service.id,
          artistId: artist.id,
          startAt,
          endAt,
          customerName,
          customerPhone,
          customerNote: NOTES[n % NOTES.length],
          totalPrice: service.price,
          cancelReason,
          adminNote: status === "no_show" ? "Tidak datang, tidak ada kabar" : null,
          confirmedAt: source === "admin" ? createdAt : confirmedAt,
          createdAt,
        },
      });

      const history: {
        fromStatus: typeof status | null;
        toStatus: typeof status;
        changedBy: string | null;
        changedAt: Date;
        reason?: string | null;
      }[] = [
        {
          fromStatus: null,
          toStatus: source === "admin" ? "confirmed" : "pending",
          changedBy: source === "admin" ? (admin?.id ?? null) : null,
          changedAt: createdAt,
        },
      ];
      if (source === "online" && status !== "pending" && confirmedAt) {
        history.push({
          fromStatus: "pending",
          toStatus: "confirmed",
          changedBy: admin?.id ?? null,
          changedAt: confirmedAt,
        });
      }
      if (status === "completed" || status === "no_show") {
        history.push({ fromStatus: "confirmed", toStatus: status, changedBy: admin?.id ?? null, changedAt: endAt });
      }
      if (status === "cancelled") {
        history.push({
          fromStatus: confirmedAt ? "confirmed" : "pending",
          toStatus: "cancelled",
          changedBy: null,
          changedAt: new Date(startAt.getTime() - DAY_MS),
          reason: cancelReason,
        });
      }
      await prisma.bookingStatusHistory.createMany({ data: history.map((h) => ({ ...h, bookingId: booking.id })) });
      created++;
    }
  }

  // One whole-studio block in the future (no bookings are placed that day).
  const blockStart = new Date(`${wibDate(todayStart + BLOCKED_OFFSET * DAY_MS)}T10:00:00+07:00`);
  const blockEnd = new Date(`${wibDate(todayStart + BLOCKED_OFFSET * DAY_MS)}T20:00:00+07:00`);
  if (!(await prisma.blockedSlot.findFirst({ where: { startAt: blockStart, endAt: blockEnd } }))) {
    await prisma.blockedSlot.create({
      data: { startAt: blockStart, endAt: blockEnd, reason: "Libur / acara pribadi" },
    });
  }

  console.log(`Demo seed complete: ${services.length} services, ${artists.length} artists, ${created} new bookings`);
} finally {
  await prisma.$disconnect();
}
