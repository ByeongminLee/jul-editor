// Tab/Shift-Tab inside the code workspace's plain <textarea>: without this
// the browser's default Tab moves focus out of the editor entirely (to the
// next focusable element on the page). Mirrors core's codeBlock Tab keymap:
// two spaces per step, a collapsed caret indents at the caret, a range
// indents/outdents every line it touches.

export const CODE_INDENT = "  ";

export interface IndentResult {
  value: string;
  start: number;
  end: number;
}

/** Returns the new textarea value and selection, or null when the key should
 * still be swallowed but nothing changes (Shift-Tab with nothing to remove). */
export function indentCodeText(value: string, start: number, end: number, dir: 1 | -1): IndentResult | null {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  if (dir === 1 && from === to) {
    return { value: value.slice(0, from) + CODE_INDENT + value.slice(to), start: from + CODE_INDENT.length, end: from + CODE_INDENT.length };
  }
  // a range ending right at a line's own start does not touch that line.
  const lastOffset = to > from && value[to - 1] === "\n" ? to - 1 : to;
  const starts: number[] = [];
  let lineStart = from === 0 ? 0 : value.lastIndexOf("\n", from - 1) + 1;
  while (lineStart <= lastOffset) {
    starts.push(lineStart);
    const nl = value.indexOf("\n", lineStart);
    if (nl < 0 || nl >= lastOffset) break;
    lineStart = nl + 1;
  }
  const edits = starts.map((s) => {
    if (dir === 1) return { start: s, remove: 0 };
    if (value[s] === "\t") return { start: s, remove: 1 };
    let n = 0;
    while (n < CODE_INDENT.length && value[s + n] === " ") n++;
    return { start: s, remove: n };
  });
  if (dir === -1 && edits.every((ed) => ed.remove === 0)) return null;
  const shift = (offset: number) => {
    let delta = 0;
    for (const ed of edits) {
      if (dir === 1) {
        if (ed.start <= offset) delta += CODE_INDENT.length;
      } else if (ed.start < offset) {
        delta -= Math.min(ed.remove, offset - ed.start);
      }
    }
    return offset + delta;
  };
  let next = value;
  for (const ed of [...edits].reverse()) {
    next = dir === 1 ? next.slice(0, ed.start) + CODE_INDENT + next.slice(ed.start) : next.slice(0, ed.start) + next.slice(ed.start + ed.remove);
  }
  return { value: next, start: shift(start), end: shift(end) };
}
