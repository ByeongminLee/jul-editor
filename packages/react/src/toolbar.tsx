// <Editor.Toolbar> + the button atoms. Every atom is a thin `useActiveMarks`/
// `useBlockType` + `useCommands` subscriber -- all editing behavior is a
// single existing core command call (toggleMark/setBlockType/undo/redo); the
// button only decides *when* to call it (nothing in React adds
// editing behavior; it only wraps core). className passthrough only, no
// inline styles, no CSS.

import type { Editor as CoreEditor, Json } from "@jul-editor/core";
import type { ComponentPropsWithoutRef, KeyboardEvent, MouseEvent } from "react";
import { createContext, forwardRef, useContext, useEffect, useRef } from "react";
import { LabelsContext, useEditorContext } from "./context.js";
import { Slot, mergeRefs } from "./slot.js";
import { useActiveMarks, useBlockType, useCanApplyMarks, useCommands, useEditor, useEditorState } from "./hooks.js";
import type { Labels } from "./labels.js";

export interface ToolbarClassNames { container?: string; button?: string; text?: string }
const ToolbarClassesContext = /* @__PURE__ */ createContext<ToolbarClassNames>({});
function useToolbarClasses(className?: string) {
  const classes = useContext(ToolbarClassesContext);
  return { button: [classes.button, className].filter(Boolean).join(" ") || undefined, text: classes.text };
}

const TOOLBAR_ITEM_ATTR = "data-jul-editor-toolbar-item";
const toolbarItemAttrs = { [TOOLBAR_ITEM_ATTR]: "" };
const toolbarItems = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(`button, [${TOOLBAR_ITEM_ATTR}]`)).filter((item) => { const panel = item.closest("form, [role=dialog], [role=menu], [role=listbox]"); return !panel || !container.contains(panel); });
const enabledToolbarItems = (container: HTMLElement) => toolbarItems(container).filter((item) => !item.matches(":disabled, [aria-disabled='true']"));

export interface ToolbarButtonProps extends Omit<ComponentPropsWithoutRef<"button">, "type"> {
  asChild?: boolean;
}

// A pointer click on a toolbar button must not take focus away from the
// editor: the next keystroke (typing after Bold, after H1) has to land in
// the document. mousedown's default action is what moves focus, so it is
// prevented (the consumer's own onMouseDown still runs first and can opt
// out by preventing nothing -- we only skip when THEY already prevented).
export function handleMouseDown(userOnMouseDown?: (e: MouseEvent<HTMLButtonElement>) => void) {
  return (e: MouseEvent<HTMLButtonElement>) => {
    userOnMouseDown?.(e);
    if (e.button === 0) e.preventDefault();
  };
}

// If the editor still was not focused (focus sat elsewhere, e.g. the
// toolbar after a Tab), a pointer click hands focus back to the editor at
// its current model selection so typing continues there. A keyboard
// activation (Enter/Space on a roving-focus item, e.detail === 0) keeps
// focus in the toolbar, per the WAI-ARIA toolbar pattern.
function refocusEditor(editor: CoreEditor | null): void {
  if (!editor) return;
  const root = editor.getRoot();
  const doc = root.ownerDocument;
  if (root.contains(doc.activeElement)) return;
  const selection = editor.getState().selection;
  if (!selection) return;
  root.focus({ preventScroll: true });
  // focus() alone may drop the caret at the root's start; re-applying the
  // model selection writes it back to the DOM (no history entry).
  editor.update((tx) => tx.setSelection(selection));
}

export function handleClick(editor: CoreEditor | null, onCommand: () => void, userOnClick?: (e: MouseEvent<HTMLButtonElement>) => void) {
  return (e: MouseEvent<HTMLButtonElement>) => {
    userOnClick?.(e);
    if (e.defaultPrevented) return;
    onCommand();
    if (e.detail > 0) refocusEditor(editor);
  };
}

// `labelKey` is read from context (not baked in at module-eval time
// like the old plain `defaultLabel` string), so the same exported component
// picks up `<Editor locale>`/`<Editor labels>` at render -- both the visible
// fallback text (`children ?? ...`) AND a real `aria-label` (so a consumer
// overriding `children` with e.g. an icon still gets a localized accessible
// name, unless THEY also pass their own `aria-label`).
function createToggleButton(markType: string, labelKey: keyof Labels) {
  return forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarMarkButton({ asChild, children, onClick, onMouseDown, className, "aria-label": ariaLabel, ...props }, ref) {
    const marks = useActiveMarks();
    const canApply = useCanApplyMarks();
    const editor = useEditor();
    const commands = useCommands();
    useEditorContext("Editor.Toolbar");
    const label = useContext(LabelsContext)[labelKey];
    const active = marks.has(markType);
    const classes = useToolbarClasses(className);
    const Comp = (asChild ? Slot : "button") as "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : "button"}
        aria-pressed={active}
        aria-label={ariaLabel ?? label}
        data-active={active ? "" : undefined}
        disabled={!canApply}
        {...toolbarItemAttrs}
        onMouseDown={handleMouseDown(onMouseDown)}
        onClick={handleClick(editor, () => commands.toggleMark(markType), onClick)}
        {...props} className={classes.button}
      >
        {children ?? (classes.text ? <span className={classes.text}>{label}</span> : label)}
      </Comp>
    );
  });
}

export const EditorBold = /* @__PURE__ */ createToggleButton("bold", "toolbarBold");
export const EditorItalic = /* @__PURE__ */ createToggleButton("italic", "toolbarItalic");
export const EditorStrike = /* @__PURE__ */ createToggleButton("strike", "toolbarStrike");
export const EditorCode = /* @__PURE__ */ createToggleButton("code", "toolbarCode");
// Same createToggleButton factory as Bold/Italic/Strike/Code above --
// underline/subscript/superscript are plain marks with no attrs, so nothing
// else is needed.
export const EditorUnderline = /* @__PURE__ */ createToggleButton("underline", "toolbarUnderline");
export const EditorSubscript = /* @__PURE__ */ createToggleButton("subscript", "toolbarSubscript");
export const EditorSuperscript = /* @__PURE__ */ createToggleButton("superscript", "toolbarSuperscript");

export const EditorLink = /* @__PURE__ */ forwardRef<HTMLButtonElement, ToolbarButtonProps>(function EditorLink({ asChild, children, onClick, onMouseDown, className, "aria-label": ariaLabel, ...props }, ref) {
  const marks = useActiveMarks();
  const canApply = useCanApplyMarks();
  const editor = useEditor();
  const commands = useCommands();
  useEditorContext("Editor.Toolbar");
  const label = useContext(LabelsContext).toolbarLink;
  const active = marks.has("link");
  const classes = useToolbarClasses(className);
  const Comp = (asChild ? Slot : "button") as "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : "button"}
      aria-pressed={active}
      aria-label={ariaLabel ?? label}
      data-active={active ? "" : undefined}
      disabled={!canApply}
      {...toolbarItemAttrs}
      onMouseDown={handleMouseDown(onMouseDown)}
      onClick={handleClick(editor, () => {
        if (active) {
          commands.toggleMark("link");
          return;
        }
        // Window.prompt for the URL -- a real app should override
        // via asChild/its own onClick and call useCommands().toggleMark
        // ("link", { href }) itself with its own link-entry UI.
        const href = typeof window !== "undefined" ? window.prompt("Link URL") : null;
        if (href) commands.toggleMark("link", { href });
      }, onClick)}
      {...props} className={classes.button}
    >
      {children ?? (classes.text ? <span className={classes.text}>{label}</span> : label)}
    </Comp>
  );
});

function createBlockTypeButton(blockType: string, labelKey: keyof Labels, extraProps?: Record<string, Json>) {
  return forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarBlockButton({ asChild, children, onClick, onMouseDown, className, "aria-label": ariaLabel, ...props }, ref) {
    const currentType = useBlockType();
    const editor = useEditor();
    const commands = useCommands();
    useEditorContext("Editor.Toolbar");
    const label = useContext(LabelsContext)[labelKey];
    const active = currentType === blockType;
    const classes = useToolbarClasses(className);
    const Comp = (asChild ? Slot : "button") as "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : "button"}
        aria-pressed={active}
        aria-label={ariaLabel ?? label}
        data-active={active ? "" : undefined}
        {...toolbarItemAttrs}
        onMouseDown={handleMouseDown(onMouseDown)}
        // Clicking the pressed button toggles the block back to a paragraph
        // (same as every mainstream editor's H1/list/quote buttons).
        onClick={handleClick(editor, () => (active ? commands.setBlockType("paragraph") : commands.setBlockType(blockType, extraProps)), onClick)}
        {...props} className={classes.button}
      >
        {children ?? (classes.text ? <span className={classes.text}>{label}</span> : label)}
      </Comp>
    );
  });
}

export const EditorBulletList = /* @__PURE__ */ createBlockTypeButton("bulletListItem", "toolbarBulletList");
export const EditorOrderedList = /* @__PURE__ */ createBlockTypeButton("orderedListItem", "toolbarOrderedList");
export const EditorTodoList = /* @__PURE__ */ createBlockTypeButton("todoListItem", "toolbarTodoList");
export const EditorQuote = /* @__PURE__ */ createBlockTypeButton("quote", "toolbarQuote");
export const EditorCodeBlock = /* @__PURE__ */ createBlockTypeButton("codeBlock", "toolbarCodeBlock");

export interface HeadingButtonProps extends ToolbarButtonProps {
  level?: 1 | 2 | 3 | 4 | 5 | 6;
}

function useCurrentHeadingLevel(): number | null {
  const ctx = useEditorContext("Editor.Heading");
  return useEditorState(() => {
    const block = ctx.store.getEditor()?.getBlockType();
    return block?.type === "heading" ? Number(block.props.level ?? 1) : null;
  });
}

export const EditorHeading = /* @__PURE__ */ forwardRef<HTMLButtonElement, HeadingButtonProps>(function EditorHeading(
  { asChild, children, onClick, onMouseDown, className, level = 1, "aria-label": ariaLabel, ...props },
  ref,
) {
  const currentType = useBlockType();
  const currentLevel = useCurrentHeadingLevel();
  const editor = useEditor();
  const commands = useCommands();
  useEditorContext("Editor.Toolbar");
  const label = `${useContext(LabelsContext).toolbarHeadingWord} ${level}`;
  const active = currentType === "heading" && currentLevel === level;
  const classes = useToolbarClasses(className);
  const Comp = (asChild ? Slot : "button") as "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : "button"}
      aria-pressed={active}
      aria-label={ariaLabel ?? label}
      data-active={active ? "" : undefined}
      {...toolbarItemAttrs}
      onMouseDown={handleMouseDown(onMouseDown)}
      onClick={handleClick(editor, () => (active ? commands.setBlockType("paragraph") : commands.setBlockType("heading", { level })), onClick)}
      {...props} className={classes.button}
    >
      {children ?? (classes.text ? <span className={classes.text}>{label}</span> : label)}
    </Comp>
  );
});

function createHistoryButton(run: (commands: ReturnType<typeof useCommands>) => void, labelKey: keyof Labels) {
  return forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarHistoryButton({ asChild, children, onClick, onMouseDown, className, "aria-label": ariaLabel, ...props }, ref) {
    const editor = useEditor();
    const commands = useCommands();
    useEditorContext("Editor.Toolbar");
    const label = useContext(LabelsContext)[labelKey];
    const classes = useToolbarClasses(className);
    const Comp = (asChild ? Slot : "button") as "button";
    return (
      <Comp ref={ref} type={asChild ? undefined : "button"} aria-label={ariaLabel ?? label} {...toolbarItemAttrs} onMouseDown={handleMouseDown(onMouseDown)} onClick={handleClick(editor, () => run(commands), onClick)} {...props} className={classes.button}>
        {children ?? (classes.text ? <span className={classes.text}>{label}</span> : label)}
      </Comp>
    );
  });
}

export const EditorUndo = /* @__PURE__ */ createHistoryButton((commands) => commands.undo(), "toolbarUndo");
export const EditorRedo = /* @__PURE__ */ createHistoryButton((commands) => commands.redo(), "toolbarRedo");

export interface EditorToolbarProps extends Omit<ComponentPropsWithoutRef<"div">, "className"> { className?: string | ToolbarClassNames }

/** role=toolbar with arrow-key roving focus (WAI-ARIA toolbar pattern): one
 * item at a time is tab-stoppable (tabindex=0), ArrowLeft/Right/Home/End move
 * which one, driven imperatively off the DOM (no per-child cooperation
 * needed, works with any children incl. asChild-rendered ones). */
export const EditorToolbar = /* @__PURE__ */ forwardRef<HTMLDivElement, EditorToolbarProps>(function EditorToolbar(
  { children, onKeyDown, className, "aria-label": ariaLabel, ...props },
  ref,
) {
  useEditorContext("Editor.Toolbar");
  const labels = useContext(LabelsContext);
  const localRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    const preventDisabledFocus = (event: globalThis.MouseEvent | PointerEvent) => {
      if (event.button === 0 && event.target instanceof Element && event.target.closest(":disabled")) event.preventDefault();
    };
    el.addEventListener("pointerdown", preventDisabledFocus, true);
    el.addEventListener("mousedown", preventDisabledFocus, true);
    return () => { el.removeEventListener("pointerdown", preventDisabledFocus, true); el.removeEventListener("mousedown", preventDisabledFocus, true); };
  }, []);

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    const items = toolbarItems(el);
    const enabled = enabledToolbarItems(el);
    // Runs after every render, so it must not undo onToolbarKeyDown's
    // choice: keep whichever item already holds tabindex=0 and only
    // initialise new items (or fall back to the first when the current
    // tab stop was removed).
    const current = enabled.find((item) => item.getAttribute("tabindex") === "0") ?? enabled[0];
    for (const item of items) item.setAttribute("tabindex", item === current ? "0" : "-1");
  });

  function onToolbarKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    const container = e.currentTarget;
    const items = enabledToolbarItems(container);
    if (items.length === 0) return;
    const currentIndex = items.indexOf(e.target as HTMLElement);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (e.key === "ArrowRight") nextIndex = (currentIndex + 1) % items.length;
    else if (e.key === "ArrowLeft") nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = items.length - 1;
    e.preventDefault();
    items[currentIndex]?.setAttribute("tabindex", "-1");
    items[nextIndex]?.setAttribute("tabindex", "0");
    items[nextIndex]?.focus();
  }

  const classes = typeof className === "object" ? className : {};
  return (
    <ToolbarClassesContext.Provider value={classes}>
      <div ref={mergeRefs(ref, localRef)} role="toolbar" data-jul-editor-keep-selection="" aria-label={ariaLabel ?? labels.toolbarFormatting} onKeyDown={onToolbarKeyDown} {...props} className={typeof className === "string" ? className : classes.container}>
        {children}
      </div>
    </ToolbarClassesContext.Provider>
  );
});
