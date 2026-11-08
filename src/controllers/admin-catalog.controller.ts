import type { Request, Response } from "express";
import { getValidated } from "../middleware/validate.js";
import type {
  createArtistSchemas,
  createServiceSchemas,
  idSchemas,
  updateArtistSchemas,
  updateServiceSchemas,
} from "../schemas/catalog.schema.js";
import * as catalogService from "../services/catalog.service.js";
import { ok } from "../utils/response.js";

export async function listServices(_req: Request, res: Response): Promise<void> {
  res.status(200).json(ok(await catalogService.listAdminServices()));
}

export async function createService(_req: Request, res: Response): Promise<void> {
  const { body } = getValidated<typeof createServiceSchemas>(res);
  res.status(201).json(ok(await catalogService.createService(body)));
}

export async function updateService(_req: Request, res: Response): Promise<void> {
  const { params, body } = getValidated<typeof updateServiceSchemas>(res);
  res.status(200).json(ok(await catalogService.updateService(params.id, body)));
}

export async function deleteService(_req: Request, res: Response): Promise<void> {
  const { params } = getValidated<typeof idSchemas>(res);
  await catalogService.removeService(params.id);
  res.status(204).end();
}

export async function listArtists(_req: Request, res: Response): Promise<void> {
  res.status(200).json(ok(await catalogService.listAdminArtists()));
}

export async function createArtist(_req: Request, res: Response): Promise<void> {
  const { body } = getValidated<typeof createArtistSchemas>(res);
  res.status(201).json(ok(await catalogService.createArtist(body)));
}

export async function updateArtist(_req: Request, res: Response): Promise<void> {
  const { params, body } = getValidated<typeof updateArtistSchemas>(res);
  res.status(200).json(ok(await catalogService.updateArtist(params.id, body)));
}

export async function deleteArtist(_req: Request, res: Response): Promise<void> {
  const { params } = getValidated<typeof idSchemas>(res);
  await catalogService.deactivateArtist(params.id);
  res.status(204).end();
}
