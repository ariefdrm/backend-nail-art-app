import type { Request, Response } from "express";
import { getValidated } from "../middleware/validate.js";
import type { idSchemas, listServicesSchemas } from "../schemas/catalog.schema.js";
import * as catalogService from "../services/catalog.service.js";
import { ok } from "../utils/response.js";

export async function listServices(_req: Request, res: Response): Promise<void> {
  const { query } = getValidated<typeof listServicesSchemas>(res);
  res.status(200).json(ok(await catalogService.listPublicServices(query.category)));
}

export async function getService(_req: Request, res: Response): Promise<void> {
  const { params } = getValidated<typeof idSchemas>(res);
  res.status(200).json(ok(await catalogService.getPublicService(params.id)));
}

export async function listArtists(_req: Request, res: Response): Promise<void> {
  res.status(200).json(ok(await catalogService.listPublicArtists()));
}
