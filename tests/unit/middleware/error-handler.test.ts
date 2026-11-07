import { describe, expect, test } from "bun:test";
import type { Request, Response } from "express";
import { z } from "zod";
import { errorHandler } from "../../../src/middleware/error-handler.js";
import { AppError } from "../../../src/utils/errors.js";

function run(err: unknown, headersSent = false) {
  const logged: unknown[] = [];
  const out: { status?: number; body?: unknown; nextErr?: unknown } = {};
  const req = { log: { error: (...args: unknown[]) => logged.push(args) } } as unknown as Request;
  const res = {
    headersSent,
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: unknown) {
      out.body = body;
      return this;
    },
  } as unknown as Response;
  errorHandler(err, req, res, (e?: unknown) => {
    out.nextErr = e;
  });
  return { ...out, logged };
}

describe("errorHandler", () => {
  test("formats AppError", () => {
    const r = run(AppError.slotUnavailable());
    expect(r.status).toBe(409);
    expect(r.body).toEqual({
      error: { code: "SLOT_UNAVAILABLE", message: "Jadwal yang dipilih sudah tidak tersedia" },
    });
    expect(r.logged).toHaveLength(0);
  });

  test("maps ZodError to 422 with details", () => {
    const parsed = z.object({ a: z.string() }).safeParse({});
    const r = run(parsed.error);
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ error: { code: "VALIDATION_ERROR", details: [{ field: "a" }] } });
  });

  test("maps malformed JSON to 422", () => {
    const r = run(Object.assign(new SyntaxError("bad"), { type: "entity.parse.failed" }));
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ error: { code: "VALIDATION_ERROR", message: "Body JSON tidak valid" } });
  });

  test("hides unexpected errors behind a generic 500 and logs them", () => {
    const r = run(new Error("secret db password in message"));
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Terjadi kesalahan pada server" } });
    expect(r.logged).toHaveLength(1);
  });

  test("delegates when headers were already sent", () => {
    const err = new Error("late");
    const r = run(err, true);
    expect(r.nextErr).toBe(err);
    expect(r.status).toBeUndefined();
  });
});
