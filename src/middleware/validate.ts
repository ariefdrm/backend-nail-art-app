import type { RequestHandler, Response } from "express";
import type { z } from "zod";
import { AppError, type ErrorDetail } from "../utils/errors.js";

export interface ValidationSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

export type Validated<S extends ValidationSchemas> = {
  [K in keyof S]: S[K] extends z.ZodType ? z.output<S[K]> : never;
};

const SOURCES = ["params", "query", "body"] as const;

/**
 * Validates request parts with zod and stores the parsed values on
 * `res.locals.validated` (Express 5 makes `req.query` read-only).
 * Read them in controllers with `getValidated`.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, res, next) => {
    const validated: Record<string, unknown> = {};
    const details: ErrorDetail[] = [];

    for (const source of SOURCES) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (result.success) {
        validated[source] = result.data;
      } else {
        for (const issue of result.error.issues) {
          details.push({
            field: [source === "body" ? null : source, ...issue.path].filter((p) => p !== null).join("."),
            message: issue.message,
          });
        }
      }
    }

    if (details.length > 0) {
      next(AppError.validation(details));
      return;
    }

    res.locals.validated = validated;
    next();
  };
}

export function getValidated<S extends ValidationSchemas>(res: Response): Validated<S> {
  return res.locals.validated as Validated<S>;
}
