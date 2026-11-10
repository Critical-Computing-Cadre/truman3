import {
  PERSONAS_FILE,
  type PersonasFile,
  personasFileSchema,
  type StudyIssue,
} from "@truman3/core";
import { parse as parseYaml } from "yaml";

/** Reads personas.yaml. Problems come back as issues that name the persona. */
export function parsePersonas(text: string): {
  personas: PersonasFile | null;
  issues: StudyIssue[];
} {
  const problem = (message: string): StudyIssue => ({
    severity: "error",
    message,
    file: PERSONAS_FILE,
  });
  let raw: unknown;
  try {
    raw = parseYaml(text) ?? {};
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { personas: null, issues: [problem(`This file couldn't be read: ${detail}`)] };
  }
  const parsed = personasFileSchema.safeParse(raw);
  if (parsed.success) {
    return { personas: parsed.data, issues: [] };
  }
  const listed = (raw as { personas?: { id?: unknown }[] } | null)?.personas;
  return {
    personas: null,
    issues: parsed.error.issues.map((issue) => {
      const [top, index, ...rest] = issue.path;
      if (top === "personas" && typeof index === "number") {
        const id = listed?.[index]?.id;
        const which = typeof id === "string" ? `The persona "${id}"` : `Persona ${index + 1}`;
        return problem(
          `${which}${rest.length > 0 ? ` (${rest.join(".")})` : ""}: ${issue.message}`,
        );
      }
      return problem(`${issue.path.join(".") || "The file"}: ${issue.message}`);
    }),
  };
}
