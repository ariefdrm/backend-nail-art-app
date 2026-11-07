import { describe, expect, test } from "bun:test";
import type { Request, Response } from "express";
import { authenticate, getAuthAdmin, requireRole } from "../../../src/middleware/auth.js";
import type { AppError } from "../../../src/utils/errors.js";
import { signAccessToken } from "../../../src/utils/tokens.js";

const owner = { id: "6f1f7f0e-9a53-4f4e-8c1c-1c8f6b0f1a11", role: "owner" as const };

async function runAuthenticate(authorization?: string) {
  const req = { header: (name: string) => (name === "authorization" ? authorization : undefined) } as unknown as Request;
  const res = { locals: {} } as unknown as Response;
  const outcome = await new Promise<{ error?: unknown }>((resolve) => {
    void authenticate(req, res, (err?: unknown) => resolve({ error: err }));
  });
  return { res, ...outcome };
}

describe("authenticate", () => {
  test("accepts a valid bearer token and exposes the admin", async () => {
    const { token } = await signAccessToken(owner);
    const { res, error } = await runAuthenticate(`Bearer ${token}`);
    expect(error).toBeUndefined();
    expect(getAuthAdmin(res)).toEqual(owner);
  });

  test("is case-insensitive about the scheme", async () => {
    const { token } = await signAccessToken(owner);
    expect((await runAuthenticate(`bearer ${token}`)).error).toBeUndefined();
  });

  test.each([undefined, "", "Bearer", "Bearer ", "Basic abc", "Bearer not.a.jwt", "token-without-scheme"])(
    "rejects %p with 401",
    async (header) => {
      const { error } = await runAuthenticate(header);
      expect((error as AppError).code).toBe("UNAUTHORIZED");
      expect((error as AppError).httpStatus).toBe(401);
    },
  );
});

describe("requireRole", () => {
  function check(role: "owner" | "staff", allowed: ("owner" | "staff")[]) {
    const res = { locals: { admin: { id: owner.id, role } } } as unknown as Response;
    let error: unknown;
    void requireRole(...allowed)({} as Request, res, (err?: unknown) => {
      error = err;
    });
    return error as AppError | undefined;
  }

  test("lets an allowed role through", () => {
    expect(check("owner", ["owner"])).toBeUndefined();
    expect(check("staff", ["owner", "staff"])).toBeUndefined();
  });

  test("answers 403 FORBIDDEN otherwise", () => {
    const error = check("staff", ["owner"]);
    expect(error?.code).toBe("FORBIDDEN");
    expect(error?.httpStatus).toBe(403);
  });
});
