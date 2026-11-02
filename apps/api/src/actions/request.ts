import { z } from "zod";

/** Every action a browser reports carries these, so retries and timing can be handled. */
export const actionMetaSchema = z.object({
  /** Generated once per action by the browser. A repeat of the same ID is ignored. */
  clientEventId: z.uuid(),
  /** When it happened, by the browser's clock. The server's time is recorded separately. */
  occurredAt: z.iso.datetime(),
});
