const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Spreadsheet programs run a cell starting with = as a formula, and participants write these cells.
 * A leading apostrophe makes it plain text. The codebook explains this.
 */
export function safeText(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return FORMULA_START.test(value) ? `'${value}` : value;
}

export function iso(value: Date | null | undefined): string {
  return value ? value.toISOString() : "";
}
