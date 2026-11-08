import { describe, expect, it } from "vitest";
import { parseJSON } from "./json.js";

describe("parseJSON", () => {
  it("turns flat record arrays into chart columns, keeping numeric values", () => {
    expect(parseJSON('[{"month":"Jan","sales":120},{"month":"Feb","sales":160}]')).toEqual({
      columns: ["month", "sales"],
      columnTypes: ["string", "number"],
      rows: [["Jan", 120], ["Feb", 160]],
    });
  });

  it("includes later record keys and uses empty cells for missing or null values", () => {
    expect(parseJSON('[{"month":"Jan","sales":120},{"month":"Feb","profit":30},{"month":"Mar","sales":null}]')).toEqual({
      columns: ["month", "sales", "profit"],
      columnTypes: ["string", "number", "number"],
      rows: [["Jan", 120, ""], ["Feb", "", 30], ["Mar", "", ""]],
    });
  });

  it("rejects malformed JSON, non-array data, and nested values", () => {
    expect(() => parseJSON("{bad")).toThrow();
    expect(() => parseJSON('{"month":"Jan"}')).toThrow(/array/i);
    expect(() => parseJSON('[{"month":"Jan","sales":{"total":120}}]')).toThrow(/flat/i);
  });
});
