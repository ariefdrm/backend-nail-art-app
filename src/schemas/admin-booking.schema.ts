import { z } from "zod";
import { createBookingSchemas } from "./booking.schema.js";

const BOOKING_STATUSES = ["pending", "confirmed", "completed", "cancelled", "no_show"] as const;

const idParams = z.object({ id: z.uuid() });

export const listAdminBookingsSchemas = {
  query: z
    .object({
      date_from: z.iso.date().optional(),
      date_to: z.iso.date().optional(),
      status: z.enum(BOOKING_STATUSES).optional(),
      artist_id: z.uuid().optional(),
      q: z.string().trim().min(1).max(100).optional(),
      page: z.coerce.number().int().min(1).default(1),
      per_page: z.coerce.number().int().min(1).max(100).default(20),
    })
    .superRefine((query, ctx) => {
      if (query.date_from && query.date_to && query.date_from > query.date_to) {
        ctx.addIssue({ code: "custom", path: ["date_to"], message: "date_to tidak boleh sebelum date_from" });
      }
    }),
};

export const adminBookingIdSchemas = { params: idParams };

/** Same body as a customer booking (the admin may also be creating it for a walk-in). */
export const createAdminBookingSchemas = createBookingSchemas;

export const updateAdminBookingSchemas = {
  params: idParams,
  body: z
    .object({
      start_at: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
      artist_id: z.uuid(),
      service_id: z.uuid(),
      customer_note: z.string().trim().max(500),
      admin_note: z.string().trim().max(1000),
    })
    .partial()
    .refine((body) => Object.values(body).some((value) => value !== undefined), {
      message: "Minimal satu field harus diisi",
    }),
};
export type UpdateAdminBookingInput = z.output<typeof updateAdminBookingSchemas.body>;

export const changeStatusSchemas = {
  params: idParams,
  body: z.object({
    status: z.enum(BOOKING_STATUSES),
    reason: z.string().trim().max(255).optional(),
  }),
};
export type ChangeStatusInput = z.output<typeof changeStatusSchemas.body>;
