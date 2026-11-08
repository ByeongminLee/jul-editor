// A small (no radix dependency) `asChild` primitive: merges the
// props Slot itself received onto its single child element instead of
// rendering its own DOM node. Event handlers compose (both run, child first);
// className/style merge; every other prop from Slot wins over the child's
// (the caller's explicit override, e.g. `<Editor.Bold asChild><a className=
// "btn"/></Editor.Bold>` -- Slot's aria-pressed/data-active/onClick take
// precedence, the child contributes its own tag/className/whatever else).

import type { Ref } from "react";
import { Children, cloneElement, forwardRef, isValidElement, version } from "react";

// React 19 moved `ref` into props and warns on `element.ref`; React 18 keeps it on the element.
const refInProps = Number.parseInt(version, 10) >= 19;

export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(node);
      else (ref as { current: T | null }).current = node;
    }
  };
}

export interface SlotProps {
  children?: React.ReactNode;
  [prop: string]: unknown;
}

export const Slot = /* @__PURE__ */ forwardRef<HTMLElement, SlotProps>(function Slot({ children, ...slotProps }, ref) {
  const only = Children.only(children);
  if (!isValidElement(only)) return null;
  const child = only as React.ReactElement<Record<string, unknown>> & { ref?: Ref<HTMLElement> };
  const childProps = child.props;
  const merged: Record<string, unknown> = { ...slotProps, ...childProps };

  for (const key of ["className", "style"] as const) {
    if (slotProps[key] && childProps[key]) {
      merged[key] =
        key === "className"
          ? `${slotProps[key]} ${childProps[key]}`
          : { ...(slotProps[key] as object), ...(childProps[key] as object) };
    }
  }
  for (const key of Object.keys(slotProps)) {
    const slotHandler = slotProps[key];
    const childHandler = childProps[key];
    if (key.startsWith("on") && typeof slotHandler === "function" && typeof childHandler === "function") {
      merged[key] = (...args: unknown[]) => {
        childHandler(...args);
        slotHandler(...args);
      };
    }
  }

  return cloneElement(child, { ...merged, ref: mergeRefs(ref, refInProps ? (childProps.ref as Ref<HTMLElement> | undefined) : child.ref) });
});
