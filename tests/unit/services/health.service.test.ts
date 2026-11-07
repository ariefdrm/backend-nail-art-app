import { beforeEach, describe, expect, mock, test } from "bun:test";

let pingResult: "ok" | "fail" = "ok";

// The repository is the only layer that touches Prisma, so unit tests mock it.
await mock.module("../../../src/repositories/health.repository.js", () => ({
  pingDatabase: () => (pingResult === "ok" ? Promise.resolve() : Promise.reject(new Error("connection refused"))),
}));

const { isReady } = await import("../../../src/services/health.service.js");

describe("isReady", () => {
  beforeEach(() => {
    pingResult = "ok";
  });

  test("is true when the database answers", async () => {
    expect(await isReady()).toBe(true);
  });

  test("is false when the database ping fails", async () => {
    pingResult = "fail";
    expect(await isReady()).toBe(false);
  });
});
