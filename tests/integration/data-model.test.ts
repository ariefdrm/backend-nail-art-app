// Verifies the database-level guarantees from the PRD against a real PostgreSQL.
// Needs DATABASE_URL_TEST pointing at a migrated database (`bun run db:test:reset`).
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { at, bookingData, cleanDatabase, createTestPrisma, seedBase, testDatabaseUrl } from "../helpers/db.js";

const suite = testDatabaseUrl ? describe : describe.skip;

suite("data model", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  suite("anti-overlap constraint", () => {
    test("rejects an overlapping booking for the same artist", async () => {
      const { artist, service } = await seedBase(prisma);
      await prisma.booking.create({
        data: bookingData({ serviceId: service.id, artistId: artist.id, start: "10:00", end: "11:30" }),
      });

      await expect(Promise.resolve(
        prisma.booking.create({
          data: bookingData({ serviceId: service.id, artistId: artist.id, start: "11:00", end: "12:30" }),
        }))).rejects.toThrow(/bookings_no_overlap|23P01|exclusion/i);
    });

    test("allows back-to-back bookings (end_at = start_at)", async () => {
      const { artist, service } = await seedBase(prisma);
      await prisma.booking.create({
        data: bookingData({ serviceId: service.id, artistId: artist.id, start: "10:00", end: "11:30" }),
      });
      const next = await prisma.booking.create({
        data: bookingData({ serviceId: service.id, artistId: artist.id, start: "11:30", end: "13:00" }),
      });
      expect(next.status).toBe("pending");
    });

    test("allows the same time for a different artist", async () => {
      const { artist, otherArtist, service } = await seedBase(prisma);
      await prisma.booking.create({
        data: bookingData({ serviceId: service.id, artistId: artist.id, start: "10:00", end: "11:30" }),
      });
      await prisma.booking.create({
        data: bookingData({ serviceId: service.id, artistId: otherArtist.id, start: "10:00", end: "11:30" }),
      });
    });

    test("frees the slot once a booking is cancelled or no_show", async () => {
      const { artist, service } = await seedBase(prisma);
      for (const status of ["cancelled", "no_show"] as const) {
        await prisma.booking.create({
          data: bookingData({ serviceId: service.id, artistId: artist.id, start: "14:00", end: "15:30", status }),
        });
      }
      // two inactive bookings in the same slot do not conflict, and neither blocks a new one
      await prisma.booking.create({
        data: bookingData({ serviceId: service.id, artistId: artist.id, start: "14:00", end: "15:30" }),
      });
    });

    test("cancelling frees the slot but reactivating into a taken slot is rejected", async () => {
      const { artist, service } = await seedBase(prisma);
      const first = await prisma.booking.create({
        data: bookingData({ serviceId: service.id, artistId: artist.id, start: "10:00", end: "11:30" }),
      });
      await prisma.booking.update({ where: { id: first.id }, data: { status: "cancelled" } });
      await prisma.booking.create({
        data: bookingData({ serviceId: service.id, artistId: artist.id, start: "10:00", end: "11:30" }),
      });
      await expect(Promise.resolve(
        prisma.booking.update({ where: { id: first.id }, data: { status: "confirmed" } }))).rejects.toThrow(/bookings_no_overlap|23P01|exclusion/i);
    });

    test("two concurrent requests for the same slot: exactly one succeeds", async () => {
      const { artist, service } = await seedBase(prisma);
      const attempt = () =>
        prisma.booking.create({
          data: bookingData({ serviceId: service.id, artistId: artist.id, start: "16:00", end: "17:30" }),
        });

      const results = await Promise.allSettled(Array.from({ length: 5 }, attempt));

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(4);
      expect(await prisma.booking.count()).toBe(1);
    });
  });

  suite("check constraints", () => {
    test("booking must end after it starts", async () => {
      const { artist, service } = await seedBase(prisma);
      await expect(Promise.resolve(
        prisma.booking.create({
          data: bookingData({ serviceId: service.id, artistId: artist.id, start: "11:00", end: "11:00" }),
        }))).rejects.toThrow(/bookings_time_order_check|check/i);
    });

    test("service duration must be a positive multiple of 15", async () => {
      const base = { name: "x", category: "c", price: 1000 };
      await expect(Promise.resolve(prisma.service.create({ data: { ...base, durationMinutes: 20 } }))).rejects.toThrow();
      await expect(Promise.resolve(prisma.service.create({ data: { ...base, durationMinutes: 0 } }))).rejects.toThrow();
      await expect(Promise.resolve(prisma.service.create({ data: { ...base, durationMinutes: 15 } }))).resolves.toBeDefined();
    });

    test("service price cannot be negative", async () => {
      await expect(Promise.resolve(
        prisma.service.create({ data: { name: "x", category: "c", price: -1, durationMinutes: 30 } }))).rejects.toThrow();
    });

    test("blocked slot must end after it starts", async () => {
      await expect(Promise.resolve(prisma.blockedSlot.create({ data: { startAt: at("10:00"), endAt: at("09:00") } }))).rejects.toThrow();
      await expect(Promise.resolve(prisma.blockedSlot.create({ data: { startAt: at("10:00"), endAt: at("12:00") } }))).resolves.toBeDefined();
    });

    test("business hours: open days need valid, ordered times; one row per weekday", async () => {
      await expect(Promise.resolve(prisma.businessHour.create({ data: { dayOfWeek: 1, isOpen: true } }))).rejects.toThrow();
      await expect(Promise.resolve(
        prisma.businessHour.create({ data: { dayOfWeek: 1, isOpen: true, openTime: "20:00", closeTime: "10:00" } }))).rejects.toThrow();
      await expect(Promise.resolve(
        prisma.businessHour.create({ data: { dayOfWeek: 1, isOpen: true, openTime: "9:00", closeTime: "20:00" } }))).rejects.toThrow();
      await expect(Promise.resolve(prisma.businessHour.create({ data: { dayOfWeek: 7, isOpen: false } }))).rejects.toThrow();

      await prisma.businessHour.create({
        data: { dayOfWeek: 1, isOpen: true, openTime: "10:00", closeTime: "20:00", breakStart: "12:00", breakEnd: "13:00" },
      });
      await expect(Promise.resolve(prisma.businessHour.create({ data: { dayOfWeek: 1, isOpen: false } }))).rejects.toThrow();
    });

    test("business hours: break must sit inside opening hours", async () => {
      await expect(Promise.resolve(
        prisma.businessHour.create({
          data: { dayOfWeek: 2, isOpen: true, openTime: "10:00", closeTime: "20:00", breakStart: "08:00", breakEnd: "09:00" },
        }))).rejects.toThrow();
      await expect(Promise.resolve(
        prisma.businessHour.create({
          data: { dayOfWeek: 2, isOpen: true, openTime: "10:00", closeTime: "20:00", breakStart: "12:00" },
        }))).rejects.toThrow();
    });
  });

  suite("relations", () => {
    test("status history cascades with its booking; admin delete keeps history", async () => {
      const { artist, service } = await seedBase(prisma);
      const admin = await prisma.admin.create({ data: { email: "o@x.test", passwordHash: "h", name: "Owner" } });
      const booking = await prisma.booking.create({
        data: bookingData({ serviceId: service.id, artistId: artist.id, start: "10:00", end: "11:30" }),
      });
      await prisma.bookingStatusHistory.create({
        data: { bookingId: booking.id, fromStatus: null, toStatus: "pending" },
      });
      await prisma.bookingStatusHistory.create({
        data: { bookingId: booking.id, fromStatus: "pending", toStatus: "confirmed", changedBy: admin.id },
      });

      await prisma.admin.delete({ where: { id: admin.id } });
      const rows = await prisma.bookingStatusHistory.findMany({ orderBy: { changedAt: "asc" } });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.changedBy === null)).toBe(true);

      await prisma.booking.delete({ where: { id: booking.id } });
      expect(await prisma.bookingStatusHistory.count()).toBe(0);
    });

    test("refresh tokens are deleted with their admin; token hashes are unique", async () => {
      const admin = await prisma.admin.create({ data: { email: "o@x.test", passwordHash: "h", name: "Owner" } });
      const token = { adminId: admin.id, tokenHash: "abc", expiresAt: at("10:00", "2026-12-01") };
      await prisma.refreshToken.create({ data: token });
      await expect(Promise.resolve(prisma.refreshToken.create({ data: token }))).rejects.toThrow();

      await prisma.admin.delete({ where: { id: admin.id } });
      expect(await prisma.refreshToken.count()).toBe(0);
    });

    test("a service or artist with bookings cannot be hard-deleted", async () => {
      const { artist, service } = await seedBase(prisma);
      await prisma.booking.create({
        data: bookingData({ serviceId: service.id, artistId: artist.id, start: "10:00", end: "11:30" }),
      });
      await expect(Promise.resolve(prisma.service.delete({ where: { id: service.id } }))).rejects.toThrow();
      await expect(Promise.resolve(prisma.artist.delete({ where: { id: artist.id } }))).rejects.toThrow();
    });

    test("defaults: booking is pending/online, admin role is owner, uuid ids are generated", async () => {
      const { artist, service } = await seedBase(prisma);
      const booking = await prisma.booking.create({
        data: bookingData({ serviceId: service.id, artistId: artist.id, start: "10:00", end: "11:30" }),
      });
      expect([booking.status, booking.source]).toEqual(["pending", "online"]);
      expect(booking.id).toMatch(/^[0-9a-f-]{36}$/);
      const admin = await prisma.admin.create({ data: { email: "o@x.test", passwordHash: "h", name: "Owner" } });
      expect(admin.role).toBe("owner");
    });
  });
});
