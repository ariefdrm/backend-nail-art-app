import cors, { type CorsOptions } from "cors";
import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import { getEnv } from "../config/env.js";
import { AppError } from "../utils/errors.js";

/** Standard security headers (CSP, nosniff, frameguard, HSTS, ...). The API only returns JSON. */
export const securityHeaders = helmet();

/** An origin is allowed only if it is in CORS_ORIGINS; requests without an Origin header are not CORS at all. */
export function isAllowedOrigin(origin: string | undefined, allowed: readonly string[]): boolean {
  return origin !== undefined && allowed.includes(origin);
}

const options: CorsOptions = {
  // Refused origins get no CORS headers, so the browser blocks the response; the request is not rejected here.
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin, getEnv().CORS_ORIGINS)),
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Authorization", "Content-Type"],
  // Lets the frontend read the rate limit headers.
  exposedHeaders: ["RateLimit", "RateLimit-Policy", "Retry-After"],
  // The refresh token is an HttpOnly cookie, so allowed origins may send credentials. This is safe only because the
  // origin is checked against an explicit allowlist (never "*"); the access token still travels in Authorization.
  credentials: true,
  maxAge: 600,
  optionsSuccessStatus: 204,
};

export const corsAllowlist = cors(options);

/**
 * CSRF guard for the endpoints that act on the refresh cookie. Browsers always send `Origin` on a cross-site POST, so
 * a present-but-unlisted origin is refused (on top of SameSite). A missing Origin is not a browser CSRF (curl, tests).
 */
export function requireAllowedOrigin(req: Request, _res: Response, next: NextFunction): void {
  const origin = req.get("origin");
  if (origin !== undefined && !isAllowedOrigin(origin, getEnv().CORS_ORIGINS)) {
    next(AppError.forbidden("Origin tidak diizinkan"));
    return;
  }
  next();
}
