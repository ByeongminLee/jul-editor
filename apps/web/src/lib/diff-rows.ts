import type { Doc, Registry } from "@jul-editor/core";
import { toMarkdown } from "@jul-editor/core/serde";

export type CompareRow = { before?: string; after?: string; beforeNo?: number; afterNo?: number; status: "same" | "insert" | "delete" | "modify" };

function lines(doc: Doc, registry?: Registry): string[] {
  const markdown = toMarkdown(doc, { registry }).markdown.replace(/\n$/, "");
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

export function compareRows(before: Doc, after: Doc, registry?: Registry): CompareRow[] {
  const oldLines = lines(before, registry);
  const newLines = lines(after, registry);
  const rows: CompareRow[] = [];
  let oldAt = 0;
  let newAt = 0;
  const appendGap = (oldEnd: number, newEnd: number) => {
    const count = Math.max(oldEnd - oldAt, newEnd - newAt);
    for (let offset = 0; offset < count; offset++) {
      const beforeNo = oldAt + offset < oldEnd ? oldAt + offset + 1 : undefined;
      const afterNo = newAt + offset < newEnd ? newAt + offset + 1 : undefined;
      const oldText = beforeNo === undefined ? undefined : oldLines[beforeNo - 1];
      const newText = afterNo === undefined ? undefined : newLines[afterNo - 1];
      rows.push({ before: oldText, after: newText, beforeNo, afterNo, status: oldText === undefined ? "insert" : newText === undefined ? "delete" : oldText === newText ? "same" : "modify" });
    }
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
