export type CsvValue = string | number | boolean | null | undefined;

// A cell starting with one of these is read as a formula by spreadsheet apps (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** One cell per RFC 4180; text that could be read as a formula gets a leading apostrophe. Numbers are never altered. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A CSV line including its CRLF terminator. */
export function csvRow(cells: readonly CsvValue[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}
