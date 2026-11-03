const FRAME = /^\s+at /;

interface Described {
  name: string;
  /** A Postgres error code, or a similar short code. */
  code?: string;
  /** Which database rule was broken. Names the rule, never the value. */
  constraint?: string;
  /** An HTTP status, such as one Prolific answered with. */
  status?: number;
  cause?: Described;
  /** Where in the code it happened. */
  frames?: string[];
}

/**
 * What's safe to send to production logs about an error: what kind it was, and where. Never its
 * message, because Drizzle puts a query's parameters there (recruitment IDs, session tokens) and
 * Postgres puts column values there. A log shouldn't hold what a withdrawal has to delete.
 */
export function describeError(error: unknown): Described {
  if (!(error instanceof Error)) {
    return { name: typeof error };
  }
  const details = error as Error & {
    code?: unknown;
    constraint_name?: unknown;
    status?: unknown;
  };
  return {
    name: error.name,
    ...(typeof details.code === "string" ? { code: details.code } : {}),
    ...(typeof details.constraint_name === "string" ? { constraint: details.constraint_name } : {}),
    ...(typeof details.status === "number" ? { status: details.status } : {}),
    ...(error.cause === undefined ? {} : { cause: describeError(error.cause) }),
    frames: (error.stack ?? "")
      .split("\n")
      .filter((line) => FRAME.test(line))
      .slice(0, 5)
      .map((line) => line.trim()),
  };
}
