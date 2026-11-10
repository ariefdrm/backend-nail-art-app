import { z } from "zod";

export const loginSchemas = {
  body: z.object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(1).max(256),
  }),
};

/** The refresh token may come in the body (clients that store it themselves) or from the cookie. */
export const refreshSchemas = {
  body: z
    .object({
      refresh_token: z.string().min(1).max(512).optional(),
    })
    .default({}),
};

export const logoutSchemas = refreshSchemas;
