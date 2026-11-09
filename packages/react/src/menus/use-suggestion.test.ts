// Unit tests for useSuggestion's own logic: async race protection,
// keyboard nav, and the Tab-select-by-default / onTab-override seam. Mocks
// `../hooks.js`'s useEditor so these run against a fake core editor -- no
// real DOM/view pipeline needed, since notifyTextChange (what actually opens
// a suggestion in a real browser) is core's job, already covered by
// packages/core/src/view/suggestion.ts's own tests + this task's e2e specs.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSuggestion } from "./use-suggestion.js";

interface FakeConfig {
  char: string;
  onUpdate(state: { open: boolean; query: string; range: { blockId: string; from: number; to: number } | null; rect: null }): void;
  onKey?(e: { key: string }): boolean;
}

let captured: FakeConfig | null = null;
const closeSuggestion = vi.fn();
const registerSuggestion = vi.fn((config: FakeConfig) => {
  captured = config;
  return { closeSuggestion, replaceRange: vi.fn(), destroy: vi.fn() };
});

vi.mock("../hooks.js", () => ({
  useEditor: () => ({ registerSuggestion }),
}));

function openWith(range = { blockId: "b1", from: 0, to: 1 }) {
  captured!.onUpdate({ open: true, query: "", range, rect: null });
}

beforeEach(() => {
  registerSuggestion.mockClear();
  closeSuggestion.mockClear();
  captured = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSuggestion", () => {
  it("keyboard nav: ArrowDown/ArrowUp move activeIndex, Enter selects it", async () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    // `items` MUST be stable across re-renders (memoized, like SlashMenu/
    // MentionMenu's own useCallback) -- an inline arrow recreated on every
    // render would retrigger the fetch effect (it's a deliberate dependency,
    // e.g. MentionMenu's Tab-toggle-kind refetch) every time its own result
    // lands, which is its own infinite render loop, not a bug in the hook.
    const items = () => ["a", "b", "c"];
    const { result } = renderHook(() => useSuggestion({ char: "/", items, onSelect }));

    act(() => openWith());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.items).toEqual(["a", "b", "c"]);

    act(() => {
      captured!.onKey!({ key: "ArrowDown" });
      captured!.onKey!({ key: "ArrowDown" });
    });
    expect(result.current.activeIndex).toBe(2);

    act(() => {
      captured!.onKey!({ key: "Enter" });
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toBe("c");
    expect(closeSuggestion).toHaveBeenCalled();
  });

  it("Tab selects the active item by default, but defers to onTab when provided", async () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const onTab = vi.fn();
    const items = () => ["x"];

    const { unmount: unmount1 } = renderHook(() => useSuggestion({ char: "@", items, onSelect }));
    act(() => openWith());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    act(() => {
      captured!.onKey!({ key: "Tab" });
    });
    expect(onSelect).toHaveBeenCalledTimes(1); // no onTab -> Tab behaves like Enter
    unmount1();

    renderHook(() => useSuggestion({ char: "@", items, onSelect, onTab }));
    act(() => openWith());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    act(() => {
      captured!.onKey!({ key: "Tab" });
    });
    expect(onTab).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1); // still just the earlier call -- onTab suppressed selection
  });

  it("Escape closes without selecting", async () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const items = () => ["a"];
    renderHook(() => useSuggestion({ char: "/", items, onSelect }));
    act(() => openWith());
    act(() => {
      captured!.onKey!({ key: "Escape" });
    });
    expect(closeSuggestion).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("async race: a stale (slower) earlier request never overwrites a newer, faster one", async () => {
    vi.useFakeTimers();
    const resolvers = new Map<string, (items: string[]) => void>();
    const items = vi.fn((query: string) => new Promise<string[]>((resolve) => resolvers.set(query, resolve)));
    const { result } = renderHook(() => useSuggestion({ char: "/", items, onSelect: vi.fn() }));

    act(() => openWith());
    // First query "" fires its debounce timer (100ms), items("") is now pending.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(items).toHaveBeenCalledWith("");

    // User keeps typing -- a newer query "ab" supersedes it before "" resolves.
    act(() => {
      captured!.onUpdate({ open: true, query: "ab", range: { blockId: "b1", from: 0, to: 2 }, rect: null });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(items).toHaveBeenCalledWith("ab");

    // Resolve OUT OF ORDER: the newer "ab" request resolves first, then the
    // stale "" one arrives late -- it must be dropped, not overwrite "ab"'s result.
    await act(async () => {
      resolvers.get("ab")!(["AB"]);
    });
    expect(result.current.items).toEqual(["AB"]);

    await act(async () => {
      resolvers.get("")!(["EMPTY"]); // stale, must be ignored
    });
    expect(result.current.items).toEqual(["AB"]);
  });
});

describe("useSuggestion: empty results and scrolling", () => {
  it("Enter with no matching items closes the menu and is not consumed", async () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const items = () => [] as string[];
    renderHook(() => useSuggestion({ char: "/", items, onSelect }));
    act(() => openWith());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    let handled = true;
    act(() => {
      handled = captured!.onKey!({ key: "Enter" });
    });
    expect(handled).toBe(false);
    expect(closeSuggestion).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("a re-emit with the same query (scroll) keeps the highlighted item", async () => {
    vi.useFakeTimers();
    const items = () => ["a", "b", "c"];
    const { result } = renderHook(() => useSuggestion({ char: "/", items, onSelect: vi.fn() }));
    act(() => openWith());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    act(() => {
      captured!.onKey!({ key: "ArrowDown" });
    });
    expect(result.current.activeIndex).toBe(1);
    act(() => openWith());
    expect(result.current.activeIndex).toBe(1);
  });

  it("arrow navigation scrolls the active option into view", async () => {
    vi.useFakeTimers();
    const items = () => ["a", "b"];
    const { result } = renderHook(() => useSuggestion({ char: "/", items, onSelect: vi.fn() }));
    act(() => openWith());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const option = document.createElement("div");
    option.id = result.current.getOptionProps(1).id;
    const scrollIntoView = vi.fn();
    option.scrollIntoView = scrollIntoView;
    document.body.appendChild(option);
    act(() => {
      captured!.onKey!({ key: "ArrowDown" });
    });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    option.remove();
  });

  it("Enter pressed before the debounce lands picks from the current query (sync source)", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const items = (q: string) => ["chart", "code"].filter((x) => x.startsWith(q));
    renderHook(() => useSuggestion({ char: "/", items, onSelect }));
    act(() => openWith());
    act(() => captured!.onUpdate({ open: true, query: "ch", range: { blockId: "b1", from: 0, to: 3 }, rect: null }));
    let handled = false;
    act(() => {
      handled = captured!.onKey!({ key: "Enter" });
    });
    expect(handled).toBe(true);
    expect(onSelect.mock.calls[0]?.[0]).toBe("chart");
  });

  it("Enter while an async source is still loading is held, not lost to a newline", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const items = () => new Promise<string[]>(() => {});
    renderHook(() => useSuggestion({ char: "@", items, onSelect }));
    act(() => openWith());
    let handled = false;
    act(() => {
      handled = captured!.onKey!({ key: "Enter" });
    });
    expect(handled).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    expect(closeSuggestion).not.toHaveBeenCalled();
  });
});
