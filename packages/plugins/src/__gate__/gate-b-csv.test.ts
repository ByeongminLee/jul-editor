// CSV parser edge cases (RFC 4180 + what Excel/Sheets exports).
import { describe, expect, it } from "vitest";
import { parseCSV } from "../data/csv.js";

describe("csv", () => {
  it('a bare quote inside an unquoted field (5" screen) must not swallow the rest of the file', () => {
    const t = parseCSV('size,name\n5" screen,TV\n7" tab,Pad\n');
    expect(t.rows).toEqual([
      ['5" screen', "TV"],
      ['7" tab', "Pad"],
    ]);
  });

  it("blank lines (e.g. a doubled trailing newline) must not become empty data rows", () => {
    const t = parseCSV("a,b\n1,2\n\n");
    expect(t.rows).toEqual([[1, 2]]);
  });
});
