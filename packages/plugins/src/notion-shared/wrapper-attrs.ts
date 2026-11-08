// The core renderer mirrors only a few props onto a block wrapper (heading
// level, table spans), and it never removes attributes it did not write. A
// "decorated" plugin renderer therefore mirrors its own presentational props
// (callout color, toggle open state ...) onto the wrapper so host CSS can
// select on them (`[data-type="toggle"][data-jul-editor-open="false"] > ...`).
// MutationObserver in core observes childList/characterData only, so an
// attribute write here never triggers a structural revert.

/** Walks up from a renderer's own node to the owning block wrapper. */
export function blockWrapperOf(node: Element | null): HTMLElement | null {
  return (node?.closest("[data-jul-editor-block]") as HTMLElement | null) ?? null;
}

/** Sets (string) or removes (undefined) attributes on the owning wrapper; no-op when unchanged. */
export function syncWrapperAttrs(node: Element | null, attrs: Record<string, string | undefined>): void {
  const wrapper = blockWrapperOf(node);
  if (!wrapper) return;
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined) {
      if (wrapper.hasAttribute(name)) wrapper.removeAttribute(name);
    } else if (wrapper.getAttribute(name) !== value) wrapper.setAttribute(name, value);
  }
}
