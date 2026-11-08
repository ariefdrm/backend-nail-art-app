import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { getEnv } from "../config/env.js";
import { AppError } from "../utils/errors.js";

export interface DocsAccess {
  nodeEnv: string;
  user: string;
  password: string | undefined;
}

function sameSecret(given: string, expected: string): boolean {
  // Hash first so the comparison has equal lengths and does not leak the length of the secret.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function parseBasic(header: string | undefined): { user: string; password: string } | undefined {
  const [scheme, encoded] = header?.split(" ") ?? [];
  if (scheme?.toLowerCase() !== "basic" || !encoded) return undefined;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return undefined;
  return { user: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

/**
 * Outside production the docs are open. In production they exist only when DOCS_PASSWORD is configured, and then
 * require HTTP Basic auth; otherwise the path answers 404 like any unknown endpoint.
 */
export function createDocsGate(access: () => DocsAccess): RequestHandler {
  return (req, res, next) => {
    const { nodeEnv, user, password } = access();
    if (nodeEnv !== "production") {
      next();
      return;
    }
    if (!password) {
      next(AppError.notFound("Endpoint tidak ditemukan"));
      return;
    }
    const given = parseBasic(req.header("authorization"));
    // Evaluate both comparisons so a wrong user and a wrong password take the same time.
    const userOk = sameSecret(given?.user ?? "", user);
    const passwordOk = sameSecret(given?.password ?? "", password);
    if (given && userOk && passwordOk) {
      next();
      return;
    }
    res.setHeader("WWW-Authenticate", 'Basic realm="The Nail Palace API docs", charset="UTF-8"');
    next(AppError.unauthorized("Kredensial dokumentasi diperlukan"));
  };
}

export const docsGate = createDocsGate(() => {
  const env = getEnv();
  return { nodeEnv: env.NODE_ENV, user: env.DOCS_USER, password: env.DOCS_PASSWORD };
});
