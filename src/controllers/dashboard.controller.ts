import type { Request, Response } from "express";
import { getValidated } from "../middleware/validate.js";
import type { dashboardSummarySchemas } from "../schemas/dashboard.schema.js";
import * as dashboardService from "../services/dashboard.service.js";
import { ok } from "../utils/response.js";

export async function getSummary(_req: Request, res: Response): Promise<void> {
  const { query } = getValidated<typeof dashboardSummarySchemas>(res);
  res.status(200).json(ok(await dashboardService.getSummary(query.date_from, query.date_to)));
}
