import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { hashPassword } from "../../../src/utils/password.js";
import { hashRefreshToken } from "../../../src/utils/tokens.js";
import type { AppError } from "../../../src/utils/errors.js";

interface AdminRow {
  id: string;
  email: string;
  name: string;
  role: "owner" | "staff";
  passwordHash: string;
}
interface TokenRow {
  id: string;
  adminId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

let admins: AdminRow[] = [];
let tokens: TokenRow[] = [];
let rotateResult = true;
const calls = {
  revokeAll: [] as string[],
  revokedHashes: [] as string[],
  created: [] as unknown[],
  rotated: [] as unknown[],
};

await mock.module("../../../src/repositories/admin.repository.js", () => ({
  findAdminByEmail: (email: string) => Promise.resolve(admins.find((a) => a.email === email) ?? null),
  findAdminById: (id: string) => Promise.resolve(admins.find((a) => a.id === id) ?? null),
}));
await mock.module("../../../src/repositories/refresh-token.repository.js", () => ({
  createRefreshToken: (data: unknown) => {
    calls.created.push(data);
    return Promise.resolve(data);
  },
  findRefreshTokenByHash: (hash: string) => Promise.resolve(tokens.find((t) => t.tokenHash === hash) ?? null),
  revokeAllRefreshTokens: (adminId: string) => {
    calls.revokeAll.push(adminId);
    return Promise.resolve();
  },
  revokeRefreshTokenByHash: (tokenHash: string) => {
    calls.revokedHashes.push(tokenHash);
    return Promise.resolve();
  },
  rotateRefreshToken: (currentId: string, next: unknown) => {
    calls.rotated.push({ currentId, next });
    return Promise.resolve(rotateResult);
  },
}));

const { getProfile, login, logout, logoutAll, refresh } = await import("../../../src/services/auth.service.js");

const ADMIN_ID = "6f1f7f0e-9a53-4f4e-8c1c-1c8f6b0f1a11";

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  return promise.then(
    () => undefined,
    (e: AppError) => e.code,
  );
}

beforeAll(async () => {
  admins = [
    {
      id: ADMIN_ID,
      email: "owner@nailpalace.test",
      name: "Owner",
      role: "owner",
      passwordHash: await hashPassword("a-long-enough-password"),
    },
  ];
});

beforeEach(() => {
  tokens = [];
  rotateResult = true;
  calls.revokeAll = [];
  calls.revokedHashes = [];
  calls.created = [];
  calls.rotated = [];
});

describe("login", () => {
  test("returns a token pair and stores only the refresh token hash", async () => {
    const pair = await login("owner@nailpalace.test", "a-long-enough-password", {
      userAgent: "UA",
      ipAddress: "1.2.3.4",
    });
    expect(pair.token_type).toBe("Bearer");
    expect(pair.expires_in).toBe(900);
    expect(pair.access_token.split(".")).toHaveLength(3);

    const stored = calls.created[0] as { tokenHash: string; adminId: string; userAgent: string };
    expect(stored.adminId).toBe(ADMIN_ID);
    expect(stored.tokenHash).toBe(hashRefreshToken(pair.refresh_token));
    expect(stored.tokenHash).not.toBe(pair.refresh_token);
    expect(stored.userAgent).toBe("UA");
  });

  test("wrong password and unknown email give the same 401", async () => {
    const wrongPassword = login("owner@nailpalace.test", "nope", {});
    const unknownEmail = login("nobody@nailpalace.test", "a-long-enough-password", {});
    expect(await code(wrongPassword)).toBe("UNAUTHORIZED");
    expect(await code(unknownEmail)).toBe("UNAUTHORIZED");
    expect(calls.created).toHaveLength(0);
  });
});

describe("refresh", () => {
  function storeToken(overrides: Partial<TokenRow> = {}): string {
    const raw = `raw-token-${tokens.length}`;
    tokens.push({
      id: `t${tokens.length}`,
      adminId: ADMIN_ID,
      tokenHash: hashRefreshToken(raw),
      expiresAt: new Date(Date.now() + 3_600_000),
      revokedAt: null,
      ...overrides,
    });
    return raw;
  }

  test("rotates a valid token into a new pair", async () => {
    const raw = storeToken();
    const pair = await refresh(raw, {});
    expect(pair.refresh_token).not.toBe(raw);
    expect(calls.rotated).toHaveLength(1);
    expect(calls.revokeAll).toHaveLength(0);
  });

  test("rejects an unknown token", async () => {
    expect(await code(refresh("never-issued", {}))).toBe("UNAUTHORIZED");
  });

  test("a reused (already revoked) token revokes all sessions of that admin", async () => {
    const raw = storeToken({ revokedAt: new Date() });
    expect(await code(refresh(raw, {}))).toBe("UNAUTHORIZED");
    expect(calls.revokeAll).toEqual([ADMIN_ID]);
    expect(calls.rotated).toHaveLength(0);
  });

  test("rejects an expired token without revoking others", async () => {
    const raw = storeToken({ expiresAt: new Date(Date.now() - 1000) });
    expect(await code(refresh(raw, {}))).toBe("UNAUTHORIZED");
    expect(calls.revokeAll).toHaveLength(0);
  });

  test("treats a lost rotation race as reuse", async () => {
    const raw = storeToken();
    rotateResult = false;
    expect(await code(refresh(raw, {}))).toBe("UNAUTHORIZED");
    expect(calls.revokeAll).toEqual([ADMIN_ID]);
  });

  test("rejects a token whose admin no longer exists", async () => {
    const raw = storeToken({ adminId: "00000000-0000-0000-0000-000000000000" });
    expect(await code(refresh(raw, {}))).toBe("UNAUTHORIZED");
  });
});

describe("logout", () => {
  test("revokes only the presented token, by its hash", async () => {
    await logout("raw-token-to-revoke");
    expect(calls.revokedHashes).toEqual([hashRefreshToken("raw-token-to-revoke")]);
    expect(calls.revokeAll).toHaveLength(0);
  });

  test("is idempotent and never throws for unknown tokens", async () => {
    await logout("never-issued");
    await logout("never-issued");
    expect(calls.revokedHashes).toHaveLength(2);
  });
});

describe("logoutAll", () => {
  test("revokes every session of the given admin", async () => {
    await logoutAll(ADMIN_ID);
    expect(calls.revokeAll).toEqual([ADMIN_ID]);
    expect(calls.revokedHashes).toHaveLength(0);
  });
});

describe("getProfile", () => {
  test("returns the public profile without the password hash", async () => {
    const profile = await getProfile(ADMIN_ID);
    expect(profile).toEqual({ id: ADMIN_ID, name: "Owner", email: "owner@nailpalace.test", role: "owner" });
    expect(profile).not.toHaveProperty("passwordHash");
  });

  test("is a 401 when the admin was deleted", async () => {
    expect(await code(getProfile("00000000-0000-0000-0000-000000000000"))).toBe("UNAUTHORIZED");
  });
});
