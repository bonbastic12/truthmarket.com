/**
 * Spreadsheet programs run text that starts with = + - @ (or a tab / carriage return) as a formula, so a listing title such as
 * "=HYPERLINK(...)" could attack whoever opens the export. Such text is prefixed with an apostrophe, then quoted like any CSV field.
 * Real numbers are written as they are.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: { key: string; header: string }[], rows: Record<string, unknown>[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(','));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n'; // BOM so Excel reads Amharic names correctly
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
