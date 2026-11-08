// "/diff" playground route: <DiffView>/<DiffStats> over two versions
// of a bench fixture (?doc=500|5000, default 500), plus a mode toggle. Skin
// CSS lives in ../style.css only -- @jul-editor/react itself stays CSS-free.
import { coreRegistry, type Doc } from "@jul-editor/core";
import { DiffStats, DiffView, useDiff } from "@jul-editor/plugins/diff";
import { useEffect, useMemo, useRef, useState } from "react";
import doc500 from "../../../../bench/fixtures/doc-500.json";
import doc5000 from "../../../../bench/fixtures/doc-5000.json";
import { buildDiffDemoDocs } from "./build-demo-docs.js";

declare global {
  interface Window {
    // Exposed for e2e/diff.spec.ts: renderMs is a rough performance.now()
    // delta around mount (initial diff compute + render), stats mirrors what
    // <DiffStats> renders so the test can cross-check both against a
    // directly-computed @jul-editor/plugins/diff diffStats() call.
    __julEditorDiff?: {
      renderMs: number;
      stats: { inserted: number; deleted: number; modified: number; moved: number; unchanged: number };
    };
  }
}

export function DiffPage() {
  const [mode, setMode] = useState<"changes" | "full">("changes");
  const size = new URLSearchParams(window.location.search).get("doc") === "5000" ? 5000 : 500;
  const { before, after } = useMemo(() => buildDiffDemoDocs((size === 5000 ? doc5000 : doc500) as Doc, size), [size]);
  const { stats } = useDiff(before, after, coreRegistry);

  const startRef = useRef<number | null>(null);
  if (startRef.current === null) startRef.current = performance.now();

  useEffect(() => {
    window.__julEditorDiff = { renderMs: performance.now() - startRef.current!, stats };
    return () => {
      delete window.__julEditorDiff;
    };
  }, [stats]);

  return (
    <div data-testid="page-diff">
      <div className="jul-editor-diff-toolbar">
        <label>
          mode:{" "}
          <select data-testid="diff-mode" value={mode} onChange={(e) => setMode(e.target.value as "changes" | "full")}>
            <option value="changes">changes</option>
            <option value="full">full</option>
          </select>
        </label>
        <DiffStats stats={stats} className="jul-editor-diff-stats" />
      </div>
      <DiffView before={before} after={after} mode={mode} className="jul-editor-diff" />
    </div>
  );
}
