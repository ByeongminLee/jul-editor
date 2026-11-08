// Serde benches.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fromMarkdown, toHTML, toMarkdown } from "../../packages/core/src/serde/index.ts";
import { marked } from "../../packages/core/src/serde/bench-marked.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const doc5000 = JSON.parse(readFileSync(join(dir, "../fixtures/doc-5000.json"), "utf8"));
const md5000 = toMarkdown(doc5000).markdown;

export default (bench) => {
  bench("toMarkdown-5000", () => toMarkdown(doc5000), 50);
  bench("fromMarkdown-5000", () => fromMarkdown(md5000), 150);
  bench("toHTML-5000", () => toHTML(doc5000), 50);
  bench("marked-lexer-5000", () => marked.lexer(md5000, { gfm: true }), 60);
};
