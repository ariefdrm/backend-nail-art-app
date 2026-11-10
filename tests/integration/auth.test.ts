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

  /** The refresh token the server set as a cookie (what a browser would store). */
  function cookieOf(res: Response): string | undefined {
    for (const line of res.headers.getSetCookie()) {
      const match = /^refresh_token=([^;]*)/.exec(line);
      if (match) return match[1];
    }
    return undefined;
  }

  /** The Cookie header a browser would send back. */
  function withCookie(token: string | undefined, extra: Record<string, string> = {}) {
    return { ...(token ? { cookie: `refresh_token=${token}` } : {}), ...extra };
  }

  async function login(email = "owner@nailpalace.test", password = PASSWORD) {
    return post("/auth/login", { email, password });
  }

  /** Logs in and returns the access token (body) and the refresh token (cookie). */
  async function loginTokens(email = "owner@nailpalace.test") {
    const res = await login(email);
    const { data } = (await res.json()) as { data: { access_token: string } };
    return { access_token: data.access_token, refresh_token: cookieOf(res) as string };
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

  test("login sets the refresh token as an HttpOnly cookie scoped to the auth routes", async () => {
    const res = await login();
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("refresh_token="));
    expect(cookie).toBeDefined();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/v1/auth");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain(`Max-Age=${7 * 24 * 3600}`);
    // the same token is also in the body, for clients that store it themselves
    expect(((await res.json()) as { data: { refresh_token: string } }).data.refresh_token).toBe(
      cookieOf(res) as string,
    );
  });

  test("login stores only a hash of the refresh token, plus client info", async () => {
    const res = await post(
      "/auth/login",
      { email: "owner@nailpalace.test", password: PASSWORD },
      { "user-agent": "bun-test" },
    );
    const token = cookieOf(res) as string;
    const rows = await prisma.refreshToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(hashRefreshToken(token));
    expect(rows[0]?.tokenHash).not.toBe(token);
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
    const first = await loginTokens();

    const rotatedRes = await post("/auth/refresh", {}, withCookie(first.refresh_token));
    expect(rotatedRes.status).toBe(200);
    const second = { refresh_token: cookieOf(rotatedRes) as string };
    expect(second.refresh_token).toBeTruthy();
    expect(second.refresh_token).not.toBe(first.refresh_token);
    // the rotated token is in the body as well as in the cookie
    expect(((await rotatedRes.json()) as { data: { refresh_token: string } }).data.refresh_token).toBe(
      second.refresh_token,
    );

    // reusing the old token is refused ...
    const reuse = await post("/auth/refresh", {}, withCookie(first.refresh_token));
    expect(reuse.status).toBe(401);

    // ... and, as a theft response, kills the whole family including the new token
    const afterReuse = await post("/auth/refresh", {}, withCookie(second.refresh_token));
    expect(afterReuse.status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  test("the new access token from a refresh works", async () => {
    const first = await loginTokens();
    const second = (
      (await (await post("/auth/refresh", {}, withCookie(first.refresh_token))).json()) as {
        data: { access_token: string };
      }
    ).data;
    const me = await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${second.access_token}` } });
    expect(me.status).toBe(200);
  });

  test("two concurrent refreshes of one token: one wins, the family is revoked", async () => {
    const { refresh_token } = await loginTokens();
    const results = await Promise.all([
      post("/auth/refresh", {}, withCookie(refresh_token)),
      post("/auth/refresh", {}, withCookie(refresh_token)),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[1]).toBe(401);
    expect(statuses[0] === 200 || statuses[0] === 401).toBe(true);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  test("refresh without a cookie and without a body token is a 401", async () => {
    await loginTokens();
    expect((await post("/auth/refresh", {})).status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(1);
  });

  describe("body mode (client stores the token itself)", () => {
    test("refresh accepts refresh_token in the body and still sets the new cookie", async () => {
      const { refresh_token } = await loginTokens();
      const res = await post("/auth/refresh", { refresh_token });
      expect(res.status).toBe(200);
      const rotated = cookieOf(res);
      expect(rotated).toBeTruthy();
      expect(rotated).not.toBe(refresh_token);
      expect((await post("/auth/refresh", { refresh_token })).status).toBe(401); // already used
    });

    test("a body token wins over a different cookie", async () => {
      const a = await loginTokens();
      const b = await loginTokens();
      const res = await post("/auth/refresh", { refresh_token: a.refresh_token }, withCookie(b.refresh_token));
      expect(res.status).toBe(200);
      // b was never presented, so it still works
      expect((await post("/auth/refresh", {}, withCookie(b.refresh_token))).status).toBe(200);
    });

    test("logout accepts the token in the body", async () => {
      const { refresh_token } = await loginTokens();
      expect((await post("/auth/logout", { refresh_token })).status).toBe(204);
      expect((await post("/auth/refresh", { refresh_token })).status).toBe(401);
    });

    test("a non-string refresh_token is a 422", async () => {
      expect((await post("/auth/refresh", { refresh_token: 123 })).status).toBe(422);
    });
  });

  describe("CSRF origin check on cookie endpoints", () => {
    const EVIL = { origin: "https://evil.test" };

    test("refresh and logout from an unlisted origin are refused and leave the session alone", async () => {
      const { refresh_token } = await loginTokens();
      for (const path of ["/auth/refresh", "/auth/logout"]) {
        const res = await post(path, {}, withCookie(refresh_token, EVIL));
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
      }
      expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(1);
    });

    test("an allowed origin works and gets credentialed CORS headers", async () => {
      const { refresh_token } = await loginTokens();
      const res = await post("/auth/refresh", {}, withCookie(refresh_token, { origin: "https://allowed.test" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("https://allowed.test");
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    });
  });

  test("expired and unknown refresh tokens are rejected", async () => {
    const { refresh_token } = await loginTokens();
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post("/auth/refresh", {}, withCookie(refresh_token))).status).toBe(401);
    expect((await post("/auth/refresh", {}, withCookie("never-issued"))).status).toBe(401);
  });

  describe("logout", () => {
    test("POST /auth/logout answers 204 and the token can no longer be refreshed", async () => {
      const { refresh_token } = await loginTokens();
      const res = await post("/auth/logout", {}, withCookie(refresh_token));
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");

      expect((await post("/auth/refresh", {}, withCookie(refresh_token))).status).toBe(401);
      expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    });

    test("logout needs no access token", async () => {
      const { refresh_token } = await loginTokens();
      const res = await post(
        "/auth/logout",
        {},
        withCookie(refresh_token, { authorization: "Bearer expired.or.invalid" }),
      );
      expect(res.status).toBe(204);
    });

    test("only the given session ends; another device stays logged in", async () => {
      const phone = await loginTokens();
      const laptop = await loginTokens();
      await post("/auth/logout", {}, withCookie(phone.refresh_token));

      expect((await post("/auth/refresh", {}, withCookie(laptop.refresh_token))).status).toBe(200);
      expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(1);
    });

    test("is idempotent: unknown, malformed and already-revoked tokens all answer 204", async () => {
      const { refresh_token } = await loginTokens();
      expect((await post("/auth/logout", {}, withCookie(refresh_token))).status).toBe(204);
      expect((await post("/auth/logout", {}, withCookie(refresh_token))).status).toBe(204);
      expect((await post("/auth/logout", {}, withCookie("never-issued"))).status).toBe(204);
    });

    test("logging out twice does not revoke the admin's other sessions", async () => {
      const first = await loginTokens();
      const second = await loginTokens();
      await post("/auth/logout", {}, withCookie(first.refresh_token));
      await post("/auth/logout", {}, withCookie(first.refresh_token));

      expect((await post("/auth/refresh", {}, withCookie(second.refresh_token))).status).toBe(200);
    });

    test("clears the cookie, and a missing cookie is still a 204", async () => {
      const { refresh_token } = await loginTokens();
      const res = await post("/auth/logout", {}, withCookie(refresh_token));
      const cleared = res.headers.getSetCookie().find((c) => c.startsWith("refresh_token="));
      expect(cleared).toContain("Path=/api/v1/auth");
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);
      expect((await post("/auth/logout", {})).status).toBe(204);
    });
  });

  describe("logout-all", () => {
    test("requires a valid access token", async () => {
      expect((await post("/auth/logout-all", {})).status).toBe(401);
      expect((await post("/auth/logout-all", {}, { authorization: "Bearer nope" })).status).toBe(401);
    });

    test("ends every session of the admin, but not other admins' sessions", async () => {
      const other = await prisma.admin.create({
        data: {
          email: "staff@nailpalace.test",
          passwordHash: await hashPassword(PASSWORD),
          name: "Staff",
          role: "staff",
        },
      });
      const a = await loginTokens();
      const b = await loginTokens();
      const staff = await loginTokens("staff@nailpalace.test");

      const res = await post("/auth/logout-all", {}, { authorization: `Bearer ${a.access_token}` });
      expect(res.status).toBe(204);

      expect(await prisma.refreshToken.count({ where: { adminId: adminId, revokedAt: null } })).toBe(0);
      expect(await prisma.refreshToken.count({ where: { adminId: other.id, revokedAt: null } })).toBe(1);
      expect((await post("/auth/refresh", {}, withCookie(b.refresh_token))).status).toBe(401);
      expect((await post("/auth/refresh", {}, withCookie(staff.refresh_token))).status).toBe(200);
    });

    test("the current access token keeps working until it expires (stateless JWT)", async () => {
      const { access_token } = ((await (await login()).json()) as { data: { access_token: string } }).data;
      await post("/auth/logout-all", {}, { authorization: `Bearer ${access_token}` });
      const me = await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${access_token}` } });
      expect(me.status).toBe(200);
    });
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
