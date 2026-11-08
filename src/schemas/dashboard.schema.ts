import { z } from "zod";

const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

export const dashboardSummarySchemas = {
  query: z
    .object({
      date_from: z.iso.date(),
      date_to: z.iso.date(),
    })
    .superRefine((query, ctx) => {
      if (query.date_from > query.date_to) {
        ctx.addIssue({ code: "custom", path: ["date_to"], message: "date_to tidak boleh sebelum date_from" });
        return;
      }
      const days = (Date.parse(query.date_to) - Date.parse(query.date_from)) / DAY_MS + 1;
      if (days > MAX_RANGE_DAYS) {
        ctx.addIssue({
          code: "custom",
          path: ["date_to"],
          message: `Rentang tanggal maksimal ${MAX_RANGE_DAYS} hari`,
        });
      }
    }),
};
