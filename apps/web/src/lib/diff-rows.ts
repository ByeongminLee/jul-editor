import type { Doc, Registry } from "@jul-editor/core";
import { toMarkdown } from "@jul-editor/core/serde";
import { canonicalDoc } from "./doc-reconcile.js";

export type CompareRow = { before?: string; after?: string; beforeNo?: number; afterNo?: number; status: "same" | "insert" | "delete" | "modify" };

function lines(doc: Doc, registry?: Registry): string[] {
  // Both sides go through the editor's own normalization, so a default prop written out in one
  // document and omitted in the other does not show up as a change.
  const markdown = toMarkdown(registry ? canonicalDoc(doc, registry) : doc, { registry }).markdown.replace(/\n$/, "");
  return markdown ? markdown.split("\n") : [];
}

function counts(values: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

/** Unique unchanged lines anchor the two independent source orders in O(n log n). */
function anchors(before: string[], after: string[]): Array<[number, number]> {
  const beforeCounts = counts(before);
  const afterCounts = counts(after);
  const afterPositions = new Map(after.map((line, index) => [line, index]));
  const candidates: Array<[number, number]> = [];
  before.forEach((line, index) => {
    const afterIndex = afterPositions.get(line);
    if (afterIndex !== undefined && beforeCounts.get(line) === 1 && afterCounts.get(line) === 1) candidates.push([index, afterIndex]);
  });
  const tails: number[] = [];
  const previous = new Array<number>(candidates.length).fill(-1);
  candidates.forEach(([, afterIndex], index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (candidates[tails[middle]!]![1] < afterIndex) low = middle + 1;
      else high = middle;
    }
    if (low) previous[index] = tails[low - 1]!;
    if (low === tails.length) tails.push(index);
    else tails[low] = index;
  });
  const result: Array<[number, number]> = [];
  for (let index = tails.at(-1) ?? -1; index !== -1; index = previous[index]!) result.push(candidates[index]!);
  return result.reverse();
}

const blank = (line: string) => line.trim() === "";

/** Edit script for one gap between anchors: equal lines stay "same", the rest are deletes and inserts. */
function gapScript(before: string[], after: string[]): Array<"same" | "delete" | "insert"> {
  const n = before.length;
  const m = after.length;
  if (n * m > 1_000_000) return [...before.map(() => "delete" as const), ...after.map(() => "insert" as const)];
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) table[i]![j] = before[i] === after[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  }
  const script: Array<"same" | "delete" | "insert"> = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) { script.push("same"); i++; j++; }
    else if (j >= m || (i < n && table[i + 1]![j]! >= table[i]![j + 1]!)) { script.push("delete"); i++; }
    else { script.push("insert"); j++; }
  }
  return script;
}

export function compareRows(before: Doc, after: Doc, registry?: Registry): CompareRow[] {
  const oldLines = lines(before, registry);
  const newLines = lines(after, registry);
  const rows: CompareRow[] = [];
  let oldAt = 0;
  let newAt = 0;
  const appendGap = (oldEnd: number, newEnd: number) => {
    const script = gapScript(oldLines.slice(oldAt, oldEnd), newLines.slice(newAt, newEnd));
    let deleted: number[] = [];
    let inserted: number[] = [];
    // A run of deleted lines next to a run of inserted lines reads as edits, side by side.
    // A blank line is never paired with content: that is a moved or added line, not an edit.
    const flush = () => {
      const count = Math.max(deleted.length, inserted.length);
      for (let offset = 0; offset < count; offset++) {
        const beforeNo = deleted[offset];
        const afterNo = inserted[offset];
        const oldText = beforeNo === undefined ? undefined : oldLines[beforeNo - 1]!;
        const newText = afterNo === undefined ? undefined : newLines[afterNo - 1]!;
        if (oldText !== undefined && newText !== undefined && !blank(oldText) && !blank(newText)) rows.push({ before: oldText, after: newText, beforeNo, afterNo, status: "modify" });
        else {
          if (oldText !== undefined) rows.push({ before: oldText, beforeNo, status: "delete" });
          if (newText !== undefined) rows.push({ after: newText, afterNo, status: "insert" });
        }
      }
      deleted = [];
      inserted = [];
    };
    for (const step of script) {
      if (step === "delete") { deleted.push(++oldAt); continue; }
      if (step === "insert") { inserted.push(++newAt); continue; }
      flush();
      oldAt++;
      newAt++;
      rows.push({ before: oldLines[oldAt - 1], after: newLines[newAt - 1], beforeNo: oldAt, afterNo: newAt, status: "same" });
    }
    flush();
    oldAt = oldEnd;
    newAt = newEnd;
  };
  for (const [oldIndex, newIndex] of [...anchors(oldLines, newLines), [oldLines.length, newLines.length] as [number, number]]) {
    appendGap(oldIndex, newIndex);
    if (oldIndex === oldLines.length) break;
    rows.push({ before: oldLines[oldIndex], after: newLines[newIndex], beforeNo: oldIndex + 1, afterNo: newIndex + 1, status: "same" });
    oldAt = oldIndex + 1;
    newAt = newIndex + 1;
  }
  return rows;
}
