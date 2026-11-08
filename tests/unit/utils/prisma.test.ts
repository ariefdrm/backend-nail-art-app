import { describe, expect, test } from "bun:test";
import { prismaErrorCode, sqlState } from "../../../src/utils/prisma.js";

// Shapes recorded from real PostgreSQL errors surfaced through @prisma/adapter-pg.
const exclusionViolation = {
  name: "PrismaClientKnownRequestError",
  code: "P2039",
  meta: { driverAdapterError: { cause: { originalCode: "23P01", kind: "postgres" } } },
};
const restrictViolation = {
  name: "PrismaClientKnownRequestError",
  code: "P2003",
  meta: { driverAdapterError: { cause: { originalCode: "23001", kind: "RestrictViolation" } } },
};

describe("prismaErrorCode", () => {
  test("reads Prisma's own error code", () => {
    expect(prismaErrorCode(restrictViolation)).toBe("P2003");
    expect(prismaErrorCode(exclusionViolation)).toBe("P2039");
  });

  test("is undefined for anything that is not an object with a string code", () => {
    for (const value of [undefined, null, "P2003", 42, new Error("x"), { code: 2003 }]) {
      expect(prismaErrorCode(value)).toBeUndefined();
    }
  });
});

describe("sqlState", () => {
  test("reads the PostgreSQL SQLSTATE from the driver adapter error", () => {
    expect(sqlState(exclusionViolation)).toBe("23P01");
    expect(sqlState(restrictViolation)).toBe("23001");
  });

  test("is undefined when the error carries no driver details", () => {
    for (const value of [undefined, null, {}, { meta: {} }, { meta: { driverAdapterError: {} } }, new Error("x")]) {
      expect(sqlState(value)).toBeUndefined();
    }
  });
});
