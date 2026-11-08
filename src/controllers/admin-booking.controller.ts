import type { Request, Response } from "express";
import { getAuthAdmin } from "../middleware/auth.js";
import { getValidated } from "../middleware/validate.js";
import type {
  adminBookingIdSchemas,
  changeStatusSchemas,
  createAdminBookingSchemas,
  listAdminBookingsSchemas,
  updateAdminBookingSchemas,
} from "../schemas/admin-booking.schema.js";
import * as adminBookingService from "../services/admin-booking.service.js";
import { ok, paginated } from "../utils/response.js";

export async function listBookings(_req: Request, res: Response): Promise<void> {
  const { query } = getValidated<typeof listAdminBookingsSchemas>(res);
  const { data, meta } = await adminBookingService.listBookings(query);
  res.status(200).json(paginated(data, meta));
}

export async function createBooking(_req: Request, res: Response): Promise<void> {
  const { body } = getValidated<typeof createAdminBookingSchemas>(res);
  res.status(201).json(ok(await adminBookingService.createManualBooking(body, getAuthAdmin(res).id)));
}

export async function getBooking(_req: Request, res: Response): Promise<void> {
  const { params } = getValidated<typeof adminBookingIdSchemas>(res);
  res.status(200).json(ok(await adminBookingService.getBooking(params.id)));
}

export async function updateBooking(_req: Request, res: Response): Promise<void> {
  const { params, body } = getValidated<typeof updateAdminBookingSchemas>(res);
  res.status(200).json(ok(await adminBookingService.updateBooking(params.id, body)));
}

export async function changeStatus(_req: Request, res: Response): Promise<void> {
  const { params, body } = getValidated<typeof changeStatusSchemas>(res);
  res.status(200).json(ok(await adminBookingService.changeStatus(params.id, body, getAuthAdmin(res).id)));
}
