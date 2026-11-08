import { z } from "zod";

export const exportBookingsSchemas = {
  query: z
    .object({
      date_from: z.iso.date().optional(),
      date_to: z.iso.date().optional(),
      status: z.enum(["pending", "confirmed", "completed", "cancelled", "no_show"]).optional(),
    })
    .superRefine((query, ctx) => {
      if (query.date_from && query.date_to && query.date_from > query.date_to) {
        ctx.addIssue({ code: "custom", path: ["date_to"], message: "date_to tidak boleh sebelum date_from" });
      }
    }),
};
