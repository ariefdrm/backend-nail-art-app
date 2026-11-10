import type { CookieOptions, Response } from "express";
import { getEnv } from "../config/env.js";
import { parseDurationSeconds } from "./duration.js";

export const REFRESH_COOKIE = "refresh_token";

/** Scoped to the auth routes, so the browser sends it only where it is needed. */
const REFRESH_COOKIE_PATH = "/api/v1/auth";

function baseOptions(): CookieOptions {
  const env = getEnv();
  return {
    httpOnly: true,
    // SameSite=None is only accepted by browsers together with Secure.
    secure: env.NODE_ENV === "production" || env.AUTH_COOKIE_SAMESITE === "none",
    sameSite: env.AUTH_COOKIE_SAMESITE,
    path: REFRESH_COOKIE_PATH,
  };
}

/** Reads one cookie from a raw `Cookie` header (no cookie-parser needed for a single value). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...baseOptions(),
    maxAge: parseDurationSeconds(getEnv().REFRESH_TOKEN_TTL) * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions());
}
