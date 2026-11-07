import type { Request, Response } from "express";
import { getAuthAdmin } from "../middleware/auth.js";
import { getValidated } from "../middleware/validate.js";
import type { loginSchemas, refreshSchemas } from "../schemas/auth.schema.js";
import * as authService from "../services/auth.service.js";
import { ok } from "../utils/response.js";

function clientMeta(req: Request): authService.ClientMeta {
  return { userAgent: req.get("user-agent")?.slice(0, 255), ipAddress: req.ip };
}

export async function login(req: Request, res: Response): Promise<void> {
  const { body } = getValidated<typeof loginSchemas>(res);
  res.status(200).json(ok(await authService.login(body.email, body.password, clientMeta(req))));
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { body } = getValidated<typeof refreshSchemas>(res);
  res.status(200).json(ok(await authService.refresh(body.refresh_token, clientMeta(req))));
}

export async function me(_req: Request, res: Response): Promise<void> {
  res.status(200).json(ok(await authService.getProfile(getAuthAdmin(res).id)));
}
