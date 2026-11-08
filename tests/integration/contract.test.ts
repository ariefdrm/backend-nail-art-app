/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any -- response bodies are navigated as untyped JSON */
// Contract tests: real responses must match documents/openapi.yaml (status, body schema, no undocumented fields).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { addDays, jakartaDayStart, toJakartaIso } from "../../src/utils/datetime.js";
import { disconnectPrisma } from "../../src/utils/prisma.js";
import { at, cleanDatabase, createTestPrisma, seedBase, testDatabaseUrl } from "../helpers/db.js";
import { checkResponse, documentedOperations } from "../helpers/contract.js";
import { api, startServer, type TestServer } from "../helpers/http.js";

const suite = testDatabaseUrl ? describe : describe.skip;

const EMAIL = "owner@nailpalace.test";
const PASSWORD = "a-long-enough-password";
const inDays = (n: number) =>
  toJakartaIso(addDays(jakartaDayStart(toJakartaIso(new Date()).slice(0, 10)), n)).slice(0, 10);
const day = inDays(3);
const startAt = (hhmm: string) => `${day}T${hhmm}:00+07:00`;
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

type Json = Record<string, any>;

suite("API contract", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  let server: TestServer;
  let base: Awaited<ReturnType<typeof seedBase>>;
  let token: string;
  let refreshToken: string;

  const anon = () => api(server.base);
  const admin = () => api(server.base, token);

  // Mismatches are collected and asserted once per test, so a single run lists every gap in the contract.
  let mismatches: string[] = [];

  /** Asserts the status, and records anything that differs from what the contract documents for it. */
  async function expectContract(res: Response, method: string, specPath: string, status: number): Promise<Json> {
    expect(res.status).toBe(status);
    const { problems, body } = await checkResponse(res, method, specPath);
    mismatches.push(...problems);
    return body ?? {};
  }

  beforeAll(async () => {
    server = await startServer();
  });

  beforeEach(async () => {
    mismatches = [];
    await cleanDatabase(prisma);
    base = await seedBase(prisma);
    await prisma.businessHour.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        isOpen: true,
        openTime: "09:00",
        closeTime: "17:00",
        breakStart: "12:00",
        breakEnd: "13:00",
      })),
    });
    const { hashPassword } = await import("../../src/utils/password.js");
    await prisma.admin.create({
      data: { email: EMAIL, passwordHash: await hashPassword(PASSWORD), name: "Owner", role: "owner" },
    });
    const login = await expectContract(
      await anon().post("/auth/login", { email: EMAIL, password: PASSWORD }),
      "POST",
      "/auth/login",
      200,
    );
    token = login["data"].access_token;
    refreshToken = login["data"].refresh_token;
  });

  afterEach(() => {
    expect([...new Set(mismatches)]).toEqual([]);
  });

  afterAll(async () => {
    server.close();
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  test("every operation in the contract is routed (none answers 'endpoint not found')", async () => {
    for (const { method, path } of documentedOperations()) {
      const url = path.replace(/\{[^}]+\}/g, UNKNOWN);
      const res = await fetch(`${server.base}/api/v1${url}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
      });
      const body = (await res.json().catch(() => ({}))) as Json;
      expect(`${method} ${path} -> ${body["error"]?.message ?? res.status}`).not.toContain("Endpoint tidak ditemukan");
    }
  });

  test("public catalog", async () => {
    const services = await expectContract(await anon().get("/services"), "GET", "/services", 200);
    expect(services["data"]).toHaveLength(1);
    await expectContract(await anon().get(`/services/${base.service.id}`), "GET", "/services/{id}", 200);
    await expectContract(await anon().get(`/services/${UNKNOWN}`), "GET", "/services/{id}", 404);
    await expectContract(await anon().get("/services/not-a-uuid"), "GET", "/services/{id}", 422);
    const artists = await expectContract(await anon().get("/artists"), "GET", "/artists", 200);
    expect(artists["data"]).toHaveLength(2);
  });

  test("availability", async () => {
    const ok = await expectContract(
      await anon().get(`/availability?service_id=${base.service.id}&date=${day}`),
      "GET",
      "/availability",
      200,
    );
    expect(ok["data"].slots.length).toBeGreaterThan(0);
    await expectContract(await anon().get(`/availability?service_id=${base.service.id}`), "GET", "/availability", 422);
    await expectContract(
      await anon().get(`/availability?service_id=${UNKNOWN}&date=${day}`),
      "GET",
      "/availability",
      404,
    );
  });

  test("customer booking: create, look up, cancel, and the documented failures", async () => {
    const body = {
      service_id: base.service.id,
      start_at: startAt("09:00"),
      customer_name: "Siti",
      customer_phone: "0812345678" + "9",
    };
    const created = await expectContract(await anon().post("/bookings", body), "POST", "/bookings", 201);
    const code = created["data"].booking_code;

    await expectContract(
      await anon().post("/bookings", { ...body, artist_id: created["data"].artist.id }),
      "POST",
      "/bookings",
      409,
    );
    await expectContract(await anon().post("/bookings", {}), "POST", "/bookings", 422);
    await expectContract(await anon().post("/bookings", { ...body, service_id: UNKNOWN }), "POST", "/bookings", 404);

    const phone = encodeURIComponent("+628123456789");
    await expectContract(await anon().get(`/bookings/${code}?phone=${phone}`), "GET", "/bookings/{booking_code}", 200);
    await expectContract(
      await anon().get(`/bookings/${code}?phone=%2B6289999999999`),
      "GET",
      "/bookings/{booking_code}",
      404,
    );

    const cancel = (payload: unknown) => anon().patch(`/bookings/${code}/cancel`, payload);
    await expectContract(await cancel({}), "PATCH", "/bookings/{booking_code}/cancel", 422);
    await expectContract(await cancel({ phone: "081234567" + "89" }), "PATCH", "/bookings/{booking_code}/cancel", 200);
    await expectContract(await cancel({ phone: "081234567" + "89" }), "PATCH", "/bookings/{booking_code}/cancel", 409);
    await expectContract(
      await anon().patch("/bookings/NP-20261110-ZZZZ/cancel", { phone: "08123456789" }),
      "PATCH",
      "/bookings/{booking_code}/cancel",
      404,
    );
  });

  test("auth", async () => {
    await expectContract(
      await anon().post("/auth/login", { email: EMAIL, password: "wrong-password-123" }),
      "POST",
      "/auth/login",
      401,
    );
    await expectContract(await anon().post("/auth/login", {}), "POST", "/auth/login", 422);
    await expectContract(await admin().get("/auth/me"), "GET", "/auth/me", 200);
    await expectContract(await anon().get("/auth/me"), "GET", "/auth/me", 401);

    const refreshed = await expectContract(
      await anon().post("/auth/refresh", { refresh_token: refreshToken }),
      "POST",
      "/auth/refresh",
      200,
    );
    await expectContract(await anon().post("/auth/refresh", { refresh_token: "nope" }), "POST", "/auth/refresh", 401);
    await expectContract(
      await anon().post("/auth/logout", { refresh_token: refreshed["data"].refresh_token }),
      "POST",
      "/auth/logout",
      204,
    );
    await expectContract(await admin().post("/auth/logout-all", {}), "POST", "/auth/logout-all", 204);
  });

  test("admin catalog", async () => {
    await expectContract(await admin().get("/admin/services"), "GET", "/admin/services", 200);
    await expectContract(await anon().get("/admin/services"), "GET", "/admin/services", 401);
    const service = { name: "Nail Art", category: "nail_art", price: 100000, duration_minutes: 60 };
    const created = await expectContract(
      await admin().post("/admin/services", service),
      "POST",
      "/admin/services",
      201,
    );
    const id = created["data"].id;
    await expectContract(await admin().post("/admin/services", {}), "POST", "/admin/services", 422);
    await expectContract(
      await admin().put(`/admin/services/${id}`, { ...service, price: 120000 }),
      "PUT",
      "/admin/services/{id}",
      200,
    );
    await expectContract(await admin().put(`/admin/services/${UNKNOWN}`, service), "PUT", "/admin/services/{id}", 404);
    await expectContract(await admin().delete(`/admin/services/${id}`), "DELETE", "/admin/services/{id}", 204);
    await expectContract(await admin().delete(`/admin/services/${id}`), "DELETE", "/admin/services/{id}", 404);

    await expectContract(await admin().get("/admin/artists"), "GET", "/admin/artists", 200);
    const artist = await expectContract(
      await admin().post("/admin/artists", { name: "Dewi" }),
      "POST",
      "/admin/artists",
      201,
    );
    await expectContract(await admin().post("/admin/artists", {}), "POST", "/admin/artists", 422);
    await expectContract(
      await admin().put(`/admin/artists/${artist["data"].id}`, { name: "Dewi A" }),
      "PUT",
      "/admin/artists/{id}",
      200,
    );
    await expectContract(
      await admin().put(`/admin/artists/${UNKNOWN}`, { name: "X" }),
      "PUT",
      "/admin/artists/{id}",
      404,
    );
    await expectContract(
      await admin().delete(`/admin/artists/${artist["data"].id}`),
      "DELETE",
      "/admin/artists/{id}",
      204,
    );
    await expectContract(await admin().delete(`/admin/artists/${UNKNOWN}`), "DELETE", "/admin/artists/{id}", 404);
  });

  test("admin bookings", async () => {
    const body = {
      service_id: base.service.id,
      start_at: startAt("09:00"),
      customer_name: "Siti",
      customer_phone: "08123456789",
    };
    const created = await expectContract(await admin().post("/admin/bookings", body), "POST", "/admin/bookings", 201);
    const id = created["data"].id;
    await expectContract(await admin().post("/admin/bookings", {}), "POST", "/admin/bookings", 422);
    await expectContract(
      await admin().post("/admin/bookings", { ...body, service_id: UNKNOWN }),
      "POST",
      "/admin/bookings",
      404,
    );
    await expectContract(await anon().post("/admin/bookings", body), "POST", "/admin/bookings", 401);

    const list = await expectContract(await admin().get("/admin/bookings?per_page=5"), "GET", "/admin/bookings", 200);
    expect(list["meta"].total).toBe(1);
    await expectContract(await admin().get("/admin/bookings?status=nope"), "GET", "/admin/bookings", 422);

    await expectContract(await admin().get(`/admin/bookings/${id}`), "GET", "/admin/bookings/{id}", 200);
    await expectContract(await admin().get(`/admin/bookings/${UNKNOWN}`), "GET", "/admin/bookings/{id}", 404);
    await expectContract(
      await admin().patch(`/admin/bookings/${id}`, { admin_note: "ok" }),
      "PATCH",
      "/admin/bookings/{id}",
      200,
    );
    await expectContract(await admin().patch(`/admin/bookings/${id}`, {}), "PATCH", "/admin/bookings/{id}", 422);
    await expectContract(
      await admin().patch(`/admin/bookings/${UNKNOWN}`, { admin_note: "x" }),
      "PATCH",
      "/admin/bookings/{id}",
      404,
    );
    await expectContract(
      await admin().patch(`/admin/bookings/${id}`, { start_at: startAt("12:00") }),
      "PATCH",
      "/admin/bookings/{id}",
      409,
    );

    await expectContract(
      await admin().patch(`/admin/bookings/${id}/status`, { status: "completed" }),
      "PATCH",
      "/admin/bookings/{id}/status",
      409,
    );
    await expectContract(
      await admin().patch(`/admin/bookings/${id}/status`, { status: "cancelled" }),
      "PATCH",
      "/admin/bookings/{id}/status",
      422,
    );
    await expectContract(
      await admin().patch(`/admin/bookings/${UNKNOWN}/status`, { status: "cancelled", reason: "x" }),
      "PATCH",
      "/admin/bookings/{id}/status",
      404,
    );
    await expectContract(
      await admin().patch(`/admin/bookings/${id}/status`, { status: "cancelled", reason: "Batal" }),
      "PATCH",
      "/admin/bookings/{id}/status",
      200,
    );
  });

  test("schedule management", async () => {
    await expectContract(await admin().get("/admin/business-hours"), "GET", "/admin/business-hours", 200);
    const week = Array.from({ length: 7 }, (_, d) => ({
      day_of_week: d,
      is_open: d !== 0,
      ...(d !== 0 ? { open_time: "10:00", close_time: "20:00" } : {}),
    }));
    await expectContract(
      await admin().put("/admin/business-hours", { hours: week }),
      "PUT",
      "/admin/business-hours",
      200,
    );
    await expectContract(
      await admin().put("/admin/business-hours", { hours: [] }),
      "PUT",
      "/admin/business-hours",
      422,
    );

    // an existing booking makes the block conflict
    await prisma.booking.create({
      data: {
        bookingCode: "NP-20261110-TEST",
        serviceId: base.service.id,
        artistId: base.artist.id,
        startAt: at("10:00", day),
        endAt: at("11:30", day),
        customerName: "Siti",
        customerPhone: "+6281234567890",
        totalPrice: 150000,
      },
    });
    const slot = { start_at: startAt("10:00"), end_at: startAt("12:00"), reason: "Cuti" };
    const check = await expectContract(
      await admin().post("/admin/blocked-slots/check", slot),
      "POST",
      "/admin/blocked-slots/check",
      200,
    );
    expect(check["data"].can_block).toBe(false);
    await expectContract(
      await admin().post("/admin/blocked-slots/check", {}),
      "POST",
      "/admin/blocked-slots/check",
      422,
    );
    await expectContract(await admin().post("/admin/blocked-slots", slot), "POST", "/admin/blocked-slots", 409);
    const created = await expectContract(
      await admin().post("/admin/blocked-slots", { ...slot, acknowledge_conflicts: true }),
      "POST",
      "/admin/blocked-slots",
      201,
    );
    await expectContract(await admin().get("/admin/blocked-slots"), "GET", "/admin/blocked-slots", 200);
    await expectContract(
      await admin().delete(`/admin/blocked-slots/${created["data"].id}`),
      "DELETE",
      "/admin/blocked-slots/{id}",
      204,
    );
    await expectContract(
      await admin().delete(`/admin/blocked-slots/${UNKNOWN}`),
      "DELETE",
      "/admin/blocked-slots/{id}",
      404,
    );
  });

  test("CSV export", async () => {
    await prisma.booking.create({
      data: {
        bookingCode: "NP-20261110-CSV1",
        serviceId: base.service.id,
        artistId: base.artist.id,
        startAt: at("10:00", day),
        endAt: at("11:30", day),
        customerName: "Siti",
        customerPhone: "+6281234567890",
        totalPrice: 150000,
      },
    });
    const csv = await expectContract(
      await admin().get("/admin/export/bookings.csv"),
      "GET",
      "/admin/export/bookings.csv",
      200,
    );
    // for a CSV the "body" returned by expectContract is the raw text
    const text: unknown = csv;
    expect(typeof text === "string" ? text.split("\r\n")[0] : "").toStartWith("booking_id,status,source");
    await expectContract(
      await admin().get("/admin/export/bookings.csv?date_from=nope"),
      "GET",
      "/admin/export/bookings.csv",
      422,
    );
    await expectContract(await anon().get("/admin/export/bookings.csv"), "GET", "/admin/export/bookings.csv", 401);
    const { loginAdmin } = await import("../helpers/http.js");
    const staff = await loginAdmin(prisma, server.base, "staff@nailpalace.test", "staff");
    await expectContract(
      await api(server.base, staff).get("/admin/export/bookings.csv"),
      "GET",
      "/admin/export/bookings.csv",
      403,
    );
  });

  test("dashboard", async () => {
    await expectContract(
      await admin().get(`/admin/dashboard/summary?date_from=${day}&date_to=${day}`),
      "GET",
      "/admin/dashboard/summary",
      200,
    );
    await expectContract(await admin().get("/admin/dashboard/summary"), "GET", "/admin/dashboard/summary", 422);
    await expectContract(
      await anon().get(`/admin/dashboard/summary?date_from=${day}&date_to=${day}`),
      "GET",
      "/admin/dashboard/summary",
      401,
    );
  });
});
