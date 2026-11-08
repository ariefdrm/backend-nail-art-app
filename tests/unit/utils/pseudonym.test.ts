import { describe, expect, test } from "bun:test";
import { customerRef } from "../../../src/utils/pseudonym.js";

const SECRET = "a".repeat(40);

describe("customerRef", () => {
  test("is 16 hex characters and stable for the same phone and secret", () => {
    const ref = customerRef("+6281234567890", SECRET);
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
    expect(customerRef("+6281234567890", SECRET)).toBe(ref);
  });

  test("differs between phones", () => {
    expect(customerRef("+6281234567890", SECRET)).not.toBe(customerRef("+6281234567891", SECRET));
  });

  test("differs between secrets, so it cannot be rebuilt without the server's secret", () => {
    expect(customerRef("+6281234567890", SECRET)).not.toBe(customerRef("+6281234567890", "b".repeat(40)));
  });

  test("does not contain the phone number", () => {
    expect(customerRef("+6281234567890", SECRET)).not.toContain("81234567890");
  });
});
