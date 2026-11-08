import { describe, expect, test } from "bun:test";
import { assertStartInWindow } from "../../../src/utils/booking-window.js";
import type { AppError } from "../../../src/utils/errors.js";

const NOW = new Date("2026-11-09T01:00:00Z"); // Monday 08:00 WIB

function failure(fn: () => void): AppError {
  try {
    fn();
  } catch (error) {
    return error as AppError;
  }
  throw new Error("expected a failure");
}

describe("assertStartInWindow", () => {
  test("accepts a future start inside the window, including the last allowed day", () => {
    expect(() => assertStartInWindow(new Date("2026-11-10T03:00:00Z"), NOW, 60)).not.toThrow();
    expect(() => assertStartInWindow(new Date("2027-01-08T10:00:00Z"), NOW, 60)).not.toThrow();
  });

  test("rejects the present and the past with 422 on the given field", () => {
    for (const start of [NOW, new Date("2026-11-09T00:59:00Z")]) {
      const error = failure(() => assertStartInWindow(start, NOW, 60, "start_at"));
      expect(error.httpStatus).toBe(422);
      expect(error.details?.[0]?.field).toBe("start_at");
    }
  });

  test("rejects a start beyond the advance window", () => {
    const error = failure(() => assertStartInWindow(new Date("2027-01-09T03:00:00Z"), NOW, 60));
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details?.[0]?.message).toContain("60");
  });
});
