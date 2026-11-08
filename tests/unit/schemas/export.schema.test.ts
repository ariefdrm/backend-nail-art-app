import { describe, expect, test } from "bun:test";
import { exportBookingsSchemas } from "../../../src/schemas/export.schema.js";

const parse = (query: unknown) => exportBookingsSchemas.query.safeParse(query);

describe("exportBookingsSchemas", () => {
  test("every parameter is optional", () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ date_from: "2026-03-01" }).success).toBe(true);
    expect(parse({ status: "no_show" }).success).toBe(true);
  });

  test("rejects a reversed range, a bad date and an unknown status", () => {
    const reversed = parse({ date_from: "2026-03-02", date_to: "2026-03-01" });
    expect(reversed.success).toBe(false);
    expect(reversed.error?.issues[0]?.path).toEqual(["date_to"]);
    expect(parse({ date_from: "2026-02-30" }).success).toBe(false);
    expect(parse({ status: "done" }).success).toBe(false);
  });
});
