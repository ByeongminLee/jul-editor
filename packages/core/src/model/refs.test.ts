import { describe, expect, it } from "vitest";
import { collectRefs } from "./refs.js";
import type { Doc } from "./types.js";

describe("collectRefs", () => {
  it("collects mention refs with their kind", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        {
          id: "p1",
          type: "paragraph",
          props: {},
          content: [
            { type: "text", text: "hi " },
            { type: "mention", attrs: { kind: "user", id: "u1", label: "Alice" } },
          ],
        },
      ],
    };
    expect(collectRefs(doc)).toEqual([{ blockId: "p1", kind: "user", id: "u1" }]);
  });

  it("collects image asset refs", () => {
    const doc: Doc = {
      version: 1,
      blocks: [{ id: "img1", type: "image", props: { src: "x", alt: "y", assetId: "asset-1" } }],
    };
    expect(collectRefs(doc)).toEqual([{ blockId: "img1", kind: "asset", id: "asset-1" }]);
  });

  it("ignores images without an assetId", () => {
    const doc: Doc = { version: 1, blocks: [{ id: "img1", type: "image", props: { src: "x", alt: "y" } }] };
    expect(collectRefs(doc)).toEqual([]);
  });

  it("collects chart/diagram/dataTable view refs", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        { id: "c1", type: "chart", props: { source: { type: "view", viewId: "v1" } } },
        { id: "d1", type: "diagram", props: { code: "", source: { type: "view", viewId: "v2" } } },
        { id: "dt1", type: "dataTable", props: { source: { type: "view", viewId: "v3" } } },
      ],
    };
    expect(collectRefs(doc)).toEqual([
      { blockId: "c1", kind: "view", id: "v1" },
      { blockId: "d1", kind: "view", id: "v2" },
      { blockId: "dt1", kind: "view", id: "v3" },
    ]);
  });

  it("ignores inline chart sources (no view ref)", () => {
    const doc: Doc = {
      version: 1,
      blocks: [{ id: "c1", type: "chart", props: { source: { type: "inline", csv: "a,b\n1,2" } } }],
    };
    expect(collectRefs(doc)).toEqual([]);
  });

  it("recurses into nested children", () => {
    const doc: Doc = {
      version: 1,
      blocks: [
        {
          id: "li1",
          type: "bulletListItem",
          props: {},
          content: [],
          children: [
            {
              id: "li2",
              type: "bulletListItem",
              props: {},
              content: [{ type: "mention", attrs: { kind: "post", id: "p1", label: "Post" } }],
            },
          ],
        },
      ],
    };
    expect(collectRefs(doc)).toEqual([{ blockId: "li2", kind: "post", id: "p1" }]);
  });
});
