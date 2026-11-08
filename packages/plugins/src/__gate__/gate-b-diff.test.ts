// Adversarial repros: diff classification + hash equivalence.
import { describe, expect, it } from "vitest";
import { coreRegistry } from "@jul-editor/core";
import type { Block, Doc } from "@jul-editor/core";
import { diffDocs } from "../diff";

const P = (id: string, text: string, children?: Block[]): Block => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text }], ...(children ? { children } : {}) });
const doc = (...blocks: Block[]): Doc => ({ version: 1, blocks });

function collect(nodes: { id: string; status: string; children: unknown[] }[], out: string[] = []): string[] {
  for (const n of nodes) {
    out.push(`${n.id}:${n.status}`);
    collect(n.children as never, out);
  }
  return out;
}

describe("diff", () => {
  it("parent deleted while its child is moved out -> child must be reported once (move), not also deleted", () => {
    const t = diffDocs(doc(P("p", "parent", [P("x", "child")])), doc(P("x", "child")), coreRegistry);
    expect(collect(t.root).filter((s) => s.startsWith("x:"))).toEqual(["x:move"]);
    expect(t.stats).toMatchObject({ deleted: 1, moved: 1 });
  });

  it("existing block moved under a newly inserted parent -> reported as move, not insert", () => {
    const t = diffDocs(doc(P("x", "child")), doc(P("q", "new parent", [P("x", "child")])), coreRegistry);
    expect(collect(t.root)).toContain("x:move");
    expect(t.stats).toMatchObject({ inserted: 1, moved: 1 });
  });

  it("prop changing from number 100 to string '100' must be a modify (hash folds String(v))", () => {
    const img = (width: number | string): Block => ({ id: "i", type: "image", props: { src: "https://x.com/a.png", width } });
    const t = diffDocs(doc(img(100)), doc(img("100")), coreRegistry);
    expect(t.stats.modified).toBe(1);
  });

  it("prop changing from null to the string 'n' must be a modify", () => {
    const c = (range: null | string): Block => ({ id: "c", type: "chart", props: { range } });
    const t = diffDocs(doc(c(null), P("z", "")), doc(c("n"), P("z", "")), coreRegistry);
    expect(t.stats.modified).toBe(1);
  });
});
