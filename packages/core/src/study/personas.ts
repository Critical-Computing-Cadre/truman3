import { z } from "zod";
import { idSchema } from "./beats.ts";

/**
 * Personas: who a simulated participant is, for a model to play while piloting a study. They're
 * written in `personas.yaml`, saved with each version like `scenarios.yaml`, and run from the
 * Simulate page. Nobody real takes part. See ADR 60.
 */
export const PERSONAS_FILE = "personas.yaml";

export const simulatedPersonaSchema = z.strictObject({
  id: idSchema,
  /** Who they are, how they use social media, and what they care about, in plain words. */
  about: z.string().trim().min(1).max(2000),
  /** The condition they start in. Leave out to spread them across the conditions in turn. */
  condition: z.string().min(1).optional(),
});
export type SimulatedPersona = z.infer<typeof simulatedPersonaSchema>;

export const personasFileSchema = z.strictObject({
  /** The model that plays them. A cheaper one keeps piloting cheap. */
  model: z.string().min(1).default("claude-sonnet-5-5"),
  personas: z.array(simulatedPersonaSchema).default([]),
});
export type PersonasFile = z.infer<typeof personasFileSchema>;
