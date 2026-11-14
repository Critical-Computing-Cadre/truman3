/**
 * A deploy updates the database while the old API is still running, and only then starts the new
 * one (ADR 86). So for a minute or two the old code works against the new tables. That's fine when
 * a migration only adds things, and isn't when it takes away or changes something the old code
 * uses.
 *
 * This finds the statements that aren't fine. A migration that really needs one says so, with a
 * line that starts `-- stop-the-api:` and gives the reason, and then whoever deploys it stops the
 * API first (docs/cloud.md).
 */

/** The line a migration carries when it can't run under the old API. */
export const STOP_THE_API = /^--\s*stop-the-api:\s*\S/m;

const RULES: [RegExp, string][] = [
  [/\bDROP\s+TABLE\b/i, "drops a table"],
  [/\bDROP\s+COLUMN\b/i, "drops a column"],
  [/\bRENAME\s+(TO|COLUMN|CONSTRAINT)\b/i, "renames something"],
  [/\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i, "changes a column's type"],
  [/\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i, "makes a column required"],
  [/\bDROP\s+(FUNCTION|TYPE|VIEW)\b/i, "drops a function, type, or view"],
];

/** What a migration does that the old API couldn't run through, one line for each statement. */
export function unsafeWhileRunning(sql: string): string[] {
  const found: string[] = [];
  const statements = sql
    // Comments say what a migration is for, and may well mention dropping things.
    .replace(/--(?!>).*$/gm, "")
    .split(/;|--> statement-breakpoint/)
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (const statement of statements) {
    for (const [pattern, what] of RULES) {
      if (pattern.test(statement)) {
        found.push(`${what}: ${statement.slice(0, 120)}`);
      }
    }
    // A new required column with nothing to fill it: the old API's inserts would be refused.
    if (
      /\bADD\s+COLUMN\b/i.test(statement) &&
      /\bNOT\s+NULL\b/i.test(statement) &&
      !/\bDEFAULT\b/i.test(statement) &&
      !/\bGENERATED\b/i.test(statement)
    ) {
      found.push(`adds a required column with no default: ${statement.slice(0, 120)}`);
    }
  }
  return found;
}
