import { describe, expect, test } from "bun:test";
import { buildPagination, ok, paginated } from "../../../src/utils/response.js";

describe("response helpers", () => {
  test("ok wraps data", () => {
    expect(ok({ a: 1 })).toEqual({ data: { a: 1 } });
  });

  test("buildPagination rounds total_pages up", () => {
    expect(buildPagination(2, 20, 45)).toEqual({ page: 2, per_page: 20, total: 45, total_pages: 3 });
    expect(buildPagination(1, 20, 0).total_pages).toBe(0);
  });

  test("paginated returns data and meta", () => {
    const meta = buildPagination(1, 10, 1);
    expect(paginated(["x"], meta)).toEqual({ data: ["x"], meta });
  });
});
