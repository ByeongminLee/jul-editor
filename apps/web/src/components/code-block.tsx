import { Check, Copy } from "lucide-react";
import type { HighlightRange } from "@jul-editor/core";
import { createLowlightHighlighter } from "@jul-editor/plugins/code";
import { useEffect, useMemo, useState } from "react";

import "../styles/docs-live.css";

const highlighter = createLowlightHighlighter();

function coloredCode(code: string, ranges: HighlightRange[]) {
  const cuts = [...new Set([0, code.length, ...ranges.flatMap(({ from, to }) => [from, to])])].sort((a, b) => a - b);
  return cuts.slice(0, -1).map((from, index) => {
    const to = cuts[index + 1]!;
    const token = ranges.filter((range) => range.from <= from && range.to >= to)
      .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0]?.token;
    return <span key={from} data-jul-editor-token={token}>{code.slice(from, to)}</span>;
  });
}

export function Code({ children, title, language = title, locale, testId }: { children: string; title: string; language?: string; locale: "en" | "ko"; /** Rendered as data-testid on the <pre> that holds the code text. */ testId?: string }) {
  const [status, setStatus] = useState<"idle" | "done" | "error">("idle");
  const [highlight, setHighlight] = useState<{ code: string; language: string; ranges: HighlightRange[] } | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.resolve(highlighter.highlight(children, language)).then((ranges) => {
      if (active) setHighlight({ code: children, language, ranges });
    }).catch(() => { if (active) setHighlight({ code: children, language, ranges: [] }); });
    return () => { active = false; };
  }, [children, language]);
  const content = useMemo(() => coloredCode(children, highlight?.code === children && highlight.language === language ? highlight.ranges : []), [children, language, highlight]);
  async function copy() {
    try { await navigator.clipboard.writeText(children); setStatus("done"); }
    catch { setStatus("error"); }
    window.setTimeout(() => setStatus("idle"), 2000);
  }
  return <div className="docs-code">
    <div className="docs-code-head">
      <span className="docs-code-title">{title}</span>
      <button type="button" onClick={copy}>{status === "done" ? <Check size={14} /> : <Copy size={14} />}{status === "done" ? (locale === "ko" ? "복사됨" : "Copied") : status === "error" ? (locale === "ko" ? "복사 실패. 코드를 직접 선택하세요" : "Copy failed. Select the code") : (locale === "ko" ? "코드 복사" : "Copy code")}</button>
    </div>
    <pre data-testid={testId}><code>{content}</code></pre>
  </div>;
}
