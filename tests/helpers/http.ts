import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import app from "../../src/app.js";
import { hashPassword } from "../../src/utils/password.js";

export interface TestServer {
  base: string;
  close: () => void;
}

/** Starts the real Express app on a random port. */
export async function startServer(): Promise<TestServer> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => server.close(),
  };
}

const PASSWORD = "a-long-enough-password";

/** Creates an admin and returns its access token. */
export async function loginAdmin(
  prisma: PrismaClient,
  base: string,
  email = "owner@nailpalace.test",
  role: "owner" | "staff" = "owner",
): Promise<string> {
  await prisma.admin.create({ data: { email, passwordHash: await hashPassword(PASSWORD), name: "Admin", role } });
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return ((await res.json()) as { data: { access_token: string } }).data.access_token;
}

export function api(base: string, token?: string) {
  const headers = (extra: Record<string, string> = {}) => ({
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  });
  const send = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
    fetch(`${base}/api/v1${path}`, {
      method,
      headers: headers({ ...(body === undefined ? {} : { "content-type": "application/json" }), ...extra }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    get: (path: string) => send("GET", path),
    post: (path: string, body: unknown, extra?: Record<string, string>) => send("POST", path, body, extra),
    put: (path: string, body: unknown) => send("PUT", path, body),
    patch: (path: string, body: unknown) => send("PATCH", path, body),
    delete: (path: string, body?: unknown) => send("DELETE", path, body),
  };
}
