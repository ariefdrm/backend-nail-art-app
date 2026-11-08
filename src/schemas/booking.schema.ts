import { z } from "zod";
import { normalizePhone } from "../utils/phone.js";

const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);

/** Accepts 08.../62.../+62... and yields E.164. */
const phone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "Nomor telepon tidak valid" });
      return z.NEVER;
    }
    return normalized;
  });

export const createBookingSchemas = {
  body: z.object({
    service_id: z.uuid(),
    artist_id: z.uuid().nullish(),
    start_at: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
    customer_name: z.string().trim().min(1).max(100),
    customer_phone: phone,
    customer_note: z.string().trim().max(500).optional(),
    reference_image_url: httpUrl.nullish(),
  }),
};
export type CreateBookingInput = z.output<typeof createBookingSchemas.body>;

const codeParams = z.object({ booking_code: z.string().trim().toUpperCase().min(1).max(20) });

export const lookupBookingSchemas = {
  params: codeParams,
  // Not normalized here: an unparsable phone must look like any other mismatch (404), never a 422 oracle.
  query: z.object({ phone: z.string().trim().min(1).max(30) }),
};

export const cancelBookingSchemas = {
  params: codeParams,
  body: z.object({
    phone: z.string().trim().min(1).max(30),
    reason: z.string().trim().max(255).optional(),
  }),
};
