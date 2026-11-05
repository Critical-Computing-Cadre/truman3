/** The most a rule's words can be, so what's checked against what someone writes stays small. */
export const MAX_RULE_MATCH_LENGTH = 2000;

const LETTER_OR_NUMBER = "[\\p{L}\\p{N}]";
const escapeForPattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

/** A rule's words and phrases: separated by |, and ending in * to match the start of a word. */
export function ruleTerms(match: string): string[] {
  return match
    .split("|")
    .map((term) => term.trim())
    .filter((term) => term.replace(/\*$/, "").trim().length > 0);
}

/**
 * Whether what someone wrote has any of a rule's words or phrases, ignoring case, as whole words.
 * Researchers can't write patterns of their own, which could hang the server on what someone typed.
 * The builder runs this too, so a team can try out what a rule catches. See ADR 36.
 */
export function ruleMatches(match: string, text: string): boolean {
  return ruleTerms(match).some((term) => {
    const open = term.endsWith("*");
    const words = escapeForPattern(open ? term.slice(0, -1).trim() : term).replace(/\s+/g, "\\s+");
    const end = open ? `${LETTER_OR_NUMBER}*` : "";
    return new RegExp(`(?<!${LETTER_OR_NUMBER})${words}${end}(?!${LETTER_OR_NUMBER})`, "iu").test(
      text,
    );
  });
}
