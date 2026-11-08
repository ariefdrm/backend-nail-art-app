// Service and artist catalog over HTTP against a real PostgreSQL (DATABASE_URL_TEST).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { disconnectPrisma } from "../../src/utils/prisma.js";
import { bookingData, cleanDatabase, createTestPrisma, seedBase, testDatabaseUrl } from "../helpers/db.js";
import { api, loginAdmin, startServer, type TestServer } from "../helpers/http.js";

const suite = testDatabaseUrl ? describe : describe.skip;

const validService = {
  name: "Gel Polish + Nail Art",
  description: "Warna pilihan",
  category: "gel_polish",
  price: 150000,
  duration_minutes: 90,
  image_url: "https://example.test/gel.jpg",
};

interface ServiceBody {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price: number;
  duration_minutes: number;
  image_url: string | null;
  is_active: boolean;
}

suite("catalog", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  let server: TestServer;
  let token: string;

  const publicApi = () => api(server.base);
  const admin = () => api(server.base, token);

  beforeAll(async () => {
    server = await startServer();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    token = await loginAdmin(prisma, server.base);
  });

  afterAll(async () => {
    server.close();
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  describe("public", () => {
    test("GET /services lists only active services, ordered by category then name", async () => {
      await prisma.service.createMany({
        data: [
          { name: "Zebra", category: "b", price: 1000, durationMinutes: 30 },
          { name: "Alpha", category: "b", price: 1000, durationMinutes: 30 },
          { name: "Mid", category: "a", price: 1000, durationMinutes: 30 },
          { name: "Hidden", category: "a", price: 1000, durationMinutes: 30, isActive: false },
        ],
      });
      const res = await publicApi().get("/services");
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as { data: ServiceBody[] };
      expect(data.map((s) => s.name)).toEqual(["Mid", "Alpha", "Zebra"]);
    });

    test("GET /services?category= filters; an unknown category is an empty list", async () => {
      await prisma.service.createMany({
        data: [
          { name: "A", category: "gel_polish", price: 1000, durationMinutes: 30 },
          { name: "B", category: "extension", price: 1000, durationMinutes: 30 },
        ],
      });
      const gel = (await (await publicApi().get("/services?category=gel_polish")).json()) as { data: ServiceBody[] };
      expect(gel.data.map((s) => s.name)).toEqual(["A"]);
      const none = (await (await publicApi().get("/services?category=nope")).json()) as { data: ServiceBody[] };
      expect(none.data).toEqual([]);
    });

    test("GET /services returns the documented fields and nothing else", async () => {
      await prisma.service.create({ data: { name: "A", category: "c", price: 1000, durationMinutes: 30 } });
      const { data } = (await (await publicApi().get("/services")).json()) as { data: Record<string, unknown>[] };
      expect(Object.keys(data[0] ?? {}).sort()).toEqual(
        ["category", "description", "duration_minutes", "id", "image_url", "is_active", "name", "price"].sort(),
      );
    });

    test("GET /services/{id}: 200 when active; 404 when inactive or unknown; 422 for a bad id", async () => {
      const active = await prisma.service.create({
        data: { name: "A", category: "c", price: 1000, durationMinutes: 30 },
      });
      const inactive = await prisma.service.create({
        data: { name: "B", category: "c", price: 1000, durationMinutes: 30, isActive: false },
      });

      const ok = await publicApi().get(`/services/${active.id}`);
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { data: ServiceBody }).data.id).toBe(active.id);

      expect((await publicApi().get(`/services/${inactive.id}`)).status).toBe(404);
      expect((await publicApi().get("/services/99999999-9999-4999-8999-999999999999")).status).toBe(404);

      const bad = await publicApi().get("/services/not-a-uuid");
      expect(bad.status).toBe(422);
      expect(await bad.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    });

    test("GET /artists lists only active artists and needs no login", async () => {
      await prisma.artist.createMany({
        data: [{ name: "Owner" }, { name: "Former", isActive: false }],
      });
      const res = await publicApi().get("/artists");
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as { data: { name: string; photo_url: string | null }[] };
      expect(data.map((a) => a.name)).toEqual(["Owner"]);
      expect(data[0]?.photo_url).toBeNull();
    });
  });

  describe("admin authorization", () => {
    test("every /admin/services and /admin/artists route answers 401 without a token", async () => {
      const id = "99999999-9999-4999-8999-999999999999";
      const anon = api(server.base);
      const responses = await Promise.all([
        anon.get("/admin/services"),
        anon.post("/admin/services", validService),
        anon.put(`/admin/services/${id}`, validService),
        anon.delete(`/admin/services/${id}`),
        anon.get("/admin/artists"),
        anon.post("/admin/artists", { name: "x" }),
        anon.put(`/admin/artists/${id}`, { name: "x" }),
        anon.delete(`/admin/artists/${id}`),
      ]);
      expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401, 401, 401]);
    });
  });

  describe("admin services", () => {
    test("GET /admin/services includes inactive services", async () => {
      await prisma.service.createMany({
        data: [
          { name: "A", category: "c", price: 1000, durationMinutes: 30 },
          { name: "B", category: "c", price: 1000, durationMinutes: 30, isActive: false },
        ],
      });
      const { data } = (await (await admin().get("/admin/services")).json()) as { data: ServiceBody[] };
      expect(data.map((s) => s.is_active).sort()).toEqual([false, true]);
    });

    test("POST creates a service (201) and is_active defaults to true", async () => {
      const res = await admin().post("/admin/services", validService);
      expect(res.status).toBe(201);
      const { data } = (await res.json()) as { data: ServiceBody };
      expect(data).toMatchObject({ ...validService, is_active: true });
      expect(data.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await prisma.service.count()).toBe(1);
    });

    test("POST stores an empty description and a missing image as null, and trims names", async () => {
      const res = await admin().post("/admin/services", {
        name: "  Spaced  ",
        category: "c",
        price: 0,
        duration_minutes: 15,
        description: "",
      });
      const { data } = (await res.json()) as { data: ServiceBody };
      expect(data).toMatchObject({ name: "Spaced", description: null, image_url: null, price: 0 });
    });

    test.each([
      ["duration not a multiple of 15", { duration_minutes: 20 }, "duration_minutes"],
      ["duration too short", { duration_minutes: 0 }, "duration_minutes"],
      ["duration too long", { duration_minutes: 495 }, "duration_minutes"],
      ["negative price", { price: -1 }, "price"],
      ["fractional price", { price: 10.5 }, "price"],
      ["empty name", { name: "   " }, "name"],
      ["name over 120 chars", { name: "x".repeat(121) }, "name"],
      ["javascript: image url", { image_url: "javascript:alert(1)" }, "image_url"],
      ["non-url image", { image_url: "not a url" }, "image_url"],
      ["category over 50 chars", { category: "c".repeat(51) }, "category"],
    ])("POST rejects %s with 422 pointing at the field", async (_label, patch, field) => {
      const res = await admin().post("/admin/services", { ...validService, ...patch });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: { code: string; details: { field: string }[] } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details.map((d) => d.field)).toContain(field);
      expect(await prisma.service.count()).toBe(0);
    });

    test("POST rejects missing required fields", async () => {
      const res = await admin().post("/admin/services", { name: "Only a name" });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: { details: { field: string }[] } };
      expect(body.error.details.map((d) => d.field).sort()).toEqual(["category", "duration_minutes", "price"]);
    });

    test("PUT replaces a service (200); unknown id is 404; invalid input is 422", async () => {
      const created = (await (await admin().post("/admin/services", validService)).json()) as { data: ServiceBody };
      const res = await admin().put(`/admin/services/${created.data.id}`, {
        ...validService,
        price: 175000,
        is_active: false,
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { data: ServiceBody }).data).toMatchObject({ price: 175000, is_active: false });

      const missing = await admin().put("/admin/services/99999999-9999-4999-8999-999999999999", validService);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({ error: { code: "NOT_FOUND" } });

      const invalid = await admin().put(`/admin/services/${created.data.id}`, { ...validService, price: -5 });
      expect(invalid.status).toBe(422);
    });

    test("a deactivated service disappears from the public catalog", async () => {
      const created = (await (await admin().post("/admin/services", validService)).json()) as { data: ServiceBody };
      expect(((await (await publicApi().get("/services")).json()) as { data: unknown[] }).data).toHaveLength(1);
      await admin().put(`/admin/services/${created.data.id}`, { ...validService, is_active: false });
      expect(((await (await publicApi().get("/services")).json()) as { data: unknown[] }).data).toHaveLength(0);
    });

    test("DELETE removes a service nobody booked (204)", async () => {
      const service = await prisma.service.create({
        data: { name: "A", category: "c", price: 1000, durationMinutes: 30 },
      });
      const res = await admin().delete(`/admin/services/${service.id}`);
      expect(res.status).toBe(204);
      expect(await prisma.service.count()).toBe(0);
    });

    test("DELETE keeps a service that has bookings and deactivates it (204)", async () => {
      const { artist, service } = await seedBase(prisma);
      await prisma.booking.create({
        data: bookingData({ serviceId: service.id, artistId: artist.id, start: "10:00", end: "11:30" }),
      });
      const res = await admin().delete(`/admin/services/${service.id}`);
      expect(res.status).toBe(204);

      const row = await prisma.service.findUnique({ where: { id: service.id } });
      expect(row?.isActive).toBe(false);
      expect(await prisma.booking.count()).toBe(1);
      expect((await publicApi().get(`/services/${service.id}`)).status).toBe(404);
    });

    test("DELETE: unknown id is 404 and a malformed id is 422", async () => {
      expect((await admin().delete("/admin/services/99999999-9999-4999-8999-999999999999")).status).toBe(404);
      expect((await admin().delete("/admin/services/nope")).status).toBe(422);
    });
  });

  describe("admin artists", () => {
    test("POST creates (201), PUT updates (200), GET lists inactive ones too", async () => {
      const created = await admin().post("/admin/artists", { name: "Second", photo_url: "https://example.test/a.jpg" });
      expect(created.status).toBe(201);
      const { data } = (await created.json()) as { data: { id: string; is_active: boolean; photo_url: string } };
      expect(data.is_active).toBe(true);

      const updated = await admin().put(`/admin/artists/${data.id}`, { name: "Second Renamed", is_active: false });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({
        data: { name: "Second Renamed", is_active: false, photo_url: null },
      });

      const list = (await (await admin().get("/admin/artists")).json()) as { data: { name: string }[] };
      expect(list.data.map((a) => a.name)).toEqual(["Second Renamed"]);
      expect(((await (await publicApi().get("/artists")).json()) as { data: unknown[] }).data).toHaveLength(0);
    });

    test("POST rejects an empty name, a long name, and a non-http photo with 422", async () => {
      for (const body of [{ name: "" }, { name: "x".repeat(81) }, { name: "ok", photo_url: "ftp://x.test/a.jpg" }]) {
        expect((await admin().post("/admin/artists", body)).status).toBe(422);
      }
      expect(await prisma.artist.count()).toBe(0);
    });

    test("DELETE deactivates an artist and keeps their bookings (204)", async () => {
      const { artist, service } = await seedBase(prisma);
      await prisma.booking.create({
        data: bookingData({ serviceId: service.id, artistId: artist.id, start: "10:00", end: "11:30" }),
      });
      const res = await admin().delete(`/admin/artists/${artist.id}`);
      expect(res.status).toBe(204);

      expect((await prisma.artist.findUnique({ where: { id: artist.id } }))?.isActive).toBe(false);
      expect(await prisma.booking.count()).toBe(1);
      const names = ((await (await publicApi().get("/artists")).json()) as { data: { name: string }[] }).data.map(
        (a) => a.name,
      );
      expect(names).not.toContain(artist.name === "Owner" ? "Owner" : artist.name);
    });

    test("PUT and DELETE answer 404 for an unknown artist", async () => {
      const id = "99999999-9999-4999-8999-999999999999";
      expect((await admin().put(`/admin/artists/${id}`, { name: "x" })).status).toBe(404);
      expect((await admin().delete(`/admin/artists/${id}`)).status).toBe(404);
    });
  });
});
