import type { RequestHandler, Response } from "express";
import type { AdminRoleName, AuthAdmin } from "../types/auth.js";
import { AppError } from "../utils/errors.js";
import { verifyAccessToken } from "../utils/tokens.js";

/** Requires a valid `Authorization: Bearer <access token>` and sets `res.locals.admin`. */
export const authenticate: RequestHandler = async (req, res, next) => {
  const header = req.header("authorization");
  const [scheme, token] = header?.split(" ") ?? [];
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    next(AppError.unauthorized());
    return;
  }

  try {
    res.locals.admin = await verifyAccessToken(token);
    next();
  } catch (err) {
    next(err);
  }
};

/** Use after `authenticate`. */
export function requireRole(...roles: AdminRoleName[]): RequestHandler {
  return (_req, res, next) => {
    const admin = getAuthAdmin(res);
    if (!roles.includes(admin.role)) {
      next(AppError.forbidden());
      return;
    }
    next();
  };
}

export function getAuthAdmin(res: Response): AuthAdmin {
  return res.locals.admin as AuthAdmin;
}
