// Style slots for the diff views, as CSS custom properties + a ready to use stylesheet string.
// The views stay headless (data attributes only); a host either styles those itself or renders
// <DiffStyles /> (or injects DIFF_CSS). Colors follow the existing playground diff styling
// (green insert, red delete, accent for modify/move) and flip for dark mode three ways:
// `prefers-color-scheme`, `[data-theme="dark"]` / `.dark` on any ancestor, and `data-theme="light"`
// opts a subtree back out of the media query.
//
// Override any of these on the view's root (or an ancestor):
//   --jul-editor-diff-insert-bg / -insert-mark / -insert-fg
//   --jul-editor-diff-delete-bg / -delete-mark / -delete-fg
//   --jul-editor-diff-modify   / -move   / -format
//   --jul-editor-diff-surface / -text / -muted / -border / -radius
//   --jul-editor-diff-author   (set per change from `attribute()`; falls back to the border color)

const ROOTS = `[data-jul-editor-diff-view],[data-jul-editor-diff-inline],[data-jul-editor-suggestion]`;

const LIGHT = `
  --jul-editor-diff-surface: #ffffff;
  --jul-editor-diff-text: #1c1c1f;
  --jul-editor-diff-muted: #6b6b73;
  --jul-editor-diff-border: #d9d9de;
  --jul-editor-diff-radius: 6px;
  --jul-editor-diff-insert-bg: #e6f6ee;
  --jul-editor-diff-insert-mark: #b5e6cd;
  --jul-editor-diff-insert-fg: #166a43;
  --jul-editor-diff-delete-bg: #fdeaea;
  --jul-editor-diff-delete-mark: #f7c2c2;
  --jul-editor-diff-delete-fg: #a32a2a;
  --jul-editor-diff-modify: #d9580a;
  --jul-editor-diff-move: #d9580a;
  --jul-editor-diff-format: #6b4fd8;
`;

const DARK = `
  --jul-editor-diff-surface: #111114;
  --jul-editor-diff-text: #f4f4f5;
  --jul-editor-diff-muted: #a1a1aa;
  --jul-editor-diff-border: #34343a;
  --jul-editor-diff-insert-bg: color-mix(in srgb, #32ad72 13%, #111114);
  --jul-editor-diff-insert-mark: color-mix(in srgb, #32ad72 35%, #111114);
  --jul-editor-diff-insert-fg: #54b889;
  --jul-editor-diff-delete-bg: color-mix(in srgb, #e94c4c 13%, #111114);
  --jul-editor-diff-delete-mark: color-mix(in srgb, #e94c4c 35%, #111114);
  --jul-editor-diff-delete-fg: #e97e7e;
  --jul-editor-diff-modify: #f97316;
  --jul-editor-diff-move: #f97316;
  --jul-editor-diff-format: #a78bfa;
`;

const wrap = (sel: string): string => ROOTS.split(",").map((r) => `${sel} ${r}`).join(",");

export const DIFF_CSS = `
:where(${ROOTS}) {${LIGHT}}
@media (prefers-color-scheme: dark) { :where(${ROOTS}):where(:not([data-theme="light"], [data-theme="light"] *)) {${DARK}} }
${wrap(':where([data-theme="dark"], .dark)')} {${DARK}}

:where([data-jul-editor-diff-inline]) { color: var(--jul-editor-diff-text); background: var(--jul-editor-diff-surface); line-height: 1.6; }
:where([data-jul-editor-diff-inline] [data-jul-editor-diff-block]) { position: relative; padding: 4px 10px; margin: 2px 0; border-left: 2px solid transparent; border-radius: var(--jul-editor-diff-radius); overflow-wrap: anywhere; }
:where([data-jul-editor-diff-inline] [data-jul-editor-diff-children]) { margin-left: 20px; }
[data-jul-editor-diff-inline] [data-jul-editor-diff-block][data-diff="insert"] { border-left-color: var(--jul-editor-diff-insert-fg); background: var(--jul-editor-diff-insert-bg); }
[data-jul-editor-diff-inline] [data-jul-editor-diff-block][data-diff="delete"] { border-left-color: var(--jul-editor-diff-delete-fg); background: var(--jul-editor-diff-delete-bg); }
[data-jul-editor-diff-inline] [data-jul-editor-diff-block][data-diff="delete"] > [data-jul-editor-diff-content] { text-decoration: line-through; color: var(--jul-editor-diff-delete-fg); }
[data-jul-editor-diff-inline] [data-jul-editor-diff-block][data-diff="modify"] { border-left-color: var(--jul-editor-diff-modify); }
[data-jul-editor-diff-inline] [data-jul-editor-diff-block][data-diff="move"] { border-left-color: var(--jul-editor-diff-move); background: color-mix(in srgb, var(--jul-editor-diff-move) 8%, transparent); }
[data-jul-editor-diff-inline] [data-diff-move-label] { margin-right: 8px; color: var(--jul-editor-diff-move); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
[data-jul-editor-diff-inline] ins, [data-jul-editor-diff-view] ins { background: var(--jul-editor-diff-insert-mark); color: inherit; text-decoration: none; border-radius: 2px; }
[data-jul-editor-diff-inline] del, [data-jul-editor-diff-view] del { background: var(--jul-editor-diff-delete-mark); color: var(--jul-editor-diff-delete-fg); text-decoration: line-through; border-radius: 2px; }
[data-jul-editor-diff-inline] [data-diff-inline="format"] { border-bottom: 2px dotted var(--jul-editor-diff-format); }
[data-jul-editor-diff-inline] [data-diff-author] { border-bottom: 2px solid var(--jul-editor-diff-author, var(--jul-editor-diff-border)); }
[data-jul-editor-diff-inline] [data-diff-decision="accept"] { background: transparent; }
[data-jul-editor-diff-inline] [data-diff-props] { display: grid; grid-template-columns: auto 1fr 1fr; gap: 4px 10px; margin: 4px 0 0; font-size: 11px; color: var(--jul-editor-diff-muted); }
[data-jul-editor-diff-inline] [data-diff-props] dd { margin: 0; }
[data-jul-editor-diff-inline] [data-diff-props-before] { color: var(--jul-editor-diff-delete-fg); text-decoration: line-through; }
[data-jul-editor-diff-inline] [data-diff-props-after] { color: var(--jul-editor-diff-insert-fg); }

[data-jul-editor-diff-actions], [data-jul-editor-suggestion-toolbar] { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-left: 6px; vertical-align: baseline; font-size: 11px; user-select: none; }
[data-jul-editor-diff-actions] button, [data-jul-editor-suggestion-toolbar] button, [data-jul-editor-diff-toggle] button { font: inherit; padding: 1px 7px; border: 1px solid var(--jul-editor-diff-border); border-radius: 4px; background: var(--jul-editor-diff-surface); color: var(--jul-editor-diff-text); cursor: pointer; }
[data-jul-editor-diff-actions] button[data-action="accept"]:hover { color: var(--jul-editor-diff-insert-fg); border-color: var(--jul-editor-diff-insert-fg); }
[data-jul-editor-diff-actions] button[data-action="reject"]:hover { color: var(--jul-editor-diff-delete-fg); border-color: var(--jul-editor-diff-delete-fg); }
[data-jul-editor-diff-toggle] button[aria-pressed="true"] { border-color: var(--jul-editor-diff-modify); color: var(--jul-editor-diff-modify); }
[data-jul-editor-diff-toggle] { display: inline-flex; gap: 6px; margin-bottom: 8px; }
[data-jul-editor-suggestion-toolbar] { display: flex; margin: 0 0 8px; font-size: 12px; color: var(--jul-editor-diff-muted); }
[data-jul-editor-suggestion-toolbar] [data-spacer] { flex: 1; }
`;
