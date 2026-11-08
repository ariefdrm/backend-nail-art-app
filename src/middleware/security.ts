import cors, { type CorsOptions } from "cors";
import helmet from "helmet";
import { getEnv } from "../config/env.js";

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
  // Tokens travel in the Authorization header, not cookies.
  credentials: false,
  maxAge: 600,
  optionsSuccessStatus: 204,
};

export const corsAllowlist = cors(options);
