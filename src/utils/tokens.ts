import { createHmac, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { getEnv } from "../config/env.js";
import { ADMIN_ROLES, type AdminRoleName, type AuthAdmin } from "../types/auth.js";
import { AppError } from "./errors.js";
import { parseDurationSeconds } from "./duration.js";

const ISSUER = "nailpalace-api";
const AUDIENCE = "nailpalace-admin";
const encoder = new TextEncoder();

export interface SignedAccessToken {
  token: string;
  /** Lifetime in seconds (the `expires_in` of the API's TokenPair). */
  expiresIn: number;
}

export async function signAccessToken(admin: { id: string; role: AdminRoleName }): Promise<SignedAccessToken> {
  const env = getEnv();
  const expiresIn = parseDurationSeconds(env.ACCESS_TOKEN_TTL);
  const token = await new SignJWT({ role: admin.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(admin.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(encoder.encode(env.JWT_ACCESS_SECRET));
  return { token, expiresIn };
}

/** Verifies signature, expiry, issuer and audience. Any failure is a 401. */
export async function verifyAccessToken(token: string): Promise<AuthAdmin> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(getEnv().JWT_ACCESS_SECRET), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const role = payload["role"];
    if (!payload.sub || !ADMIN_ROLES.includes(role as AdminRoleName)) {
      throw new Error("malformed claims");
    }
    return { id: payload.sub, role: role as AdminRoleName };
  } catch {
    throw AppError.unauthorized("Token tidak valid atau sudah kedaluwarsa");
  }
}

/** Refresh tokens are opaque random strings, not JWTs. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Keyed hash stored in the database; the raw token is never persisted. */
export function hashRefreshToken(token: string): string {
  return createHmac("sha256", getEnv().JWT_REFRESH_SECRET).update(token).digest("hex");
}

export function refreshTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + parseDurationSeconds(getEnv().REFRESH_TOKEN_TTL) * 1000);
}
