import { Router } from "express";
import {
  checkBlockedSlot,
  createBlockedSlot,
  deleteBlockedSlot,
  getBusinessHours,
  listBlockedSlots,
  replaceBusinessHours,
} from "../controllers/admin-schedule.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  blockedSlotIdSchemas,
  blockedSlotSchemas,
  listBlockedSlotsSchemas,
  replaceBusinessHoursSchemas,
} from "../schemas/schedule.schema.js";

// Mounted at /admin; every route requires a valid admin access token.
const adminSchedule = Router();

adminSchedule.get("/business-hours", authenticate, getBusinessHours);
adminSchedule.put("/business-hours", authenticate, validate(replaceBusinessHoursSchemas), replaceBusinessHours);

adminSchedule.get("/blocked-slots", authenticate, validate(listBlockedSlotsSchemas), listBlockedSlots);
// "/check" is a different path from "/:id", so the order does not matter for matching.
adminSchedule.post("/blocked-slots/check", authenticate, validate(blockedSlotSchemas), checkBlockedSlot);
adminSchedule.post("/blocked-slots", authenticate, validate(blockedSlotSchemas), createBlockedSlot);
adminSchedule.delete("/blocked-slots/:id", authenticate, validate(blockedSlotIdSchemas), deleteBlockedSlot);

export default adminSchedule;
