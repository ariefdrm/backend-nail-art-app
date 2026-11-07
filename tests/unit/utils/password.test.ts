import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "../../../src/utils/password.js";

describe("password", () => {
  test("hashes with argon2id and verifies", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong password")).toBe(false);
  });

  test("uses a random salt", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  test("returns false instead of throwing on a malformed hash", async () => {
    expect(await verifyPassword("not-a-hash", "whatever")).toBe(false);
  });
});
