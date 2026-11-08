import { z } from "zod";
import { isAllowedPushEndpoint } from "../utils/push-endpoint.js";

// base64url, as browsers encode the subscription keys
const base64url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+={0,2}$/, "harus base64url");

const endpoint = z
  .url({ protocol: /^https$/ })
  .max(2048)
  .refine(isAllowedPushEndpoint, { message: "Endpoint bukan layanan push browser yang dikenal" });

export const subscribePushSchemas = {
  body: z.object({
    endpoint,
    keys: z.object({ p256dh: base64url(255), auth: base64url(255) }),
  }),
};
export type PushSubscriptionInput = z.output<typeof subscribePushSchemas.body>;

export const unsubscribePushSchemas = {
  // Deleting never calls the endpoint, so any https URL is fine here.
  body: z.object({ endpoint: z.url({ protocol: /^https$/ }).max(2048) }),
};
