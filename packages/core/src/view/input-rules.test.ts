// Unit tests for the default markdown-shortcut input rules' regex matching +
// resulting store mutation. Pure store/transaction logic, no DOM.

import { describe, expect, it } from "vitest";
import { para, r, storeFrom } from "../store/test-helpers.js";
import { createTransaction } from "../store/transaction.js";
import type { Transaction } from "../store/transaction.js";
import type { EditorState, Point } from "../store/types.js";
import { buildDefaultInputRules, runInputRules } from "./input-rules.js";
import type { InputRuleCtx } from "./input-rules.js";

const defaults = buildDefaultInputRules();

function harness(text: string) {
  let state: EditorState = { store: storeFrom([para("p1", text)]), selection: { type: "text", anchor: { blockId: "p1", offset: text.length }, focus: { blockId: "p1", offset: text.length } } };
  const ctx: InputRuleCtx = {
    get state() {
      return state;
    },
    registry: r,
    dispatch: (build: (tx: Transaction) => Transaction) => {
      const result = build(createTransaction(state, r)).commit();
      state = result.state;
      return result;
    },
  };
  const point: Point = { blockId: "p1", offset: text.length };
  return { ctx, point, current: () => state };
}

describe("buildDefaultInputRules", () => {
  it("'# ' converts to heading level 1 and clears the marker", () => {
    const { ctx, point, current } = harness("# ");
    const result = runInputRules(ctx, point, [], [], defaults);
    expect(result).toEqual({ blockId: "p1", offset: 0 });
    const rec = current().store.records.get("p1")!;
    expect(rec.type).toBe("heading");
    expect(rec.props.level).toBeUndefined(); // default-omitted (level 1 IS the schema default)
    expect(rec.content).toEqual([]);
  });

  it("'### ' converts to heading level 3", () => {
    const { ctx, point, current } = harness("### ");
    runInputRules(ctx, point, [], [], defaults);
    expect(current().store.records.get("p1")!.props.level).toBe(3);
  });

  it("does NOT fire mid-line (only when the marker is the whole line up to the caret)", () => {
    const { ctx, point } = harness("hello # ");
    const result = runInputRules(ctx, point, [], [], defaults);
    expect(result).toBeNull();
  });

  it("'- ' converts to a bulletListItem", () => {
    const { ctx, point, current } = harness("- ");
    runInputRules(ctx, point, [], [], defaults);
    expect(current().store.records.get("p1")!.type).toBe("bulletListItem");
  });

  it("'42. ' converts to an orderedListItem (any leading digits)", () => {
    const { ctx, point, current } = harness("42. ");
    runInputRules(ctx, point, [], [], defaults);
    expect(current().store.records.get("p1")!.type).toBe("orderedListItem");
  });

  it("'[x] ' converts to a checked todoListItem, '[] ' to an unchecked one", () => {
    const checked = harness("[x] ");
    runInputRules(checked.ctx, checked.point, [], [], defaults);
    expect(checked.current().store.records.get("p1")!.props.checked).toBe(true);

    const unchecked = harness("[] ");
    runInputRules(unchecked.ctx, unchecked.point, [], [], defaults);
    expect(unchecked.current().store.records.get("p1")!.props.checked).toBeUndefined(); // false is the default, omitted
  });

  it("'> ' converts to a quote", () => {
    const { ctx, point, current } = harness("> ");
    runInputRules(ctx, point, [], [], defaults);
    expect(current().store.records.get("p1")!.type).toBe("quote");
  });

  it("'---' converts instantly on the default (char) phase -- no Enter needed (Notion)", () => {
    const { ctx, point, current } = harness("---");
    const result = runInputRules(ctx, point, [], [], defaults);
    expect(result).not.toBeNull();
    expect(current().store.records.get("p1")!.type).toBe("divider");
  });

  it("'***' and '___' also convert instantly, but '--' and 'a---' do not", () => {
    for (const text of ["***", "___"]) {
      const h = harness(text);
      runInputRules(h.ctx, h.point, [], [], defaults);
      expect(h.current().store.records.get("p1")!.type).toBe("divider");
    }
    for (const text of ["--", "a---", "-- -"]) {
      const h = harness(text);
      expect(runInputRules(h.ctx, h.point, [], [], defaults)).toBeNull();
      expect(h.current().store.records.get("p1")!.type).toBe("paragraph");
    }
  });

  it("'---' converts to a divider and inserts a following empty paragraph -- the returned point is the NEW paragraph, not the original block", () => {
    const { ctx, point, current } = harness("---");
    const result = runInputRules(ctx, point, [], [], defaults);
    const store = current().store;
    expect(store.records.get("p1")!.type).toBe("divider");
    expect(store.rootIds).toHaveLength(2);
    const nextId = store.rootIds[1]!;
    expect(store.records.get(nextId)!.type).toBe("paragraph");
    expect(result).toEqual({ blockId: nextId, offset: 0 }); // read back from the real post-dispatch selection, not computed from the match
    expect(current().selection).toEqual({ type: "text", anchor: { blockId: nextId, offset: 0 }, focus: { blockId: nextId, offset: 0 } });
  });

  it("inline **bold** applies the bold mark and strips the delimiters -- the returned point is AFTER the marked text, not at offset 0", () => {
    const { ctx, point, current } = harness("**bold**");
    const result = runInputRules(ctx, point, [], [], defaults);
    expect(result).toEqual({ blockId: "p1", offset: 4 }); // right after "bold", read back from the real selection
    expect(current().store.records.get("p1")!.content).toEqual([{ type: "text", text: "bold", marks: [{ type: "bold" }] }]);
  });

  it("inline `code` applies the code mark", () => {
    const { ctx, point, current } = harness("`code`");
    runInputRules(ctx, point, [], [], defaults);
    expect(current().store.records.get("p1")!.content).toEqual([{ type: "text", text: "code", marks: [{ type: "code" }] }]);
  });

  it("inline ~~strike~~ applies the strike mark", () => {
    const { ctx, point, current } = harness("~~strike~~");
    runInputRules(ctx, point, [], [], defaults);
    expect(current().store.records.get("p1")!.content).toEqual([{ type: "text", text: "strike", marks: [{ type: "strike" }] }]);
  });

  it("a custom registered rule is checked before the defaults and can shadow one", () => {
    const { ctx, point, current } = harness("# ");
    const custom = { match: /^# $/, handler: (c: InputRuleCtx) => (c.dispatch((tx) => tx.setType("p1", "quote")), true) };
    runInputRules(ctx, point, [], [custom], defaults);
    expect(current().store.records.get("p1")!.type).toBe("quote"); // custom won, not the default heading rule
  });

  // Extra input rules ---------------------------------------------------------------

  it("p1: '#### ' / '##### ' / '###### ' convert to heading levels 4-6", () => {
    for (const [marker, level] of [
      ["#### ", 4],
      ["##### ", 5],
      ["###### ", 6],
    ] as const) {
      const { ctx, point, current } = harness(marker);
      runInputRules(ctx, point, [], [], defaults);
      expect(current().store.records.get("p1")!.props.level).toBe(level);
    }
  });

  it("p1: '***' and '___' convert to a divider instantly, same as '---'", () => {
    for (const marker of ["***", "___"]) {
      const { ctx, point, current } = harness(marker);
      runInputRules(ctx, point, [], [], defaults);
      expect(current().store.records.get("p1")!.type).toBe("divider");
    }
  });

  it("p1: inline __bold__ applies the bold mark", () => {
    const { ctx, point, current } = harness("__bold__");
    runInputRules(ctx, point, [], [], defaults);
    expect(current().store.records.get("p1")!.content).toEqual([{ type: "text", text: "bold", marks: [{ type: "bold" }] }]);
  });

  it("p1: inline ==highlight== applies the highlight mark", () => {
    const { ctx, point, current } = harness("==highlight==");
    runInputRules(ctx, point, [], [], defaults);
    expect(current().store.records.get("p1")!.content).toEqual([{ type: "text", text: "highlight", marks: [{ type: "highlight" }] }]);
  });

  it("p1: '```' instantly converts to an empty codeBlock, keeping trailing text as code content", () => {
    const { ctx, current } = harness("```hello");
    const point: Point = { blockId: "p1", offset: 3 }; // caret right after the marker, before "hello"
    const result = runInputRules(ctx, point, [], [], defaults);
    const rec = current().store.records.get("p1")!;
    expect(rec.type).toBe("codeBlock");
    expect(rec.content).toEqual([{ type: "text", text: "hello" }]);
    expect(result).toEqual({ blockId: "p1", offset: 0 });
  });

  it("p1: typing a URL then a space autolinks it, keeping the trailing space untouched", () => {
    const { ctx, point, current } = harness("see https://example.com ");
    runInputRules(ctx, point, [], [], defaults);
    const content = current().store.records.get("p1")!.content!;
    const linked = content.find((inl) => "text" in inl && (inl as { text: string }).text === "https://example.com");
    expect(linked).toEqual({ type: "text", text: "https://example.com", marks: [{ type: "link", attrs: { href: "https://example.com" } }] });
    expect(current().selection).toEqual({ type: "text", anchor: { blockId: "p1", offset: 24 }, focus: { blockId: "p1", offset: 24 } });
  });

  it("p1: a 'www.' URL autolinks with an https:// href while keeping the typed text as-is", () => {
    const { ctx, point, current } = harness("see www.example.com ");
    runInputRules(ctx, point, [], [], defaults);
    const content = current().store.records.get("p1")!.content!;
    const linked = content.find((inl) => "text" in inl && (inl as { text: string }).text === "www.example.com");
    expect(linked).toEqual({ type: "text", text: "www.example.com", marks: [{ type: "link", attrs: { href: "https://www.example.com" } }] });
  });
});
