// <Editor.Toolbar> + the button atoms. Every atom is a thin `useActiveMarks`/
// `useBlockType` + `useCommands` subscriber -- all editing behavior is a
// single existing core command call (toggleMark/setBlockType/undo/redo); the
// button only decides *when* to call it (nothing in React adds
// editing behavior; it only wraps core). className passthrough only, no
// inline styles, no CSS.

import type { Json } from "@jul-editor/core";
import type { ComponentPropsWithoutRef, KeyboardEvent, MouseEvent } from "react";
import { createContext, forwardRef, useContext, useEffect, useRef } from "react";
import { LabelsContext, useEditorContext } from "./context.js";
import { Slot, mergeRefs } from "./slot.js";
import { useActiveMarks, useBlockType, useCommands, useEditorState } from "./hooks.js";
import type { Labels } from "./labels.js";

export interface ToolbarClassNames { container?: string; button?: string; text?: string }
const ToolbarClassesContext = /* @__PURE__ */ createContext<ToolbarClassNames>({});
function useToolbarClasses(className?: string) {
  const classes = useContext(ToolbarClassesContext);
  return { button: [classes.button, className].filter(Boolean).join(" ") || undefined, text: classes.text };
}

const TOOLBAR_ITEM_ATTR = "data-jul-editor-toolbar-item";
const toolbarItemAttrs = { [TOOLBAR_ITEM_ATTR]: "" };

export interface ToolbarButtonProps extends Omit<ComponentPropsWithoutRef<"button">, "type"> {
  asChild?: boolean;
}

function handleClick(onCommand: () => void, userOnClick?: (e: MouseEvent<HTMLButtonElement>) => void) {
  return (e: MouseEvent<HTMLButtonElement>) => {
    userOnClick?.(e);
    if (!e.defaultPrevented) onCommand();
  };
}

// `labelKey` is read from context (not baked in at module-eval time
// like the old plain `defaultLabel` string), so the same exported component
// picks up `<Editor locale>`/`<Editor labels>` at render -- both the visible
// fallback text (`children ?? ...`) AND a real `aria-label` (so a consumer
// overriding `children` with e.g. an icon still gets a localized accessible
// name, unless THEY also pass their own `aria-label`).
function createToggleButton(markType: string, labelKey: keyof Labels) {
  return forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarMarkButton({ asChild, children, onClick, className, "aria-label": ariaLabel, ...props }, ref) {
    const marks = useActiveMarks();
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
        {...toolbarItemAttrs}
        onClick={handleClick(() => commands.toggleMark(markType), onClick)}
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

export const EditorLink = /* @__PURE__ */ forwardRef<HTMLButtonElement, ToolbarButtonProps>(function EditorLink({ asChild, children, onClick, className, "aria-label": ariaLabel, ...props }, ref) {
  const marks = useActiveMarks();
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
      {...toolbarItemAttrs}
      onClick={handleClick(() => {
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
  return forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarBlockButton({ asChild, children, onClick, className, "aria-label": ariaLabel, ...props }, ref) {
    const currentType = useBlockType();
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
        onClick={handleClick(() => commands.setBlockType(blockType, extraProps), onClick)}
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
  return useEditorState((state) => {
    const sel = state.selection;
    if (!sel || sel.type !== "text") return null;
    const rec = state.store.records.get(sel.anchor.blockId);
    if (rec?.type !== "heading") return null;
    return typeof rec.props.level === "number" ? rec.props.level : 1;
  });
}

export const EditorHeading = /* @__PURE__ */ forwardRef<HTMLButtonElement, HeadingButtonProps>(function EditorHeading(
  { asChild, children, onClick, className, level = 1, "aria-label": ariaLabel, ...props },
  ref,
) {
  const currentType = useBlockType();
  const currentLevel = useCurrentHeadingLevel();
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
      onClick={handleClick(() => commands.setBlockType("heading", { level }), onClick)}
      {...props} className={classes.button}
    >
      {children ?? (classes.text ? <span className={classes.text}>{label}</span> : label)}
    </Comp>
  );
});

function createHistoryButton(run: (commands: ReturnType<typeof useCommands>) => void, labelKey: keyof Labels) {
  return forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarHistoryButton({ asChild, children, onClick, className, "aria-label": ariaLabel, ...props }, ref) {
    const commands = useCommands();
    useEditorContext("Editor.Toolbar");
    const label = useContext(LabelsContext)[labelKey];
    const classes = useToolbarClasses(className);
    const Comp = (asChild ? Slot : "button") as "button";
    return (
      <Comp ref={ref} type={asChild ? undefined : "button"} aria-label={ariaLabel ?? label} {...toolbarItemAttrs} onClick={handleClick(() => run(commands), onClick)} {...props} className={classes.button}>
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
    const items = Array.from(el.querySelectorAll<HTMLElement>(`[${TOOLBAR_ITEM_ATTR}]`));
    items.forEach((item, i) => item.setAttribute("tabindex", i === 0 ? "0" : "-1"));
  });

  function onToolbarKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    const container = e.currentTarget;
    const items = Array.from(container.querySelectorAll<HTMLElement>(`[${TOOLBAR_ITEM_ATTR}]`));
    if (items.length === 0) return;
    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
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
