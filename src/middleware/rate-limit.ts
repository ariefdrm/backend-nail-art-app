import { rateLimit, type RateLimitRequestHandler } from "express-rate-limit";
import { getEnv } from "../config/env.js";
import { AppError } from "../utils/errors.js";

const MINUTE_MS = 60_000;

export interface LimiterOptions {
  windowMs: number;
  /** A function so the limit is read from the environment at request time (app.ts never reads env at import). */
  limit: () => number;
  /** Count only requests that end in an error, so legitimate use never eats the quota. */
  failuresOnly?: boolean;
}

/**
 * Per-IP limiter held in memory: fine for a single instance, and it resets on restart. With more than one
 * instance it would need a shared store. Behind a proxy, `trust proxy` must be set or every client shares one IP.
 */
export function createRateLimiter(options: LimiterOptions): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: options.failuresOnly ?? false,
    // Goes through the central error handler so the body matches every other error.
    handler: (_req, _res, next) => next(AppError.rateLimited()),
  });
}

/** Login and refresh: only failed attempts count, which is what a password guesser produces. */
export const authLimiter = createRateLimiter({
  windowMs: 15 * MINUTE_MS,
  limit: () => getEnv().RATE_LIMIT_LOGIN_MAX,
  failuresOnly: true,
});

/** Creating a booking is the spam target, so every attempt counts. */
export const bookingCreateLimiter = createRateLimiter({
  windowMs: 60 * MINUTE_MS,
  limit: () => getEnv().RATE_LIMIT_BOOKING_MAX,
});

/** Booking code + phone lookup and cancel: stops guessing codes. */
export const bookingLookupLimiter = createRateLimiter({
  windowMs: 15 * MINUTE_MS,
  limit: () => getEnv().RATE_LIMIT_LOOKUP_MAX,
});

/** A generous ceiling over the whole API. */
export const generalLimiter = createRateLimiter({
  windowMs: MINUTE_MS,
  limit: () => getEnv().RATE_LIMIT_GENERAL_MAX,
});
