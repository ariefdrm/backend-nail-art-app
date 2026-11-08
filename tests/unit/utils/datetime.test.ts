import { describe, expect, test } from "bun:test";
import { addDays, formatJakartaLong, jakartaDayStart, toJakartaIso } from "../../../src/utils/datetime.js";

describe("toJakartaIso", () => {
  test("renders an instant with the +07:00 offset and no milliseconds", () => {
    expect(toJakartaIso(new Date("2026-11-10T03:00:00.000Z"))).toBe("2026-11-10T10:00:00+07:00");
  });

  test("rolls the date over when UTC is still the previous day", () => {
    expect(toJakartaIso(new Date("2026-11-09T18:30:00Z"))).toBe("2026-11-10T01:30:00+07:00");
  });

  test("round-trips with the parser", () => {
    const original = new Date("2026-12-31T20:15:00Z");
    expect(new Date(toJakartaIso(original)).getTime()).toBe(original.getTime());
  });
});

describe("jakartaDayStart / addDays", () => {
  test("a calendar day starts at 00:00 WIB (17:00 UTC the day before)", () => {
    expect(jakartaDayStart("2026-11-10").toISOString()).toBe("2026-11-09T17:00:00.000Z");
  });

  test("adds whole days", () => {
    expect(addDays(jakartaDayStart("2026-11-30"), 1).toISOString()).toBe("2026-11-30T17:00:00.000Z");
  });
});

describe("formatJakartaLong", () => {
  test("uses Indonesian day and month names in WIB", () => {
    expect(formatJakartaLong(new Date("2026-11-10T03:00:00Z"))).toBe("Selasa, 10 November 2026 pukul 10.00 WIB");
  });

  test("pads minutes and crosses midnight correctly", () => {
    expect(formatJakartaLong(new Date("2026-12-31T17:05:00Z"))).toBe("Jumat, 1 Januari 2027 pukul 00.05 WIB");
  });
});
