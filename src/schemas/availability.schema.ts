import { z } from "zod";

/** YYYY-MM-DD that is also a real calendar date (rejects 2026-02-30). */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD")
  .refine(
    (value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
    },
    { message: "Tanggal tidak valid" },
  );

export const availabilitySchemas = {
  query: z.object({
    service_id: z.uuid(),
    date: isoDate,
    artist_id: z.uuid().optional(),
  }),
};
