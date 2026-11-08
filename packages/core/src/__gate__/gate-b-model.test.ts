// Adversarial repros: model normalize / url.
import { describe, expect, it } from "vitest";
import { coreRegistry } from "../model/builtins.js";
import { normalizeDoc } from "../model/canonical.js";
import { sanitizeUrl } from "../model/url.js";
import type { Doc } from "../model/types.js";

describe("model", () => {
  it("normalize must not silently delete a stray tableRow (and its cell text) nested under a children:'none' block", () => {
    const d: Doc = {
      version: 1,
      blocks: [
        {
          id: "c",
          type: "codeBlock",
          props: {},
          content: [],
          children: [{ id: "r", type: "tableRow", props: {}, children: [{ id: "x", type: "tableCell", props: {}, content: [{ type: "text", text: "precious" }] }] }],
        },
      ],
    };
    expect(JSON.stringify(normalizeDoc(d, coreRegistry))).toContain("precious");
  });

  it("sanitizeUrl must not rewrite a legitimate URL by deleting inner spaces (my file.png -> myfile.png)", () => {
    const out = sanitizeUrl("https://x.com/my file.png", "image");
    expect(out === "https://x.com/my file.png" || out === "https://x.com/my%20file.png").toBe(true);
  });
});
