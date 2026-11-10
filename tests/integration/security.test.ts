// Rate limiting, security headers, CORS and /docs over HTTP. None of this needs a database.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import express from "express";
import { errorHandler } from "../../src/middleware/error-handler.js";
import { createRateLimiter } from "../../src/middleware/rate-limit.js";
import { startServer, type TestServer } from "../helpers/http.js";

const ALLOWED = "https://allowed.test"; // CORS_ORIGINS in tests/setup.ts

/** A throwaway app with one limiter, to exercise the 429 behaviour with a tiny limit. */
async function limitedApp(limit: number, failuresOnly = false) {
  const app = express();
  app.use(createRateLimiter({ windowMs: 60_000, limit: () => limit, failuresOnly }));
  app.get("/ping", (req, res) => {
    res.status(req.query["fail"] ? 401 : 200).json({ ok: !req.query["fail"] });
  });
  app.use(errorHandler);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

describe("rate limiter", () => {
  test("answers 429 RATE_LIMITED with Retry-After once the limit is used up", async () => {
    const app = await limitedApp(2);
    try {
      expect((await fetch(`${app.base}/ping`)).status).toBe(200);
      expect((await fetch(`${app.base}/ping`)).status).toBe(200);
      const limited = await fetch(`${app.base}/ping`);
      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({
        error: { code: "RATE_LIMITED", message: "Terlalu banyak permintaan, coba lagi nanti" },
      });
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    } finally {
      app.close();
    }
  });

  test("reports the policy and what is left in the RateLimit headers", async () => {
    const app = await limitedApp(5);
    try {
      const res = await fetch(`${app.base}/ping`);
      expect(res.headers.get("ratelimit")).toContain("limit=5");
      expect(res.headers.get("ratelimit")).toContain("remaining=4");
      expect(res.headers.get("ratelimit-policy")).toBe("5;w=60");
      expect(res.headers.get("x-ratelimit-limit")).toBeNull(); // legacy headers are off
    } finally {
      app.close();
    }
  });

  test("failuresOnly counts errors but not successes (what a login guesser produces)", async () => {
    const app = await limitedApp(2, true);
    try {
      for (let i = 0; i < 5; i += 1) expect((await fetch(`${app.base}/ping`)).status).toBe(200);
      expect((await fetch(`${app.base}/ping?fail=1`)).status).toBe(401);
      expect((await fetch(`${app.base}/ping?fail=1`)).status).toBe(401);
      expect((await fetch(`${app.base}/ping?fail=1`)).status).toBe(429);
      expect((await fetch(`${app.base}/ping`)).status).toBe(429); // blocked for everything once over
    } finally {
      app.close();
    }
  });

  test("the limit is read when the request arrives, not when the limiter is built", async () => {
    let limit = 1;
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, limit: () => limit }));
    app.get("/ping", (_req, res) => void res.json({ ok: true }));
    app.use(errorHandler);
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/ping`)).status).toBe(200);
      expect((await fetch(`${base}/ping`)).status).toBe(429);
      limit = 10;
      expect((await fetch(`${base}/ping`)).status).toBe(200);
    } finally {
      server.close();
    }
  });
});

describe("the real app", () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(() => server.close());

  const call = (path: string, init: RequestInit = {}) => fetch(`${server.base}${path}`, init);
  const postJson = (path: string, body: unknown) =>
    call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  describe("rate limiters are wired to the right routes", () => {
    // The route-level limiter writes the RateLimit-Policy header last, so it shows which window applies.
    // Requests here fail validation (422) before touching the database.
    const policyOf = (res: Response) => res.headers.get("ratelimit-policy");

    test("login and refresh use the 15 minute auth window", async () => {
      expect(policyOf(await postJson("/api/v1/auth/login", {}))).toBe("100000;w=900");
      expect(policyOf(await postJson("/api/v1/auth/refresh", {}))).toBe("100000;w=900");
    });

    test("creating a booking uses the hourly window", async () => {
      expect(policyOf(await postJson("/api/v1/bookings", {}))).toBe("100000;w=3600");
    });

    test("looking up and cancelling a booking use the 15 minute lookup window", async () => {
      expect(policyOf(await call("/api/v1/bookings/NP-20261110-ABCD"))).toBe("100000;w=900");
      const cancel = await call("/api/v1/bookings/NP-20261110-ABCD/cancel", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(policyOf(cancel)).toBe("100000;w=900");
    });

    test("other API routes fall under the general one-minute ceiling; health checks are not limited", async () => {
      expect(policyOf(await call("/api/v1/admin/bookings"))).toBe("100000;w=60");
      expect((await call("/health/live")).headers.get("ratelimit-policy")).toBeNull();
    });
  });

  describe("security headers", () => {
    test("API responses carry the helmet defaults and do not advertise Express", async () => {
      const res = await call("/health/live");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      expect(res.headers.get("strict-transport-security")).toContain("max-age=");
      expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(res.headers.get("x-powered-by")).toBeNull();
    });

    test("error responses carry them too", async () => {
      const res = await call("/api/v1/does-not-exist");
      expect(res.status).toBe(404);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });
  });

  describe("CORS allowlist", () => {
    test("an allowed origin is echoed back, with Vary: Origin", async () => {
      const res = await call("/health/live", { headers: { origin: ALLOWED } });
      expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
      expect(res.headers.get("vary")).toContain("Origin");
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
      expect(res.headers.get("access-control-expose-headers")).toContain("Retry-After");
    });

    test("any other origin gets no CORS headers, so the browser blocks it", async () => {
      for (const origin of ["https://evil.test", "https://allowed.test.evil.test", "null"]) {
        const res = await call("/health/live", { headers: { origin } });
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
      }
    });

    test("a request without an Origin header works and gets no CORS headers", async () => {
      const res = await call("/health/live");
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });

    test("a preflight from an allowed origin is answered 204 without auth, and is not rate limited", async () => {
      const res = await call("/api/v1/admin/bookings", {
        method: "OPTIONS",
        headers: {
          origin: ALLOWED,
          "access-control-request-method": "PATCH",
          "access-control-request-headers": "authorization,content-type",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
      expect(res.headers.get("access-control-allow-methods")).toContain("PATCH");
      expect(res.headers.get("access-control-allow-headers")).toBe("Authorization,Content-Type");
      expect(res.headers.get("access-control-max-age")).toBe("600");
      expect(res.headers.get("ratelimit-policy")).toBeNull();
    });

    test("a preflight from another origin gets no allowance", async () => {
      const res = await call("/api/v1/admin/bookings", {
        method: "OPTIONS",
        headers: { origin: "https://evil.test", "access-control-request-method": "GET" },
      });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  describe("/docs (open here because NODE_ENV is test)", () => {
    test("redirects /docs to /docs/ so the relative asset URLs resolve", async () => {
      const res = await call("/docs", { redirect: "manual" });
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("/docs/");
    });

    test("serves the Swagger UI page with a CSP that allows only its own scripts", async () => {
      const res = await call("/docs/");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("swagger-ui-bundle.js");
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(csp).not.toMatch(/https?:\/\//); // nothing is loaded from another origin
    });

    test("serves the contract, the UI assets and the initializer", async () => {
      const spec = await call("/docs/openapi.yaml");
      expect(spec.status).toBe(200);
      expect(await spec.text()).toContain("openapi: 3");
      const bundle = await call("/docs/assets/swagger-ui-bundle.js");
      expect(bundle.status).toBe(200);
      expect(bundle.headers.get("content-type")).toContain("javascript");
      const init = await call("/docs/initializer.js");
      expect(init.status).toBe(200);
      expect(await init.text()).toContain("openapi.yaml");
    });
  });
});
