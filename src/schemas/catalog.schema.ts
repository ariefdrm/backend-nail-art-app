import { z } from "zod";

const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);

const idParams = z.object({ id: z.uuid() });

export const listServicesSchemas = {
  query: z.object({ category: z.string().trim().min(1).max(50).optional() }),
};

export const idSchemas = { params: idParams };

const serviceBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  category: z.string().trim().min(1).max(50),
  price: z.number().int().min(0).max(100_000_000),
  duration_minutes: z.number().int().min(15).max(480).multipleOf(15),
  image_url: httpUrl.nullish(),
  is_active: z.boolean().default(true),
});

export const createServiceSchemas = { body: serviceBody };
export const updateServiceSchemas = { params: idParams, body: serviceBody };
export type ServiceInput = z.output<typeof serviceBody>;

const artistBody = z.object({
  name: z.string().trim().min(1).max(80),
  photo_url: httpUrl.nullish(),
  is_active: z.boolean().default(true),
});

export const createArtistSchemas = { body: artistBody };
export const updateArtistSchemas = { params: idParams, body: artistBody };
export type ArtistInput = z.output<typeof artistBody>;
