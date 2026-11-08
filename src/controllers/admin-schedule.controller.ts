import type { Request, Response } from "express";
import { getValidated } from "../middleware/validate.js";
import type {
  blockedSlotIdSchemas,
  blockedSlotSchemas,
  listBlockedSlotsSchemas,
  replaceBusinessHoursSchemas,
} from "../schemas/schedule.schema.js";
import * as scheduleService from "../services/schedule.service.js";
import { ok } from "../utils/response.js";

export async function getBusinessHours(_req: Request, res: Response): Promise<void> {
  res.status(200).json(ok(await scheduleService.getBusinessHours()));
}

export async function replaceBusinessHours(_req: Request, res: Response): Promise<void> {
  const { body } = getValidated<typeof replaceBusinessHoursSchemas>(res);
  res.status(200).json(ok(await scheduleService.replaceBusinessHours(body.hours)));
}

export async function listBlockedSlots(_req: Request, res: Response): Promise<void> {
  const { query } = getValidated<typeof listBlockedSlotsSchemas>(res);
  res.status(200).json(ok(await scheduleService.listBlockedSlots(query.date_from, query.date_to)));
}

export async function checkBlockedSlot(_req: Request, res: Response): Promise<void> {
  const { body } = getValidated<typeof blockedSlotSchemas>(res);
  res.status(200).json(ok(await scheduleService.checkBlock(body)));
}

export async function createBlockedSlot(_req: Request, res: Response): Promise<void> {
  const { body } = getValidated<typeof blockedSlotSchemas>(res);
  res.status(201).json(ok(await scheduleService.createBlock(body)));
}

export async function deleteBlockedSlot(_req: Request, res: Response): Promise<void> {
  const { params } = getValidated<typeof blockedSlotIdSchemas>(res);
  await scheduleService.deleteBlock(params.id);
  res.status(204).end();
}
