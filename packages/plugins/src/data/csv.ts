// RFC4180 CSV parsing + Excel-like range filtering. Pure, DOM-free (imported
// by servers via the "@jul-editor/plugins/data" subpath, since core
// never interprets data, this is the one place that does). No papaparse dep
// (a small in-house RFC 4180 parser is enough).

export type ColumnType = "number" | "date" | "string";
export type CellValue = string | number | Date;

export interface Table {
  columns: string[];
  columnTypes: ColumnType[];
  rows: CellValue[][];
}

const DELIMITERS = [",", ";", "\t", "|"] as const;

// A `"` only opens a quoted field at the field's own start (RFC 4180) --
// a bare quote inside an unquoted field (`5" screen`) is literal and must not
// flip quote-tracking, or a single stray `"` swallows the rest of the line
// (detectDelimiter) or the rest of the file (splitRows below).
function countUnquotedDelimiters(text: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  let atFieldStart = true;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          i += 2;
          continue;
        }
        inQuotes = false;
      }
      atFieldStart = false;
      i++;
      continue;
    }
    if (c === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
      i++;
      continue;
    }
    if (c === "\n") break;
    if (c === delimiter) {
      count++;
      atFieldStart = true;
      i++;
      continue;
    }
    atFieldStart = false;
    i++;
  }
  return count;
}

function detectDelimiter(text: string): string {
  let best: string = ",";
  let bestCount = -1;
  for (const d of DELIMITERS) {
    const count = countUnquotedDelimiters(text, d);
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

function isEmptyRow(row: string[]): boolean {
  return row.every((f) => f === "");
}

// Splits already-CRLF-normalized text into raw string rows/fields, honoring
// double-quoted fields (with "" as an escaped quote, and embedded newlines
// kept verbatim inside the quotes).
function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAny = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    sawAny = true;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    // A quote only opens a quoted field right at the field's own start
    // (nothing accumulated in `field` yet) -- a bare `"` inside an already-
    // started unquoted field (`5" screen`) is literal text, not a delimiter.
    if (c === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (sawAny && (field.length > 0 || row.length > 0)) {
    row.push(field);
    rows.push(row);
  }
  // A trailing blank line (or a doubled trailing newline) splits to one
  // or more rows of all-empty fields at the very END of the file -- that's a
  // formatting artifact, not a data row (which would otherwise chart as a
  // gap), so strip it. A blank line in the MIDDLE of the data is left alone:
  // for a single-column table that's how a legitimately empty value reads.
  while (rows.length > 0 && isEmptyRow(rows[rows.length - 1]!)) rows.pop();
  return rows;
}

// ISO 8601 date/date-time only -- Date.parse is too lenient (locale- and
// engine-dependent for other formats) to trust for column type inference.
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value) || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value.slice(0, 10)).toISOString().slice(0, 10) === value.slice(0, 10);
}

function inferColumnType(values: string[]): ColumnType {
  const nonEmpty = values.map((v) => v.trim()).filter((v) => v !== "");
  if (nonEmpty.length === 0) return "string";
  if (nonEmpty.every((v) => NUMBER_RE.test(v))) return "number";
  if (nonEmpty.every(isValidDate)) return "date";
  return "string";
}

function coerceCell(raw: string, type: ColumnType): CellValue {
  const trimmed = raw.trim();
  if (trimmed === "") return raw;
  if (type === "number") return Number(trimmed);
  if (type === "date") return new Date(trimmed);
  return raw;
}

export function parseCSV(text: string): Table {
  let t = text.startsWith("﻿") ? text.slice(1) : text;
  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (t === "") return { columns: [], columnTypes: [], rows: [] };

  const delimiter = detectDelimiter(t);
  const rawRows = splitRows(t, delimiter);
  if (rawRows.length === 0) return { columns: [], columnTypes: [], rows: [] };

  const columns = rawRows[0]!;
  const dataRows = rawRows.slice(1);
  const columnTypes = columns.map((_, ci) => inferColumnType(dataRows.map((r) => r[ci] ?? "")));
  const rows = dataRows.map((r) => columns.map((_, ci) => coerceCell(r[ci] ?? "", columnTypes[ci]!)));
  return { columns, columnTypes, rows };
}

export type WhereOp = "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains";
export interface WhereClause {
  column: string;
  op: WhereOp;
  value: string | number;
}
export interface RangeObject {
  columns?: string[];
  rows?: [number, number];
  where?: WhereClause[];
}
export type RangeSpec = string | RangeObject;

function colLetterToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

interface A1Range {
  colFrom?: number;
  colTo?: number;
  rowFrom?: number;
  rowTo?: number;
}

function parseA1(a1: string): A1Range {
  const full = /^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/.exec(a1);
  if (full) return { colFrom: colLetterToIndex(full[1]!), rowFrom: Number(full[2]), colTo: colLetterToIndex(full[3]!), rowTo: Number(full[4]) };
  const colsOnly = /^([A-Za-z]+):([A-Za-z]+)$/.exec(a1);
  if (colsOnly) return { colFrom: colLetterToIndex(colsOnly[1]!), colTo: colLetterToIndex(colsOnly[2]!) };
  const rowsOnly = /^(\d+):(\d+)$/.exec(a1);
  if (rowsOnly) return { rowFrom: Number(rowsOnly[1]), rowTo: Number(rowsOnly[2]) };
  const cell = /^([A-Za-z]+)(\d+)$/.exec(a1);
  if (cell) {
    const c = colLetterToIndex(cell[1]!);
    const r = Number(cell[2]);
    return { colFrom: c, colTo: c, rowFrom: r, rowTo: r };
  }
  throw new Error(`invalid range: "${a1}"`);
}

function matchWhere(row: CellValue[], columns: string[], w: WhereClause): boolean {
  const ci = columns.indexOf(w.column);
  if (ci < 0) return true;
  const cell = row[ci];
  switch (w.op) {
    case "=":
      return String(cell) === String(w.value);
    case "!=":
      return String(cell) !== String(w.value);
    case "contains":
      return String(cell).includes(String(w.value));
    case ">":
    case "<":
    case ">=":
    case "<=": {
      const a = typeof cell === "object" ? cell.getTime() : Number(cell);
      const b = typeof w.value === "number" ? w.value : Number(w.value);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (w.op === ">") return a > b;
      if (w.op === "<") return a < b;
      if (w.op === ">=") return a >= b;
      return a <= b;
    }
  }
}

/** Excel-like range filter: `'A3:C50'` A1 notation (also accepts `'A:C'`,
 * `'3:50'`, a single cell), or the equivalent object form with named columns,
 * a 1-indexed inclusive data-row range, and/or `where` predicates. Range/
 * filter is an inline-only concept; `null`/`undefined` is a no-op. */
export function applyRange(table: Table, range?: RangeSpec | null): Table {
  if (!range) return table;

  let colFrom: number | undefined;
  let colTo: number | undefined;
  let rowFrom: number | undefined;
  let rowTo: number | undefined;
  let columnNames: string[] | undefined;
  let where: WhereClause[] | undefined;

  if (typeof range === "string") {
    ({ colFrom, colTo, rowFrom, rowTo } = parseA1(range));
  } else {
    columnNames = range.columns;
    if (range.rows) [rowFrom, rowTo] = range.rows;
    where = range.where;
  }

  let colIdx = table.columns.map((_, i) => i);
  if (columnNames) colIdx = columnNames.map((name) => table.columns.indexOf(name)).filter((i) => i >= 0);
  else if (colFrom !== undefined && colTo !== undefined) colIdx = colIdx.filter((i) => i >= colFrom! && i <= colTo!);

  let rows = table.rows;
  if (rowFrom !== undefined && rowTo !== undefined) rows = rows.slice(Math.max(0, rowFrom - 1), rowTo);
  if (where && where.length > 0) rows = rows.filter((row) => where!.every((w) => matchWhere(row, table.columns, w)));

  return {
    columns: colIdx.map((i) => table.columns[i]!),
    columnTypes: colIdx.map((i) => table.columnTypes[i]!),
    rows: rows.map((row) => colIdx.map((i) => row[i]!)),
  };
}
