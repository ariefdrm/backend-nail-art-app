import { Router } from "express";
import { exportBookings } from "../controllers/export.controller.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { exportBookingsSchemas } from "../schemas/export.schema.js";

// Mounted at /admin. A bulk export of business data is for the owner only.
const exportRoutes = Router();

exportRoutes.get(
  "/export/bookings.csv",
  authenticate,
  requireRole("owner"),
  validate(exportBookingsSchemas),
  exportBookings,
);

export default exportRoutes;
