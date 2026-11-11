// The diagram void block's renderer. `import('mermaid')` only happens
// once this component actually mounts (i.e. a diagram block exists) and only
// on its first non-empty render, keeping mermaid out of pages with no
// diagrams. securityLevel stays 'strict' and is never
// overridden (mermaid's own default-directive allowlist already blocks a
// `%%{init}%%` directive from raising it), maxTextSize is set, version is
// supplied by the host app as an optional peer (`mermaid` ^12). Debounced 300ms so fast typing in the
// code textarea doesn't re-render on every keystroke. Never throws out of the
// view -- a parse/render error becomes a headless error element instead.
import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { usePluginControls, type PluginViewProps } from "./view-props.js";

let mermaidInitialized = false;

async function ensureMermaid() {
  const mod = await import("mermaid");
  const mermaid = mod.default;
  if (!mermaidInitialized) {
    // suppressErrorRendering: on a failed render mermaid otherwise draws its
    // "Syntax error in text" graphic into a temporary `#d<id>` container on
    // document.body and throws before removing it; the error is shown in-block.
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", maxTextSize: 50000, suppressErrorRendering: true });
    mermaidInitialized = true;
  }
  return mermaid;
}

const DEBOUNCE_MS = 300;

export interface DiagramViewClassNames {
  container?: string;
  source?: string;
  preview?: string;
  error?: string;
}

export interface DiagramViewProps extends PluginViewProps {
  className?: string | DiagramViewClassNames;
}

export function DiagramView({ block, editor, selected, updateProps, readOnly, locale = "en", className }: DiagramViewProps): ReactNode {
  const classes = typeof className === "string" ? { container: className } : className ?? {};
  const ko = locale === "ko";
  const controls = usePluginControls(editor, selected);
  const code = typeof block.props.code === "string" ? block.props.code : "";
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seqRef = useRef(0);
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    // Invalidate an in-flight render as soon as code changes, before debounce fires.
    const seq = ++seqRef.current;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (code.trim() === "") {
        setSvg(null);
        setError(null);
        return;
      }
      const renderId = `jul-editor-diagram-${reactId}-${seq}`;
      ensureMermaid()
        .then((mermaid) => mermaid.render(renderId, code))
        .then(({ svg: rendered }) => {
          if (seq !== seqRef.current) return;
          setSvg(rendered);
          setError(null);
        })
        .catch((err: unknown) => {
          // Belt and braces: never leave mermaid's temporary render container behind.
          document.getElementById(`d${renderId}`)?.remove();
          document.getElementById(renderId)?.remove();
          if (seq !== seqRef.current) return;
          setSvg(null);
          setError(err instanceof Error ? err.message : String(err));
        });
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      seqRef.current++;
    };
  }, [code, reactId]);

  return (
    <div className={classes.container} data-jul-editor-plugin="diagram" onKeyDown={controls.onKeyDown} onPointerDown={controls.onPointerDown}>
      {controls.open && !readOnly && updateProps && (
        <textarea className={classes.source}
          aria-label={ko ? "다이어그램 소스" : "Diagram source"}
          data-testid="jul-editor-diagram-code"
          value={code}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => updateProps({ code: e.target.value })}
        />
      )}
      {error && (
        <div className={classes.error} data-testid="jul-editor-diagram-error" data-jul-editor-plugin="diagram-error">
          {error}
        </div>
      )}
      {svg && !error && <div className={classes.preview} data-testid="jul-editor-diagram-preview" data-jul-editor-plugin="diagram-preview" dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  );
}
