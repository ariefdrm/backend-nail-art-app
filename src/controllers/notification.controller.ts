import type { Request, Response } from "express";
import { getAuthAdmin } from "../middleware/auth.js";
import { getValidated } from "../middleware/validate.js";
import type { listNotificationsSchemas, notificationIdSchemas } from "../schemas/notification.schema.js";
import * as notificationService from "../services/notification.service.js";
import { ok, paginated } from "../utils/response.js";

export async function listNotifications(_req: Request, res: Response): Promise<void> {
  const { query } = getValidated<typeof listNotificationsSchemas>(res);
  const { data, meta } = await notificationService.listNotifications(getAuthAdmin(res).id, query);
  res.status(200).json(paginated(data, meta));
}

export async function getUnreadCount(_req: Request, res: Response): Promise<void> {
  res.status(200).json(ok(await notificationService.getUnreadCount(getAuthAdmin(res).id)));
}

export async function markRead(_req: Request, res: Response): Promise<void> {
  const { params } = getValidated<typeof notificationIdSchemas>(res);
  res.status(200).json(ok(await notificationService.markRead(getAuthAdmin(res).id, params.id)));
}

export async function markAllRead(_req: Request, res: Response): Promise<void> {
  res.status(200).json(ok(await notificationService.markAllRead(getAuthAdmin(res).id)));
}
