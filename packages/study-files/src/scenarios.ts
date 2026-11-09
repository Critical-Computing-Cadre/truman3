import { SCENARIOS_FILE, type Scenario, type StudyIssue, scenariosFileSchema } from "@truman3/core";
import { parse as parseYaml } from "yaml";

/**
 * Reads scenarios.yaml. Problems come back as issues that name the scenario and the step, and say
 * what's wrong in plain language.
 */
export function parseScenarios(text: string): { scenarios: Scenario[]; issues: StudyIssue[] } {
  const problem = (message: string): StudyIssue => ({
    severity: "error",
    message,
    file: SCENARIOS_FILE,
  });
  let raw: unknown;
  try {
    raw = parseYaml(text) ?? {};
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { scenarios: [], issues: [problem(`This file couldn't be read: ${detail}`)] };
  }
  const parsed = scenariosFileSchema.safeParse(raw);
  if (parsed.success) {
    return { scenarios: parsed.data.scenarios, issues: [] };
  }
  const listed = (raw as { scenarios?: { name?: unknown }[] } | null)?.scenarios;
  return {
    scenarios: [],
    issues: parsed.error.issues.map((issue) => {
      const [top, index, ...rest] = issue.path;
      if (top === "scenarios" && typeof index === "number") {
        const name = listed?.[index]?.name;
        const which = typeof name === "string" ? `The scenario "${name}"` : `Scenario ${index + 1}`;
        const [part, step, ...more] = rest;
        const where =
          part === "steps" && typeof step === "number"
            ? `, step ${step + 1}${more.length > 0 ? ` (${more.join(".")})` : ""}`
            : rest.length > 0
              ? ` (${rest.join(".")})`
              : "";
        return problem(`${which}${where}: ${issue.message}`);
      }
      return problem(`${issue.path.join(".") || "The file"}: ${issue.message}`);
    }),
  };
}
