import { z } from "zod";

export const listNotificationsSchemas = {
  query: z.object({
    // z.coerce.boolean() would read the string "false" as true, so spell the two values out.
    unread: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    page: z.coerce.number().int().min(1).default(1),
    per_page: z.coerce.number().int().min(1).max(100).default(20),
  }),
};

export const notificationIdSchemas = { params: z.object({ id: z.uuid() }) };
