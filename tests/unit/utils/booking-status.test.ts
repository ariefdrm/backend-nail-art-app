import { describe, expect, test } from "bun:test";
import { canTransition, isActiveStatus, requiresStarted } from "../../../src/utils/booking-status.js";

describe("booking status rules", () => {
  test("allows exactly the documented transitions", () => {
    const allowed: [string, string][] = [
      ["pending", "confirmed"],
      ["pending", "cancelled"],
      ["confirmed", "completed"],
      ["confirmed", "cancelled"],
      ["confirmed", "no_show"],
    ];
    const all = ["pending", "confirmed", "completed", "cancelled", "no_show"];
    for (const from of all) {
      for (const to of all) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to)).toBe(expected);
      }
    }
  });

  test("an unknown status has no transitions", () => {
    expect(canTransition("archived", "pending")).toBe(false);
  });

  test("only pending and confirmed are active", () => {
    expect(["pending", "confirmed"].every(isActiveStatus)).toBe(true);
    expect(["completed", "cancelled", "no_show", "x"].some(isActiveStatus)).toBe(false);
  });

  test("completed and no_show need the appointment to have started", () => {
    expect(requiresStarted("completed")).toBe(true);
    expect(requiresStarted("no_show")).toBe(true);
    expect(requiresStarted("confirmed")).toBe(false);
    expect(requiresStarted("cancelled")).toBe(false);
  });
});
