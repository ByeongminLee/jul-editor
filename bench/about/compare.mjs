import { build } from "esbuild";
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from "lexical";
import { Schema } from "prosemirror-model";
import Delta from "quill-delta";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));
const core = fileURLToPath(new URL("../../packages/core/dist/index.js", import.meta.url));
const entries = {
  JulEditor: `import {createEditor,coreRegistry} from ${JSON.stringify(core)};globalThis.editorEngine=[createEditor,coreRegistry]`,
  Lexical: 'import {createEditor,$getRoot,$createParagraphNode,$createTextNode} from "lexical";globalThis.editorEngine=[createEditor,$getRoot,$createParagraphNode,$createTextNode]',
  Quill: 'import Quill from "quill";globalThis.editorEngine=Quill',
  ProseMirror: 'import {Schema} from "prosemirror-model";import {EditorState} from "prosemirror-state";import {EditorView} from "prosemirror-view";globalThis.editorEngine=[Schema,EditorState,EditorView]',
};

const bundles = {};
for (const [name, contents] of Object.entries(entries)) {
  const output = await build({ stdin: { contents, resolveDir: root, sourcefile: `${name}.js` }, bundle: true, minify: true, format: "esm", platform: "browser", target: "es2022", write: false, logLevel: "silent" });
  const js = output.outputFiles[0].contents;
  bundles[name] = { minifiedBytes: js.byteLength, gzipBytes: gzipSync(js).byteLength };
}

const rows = Array.from({ length: 500 }, (_, index) => `${String(index + 1).padStart(3, "0")} A paragraph about documents, structured content, and a readable editing experience.`);
const jul = { version: 1, blocks: rows.map((text, index) => ({ id: `p${index + 1}`, type: "paragraph", props: {}, content: [{ type: "text", text }] })) };
const lexical = createEditor({ namespace: "about-bench", onError: (error) => { throw error; } });
lexical.update(() => {
  const doc = $getRoot();
  doc.clear();
  for (const text of rows) doc.append($createParagraphNode().append($createTextNode(text)));
}, { discrete: true });
const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } });
const documents = {
  JulEditor: jul,
  Lexical: lexical.getEditorState().toJSON(),
  Quill: rows.reduce((delta, text) => delta.insert(`${text}\n`), new Delta()),
  ProseMirror: schema.node("doc", null, rows.map((text) => schema.node("paragraph", null, schema.text(text)))).toJSON(),
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[9] + sorted[10]) / 2;
}

const formats = {};
for (const [name, value] of Object.entries(documents)) {
  const json = JSON.stringify(value);
  for (let index = 0; index < 5; index++) JSON.stringify(JSON.parse(json));
  const times = [];
  for (let index = 0; index < 20; index++) {
    const start = performance.now();
    JSON.stringify(JSON.parse(json));
    times.push(performance.now() - start);
  }
  formats[name] = { jsonBytes: Buffer.byteLength(json), gzipBytes: gzipSync(json).byteLength, parseStringifyMedianMs: Number(median(times).toFixed(3)) };
}

console.log(JSON.stringify({ node: process.version, esbuild: "0.28.2", paragraphs: rows.length, bundles, formats }, null, 2));
