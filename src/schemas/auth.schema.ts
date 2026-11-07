import { z } from "zod";

export const loginSchemas = {
  body: z.object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(1).max(256),
  }),
};

export const refreshSchemas = {
  body: z.object({
    refresh_token: z.string().min(1).max(512),
  }),
};

export const logoutSchemas = refreshSchemas;
