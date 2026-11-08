import { describe, expect, it } from "vitest";
import { fromMarkdown } from "./from-markdown.js";
import { toHTML } from "./to-html.js";

// fromMarkdown -> toHTML must never let a dangerous scheme
// or an unescaped tag/attribute reach the HTML output. marked's lexer alone
// (never marked's HTML renderer) parses these; toHTML must escape.
const VECTORS: string[] = [
  "[click me](javascript:alert(1))",
  "[click me](JAVASCRIPT:alert(1))",
  "[click me](java\tscript:alert(1))",
  "[click me](&#x6a;avascript:alert(1))",
  "[click me](&#106;avascript:alert(1))",
  "[click me](vbscript:msgbox(1))",
  "![alt](javascript:alert(1))",
  "![alt](data:text/html,<script>alert(1)</script>)",
  "![alt](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)",
  '![" onerror="alert(1)](x)',
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "text with <img src=x onerror=alert(1)> inline",
  "<svg onload=alert(1)></svg>",
  '[break "><script>alert(1)</script>](https://example.com)',
  "```\"><script>alert(1)</script>\ncode\n```",
  "> <script>alert(1)</script>",
  "- <script>alert(1)</script>",
  "# <script>alert(1)</script>",
  "| <script>alert(1)</script> |\n| --- |\n| <img src=x onerror=alert(1)> |\n",
  "[@mention](jul-editor:\"><script>alert(1)</script>/x)",
  "<javascript:alert(1)>",
  "[x](  javascript:alert(1)  )",
];

// A raw "<"/">" only ever appears in our output as a real tag -- our
// escaping turns every other occurrence into "&lt;"/"&gt;" -- so
// `/<[^>]*>/g` extracts exactly the genuine tags we emit (degraded raw HTML
// shows up as inert text like "&lt;img onerror=...&gt;" and isn't matched at
// all). Within each real tag, a live onXxx= attribute would appear outside
// any quoted attribute VALUE, so blanking those out before checking avoids
// flagging e.g. `alt="&quot; onerror=..."` (safe, quoted text).
function hasLiveOnHandler(html: string): boolean {
  const tags = html.match(/<[^>]*>/g) ?? [];
  return tags.some((tag) => /\bon(?:error|load)\s*=/i.test(tag.replace(/"[^"]*"/g, '""')));
}

describe("serde XSS vectors: fromMarkdown -> toHTML", () => {
  expect(VECTORS.length).toBeGreaterThanOrEqual(20);

  for (const md of VECTORS) {
    it(`is safe: ${JSON.stringify(md.slice(0, 50))}`, () => {
      const { doc } = fromMarkdown(md);
      const html = toHTML(doc);
      // No unescaped `<script` (literal). A raw "<" always comes out
      // as "&lt;" from our escaping, so this also catches any other
      // unescaped tag we didn't intend to emit.
      expect(html).not.toMatch(/<script/i);
      // No javascript: scheme actually wired into a live href/src
      // (sanitizeUrl strips it to null/""); appearing as inert escaped
      // *text* elsewhere -- e.g. degraded raw HTML -- is not executable.
      expect(html).not.toMatch(/(?:href|src)="[^"]*javascript:/i);
      // No onerror=/onload= as a live attribute of a real (unescaped) tag.
      expect(hasLiveOnHandler(html)).toBe(false);
    });
  }
});
