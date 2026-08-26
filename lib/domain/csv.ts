/**
 * Spreadsheet-safe CSV.
 *
 * A cell beginning with `=`, `+`, `-`, `@`, tab or carriage return is treated
 * as a formula by Excel, Sheets and LibreOffice. A product or staff name is
 * attacker-influenced text, so every such cell is prefixed with a single quote
 * before quoting — the value still reads correctly, but it can never execute.
 */
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

export function escapeCsvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  const neutralised = FORMULA_TRIGGERS.some((trigger) => text.startsWith(trigger))
    ? `'${text}`
    : text;
  return `"${neutralised.replaceAll('"', '""')}"`;
}

export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","));
  }
  // A BOM keeps Turkish characters readable when Excel opens the file.
  return `﻿${lines.join("\r\n")}\r\n`;
}
