import { describe, expect, it } from "vitest";
import { VERSION } from "./";

describe("@jul-editor/core placeholder", () => {
  it("exports something", () => {
    expect(VERSION).toBe("0.1.0");
  });
});
