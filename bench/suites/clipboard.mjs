// Benches: fromJSON-5000 and
// clipboard-decode-500. Neither is one of the core budgets
// (those are covered by serde.mjs/diff.mjs) -- these are additional
// regression gates.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { coreRegistry } from "../../packages/core/src/model/builtins.js";
import { fromJSON } from "../../packages/core/src/model/migrate.js";
import { decodeClipboard } from "../../packages/core/src/clipboard/index.js";
import { toJSON } from "../../packages/core/src/model/migrate.js";
import { normalizeDoc } from "../../packages/core/src/model/canonical.js";

const dir = dirname(fileURLToPath(import.meta.url));
const doc5000Json = readFileSync(join(dir, "../fixtures/doc-5000.json"), "utf8");
const doc500 = JSON.parse(readFileSync(join(dir, "../fixtures/doc-500.json"), "utf8"));

// The jul-editor-JSON clipboard payload a same-origin copy would have put on the
// clipboard: encodeClipboard's own "application/x-jul-editor+json" field is just
// toJSON(doc), which normalizeDoc'ing first keeps consistent with what a
// real copy (of an already-normalized doc) would produce.
const julEditorJson = toJSON(normalizeDoc(doc500, coreRegistry));

/** Minimal DataTransferLike test double -- a same-origin jul-editor paste only
 * ever needs the "application/x-jul-editor+json" MIME type read. */
function clipboardWith(julEditorJsonPayload) {
  return {
    getData: (format) => (format === "application/x-jul-editor+json" ? julEditorJsonPayload : ""),
  };
}

export default (bench) => {
  bench("fromJSON-5000", () => fromJSON(doc5000Json, coreRegistry), 50);
  bench("clipboard-decode-500", () => decodeClipboard(clipboardWith(julEditorJson), { registry: coreRegistry }), 100);
};
