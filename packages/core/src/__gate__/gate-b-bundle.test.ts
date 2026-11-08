// "sideEffects": false + top-level spec mutation in
// serde/builtins-serde.ts. A production bundle built from @jul-editor/core's
// SOURCE (exactly how apps/web resolves it, via vite alias) drops
// every built-in toMarkdown/toHTML hook: rolldown traces `coreRegistry` (a
// pure re-export) straight to model/builtins.ts and discards builtins-serde
// as side-effect-free. Uses the web app's vite binary.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const editorRoot = path.resolve(here, "../../../..");
const viteBin = path.join(editorRoot, "apps/web/node_modules/.bin/vite");

describe("bundle", () => {
  it("toMarkdown still works in a vite production build of the serde source entry", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gate-b-"));
    const entry = path.join(dir, "entry.ts");
    writeFileSync(
      entry,
      `import { toMarkdown } from ${JSON.stringify(path.join(editorRoot, "packages/core/src/serde/index.ts"))};\n` +
        `console.log(JSON.stringify(toMarkdown({ version: 1, blocks: [{ id: "a", type: "paragraph", props: {}, content: [{ type: "text", text: "hi" }] }] })));\n`,
    );
    const cfg = path.join(dir, "vite.config.mjs");
    writeFileSync(cfg, `export default { logLevel: "error", build: { outDir: ${JSON.stringify(path.join(dir, "out"))}, minify: false, lib: { entry: ${JSON.stringify(entry)}, formats: ["es"], fileName: "b" } } };\n`);
    execFileSync(viteBin, ["build", "--config", cfg], { cwd: dir, stdio: "pipe" });
    const file = readdirSync(path.join(dir, "out")).find((f) => /^b\.m?js$/.test(f))!;
    const out = JSON.parse(execFileSync(process.execPath, [path.join(dir, "out", file)]).toString());
    expect(out).toEqual({ markdown: "hi", lossy: [] });
  }, 120_000);
});
