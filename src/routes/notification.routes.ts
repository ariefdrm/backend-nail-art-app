import { Router } from "express";
import { getUnreadCount, listNotifications, markAllRead, markRead } from "../controllers/notification.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { listNotificationsSchemas, notificationIdSchemas } from "../schemas/notification.schema.js";

// Mounted at /admin; every route requires a valid admin access token. Read state is per admin.
const notifications = Router();

notifications.get("/notifications", authenticate, validate(listNotificationsSchemas), listNotifications);
notifications.get("/notifications/unread-count", authenticate, getUnreadCount);
notifications.post("/notifications/read-all", authenticate, markAllRead);
notifications.patch("/notifications/:id/read", authenticate, validate(notificationIdSchemas), markRead);

export default notifications;
