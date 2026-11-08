// THE one allowlisted inline-style file for @jul-editor/core (headless = zero CSS files; inline styles are forbidden
// everywhere in packages/core and packages/react except these 3 functional
// styles on the editable root). Without them:
//  - no `white-space: pre-wrap` -> a lone/trailing space collapses visually,
//    so `insertText(' ')` looks like nothing happened.
//  - no `word-break: break-word` -> a long unbroken token (URL, CJK run)
//    overflows instead of wrapping.
//  - no `user-select: text` -> an ancestor's `user-select: none` (common in
//    app shells) can silently block text selection inside the editor.
// Do not add a 4th style here or anywhere else in packages/core/src.
export function applyRootStyle(root: HTMLElement): void {
  root.style.whiteSpace = "pre-wrap";
  root.style.wordBreak = "break-word";
  root.style.userSelect = "text";
}
