import { describe, expect, test } from "bun:test";
import { isAllowedOrigin } from "../../../src/middleware/security.js";

describe("isAllowedOrigin", () => {
  const allowed = ["https://app.example.test", "http://localhost:5173"];

  test("allows only exact matches from the allowlist", () => {
    expect(isAllowedOrigin("https://app.example.test", allowed)).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173", allowed)).toBe(true);
  });

  test("refuses look-alikes, other schemes and ports, and a trailing slash", () => {
    for (const origin of [
      "https://app.example.test.evil.test",
      "https://evil.test",
      "http://app.example.test",
      "http://localhost:3000",
      "https://app.example.test/",
      "null",
    ]) {
      expect(isAllowedOrigin(origin, allowed)).toBe(false);
    }
  });

  test("a request without an Origin header is not a CORS request and gets no allowance", () => {
    expect(isAllowedOrigin(undefined, allowed)).toBe(false);
  });

  test("an empty allowlist allows nothing", () => {
    expect(isAllowedOrigin("https://app.example.test", [])).toBe(false);
  });
});
