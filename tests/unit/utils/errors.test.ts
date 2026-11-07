import { describe, expect, test } from "bun:test";
import { AppError, toErrorBody } from "../../../src/utils/errors.js";

describe("AppError", () => {
  test("factories set code and status", () => {
    expect([AppError.validation().code, AppError.validation().httpStatus]).toEqual(["VALIDATION_ERROR", 422]);
    expect([AppError.unauthorized().code, AppError.unauthorized().httpStatus]).toEqual(["UNAUTHORIZED", 401]);
    expect([AppError.forbidden().code, AppError.forbidden().httpStatus]).toEqual(["FORBIDDEN", 403]);
    expect([AppError.notFound().code, AppError.notFound().httpStatus]).toEqual(["NOT_FOUND", 404]);
    expect([AppError.slotUnavailable().code, AppError.slotUnavailable().httpStatus]).toEqual(["SLOT_UNAVAILABLE", 409]);
    expect([AppError.invalidStatusTransition().code, AppError.invalidStatusTransition().httpStatus]).toEqual([
      "INVALID_STATUS_TRANSITION",
      409,
    ]);
  });

  test("toErrorBody matches the OpenAPI error format", () => {
    const details = [{ field: "customer_phone", message: "Format nomor telepon tidak valid" }];
    expect(toErrorBody(AppError.validation(details))).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Input tidak valid", details },
    });
  });

  test("toErrorBody omits details when there are none", () => {
    expect(toErrorBody(AppError.notFound())).toEqual({
      error: { code: "NOT_FOUND", message: "Data tidak ditemukan" },
    });
  });
});
