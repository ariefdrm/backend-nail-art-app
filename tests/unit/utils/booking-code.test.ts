import { describe, expect, test } from "bun:test";
import { generateBookingCode } from "../../../src/utils/booking-code.js";

describe("generateBookingCode", () => {
  test("uses the appointment day in WIB and four readable characters", () => {
    expect(generateBookingCode(new Date("2026-11-10T03:00:00Z"))).toMatch(/^NP-20261110-[A-HJKMNP-Z2-9]{4}$/);
  });

  test("the date follows Jakarta, not UTC", () => {
    // 2026-11-10T20:00Z is already 11 November in WIB
    expect(generateBookingCode(new Date("2026-11-10T20:00:00Z")).startsWith("NP-20261111-")).toBe(true);
  });

  test("draws different suffixes", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateBookingCode(new Date("2026-11-10T03:00:00Z"))));
    expect(codes.size).toBeGreaterThan(40);
  });
});
