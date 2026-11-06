import { BEATS_FILE, type BeatsFile, beatsFileSchema, type StudyIssue } from "@truman3/core";
import { parse as parseYaml } from "yaml";

/**
 * Reads beats.yaml. Problems come back as issues that name the beat, by its place in the list and
 * its id if it has one, and say what's wrong in plain language.
 */
export function parseBeats(text: string): BeatsFile & { issues: StudyIssue[] } {
  const empty = beatsFileSchema.parse({});
  const problem = (message: string): StudyIssue => ({
    severity: "error",
    message,
    file: BEATS_FILE,
  });
  let raw: unknown;
  try {
    raw = parseYaml(text) ?? { beats: [] };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ...empty, issues: [problem(`This file couldn't be read: ${detail}`)] };
  }
  const parsed = beatsFileSchema.safeParse(raw);
  if (parsed.success) {
    return { ...parsed.data, issues: [] };
  }
  const listed = (raw as { beats?: { id?: unknown }[] } | null)?.beats;
  return {
    ...empty,
    issues: parsed.error.issues.map((issue) => {
      const [top, index, ...rest] = issue.path;
      if (top === "beats" && typeof index === "number") {
        const id = listed?.[index]?.id;
        const which = typeof id === "string" ? `The beat "${id}"` : `Beat ${index + 1}`;
        const where = rest.length > 0 ? ` (${rest.join(".")})` : "";
        return problem(`${which}${where}: ${issue.message}`);
      }
      return problem(`${issue.path.join(".") || "The file"}: ${issue.message}`);
    }),
  };
}
