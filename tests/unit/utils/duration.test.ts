import { describe, expect, test } from "bun:test";
import { parseDurationSeconds } from "../../../src/utils/duration.js";

describe("parseDurationSeconds", () => {
  test("parses every unit", () => {
    expect(parseDurationSeconds("30s")).toBe(30);
    expect(parseDurationSeconds("15m")).toBe(900);
    expect(parseDurationSeconds("2h")).toBe(7200);
    expect(parseDurationSeconds("7d")).toBe(604800);
  });

  test("rejects malformed values", () => {
    for (const bad of ["", "15", "m", "1.5h", "-5m", "10 min", "7D"]) {
      expect(() => parseDurationSeconds(bad)).toThrow();
    }
  });
});
