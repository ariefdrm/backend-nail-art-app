import { describe, expect, test } from "bun:test";
import { listNotificationsSchemas, notificationIdSchemas } from "../../../src/schemas/notification.schema.js";

const parse = (query: unknown) => listNotificationsSchemas.query.safeParse(query);

describe("notification schemas", () => {
  test("defaults to the first page of 20, all notifications", () => {
    expect(parse({}).data).toEqual({ unread: false, page: 1, per_page: 20 });
  });

  test("reads unread=true and unread=false as real booleans (not 'false' as true)", () => {
    expect(parse({ unread: "true" }).data?.unread).toBe(true);
    expect(parse({ unread: "false" }).data?.unread).toBe(false);
    expect(parse({ unread: "yes" }).success).toBe(false);
    expect(parse({ unread: "1" }).success).toBe(false);
  });

  test("bounds the page and page size", () => {
    expect(parse({ page: "0" }).success).toBe(false);
    expect(parse({ per_page: "101" }).success).toBe(false);
    expect(parse({ per_page: "100", page: "3" }).data).toMatchObject({ per_page: 100, page: 3 });
  });

  test("the id must be a uuid", () => {
    expect(notificationIdSchemas.params.safeParse({ id: "nope" }).success).toBe(false);
    expect(notificationIdSchemas.params.safeParse({ id: "11111111-1111-4111-8111-111111111111" }).success).toBe(true);
  });
});
