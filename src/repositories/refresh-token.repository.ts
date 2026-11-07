import { getPrisma } from "../utils/prisma.js";

export interface NewRefreshToken {
  adminId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

export function createRefreshToken(data: NewRefreshToken) {
  return getPrisma().refreshToken.create({ data });
}

export function findRefreshTokenByHash(tokenHash: string) {
  return getPrisma().refreshToken.findUnique({ where: { tokenHash } });
}

/** Revokes every active token of an admin (used when token reuse is detected). */
export async function revokeAllRefreshTokens(adminId: string, now: Date): Promise<void> {
  await getPrisma().refreshToken.updateMany({
    where: { adminId, revokedAt: null },
    data: { revokedAt: now },
  });
}

/**
 * Atomically revokes `currentId` and stores its replacement. Returns false when
 * the token was already revoked (a reuse or a lost race), in which case
 * nothing is created.
 */
export function rotateRefreshToken(currentId: string, next: NewRefreshToken, now: Date): Promise<boolean> {
  return getPrisma().$transaction(async (tx) => {
    const revoked = await tx.refreshToken.updateMany({
      where: { id: currentId, revokedAt: null },
      data: { revokedAt: now },
    });
    if (revoked.count === 0) return false;
    await tx.refreshToken.create({ data: next });
    return true;
  });
}
