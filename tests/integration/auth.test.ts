// Full admin auth flow over HTTP against a real PostgreSQL (DATABASE_URL_TEST).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import app from "../../src/app.js";
import { disconnectPrisma } from "../../src/utils/prisma.js";
import { hashPassword } from "../../src/utils/password.js";
import { hashRefreshToken } from "../../src/utils/tokens.js";
import { cleanDatabase, createTestPrisma, testDatabaseUrl } from "../helpers/db.js";

const suite = testDatabaseUrl ? describe : describe.skip;
const PASSWORD = "a-long-enough-password";

suite("admin auth", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  let server: Server;
  let base: string;
  let adminId: string;

  async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${base}/api/v1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  async function login(email = "owner@nailpalace.test", password = PASSWORD) {
    return post("/auth/login", { email, password });
  }

  beforeAll(async () => {
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    const admin = await prisma.admin.create({
      data: { email: "owner@nailpalace.test", passwordHash: await hashPassword(PASSWORD), name: "Owner" },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    server.close();
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  test("login returns a TokenPair in the documented shape", async () => {
    const res = await login();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(Object.keys(data).sort()).toEqual(["access_token", "expires_in", "refresh_token", "token_type"]);
    expect(data.token_type).toBe("Bearer");
    expect(data.expires_in).toBe(900);
  });

  test("login stores only a hash of the refresh token, plus client info", async () => {
    const res = await post(
      "/auth/login",
      { email: "owner@nailpalace.test", password: PASSWORD },
      { "user-agent": "bun-test" },
    );
    const { data } = (await res.json()) as { data: { refresh_token: string } };
    const rows = await prisma.refreshToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(hashRefreshToken(data.refresh_token));
    expect(rows[0]?.tokenHash).not.toBe(data.refresh_token);
    expect(rows[0]?.userAgent).toBe("bun-test");
    expect(rows[0]?.adminId).toBe(adminId);
  });

  test("email is matched case-insensitively and trimmed", async () => {
    expect((await login("  Owner@NailPalace.test ")).status).toBe(200);
  });

  test("wrong password and unknown email return the same 401", async () => {
    const wrong = await login("owner@nailpalace.test", "wrong-password");
    const unknown = await login("nobody@nailpalace.test");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  test("invalid login input is a 422 with field details", async () => {
    const res = await post("/auth/login", { email: "not-an-email" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; details: { field: string }[] } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.map((d) => d.field).sort()).toEqual(["email", "password"]);
  });

  test("GET /auth/me returns the profile with a valid access token", async () => {
    const { data } = (await (await login()).json()) as { data: { access_token: string } };
    const res = await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${data.access_token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { id: adminId, name: "Owner", email: "owner@nailpalace.test", role: "owner" },
    });
  });

  test("GET /auth/me without or with a bad token is 401", async () => {
    expect((await fetch(`${base}/api/v1/auth/me`)).status).toBe(401);
    const bad = await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: "Bearer nope" } });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  test("a valid access token for a deleted admin is rejected by /auth/me", async () => {
    const { data } = (await (await login()).json()) as { data: { access_token: string } };
    await prisma.admin.delete({ where: { id: adminId } });
    const res = await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${data.access_token}` } });
    expect(res.status).toBe(401);
  });

  test("refresh rotates the token; the old one cannot be used again", async () => {
    const first = ((await (await login()).json()) as { data: { refresh_token: string } }).data;

    const rotatedRes = await post("/auth/refresh", { refresh_token: first.refresh_token });
    expect(rotatedRes.status).toBe(200);
    const second = ((await rotatedRes.json()) as { data: { refresh_token: string; access_token: string } }).data;
    expect(second.refresh_token).not.toBe(first.refresh_token);

    // reusing the old token is refused ...
    const reuse = await post("/auth/refresh", { refresh_token: first.refresh_token });
    expect(reuse.status).toBe(401);

    // ... and, as a theft response, kills the whole family including the new token
    const afterReuse = await post("/auth/refresh", { refresh_token: second.refresh_token });
    expect(afterReuse.status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  test("the new access token from a refresh works", async () => {
    const first = ((await (await login()).json()) as { data: { refresh_token: string } }).data;
    const second = (
      (await (await post("/auth/refresh", { refresh_token: first.refresh_token })).json()) as {
        data: { access_token: string };
      }
    ).data;
    const me = await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${second.access_token}` } });
    expect(me.status).toBe(200);
  });

  test("two concurrent refreshes of one token: one wins, the family is revoked", async () => {
    const { refresh_token } = ((await (await login()).json()) as { data: { refresh_token: string } }).data;
    const results = await Promise.all([
      post("/auth/refresh", { refresh_token }),
      post("/auth/refresh", { refresh_token }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[1]).toBe(401);
    expect(statuses[0] === 200 || statuses[0] === 401).toBe(true);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  test("expired and unknown refresh tokens are rejected", async () => {
    const { refresh_token } = ((await (await login()).json()) as { data: { refresh_token: string } }).data;
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post("/auth/refresh", { refresh_token })).status).toBe(401);
    expect((await post("/auth/refresh", { refresh_token: "never-issued" })).status).toBe(401);
  });

  test("responses never leak the password hash", async () => {
    const login200 = await (await login()).text();
    expect(login200).not.toContain("argon2");
    const { data } = JSON.parse(login200) as { data: { access_token: string } };
    const me = await (
      await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${data.access_token}` } })
    ).text();
    expect(me).not.toContain("argon2");
    expect(me).not.toContain("passwordHash");
  });
});
