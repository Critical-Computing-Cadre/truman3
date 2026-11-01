import { z } from "zod";

/**
 * Whether the API process is up. Shared by the API and the web apps, as the first
 * example of how a type is defined once in `core` and used everywhere.
 */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
