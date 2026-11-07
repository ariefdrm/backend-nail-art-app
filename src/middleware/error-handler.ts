import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError, toErrorBody } from "../utils/errors.js";

function hasType(err: unknown): err is { type: string } {
  return typeof err === "object" && err !== null && typeof (err as { type?: unknown }).type === "string";
}

function toAppError(err: unknown): AppError | undefined {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return AppError.validation(err.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
  }

  // body-parser errors (malformed JSON, oversized body)
  if (hasType(err)) {
    if (err.type === "entity.parse.failed") return AppError.validation(undefined, "Body JSON tidak valid");
    if (err.type === "entity.too.large") return new AppError("VALIDATION_ERROR", 413, "Body terlalu besar");
  }

  return undefined;
}

/** Maps any error to `{ error: { code, message, details } }` without leaking internals. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const known = toAppError(err);
  if (known) {
    res.status(known.httpStatus).json(toErrorBody(known));
    return;
  }

  req.log.error({ err }, "unhandled error");
  res.status(500).json(toErrorBody(new AppError("INTERNAL_ERROR", 500, "Terjadi kesalahan pada server")));
};
