import { describe, expect, test } from "bun:test";
import { readCookie } from "../../../src/utils/refresh-cookie.js";

describe("readCookie", () => {
  test("finds a cookie among several", () => {
    expect(readCookie("a=1; refresh_token=abc_-123; b=2", "refresh_token")).toBe("abc_-123");
  });

  test("returns undefined for a missing header, a missing name or an empty value", () => {
    expect(readCookie(undefined, "refresh_token")).toBeUndefined();
    expect(readCookie("a=1", "refresh_token")).toBeUndefined();
    expect(readCookie("refresh_token=", "refresh_token")).toBeUndefined();
  });

  test("does not match a cookie whose name merely ends with the wanted one", () => {
    expect(readCookie("x_refresh_token=evil", "refresh_token")).toBeUndefined();
  });

  test("a malformed percent-escape is treated as absent, not an error", () => {
    expect(readCookie("refresh_token=%E0%A4%A", "refresh_token")).toBeUndefined();
  });
});
