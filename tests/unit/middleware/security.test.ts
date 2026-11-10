import { describe, expect, test } from "bun:test";
import type { NextFunction, Request, Response } from "express";
import { isAllowedOrigin, requireAllowedOrigin } from "../../../src/middleware/security.js";

describe("isAllowedOrigin", () => {
  const allowed = ["https://app.example.test", "http://localhost:5173"];

  test("allows only exact matches from the allowlist", () => {
    expect(isAllowedOrigin("https://app.example.test", allowed)).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173", allowed)).toBe(true);
  });

  test("refuses look-alikes, other schemes and ports, and a trailing slash", () => {
    for (const origin of [
      "https://app.example.test.evil.test",
      "https://evil.test",
      "http://app.example.test",
      "http://localhost:3000",
      "https://app.example.test/",
      "null",
    ]) {
      expect(isAllowedOrigin(origin, allowed)).toBe(false);
    }
  });

  test("a request without an Origin header is not a CORS request and gets no allowance", () => {
    expect(isAllowedOrigin(undefined, allowed)).toBe(false);
  });

  test("an empty allowlist allows nothing", () => {
    expect(isAllowedOrigin("https://app.example.test", [])).toBe(false);
  });
});

describe("requireAllowedOrigin", () => {
  function run(origin?: string): unknown {
    let received: unknown = "not called";
    const req = { get: (name: string) => (name.toLowerCase() === "origin" ? origin : undefined) } as Request;
    requireAllowedOrigin(req, {} as Response, ((err?: unknown) => (received = err)) as NextFunction);
    return received;
  }

  test("lets a listed origin and a request without Origin through", () => {
    expect(run("https://allowed.test")).toBeUndefined(); // CORS_ORIGINS from tests/setup.ts
    expect(run(undefined)).toBeUndefined();
  });

  test("refuses an unlisted origin with FORBIDDEN", () => {
    expect(run("https://evil.test")).toMatchObject({ code: "FORBIDDEN", httpStatus: 403 });
  });
});
