import type { CellValue, ColumnType, Table } from "./csv.js";

/** Parses a JSON array of flat records into the same table shape as CSV. */
export function parseJSON(text: string): Table {
  const records: unknown = JSON.parse(text);
  if (!Array.isArray(records)) throw new Error("JSON data must be an array of records");
  const columns = [...new Set(records.flatMap((record: unknown) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("JSON data must contain flat records");
    for (const value of Object.values(record)) {
      if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new Error("JSON data must contain flat records with primitive values");
      }
    }
    return Object.keys(record);
  }))];
  const values = records as Record<string, string | number | boolean | null>[];
  const columnTypes: ColumnType[] = columns.map((column) => {
    const present = values.map((row) => row[column]).filter((value) => value != null && value !== "");
    return present.length && present.every((value) => typeof value === "number") ? "number" : "string";
  });
  const rows: CellValue[][] = values.map((record) => columns.map((column, index) => {
    const value = record[column];
    if (value == null) return "";
    return columnTypes[index] === "number" ? value as number : String(value);
  }));
  return { columns, columnTypes, rows };
}
