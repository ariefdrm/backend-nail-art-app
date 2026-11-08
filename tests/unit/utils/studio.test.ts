import { describe, expect, test } from "bun:test";
import { STUDIO_NAME, firstName } from "../../../src/utils/studio.js";

describe("studio helpers", () => {
  test("firstName takes the first word and ignores extra spaces", () => {
    expect(firstName("  Siti   Rahayu ")).toBe("Siti");
    expect(firstName("Budi")).toBe("Budi");
  });

  test("the studio name is fixed", () => {
    expect(STUDIO_NAME).toBe("The Nail Palace");
  });
});
