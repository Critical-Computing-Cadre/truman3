import type { StudyIssue } from "@truman3/core";
import { parse } from "csv-parse/sync";

export interface CsvRow {
  /** The row number as a spreadsheet shows it, where the header is row 1. */
  row: number;
  cells: Record<string, string>;
}

export interface CsvSpec {
  required: readonly string[];
  optional: readonly string[];
}

/** Parses CSV text into rows, reporting bad columns in plain language. */
export function parseCsv(
  text: string,
  file: string,
  spec: CsvSpec,
): { rows: CsvRow[]; issues: StudyIssue[] } {
  const error = (message: string): StudyIssue => ({ severity: "error", message, file });

  let records: string[][];
  try {
    records = parse(text, { bom: true, skip_empty_lines: true, relax_column_count: true });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { rows: [], issues: [error(`This file couldn't be read as a CSV: ${detail}`)] };
  }

  const [header, ...body] = records;
  if (!header) {
    return { rows: [], issues: [error("This file is empty.")] };
  }

  const columns = header.map((column) => column.trim());
  const known = new Set([...spec.required, ...spec.optional]);
  const issues: StudyIssue[] = [];

  for (const column of columns) {
    if (!known.has(column)) {
      issues.push(
        error(`There's a column called "${column}", which isn't one this file can have.`),
      );
    }
  }
  for (const column of spec.required) {
    if (!columns.includes(column)) {
      issues.push(error(`The "${column}" column is missing.`));
    }
  }
  if (issues.length > 0) {
    return { rows: [], issues };
  }

  const rows = body
    .map((record, index) => ({
      row: index + 2,
      cells: Object.fromEntries(columns.map((column, i) => [column, (record[i] ?? "").trim()])),
    }))
    .filter(({ cells }) => Object.values(cells).some((cell) => cell !== ""));

  return { rows, issues };
}
