import { describe, expect, test } from "bun:test";
import { normalizePhone } from "../../../src/utils/phone.js";

describe("normalizePhone", () => {
  test("turns 08..., 62... and +62... into the same E.164 number", () => {
    expect(normalizePhone("081234567890")).toBe("+6281234567890");
    expect(normalizePhone("6281234567890")).toBe("+6281234567890");
    expect(normalizePhone("+6281234567890")).toBe("+6281234567890");
  });

  test("ignores spaces, dashes, dots and parentheses", () => {
    expect(normalizePhone(" 0812-3456 7890 ")).toBe("+6281234567890");
    expect(normalizePhone("+62 (812) 345.6789")).toBe("+628123456789");
  });

  test("rejects landlines, foreign numbers, wrong lengths and non-numbers", () => {
    expect(normalizePhone("0741123456")).toBeNull(); // Jambi landline
    expect(normalizePhone("+14155550123")).toBeNull();
    expect(normalizePhone("0812345")).toBeNull(); // too short
    expect(normalizePhone("08123456789012345")).toBeNull(); // too long
    expect(normalizePhone("0812abc4567")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("812345678901")).toBeNull(); // no prefix
  });
});
