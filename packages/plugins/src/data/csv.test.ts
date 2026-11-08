import { describe, expect, it } from "vitest";
import { applyRange, parseCSV } from "./csv.js";

describe("parseCSV", () => {
  it("parses a simple comma header + rows", () => {
    const t = parseCSV("a,b,c\n1,2,3\n4,5,6");
    expect(t.columns).toEqual(["a", "b", "c"]);
    expect(t.rows).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(t.columnTypes).toEqual(["number", "number", "number"]);
  });

  it("infers a string column", () => {
    const t = parseCSV("name\nalice\nbob");
    expect(t.columnTypes).toEqual(["string"]);
    expect(t.rows).toEqual([["alice"], ["bob"]]);
  });

  it("infers a date column (ISO 8601 only)", () => {
    const t = parseCSV("d\n2024-01-01\n2024-02-15");
    expect(t.columnTypes).toEqual(["date"]);
    expect(t.rows[0]?.[0]).toBeInstanceOf(Date);
    expect((t.rows[0]?.[0] as Date).getUTCFullYear()).toBe(2024);
  });

  it("keeps invalid ISO-looking dates as strings instead of creating Invalid Date cells", () => {
    const t = parseCSV("date\n2024-02-30\n2024-13-01");
    expect(t.columnTypes).toEqual(["string"]);
    expect(t.rows).toEqual([["2024-02-30"], ["2024-13-01"]]);
  });

  it("does not misclassify a non-ISO date-like string as a date column", () => {
    const t = parseCSV("d\n01/02/2024\n03/04/2024");
    expect(t.columnTypes).toEqual(["string"]);
  });

  it("a mixed column falls back to string", () => {
    const t = parseCSV("v\n1\nabc\n3");
    expect(t.columnTypes).toEqual(["string"]);
    expect(t.rows.map((r) => r[0])).toEqual(["1", "abc", "3"]);
  });

  it("handles a quoted field containing the delimiter", () => {
    const t = parseCSV('a,b\n"1,2",3');
    expect(t.rows).toEqual([["1,2", 3]]);
  });

  it("handles an escaped quote (\"\") inside a quoted field", () => {
    const t = parseCSV('a\n"she said ""hi"""');
    expect(t.rows).toEqual([['she said "hi"']]);
  });

  it("handles a quoted field with an embedded newline", () => {
    const t = parseCSV('a,b\n"line1\nline2",x');
    expect(t.rows).toEqual([["line1\nline2", "x"]]);
  });

  it("normalizes CRLF line endings", () => {
    const t = parseCSV("a,b\r\n1,2\r\n3,4");
    expect(t.rows).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("normalizes a lone CR", () => {
    const t = parseCSV("a,b\r1,2");
    expect(t.rows).toEqual([[1, 2]]);
  });

  it("strips a leading BOM", () => {
    const t = parseCSV("﻿a,b\n1,2");
    expect(t.columns).toEqual(["a", "b"]);
  });

  it("auto-detects a semicolon delimiter", () => {
    const t = parseCSV("a;b;c\n1;2;3");
    expect(t.columns).toEqual(["a", "b", "c"]);
    expect(t.rows).toEqual([[1, 2, 3]]);
  });

  it("auto-detects a tab delimiter", () => {
    const t = parseCSV("a\tb\n1\t2");
    expect(t.columns).toEqual(["a", "b"]);
  });

  it("auto-detects a pipe delimiter", () => {
    const t = parseCSV("a|b|c\n1|2|3");
    expect(t.columns).toEqual(["a", "b", "c"]);
  });

  it("ignores a delimiter candidate inside quotes when detecting", () => {
    const t = parseCSV('a;b\n"has, a comma";2');
    expect(t.columns).toEqual(["a", "b"]);
    expect(t.rows).toEqual([["has, a comma", 2]]);
  });

  it("detects the delimiter after a quoted newline in the header", () => {
    const t = parseCSV('"Sales\nmonth";value\nJanuary;10');
    expect(t.columns).toEqual(["Sales\nmonth", "value"]);
    expect(t.rows).toEqual([["January", 10]]);
  });

  it("treats an empty cell as an empty string regardless of column type", () => {
    const t = parseCSV("a\n1\n\n3");
    expect(t.rows).toEqual([[1], [""], [3]]);
  });

  it("drops a trailing blank line", () => {
    const t = parseCSV("a,b\n1,2\n");
    expect(t.rows).toEqual([[1, 2]]);
  });

  it("returns an empty table for empty input", () => {
    expect(parseCSV("")).toEqual({ columns: [], columnTypes: [], rows: [] });
  });

  it("returns a header-only table with no data rows", () => {
    const t = parseCSV("a,b");
    expect(t.columns).toEqual(["a", "b"]);
    expect(t.rows).toEqual([]);
  });

  it("handles a negative and decimal number", () => {
    const t = parseCSV("v\n-1.5\n2.25");
    expect(t.rows).toEqual([[-1.5], [2.25]]);
  });
});

describe("applyRange", () => {
  const table = parseCSV(
    ["name,age,city", "alice,30,seoul", "bob,25,busan", "carol,40,seoul", "dave,22,daegu", "erin,35,busan"].join("\n"),
  );

  it("returns the table unchanged for a null/undefined range", () => {
    expect(applyRange(table, null)).toEqual(table);
    expect(applyRange(table, undefined)).toEqual(table);
  });

  it("parses A1 notation 'A1:B2' (columns + rows, 1-indexed inclusive)", () => {
    const r = applyRange(table, "A1:B2");
    expect(r.columns).toEqual(["name", "age"]);
    expect(r.rows).toEqual([
      ["alice", 30],
      ["bob", 25],
    ]);
  });

  it("A1 notation 'A3:C50' clamps to the available rows", () => {
    const r = applyRange(table, "A3:C50");
    expect(r.columns).toEqual(["name", "age", "city"]);
    expect(r.rows).toEqual([
      ["carol", 40, "seoul"],
      ["dave", 22, "daegu"],
      ["erin", 35, "busan"],
    ]);
  });

  it("supports a column-only A1 range ('B:C')", () => {
    const r = applyRange(table, "B:C");
    expect(r.columns).toEqual(["age", "city"]);
    expect(r.rows[0]).toEqual([30, "seoul"]);
  });

  it("supports a row-only A1 range ('2:3')", () => {
    const r = applyRange(table, "2:3");
    expect(r.columns).toEqual(["name", "age", "city"]);
    expect(r.rows).toEqual([
      ["bob", 25, "busan"],
      ["carol", 40, "seoul"],
    ]);
  });

  it("supports a single-cell A1 range ('A2')", () => {
    const r = applyRange(table, "A2");
    expect(r.columns).toEqual(["name"]);
    expect(r.rows).toEqual([["bob"]]);
  });

  it("supports multi-letter columns ('AA')", () => {
    const wide = { columns: Array.from({ length: 28 }, (_, i) => `c${i}`), columnTypes: Array(28).fill("string") as ("string")[], rows: [Array.from({ length: 28 }, (_, i) => `v${i}`)] };
    const r = applyRange(wide, "AA1:AA1");
    expect(r.columns).toEqual(["c26"]);
    expect(r.rows).toEqual([["v26"]]);
  });

  it("throws on an invalid A1 string", () => {
    expect(() => applyRange(table, "not-a-range")).toThrow();
  });

  it("filters by named columns in object form", () => {
    const r = applyRange(table, { columns: ["city", "name"] });
    expect(r.columns).toEqual(["city", "name"]);
    expect(r.rows[0]).toEqual(["seoul", "alice"]);
  });

  it("filters by a 1-indexed inclusive row range in object form", () => {
    const r = applyRange(table, { rows: [2, 3] });
    expect(r.rows).toEqual([
      ["bob", 25, "busan"],
      ["carol", 40, "seoul"],
    ]);
  });

  it("applies a where '=' filter", () => {
    const r = applyRange(table, { where: [{ column: "city", op: "=", value: "seoul" }] });
    expect(r.rows.map((row) => row[0])).toEqual(["alice", "carol"]);
  });

  it("applies a where '!=' filter", () => {
    const r = applyRange(table, { where: [{ column: "city", op: "!=", value: "seoul" }] });
    expect(r.rows.map((row) => row[0])).toEqual(["bob", "dave", "erin"]);
  });

  it("applies a where '>' numeric filter", () => {
    const r = applyRange(table, { where: [{ column: "age", op: ">", value: 30 }] });
    expect(r.rows.map((row) => row[0])).toEqual(["carol", "erin"]);
  });

  it("applies a where '<=' numeric filter", () => {
    const r = applyRange(table, { where: [{ column: "age", op: "<=", value: 25 }] });
    expect(r.rows.map((row) => row[0])).toEqual(["bob", "dave"]);
  });

  it("applies a where 'contains' filter", () => {
    const r = applyRange(table, { where: [{ column: "name", op: "contains", value: "ar" }] });
    expect(r.rows.map((row) => row[0])).toEqual(["carol"]);
  });

  it("combines rows + where in object form", () => {
    const r = applyRange(table, { rows: [1, 4], where: [{ column: "city", op: "=", value: "busan" }] });
    expect(r.rows.map((row) => row[0])).toEqual(["bob"]);
  });

  it("an unknown where column is a no-op filter (keeps all rows)", () => {
    const r = applyRange(table, { where: [{ column: "nope", op: "=", value: "x" }] });
    expect(r.rows.length).toBe(table.rows.length);
  });
});
