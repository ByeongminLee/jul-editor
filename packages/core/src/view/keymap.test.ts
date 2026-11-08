// Unit tests for the combo-string normalization ("'Mod' = Meta on
// mac, Ctrl elsewhere") and the block-level-then-priority-ordered dispatch
// chain. Pure logic, no DOM (comboFromEvent/dispatchKeymap take plain objects).

import { describe, expect, it } from "vitest";
import { comboFromEvent, dispatchKeymap, isMac } from "./keymap.js";
import type { Keymap, KeymapCtx, KeymapEntry } from "./keymap.js";

function fakeEvent(over: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) {
  return { key: "a", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over };
}

describe("isMac", () => {
  it("true for a mac platform string", () => {
    expect(isMac({ platform: "MacIntel" })).toBe(true);
  });
  it("false for a non-mac platform string", () => {
    expect(isMac({ platform: "Win32" })).toBe(false);
    expect(isMac({ platform: "Linux x86_64" })).toBe(false);
  });
});

describe("comboFromEvent", () => {
  it("'Mod' = Meta on mac", () => {
    expect(comboFromEvent(fakeEvent({ key: "b", metaKey: true }), true)).toBe("Mod-b");
    expect(comboFromEvent(fakeEvent({ key: "b", ctrlKey: true }), true)).toBe("b"); // ctrl on mac is NOT Mod
  });
  it("'Mod' = Ctrl elsewhere", () => {
    expect(comboFromEvent(fakeEvent({ key: "b", ctrlKey: true }), false)).toBe("Mod-b");
    expect(comboFromEvent(fakeEvent({ key: "b", metaKey: true }), false)).toBe("b");
  });
  it("fixed Mod-Shift-Alt-key order, single-char key lowercased", () => {
    expect(comboFromEvent(fakeEvent({ key: "B", ctrlKey: true, shiftKey: true, altKey: true }), false)).toBe("Mod-Shift-Alt-b");
  });
  it("named keys keep their own casing", () => {
    expect(comboFromEvent(fakeEvent({ key: "Tab", shiftKey: true }), false)).toBe("Shift-Tab");
    expect(comboFromEvent(fakeEvent({ key: "ArrowUp", ctrlKey: true, shiftKey: true }), false)).toBe("Mod-Shift-ArrowUp");
    expect(comboFromEvent(fakeEvent({ key: "Enter" }), false)).toBe("Enter");
  });
});

describe("dispatchKeymap", () => {
  const ctx = {} as KeymapCtx; // handlers below ignore ctx entirely

  it("block-level keymap runs before ANY registered entry, regardless of priority", () => {
    const log: string[] = [];
    const blockKeymap: Keymap = { "Mod-b": () => (log.push("block"), true) };
    const entries: KeymapEntry[] = [{ keymap: { "Mod-b": () => (log.push("registered"), true) }, priority: 1000 }];
    const handled = dispatchKeymap("Mod-b", ctx, blockKeymap, entries);
    expect(handled).toBe(true);
    expect(log).toEqual(["block"]);
  });

  it("registered entries run in descending priority order, first handled wins", () => {
    const log: string[] = [];
    const entries: KeymapEntry[] = [
      { keymap: { "Mod-b": () => (log.push("low"), true) }, priority: 1 },
      { keymap: { "Mod-b": () => (log.push("high"), true) }, priority: 10 },
      { keymap: { "Mod-b": () => (log.push("mid"), true) }, priority: 5 },
    ];
    dispatchKeymap("Mod-b", ctx, undefined, entries);
    expect(log).toEqual(["high"]);
  });

  it("falls through to a lower-priority entry when a higher one returns false (not its combo)", () => {
    const log: string[] = [];
    const entries: KeymapEntry[] = [
      { keymap: { "Mod-i": () => (log.push("high-but-wrong-key"), true) }, priority: 10 },
      { keymap: { "Mod-b": () => (log.push("default"), true) }, priority: -Infinity },
    ];
    const handled = dispatchKeymap("Mod-b", ctx, undefined, entries);
    expect(handled).toBe(true);
    expect(log).toEqual(["default"]);
  });

  it("returns false when nothing matches", () => {
    expect(dispatchKeymap("Mod-z", ctx, undefined, [])).toBe(false);
  });
});
