import { Router } from "express";
import { getSummary } from "../controllers/dashboard.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { dashboardSummarySchemas } from "../schemas/dashboard.schema.js";

// Mounted at /admin; every route requires a valid admin access token.
const dashboard = Router();

dashboard.get("/dashboard/summary", authenticate, validate(dashboardSummarySchemas), getSummary);

export default dashboard;
