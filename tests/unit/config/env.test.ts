import { describe, expect, test } from "bun:test";
import { EnvError, parseEnv } from "../../../src/config/env.js";

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
};

describe("parseEnv", () => {
  test("applies defaults for optional variables", () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.SLOT_STEP_MINUTES).toBe(30);
    expect(env.BOOKING_BUFFER_MINUTES).toBe(15);
    expect(env.MAX_ADVANCE_DAYS).toBe(60);
    expect(env.ACCESS_TOKEN_TTL).toBe("15m");
    expect(env.TZ).toBe("Asia/Jakarta");
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  test("coerces numbers and splits CORS origins", () => {
    const env = parseEnv({ ...valid, PORT: "8080", CORS_ORIGINS: "https://a.test, https://b.test," });
    expect(env.PORT).toBe(8080);
    expect(env.CORS_ORIGINS).toEqual(["https://a.test", "https://b.test"]);
  });

  test("fails fast and lists every problem", () => {
    try {
      parseEnv({ JWT_ACCESS_SECRET: "short" });
      throw new Error("expected parseEnv to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      const message = (err as EnvError).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("JWT_ACCESS_SECRET");
      expect(message).toContain("JWT_REFRESH_SECRET");
    }
  });

  test("rejects an invalid port", () => {
    expect(() => parseEnv({ ...valid, PORT: "99999" })).toThrow(EnvError);
  });
});
