import type { Request, Response } from "express";
import { getValidated } from "../middleware/validate.js";
import type { cancelBookingSchemas, createBookingSchemas, lookupBookingSchemas } from "../schemas/booking.schema.js";
import * as bookingService from "../services/booking.service.js";
import { ok } from "../utils/response.js";

export async function createBooking(_req: Request, res: Response): Promise<void> {
  const { body } = getValidated<typeof createBookingSchemas>(res);
  res.status(201).json(ok(await bookingService.createBooking(body)));
}

export async function getBooking(_req: Request, res: Response): Promise<void> {
  const { params, query } = getValidated<typeof lookupBookingSchemas>(res);
  res.status(200).json(ok(await bookingService.getBookingStatus(params.booking_code, query.phone)));
}

export async function cancelBooking(_req: Request, res: Response): Promise<void> {
  const { params, body } = getValidated<typeof cancelBookingSchemas>(res);
  res.status(200).json(ok(await bookingService.cancelBooking(params.booking_code, body.phone, body.reason)));
}
