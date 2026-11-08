import type { Request, Response } from "express";
import { getAuthAdmin } from "../middleware/auth.js";
import { getValidated } from "../middleware/validate.js";
import type { subscribePushSchemas, unsubscribePushSchemas } from "../schemas/push.schema.js";
import * as pushService from "../services/push.service.js";
import { ok } from "../utils/response.js";

export function getPublicKey(_req: Request, res: Response): void {
  res.status(200).json(ok(pushService.getPublicKey()));
}

export async function subscribe(_req: Request, res: Response): Promise<void> {
  const { body } = getValidated<typeof subscribePushSchemas>(res);
  const { subscription, created } = await pushService.subscribe(getAuthAdmin(res).id, body);
  res.status(created ? 201 : 200).json(ok(subscription));
}

export async function unsubscribe(_req: Request, res: Response): Promise<void> {
  const { body } = getValidated<typeof unsubscribePushSchemas>(res);
  await pushService.unsubscribe(getAuthAdmin(res).id, body.endpoint);
  res.status(204).end();
}
