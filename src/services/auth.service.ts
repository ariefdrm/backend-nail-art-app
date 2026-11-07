import { findAdminByEmail, findAdminById } from "../repositories/admin.repository.js";
import {
  createRefreshToken,
  findRefreshTokenByHash,
  revokeAllRefreshTokens,
  rotateRefreshToken,
} from "../repositories/refresh-token.repository.js";
import type { AdminRoleName } from "../types/auth.js";
import { AppError } from "../utils/errors.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { generateRefreshToken, hashRefreshToken, refreshTokenExpiry, signAccessToken } from "../utils/tokens.js";

export interface ClientMeta {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
}

export interface AdminProfile {
  id: string;
  name: string;
  email: string;
  role: AdminRoleName;
}

// Verifying against a real hash when the email is unknown keeps response time
// similar, so login does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("timing-equalizer-not-a-real-password");
  return dummyHash;
}

const INVALID_CREDENTIALS = "Email atau password salah";
const INVALID_REFRESH = "Refresh token tidak valid atau sudah kedaluwarsa";

async function buildTokenPair(admin: { id: string; role: AdminRoleName }, refreshToken: string): Promise<TokenPair> {
  const access = await signAccessToken(admin);
  return {
    access_token: access.token,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: access.expiresIn,
  };
}

export async function login(email: string, password: string, meta: ClientMeta): Promise<TokenPair> {
  const admin = await findAdminByEmail(email);
  const valid = await verifyPassword(admin?.passwordHash ?? (await getDummyHash()), password);
  if (!admin || !valid) throw AppError.unauthorized(INVALID_CREDENTIALS);

  const refreshToken = generateRefreshToken();
  await createRefreshToken({
    adminId: admin.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: refreshTokenExpiry(),
    ...meta,
  });
  return buildTokenPair(admin, refreshToken);
}

/**
 * Rotates a refresh token: the presented token is revoked and a new pair is
 * issued. Presenting an already-used token is treated as theft and revokes
 * every session of that admin.
 */
export async function refresh(presentedToken: string, meta: ClientMeta): Promise<TokenPair> {
  const now = new Date();
  const stored = await findRefreshTokenByHash(hashRefreshToken(presentedToken));
  if (!stored) throw AppError.unauthorized(INVALID_REFRESH);

  if (stored.revokedAt) {
    await revokeAllRefreshTokens(stored.adminId, now);
    throw AppError.unauthorized(INVALID_REFRESH);
  }
  if (stored.expiresAt <= now) throw AppError.unauthorized(INVALID_REFRESH);

  const admin = await findAdminById(stored.adminId);
  if (!admin) throw AppError.unauthorized(INVALID_REFRESH);

  const nextToken = generateRefreshToken();
  const rotated = await rotateRefreshToken(
    stored.id,
    {
      adminId: admin.id,
      tokenHash: hashRefreshToken(nextToken),
      expiresAt: refreshTokenExpiry(now),
      ...meta,
    },
    now,
  );
  if (!rotated) {
    // Lost a race with another use of the same token: same treatment as reuse.
    await revokeAllRefreshTokens(stored.adminId, now);
    throw AppError.unauthorized(INVALID_REFRESH);
  }
  return buildTokenPair(admin, nextToken);
}

export async function getProfile(adminId: string): Promise<AdminProfile> {
  const admin = await findAdminById(adminId);
  if (!admin) throw AppError.unauthorized();
  return { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
}
