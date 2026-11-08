import type { Request, Response } from "express";
import { getValidated } from "../middleware/validate.js";
import type { availabilitySchemas } from "../schemas/availability.schema.js";
import * as availabilityService from "../services/availability.service.js";
import { ok } from "../utils/response.js";

export async function getAvailability(_req: Request, res: Response): Promise<void> {
  const { query } = getValidated<typeof availabilitySchemas>(res);
  res.status(200).json(ok(await availabilityService.getAvailability(query)));
}
