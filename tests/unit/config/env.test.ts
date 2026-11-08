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

  test("rate limits default to sensible values and can be overridden", () => {
    const env = parseEnv(valid);
    expect([
      env.RATE_LIMIT_LOGIN_MAX,
      env.RATE_LIMIT_BOOKING_MAX,
      env.RATE_LIMIT_LOOKUP_MAX,
      env.RATE_LIMIT_GENERAL_MAX,
    ]).toEqual([10, 10, 30, 300]);
    expect(parseEnv({ ...valid, RATE_LIMIT_LOGIN_MAX: "3" }).RATE_LIMIT_LOGIN_MAX).toBe(3);
    expect(() => parseEnv({ ...valid, RATE_LIMIT_LOGIN_MAX: "0" })).toThrow(EnvError);
  });

  test("TRUST_PROXY defaults to one proxy in production and none elsewhere, and an explicit value wins", () => {
    expect(parseEnv({ ...valid, NODE_ENV: "production" }).TRUST_PROXY).toBe(1);
    expect(parseEnv({ ...valid, NODE_ENV: "development" }).TRUST_PROXY).toBe(0);
    expect(parseEnv(valid).TRUST_PROXY).toBe(0);
    expect(parseEnv({ ...valid, NODE_ENV: "production", TRUST_PROXY: "2" }).TRUST_PROXY).toBe(2);
    expect(parseEnv({ ...valid, NODE_ENV: "production", TRUST_PROXY: "0" }).TRUST_PROXY).toBe(0);
    expect(() => parseEnv({ ...valid, TRUST_PROXY: "-1" })).toThrow(EnvError);
  });

  test("a blank TRUST_PROXY or DOCS_PASSWORD (KEY= in a .env file) counts as unset", () => {
    const env = parseEnv({ ...valid, NODE_ENV: "production", TRUST_PROXY: "", DOCS_PASSWORD: "" });
    expect(env.TRUST_PROXY).toBe(1);
    expect(env.DOCS_PASSWORD).toBeUndefined();
    expect(env.DOCS_USER).toBe("docs");
  });

  test("DOCS_PASSWORD must be at least 12 characters when set", () => {
    expect(() => parseEnv({ ...valid, DOCS_PASSWORD: "short" })).toThrow(EnvError);
    expect(parseEnv({ ...valid, DOCS_PASSWORD: "a-long-enough-password" }).DOCS_PASSWORD).toBe(
      "a-long-enough-password",
    );
  });

  test("Web Push is off unless all three VAPID variables are set; a half set is refused", () => {
    expect(parseEnv(valid).VAPID_PUBLIC_KEY).toBeUndefined();
    const all = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:owner@nailpalace.test" };
    expect(parseEnv({ ...valid, ...all }).VAPID_SUBJECT).toBe("mailto:owner@nailpalace.test");
    expect(parseEnv({ ...valid, ...all, VAPID_SUBJECT: "https://nailpalace.test" }).VAPID_SUBJECT).toBe(
      "https://nailpalace.test",
    );
    expect(() => parseEnv({ ...valid, VAPID_PUBLIC_KEY: "pub" })).toThrow(EnvError);
    expect(() => parseEnv({ ...valid, VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })).toThrow(/VAPID_SUBJECT/);
    // blank values from a .env template count as unset
    expect(
      parseEnv({ ...valid, VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", VAPID_SUBJECT: "" }).VAPID_PUBLIC_KEY,
    ).toBeUndefined();
  });

  test("VAPID_SUBJECT must be mailto: or https", () => {
    const keys = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" };
    for (const subject of ["owner@nailpalace.test", "http://nailpalace.test", "ftp://x.test", "mailto:"]) {
      expect(() => parseEnv({ ...valid, ...keys, VAPID_SUBJECT: subject })).toThrow(EnvError);
    }
  });

  test("notification timings default to 15 and 120 minutes", () => {
    const env = parseEnv(valid);
    expect([env.NOTIFY_UNCONFIRMED_AFTER_MINUTES, env.NOTIFY_UPCOMING_MINUTES_BEFORE]).toEqual([15, 120]);
    expect(() => parseEnv({ ...valid, NOTIFY_UPCOMING_MINUTES_BEFORE: "0" })).toThrow(EnvError);
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

  test("rejects token TTLs that are not durations like 15m or 7d", () => {
    expect(() => parseEnv({ ...valid, ACCESS_TOKEN_TTL: "15 minutes" })).toThrow(EnvError);
    expect(() => parseEnv({ ...valid, REFRESH_TOKEN_TTL: "7" })).toThrow(EnvError);
    expect(parseEnv({ ...valid, ACCESS_TOKEN_TTL: "30m", REFRESH_TOKEN_TTL: "14d" }).REFRESH_TOKEN_TTL).toBe("14d");
  });

  test("rejects an invalid port", () => {
    expect(() => parseEnv({ ...valid, PORT: "99999" })).toThrow(EnvError);
  });
});
