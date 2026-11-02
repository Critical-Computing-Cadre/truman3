/** What can be filled into a link in a study's settings. */
export const LINK_PLACEHOLDERS = ["externalId", "participantId"] as const;

type LinkValues = Record<(typeof LINK_PLACEHOLDERS)[number], string>;

/**
 * Fills in a link's placeholders. {externalId} is the recruitment ID, such as a Prolific ID.
 * {participantId} is the study's own ID. Values are encoded so they can't break the link.
 */
export function fillLinkTemplate(template: string, values: LinkValues): string {
  return template
    .replaceAll("{externalId}", encodeURIComponent(values.externalId))
    .replaceAll("{participantId}", encodeURIComponent(values.participantId));
}
