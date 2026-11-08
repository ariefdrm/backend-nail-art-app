import { describe, expect, test } from "bun:test";
import { dashboardSummarySchemas } from "../../../src/schemas/dashboard.schema.js";

const parse = (query: unknown) => dashboardSummarySchemas.query.safeParse(query);

describe("dashboardSummarySchemas", () => {
  test("accepts a range, including a single day and exactly 366 days", () => {
    expect(parse({ date_from: "2026-03-10", date_to: "2026-03-10" }).success).toBe(true);
    expect(parse({ date_from: "2026-01-01", date_to: "2026-12-31" }).success).toBe(true);
    expect(parse({ date_from: "2028-01-01", date_to: "2028-12-31" }).success).toBe(true); // leap year, 366 days
  });

  test("both dates are required and must be real calendar dates", () => {
    expect(parse({ date_from: "2026-03-10" }).success).toBe(false);
    expect(parse({ date_to: "2026-03-10" }).success).toBe(false);
    expect(parse({ date_from: "2026-02-30", date_to: "2026-03-10" }).success).toBe(false);
    expect(parse({ date_from: "10-03-2026", date_to: "2026-03-10" }).success).toBe(false);
  });

  test("rejects a reversed range and one longer than 366 days", () => {
    const reversed = parse({ date_from: "2026-03-11", date_to: "2026-03-10" });
    expect(reversed.success).toBe(false);
    expect(reversed.error?.issues[0]?.path).toEqual(["date_to"]);
    expect(parse({ date_from: "2026-01-01", date_to: "2027-01-02" }).success).toBe(false);
  });
});
