import { describe, expect, test } from "bun:test";
import { SignJWT } from "jose";
import { AppError } from "../../../src/utils/errors.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
  verifyAccessToken,
} from "../../../src/utils/tokens.js";

const admin = { id: "6f1f7f0e-9a53-4f4e-8c1c-1c8f6b0f1a11", role: "owner" as const };
const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET);

async function rejectsAsUnauthorized(promise: Promise<unknown>) {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe("UNAUTHORIZED");
}

describe("access tokens", () => {
  test("round-trips id and role, with a 15 minute lifetime", async () => {
    const { token, expiresIn } = await signAccessToken(admin);
    expect(expiresIn).toBe(900);
    expect(await verifyAccessToken(token)).toEqual(admin);
  });

  test("rejects garbage, a wrong signature and an expired token", async () => {
    await rejectsAsUnauthorized(verifyAccessToken("not.a.jwt"));

    const forged = await new SignJWT({ role: "owner" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(admin.id)
      .setIssuer("nailpalace-api")
      .setAudience("nailpalace-admin")
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("another-secret-another-secret-another-0000"));
    await rejectsAsUnauthorized(verifyAccessToken(forged));

    const expired = await new SignJWT({ role: "owner" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(admin.id)
      .setIssuer("nailpalace-api")
      .setAudience("nailpalace-admin")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(secret);
    await rejectsAsUnauthorized(verifyAccessToken(expired));
  });

  test("rejects tokens for another audience, an unknown role, or alg none", async () => {
    const base = () => new SignJWT({ role: "owner" }).setProtectedHeader({ alg: "HS256" }).setSubject(admin.id);

    await rejectsAsUnauthorized(
      verifyAccessToken(
        await base().setIssuer("nailpalace-api").setAudience("someone-else").setExpirationTime("5m").sign(secret),
      ),
    );
    await rejectsAsUnauthorized(
      verifyAccessToken(
        await new SignJWT({ role: "superuser" })
          .setProtectedHeader({ alg: "HS256" })
          .setSubject(admin.id)
          .setIssuer("nailpalace-api")
          .setAudience("nailpalace-admin")
          .setExpirationTime("5m")
          .sign(secret),
      ),
    );

    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: admin.id, role: "owner", iss: "nailpalace-api", aud: "nailpalace-admin", exp: 9999999999 }),
    ).toString("base64url");
    await rejectsAsUnauthorized(verifyAccessToken(`${header}.${payload}.`));
  });
});

describe("refresh tokens", () => {
  test("are random, url-safe and long", () => {
    const a = generateRefreshToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateRefreshToken()).not.toBe(a);
  });

  test("hash deterministically and never equal the token", () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).not.toBe(token);
    expect(hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("expire after REFRESH_TOKEN_TTL (7 days by default)", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    expect(refreshTokenExpiry(now).toISOString()).toBe("2026-11-17T00:00:00.000Z");
  });
});
