import { hash, verify } from "@node-rs/argon2";

// @node-rs/argon2 defaults to Argon2id (OWASP-recommended parameters) and ships
// prebuilt binaries for glibc and musl, so it runs on both Bun and Node.

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

/** Returns false (never throws) for a wrong password or a malformed hash. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
