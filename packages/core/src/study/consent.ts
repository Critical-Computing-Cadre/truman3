import type { StudySettings } from "./definition.ts";

/**
 * What a new study's consent page says until someone replaces it. Launching checks for this
 * sentence, so changing it here means studies already started wouldn't be caught.
 */
const PLACEHOLDER_SENTENCE = "Replace this with the consent text your IRB approved.";

export const STARTING_CONSENT = `# Consent\n\n${PLACEHOLDER_SENTENCE}`;

/** Whether a study's consent page still has the placeholder, even with other text added. */
export function hasPlaceholderConsent(
  settings: Pick<StudySettings, "flow">,
  pages: Record<string, string>,
): boolean {
  return settings.flow.some(
    (step) => step.step === "consent" && pages[step.page]?.includes(PLACEHOLDER_SENTENCE),
  );
}
