import type { Request, Response } from "express";
import { getAuthAdmin } from "../middleware/auth.js";
import { getValidated } from "../middleware/validate.js";
import type { loginSchemas, logoutSchemas, refreshSchemas } from "../schemas/auth.schema.js";
import * as authService from "../services/auth.service.js";
import { clearRefreshCookie, readCookie, REFRESH_COOKIE, setRefreshCookie } from "../utils/refresh-cookie.js";
import { ok } from "../utils/response.js";

function clientMeta(req: Request): authService.ClientMeta {
  return { userAgent: req.get("user-agent")?.slice(0, 255), ipAddress: req.ip };
}

/**
 * The refresh token goes out twice on purpose: as an HttpOnly cookie and in the JSON body, so the client can pick
 * the cookie or its own storage. Note that a client which keeps the body copy in JS-readable storage gives up the
 * XSS protection the cookie offers.
 */
function respondWithTokens(res: Response, tokens: authService.TokenPair): void {
  setRefreshCookie(res, tokens.refresh_token);
  res.status(200).json(ok(tokens));
}

/** A token in the body wins over the cookie, so a client that manages its own token is never overridden. */
function presentedRefreshToken(req: Request, fromBody: string | undefined): string | undefined {
  return fromBody ?? readCookie(req.get("cookie"), REFRESH_COOKIE);
}

export async function login(req: Request, res: Response): Promise<void> {
  const { body } = getValidated<typeof loginSchemas>(res);
  respondWithTokens(res, await authService.login(body.email, body.password, clientMeta(req)));
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { body } = getValidated<typeof refreshSchemas>(res);
  respondWithTokens(res, await authService.refresh(presentedRefreshToken(req, body.refresh_token), clientMeta(req)));
}

export async function logout(req: Request, res: Response): Promise<void> {
  const { body } = getValidated<typeof logoutSchemas>(res);
  await authService.logout(presentedRefreshToken(req, body.refresh_token));
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function logoutAll(_req: Request, res: Response): Promise<void> {
  await authService.logoutAll(getAuthAdmin(res).id);
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function me(_req: Request, res: Response): Promise<void> {
  res.status(200).json(ok(await authService.getProfile(getAuthAdmin(res).id)));
}
