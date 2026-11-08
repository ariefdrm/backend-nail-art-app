import { Router } from "express";
import { getPublicKey, subscribe, unsubscribe } from "../controllers/push.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { subscribePushSchemas, unsubscribePushSchemas } from "../schemas/push.schema.js";

// Mounted at /admin; every route requires a valid admin access token.
const push = Router();

push.get("/push/public-key", authenticate, getPublicKey);
push.post("/push-subscriptions", authenticate, validate(subscribePushSchemas), subscribe);
push.delete("/push-subscriptions", authenticate, validate(unsubscribePushSchemas), unsubscribe);

export default push;
