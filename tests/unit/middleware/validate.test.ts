import { describe, expect, test } from "bun:test";
import type { Request, Response } from "express";
import { z } from "zod";
import { getValidated, validate } from "../../../src/middleware/validate.js";
import { AppError } from "../../../src/utils/errors.js";

function run(schemas: Parameters<typeof validate>[0], req: Partial<Request>) {
  const res = { locals: {} } as unknown as Response;
  let error: unknown;
  validate(schemas)(req as Request, res, (err?: unknown) => {
    error = err;
  });
  return { res, error };
}

describe("validate", () => {
  const schemas = {
    body: z.object({ name: z.string().min(1) }),
    query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
  };

  test("stores parsed values on res.locals", () => {
    const { res, error } = run(schemas, { body: { name: "Gel" }, query: { page: "2" } });
    expect(error).toBeUndefined();
    expect(getValidated<typeof schemas>(res)).toEqual({ body: { name: "Gel" }, query: { page: 2 } });
  });

  test("collects errors from every source as VALIDATION_ERROR", () => {
    const { error } = run(schemas, { body: { name: "" }, query: { page: "0" } });
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe("VALIDATION_ERROR");
    expect(appError.httpStatus).toBe(422);
    expect(appError.details?.map((d) => d.field).sort()).toEqual(["name", "query.page"]);
  });
});
